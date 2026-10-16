# fam_mammal.py - the MAMMAL head family (snouted faces: dog, fox, cat, rat, bear, horse, cow, ox, goat, sheep, mole,
# otter, beaver ...). A head is a skull (cranium + face block), cheeks / jowls, a snout (round cone, optionally ending
# in a broad muzzle pad), chin, neck and nape, with carved eyes (hkit.EyeRig) and mouth (hkit.MouthRig, fitted to the
# surface), brows, a nose (button / big / nostrils / bulb), ears (point / big / cow / flop / tiny / round), colour
# regions and the cap. Species modules pass a params dict (merged over DEFAULTS = Rocco's proportions) and a features()
# hook for horns, manes, beards, whiskers, teeth ... All coordinates are hkit design space (see hkit.py).
import math
import copy
import numpy as np
import hkit as K
import rk_sdf as SD
import rk_geo as G
from rk_geo import Part, nrm

DEFAULTS = dict(
    cran=dict(c=(0.0, 0.08, 4.14), r=(0.62, 0.56, 0.62)),
    face=dict(c=(0.0, -0.19, 4.17), r=(0.50, 0.36, 0.28), k=0.16),
    jowl=dict(c=(0.30, -0.09, 3.70), r=(0.41, 0.40, 0.37), k=0.17),
    snout=dict(a=(0.0, -0.34, 3.85), b=(0.0, -0.73, 3.89), ra=0.27, rb=0.175, sx=1.0, sz=0.9, k=0.12),
    muzzle=None,                      # dict(c, r, k): broad pad at the end of the snout (cattle, horses, sheep)
    chin=dict(c=(0.0, -0.40, 3.545), r=(0.26, 0.31, 0.16), k=0.10),
    neck=dict(a=(0.0, 0.12, 3.62), b=(0.0, 0.10, 3.00), r=0.22, k=0.14),      # the stub ends just inside the collar
    nape=dict(c=(0.0, 0.25, 3.76), r=(0.33, 0.30, 0.26), k=0.14),
    extra=[],                         # [(k, sdf)] species additions, smooth-unioned into the skull
    carve=[],                         # [(k, sdf)] species subtractions
    eye=dict(x=0.18, z=4.17, axis=(0.13, -1.0, 0.02), R=0.40, W=0.128, H=0.195, out=0.036, rim=0.042, lid='fur',
             pupil=(9.0, 13.5), lid_drop=0.0, ring='mask'),
    mouth=dict(z0=3.70, W=0.30, curve=0.62, depth=0.56, jaw_back=0.68, jaw_open=None, teeth='rows', tongue=True,
               key_scale=None),
    nose=dict(kind='button', z=3.915, r=(0.13, 0.095, 0.09), out=0.023, mat='nose'),
    ear=dict(kind='point', base=(0.41, 0.04, 4.625), up=(0.42, 0.05, 1.0), fwd=(0.30, -1.0, 0.0), H=0.42, W=0.18,
             T=0.045, cup=0.10, droop=0.0, shape='tri', mat='fur', inner='fur_light', rim=None, slot=True, tris=200),
    brow=dict(z=4.44, x0=0.06, x1=0.37, arch=0.07, thick=0.052, mat='mask', tilt=0.0),
    cap=dict(lift=0.0, brim=1.0, cranium=None),
    regions=[],                       # [(material, fn(geo) -> sdf)] skin colour regions (first match wins)
    skin_tris=2700,
    skin_mat='fur',
)


def merged(over):
    """DEFAULTS deep-merged with a species' overrides (dicts merge one level deep; None removes)."""
    P = copy.deepcopy(DEFAULTS)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(P.get(k), dict):
            P[k] = dict(P[k])
            P[k].update(v)
        else:
            P[k] = v
    return P


class Geo:
    """What feature builders get: params, the uncarved skull SDF, the cranium SDF, eyes, mouth and landmarks."""
    def __init__(self, P):
        self.P = P
        self.f = None
        self.cranium = None
        self.eyes = None
        self.mouth = None
        self.nose_c = None
        self.cap = None
        self.slots = []


def mirror_x(p):
    return np.array([-p[0], p[1], p[2]], float)


# ------------------------------------------------------------------------------------------- the skull
def skull_sdf(P):
    cr = P['cran']
    f = SD.ellipsoid(cr['c'], cr['r'])
    fc = P.get('face')
    if fc:
        f = SD.smooth_union(fc['k'], f, SD.ellipsoid(fc['c'], fc['r']))
    j = P.get('jowl')
    if j:
        c = np.asarray(j['c'], float)
        f = SD.smooth_union(j['k'], f, SD.union(SD.ellipsoid(c, j['r']), SD.ellipsoid(mirror_x(c), j['r'])))
    sn = P.get('snout')
    if sn:
        a, b = np.asarray(sn['a'], float), np.asarray(sn['b'], float)
        cone = SD.round_cone(a, b, sn['ra'], sn['rb'])
        f = SD.smooth_union(sn['k'], f, SD.scaled(cone, (sn.get('sx', 1.0), 1.0, sn.get('sz', 1.0)), (a + b) / 2))
    mz = P.get('muzzle')
    if mz:
        f = SD.smooth_union(mz['k'], f, SD.ellipsoid(mz['c'], mz['r']))
    ch = P.get('chin')
    if ch:
        f = SD.smooth_union(ch['k'], f, SD.ellipsoid(ch['c'], ch['r']))
    nk = P.get('neck')
    if nk:
        f = SD.smooth_union(nk['k'], f, SD.capsule(nk['a'], nk['b'], nk['r']))
    na = P.get('nape')
    if na:
        f = SD.smooth_union(na['k'], f, SD.ellipsoid(na['c'], na['r']))
    for k, g in P.get('extra', []):
        f = SD.smooth_union(k, f, g)
    for k, g in P.get('carve', []):
        f = SD.smooth_sub(k, f, g)
    return f


# ------------------------------------------------------------------------------------------- noses
def nose_parts(ctx, head, geo):
    N = geo.P['nose']
    kind = N['kind']
    f = geo.f
    if kind in ('nostrils', None, 'none'):
        return []
    z = N['z']
    y = K.surface_y(f, 0.0, z)
    rx, ry, rz = N['r']
    # nose centre a quarter radius in front of the snout surface (Rocco: 0.023 for ry 0.095): it protrudes 1.25 ry
    c = np.array([0.0, y - ry * 0.25 - N.get('out', 0.0), z])
    if kind == 'button':
        g = SD.smooth_union(0.03, SD.ellipsoid(c, (rx, ry, rz)),
                            SD.ellipsoid(c + [0, ry * 0.35, rz * 0.45], (rx * 0.73, ry * 0.74, rz * 0.67)))
        p = K.blob(g, c, max(rx, ry, rz) + 0.12, 90, N.get('mat', 'nose'), 'nose')
    elif kind == 'big':
        cc = c
        g = SD.smooth_union(0.04, SD.ellipsoid(cc, (rx, ry, rz)), SD.ellipsoid(cc + [0, ry * 0.3, rz * 0.5], (rx * 0.8, ry * 0.8, rz * 0.7)))
        nostr = SD.union(SD.ellipsoid(cc + [rx * 0.42, -ry * 0.75, -rz * 0.25], (rx * 0.20, ry * 0.3, rz * 0.16)),
                         SD.ellipsoid(cc + [-rx * 0.42, -ry * 0.75, -rz * 0.25], (rx * 0.20, ry * 0.3, rz * 0.16)))
        g = SD.smooth_sub(0.02, g, nostr)
        p = K.blob(g, cc, max(rx, ry, rz) + 0.12, 140, N.get('mat', 'nose'), 'nose')
    elif kind == 'bulb':
        cc = c
        g = SD.smooth_union(0.05, SD.ellipsoid(cc, (rx, ry, rz)), SD.ellipsoid(cc + [0, ry * 0.6, 0], (rx * 0.75, ry * 0.7, rz * 0.75)))
        p = K.blob(g, cc, max(rx, ry, rz) + 0.14, 150, N.get('mat', 'nose'), 'nose')
    else:
        raise ValueError('nose kind ' + kind)
    geo.nose_c = c
    head.parts.append(p)
    head.face_y = min(head.face_y, float(p.V[:, 1].min()))
    return [p]


def nostril_carve(c, sep, r=(0.045, 0.06, 0.035), tilt=0.0):
    """Two nostril pits at the muzzle front around point c (separation sep)."""
    c = np.asarray(c, float)
    return SD.union(SD.ellipsoid(c + [sep / 2, 0, 0], r), SD.ellipsoid(c + [-sep / 2, 0, 0], r))


# ------------------------------------------------------------------------------------------- ears
def ear_frames(E, s):
    base = np.asarray(E['base'], float) * np.array([s, 1, 1])
    upv = np.asarray(E['up'], float) * np.array([s, 1, 1])
    fwd = np.asarray(E['fwd'], float) * np.array([s, 1, 1])
    return base, upv, fwd


def ear_parts(ctx, head, geo):
    E = geo.P.get('ear')
    if not E or E.get('kind') in (None, 'none'):
        return []
    out = []
    for s in (1, -1):
        sd = 'L' if s > 0 else 'R'
        base, upv, fwd = ear_frames(E, s)
        # ears are built per side (not mirrored copies) so asymmetric droop / seeds stay possible
        p = K.ear_leaf(base, upv, fwd, E['H'], E['W'], T=E.get('T', 0.045), cup=E.get('cup', 0.10), mat_out=E.get('mat', 'fur'),
                       mat_in=E.get('inner', 'fur_light'), rim=E.get('rim'), droop=E.get('droop', 0.0), tris=E.get('tris', 200),
                       name='ear_' + sd, bone='ear.' + sd, inner=bool(E.get('inner')), shape=E.get('shape', 'tri'))
        out.append(p)
        if s > 0:
            head.joints['ear.L'] = base
        if E.get('slot', True):
            u = nrm(upv)
            fw = nrm(fwd - np.dot(fwd, u) * u)
            side = np.cross(u, fw)
            hw = max(E['W'] * 0.58, 0.09)
            geo.slots += [(base + side * E['W'] * 0.4, u, hw), (base - side * E['W'] * 0.4, u, hw)]
    head.parts += out
    return out


# ------------------------------------------------------------------------------------------- regions
def cyl(P, cy):
    P = np.asarray(P, float)
    th = np.arctan2(P[..., 0], -(P[..., 1] - cy))
    return th * 0.62, P[..., 2]


def region_lower_face(top_dz=-0.25, side_drop=0.20, back=0.05, neck_z=3.40, extra=None):
    """Light lower face (muzzle, lips, chin, jowls), bounded above by a line under the eyes sweeping down the sides
    (Rocco's cream region without the tufts)."""
    def make(geo):
        cy = geo.P['cran']['c'][1]
        ez = geo.P['eye']['z']

        def f(P):
            P = np.asarray(P, float)
            s_, z = cyl(P, cy)
            a = np.abs(s_)
            top = (ez + top_dz) - side_drop * np.clip((a - 0.12) / 0.55, 0, 1) ** 1.4
            d = z - top
            front = (P[..., 1] - cy) - back - 0.25 * np.clip((a - 0.4) / 0.4, 0, 1)
            c = np.maximum(np.maximum(d, front), neck_z - z)
            c = np.maximum(c, (a - 1.10) * 0.5)
            if extra is not None:
                c = np.minimum(c, extra(geo)(P))
            return c
        return f
    return make


def region_ellipsoid(c, r, R=None):
    def make(geo):
        return SD.ellipsoid(c, r, R=R)
    return make


def region_muzzle(scale=1.06, dz=0.0):
    """The muzzle pad (+ the snout tip) as a colour region."""
    def make(geo):
        mz = geo.P.get('muzzle')
        sn = geo.P['snout']
        terms = []
        if mz:
            terms.append(SD.ellipsoid(np.asarray(mz['c'], float) + [0, 0, dz], np.asarray(mz['r'], float) * scale))
        b = np.asarray(sn['b'], float)
        terms.append(SD.ellipsoid(b + [0, -0.02, dz], (sn['rb'] * 1.25 * sn.get('sx', 1), sn['rb'] * 1.3, sn['rb'] * 1.25 * sn.get('sz', 1))))
        return SD.union(*terms)
    return make


def region_face_front(back=-0.02, top=None, neck_z=3.45):
    """The whole front of the face (forehead, eyes, cheeks, muzzle) in a light colour, the back of the head and the
    nape in the main coat (possums, some cats). back: how far behind the cranium centre the boundary sits."""
    def make(geo):
        cy = geo.P['cran']['c'][1]

        def f(P):
            P = np.asarray(P, float)
            s_, z = cyl(P, cy)
            a = np.abs(s_)
            d = (P[..., 1] - cy) - back - 0.18 * np.clip((a - 0.55) / 0.4, 0, 1)
            d = np.maximum(d, neck_z - z)
            if top is not None:
                d = np.maximum(d, z - top)
            return d
        return f
    return make


def region_eye_patches(r=(0.20, 0.30, 0.18), dz=0.0, sides=(1, -1)):
    """Dark patches round the eyes (possums, raccoon-ish masks, pandas)."""
    def make(geo):
        e = geo.P['eye']
        terms = [SD.ellipsoid((s * e['x'], -0.45, e['z'] + dz), r) for s in sides]
        return SD.union(*terms) if len(terms) > 1 else terms[0]
    return make


def region_stripe(width=0.09, z_bot=3.95, back=0.9, width_back=0.16):
    """A light stripe from the bridge of the nose over the top of the head to the nape (skunks)."""
    def make(geo):
        def f(P):
            P = np.asarray(P, float)
            x, y, z = P[..., 0], P[..., 1], P[..., 2]
            t = np.clip((y + 0.6) / (back + 0.6), 0, 1)
            w = width + (width_back - width) * t
            return np.maximum(np.abs(x) - w, z_bot - z)
        return f
    return make


def region_blaze(z_top=4.75, z_bot=3.85, w_top=0.07, w_bot=0.13):
    """A white stripe down the middle of the face (horses)."""
    def make(geo):
        def f(P):
            P = np.asarray(P, float)
            x, y, z = P[..., 0], P[..., 1], P[..., 2]
            t = np.clip((z_top - z) / (z_top - z_bot), 0, 1)
            w = w_top + (w_bot - w_top) * t
            d = np.maximum(np.abs(x) - w, np.maximum(z - z_top, z_bot - z))
            return np.maximum(d, y - (geo.P['cran']['c'][1] - 0.15))
        return f
    return make


def region_patch(side, c, r):
    """A dark patch around one eye (dogs); side +1 = his left."""
    def make(geo):
        cc = np.asarray(c, float) * np.array([side, 1, 1])
        return SD.ellipsoid(cc, r)
    return make


def region_spots(rng, n=4, zone=((-0.6, 0.6), (-0.4, 0.5), (3.95, 4.7)), size=(0.12, 0.22)):
    """Seeded cow spots: blobs on the skull (front and back, never over the eyes)."""
    spots = []
    for i in range(n):
        x = rng.uniform(*zone[0])
        y = rng.uniform(*zone[1])
        z = rng.uniform(*zone[2])
        r = rng.uniform(*size)
        spots.append((np.array([x, y, z]), np.array([r * rng.uniform(0.9, 1.5), r * 1.2, r * rng.uniform(0.7, 1.1)])))

    def make(geo):
        e = geo.P['eye']

        def f(P):
            P = np.asarray(P, float)
            d = np.full(P.shape[:-1], 1e3)
            for c, r in spots:
                d = np.minimum(d, SD.ellipsoid(c, r)(P))
            for s in (1, -1):          # keep the eye surround clean
                d = np.maximum(d, -(SD.ellipsoid((e['x'] * s, -0.5, e['z']), (0.26, 0.4, 0.3))(P)))
            return d
        return f
    return make


# ------------------------------------------------------------------------------------------- face extras
def whiskers(ctx, head, geo, n=3, length=0.42, mat='fur_dark', droop=0.05, spread=0.06, root=None, radius=0.011):
    """Thin whisker strands from the sides of the muzzle."""
    m = geo.mouth
    out = []
    W = m.W if m is not None else 0.3
    for s in (1, -1):
        for i in range(n):
            if root is None:
                z = (m.z0 + 0.10 if m is not None else 3.8) + (i - (n - 1) / 2) * spread
                y0 = (m.front + m.recede * 0.5 + 0.20) if m is not None else -0.7
                a = K.march_to(geo.f, np.array([s * (W + 0.5), y0, z]), (-s, 0, 0))
            else:
                a = np.asarray(root, float) * np.array([s, 1, 1]) + np.array([0, 0, (i - (n - 1) / 2) * spread])
            d = nrm(np.array([s * 1.0, -0.15, 0.15 * (1 - i) - droop]))
            pts = [a - d * 0.02, a + d * length * 0.5 + np.array([0, 0, -droop * 0.3]), a + d * length + np.array([0, 0, -droop])]
            out.append(K.tube(K.curve_pts(pts, 3), np.linspace(radius, radius * 0.36, 7), 4, mat, 'whisker'))
    head.parts += out
    return out


def freckles(ctx, head, geo, n=3, mat='fur_dark'):
    if K.LOD > 0:
        return []
    out = []
    e = geo.P['eye']
    for s in (1, -1):
        for i, (dx, dz) in enumerate(((0.10, -0.25), (0.19, -0.22), (0.145, -0.31))[:n]):
            p0 = np.array([s * (e['x'] + dx), -1.8, e['z'] + dz])
            c = K.march_to(geo.f, p0, (0, 1, 0))
            nn = SD.normals(geo.f, c[None])[0]
            g = SD.ellipsoid(c, (0.03, 0.03, 0.012), R=G.zframe(nn))
            out.append(K.blob(g, c, 0.08, 20, mat, 'freckle', h=0.005))
    head.parts += out
    return out


def bandaid(ctx, head, geo, at=None, mat='accessory_a', ang=0.5):
    """A sticking plaster on the cheek / brow (seeded side)."""
    e = geo.P['eye']
    side = -1 if ctx.rng.random() < 0.5 else 1
    if at is None:
        at = np.array([side * (e['x'] + 0.22), -1.6, e['z'] + 0.30])
    c = K.march_to(geo.f, at, (0, 1, 0))
    nn = SD.normals(geo.f, c[None])[0]
    R = G.zframe(nn)
    rot = G.rot_axis(nn, ang * side)
    R = rot @ R
    g = SD.box(c, (0.13, 0.05, 0.012), R=R, rnd=0.01) if hasattr(SD, 'box') else SD.ellipsoid(c, (0.13, 0.05, 0.012), R=R)
    p = K.blob(g, c, 0.2, 40, mat, 'bandaid', h=0.006)
    head.parts.append(p)
    return p


def toothpick(ctx, head, geo, corner, mat='accessory_a', length=0.30):
    """A toothpick jutting out of the mouth corner (on the jaw), tilted up and out."""
    a = np.asarray(corner, float) + np.array([0.02, 0.06, 0.0])
    d = nrm(np.array([-0.85, -0.45, 0.22]))
    pts = [a - d * 0.06, a + d * length * 0.5, a + d * length]
    p = K.tube(pts, np.array([0.012, 0.011, 0.006]), 5, mat, 'toothpick', bone='jaw')
    head.parts.append(p)
    return p


def mustache(ctx, head, geo, mat='fur_dark', w=0.28, droop=0.045, thick=0.05):
    """Walrus-ish mustache under the nose (two tapered tubes conformed to the upper lip)."""
    m = geo.mouth
    out = []
    zc = m.z0 + 0.10
    for s in (1, -1):
        pts = []
        for t in np.linspace(0, 1, 6):
            x = s * (0.02 + w * t)
            z = zc - droop * t ** 1.6 + 0.02 * math.sin(t * math.pi)
            a = K.march_to(geo.f, np.array([x, -1.8, z]), (0, 1, 0))
            pts.append(a + SD.normals(geo.f, a[None])[0] * 0.02)
        rad = thick * (1 - np.linspace(0, 1, 6) ** 1.5 * 0.75)
        out.append(K.tube(pts, rad, 7, mat, 'mustache'))
    head.parts += out
    return out


def sideburns(ctx, head, geo, mat='fur_dark'):
    out = []
    e = geo.P['eye']
    for s in (1, -1):
        pts = []
        for t in np.linspace(0, 1, 5):
            z = e['z'] + 0.05 - 0.55 * t
            a = K.march_to(geo.f, np.array([s * 1.4, -0.05 - 0.12 * t, z]), (-s, 0, 0))
            pts.append(a + SD.normals(geo.f, a[None])[0] * 0.025)
        rad = [0.05, 0.075, 0.085, 0.07, 0.03]
        out.append(K.tube(pts, rad, 7, mat, 'sideburn'))
    head.parts += out
    return out


def goatee(ctx, head, geo, length=0.45, width=0.12, mat='fur_light', curl=0.0, bone='jaw'):
    """A pointed beard hanging from the chin (goats; the Ox's beard)."""
    m = geo.mouth
    top = K.march_to(geo.f, np.array([0, -1.8, m.z0 - 0.17]), (0, 1, 0)) + np.array([0, 0.04, 0])
    pts = [top, top + np.array([0, -0.06, -length * 0.45]), top + np.array([0, -0.03 + curl, -length])]
    pts = K.curve_pts(pts, 4)
    t = np.linspace(0, 1, len(pts))
    rx = width * (1 - t ** 1.3) + 0.012
    ry = width * 0.7 * (1 - t ** 1.3) + 0.010
    p = G.sweep(pts, None, 8, mat, up=(0, -1, 0), rx=rx, ry=ry, name='beard')
    K.orient_outward(p)
    w = G.smoothstep(top[2] + 0.02, top[2] - 0.12, p.V[:, 2])
    p.set_weights({bone: w, 'head': 1 - w}) if bone != 'head' else p.rigid('head')
    head.parts.append(p)
    return p


# ------------------------------------------------------------------------------------------- horns, tufts, manes
def horn_pair(ctx, head, geo, ctrl, r0, r1, mat='horn', ridges=0, slot=True, n=8):
    """A mirrored pair of horns along a control polyline (left side given); registers cap slots at the roots."""
    out = []
    for s in (1, -1):
        pts = [np.array([c[0] * s, c[1], c[2]], float) for c in ctrl]
        p = K.horn(pts, r0, r1, mat=mat, name='horn_' + ('L' if s > 0 else 'R'), ridges=ridges, n=n)
        out.append(p)
        if slot:
            d = nrm(pts[1] - pts[0])
            geo.slots.append((pts[0] + d * 0.05, d, r0 + 0.03))
    head.parts += out
    return out


def antler_pair(ctx, head, geo, root=(0.24, 0.10, 4.62), beam=((0.40, 0.18, 4.95), (0.62, 0.30, 5.18), (0.78, 0.36, 5.42)),
                tines=((0.45, (0.40, 0.02, 5.25)), (0.70, (0.64, 0.12, 5.52))), r0=0.065, mat='horn', slot=True, palm=False):
    """Antlers (deer, moose): a main beam through the cap with tines branching off it (tines: (fraction along the
    beam, tip point)); palm=True adds a flat moose palm between the tines."""
    out = []
    for s in (1, -1):
        mir = np.array([s, 1, 1])
        ctrl = [np.asarray(root, float) * mir] + [np.asarray(b, float) * mir for b in beam]
        main = K.horn(ctrl, r0, r0 * 0.4, mat=mat, name='antler_' + ('L' if s > 0 else 'R'))
        out.append(main)
        pts = K.curve_pts(ctrl, 8)
        seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
        sl = np.concatenate([[0], np.cumsum(seg)])
        for frac, tip in tines:
            a = np.array([np.interp(frac * sl[-1], sl, pts[:, i]) for i in range(3)])
            tp = np.asarray(tip, float) * mir
            out.append(K.horn([a, (a + tp) / 2 + np.array([0, 0, 0.04]), tp], r0 * 0.7, r0 * 0.3, mat=mat, name='tine'))
        if palm:
            c = np.array([np.interp(0.75 * sl[-1], sl, pts[:, i]) for i in range(3)])
            g = SD.ellipsoid(c + np.array([0.0, 0.05, 0.12]), (0.28, 0.05, 0.20), R=G.frame_from((0, 1, 0.2), (s * 0.3, 0, 1)))
            out.append(K.blob(g, c, 0.6, 220, mat, 'palm'))
        if slot:
            d = nrm(ctrl[1] - ctrl[0])
            geo.slots.append((ctrl[0] + d * 0.05, d, r0 + 0.03))
    head.parts += out
    return out


def tusks(ctx, head, geo, length=0.55, r=0.05, mat='teeth', spread=0.14, curve=0.10):
    """Walrus tusks hanging from the upper lip (rigid to the head; ivory = the teeth colour)."""
    m = geo.mouth
    out = []
    for s in (1, -1):
        top = K.march_to(geo.f, np.array([s * spread, -1.8, m.z0 + 0.03]), (0, 1, 0)) + np.array([0, 0.06, 0])
        ctrl = [top, top + np.array([s * 0.02, -0.03, -length * 0.5]), top + np.array([s * 0.04, curve, -length])]
        out.append(K.horn(ctrl, r, r * 0.35, mat=mat, name='tusk'))
    head.parts += out
    return out


def nostril_pad(geo, pad_mat='nose', hole_mat='mouth', sep=0.20, r=(0.045, 0.06, 0.035), z=None, pad=None):
    """Muzzle-pad nose for cattle / horses / goats / sheep: nostril pits carved into the skull and colour regions
    for the pad and the pits. Call from params() (it extends P['carve'] and P['regions'])."""
    P = geo
    mz = P.get('muzzle')
    sn = P['snout']
    if mz:
        c = np.asarray(mz['c'], float)
        rr = np.asarray(mz['r'], float)
    else:
        c = np.asarray(sn['b'], float)
        rr = np.array([sn['rb'], sn['rb'], sn['rb']])
    zc = c[2] + rr[2] * 0.25 if z is None else z
    front = c[1] - rr[1]
    pits = []
    for s in (1, -1):
        pc = np.array([s * sep / 2, front + 0.015, zc])
        pits.append(SD.ellipsoid(pc, r, R=G.frame_from(nrm(np.array([s * 0.35, 1.0, 0.25])), (0, 0, 1))))
    pit = SD.union(*pits)
    P.setdefault('carve', [])
    P['carve'] = list(P['carve']) + [(0.02, pit)]
    regs = [(hole_mat, lambda geo_, pit=pit: (lambda Q: pit(Q) - 0.012))]
    if pad_mat:
        pr = pad if pad is not None else (rr * np.array([0.92, 1.0, 0.85]))
        pc = c + np.array([0, -rr[1] * 0.45, rr[2] * 0.05])
        regs.append((pad_mat, lambda geo_, pc=pc, pr=pr: SD.ellipsoid(pc, pr)))
    P['regions'] = regs + list(P.get('regions', []))
    return P


def hair_tuft(ctx, head, geo, at, n=5, size=0.09, spread=0.16, mat='fur_dark', up=(0, -0.3, 1.0), bone='head', seed=0):
    """A tuft of curly hair blobs (forelock / topknot)."""
    rng = np.random.default_rng(seed)
    a = np.asarray(at, float)
    terms = []
    upv = nrm(np.asarray(up, float))
    for i in range(n):
        t = (i - (n - 1) / 2) / max((n - 1) / 2, 1)
        c = a + np.array([t * spread, rng.uniform(-0.03, 0.03), 0]) + upv * size * (0.6 + 0.6 * (1 - abs(t)))
        terms.append(SD.ellipsoid(c, (size * 0.75, size * 0.7, size * (1.0 + 0.4 * (1 - abs(t))))))
    f = SD.smooth_union(0.03, *terms) if len(terms) > 1 else terms[0]
    p = K.blob(f, a + upv * size, size * 3 + spread, 160, mat, 'tuft', bone=bone, h=0.008)
    head.parts.append(p)
    return p


def mane(ctx, head, geo, mat='fur_dark', n=7, z0=4.55, z1=3.25, width=0.10, height=0.16):
    """A horse mane: a continuous crest of hair down the back of the head and neck (a chain of flattened capsules
    with scalloped locks), weighted head -> neck."""
    f = geo.f
    pts = []
    for t in np.linspace(0, 1, n):
        z = z0 + (z1 - z0) * t
        pts.append(K.march_to(f, np.array([0.0, 1.6, z]), (0, -1, 0)))
    pts = np.array(pts)
    N = SD.normals(f, pts)
    hs = [height * (1.0 - 0.35 * abs(i / (n - 1) - 0.3)) for i in range(n)]
    core = [p + nn * h * 0.35 for p, nn, h in zip(pts, N, hs)]

    def g(Q):
        Q = np.asarray(Q, float)
        Qs = Q.copy()
        Qs[..., 0] = Qs[..., 0] * (height / width) * 0.55          # flatten sideways: a crest, not a sausage
        d = SD.ptube([c * np.array([(height / width) * 0.55, 1, 1]) for c in core], [h * 0.75 for h in hs])(Qs) * (width / height) / 0.55
        locks = []
        for i in range(n - 1):
            c = (core[i] + core[i + 1]) / 2 + (N[i] + N[i + 1]) / 2 * hs[i] * 0.45
            locks.append(SD.ellipsoid(c, (width * 0.8, hs[i] * 0.45, hs[i] * 0.5))(Q))
        return SD.smin(d, np.min(np.stack(locks), 0), 0.04)
    lo, hi = pts.min(0) - 0.5, pts.max(0) + 0.5
    p = K.sdf_part(g, lo, hi, K.hq(0.009), K.tq(480, 50), mat, 'mane')
    w = G.smoothstep(3.75, 3.40, p.V[:, 2])
    p.set_weights({'neck': w, 'head': 1 - w})
    head.parts.append(p)
    return p


# ------------------------------------------------------------------------------------------- build
def build(ctx, over, features=None):
    """Build a mammal head. over: species params (merged over DEFAULTS); features(ctx, head, geo) adds the species'
    pieces before the cap is fitted (horns / ears register cap slots in geo.slots)."""
    P = merged(over)
    head = K.Head()
    geo = Geo(P)
    f = skull_sdf(P)
    geo.f = f
    cr = P['cran']
    geo.cranium = (P['cap'].get('cranium') or SD.ellipsoid(cr['c'], cr['r']))
    head.cranium = geo.cranium
    # eyes and mouth fitted to the skull surface
    e = P['eye']
    geo.eyes = K.fit_eyes(f, x=e['x'], z=e['z'], axis=e['axis'], R=e['R'], W=e['W'], H=e['H'], out=e['out'],
                          lid_mat=e['lid'], rim=e['rim'], pupil=tuple(e['pupil']))
    geo.eyes.lid_drop = e.get('lid_drop', 0.0)
    geo.eyes.ring_mat = e.get('ring')
    m = P['mouth']
    geo.mouth = None
    if m:
        geo.mouth = K.fit_mouth(f, z0=m['z0'], W=m['W'], curve=m['curve'], depth=m['depth'], jaw_back=m['jaw_back'],
                                jaw_open=m.get('jaw_open'), teeth=m['teeth'], tongue=m['tongue'], key_scale=m.get('key_scale'))
    # skin with colour regions
    regions = [(mat, mk(geo)) for mat, mk in P.get('regions', [])]
    sn = P['snout']
    ymin = min(np.asarray(sn['b'], float)[1] - sn['rb'], (np.asarray(P['muzzle']['c'], float)[1] - P['muzzle']['r'][1]) if P.get('muzzle') else 0)
    lo = (-1.35, ymin - 0.35, 2.6)
    hi = (1.35, 1.0, cr['c'][2] + cr['r'][2] + 0.3)
    K.skin(head, f, regions, geo.mouth, geo.eyes, lo=lo, hi=hi, tris=P.get('skin_tris', 2700), default=P.get('skin_mat', 'fur'))
    head.face_y = float(min(p.V[:, 1].min() for p in head.parts))
    # eyes
    for s in (1, -1):
        e_parts, pupils = geo.eyes.parts(s)
        head.parts += e_parts
        head.pupils += pupils
    head.joints['eye.L'] = geo.eyes.frame(1)[0]
    # brows
    b = P['brow']
    if b:
        K.brows(head, head.skin_f, z=b['z'], x0=b['x0'], x1=b['x1'], arch=b['arch'], thick=b['thick'], mat=b['mat'], tilt=b.get('tilt', 0.0))
    else:
        head.joints['brow.L'] = np.array([0.2, -0.5, e['z'] + 0.25])
    # nose, teeth, ears
    nose_parts(ctx, head, geo)
    if geo.mouth is not None:
        head.parts += geo.mouth.inner_parts()
        head.joints['jaw'] = geo.mouth.jaw
    else:
        head.joints['jaw'] = np.array([0.0, -0.2, 3.8])
    ear_parts(ctx, head, geo)
    if 'ear.L' not in head.joints:
        head.joints['ear.L'] = np.array([0.42, 0.04, 4.5])
    if features is not None:
        features(ctx, head, geo)
    accessories(ctx, head, geo)
    # cap
    cp = P['cap']
    fit = K.cap_fit(cr['c'] if not cp.get('cran_c') else cp['cran_c'], cr['r'] if not cp.get('cran_r') else cp['cran_r'],
                    lift=cp.get('lift', 0.0), brim=cp.get('brim', 1.0))
    if ctx.spec.get('cap', True):
        K.cap_parts(head, geo.cranium, fit['cap_c'], band_front=fit['band_front'], slots=geo.slots, brim_z=fit['brim_z'],
                    brim_r=fit['brim_r'], brim_y=fit['brim_y'], back=ctx.cap_back, cy=fit['cy'], band_y0=fit['band_y0'],
                    crown_mat=ctx.cap_mats[0], brim_mat=ctx.cap_mats[1], button_mat=ctx.cap_mats[2],
                    letter=ctx.spec.get('cap_letter', True))
    else:
        head.joints['cap'] = np.asarray(fit['cap_c'], float)
    head.geo = geo
    return head


def accessories(ctx, head, geo):
    """Card accessories (BB.CardArt face acc + the pitcher's look.hair) that every mammal can wear."""
    acc = ctx.acc
    if acc.get('shades'):
        K.shades(head, geo.eyes, mat='accessory_b')
    if acc.get('glasses'):
        K.round_glasses(head, geo.eyes, mat=acc.get('glasses_mat', 'accessory_b'))
    if acc.get('eyeblack'):
        K.eyeblack(head, head.skin_f, geo.eyes, mat='mask')
    if acc.get('freckles'):
        freckles(ctx, head, geo)
    if acc.get('bandaid'):
        bandaid(ctx, head, geo)
    m = geo.mouth
    if m is not None:
        corner = np.array([-(m.W - 0.02), m.front + m.recede + 0.17, m.z(m.W)])     # his right mouth corner
        if acc.get('gum'):
            K.gum_bubble(head, np.array([0.0, m.front + 0.12, m.z0]), r=0.12)
        if acc.get('stalk'):
            K.stalk(head, corner, side=-1, mat='accessory_a')
        if acc.get('toothpick'):
            toothpick(ctx, head, geo, corner)
        hair = acc.get('hair')
        if hair == 'mustache':
            mustache(ctx, head, geo, mat=acc.get('hair_mat', 'fur_dark'))
        elif hair == 'sideburns':
            sideburns(ctx, head, geo, mat=acc.get('hair_mat', 'fur_dark'))
        elif hair == 'beard':
            goatee(ctx, head, geo, mat=acc.get('hair_mat', 'fur_dark'))

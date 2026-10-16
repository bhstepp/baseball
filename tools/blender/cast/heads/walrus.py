# walrus.py - a big round head on a thick neck, small eyes set high, two huge puffy whisker pads with bristle dots, a
# small dark nose on top of them, a bushy droopy mustache (shape-keyed: it curls up for a smile, sags for a frown,
# lifts with an open mouth, so expressions still read under it), long ivory tusks, no ear flaps (just ear holes).
# Head options (spec.head): tusks (length factor), broken (his right tusk snapped short), stache (mustache size),
# lady (eyelashes that follow the lids, a string of pearls at the collar: Pearl 'Foghorn' Marlowe).
import math
import numpy as np
import hkit as K
import rk_sdf as SD
import rk_geo as G
import rk_mesh as MS
from rk_geo import Part, nrm
from heads import fam_mammal as M

FAMILY = 'mammal'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'mammal',
    'tail': 'stub',
    'build': 'round',
    'colors': {'nose': '#2A1E1E', 'teeth': '#F6EED8'},
    'body_over': {'tail_len': 0.6, 'hand_mat': 'fur'},
}
PAD = (0.175, -0.68, 3.76)         # left whisker pad centre
PAD_R = (0.205, 0.19, 0.18)


def params(ctx):
    o = ctx.opts
    P = dict(
        cran=dict(c=(0.0, 0.10, 4.15), r=(0.64, 0.60, 0.60)),
        face=dict(c=(0.0, -0.14, 4.10), r=(0.52, 0.40, 0.32), k=0.18),
        jowl=dict(c=(0.33, -0.16, 3.70), r=(0.45, 0.44, 0.40), k=0.20),
        snout=dict(a=(0.0, -0.28, 3.84), b=(0.0, -0.54, 3.80), ra=0.34, rb=0.30, sx=1.4, sz=0.85, k=0.12),
        extra=[(0.06, SD.union(SD.ellipsoid(PAD, PAD_R), SD.ellipsoid((-PAD[0], PAD[1], PAD[2]), PAD_R)))],
        carve=[(0.03, SD.union(SD.sphere((0.635, 0.14, 4.14), 0.035), SD.sphere((-0.635, 0.14, 4.14), 0.035)))],
        chin=dict(c=(0.0, -0.36, 3.50), r=(0.26, 0.28, 0.14), k=0.10),
        neck=dict(a=(0.0, 0.12, 3.62), b=(0.0, 0.10, 3.00), r=0.24, k=0.16),
        nape=dict(c=(0.0, 0.26, 3.74), r=(0.40, 0.34, 0.30), k=0.16),
        eye=dict(x=0.215, z=4.25, axis=(0.17, -1.0, 0.03), W=0.12, H=0.175, pupil=(10.0, 14.0)),
        mouth=dict(z0=3.55, W=0.25, curve=0.5, depth=0.56, jaw_back=0.66),
        nose=dict(kind='button', z=3.985, r=(0.10, 0.07, 0.065)),
        ear=None,
        brow=dict(z=4.50, x0=0.08, x1=0.36, arch=0.06, thick=0.055),
        regions=[('fur_light', M.region_ellipsoid((0.0, -0.72, 3.74), (0.44, 0.30, 0.26)))],
    )
    if o.get('lady'):
        P['eye'].update(lid_drop=4.0)
    return P


# ------------------------------------------------------------------------------------------- face pieces
def stache(ctx, head, geo, size=1.0, mat='fur_dark'):
    """A bushy mustache of soft lumps across the lower front of the whisker pads, drooping at the ends."""
    f = geo.f
    terms = []
    n = 6
    for s in (1, -1):
        for i in range(n):
            t = (i + 0.5) / n
            x = s * (0.02 + 0.40 * size * t)
            z = 3.705 - 0.15 * size * t ** 2.2
            c = K.march_to(f, np.array([x, -1.7, z]), (0, 1, 0))
            nn = SD.normals(f, c[None])[0]
            r = (0.075 + 0.025 * math.sin(t * math.pi)) * size
            terms.append(SD.ellipsoid(c + nn * r * 0.35, (r * 1.1, r * 0.75, r * 0.95)))
    g = SD.smooth_union(0.035, *terms)
    lo, hi = np.array([-0.75, -1.2, 3.2]), np.array([0.75, -0.3, 4.0])
    p = K.sdf_part(g, lo, hi, K.hq(0.0085), K.tq(520, 60), mat, 'stache')
    p.rigid('head')
    x, z = p.V[:, 0], p.V[:, 2]
    ax = np.clip(np.abs(x) / (0.42 * size), 0, 1)
    d = np.zeros_like(p.V)
    d[:, 2] = 0.075 * ax ** 1.6
    d[:, 0] = np.sign(x) * 0.02 * ax
    p.sk['smile'] = d.copy()
    p.sk['grin'] = d * 1.25
    p.sk['frown'] = -d * 0.9
    sr = G.smoothstep(0.05, -0.12, x)
    p.sk['smirk'] = d * sr[:, None] * 1.3
    up = np.zeros_like(p.V)
    up[:, 2] = 0.035 + 0.03 * (1 - ax)
    up[:, 1] = -0.02
    p.sk['mouth_open'] = up
    puff = np.zeros_like(p.V)
    puff[:, 1] = -0.03
    puff[:, 0] = np.sign(x) * 0.04 * ax
    p.sk['cheeks_puff'] = puff
    head.parts.append(p)
    return p


def tusk_pair(ctx, head, geo, length=0.62, r=0.055, broken=False, mat='teeth'):
    out = []
    for s in (1, -1):
        top = K.march_to(geo.f, np.array([s * 0.13, -1.7, 3.60]), (0, 1, 0)) + np.array([0, 0.07, 0.02])
        L = length * (0.42 if (broken and s < 0) else 1.0)
        ctrl = [top, top + np.array([s * 0.015, -0.035, -L * 0.5]), top + np.array([-s * 0.01, 0.05, -L])]
        tip = r * (0.75 if (broken and s < 0) else 0.32)
        out.append(K.horn(ctrl, r, tip, mat=mat, name='tusk'))
    head.parts += out
    return out


def bristles(ctx, head, geo, mat='mask'):
    if K.LOD > 0:
        return []
    out = []
    for s in (1, -1):
        for dx, dz in ((0.10, 0.07), (0.19, 0.07), (0.27, 0.03), (0.14, 0.00), (0.23, -0.01), (0.31, -0.04)):
            c = K.march_to(geo.f, np.array([s * dx, -1.7, 3.76 + dz]), (0, 1, 0))
            nn = SD.normals(geo.f, c[None])[0]
            g = SD.ellipsoid(c, (0.017, 0.017, 0.008), R=G.zframe(nn))
            out.append(K.blob(g, c, 0.06, 16, mat, 'freckle', h=0.004))
    head.parts += out
    return out


def lashes(head, eyes, mat='mask', n=3):
    """Eyelashes on the outer half of each upper lid; blink / squint keys swing them with the lid edge."""
    out = []
    aw, ah = eyes.angles()
    mw, me = math.radians(5), math.radians(6)
    rest = ah - math.radians(2.5 + eyes.lid_drop)
    closed = -ah - math.radians(3)
    for s in (1, -1):
        piv, R = eyes.frame(s)
        k = np.clip(1.0 - (rest / (ah + me)) ** 2, 0.06, 1.0)
        azh = (aw + mw) * math.sqrt(k)
        terms = []
        for i in range(n):
            u = 0.42 + 0.55 * i / max(n - 1, 1)
            root = eyes.sph(piv, R, eyes.R + 0.03, s * u * azh, rest)
            d = R @ nrm(np.array([s * (0.45 + 0.5 * u), 0.85, 0.35]))
            L = 0.075 + 0.035 * u
            pts = [root - d * 0.01, root + d * L * 0.55 + R[:, 1] * 0.012, root + d * L + R[:, 0] * s * 0.02]
            terms.append(SD.ptube(list(K.curve_pts(pts, 3)), np.linspace(0.016, 0.006, 7)))
        g = SD.union(*terms)
        c = eyes.sph(piv, R, eyes.R, 0, rest)
        V, F = MS.sdf_mesh(g, c - 0.35, c + 0.35, K.hq(0.004), tris=K.tq(130, 30))
        p = Part(V, F, mat, 'lashes')
        K.orient_outward(p)
        p.rigid('head')
        p.sk['blink'] = K.rot_points(p.V, piv, R[:, 0], np.full(p.n, rest - closed)) - p.V
        p.sk['squint'] = K.rot_points(p.V, piv, R[:, 0], np.full(p.n, math.radians(17))) - p.V
        out.append(p)
    head.parts += out
    return out


def pearls(ctx, head, mat='accessory_a', n=15, r=0.056):
    """A string of pearls round the collar (built in body space from the kit's joints, skinned like the collar, handed
    back in head design space)."""
    import cskel as SK
    import cbody as CB
    b = dict(SK.DEFAULT_BUILD)
    b.update(ctx.spec.get('build') or {})
    J = SK.joints_for(b, None)
    S = CB.scales(J)
    nr = (ctx.spec.get('body') or {}).get('neck_r', 1.0)
    neck = np.asarray(J['neck'], float)
    Kh = 1.08 * b.get('head', 1.0)
    terms = []
    for i in range(n):
        a = math.pi * (0.12 + 0.76 * i / (n - 1)) * 2 - math.pi      # front arc, -0.76pi .. 0.76pi round -y
        x = 0.31 * nr * math.sin(a)
        y = neck[1] - 0.33 * nr * math.cos(a)
        z = neck[2] + 0.17 * S['ts'] - 0.07 * max(math.cos(a), 0) ** 2
        terms.append(SD.sphere((x, y, z), r))
    g = SD.union(*terms)
    c = neck + np.array([0, -0.1, 0])
    V, F = MS.sdf_mesh(g, c - 0.6, c + 0.6, K.hq(0.007), tris=K.tq(420, 80))
    p = Part(V, F, mat, 'pearls')
    K.orient_outward(p)
    p.set_weights({'chest': np.full(p.n, 0.65), 'neck': np.full(p.n, 0.35)})
    p.V = K.HEAD_PIVOT + (p.V - np.asarray(J['head'], float)) / Kh
    head.parts.append(p)
    return p


def features(ctx, head, geo):
    o = ctx.opts
    bristles(ctx, head, geo)
    stache(ctx, head, geo, size=o.get('stache', 1.0))
    tusk_pair(ctx, head, geo, length=0.62 * o.get('tusks', 1.0), r=0.055 * (0.9 + 0.1 * o.get('tusks', 1.0)),
              broken=bool(o.get('broken')))
    if o.get('lady'):
        lashes(head, geo.eyes)
        pearls(ctx, head)
    if ctx.acc.get('hair') == 'mustache':
        ctx.acc['hair'] = None              # he already has the big one


def build(ctx):
    return M.build(ctx, params(ctx), features)

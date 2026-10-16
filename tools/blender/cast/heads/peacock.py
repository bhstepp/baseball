# peacock.py - a peacock: a small proud royal-blue head on a long neck, a white teardrop under each eye, a
# short horn-coloured bill, a crest of quills with teal spatula tips springing out of the top of the cap (it rides on
# the cap bone) and - for the boss, Cornelius "Halo" Vane - heavy smug lids, one cocked brow and the TRAIN: a tall
# arch of bronze-green feathers fanned behind him from the rump, each ending in an eye (gold, teal, blue, a navy
# heart), so from home plate the fan frames him like a halo (or a cathedral window). The train is hung on the body
# frame from the head module (spec tail 'none'): rigid to the hips near the root with a little tail.1 follow-through
# further out, leaned back so it clears the head; seen edge-on it 'folds' when he turns side-on in the windup.
# Head options: brow_stripe, skin_tris, crest (size), train (dict: n, n_in, length, side, spread, lean, eye, rise, back) or False, lid, pupil,
# cocked (brow lift), smirk / smile (baked into the rest pose: his resting smugness), beak.
import math
import numpy as np
from heads import fam_bird as B
from heads import _park6 as P6
import hkit as K
import rk_sdf as SD
import rk_geo as G
import rk_mesh as MS
from rk_geo import Part

FAMILY = 'bird'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'bird',
    'tail': 'none',
    'build': 'tall',
    'build_over': {'neck': 1.5},
    'colors': {'beak': '#D9C08C', 'fur_dark': '#178C84', 'feather_accent': '#E0B04A', 'shell': '#3F7E3C',
               'skin': '#7FC4A8'},
    'body_over': {'hand_mat': 'feather', 'neck_r': 0.9},
}


def stripes(brow_stripe=False):
    """White face markings: a teardrop patch beneath each eye sweeping back toward the ear (and optionally a slim
    stripe above the eye, behind the brow)."""
    def make(geo):
        e = geo.P['eye']
        cy = geo.P['cran']['c'][1]

        def f(P):
            P = np.asarray(P, float)
            x, y, z = np.abs(P[..., 0]), P[..., 1], P[..., 2]
            th = np.arctan2(x, -(y - cy))
            the = math.atan2(e['x'], 0.55)
            t = np.clip((th - the) / 0.9, -0.3, 1.0)
            tp = np.clip(t, 0, 1)
            # above the eye: a slim brush stroke from over the eye's outer half sweeping back
            up = np.abs(z - (e['z'] + 0.20 - 0.07 * t)) - (0.034 * (1 - 0.6 * tp) + 0.006)
            up = np.maximum(up, np.maximum(-(t - 0.30) * 0.5, t - 0.95))
            # under the eye: a teardrop patch, fat under the eye, tapering back toward the ear
            lo = np.abs(z - (e['z'] - 0.235 + 0.05 * t)) - (0.070 * (1 - 0.75 * tp) ** 1.2 + 0.006)
            lo = np.maximum(lo, np.maximum(-(t + 0.10) * 0.5, t - 0.85))
            marks = np.minimum(up, lo) if brow_stripe else lo
            return np.maximum(marks, -(y - cy + 0.9))
        return f
    return make


def params(ctx):
    o = ctx.opts
    fr = P6.Frame(ctx.spec)
    zb = fr.collar_design_z() - 0.16
    a = np.array([0.0, 0.12, 3.64])
    b = np.array([0.0, 0.06, zb])
    neck_f, _ = P6.curve_tube([a, (a + b) / 2 + np.array([0, -0.05, 0]), b], [0.19, 0.18, 0.19], 5)
    bs = o.get('beak', 1.0)
    return dict(
        cran=dict(c=(0.0, 0.07, 4.16), r=(0.53, 0.56, 0.58)),
        face=dict(c=(0.0, -0.14, 4.10), r=(0.43, 0.37, 0.35), k=0.16),
        cheek=dict(c=(0.25, -0.12, 3.90), r=(0.27, 0.29, 0.26), k=0.15),
        chin=dict(c=(0.0, -0.24, 3.72), r=(0.21, 0.25, 0.15), k=0.12),
        neck=dict(a=(0.0, 0.12, 3.66), b=(0.0, 0.12, 3.40), r=0.19, k=0.12),
        nape=dict(c=(0.0, 0.22, 3.82), r=(0.29, 0.28, 0.25), k=0.14),
        extra=[(0.10, neck_f)],
        eye=dict(x=0.205, z=4.20, axis=(0.22, -1.0, 0.03), W=0.135, H=0.19, lid_drop=o.get('lid', 0.0),
                 pupil=tuple(np.array((10.0, 14.5)) * o.get('pupil', 1.0))),
        beak=dict(z=3.94, len=0.34 * bs, w=0.15 * bs ** 0.5, h=0.135 * bs ** 0.5, droop=0.08, open=24.0),
        brow=dict(z=4.38, x0=0.06, x1=0.35, arch=0.10, thick=0.048, mat='mask', tilt=o.get('brow_tilt', 0.03)),
        regions=[('fur_light', stripes(o.get('brow_stripe', False)))],
        skin_tris=o.get('skin_tris', 2300),
    )


def crest(ctx, head, geo, size=1.0, n=7):
    """Quills fanned up out of the cap crown, teal spatula tips with a blue heart (rigid to the cap)."""
    cr = geo.P['cran']
    top = cr['c'][2] + cr['r'][2]
    base = np.array([0.0, cr['c'][1] - 0.02, top + 0.02])
    n = n if K.LOD == 0 else 5
    out = []
    for i in range(n):
        a = (i / (n - 1) - 0.5) * 2                       # -1 .. 1
        ang = a * math.radians(38)
        ln = (0.52 - 0.10 * abs(a)) * size
        d = np.array([math.sin(ang), 0.10 + 0.12 * (1 - abs(a)), math.cos(ang)])
        d = d / np.linalg.norm(d)
        tip = base + np.array([a * 0.05, 0.0, 0.0]) + d * ln
        out += P6.quill(base + np.array([a * 0.05, 0.0, -0.08]), tip, r0=0.015, tip_r=(0.065, 0.022, 0.09), mat='feather',
                        tip_mat='fur_dark', bone='cap', name='crest', bend=0.02 * a)
        R = G.frame_from(P6.nrm(tip - base), (0, -1, 0))
        c = tip - P6.nrm(tip - base) * 0.012 + np.array([0, -0.012, 0])
        g = SD.ellipsoid(c, (0.032, 0.025, 0.045), R=np.stack([R[:, 0], R[:, 2], R[:, 1]], 1))
        out.append(K.blob(g, c, 0.1, 30, 'feather', 'crest_eye', bone='cap', h=0.005))
    head.parts += out
    return out


def eye_disc(c, R, rx, ry, th, lod, segs=10):
    """One train eye: a lens in the feather plane (R columns: across, the plane normal toward the front, along the
    feather), its front face banded in exact concentric rings - a navy heart, blue, teal, a gold rim - and a plain
    shallow back (built directly: crisp rings for few triangles)."""
    segs = segs if lod == 0 else 6
    ks = [0.28, 0.50, 0.72, 1.0] if lod == 0 else [0.45, 1.0]
    mats = ['mask', 'feather', 'fur_dark', 'feather_accent'] if lod == 0 else ['feather', 'feather_accent']
    c = np.asarray(c, float)
    ax, nz, az = R[:, 0], R[:, 1], R[:, 2]
    V = [c + nz * th]
    for k in ks:
        hgt = th * math.sqrt(max(1 - k * k, 0.0)) * 0.9
        for i in range(segs):
            a = 2 * math.pi * i / segs
            V.append(c + ax * math.cos(a) * rx * k + az * math.sin(a) * ry * k + nz * hgt)
    V.append(c - nz * th * 0.6)
    F, M = [], []
    for i in range(segs):                       # heart fan
        F.append([0, 1 + i, 1 + (i + 1) % segs])
        M.append(mats[0])
    for r in range(len(ks) - 1):                # bands
        a0, b0 = 1 + r * segs, 1 + (r + 1) * segs
        for i in range(segs):
            j = (i + 1) % segs
            F.append([a0 + i, b0 + i, b0 + j, a0 + j])
            M.append(mats[r + 1])
    back = len(V) - 1
    rim = 1 + (len(ks) - 1) * segs
    for i in range(segs):                       # plain back
        F.append([back, rim + (i + 1) % segs, rim + i])
        M.append('shell')
    p = Part(np.array(V), F, M, 'train_eye')
    K.orient_outward(p)
    return p


def vane(path, w, nrm_, mat, lod):
    p = G.sweep(path, None, 4 if lod == 0 else 3, mat, up=nrm_, rx=w, ry=np.full(len(path), 0.016), name='train')
    K.orient_outward(p)
    return p


def train(ctx, head, opt):
    """The fanned train (world space on the body frame -> head design space, body mesh): two rows of overlapping
    vanes radiating from a point behind the small of the back, each ending in an eye; the outer row arcs round his
    head and shoulders (the halo), the shorter inner row sits in front of it; a bundle of stem feathers joins the fan
    to the rump (seen from behind and from the side)."""
    fr = P6.Frame(ctx.spec)
    lod = K.LOD
    L = opt.get('length', 3.0)
    side_len = opt.get('side', 0.8)
    spread = math.radians(opt.get('spread', 68))
    lean = math.radians(opt.get('lean', 14))
    er = opt.get('eye', 0.22)
    n_out = opt.get('n', 13) if lod == 0 else 9
    n_in = opt.get('n_in', 9) if lod == 0 else 5
    spine = fr.j('spine')
    # the back surface at the fan centre's height
    zc = spine[2] + opt.get('rise', 0.30)
    q = np.array([0.0, 2.5, zc])
    for _ in range(300):
        v = fr.f(q[None])[0]
        if v < 0.01:
            break
        q[1] -= max(v, 0.005)
    C = np.array([0.0, q[1] + opt.get('back', 0.42), zc])
    up = np.array([0.0, math.sin(lean), math.cos(lean)])          # the fan plane leans back
    xax = np.array([1.0, 0.0, 0.0])
    nrm_ = np.cross(xax, up)                                      # plane normal, toward the front (-y)
    parts = []

    def feather(a, ln, e_r, depth, mat, eye=True):
        ang = a * spread
        d = up * math.cos(ang) + xax * math.sin(ang)
        m = 7 if lod == 0 else 4
        ts = np.linspace(0.12, 1.0, m)
        tip = C + d * ln + nrm_ * depth
        path = np.array([C + d * ln * t + nrm_ * depth - nrm_ * 0.10 * (1 - t) ** 2 for t in ts])
        path[-1] = tip - d * e_r * 0.55
        w = 0.035 + (e_r * 0.95) * np.clip((ts - 0.12) / 0.80, 0, 1) ** 1.3
        out = [vane(path, w, nrm_, mat, lod)]
        if eye:
            side = np.cross(nrm_, d)
            R = np.stack([side, nrm_, d], 1)
            out.append(eye_disc(tip - d * e_r * 0.2 + nrm_ * 0.022, R, e_r * 0.86, e_r, 0.03, lod))
        return out
    for i in range(n_out):                                        # the outer row (the halo)
        a = (i / (n_out - 1) - 0.5) * 2
        ln = L * (side_len + (1 - side_len) * math.cos(a * math.pi / 2) ** 1.2)
        parts += feather(a, ln, er, 0.03 * (i % 2), 'shell')
    for i in range(n_in):                                         # the inner row, in front
        a = (i / (n_in - 1) - 0.5) * 2 * 0.88
        ln = L * 0.64 * (0.86 + 0.14 * math.cos(a * math.pi / 2))
        parts += feather(a, ln, er * 0.86, 0.10 + 0.03 * (i % 2), 'skin')
    # stem feathers from the rump up to the fan centre
    R0 = fr.j('tail.1') + np.array([0.0, 0.06, 0.04])
    for k in range(5 if lod == 0 else 3):
        a = (k / (4 if lod == 0 else 2) - 0.5) * 2
        end = C + xax * a * 0.35 + up * 0.25
        path = np.array([R0 + (end - R0) * t + xax * a * 0.05 * math.sin(t * math.pi) for t in np.linspace(0, 1, 5)])
        w = 0.07 + 0.06 * np.linspace(0, 1, 5)
        parts.append(vane(path, w, P6.nrm(np.cross(xax, end - R0)), 'shell' if k % 2 == 0 else 'feather_accent', lod))
    out = []
    for p in parts:
        dist = np.linalg.norm(p.V - C, axis=1)
        wt = G.smoothstep(0.5, 3.0, dist) * 0.3
        p.set_weights({'hips': 1 - wt, 'tail.1': wt})
        out.append(fr.to_design(p))
    head.parts += out
    return out


def cock_brow(head, side=1, lift=0.045):
    """Raise one brow at rest (the smug cocked brow)."""
    for p in head.parts:
        if p.name == 'brow_' + ('L' if side > 0 else 'R'):
            x = np.abs(p.V[:, 0])
            p.V[:, 2] += lift * (0.6 + 0.4 * np.clip((x - 0.07) / 0.27, 0, 1))


def bake(head, key, amount):
    """Bake part of a face key into the rest pose (the boss's resting smirk); the keys stay deltas on top."""
    for p in head.parts:
        if key in p.sk:
            p.V = p.V + amount * p.sk[key]


def features(ctx, head, geo):
    o = ctx.opts
    crest(ctx, head, geo, size=o.get('crest', 1.0))
    if o.get('smirk'):
        bake(head, 'smirk', o['smirk'])
    if o.get('smile'):
        bake(head, 'smile', o['smile'])
    if o.get('cocked'):
        cock_brow(head, side=1, lift=0.045 * o.get('cocked', 1.0))
    tr = o.get('train', False)
    if tr:
        train(ctx, head, tr if isinstance(tr, dict) else {})
    P6.card_extras(ctx, head, geo)


def build(ctx):
    ctx.acc['freckles'] = 0
    return B.build(ctx, params(ctx), features)

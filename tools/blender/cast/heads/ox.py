# ox.py - broad heavy head, wide muzzle pad (light) with nostrils, sideways ears under long horns that sweep out and
# up, a curly forelock. The boss (Earl 'The Ox' Oxley): bigger horns, a heavy brow ridge and a mean resting glare,
# a brass nose ring and a beard.
import numpy as np
from heads import fam_mammal as M
import rk_sdf as SD

FAMILY = 'mammal'
HORNS = {
    'ox': ([(0.42, 0.05, 4.50), (0.74, 0.02, 4.57), (0.98, -0.04, 4.76), (1.06, -0.12, 5.02)], 0.12, 0.03, 0),
    'ox_boss': ([(0.44, 0.06, 4.50), (0.86, 0.03, 4.53), (1.20, -0.04, 4.72), (1.34, -0.14, 5.06), (1.33, -0.26, 5.24)], 0.16, 0.035, 0),
}


def params(ctx):
    o = ctx.opts
    boss = bool(o.get('boss'))
    w = 1.06 if boss else 1.0
    P = dict(
        cran=dict(c=(0.0, 0.08, 4.13), r=(0.66 * w, 0.56, 0.58)),
        face=dict(c=(0.0, -0.16, 4.15), r=(0.54 * w, 0.36, 0.30), k=0.16),
        jowl=dict(c=(0.30, -0.12, 3.74), r=(0.40 * w, 0.40, 0.36), k=0.17),
        snout=dict(a=(0.0, -0.26, 3.90), b=(0.0, -0.70, 3.80), ra=0.32 * w, rb=0.26 * w, sx=1.2, sz=0.9, k=0.12),
        muzzle=dict(c=(0.0, -0.80, 3.75), r=(0.36 * w, 0.22, 0.23), k=0.09),
        chin=dict(c=(0.0, -0.52, 3.52), r=(0.28 * w, 0.30, 0.15), k=0.10),
        eye=dict(x=0.20 * w, z=4.21, axis=(0.16, -1.0, 0.03), W=0.122, H=0.178, lid_drop=7.0 if boss else 0.0,
                 pupil=(8.0, 12.0) if boss else (9.0, 13.5)),
        mouth=dict(z0=3.60, W=0.34 * w, curve=0.45, depth=0.62, jaw_back=0.72, key_scale=dict(frown=0.6)),
        nose=dict(kind='nostrils'),
        ear=dict(kind='cow', base=(0.53 * w, 0.06, 4.30), up=(1.0, 0.1, -0.30), fwd=(0.1, -1.0, 0.3), H=0.38, W=0.15,
                 T=0.04, cup=0.07, shape='leaf', mat='fur', inner='fur_light', slot=False, tris=180),
        brow=dict(z=4.42, x0=0.06, x1=0.38 * w, arch=0.03 if boss else 0.05, thick=0.075 if boss else 0.055,
                  tilt=0.07 if boss else 0.0),
        regions=[],
    )
    if boss:      # heavy brow ridge
        P['extra'] = [(0.08, SD.capsule((-0.30, -0.42, 4.39), (0.30, -0.42, 4.39), 0.10))]
    M.nostril_pad(P, pad_mat='fur_light', sep=0.26 * w, r=(0.045, 0.06, 0.032), pad=(0.37 * w, 0.24, 0.25))
    return P


def features(ctx, head, geo):
    o = ctx.opts
    ctrl, r0, r1, ridges = HORNS[o.get('horns', 'ox')]
    M.horn_pair(ctx, head, geo, ctrl, r0, r1, mat='horn', ridges=ridges, n=10)
    if o.get('tuft', True):
        M.hair_tuft(ctx, head, geo, (0.0, -0.46, 4.46), n=4, size=0.07, spread=0.11, mat='fur_dark', up=(0, -0.8, 0.6), seed=ctx.spec.get('seed', 0) & 0xFFFF)
    if ctx.acc.get('nose_ring'):
        mz = geo.P['muzzle']
        c = np.array([0.0, mz['c'][1] - mz['r'][1] + 0.02, mz['c'][2] - 0.02])
        import hkit as K
        K.nose_ring(head, c, r=0.10, mat='accessory_b')


def build(ctx):
    return M.build(ctx, params(ctx), features)

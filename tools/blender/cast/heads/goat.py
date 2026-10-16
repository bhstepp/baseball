# goat.py - long narrow face with a soft muzzle pad (pink nose, nostrils), sideways leaf ears, horns (swept /
# scimitar / spike: the two card goats must not look alike) and a goatee.
import numpy as np
from heads import fam_mammal as M

FAMILY = 'mammal'
HORNS = {   # left horn control points (design space), root radius, tip radius, ridge rings
    'swept': ([(0.19, 0.00, 4.60), (0.25, 0.10, 4.93), (0.31, 0.36, 5.12), (0.36, 0.66, 5.08)], 0.085, 0.022, 4),
    'scimitar': ([(0.17, 0.02, 4.60), (0.21, 0.10, 4.98), (0.24, 0.38, 5.30), (0.26, 0.78, 5.30), (0.27, 1.02, 5.10)], 0.08, 0.018, 6),
    'spike': ([(0.20, 0.00, 4.60), (0.26, 0.06, 4.92), (0.33, 0.16, 5.16)], 0.085, 0.022, 3),
}


def params(ctx):
    o = ctx.opts
    droop = o.get('ears_droop', 0.25)
    P = dict(
        cran=dict(c=(0.0, 0.08, 4.17), r=(0.56, 0.54, 0.60)),
        face=dict(c=(0.0, -0.17, 4.16), r=(0.44, 0.34, 0.30), k=0.16),
        jowl=dict(c=(0.24, -0.16, 3.78), r=(0.30, 0.36, 0.30), k=0.16),
        snout=dict(a=(0.0, -0.30, 3.92), b=(0.0, -0.80, 3.80), ra=0.25, rb=0.175, sx=0.95, sz=0.95, k=0.12),
        muzzle=dict(c=(0.0, -0.84, 3.76), r=(0.20, 0.17, 0.165), k=0.08),
        chin=dict(c=(0.0, -0.58, 3.58), r=(0.18, 0.24, 0.12), k=0.10),
        eye=dict(x=0.19, z=4.19, axis=(0.17, -1.0, 0.03), W=0.126, H=0.185),
        mouth=dict(z0=3.64, W=0.22, curve=0.7, depth=0.60, jaw_back=0.72, key_scale=dict(frown=0.6)),
        nose=dict(kind='nostrils'),
        ear=dict(kind='cow', base=(0.45, 0.02, 4.33), up=(1.0, 0.05, -0.15 - droop), fwd=(0.1, -1.0, 0.25), H=0.40, W=0.135,
                 T=0.035, cup=0.06, shape='leaf', mat='fur', inner='skin', slot=False, tris=180),
        brow=dict(z=4.44, x0=0.07, x1=0.33, arch=0.06, thick=0.045),
        regions=[('fur_light', M.region_lower_face(top_dz=-0.30, side_drop=0.10, back=-0.10))],
    )
    M.nostril_pad(P, pad_mat='nose', sep=0.17, r=(0.034, 0.05, 0.026))
    return P


def features(ctx, head, geo):
    o = ctx.opts
    kind = o.get('horns', 'swept')
    ctrl, r0, r1, ridges = HORNS[kind]
    L = o.get('horn_len', 1.0)
    root = np.asarray(ctrl[0], float)
    ctrl = [root + (np.asarray(c, float) - root) * L for c in ctrl]
    M.horn_pair(ctx, head, geo, ctrl, r0, r1, mat='horn', ridges=ridges)
    beard = o.get('beard', 0.35)
    if beard and ctx.acc.get('hair') != 'beard':
        M.goatee(ctx, head, geo, length=beard, width=0.07 + 0.08 * beard, mat='fur_light' if o.get('beard_mat') is None else o['beard_mat'])


def build(ctx):
    return M.build(ctx, params(ctx), features)

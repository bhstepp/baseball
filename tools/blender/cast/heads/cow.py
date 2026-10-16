# cow.py - like the ox but softer: rounded head, a wide pink muzzle, horn nubs, sideways ears, seeded spots.
import numpy as np
from heads import fam_mammal as M

FAMILY = 'mammal'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'mammal',
    'tail': 'tufted',
    'build': 'stout',
    'colors': {'horn': '#F2E8D2', 'nose': '#E8A9A0', 'skin': '#F2B4B0'},
    'body_over': {'tail_tip_mat': 'fur_dark'},
}


def params(ctx):
    rng = np.random.default_rng(int(ctx.spec.get('seed', 3)) & 0xFFFFFFFF)
    P = dict(
        cran=dict(c=(0.0, 0.08, 4.14), r=(0.62, 0.56, 0.60)),
        face=dict(c=(0.0, -0.16, 4.15), r=(0.50, 0.36, 0.30), k=0.16),
        jowl=dict(c=(0.28, -0.12, 3.74), r=(0.38, 0.40, 0.35), k=0.17),
        snout=dict(a=(0.0, -0.26, 3.90), b=(0.0, -0.70, 3.80), ra=0.30, rb=0.25, sx=1.18, sz=0.9, k=0.12),
        muzzle=dict(c=(0.0, -0.80, 3.74), r=(0.34, 0.22, 0.23), k=0.09),
        chin=dict(c=(0.0, -0.52, 3.53), r=(0.26, 0.30, 0.14), k=0.10),
        eye=dict(x=0.20, z=4.21, axis=(0.16, -1.0, 0.03), W=0.13, H=0.19),
        mouth=dict(z0=3.60, W=0.32, curve=0.45, depth=0.62, jaw_back=0.72, key_scale=dict(frown=0.6)),
        nose=dict(kind='nostrils'),
        ear=dict(kind='cow', base=(0.52, 0.06, 4.33), up=(1.0, 0.08, -0.28), fwd=(0.1, -1.0, 0.3), H=0.40, W=0.16,
                 T=0.04, cup=0.07, shape='leaf', mat='fur', inner='skin', slot=False, tris=180),
        brow=dict(z=4.44, x0=0.07, x1=0.36, arch=0.06, thick=0.05),
        regions=[],
    )
    if ctx.opts.get('spots'):
        P['regions'] = [('fur_dark', M.region_spots(rng, n=4))]
    M.nostril_pad(P, pad_mat='fur_light', sep=0.25, r=(0.042, 0.055, 0.03), pad=(0.35, 0.24, 0.25))
    return P


def features(ctx, head, geo):
    ctrl = [(0.30, 0.02, 4.60), (0.37, 0.0, 4.78), (0.42, -0.04, 4.86)]
    M.horn_pair(ctx, head, geo, ctrl, 0.075, 0.035, mat='horn')


def build(ctx):
    return M.build(ctx, params(ctx), features)

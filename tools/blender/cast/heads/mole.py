# mole.py - the umpire: round velvety head, a long pointed snout ending in a big pink nose, small eyes behind round
# glasses, tiny ears hidden in the fur, a few whiskers.
import numpy as np
from heads import fam_mammal as M

FAMILY = 'mammal'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'mammal',
    'tail': 'thin',
    'build': 'round',
    'colors': {'nose': '#F29AA6', 'skin': '#F2B4B4'},
    'body_over': {'hand_mat': 'skin', 'tail_mat': 'skin'},
}


def params(ctx):
    P = dict(
        cran=dict(c=(0.0, 0.10, 4.12), r=(0.62, 0.58, 0.60)),
        face=dict(c=(0.0, -0.16, 4.10), r=(0.50, 0.36, 0.30), k=0.18),
        jowl=dict(c=(0.28, -0.08, 3.74), r=(0.38, 0.40, 0.36), k=0.18),
        snout=dict(a=(0.0, -0.30, 3.90), b=(0.0, -0.86, 3.86), ra=0.25, rb=0.11, sx=1.0, sz=0.9, k=0.12),
        chin=dict(c=(0.0, -0.44, 3.60), r=(0.20, 0.26, 0.13), k=0.10),
        eye=dict(x=0.19, z=4.19, axis=(0.15, -1.0, 0.03), W=0.10, H=0.13, R=0.36, pupil=(10.0, 13.0)),
        mouth=dict(z0=3.70, W=0.22, curve=0.7, depth=0.56, jaw_back=0.68),
        nose=dict(kind='bulb', z=3.88, r=(0.13, 0.11, 0.11), mat='nose'),
        ear=dict(kind='tiny', base=(0.52, 0.12, 4.20), up=(1.0, 0.1, 0.25), fwd=(0.35, -1.0, 0.0), H=0.12, W=0.09,
                 T=0.03, cup=0.04, shape='round', mat='fur', inner='skin', slot=False, tris=80),
        brow=dict(z=4.43, x0=0.06, x1=0.32, arch=0.07, thick=0.05),
        regions=[('fur_light', M.region_lower_face(top_dz=-0.22, side_drop=0.18, back=0.0))],
    )
    return P


def features(ctx, head, geo):
    M.whiskers(ctx, head, geo, n=3, length=0.34, mat='mask')


def build(ctx):
    return M.build(ctx, params(ctx), features)

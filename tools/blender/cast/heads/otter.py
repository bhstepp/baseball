# otter.py - round head, small round ears, a flat broad light muzzle with a dark button nose and whiskers.
import numpy as np
from heads import fam_mammal as M

FAMILY = 'mammal'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'mammal',
    'tail': 'thick',
    'build': 'average',
    'build_over': {'leg': 0.9, 'torso': 1.08},
    'colors': {'nose': '#1B1420'},
}


def params(ctx):
    return dict(
        cran=dict(c=(0.0, 0.08, 4.12), r=(0.62, 0.58, 0.58)),
        face=dict(c=(0.0, -0.17, 4.12), r=(0.50, 0.36, 0.30), k=0.17),
        jowl=dict(c=(0.30, -0.12, 3.74), r=(0.40, 0.40, 0.36), k=0.18),
        snout=dict(a=(0.0, -0.28, 3.86), b=(0.0, -0.64, 3.84), ra=0.30, rb=0.24, sx=1.3, sz=0.8, k=0.12),
        chin=dict(c=(0.0, -0.44, 3.58), r=(0.24, 0.28, 0.14), k=0.10),
        eye=dict(x=0.19, z=4.17, axis=(0.14, -1.0, 0.03)),
        mouth=dict(z0=3.68, W=0.30, curve=0.55, depth=0.56, jaw_back=0.68),
        nose=dict(kind='button', z=3.93, r=(0.12, 0.085, 0.08)),
        ear=dict(kind='tiny', base=(0.50, 0.10, 4.42), up=(1.0, 0.1, 0.55), fwd=(0.3, -1.0, 0.0), H=0.17, W=0.12,
                 T=0.035, cup=0.05, shape='round', mat='fur', inner='fur_dark', slot=False, tris=110),
        regions=[('fur_light', M.region_lower_face(top_dz=-0.24, side_drop=0.18, back=0.02))],
    )


def features(ctx, head, geo):
    M.whiskers(ctx, head, geo, n=3, length=0.36, mat='fur_light')


def build(ctx):
    return M.build(ctx, params(ctx), features)

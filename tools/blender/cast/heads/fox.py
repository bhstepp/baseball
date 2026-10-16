# fox.py - pointed snout, big pointed ears with dark backs and white insides, white cheeks and muzzle sweeping out
# to cheek points (card marking 'cheeks').
import numpy as np
from heads import fam_mammal as M
import rk_sdf as SD

FAMILY = 'mammal'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'mammal',
    'tail': 'bushy',
    'build': 'lanky',
    'colors': {'nose': '#1B1420'},
    'body_over': {'tail_tip_mat': 'fur_light'},
}


def params(ctx):
    cheek_pts = SD.union(SD.round_cone((0.40, -0.10, 3.80), (0.66, 0.02, 3.66), 0.13, 0.04),
                         SD.round_cone((-0.40, -0.10, 3.80), (-0.66, 0.02, 3.66), 0.13, 0.04))
    return dict(
        cran=dict(c=(0.0, 0.08, 4.14), r=(0.58, 0.55, 0.58)),
        face=dict(c=(0.0, -0.17, 4.13), r=(0.48, 0.36, 0.28), k=0.16),
        jowl=dict(c=(0.28, -0.12, 3.76), r=(0.36, 0.38, 0.32), k=0.17),
        snout=dict(a=(0.0, -0.28, 3.90), b=(0.0, -0.92, 3.84), ra=0.26, rb=0.11, sx=1.0, sz=0.9, k=0.12),
        chin=dict(c=(0.0, -0.50, 3.62), r=(0.18, 0.30, 0.12), k=0.10),
        extra=[(0.08, cheek_pts)],
        eye=dict(x=0.19, z=4.18, axis=(0.15, -1.0, 0.03), W=0.125, H=0.19),
        mouth=dict(z0=3.71, W=0.26, curve=0.7, depth=0.62, jaw_back=0.72),
        nose=dict(kind='button', z=3.88, r=(0.10, 0.075, 0.07)),
        ear=dict(kind='point', base=(0.34, 0.06, 4.62), up=(0.40, 0.08, 1.0), fwd=(0.30, -1.0, 0.0), H=0.55, W=0.22,
                 T=0.045, cup=0.10, shape='tri', mat='fur_dark', inner='fur_light', slot=True, tris=220),
        regions=[('fur_light', M.region_lower_face(top_dz=-0.20, side_drop=0.30, back=0.0,
                                                   extra=lambda geo: (lambda P: cheek_pts(P) - 0.03)))],
    )


def features(ctx, head, geo):
    pass


def build(ctx):
    return M.build(ctx, params(ctx), features)

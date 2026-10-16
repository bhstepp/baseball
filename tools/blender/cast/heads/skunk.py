# skunk.py - a black head with the white stripe from the bridge of the nose over the crown, small round ears, a
# pink nose, a huge bushy tail with its own white stripe.
import numpy as np
from heads import fam_mammal as M

FAMILY = 'mammal'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'mammal',
    'tail': 'bushy',
    'build': 'average',
    'colors': {'nose': '#F29EA6', 'skin': '#F2A8B0'},
    'body_over': {'tail_size': 1.2, 'tail_stripe_mat': 'fur_light'},
}


def params(ctx):
    return dict(
        cran=dict(c=(0.0, 0.08, 4.14), r=(0.58, 0.55, 0.57)),
        face=dict(c=(0.0, -0.16, 4.10), r=(0.46, 0.36, 0.30), k=0.16),
        jowl=dict(c=(0.28, -0.12, 3.78), r=(0.36, 0.38, 0.33), k=0.18),
        snout=dict(a=(0.0, -0.30, 3.90), b=(0.0, -0.74, 3.84), ra=0.26, rb=0.15, sx=1.0, sz=0.86, k=0.12),
        chin=dict(c=(0.0, -0.46, 3.63), r=(0.18, 0.26, 0.11), k=0.10),
        eye=dict(x=0.20, z=4.16, axis=(0.16, -1.0, 0.03), W=0.13, H=0.19),
        mouth=dict(z0=3.72, W=0.24, curve=0.6, depth=0.58, jaw_back=0.70),
        nose=dict(kind='bulb', z=3.88, r=(0.09, 0.07, 0.07), mat='nose'),
        ear=dict(kind='round', base=(0.44, 0.12, 4.52), up=(0.7, 0.12, 1.0), fwd=(0.40, -1.0, 0.0), H=0.20, W=0.15,
                 T=0.035, cup=0.07, shape='round', mat='fur', inner='skin', slot=True, tris=130),
        brow=dict(z=4.40, x0=0.10, x1=0.34, arch=0.06, thick=0.045, mat='fur_light'),
        regions=[('fur_light', M.region_stripe(width=0.06, z_bot=3.95, back=0.9, width_back=0.18))],
    )


def features(ctx, head, geo):
    M.whiskers(ctx, head, geo, n=2, length=0.36, mat='fur_light', droop=0.05, spread=0.07, radius=0.006)


def build(ctx):
    return M.build(ctx, params(ctx), features)

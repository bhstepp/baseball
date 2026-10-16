# rat.py - city rat: a long pointed snout with a pink nose, big round pink-lined ears up through the cap, buck
# teeth, long whiskers, a thin naked pink tail. Head options: ears (size), snout (length), teeth (buck teeth on/off).
import numpy as np
from heads import fam_mammal as M

FAMILY = 'mammal'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'mammal',
    'tail': 'thin',
    'build': 'lanky',
    'colors': {'nose': '#F29EA6', 'skin': '#F2A8B0', 'teeth': '#F6EDD0'},
    'body_over': {'tail_mat': 'skin', 'hand_mat': 'skin'},
}


def params(ctx):
    o = ctx.opts
    snout = o.get('snout', 1.0)
    ears = o.get('ears', 1.0)
    return dict(
        cran=dict(c=(0.0, 0.10, 4.15), r=(0.55, 0.55, 0.57)),
        face=dict(c=(0.0, -0.15, 4.12), r=(0.44, 0.36, 0.29), k=0.16),
        jowl=dict(c=(0.24, -0.14, 3.78), r=(0.32, 0.38, 0.30), k=0.17),
        snout=dict(a=(0.0, -0.28, 3.93), b=(0.0, -0.96 - 0.14 * (snout - 1), 3.86), ra=0.26, rb=0.11, sx=1.0, sz=0.86, k=0.13),
        chin=dict(c=(0.0, -0.50, 3.64), r=(0.17, 0.28, 0.11), k=0.10),
        eye=dict(x=0.18, z=4.17, axis=(0.15, -1.0, 0.03), W=0.12, H=0.18),
        mouth=dict(z0=3.74, W=0.25, curve=0.6, depth=0.64, jaw_back=0.76),
        nose=dict(kind='bulb', z=3.87, r=(0.095, 0.08, 0.075), mat='nose'),
        ear=dict(kind='round', base=(0.36, 0.12, 4.58), up=(0.62, 0.12, 1.0), fwd=(0.45, -1.0, 0.0),
                 H=0.40 * ears, W=0.27 * ears, T=0.03, cup=0.10, shape='round', mat='fur', inner='skin', slot=True, tris=180),
        brow=dict(z=4.42, x0=0.07, x1=0.33, arch=0.06, thick=0.045),
        regions=[('fur_light', M.region_lower_face(top_dz=-0.20, side_drop=0.16, back=0.0))],
    )


def features(ctx, head, geo):
    if ctx.opts.get('teeth', True):
        M.buck_teeth(ctx, head, geo, w=0.04, h=0.07, sep=0.045)
    M.whiskers(ctx, head, geo, n=3, length=0.46, mat='mask', droop=0.04, spread=0.06, radius=0.007)


def build(ctx):
    return M.build(ctx, params(ctx), features)

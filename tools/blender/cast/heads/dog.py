# dog.py - hound: long snout with droopy flews, a big black nose, long hanging ears (darker), lighter muzzle;
# card markings 'patch' (a dark patch round one eye, seeded side) on the light-coated dogs.
import numpy as np
from heads import fam_mammal as M

FAMILY = 'mammal'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'mammal',
    'tail': 'dog',
    'build': 'average',
    'colors': {'nose': '#1B1420'},
}


def params(ctx):
    rng = np.random.default_rng(int(ctx.spec.get('seed', 7)) & 0xFFFFFFFF)
    o = ctx.opts
    snout = o.get('snout', 1.0)
    P = dict(
        cran=dict(c=(0.0, 0.08, 4.16), r=(0.60, 0.56, 0.60)),
        face=dict(c=(0.0, -0.17, 4.18), r=(0.48, 0.36, 0.28), k=0.16),
        jowl=dict(c=(0.25, -0.22, 3.68), r=(0.33, 0.42, 0.32), k=0.17),
        snout=dict(a=(0.0, -0.28, 3.86), b=(0.0, -0.86 - 0.12 * (snout - 1), 3.88), ra=0.28, rb=0.195, sx=0.95, sz=0.92, k=0.13),
        chin=dict(c=(0.0, -0.52, 3.57), r=(0.22, 0.30, 0.14), k=0.10),
        eye=dict(x=0.19, z=4.21, axis=(0.15, -1.0, 0.03), W=0.130, H=0.192),
        mouth=dict(z0=3.69, W=0.30, curve=0.55, depth=0.66, jaw_back=0.78),
        nose=dict(kind='big', z=3.95, r=(0.15, 0.105, 0.105)),
        ear=dict(kind='flop', base=(0.47, 0.06, 4.44), up=(0.30, 0.08, -1.0), fwd=(-1.0, -0.25, 0.0), H=0.70, W=0.20,
                 T=0.04, cup=0.05, droop=-0.06, shape='leaf', mat='fur_dark', inner=None, slot=False, tris=220),
        brow=dict(z=4.45, x0=0.07, x1=0.36, arch=0.06, thick=0.05),
        regions=[('fur_light', M.region_lower_face(top_dz=-0.21, side_drop=0.24, back=0.0))],
    )
    if ctx.opts.get('marking') == 'patch':
        side = 1 if rng.random() < 0.5 else -1
        P['regions'] = [('fur_dark', M.region_patch(side, (0.20, -0.45, 4.22), (0.24, 0.35, 0.22)))] + P['regions']
        P['eye']['lid'] = ('fur_dark', 'fur') if side > 0 else ('fur', 'fur_dark')
    return P


def features(ctx, head, geo):
    pass


def build(ctx):
    return M.build(ctx, params(ctx), features)

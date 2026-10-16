# deer.py - white-tailed deer: big leaf ears out to the sides, antler buttons (nubs) through the cap, a white muzzle
# and chin with a black button nose, fawn spots (card marking 'freck', seeded).
import numpy as np
from heads import fam_mammal as M
import rk_sdf as SD

FAMILY = 'mammal'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'mammal',
    'tail': 'stub',
    'build': 'lanky',
    'colors': {'nose': '#1B1420', 'horn': '#E8D8B8', 'skin': '#F2C8B8'},
    'body_over': {'tail_tip_mat': 'fur_light'},
}


def spots_region(rng, n=7):
    pts = []
    for i in range(n):
        s = 1 if i % 2 else -1
        pts.append((s * rng.uniform(0.30, 0.50), -0.32 + rng.uniform(-0.12, 0.12), rng.uniform(4.28, 4.55), rng.uniform(0.035, 0.05)))

    def make(geo):
        def f(P):
            P = np.asarray(P, float)
            d = np.full(P.shape[:-1], 1.0)
            for x, y, z, r in pts:
                d = np.minimum(d, SD.sphere((x, y, z), r)(P))
            return d
        return f
    return make


def params(ctx):
    rng = np.random.default_rng(int(ctx.spec.get('seed', 5)) & 0xFFFFFFFF)
    P = dict(
        cran=dict(c=(0.0, 0.08, 4.16), r=(0.56, 0.54, 0.57)),
        face=dict(c=(0.0, -0.15, 4.13), r=(0.44, 0.36, 0.30), k=0.16),
        jowl=dict(c=(0.24, -0.12, 3.80), r=(0.32, 0.38, 0.32), k=0.17),
        snout=dict(a=(0.0, -0.28, 3.94), b=(0.0, -0.82, 3.84), ra=0.26, rb=0.17, sx=0.95, sz=0.9, k=0.13),
        chin=dict(c=(0.0, -0.58, 3.62), r=(0.16, 0.26, 0.11), k=0.10),
        eye=dict(x=0.20, z=4.19, axis=(0.20, -1.0, 0.03), W=0.135, H=0.20),
        mouth=dict(z0=3.69, W=0.22, curve=0.7, depth=0.62, jaw_back=0.74),
        nose=dict(kind='button', z=3.90, r=(0.11, 0.08, 0.075)),
        ear=dict(kind='cow', base=(0.44, 0.10, 4.40), up=(1.0, 0.1, 0.45), fwd=(0.15, -1.0, 0.3), H=0.46, W=0.19,
                 T=0.035, cup=0.10, shape='leaf', mat='fur', inner='skin', slot=False, tris=200),
        brow=dict(z=4.44, x0=0.07, x1=0.33, arch=0.06, thick=0.045),
        regions=[('fur_light', M.region_muzzle(scale=1.15, dz=-0.02))],
    )
    if ctx.opts.get('spots', True):
        P['regions'] = [('fur_light', spots_region(rng))] + P['regions']
    return P


def features(ctx, head, geo):
    ctrl = [(0.20, 0.0, 4.62), (0.24, -0.02, 4.80), (0.26, -0.05, 4.88)]
    M.horn_pair(ctx, head, geo, ctrl, 0.055, 0.03, mat='horn')


def build(ctx):
    return M.build(ctx, params(ctx), features)

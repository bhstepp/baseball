# horse.py - long face ending in a big soft muzzle pad with nostrils, upright pointed ears through the cap, a mane
# down the back of the neck and a forelock under the brim; card marking 'blaze' (a white stripe down the face).
import numpy as np
from heads import fam_mammal as M

FAMILY = 'mammal'


def params(ctx):
    o = ctx.opts
    P = dict(
        cran=dict(c=(0.0, 0.10, 4.20), r=(0.54, 0.54, 0.58)),
        face=dict(c=(0.0, -0.14, 4.17), r=(0.44, 0.36, 0.32), k=0.16),
        jowl=dict(c=(0.25, -0.05, 3.80), r=(0.32, 0.40, 0.34), k=0.16),
        snout=dict(a=(0.0, -0.24, 4.02), b=(0.0, -0.98, 3.78), ra=0.29, rb=0.22, sx=0.95, sz=0.95, k=0.13),
        muzzle=dict(c=(0.0, -1.02, 3.75), r=(0.25, 0.22, 0.20), k=0.09),
        chin=dict(c=(0.0, -0.86, 3.47), r=(0.17, 0.22, 0.10), k=0.09),
        eye=dict(x=0.22, z=4.24, axis=(0.24, -1.0, 0.03), W=0.125, H=0.185),
        mouth=dict(z0=3.535, W=0.22, curve=0.5, depth=0.80, jaw_back=0.86, key_scale=dict(frown=0.6)),
        nose=dict(kind='nostrils'),
        ear=dict(kind='point', base=(0.27, 0.12, 4.68), up=(0.22, 0.12, 1.0), fwd=(0.25, -1.0, 0.0), H=0.40, W=0.15,
                 T=0.04, cup=0.09, shape='tri', mat='fur', inner='fur_dark', slot=True, tris=180),
        brow=dict(z=4.48, x0=0.07, x1=0.36, arch=0.05, thick=0.05),
        regions=[],
    )
    if o.get('blaze', True):
        P['regions'] = [('skin', M.region_blaze(z_top=4.75, z_bot=3.90, w_top=0.065, w_bot=0.14))]
    M.nostril_pad(P, pad_mat='fur_light', sep=0.22, r=(0.05, 0.06, 0.034), pad=(0.27, 0.24, 0.24))
    return P


def features(ctx, head, geo):
    if ctx.opts.get('mane', True):
        M.mane(ctx, head, geo, mat='fur_dark', n=8, z0=4.62, z1=3.20, width=0.085, height=0.17)
        M.hair_tuft(ctx, head, geo, (0.0, -0.36, 4.58), n=3, size=0.075, spread=0.08, mat='fur_dark', up=(0, -0.6, 0.4),
                    seed=ctx.spec.get('seed', 0) & 0xFFFF)


def build(ctx):
    return M.build(ctx, params(ctx), features)

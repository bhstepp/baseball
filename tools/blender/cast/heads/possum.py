# possum.py - opossum: a white face on a grey head, a long pointed snout with a pink nose, dark round naked ears,
# dark eye patches (seeded strength), whiskers, scruffy cheek fur. Head options (spec.head) give look-alike possums
# their own faces: snout (length), ears (size), droop (ear tilt), patches ('big' | 'small' | 'none'), scruff (tufts).
import numpy as np
from heads import fam_mammal as M

FAMILY = 'mammal'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'mammal',
    'tail': 'thin',
    'build': 'average',
    'colors': {'nose': '#F2A0A8', 'skin': '#F2B4B8', 'fur_dark': '#2E2A34'},
    'body_over': {'tail_mat': 'skin', 'hand_mat': 'fur_light'},
}


def params(ctx):
    o = ctx.opts
    rng = np.random.default_rng(int(ctx.spec.get('seed', 11)) & 0xFFFFFFFF)
    snout = o.get('snout', 1.0)
    ears = o.get('ears', 1.0)
    droop = o.get('droop', 0.0)
    tip = -0.98 - 0.16 * (snout - 1)
    P = dict(
        cran=dict(c=(0.0, 0.10, 4.15), r=(0.57, 0.55, 0.58)),
        face=dict(c=(0.0, -0.15, 4.13), r=(0.46, 0.36, 0.30), k=0.16),
        jowl=dict(c=(0.26, -0.12, 3.76), r=(0.34, 0.38, 0.32), k=0.17),
        snout=dict(a=(0.0, -0.28, 3.92), b=(0.0, tip, 3.84), ra=0.27, rb=0.105, sx=1.0, sz=0.86, k=0.13),
        chin=dict(c=(0.0, -0.52, 3.62), r=(0.18, 0.30, 0.11), k=0.10),
        eye=dict(x=0.19, z=4.17, axis=(0.15, -1.0, 0.03), W=0.125, H=0.18, lid='fur_light'),
        mouth=dict(z0=3.73, W=0.27, curve=0.6, depth=0.66, jaw_back=0.78),
        nose=dict(kind='bulb', z=3.86, r=(0.105, 0.085, 0.085), mat='nose'),
        ear=dict(kind='round', base=(0.40, 0.12, 4.56), up=(0.55 + droop, 0.10, 1.0), fwd=(0.40, -1.0, 0.0),
                 H=0.27 * ears, W=0.18 * ears, T=0.03, cup=0.07, shape='round', mat='fur_dark', inner='fur_dark',
                 slot=True, tris=150),
        brow=dict(z=4.42, x0=0.07, x1=0.34, arch=0.06, thick=0.045),
        skin_mat='fur',
        regions=[('fur_light', M.region_face_front(back=-0.10))],
    )
    patches = o.get('patches', 'small' if rng.random() < 0.5 else 'big')
    if patches != 'none':
        r = (0.22, 0.32, 0.20) if patches == 'big' else (0.16, 0.30, 0.15)
        P['regions'] = [('mask', M.region_eye_patches(r=r, dz=-0.01))] + P['regions']
        P['eye']['lid'] = 'mask'
    return P


def features(ctx, head, geo):
    o = ctx.opts
    M.whiskers(ctx, head, geo, n=2, length=0.40, mat='mask', droop=0.07, spread=0.08, radius=0.0065)
    if o.get('scruff', True):       # scruffy grey fur poking out at the cheeks
        seed = int(ctx.spec.get('seed', 0)) & 0xFFFF
        for s in (1, -1):
            M.hair_tuft(ctx, head, geo, (s * 0.50, 0.02, 3.86), n=3, size=0.075, spread=0.06, mat='fur',
                        up=(s * 1.0, 0.2, -0.25), seed=seed + (1 if s > 0 else 2))


def build(ctx):
    return M.build(ctx, params(ctx), features)

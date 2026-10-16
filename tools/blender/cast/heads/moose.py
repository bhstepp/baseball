# moose.py - long drooping muzzle, a dewlap, sideways ears and big palmated antlers through the cap (head-kit
# example for antlers; park 3's moose pitcher builds on it).
from heads import fam_mammal as M
import rk_sdf as SD

FAMILY = 'mammal'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'mammal',
    'tail': 'stub',
    'build': 'tall',
    'colors': {'horn': '#E8D2A8', 'nose': '#3A2620'},
}


def params(ctx):
    P = dict(
        cran=dict(c=(0.0, 0.10, 4.18), r=(0.56, 0.54, 0.58)),
        face=dict(c=(0.0, -0.14, 4.15), r=(0.44, 0.36, 0.32), k=0.16),
        jowl=dict(c=(0.25, -0.06, 3.80), r=(0.32, 0.40, 0.34), k=0.16),
        snout=dict(a=(0.0, -0.24, 4.00), b=(0.0, -0.96, 3.74), ra=0.30, rb=0.25, sx=1.0, sz=0.95, k=0.13),
        muzzle=dict(c=(0.0, -1.00, 3.70), r=(0.27, 0.24, 0.23), k=0.10),
        chin=dict(c=(0.0, -0.80, 3.47), r=(0.18, 0.24, 0.11), k=0.09),
        extra=[(0.06, SD.ellipsoid((0.0, -0.40, 3.30), (0.10, 0.10, 0.22)))],        # the bell (dewlap)
        eye=dict(x=0.22, z=4.24, axis=(0.24, -1.0, 0.03)),
        mouth=dict(z0=3.52, W=0.24, curve=0.5, depth=0.80, jaw_back=0.86, key_scale=dict(frown=0.6)),
        nose=dict(kind='nostrils'),
        ear=dict(kind='cow', base=(0.46, 0.08, 4.36), up=(1.0, 0.1, 0.1), fwd=(0.1, -1.0, 0.3), H=0.36, W=0.13,
                 T=0.04, cup=0.07, shape='leaf', mat='fur', inner='fur_light', slot=False, tris=160),
        regions=[],
    )
    M.nostril_pad(P, pad_mat='fur_light', sep=0.24, r=(0.05, 0.06, 0.034), pad=(0.29, 0.26, 0.25))
    return P


def features(ctx, head, geo):
    M.antler_pair(ctx, head, geo, palm=True)


def build(ctx):
    return M.build(ctx, params(ctx), features)

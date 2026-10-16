# moose.py - long drooping muzzle, a dewlap, sideways ears and big palmated antlers through the cap (head-kit
# example for antlers; park 3's moose pitcher builds on it).
import numpy as np
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


def palmate_antlers(ctx, head, geo, size=1.0, mat='horn'):
    """Moose antlers: a short beam out of the cap's sides into a broad flat palm with a row of tines on its rim."""
    import hkit as K
    import rk_geo as G
    from rk_geo import nrm
    k = size
    for s in (1, -1):
        mir = np.array([s, 1, 1])
        root = np.array([0.26, 0.10, 4.60]) * mir
        elbow = np.array([0.55, 0.14, 4.82]) * mir
        pc = np.array([0.88, 0.18, 4.98]) * mir                  # palm centre
        out_d = nrm(np.array([s * 1.0, 0.05, 0.55]))             # palm runs outward and up
        nrm_ = nrm(np.array([0.0, -0.55, 0.15]) + np.array([s * -0.15, 0, 0.6]))   # faces forward-up
        R = G.frame_from(out_d, nrm_)
        terms = [SD.capsule(root, elbow, 0.07 * k), SD.capsule(elbow, pc, 0.065 * k),
                 SD.ellipsoid(pc, (0.30 * k, 0.05 * k, 0.20 * k), R=np.stack([R[:, 1], R[:, 2], R[:, 0]], 1))]
        # tines along the upper / outer rim of the palm
        for i, t in enumerate(np.linspace(-0.9, 0.9, 5)):
            a = t * 1.1
            rim = pc + (out_d * np.cos(a) * 0.30 + R[:, 0] * 0 + np.array([0, 0, 1.0]) * np.sin(a + 1.2) * 0.18) * k
            tipd = nrm(rim - pc + np.array([0, 0, 0.12]))
            terms.append(SD.round_cone(rim - tipd * 0.04, rim + tipd * 0.16 * k, 0.04 * k, 0.012))
        f = SD.smooth_union(0.04, *terms)
        p = K.blob(f, pc, 0.9 * k, 420, mat, 'antler_' + ('L' if s > 0 else 'R'), h=0.009)
        head.parts.append(p)
        d = nrm(elbow - root)
        geo.slots.append((root + d * 0.05, d, 0.10))


def features(ctx, head, geo):
    palmate_antlers(ctx, head, geo, size=ctx.opts.get('antlers', 1.0))


def build(ctx):
    return M.build(ctx, params(ctx), features)

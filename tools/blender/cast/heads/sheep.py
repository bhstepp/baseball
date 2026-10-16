# sheep.py - a small soft face (fur_light) inside a cloud of wool (fur): wool cap round the skull (the ball cap sits
# on it), wool puffs on the cheeks and nape, sideways leaf ears with pink insides, pink nose pad.
import numpy as np
from heads import fam_mammal as M
import hkit as K
import rk_sdf as SD

FAMILY = 'mammal'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'mammal',
    'tail': 'stub',
    'build': 'round',
    'colors': {'nose': '#E8A9A0', 'skin': '#F2D8CC'},
}
WOOL_C = np.array([0.0, 0.14, 4.22])
WOOL_R = np.array([0.66, 0.62, 0.62])


def params(ctx):
    P = dict(
        cran=dict(c=(0.0, 0.10, 4.14), r=(0.52, 0.52, 0.56)),
        face=dict(c=(0.0, -0.14, 4.10), r=(0.40, 0.34, 0.34), k=0.16),
        jowl=dict(c=(0.22, -0.16, 3.78), r=(0.28, 0.32, 0.28), k=0.15),
        snout=dict(a=(0.0, -0.28, 3.90), b=(0.0, -0.66, 3.82), ra=0.24, rb=0.17, sx=1.0, sz=0.92, k=0.12),
        muzzle=dict(c=(0.0, -0.70, 3.78), r=(0.18, 0.15, 0.15), k=0.08),
        chin=dict(c=(0.0, -0.48, 3.60), r=(0.17, 0.22, 0.11), k=0.10),
        eye=dict(x=0.18, z=4.17, axis=(0.16, -1.0, 0.03), W=0.13, H=0.19, lid='fur_light'),
        mouth=dict(z0=3.66, W=0.20, curve=0.8, depth=0.56, jaw_back=0.68),
        nose=dict(kind='nostrils'),
        ear=dict(kind='cow', base=(0.47, 0.06, 4.24), up=(1.0, 0.0, -0.40), fwd=(0.1, -1.0, 0.25), H=0.36, W=0.13,
                 T=0.035, cup=0.06, shape='leaf', mat='fur_light', inner='skin', slot=False, tris=160),
        brow=dict(z=4.40, x0=0.06, x1=0.32, arch=0.05, thick=0.045),
        cap=dict(cranium=SD.ellipsoid(WOOL_C, WOOL_R * 0.98), cran_c=tuple(WOOL_C), cran_r=tuple(WOOL_R * 0.98)),
        skin_mat='fur_light',
        regions=[],
    )
    M.nostril_pad(P, pad_mat='nose', sep=0.15, r=(0.03, 0.045, 0.024))
    return P


def wool(ctx, head, geo):
    """The wool cloud: overlapping puffs over the skull, framing the face, and on the nape."""
    rng = np.random.default_rng(int(ctx.spec.get('seed', 5)) & 0xFFFFFFFF)
    terms = []
    # ring of puffs framing the face (forehead + cheeks), a dome over the skull and the nape
    for i in range(11):
        a = -1.2 + 2.4 * i / 10                     # angle round the face outline, radians from the top
        c = np.array([0.50 * np.sin(a), -0.18 + 0.12 * abs(np.sin(a)), 4.20 + 0.42 * np.cos(a)])
        terms.append(SD.sphere(c, 0.17 + rng.uniform(-0.02, 0.02)))
    for j in range(9):
        th = 2 * np.pi * j / 9
        c = WOOL_C + np.array([0.48 * np.sin(th), 0.40 * np.cos(th) + 0.06, 0.18 + rng.uniform(-0.05, 0.05)])
        terms.append(SD.sphere(c, 0.22 + rng.uniform(-0.03, 0.03)))
    terms.append(SD.ellipsoid(WOOL_C + np.array([0, 0.04, 0.12]), (0.52, 0.48, 0.42)))
    for s in (1, -1):
        terms.append(SD.sphere(np.array([0.34 * s, 0.40, 3.78]), 0.20))
    terms.append(SD.sphere(np.array([0.0, 0.48, 3.85]), 0.22))
    f = SD.union(*terms)
    face_keep = SD.ellipsoid(np.array([0.0, -0.62, 3.95]), (0.36, 0.44, 0.44))
    f = SD.smooth_sub(0.06, f, face_keep)
    p = K.blob(f, WOOL_C, 1.0, 1100, 'fur', 'wool', h=0.012)
    head.parts.append(p)
    return p


def features(ctx, head, geo):
    wool(ctx, head, geo)


def build(ctx):
    return M.build(ctx, params(ctx), features)

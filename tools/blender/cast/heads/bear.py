# bear.py - a big round head, small round ears up through the cap, a light muzzle with a big black nose. Head
# options: shaggy (spiky fur clumps round the cheeks and crown: the Sasquatch), small_cap (the cap perches on top of
# a giant head), mean (heavy brow and a squint).
import numpy as np
from heads import fam_mammal as M
import hkit as K
import rk_sdf as SD

FAMILY = 'mammal'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'mammal',
    'tail': 'stub',
    'build': 'stocky',
    'colors': {'nose': '#1B1420', 'skin': '#C89878'},
    'body_over': {'tail_len': 0.6},
}


def params(ctx):
    o = ctx.opts
    mean = o.get('mean', 0.0)
    P = dict(
        cran=dict(c=(0.0, 0.08, 4.14), r=(0.66, 0.60, 0.60)),
        face=dict(c=(0.0, -0.16, 4.10), r=(0.54, 0.38, 0.30), k=0.17),
        jowl=dict(c=(0.32, -0.12, 3.76), r=(0.42, 0.42, 0.38), k=0.18),
        snout=dict(a=(0.0, -0.28, 3.88), b=(0.0, -0.66, 3.84), ra=0.32, rb=0.24, sx=1.1, sz=0.85, k=0.12),
        chin=dict(c=(0.0, -0.46, 3.58), r=(0.24, 0.28, 0.13), k=0.10),
        eye=dict(x=0.21, z=4.17, axis=(0.15, -1.0, 0.03), W=0.115, H=0.165, lid_drop=6.0 * mean),
        mouth=dict(z0=3.68, W=0.32, curve=0.5, depth=0.58, jaw_back=0.70),
        nose=dict(kind='big', z=3.94, r=(0.17, 0.11, 0.11)),
        ear=dict(kind='round', base=(0.46, 0.12, 4.56), up=(0.6, 0.12, 1.0), fwd=(0.40, -1.0, 0.0), H=0.24, W=0.19,
                 T=0.04, cup=0.08, shape='round', mat='fur', inner='fur_light', slot=True, tris=160),
        brow=dict(z=4.42, x0=0.07, x1=0.36, arch=0.04 if mean else 0.06, thick=0.065 if mean else 0.05, tilt=0.06 * mean),
        regions=[('fur_light', M.region_muzzle(scale=1.10, dz=-0.03))],
    )
    if o.get('small_cap'):        # the cap perches on the crown of a giant head
        cc, cr = (0.0, 0.08, 4.56), (0.36, 0.34, 0.26)
        P['cap'] = dict(cranium=SD.ellipsoid(cc, cr), cran_c=cc, cran_r=cr, lift=0.0, brim=0.85)
        P['ear']['slot'] = False
        P['ear']['base'] = (0.52, 0.12, 4.46)
    return P


def shag(ctx, head, geo, n=16, size=0.11):
    """Spiky fur clumps round the face outline and the crown (the Sasquatch's shaggy silhouette)."""
    rng = np.random.default_rng(int(ctx.spec.get('seed', 3)) & 0xFFFF)
    terms = []
    cr = geo.P['cran']
    for i in range(n):
        a = -1.9 + 3.8 * i / (n - 1)                          # round the face from cheek to cheek over the top
        root = np.array([0.62 * np.sin(a), 0.02, cr['c'][2] - 0.25 + 0.55 * np.cos(a)])
        root = K.march_to(geo.f, root + np.array([np.sin(a) * 0.8, 0, np.cos(a) * 0.8]), (-np.sin(a), 0, -np.cos(a)))
        d = np.array([np.sin(a), 0.35, np.cos(a) * 0.8 - 0.2])
        d = d / np.linalg.norm(d)
        L = size * rng.uniform(1.4, 2.1)
        terms.append(SD.round_cone(root - d * 0.05, root + d * L, size * 0.55, 0.015))
    f = SD.smooth_union(0.04, *terms)
    p = K.blob(f, np.array([0, 0.0, cr['c'][2]]), 1.4, 900, 'fur', 'shag', h=0.012)
    head.parts.append(p)
    return p


def features(ctx, head, geo):
    if ctx.opts.get('shaggy'):
        shag(ctx, head, geo)


def build(ctx):
    return M.build(ctx, params(ctx), features)

# cat.py - alley cat: pointed ears with pink insides, a short muzzle with puffy whisker pads, a small pink nose,
# long whiskers, tabby stripes (an 'M' on the forehead, cheek bars) or a white tuxedo muzzle. Head options:
# coat ('tabby' | 'tuxedo'), ears (size), gap (a missing tooth - the card's 'gap' accessory).
import numpy as np
from heads import fam_mammal as M
import rk_sdf as SD

FAMILY = 'mammal'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'mammal',
    'tail': 'thin',
    'build': 'lanky',
    'colors': {'nose': '#F2A0A8', 'skin': '#F2B0B4'},
    'body_over': {'tail_len': 1.1},
}


def tabby_region():
    """Forehead 'M' stripes and two cheek bars (negative inside)."""
    def make(geo):
        e = geo.P['eye']

        def f(P):
            P = np.asarray(P, float)
            x, y, z = P[..., 0], P[..., 1], P[..., 2]
            front = y - (-0.05)
            d = np.full(x.shape, 1.0)
            for xc in (-0.12, 0.0, 0.12):                       # three forehead stripes
                d = np.minimum(d, np.maximum(np.abs(x - xc - 0.04 * (z - 4.45)) - 0.025, np.abs(z - 4.50) - 0.11))
            for s in (1, -1):                                   # cheek bars
                for dz in (0.0, -0.11):
                    d = np.minimum(d, np.maximum(np.abs(z - (e['z'] - 0.17 + dz) - 0.12 * (np.abs(x) - 0.35)) - 0.022,
                                                 np.maximum(0.33 - np.abs(x), np.abs(x) - 0.60)))
            return np.maximum(d, front)
        return f
    return make


def params(ctx):
    o = ctx.opts
    ears = o.get('ears', 1.0)
    coat = o.get('coat', 'tabby')
    pads = SD.union(SD.ellipsoid((0.11, -0.66, 3.80), (0.14, 0.12, 0.11)), SD.ellipsoid((-0.11, -0.66, 3.80), (0.14, 0.12, 0.11)))
    P = dict(
        cran=dict(c=(0.0, 0.08, 4.14), r=(0.60, 0.56, 0.56)),
        face=dict(c=(0.0, -0.16, 4.10), r=(0.50, 0.36, 0.30), k=0.16),
        jowl=dict(c=(0.30, -0.12, 3.80), r=(0.38, 0.38, 0.33), k=0.18),
        snout=dict(a=(0.0, -0.30, 3.90), b=(0.0, -0.60, 3.86), ra=0.24, rb=0.15, sx=1.05, sz=0.85, k=0.12),
        chin=dict(c=(0.0, -0.46, 3.64), r=(0.16, 0.24, 0.10), k=0.10),
        extra=[(0.05, pads)],
        eye=dict(x=0.20, z=4.15, axis=(0.15, -1.0, 0.03), W=0.135, H=0.19),
        mouth=dict(z0=3.71, W=0.24, curve=0.9, depth=0.56, jaw_back=0.68),
        nose=dict(kind='button', z=3.93, r=(0.08, 0.06, 0.05), mat='nose'),
        ear=dict(kind='point', base=(0.36, 0.08, 4.58), up=(0.48, 0.06, 1.0), fwd=(0.32, -1.0, 0.0), H=0.46 * ears,
                 W=0.21 * ears, T=0.04, cup=0.10, shape='tri', mat='fur', inner='skin', slot=True, tris=200),
        brow=dict(z=4.38, x0=0.08, x1=0.34, arch=0.06, thick=0.045),
        regions=[('fur_light', M.region_lower_face(top_dz=-0.20 if coat == 'tuxedo' else -0.26, side_drop=0.16, back=0.0))],
    )
    if coat == 'tabby':
        P['regions'] = [('fur_dark', tabby_region())] + P['regions']
    return P


def features(ctx, head, geo):
    M.whiskers(ctx, head, geo, n=3, length=0.50, mat='fur_light', droop=0.03, spread=0.05, radius=0.0065)


def build(ctx):
    return M.build(ctx, params(ctx), features)

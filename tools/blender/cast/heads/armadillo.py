# armadillo.py - nine-banded armadillo: a narrow head with a long tapering snout ending in a small pink nose, tall
# upright leathery ears (oval, pinkish inside), small eyes, and the head shield: a banded plate over the brow and down
# the bridge of the snout (shell colour with dark seams). The body wears the banded shell (gear ['shell'],
# body.shell_kind 'armadillo') and a ringed tail. Head options (spec.head): snout (length), ears (size), tilt
# (ear splay), plates (number of shield bands on the snout).
import numpy as np
import hkit as K
import rk_sdf as SD
import rk_geo as G
from heads import fam_mammal as M

FAMILY = 'mammal'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'mammal',
    'tail': 'lizard',
    'build': 'average',
    'colors': {'nose': '#E88A9A', 'skin': '#E8B4A8', 'shell': '#B08E72'},
    'body_over': {'hand_mat': 'fur_light', 'tail_mat': 'shell', 'tail_tip_mat': 'fur_dark', 'tail_len': 0.75,
                  'shell_kind': 'armadillo', 'tail_size': 0.75},
}


def params(ctx):
    o = ctx.opts
    sn = o.get('snout', 1.0)
    ears = o.get('ears', 1.0)
    tilt = o.get('tilt', 0.0)
    tip = -1.10 - 0.18 * (sn - 1)
    P = dict(
        cran=dict(c=(0.0, 0.10, 4.12), r=(0.55, 0.55, 0.56)),
        face=dict(c=(0.0, -0.14, 4.10), r=(0.44, 0.36, 0.28), k=0.15),
        jowl=dict(c=(0.26, -0.10, 3.74), r=(0.34, 0.38, 0.32), k=0.17),
        snout=dict(a=(0.0, -0.28, 3.98), b=(0.0, tip, 3.84), ra=0.25, rb=0.085, sx=0.95, sz=0.9, k=0.12),
        chin=dict(c=(0.0, -0.48, 3.62), r=(0.17, 0.30, 0.11), k=0.10),
        eye=dict(x=0.20, z=4.15, axis=(0.18, -1.0, 0.03), W=0.115, H=0.16, pupil=(10.0, 14.0)),
        mouth=dict(z0=3.74, W=0.24, curve=0.6, depth=0.70, jaw_back=0.80, teeth=None, tongue=False, key_scale=dict(frown=0.8)),
        nose=dict(kind='bulb', z=3.86, r=(0.085, 0.07, 0.07), mat='nose'),
        ear=dict(kind='big', base=(0.32, 0.18, 4.52), up=(0.22 + tilt, 0.05, 1.0), fwd=(0.30, -1.0, 0.0), H=0.56 * ears,
                 W=0.12 * ears, T=0.035, cup=0.07, shape='tri', mat='fur', inner='skin', slot=True, tris=190),
        brow=dict(z=4.42, x0=0.07, x1=0.33, arch=0.07, thick=0.045),
        regions=[],
    )
    n = int(o.get('plates', 4))
    tip_y = tip

    # head shield: the bridge of the snout and the brow between the eyes, banded
    def shield(geo):
        def f(Q):
            Q = np.asarray(Q, float)
            x, y, z = Q[..., 0], Q[..., 1], Q[..., 2]
            t = np.clip((y - (tip_y + 0.12)) / (0.2 - (tip_y + 0.12)), 0, 1)       # 0 at the nose end, 1 at the brow
            half = 0.08 + 0.22 * t ** 1.2
            zline = 3.875 + 0.26 * t
            return np.maximum(np.abs(x) - half, np.maximum(zline - z, np.maximum(y - 0.25, (tip_y + 0.12) - y)))
        return f

    def seams(geo):
        def f(Q):
            Q = np.asarray(Q, float)
            y = Q[..., 1]
            u = (y - (tip_y + 0.12)) / (0.25 - (tip_y + 0.12)) * n
            return np.abs(np.mod(u + 0.5, 1.0) - 0.5) * (0.25 - (tip_y + 0.12)) / n - 0.012
        return f
    P['regions'] = [('fur_dark', lambda geo: (lambda Q, a=shield(geo), b=seams(geo): np.maximum(a(Q), b(Q)))),
                    ('shell', shield),
                    ('fur_light', M.region_lower_face(top_dz=-0.24, side_drop=0.12, back=-0.05))]
    return P


def features(ctx, head, geo):
    M.whiskers(ctx, head, geo, n=2, length=0.22, mat='fur_dark', droop=0.05)


def build(ctx):
    return M.build(ctx, params(ctx), features)

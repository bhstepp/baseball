# fennec.py - fennec fox: a small round head with a short pointed snout and a little black nose, enormous upright
# ears (pale pink inside, dark-edged) through cap slots, cream coat with a white lower face and cheeks, the dark tear
# lines from the inner eye corners down the muzzle, and a bushy tail with a dark tip. Head options (spec.head):
# ears (size), snout (length), splay (ear angle out from vertical).
import numpy as np
import hkit as K
import rk_sdf as SD
from heads import fam_mammal as M

FAMILY = 'mammal'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'mammal',
    'tail': 'bushy',
    'build': 'small',
    'colors': {'nose': '#1E1A22', 'skin': '#F4C4BC'},
    'body_over': {'hand_mat': 'fur_light', 'tail_tip_mat': 'fur_dark', 'tail_size': 0.85},
}


def params(ctx):
    o = ctx.opts
    ears = o.get('ears', 1.0)
    sn = o.get('snout', 1.0)
    splay = o.get('splay', 0.0)
    tip = -0.86 - 0.12 * (sn - 1)
    P = dict(
        cran=dict(c=(0.0, 0.08, 4.12), r=(0.57, 0.54, 0.56)),
        face=dict(c=(0.0, -0.16, 4.08), r=(0.46, 0.36, 0.28), k=0.16),
        jowl=dict(c=(0.27, -0.12, 3.74), r=(0.36, 0.38, 0.32), k=0.18),
        snout=dict(a=(0.0, -0.30, 3.90), b=(0.0, tip, 3.84), ra=0.25, rb=0.10, sx=1.0, sz=0.88, k=0.13),
        chin=dict(c=(0.0, -0.44, 3.60), r=(0.18, 0.28, 0.11), k=0.10),
        eye=dict(x=0.195, z=4.16, axis=(0.17, -1.0, 0.03), W=0.14, H=0.195, pupil=(10.0, 14.5)),
        mouth=dict(z0=3.72, W=0.26, curve=0.6, depth=0.62, jaw_back=0.74),
        nose=dict(kind='button', z=3.87, r=(0.085, 0.065, 0.06)),
        ear=dict(kind='big', base=(0.33, 0.12, 4.50), up=(0.42 + splay, 0.06, 1.0), fwd=(0.35, -1.0, 0.05),
                 H=0.92 * ears, W=0.33 * ears, T=0.04, cup=0.13, shape='tri', mat='fur', inner='skin', rim='fur_dark',
                 slot=True, tris=260),
        brow=dict(z=4.41, x0=0.07, x1=0.34, arch=0.07, thick=0.045),
        regions=[],
    )

    def tears(geo):           # dark lines from the inner eye corner down the side of the muzzle
        def f(Q):
            Q = np.asarray(Q, float)
            x, y, z = Q[..., 0], Q[..., 1], Q[..., 2]
            ax = np.abs(x)
            xc = 0.14 + 0.05 * np.clip((4.05 - z) / 0.25, 0, 1)
            return np.maximum(np.maximum(np.abs(ax - xc) - 0.022, np.maximum(z - 4.07, 3.86 - z)), y + 0.30)
        return f
    P['regions'] = [('fur_dark', tears), ('fur_light', M.region_lower_face(top_dz=-0.20, side_drop=0.22, back=0.05))]
    return P


def features(ctx, head, geo):
    M.whiskers(ctx, head, geo, n=3, length=0.34, mat='fur_dark', droop=0.05)


def build(ctx):
    return M.build(ctx, params(ctx), features)

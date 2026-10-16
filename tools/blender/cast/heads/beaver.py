# beaver.py - round head, small round ears, a wide light muzzle, two big buck teeth showing under the upper lip,
# dark button nose, whiskers.
import numpy as np
from heads import fam_mammal as M
import hkit as K
import rk_sdf as SD
import rk_geo as G

FAMILY = 'mammal'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'mammal',
    'tail': 'flat',
    'build': 'round',
    'colors': {'nose': '#1B1420', 'skin': '#5A4A44', 'teeth': '#F6E7B8'},
    'body_over': {'tail_mat': 'skin'},
}


def params(ctx):
    return dict(
        cran=dict(c=(0.0, 0.08, 4.12), r=(0.62, 0.58, 0.60)),
        face=dict(c=(0.0, -0.17, 4.12), r=(0.50, 0.36, 0.30), k=0.17),
        jowl=dict(c=(0.31, -0.12, 3.74), r=(0.42, 0.40, 0.37), k=0.18),
        snout=dict(a=(0.0, -0.30, 3.88), b=(0.0, -0.68, 3.86), ra=0.30, rb=0.22, sx=1.15, sz=0.88, k=0.12),
        chin=dict(c=(0.0, -0.44, 3.56), r=(0.24, 0.28, 0.14), k=0.10),
        eye=dict(x=0.19, z=4.18, axis=(0.14, -1.0, 0.03)),
        mouth=dict(z0=3.69, W=0.30, curve=0.6, depth=0.56, jaw_back=0.68),
        nose=dict(kind='button', z=3.95, r=(0.12, 0.085, 0.08)),
        ear=dict(kind='tiny', base=(0.52, 0.10, 4.40), up=(1.0, 0.1, 0.55), fwd=(0.3, -1.0, 0.0), H=0.16, W=0.12,
                 T=0.035, cup=0.05, shape='round', mat='fur', inner='fur_dark', slot=False, tris=110),
        regions=[('fur_light', M.region_lower_face(top_dz=-0.25, side_drop=0.16, back=0.02))],
    )


def buck_teeth(ctx, head, geo):
    m = geo.mouth
    out = []
    for s in (1, -1):
        x = 0.052 * s
        top = K.march_to(geo.f, np.array([x, -1.8, m.z0 + 0.03]), (0, 1, 0)) + np.array([0, 0.05, 0])
        c = top + np.array([0, -0.02, -0.07])
        f = SD.box(c, (0.048, 0.022, 0.085), rnd=0.012) if hasattr(SD, 'box') else SD.ellipsoid(c, (0.048, 0.025, 0.09))
        p = K.blob(f, c, 0.2, 60, 'teeth', 'buck_' + ('L' if s > 0 else 'R'), h=0.005)
        p.sk['mouth_open'] = np.tile([0, -0.02, 0.02], (p.n, 1))
        p.sk['grin'] = np.tile([0, -0.01, 0.01], (p.n, 1))
        out.append(p)
    head.parts += out
    return out


def features(ctx, head, geo):
    buck_teeth(ctx, head, geo)
    M.whiskers(ctx, head, geo, n=3, length=0.34, mat='fur_dark')


def build(ctx):
    return M.build(ctx, params(ctx), features)

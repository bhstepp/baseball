# squirrel.py - tree squirrel: tall tufted ears up through the cap, a short muzzle with buck teeth, a light chin and
# belly colour, a huge bushy tail curling up over the back. Head options: tufts (ear tufts on / off).
import numpy as np
from heads import fam_mammal as M
import hkit as K
import rk_sdf as SD
from rk_geo import nrm

FAMILY = 'mammal'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'mammal',
    'tail': 'bushy',
    'build': 'small',
    'colors': {'nose': '#1B1420', 'skin': '#F2C0B0', 'teeth': '#F6E7C0'},
    'body_over': {'tail_size': 1.25, 'tail_tip_mat': 'fur_dark'},
}


def params(ctx):
    return dict(
        cran=dict(c=(0.0, 0.08, 4.14), r=(0.57, 0.55, 0.57)),
        face=dict(c=(0.0, -0.16, 4.10), r=(0.46, 0.36, 0.30), k=0.16),
        jowl=dict(c=(0.29, -0.12, 3.78), r=(0.38, 0.38, 0.34), k=0.18),
        snout=dict(a=(0.0, -0.30, 3.88), b=(0.0, -0.64, 3.86), ra=0.27, rb=0.18, sx=1.05, sz=0.86, k=0.12),
        chin=dict(c=(0.0, -0.44, 3.62), r=(0.20, 0.26, 0.12), k=0.10),
        eye=dict(x=0.20, z=4.17, axis=(0.16, -1.0, 0.03), W=0.135, H=0.20),
        mouth=dict(z0=3.71, W=0.25, curve=0.6, depth=0.56, jaw_back=0.68),
        nose=dict(kind='button', z=3.93, r=(0.10, 0.075, 0.07)),
        ear=dict(kind='point', base=(0.34, 0.10, 4.60), up=(0.35, 0.10, 1.0), fwd=(0.30, -1.0, 0.0), H=0.36, W=0.15,
                 T=0.04, cup=0.09, shape='tri', mat='fur', inner='fur_light', slot=True, tris=170),
        brow=dict(z=4.42, x0=0.07, x1=0.34, arch=0.06, thick=0.045),
        regions=[('fur_light', M.region_lower_face(top_dz=-0.22, side_drop=0.20, back=0.0))],
    )


def ear_tufts(ctx, head, geo):
    E = geo.P['ear']
    for s in (1, -1):
        base, upv, fwd = M.ear_frames(E, s)
        u = nrm(upv)
        tip = base + u * E['H'] * 0.95
        f = SD.round_cone(tip - u * 0.06, tip + u * 0.16 + np.array([s * 0.02, 0.03, 0]), 0.045, 0.01)
        p = K.blob(f, tip, 0.35, 60, 'fur_dark', 'ear_tuft_' + ('L' if s > 0 else 'R'), bone='ear.' + ('L' if s > 0 else 'R'))
        head.parts.append(p)


def features(ctx, head, geo):
    M.buck_teeth(ctx, head, geo, w=0.04, h=0.075, sep=0.045)
    if ctx.opts.get('tufts', True):
        ear_tufts(ctx, head, geo)


def build(ctx):
    return M.build(ctx, params(ctx), features)

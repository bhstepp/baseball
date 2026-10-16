# tortoise.py - a desert tortoise: a blunt, domed reptile head with a short beak-like muzzle, nostril pits, heavy
# hooded lids, a wide mouth line, scaly skin and a wrinkled neck (grooves round the neck stub); the shell is body
# gear (spec gear ['shell'], body.shell_kind 'tortoise'). Head options (spec.head): old (Tess 'Tumbleweed': lids
# hanging low, bushy white brows, eyelashes, deeper neck folds), lid (lid droop in degrees), snout (length).
import math
import numpy as np
import hkit as K
import rk_sdf as SD
import rk_geo as G
import rk_mesh as MS
from rk_geo import Part, nrm
from heads import fam_reptile as R

FAMILY = 'reptile'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'reptile',
    'tail': 'stub',
    'build': 'round',
    'colors': {'shell': '#A8743E'},
    'body_over': {'hand_mat': 'fur', 'tail_mat': 'fur', 'tail_len': 0.5, 'shell_kind': 'tortoise'},
}


def params(ctx):
    o = ctx.opts
    old = bool(o.get('old'))
    sn = o.get('snout', 1.0)
    lid = o.get('lid', 16.0 if old else 9.0)
    P = dict(
        cran=dict(c=(0.0, 0.08, 4.08), r=(0.58, 0.58, 0.52)),
        face=dict(c=(0.0, -0.18, 4.04), r=(0.50, 0.40, 0.34), k=0.16),
        jowl=dict(c=(0.28, -0.08, 3.76), r=(0.40, 0.42, 0.32), k=0.18),
        snout=dict(a=(0.0, -0.24, 3.94), b=(0.0, -0.60 - 0.10 * (sn - 1), 3.86), ra=0.33, rb=0.25, sx=1.08, sz=0.82, k=0.12),
        chin=dict(c=(0.0, -0.42, 3.64), r=(0.30, 0.34, 0.13), k=0.12),
        neck=dict(a=(0.0, 0.14, 3.62), b=(0.0, 0.10, 2.95), r=0.235, k=0.14),
        eye=dict(x=0.24, z=4.17, axis=(0.30, -1.0, 0.08), R=0.38, W=0.125, H=0.16, out=0.03, rim=0.05, lid='fur',
                 pupil=(9.5, 13.0), lid_drop=lid, ring='mask'),
        brow_bumps=0.13,
        mouth=dict(z0=3.76, W=0.38, curve=0.25, depth=0.6, jaw_back=0.78, jaw_open=None, teeth=None, tongue=True),
        brow=dict(z=4.38, x0=0.09, x1=0.38, arch=0.05, thick=0.075 if old else 0.05, mat='fur_light' if old else 'mask',
                  tilt=-0.03 if old else 0.0),
        skin_mat='fur',
        carve=[(0.02, SD.torus((0.0, 0.11, z), 0.245, 0.016)) for z in ((3.30, 3.40, 3.50) if old else (3.34, 3.46))],
    )
    return P


def lashes(head, eyes, mat='mask', n=3):
    """Eyelashes on the outer half of each upper lid; blink / squint keys swing them with the lid edge."""
    out = []
    aw, ah = eyes.angles()
    mw, me = math.radians(5), math.radians(6)
    rest = ah - math.radians(2.5 + eyes.lid_drop)
    closed = -ah - math.radians(3)
    for s in (1, -1):
        piv, R = eyes.frame(s)
        k = np.clip(1.0 - (rest / (ah + me)) ** 2, 0.06, 1.0)
        azh = (aw + mw) * math.sqrt(k)
        terms = []
        for i in range(n):
            u = 0.42 + 0.55 * i / max(n - 1, 1)
            root = eyes.sph(piv, R, eyes.R + 0.03, s * u * azh, rest)
            d = R @ nrm(np.array([s * (0.45 + 0.5 * u), 0.85, 0.35]))
            L = 0.075 + 0.035 * u
            pts = [root - d * 0.01, root + d * L * 0.55 + R[:, 1] * 0.012, root + d * L + R[:, 0] * s * 0.02]
            terms.append(SD.ptube(list(K.curve_pts(pts, 3)), np.linspace(0.016, 0.006, 7)))
        g = SD.union(*terms)
        c = eyes.sph(piv, R, eyes.R, 0, rest)
        V, F = MS.sdf_mesh(g, c - 0.35, c + 0.35, K.hq(0.004), tris=K.tq(130, 30))
        p = Part(V, F, mat, 'lashes')
        K.orient_outward(p)
        p.rigid('head')
        p.sk['blink'] = K.rot_points(p.V, piv, R[:, 0], np.full(p.n, rest - closed)) - p.V
        p.sk['squint'] = K.rot_points(p.V, piv, R[:, 0], np.full(p.n, math.radians(17))) - p.V
        out.append(p)
    head.parts += out
    return out


def features(ctx, head, geo):
    if ctx.opts.get('old'):
        lashes(head, geo.eyes)


def build(ctx):
    return R.build(ctx, params(ctx), features)

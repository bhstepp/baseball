# fam_reptile.py - the REPTILE head family (lizards, tortoises, turtles, snakes-with-arms): a broad flat wedge of a
# head, eyes set high and wide on brow bumps, a very wide mouth line running back along the jaw (hkit.MouthRig, so
# reptiles keep every face shape key incl. a huge grin), nostril pits on top of the snout, no ears. Materials: skin
# (the scales' main colour), fur_light (the pale throat), mask (brows / markings). Species features: crests,
# frills, horns, a beak-like tortoise jaw (tortoise.py).
import copy
import numpy as np
import hkit as K
import rk_sdf as SD
import rk_geo as G
from rk_geo import nrm
from heads import fam_mammal as MM

DEFAULTS = dict(
    cran=dict(c=(0.0, 0.08, 4.05), r=(0.60, 0.60, 0.46)),
    face=dict(c=(0.0, -0.16, 4.02), r=(0.52, 0.40, 0.34), k=0.16),
    jowl=dict(c=(0.30, -0.06, 3.78), r=(0.40, 0.44, 0.32), k=0.18),
    snout=dict(a=(0.0, -0.26, 3.94), b=(0.0, -0.84, 3.86), ra=0.38, rb=0.26, sx=1.2, sz=0.62, k=0.12),
    muzzle=None,
    chin=dict(c=(0.0, -0.44, 3.66), r=(0.36, 0.42, 0.14), k=0.12),
    neck=dict(a=(0.0, 0.14, 3.62), b=(0.0, 0.10, 3.00), r=0.235, k=0.14),
    nape=dict(c=(0.0, 0.30, 3.74), r=(0.40, 0.36, 0.30), k=0.14),
    extra=[],
    carve=[],
    eye=dict(x=0.27, z=4.20, axis=(0.40, -1.0, 0.12), R=0.38, W=0.13, H=0.17, out=0.03, rim=0.05, lid='skin',
             pupil=(9.0, 13.0), lid_drop=4.0, ring='mask'),
    brow_bumps=0.16,
    mouth=dict(z0=3.78, W=0.46, curve=0.18, depth=0.62, jaw_back=0.80, jaw_open=34.0, teeth=None, tongue=True),
    nose=dict(kind='nostrils'),
    ear=None,
    brow=dict(z=4.34, x0=0.10, x1=0.38, arch=0.05, thick=0.05, mat='mask', tilt=0.0),
    cap=dict(lift=0.04, brim=1.0, cranium=None),
    regions=[],
    skin_tris=2600,
    skin_mat='skin',
)


def params(over):
    P = copy.deepcopy(DEFAULTS)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(P.get(k), dict):
            P[k] = dict(P[k])
            P[k].update(v)
        else:
            P[k] = v
    # brow bumps carry the eyes high and wide (the reptile silhouette)
    e = P['eye']
    if P.get('brow_bumps'):
        r = P['brow_bumps']
        bumps = SD.union(SD.sphere((e['x'], -0.30, e['z'] + 0.02), r), SD.sphere((-e['x'], -0.30, e['z'] + 0.02), r))
        P['extra'] = list(P['extra']) + [(0.10, bumps)]
    # pale throat
    P['regions'] = list(P['regions']) + [('fur_light', lambda geo: (lambda Q: np.maximum(np.asarray(Q)[..., 2] - (P['mouth']['z0'] - 0.05),
                                                                                          np.asarray(Q)[..., 1] - 0.15)))]
    # nostril pits on top of the snout tip
    sn = P['snout']
    tip = np.asarray(sn['b'], float)
    pits = SD.union(*[SD.ellipsoid(tip + np.array([s * 0.09, -0.12, sn['rb'] * sn['sz'] * 0.9]), (0.03, 0.03, 0.04)) for s in (1, -1)])
    P['carve'] = list(P['carve']) + [(0.015, pits)]
    P['regions'] = [('mouth', lambda geo, pits=pits: (lambda Q: pits(Q) - 0.01))] + P['regions']
    P['nose'] = dict(kind='none')
    return P


def crest(ctx, head, geo, n=6, h=0.18, mat='mask', z0=4.45, z1=3.4):
    """A row of soft spikes down the top of the head and the back of the neck (iguana-style)."""
    out = []
    for i in range(n):
        t = i / max(n - 1, 1)
        z = z0 + (z1 - z0) * t
        base = K.march_to(geo.f, np.array([0.0, 1.8, z]), (0, -1, 0))
        nn = SD.normals(geo.f, base[None])[0]
        hh = h * (1 - 0.5 * t)
        cone = SD.round_cone(base - nn * 0.02, base + nn * hh, 0.05 * (1 - 0.4 * t), 0.012)
        p = K.blob(cone, base + nn * hh * 0.5, hh + 0.12, 50, mat, 'crest')
        w = G.smoothstep(3.75, 3.45, p.V[:, 2])
        p.set_weights({'neck': w, 'head': 1 - w})
        out.append(p)
    head.parts += out
    return out


def build(ctx, over, features=None):
    """Reptile heads use the mammal family's builder (skull SDF, eyes, mouth, brows, cap) with reptile params."""
    P = params(over)
    head = MM.build(ctx, P, features)
    return head

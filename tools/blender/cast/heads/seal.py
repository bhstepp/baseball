# seal.py - harbor seal: a smooth round head flowing into a thick neck, no ear flaps (just ear holes), big dark
# eyes, a short muzzle of two puffy whisker pads with bristle dots and long whiskers, a dark nose on top of the pads.
# Head options (spec.head): spots (harbor-seal speckles on the crown, seeded), droopy (heavy sleepy lids, a longer
# droopier mustache for 'Low Tide'), pads (whisker pad size).
import numpy as np
import hkit as K
import rk_sdf as SD
import rk_geo as G
from heads import fam_mammal as M

FAMILY = 'mammal'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'mammal',
    'tail': 'flat',
    'build': 'average',
    'colors': {'nose': '#1B1420'},
    'body_over': {'tail_len': 0.55, 'tail_size': 0.75, 'hand_mat': 'fur'},
}


def params(ctx):
    o = ctx.opts
    pads = o.get('pads', 1.0)
    droopy = bool(o.get('droopy'))
    pr = 0.172 * pads
    P = dict(
        cran=dict(c=(0.0, 0.07, 4.12), r=(0.60, 0.58, 0.58)),
        face=dict(c=(0.0, -0.17, 4.08), r=(0.50, 0.38, 0.32), k=0.18),
        jowl=dict(c=(0.30, -0.10, 3.70), r=(0.43, 0.42, 0.38), k=0.20),
        snout=dict(a=(0.0, -0.28, 3.86), b=(0.0, -0.56, 3.83), ra=0.30, rb=0.25, sx=1.25, sz=0.85, k=0.12),
        extra=[(0.07, SD.union(SD.ellipsoid((0.13 * pads, -0.69, 3.79), (pr, pr * 0.95, pr * 0.9)),
                               SD.ellipsoid((-0.13 * pads, -0.69, 3.79), (pr, pr * 0.95, pr * 0.9))))],
        carve=[(0.03, SD.union(SD.sphere((0.585, 0.12, 4.13), 0.035), SD.sphere((-0.585, 0.12, 4.13), 0.035)))],
        chin=dict(c=(0.0, -0.42, 3.55), r=(0.22, 0.26, 0.12), k=0.10),
        neck=dict(a=(0.0, 0.12, 3.62), b=(0.0, 0.10, 3.00), r=0.235, k=0.16),
        nape=dict(c=(0.0, 0.24, 3.74), r=(0.38, 0.33, 0.30), k=0.16),
        eye=dict(x=0.20, z=4.19, axis=(0.15, -1.0, 0.03), W=0.145, H=0.205, pupil=(12.0, 16.0),
                 lid_drop=9.0 if droopy else 0.0),
        mouth=dict(z0=3.635, W=0.27, curve=0.55, depth=0.56, jaw_back=0.68, key_scale=dict(frown=0.75)),
        nose=dict(kind='button', z=3.965, r=(0.13, 0.085, 0.08)),
        ear=None,
        brow=dict(z=4.45, x0=0.07, x1=0.35, arch=0.07, thick=0.05),
        regions=[('fur_light', M.region_lower_face(top_dz=-0.20, side_drop=0.20, back=0.0))],
    )
    if o.get('spots'):
        rng = np.random.default_rng(int(ctx.spec.get('seed', 5)) & 0xFFFFFFFF)
        P['regions'] = [('fur_dark', M.region_spots(rng, n=7, zone=((-0.55, 0.55), (-0.1, 0.6), (3.7, 4.55)),
                                                    size=(0.045, 0.08)))] + P['regions']
    return P


def bristles(ctx, head, geo, pads=1.0, mat='mask'):
    """Rows of bristle dots on the whisker pads."""
    if K.LOD > 0:
        return []
    out = []
    for s in (1, -1):
        for i, (dx, dz) in enumerate(((0.10, 0.05), (0.17, 0.02), (0.13, -0.03), (0.20, -0.04), (0.08, -0.01))):
            p0 = np.array([s * dx * pads, -1.6, 3.79 + dz])
            c = K.march_to(geo.f, p0, (0, 1, 0))
            nn = SD.normals(geo.f, c[None])[0]
            g = SD.ellipsoid(c, (0.018, 0.018, 0.008), R=G.zframe(nn))
            out.append(K.blob(g, c, 0.06, 16, mat, 'freckle', h=0.004))
    head.parts += out
    return out


def features(ctx, head, geo):
    o = ctx.opts
    pads = o.get('pads', 1.0)
    bristles(ctx, head, geo, pads)
    M.whiskers(ctx, head, geo, n=3, length=0.42, mat='mask', droop=0.06, spread=0.05, root=(0.24 * pads, -0.66, 3.80))
    if ctx.acc.get('hair') == 'mustache' and o.get('droopy'):
        ctx.acc['hair'] = None                  # the droopy handlebar instead of the family's mustache
        M.mustache(ctx, head, geo, mat=ctx.acc.get('hair_mat', 'fur_dark'), w=0.36, droop=0.16, thick=0.06)


def build(ctx):
    return M.build(ctx, params(ctx), features)

# owl.py - a wide round owl head with a flat face: two big forward-facing eyes (coloured irises) set in a pale
# facial disc ringed with a dark rim, a short hooked beak tucked between them, and feathered ear tufts standing up
# through cap slots like little horns. Head options: tufts (size; Belle "Gargoyle" wears big stony horns), iris
# (colour material or False), pupil (size scale), disc (disc radius scale), lid, brow tilt (brow_tilt).
import math
import numpy as np
from heads import fam_bird as B
from heads import _park6 as P6
import hkit as K
import rk_sdf as SD

FAMILY = 'bird'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'bird',
    'tail': 'fan',
    'build': 'stout',
    'build_over': {'neck': 0.75},
    'colors': {'beak': '#E8B040', 'skin': '#F6BE22'},
    'body_over': {'hand_mat': 'feather', 'tail_mat': 'feather', 'tail_tip_mat': 'mask', 'tail_len': 0.45},
}
EYE_X, EYE_Z = 0.255, 4.16


def disc(scale=1.0):
    """The facial disc: two round dishes round the eyes merging over the beak (pale), negative inside."""
    def make(geo):
        def f(P):
            P = np.asarray(P, float)
            x, y, z = P[..., 0], P[..., 1], P[..., 2]
            r = 0.30 * scale
            d = np.minimum(np.hypot(x - EYE_X, (z - EYE_Z) * 0.95), np.hypot(x + EYE_X, (z - EYE_Z) * 0.95)) - r
            d = np.minimum(d, np.hypot(x * 1.6, (z - 3.86) * 1.2) - 0.30 * scale)       # the lower middle, round the beak
            return np.maximum(d, y + 0.02)
        return f
    return make


def rim(scale=1.0, w=0.035):
    def make(geo):
        inner = disc(scale)(geo)
        outer = disc(scale * 1.0 + w / 0.30)(geo)
        return lambda P: np.maximum(outer(P), -inner(P))
    return make


def hook(f, o):
    bs = o.get('beak', 1.0)
    z0 = 4.00
    y0 = K.surface_y(f, 0.0, z0)
    ctrl = [np.array([0.0, y0 + 0.08, z0 + 0.02]), np.array([0.0, y0 - 0.09 * bs, z0 - 0.01]),
            np.array([0.0, y0 - 0.15 * bs, z0 - 0.13 * bs]), np.array([0.0, y0 - 0.12 * bs, z0 - 0.25 * bs])]
    radii = np.array([0.105, 0.088, 0.058, 0.022]) * bs ** 0.5
    tube, pts = P6.curve_tube(ctrl, radii, 6)
    c = np.mean(ctrl, 0)
    shape = P6.squash(tube, (0.92, 1.0, 1.0), c)
    g = [np.array([0.0, y0 + 0.5, z0 - 0.06]), np.array([0.0, y0 + 0.02, z0 - 0.07]), np.array([0.0, y0 - 0.08 * bs, z0 - 0.12 * bs]),
         np.array([0.0, y0 - 0.06 * bs, z0 - 0.30 * bs])]
    hinge = np.array([0.0, y0 + 0.05, z0 - 0.07])
    return P6.Beak(shape, g, hinge, c - 0.45, c + 0.45, open_deg=24.0, lift_deg=5.0, tris=(200, 120), back_y=y0 + 0.02,
                   half_w=0.10)


def params(ctx):
    o = ctx.opts
    ds = o.get('disc', 1.0)
    return dict(
        cran=dict(c=(0.0, 0.08, 4.14), r=(0.66, 0.56, 0.60)),
        face=dict(c=(0.0, -0.10, 4.10), r=(0.56, 0.32, 0.42), k=0.16),
        cheek=dict(c=(0.30, -0.08, 3.86), r=(0.32, 0.30, 0.28), k=0.15),
        chin=dict(c=(0.0, -0.18, 3.70), r=(0.30, 0.26, 0.18), k=0.12),
        neck=dict(a=(0.0, 0.10, 3.62), b=(0.0, 0.10, 3.00), r=0.26, k=0.14),
        nape=dict(c=(0.0, 0.24, 3.76), r=(0.40, 0.32, 0.28), k=0.14),
        eye=dict(x=EYE_X, z=EYE_Z, axis=(0.07, -1.0, 0.02), R=0.40, W=0.165, H=0.19, out=0.05, lid_drop=o.get('lid', 0.0),
                 pupil=tuple(np.array((10.0, 14.0)) * o.get('pupil', 1.0))),
        beak=dict(z=3.98, len=0.2, w=0.1, h=0.08, droop=0.0),          # replaced by the hook in features()
        brow=dict(z=4.45, x0=0.06, x1=0.42, arch=0.05, thick=0.055, mat='mask', tilt=o.get('brow_tilt', 0.0)),
        regions=[('mask', rim(ds)), ('fur_light', disc(ds))],
    )


def tufts(ctx, head, geo, size=1.0):
    """Ear tufts: three-pointed feather tufts rising from the top corners of the head, through cap slots."""
    out = []
    for s in (1, -1):
        base = np.array([s * 0.40, 0.04, 4.50])
        up = P6.nrm(np.array([s * 0.55, 0.10, 1.0]))
        side = P6.nrm(np.cross(up, [0, -1, 0]))
        terms = []
        for k, (ang, ln, w) in enumerate(((0.0, 1.0, 1.0), (0.32, 0.72, 0.8), (-0.30, 0.66, 0.8))):
            d = P6.nrm(up + side * ang)
            tip = base + d * 0.52 * size * ln
            terms.append(SD.scaled(SD.round_cone(base, tip, 0.11 * size * w, 0.012), (1.0, 0.45, 1.0), base))
        g = SD.smooth_union(0.04, *terms)
        p = K.blob(g, base + up * 0.3 * size, 0.6 * size + 0.1, 220, 'feather', 'tuft_' + ('L' if s > 0 else 'R'))
        tipw = G_smooth(p.V, base, up, 0.30 * size)
        p.mat = ['mask' if tipw[f].mean() > 0.5 else 'feather' for f in p.F]
        out.append(p)
        geo.slots.append((base + up * 0.05, up, 0.13 * size))
    head.parts += out
    return out


def G_smooth(V, base, up, h):
    return np.clip(((np.asarray(V) - base) @ up - h) / 0.08, 0, 1)


def features(ctx, head, geo):
    o = ctx.opts
    P6.replace_beak(head, geo, hook(geo.f, o))
    tufts(ctx, head, geo, size=o.get('tufts', 1.0))
    if o.get('iris', 'skin'):
        P6.iris_parts(head, geo.eyes, mat=o.get('iris', 'skin'), scale=o.get('iris_scale', 1.9))
    P6.card_extras(ctx, head, geo)


def build(ctx):
    return B.build(ctx, params(ctx), features)

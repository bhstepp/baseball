# goose.py - a grey goose: a smooth oval head on a long neck (the stub reaches down into the collar however long the
# neck bone is), a tall orange bill with a pale nail, an optional domestic-goose knob at
# the bill base, a white throat. Mabel "Grandma Gas" (head option granny, or the p_mabel id as a fallback): round spectacles, a
# white feather bun at the back of the head, rosy cheeks and a string of pearls on the collar.
# Head options: beak (size), slim (narrow bill), knob, neck_fwd (the neck bows forward), granny, lid (heavy lids),
# worry (inner brow ends up), dark_cap (darker crown and nape).
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
    'build': 'lanky',
    'build_over': {'neck': 1.7},
    'colors': {'beak': '#EE7A35', 'skin': '#F0A0A0', 'teeth': '#F6F0E0', 'horn': '#C9A04A'},
    'body_over': {'hand_mat': 'feather', 'tail_mat': 'feather', 'tail_tip_mat': 'fur_light', 'tail_len': 0.6, 'neck_r': 0.92},
}


def is_granny(ctx):
    return bool(ctx.opts.get('granny', ctx.spec.get('id') == 'p_mabel'))


def bib():
    """The pale throat: under the chin and down the front of the neck (never beside the bill: no 'mustache')."""
    def make(geo):
        def f(P):
            P = np.asarray(P, float)
            x, y, z = P[..., 0], P[..., 1], P[..., 2]
            top = 3.70 - 0.25 * np.clip(np.abs(x) / 0.25, 0, 1) ** 2      # dips at the sides
            d = z - top
            return np.maximum(d, y - (0.04 - 0.10 * np.clip((3.6 - z) / 0.5, 0, 1)))
        return f
    return make


def params(ctx):
    o = ctx.opts
    fr = P6.Frame(ctx.spec)
    bs = o.get('beak', 1.0)
    slim = o.get('slim', 0.0)
    neck, zb = P6.neck_stub(fr, top=(0.0, 0.10, 3.66), r_top=0.205, r_bot=0.185, fwd=o.get('neck_fwd', 0.05))
    eye = dict(x=0.205, z=4.20, axis=(0.24, -1.0, 0.03), W=0.14, H=0.195, lid_drop=o.get('lid', 0.0))
    P = dict(
        cran=dict(c=(0.0, 0.08, 4.14), r=(0.53, 0.58, 0.60)),
        face=dict(c=(0.0, -0.14, 4.08), r=(0.42, 0.38, 0.36), k=0.16),
        cheek=dict(c=(0.24, -0.14, 3.88), r=(0.27, 0.30, 0.26), k=0.15),
        chin=dict(c=(0.0, -0.26, 3.68), r=(0.22, 0.26, 0.16), k=0.12),
        neck=dict(a=(0.0, 0.10, 3.66), b=(0.0, 0.06, zb), r=0.19, k=0.12),
        nape=dict(c=(0.0, 0.22, 3.80), r=(0.30, 0.28, 0.26), k=0.14),
        extra=neck,
        eye=eye,
        beak=dict(z=3.92, len=0.50 * bs, w=(0.20 - 0.035 * slim) * bs ** 0.5, h=0.18 * bs ** 0.5, droop=0.07, open=24.0),
        brow=dict(z=4.45, x0=0.07, x1=0.35, arch=0.06, thick=0.05, mat='mask', tilt=-0.05 if o.get('worry') else 0.0),
        regions=[('fur_light', bib())],
    )
    if is_granny(ctx):
        P['regions'] = [('skin', P6.region_ell((0.31, -0.30, 3.93), (0.17, 0.15, 0.12))),
                        ('skin', P6.region_ell((-0.31, -0.30, 3.93), (0.17, 0.15, 0.12)))] + P['regions']
    if o.get('dark_cap'):
        P['regions'] = P['regions'] + [('fur_dark', P6.region_fn(lambda Q: np.maximum(4.55 - np.asarray(Q)[..., 2], np.asarray(Q)[..., 1] - 0.3)))]
    return P


def features(ctx, head, geo):
    o = ctx.opts
    bk = geo.beak
    # the pale nail at the bill tip
    tip = bk.tip + np.array([0.0, 0.035, 0.012])
    head.parts.append(K.blob(SD.ellipsoid(tip, (0.055, 0.05, 0.03)), tip, 0.15, 50, 'teeth', 'nail', h=0.006))
    if o.get('knob'):            # domestic-goose knob where the bill meets the forehead
        c = bk.base + np.array([0.0, -0.14, bk.h * 0.95])
        r = 0.075 * o.get('knob', 1.0)
        head.parts.append(K.blob(SD.ellipsoid(c, (r * 1.1, r, r * 0.95)), c, 0.25, 90, 'beak', 'knob'))
    if is_granny(ctx):
        granny(ctx, head, geo)
    P6.card_extras(ctx, head, geo)


def granny(ctx, head, geo):
    """Grandma Gas: a white bun pinned at the back of the head, a fringe of white curls peeking out under the back
    and sides of the cap band, thin gold spectacles and pearls on the collar."""
    rng = np.random.default_rng(int(ctx.spec.get('seed', 7)) & 0xFFFF)
    c = np.array([0.0, 0.66, 4.24])
    c = K.march_to(geo.f, c + np.array([0, 1.2, 0]), (0, -1, 0)) + np.array([0, 0.13, 0])
    terms = [SD.ellipsoid(c, (0.21, 0.17, 0.20))]
    for i in range(7):                                   # the bun's swirl: lumps round it
        a = 2 * np.pi * i / 7
        terms.append(SD.sphere(c + np.array([0.15 * np.cos(a), 0.07, 0.14 * np.sin(a)]), 0.085 + rng.uniform(-0.01, 0.01)))
    terms.append(SD.sphere(c + np.array([0.0, 0.12, 0.0]), 0.09))
    curls = []
    for i in range(11):                                  # curls under the band, ear to ear round the back
        a = np.radians(-105 + 210 * i / 10)
        d = np.array([np.sin(a), np.cos(a), 0.0])
        z = 4.33 - 0.05 * np.cos(a)
        q = K.march_to(geo.f, np.array([0.0, 0.08, z]) + d * 1.4, -d)
        curls.append(SD.sphere(q + d * 0.02, 0.07 + rng.uniform(-0.008, 0.008)))
    g = SD.smooth_union(0.03, SD.smooth_union(0.04, *terms), SD.union(*curls))
    head.parts.append(K.blob(g, np.array([0.0, 0.25, 4.3]), 0.85, 440, 'fur_light', 'bun', h=0.008))
    P6.spectacles(head, geo.eyes, mat='horn')
    P6.pearls(head, P6.Frame(ctx.spec), n=19 if K.LOD == 0 else 11, r=0.052)


def build(ctx):
    if is_granny(ctx):
        ctx.acc['glasses'] = 0
        ctx.acc['eyeblack'] = 0
    return B.build(ctx, params(ctx), features)

# pigeon.py - city pigeon: a small round blue-grey head, a short dark beak with a pale cere bump at its base, an
# iridescent green-and-purple band round the neck, orange eyes optional (head option orange_eyes).
import numpy as np
from heads import fam_bird as B
import hkit as K
import rk_sdf as SD

FAMILY = 'bird'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'bird',
    'tail': 'fan',
    'build': 'lanky',
    'colors': {'beak': '#6A6270', 'skin': '#F2EEE8'},
    'body_over': {'hand_mat': 'feather', 'tail_mat': 'feather', 'tail_tip_mat': 'fur_dark', 'tail_len': 0.75},
}


def neck_band():
    """The iridescent band round the lower head / neck stub (negative inside)."""
    def make(geo):
        def f(P):
            P = np.asarray(P, float)
            z = P[..., 2]
            return np.abs(z - 3.48) - 0.15
        return f
    return make


def params(ctx):
    return dict(
        cran=dict(c=(0.0, 0.06, 4.14), r=(0.55, 0.54, 0.58)),
        cheek=dict(c=(0.26, -0.14, 3.88), r=(0.28, 0.30, 0.27), k=0.15),
        beak=dict(z=3.96, len=0.36, w=0.13, h=0.11, droop=0.08),
        eye=dict(x=0.21, z=4.18, axis=(0.24, -1.0, 0.03), W=0.13, H=0.18),
        regions=[('feather_accent', neck_band())],
    )


def features(ctx, head, geo):
    bk = geo.beak
    c = bk.base + np.array([0.0, -0.10, bk.h * 0.85])           # the cere: a pale bump on top of the beak base
    p = K.blob(SD.ellipsoid(c, (0.085, 0.075, 0.055)), c, 0.25, 70, 'skin', 'cere')
    head.parts.append(p)


def build(ctx):
    return B.build(ctx, params(ctx), features)

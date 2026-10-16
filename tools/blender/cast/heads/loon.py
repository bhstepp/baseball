# loon.py - common loon: a black head, red eyes, a long black dagger beak and the white checkered necklace on the
# neck stub. Head options: band (necklace on / off).
import numpy as np
from heads import fam_bird as B

FAMILY = 'bird'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'bird',
    'tail': 'fan',
    'build': 'lanky',
    'colors': {'beak': '#2A2A32', 'eye_white': '#D8473A', 'skin': '#F6F2EC'},
    'body_over': {'hand_mat': 'feather', 'tail_mat': 'feather', 'tail_tip_mat': 'feather_accent', 'tail_len': 0.6},
}


def necklace():
    """White checkered bands round the neck stub (negative inside)."""
    def make(geo):
        def f(P):
            P = np.asarray(P, float)
            x, y, z = P[..., 0], P[..., 1], P[..., 2]
            band = np.abs(z - 3.56) - 0.07
            ang = np.arctan2(x, -(y - 0.06))
            checks = np.cos(ang * 9.0) - 0.15          # broken into bars
            return np.maximum(band, -checks * 0.05)
        return f
    return make


def params(ctx):
    P = dict(
        cran=dict(c=(0.0, 0.08, 4.12), r=(0.54, 0.56, 0.56)),
        face=dict(c=(0.0, -0.14, 4.06), r=(0.42, 0.38, 0.34), k=0.16),
        cheek=dict(c=(0.24, -0.12, 3.88), r=(0.27, 0.30, 0.26), k=0.15),
        beak=dict(z=3.92, len=0.62, w=0.12, h=0.11, droop=0.05, open=22.0),
        eye=dict(x=0.21, z=4.16, axis=(0.26, -1.0, 0.04), W=0.125, H=0.16, pupil=(8.0, 11.5), ring=None),
        brow=dict(z=4.40, x0=0.08, x1=0.34, arch=0.05, thick=0.045, mat='skin', tilt=0.0),
        regions=[],
    )
    if ctx.opts.get('band', True):
        P['regions'] = [('skin', necklace())]
    return P


def features(ctx, head, geo):
    pass


def build(ctx):
    return B.build(ctx, params(ctx), features)

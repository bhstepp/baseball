# lizard.py - a desert lizard: flat wedge head, eyes high on brow bumps, a wide smiling mouth line, a soft crest.
from heads import fam_reptile as R

FAMILY = 'reptile'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'reptile',
    'tail': 'lizard',
    'build': 'lanky',
    'colors': {'skin': '#7DB04E', 'fur_light': '#EBDFA0', 'mask': '#2F4A2A'},
    'body_over': {'hand_mat': 'skin', 'tail_mat': 'skin', 'tail_tip_mat': 'mask'},
}


def params(ctx):
    return dict()


def features(ctx, head, geo):
    R.crest(ctx, head, geo, n=6, h=0.16, mat='mask', z0=4.22, z1=3.30)


def build(ctx):
    return R.build(ctx, params(ctx), features)

# lizard.py - a desert lizard: flat wedge head, eyes high on brow bumps, a wide smiling mouth line, a soft crest.
from heads import fam_reptile as R

FAMILY = 'reptile'


def params(ctx):
    return dict()


def features(ctx, head, geo):
    R.crest(ctx, head, geo, n=6, h=0.16, mat='mask', z0=4.22, z1=3.30)


def build(ctx):
    return R.build(ctx, params(ctx), features)

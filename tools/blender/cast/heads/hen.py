# hen.py - round feathered head, puffy cheeks, a yellow cone beak, a small red comb on top of the cap and a red
# wattle under the beak.
from heads import fam_bird as B

FAMILY = 'bird'


def params(ctx):
    return dict(beak=dict(z=3.93, len=0.40, w=0.17, h=0.14, droop=0.10))


def features(ctx, head, geo):
    B.comb(ctx, head, geo, lobes=3, size=0.13)
    B.wattle(ctx, head, geo, size=0.10)
    B.cheek_tufts(ctx, head, geo, mat='feather', n=1, size=0.10)


def build(ctx):
    return B.build(ctx, params(ctx), features)

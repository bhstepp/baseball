# rooster.py - like the hen with a bigger, taller comb (five lobes), a longer wattle and a slightly hooked beak.
from heads import fam_bird as B

FAMILY = 'bird'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'bird',
    'tail': 'fan',
    'build': 'small',
    'colors': {'beak': '#F2B632', 'skin': '#D9483B'},
    'body_over': {'hand_mat': 'feather', 'tail_mat': 'feather', 'tail_tip_mat': 'feather_accent'},
}


def params(ctx):
    return dict(beak=dict(z=3.93, len=0.44, w=0.18, h=0.15, droop=0.13),
                brow=dict(z=4.46, x0=0.07, x1=0.36, arch=0.05, thick=0.055, mat='mask', tilt=0.03))


def features(ctx, head, geo):
    B.comb(ctx, head, geo, lobes=5, size=0.17)
    B.wattle(ctx, head, geo, size=0.15)
    B.cheek_tufts(ctx, head, geo, mat='feather', n=2, size=0.11)


def build(ctx):
    return B.build(ctx, params(ctx), features)

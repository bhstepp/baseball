# tortoise.py - a reptile head with a short blunt beak-like snout and heavy lids (the shell is body gear:
# cspecs gear ['shell']).
from heads import fam_reptile as R

FAMILY = 'reptile'


def params(ctx):
    return dict(snout=dict(a=(0.0, -0.24, 3.94), b=(0.0, -0.62, 3.84), ra=0.32, rb=0.24, sx=1.05, sz=0.8, k=0.12),
                eye=dict(x=0.24, z=4.18, axis=(0.30, -1.0, 0.08), R=0.38, W=0.12, H=0.15, out=0.03, rim=0.05, lid='skin',
                         pupil=(9.0, 13.0), lid_drop=10.0, ring='mask'),
                brow_bumps=0.13, mouth=dict(z0=3.76, W=0.38, curve=0.25, depth=0.6, jaw_back=0.78, jaw_open=None, teeth=None,
                                             tongue=True))


def build(ctx):
    return R.build(ctx, params(ctx), None)

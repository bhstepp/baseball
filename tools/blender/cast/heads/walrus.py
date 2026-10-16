# walrus.py - round heavy head, a broad whiskered muzzle with a big mustache, long ivory tusks, no ear flaps
# (head-kit example for tusks; park 4's walrus pitcher builds on it).
from heads import fam_mammal as M

FAMILY = 'mammal'


def params(ctx):
    return dict(
        cran=dict(c=(0.0, 0.08, 4.12), r=(0.64, 0.60, 0.58)),
        jowl=dict(c=(0.32, -0.16, 3.72), r=(0.42, 0.42, 0.38), k=0.18),
        snout=dict(a=(0.0, -0.28, 3.84), b=(0.0, -0.62, 3.80), ra=0.34, rb=0.28, sx=1.35, sz=0.85, k=0.12),
        eye=dict(x=0.21, z=4.18, axis=(0.15, -1.0, 0.03), W=0.115, H=0.17),
        mouth=dict(z0=3.62, W=0.30, curve=0.5, depth=0.56, jaw_back=0.68),
        nose=dict(kind='button', z=3.98, r=(0.13, 0.09, 0.08)),
        ear=None,
        regions=[('fur_light', M.region_lower_face(top_dz=-0.22, side_drop=0.16, back=0.0))],
    )


def features(ctx, head, geo):
    M.mustache(ctx, head, geo, mat='fur_dark', w=0.34, droop=0.08, thick=0.07)
    M.tusks(ctx, head, geo, length=0.6, r=0.05)
    M.whiskers(ctx, head, geo, n=3, length=0.3, mat='fur_dark')


def build(ctx):
    return M.build(ctx, params(ctx), features)

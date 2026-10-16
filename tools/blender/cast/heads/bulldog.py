# bulldog.py - a wide, short-faced bulldog: a pushed-in muzzle with a big black nose, heavy jowls hanging over the
# jaw, an underbite (the lower jaw juts out and two lower fangs stand up in front of the upper lip), small folded
# 'rose' ears, a wrinkled brow. Head options: jowls (droop amount), fangs (on / off), mean (boss: a squint and heavy
# angry brow ridge), ear_dark (ears in the accent colour, like the card).
import numpy as np
from heads import fam_mammal as M
import hkit as K
import rk_sdf as SD

FAMILY = 'mammal'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'mammal',
    'tail': 'stub',
    'build': 'stocky',
    'colors': {'nose': '#1B1420', 'teeth': '#FFFDF2'},
    'body_over': {'tail_len': 0.7},
}


def params(ctx):
    o = ctx.opts
    j = o.get('jowls', 1.0)
    mean = o.get('mean', 0.0)
    P = dict(
        cran=dict(c=(0.0, 0.10, 4.12), r=(0.70, 0.58, 0.55)),
        face=dict(c=(0.0, -0.14, 4.08), r=(0.60, 0.38, 0.30), k=0.16),
        jowl=dict(c=(0.36, -0.18, 3.66 - 0.05 * (j - 1)), r=(0.40, 0.42, 0.40 * (0.9 + 0.1 * j)), k=0.18),
        snout=dict(a=(0.0, -0.28, 3.88), b=(0.0, -0.58, 3.86), ra=0.36, rb=0.30, sx=1.25, sz=0.82, k=0.12),
        chin=dict(c=(0.0, -0.70, 3.50), r=(0.33, 0.25, 0.17), k=0.10),      # the jutting lower jaw (underbite)
        eye=dict(x=0.24, z=4.14, axis=(0.18, -1.0, 0.03), W=0.12, H=0.165, lid_drop=9.0 * mean + 2.0,
                 pupil=(8.0, 12.0) if mean else (9.0, 13.5)),
        mouth=dict(z0=3.66, W=0.38, curve=0.25, depth=0.60, jaw_back=0.74, key_scale=dict(frown=0.8)),
        nose=dict(kind='big', z=3.98, r=(0.19, 0.12, 0.12)),
        ear=dict(kind='rose', base=(0.56, 0.10, 4.46), up=(1.0, 0.08, -0.25), fwd=(0.15, -1.0, 0.35), H=0.24, W=0.16,
                 T=0.03, cup=0.05, droop=0.10, shape='leaf', mat='fur_dark' if o.get('ear_dark', True) else 'fur',
                 inner='skin', slot=False, tris=150),
        brow=dict(z=4.38, x0=0.08, x1=0.40, arch=0.03 if mean else 0.06, thick=0.07 if mean else 0.055,
                  tilt=0.08 * mean),
        regions=[('fur_light', M.region_muzzle(scale=1.12, dz=-0.04))],
    )
    if mean:     # heavy wrinkled brow ridge
        P['extra'] = [(0.07, SD.capsule((-0.32, -0.40, 4.32), (0.32, -0.40, 4.32), 0.09))]
    return P


def fangs(ctx, head, geo):
    """Underbite: two lower canines stand up in front of the upper lip (on the jaw, so mouth_open carries them)."""
    m = geo.mouth
    out = []
    for s in (1, -1):
        x = s * m.W * 0.55
        base = K.march_to(geo.f, np.array([x, -1.8, m.z(x) - 0.06]), (0, 1, 0)) + np.array([0, -0.02, 0])
        tip = base + np.array([s * 0.01, -0.05, 0.17])
        p = K.horn([base + np.array([0, 0.04, -0.05]), (base + tip) / 2 + np.array([0, -0.01, 0]), tip], 0.05, 0.013,
                   mat='teeth', name='fang', n=6)
        p.rigid('jaw')
        out.append(p)
    head.parts += out
    return out


def wrinkles(ctx, head, geo, mat='mask'):
    """Bulldog wrinkles: a frown furrow between the brows and two creases across the bridge of the nose."""
    out = []
    f = geo.f
    lines = [[(-0.05, 4.33), (0.0, 4.25), (0.05, 4.33)],
             [(-0.20, 4.08), (0.0, 4.11), (0.20, 4.08)],
             [(-0.16, 4.02), (0.0, 4.045), (0.16, 4.02)]]
    for ln in lines:
        pts = [K.march_to(f, np.array([x, -1.8, z]), (0, 1, 0)) for x, z in ln]
        pts = [p + SD.normals(f, p[None])[0] * 0.012 for p in pts]
        out.append(K.tube(K.curve_pts(pts, 4), np.array([0.008, 0.012, 0.012, 0.012, 0.008, 0.006, 0.006, 0.006, 0.006])[:len(K.curve_pts(pts, 4))],
                          4, mat, 'wrinkle'))
    head.parts += out
    return out


def features(ctx, head, geo):
    if ctx.opts.get('fangs', True):
        fangs(ctx, head, geo)
    if ctx.opts.get('wrinkles', True):
        wrinkles(ctx, head, geo, mat='fur_dark')


def build(ctx):
    return M.build(ctx, params(ctx), features)

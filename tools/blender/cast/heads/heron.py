# heron.py - a grey heron: a sleek white face with a black stripe from the eye back to two long black nape plumes, a
# long straight dagger bill (yellow), a long slim neck (the stub reaches into the collar) and long legs (species
# build). Head options: beak (length), plume (length), stern (angry brow tilt), lid.
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
    'build_over': {'neck': 2.2, 'leg': 1.3, 'hipw': 0.86},
    'colors': {'beak': '#F2C04A', 'skin': '#F2C04A'},
    'body_over': {'hand_mat': 'feather', 'tail_mat': 'feather', 'tail_tip_mat': 'mask', 'tail_len': 0.62,
                  'neck_r': 0.8, 'thigh': 0.74, 'cuff': 0.82},
}


def dagger(f, o):
    bl = o.get('beak', 1.0)
    z0 = 3.98
    y0 = K.surface_y(f, 0.0, z0)
    L = 0.82 * bl
    a = np.array([0.0, y0 + 0.10, z0])
    b = np.array([0.0, y0 - L, z0 - 0.07 * bl])
    shape = SD.scaled(SD.round_cone(a, b, 0.135, 0.012), (0.78, 1.0, 1.0), (a + b) / 2)
    g = [np.array([0.0, y0 + 0.6, z0 - 0.03]), np.array([0.0, y0 + 0.05, z0 - 0.035]), b + np.array([0, -0.3, -0.008])]
    hinge = np.array([0.0, y0 + 0.07, z0 - 0.05])
    c = (a + b) / 2
    return P6.Beak(shape, g, hinge, c - np.array([0.3, L / 2 + 0.3, 0.3]), c + np.array([0.3, L / 2 + 0.3, 0.3]),
                   open_deg=20.0, lift_deg=4.0, tris=(260, 200), back_y=y0 + 0.02, half_w=0.11), y0


def stripe():
    """The black stripe from just behind the eye back to the nape (under the cap band)."""
    def make(geo):
        e = geo.P['eye']

        def f(P):
            P = np.asarray(P, float)
            x, y, z = P[..., 0], P[..., 1], P[..., 2]
            t = np.clip((y + 0.30) / 0.80, 0, 1)                       # 0 beside the eye -> 1 at the nape
            zc = e['z'] + 0.10 - 0.02 * t
            d = np.abs(z - zc) - (0.050 + 0.035 * t)
            return np.maximum(d, -(y + 0.30))
        return f
    return make


def face_white():
    def make(geo):
        def f(P):
            P = np.asarray(P, float)
            x, y, z = P[..., 0], P[..., 1], P[..., 2]
            front = y - (0.02 - 0.30 * np.clip((np.abs(x) - 0.25) / 0.3, 0, 1))
            return np.maximum(front, z - 4.62)
        return f
    return make


def params(ctx):
    o = ctx.opts
    fr = P6.Frame(ctx.spec)
    zb = fr.collar_design_z() - 0.16
    a = np.array([0.0, 0.14, 3.64])
    b = np.array([0.0, 0.06, zb])
    neck_f, _ = P6.curve_tube([a, (a + b) / 2 + np.array([0, 0.06, 0]), b], [0.17, 0.155, 0.16], 5)
    return dict(
        cran=dict(c=(0.0, 0.08, 4.16), r=(0.49, 0.58, 0.54)),
        face=dict(c=(0.0, -0.12, 4.10), r=(0.40, 0.38, 0.33), k=0.16),
        cheek=dict(c=(0.22, -0.12, 3.92), r=(0.25, 0.30, 0.24), k=0.15),
        chin=dict(c=(0.0, -0.22, 3.74), r=(0.19, 0.25, 0.14), k=0.12),
        neck=dict(a=(0.0, 0.14, 3.66), b=(0.0, 0.14, 3.40), r=0.17, k=0.12),
        nape=dict(c=(0.0, 0.26, 3.86), r=(0.27, 0.28, 0.24), k=0.14),
        extra=[(0.10, neck_f)],
        eye=dict(x=0.20, z=4.22, axis=(0.30, -1.0, 0.02), W=0.13, H=0.18, lid_drop=o.get('lid', 3.0)),
        beak=dict(z=3.98, len=0.2, w=0.1, h=0.08, droop=0.0),       # replaced by the dagger in features()
        brow=dict(z=4.45, x0=0.07, x1=0.33, arch=0.04, thick=0.05, mat='mask', tilt=0.05 if o.get('stern', True) else 0.0),
        regions=[('mask', stripe()), ('fur_light', face_white())],
    )


def plumes(ctx, head, geo, L=0.75):
    """Two long black plumes trailing from the back of the head (under the cap band), the second shorter."""
    root = K.march_to(geo.f, np.array([0.0, 1.2, 4.20]), (0, -1, 0)) + np.array([0.0, -0.04, 0.0])
    for i, (dx, ln, dz) in enumerate(((0.035, 1.0, 0.0), (-0.035, 0.78, -0.06))):
        r0 = root + np.array([dx, 0.0, dz])
        ctrl = [r0, r0 + np.array([dx * 2, 0.30 * ln * L / 0.75, -0.04]), r0 + np.array([dx * 3, 0.62 * ln * L / 0.75, -0.18]),
                r0 + np.array([dx * 3.5, 0.82 * ln * L / 0.75, -0.36 * ln])]
        path = K.curve_pts(ctrl, 5)
        u = np.linspace(0, 1, len(path))
        head.parts.append(P6.feather_blade(path, 0.045 * (1 - u) ** 0.6 + 0.008, 0.016 * (1 - u * 0.5) + 0.006, 'mask', 'plume',
                                           n=6 if K.LOD == 0 else 4, up=(0, 0, 1)))


def features(ctx, head, geo):
    o = ctx.opts
    beak, y0 = dagger(geo.f, o)
    P6.replace_beak(head, geo, beak)
    plumes(ctx, head, geo, L=0.75 * o.get('plume', 1.0))
    P6.card_extras(ctx, head, geo)


def build(ctx):
    return B.build(ctx, params(ctx), features)

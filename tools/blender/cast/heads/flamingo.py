# flamingo.py - a pink flamingo: a small round head on a long, gracefully bowed neck (the stub reaches down into the
# collar), the unmistakable bent bill (pale at the base, bending sharply down at the middle, a black tip) and long
# legs (species build). Head options: beak (size), bend (extra droop of the tip), neck_bow (how far the neck bows
# back), lid (heavy lids), worry (brows), monocle (a gold monocle over his left eye), tuft (a feather cowlick
# poking out under the cap brim). The pitcher's look.hair 'mustache' becomes a waxed handlebar across the bill.
import math
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
    'build_over': {'neck': 2.1, 'leg': 1.28, 'hipw': 0.86},
    'colors': {'beak': '#F6E4DC', 'skin': '#E86A78', 'horn': '#D8AE48'},
    'body_over': {'hand_mat': 'feather', 'tail_mat': 'feather', 'tail_tip_mat': 'fur_dark', 'tail_len': 0.62,
                  'neck_r': 0.78, 'thigh': 0.74, 'cuff': 0.82},
}


def bill(f, o):
    """The bent bill: a thick base reaching forward, bending sharply down at the middle, a blunt tip; the gape runs
    along the inner side of the bend (the outer, upper mandible is the big curve). Black tip region."""
    bs = o.get('beak', 1.0)
    bend = o.get('bend', 0.0)
    z0 = 3.97
    y0 = K.surface_y(f, 0.0, z0)
    ctrl = [np.array([0.0, y0 + 0.10, z0]),
            np.array([0.0, y0 - 0.22 * bs, z0 - 0.01]),
            np.array([0.0, y0 - 0.40 * bs, z0 - 0.09 * bs]),
            np.array([0.0, y0 - 0.50 * bs, z0 - (0.25 + bend) * bs]),
            np.array([0.0, y0 - (0.51 - bend * 0.5) * bs, z0 - (0.39 + bend * 1.3) * bs])]
    radii = np.array([0.19, 0.165, 0.128, 0.088, 0.050]) * bs ** 0.5
    tube, pts = P6.curve_tube(ctrl, radii, 6)
    c = np.mean(ctrl, 0)
    shape = P6.squash(tube, (0.92, 1.0, 1.0), c)
    # gape: the centre line shifted toward the inner side of the bend (positive side = outer)
    g = []
    for i in range(len(pts)):
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, len(pts) - 1)]
        t = (b - a)[1:3]
        t = t / max(np.linalg.norm(t), 1e-9)
        npos = np.array([t[1], -t[0]])
        u = i / (len(pts) - 1)
        r = np.interp(u, np.linspace(0, 1, len(radii)), radii)
        q = pts[i].copy()
        q[1:3] -= npos * r * 0.28
        g.append(q)
    g = [g[0] + (g[0] - g[1]) * 3] + g + [g[-1] + (g[-1] - g[-2]) * 3]
    polyl = list(pts)

    def tip_region(P):
        d, par = SD.polyline_dist(P, polyl)
        u = par / (len(polyl) - 1)
        return 0.76 - u
    hinge = np.array([0.0, y0 + 0.07, z0 - 0.06])
    lo = c - np.array([0.4, 0.6, 0.6])
    hi = c + np.array([0.4, 0.6, 0.5])
    return P6.Beak(shape, g, hinge, lo, hi, open_deg=22.0, lift_deg=5.0, regions=[('fur_dark', tip_region)],
                   tris=(340, 240), back_y=y0 + 0.02, half_w=0.15), ctrl, y0


def params(ctx):
    o = ctx.opts
    fr = P6.Frame(ctx.spec)
    zb = fr.collar_design_z() - 0.16
    bow = o.get('neck_bow', 0.10)
    a = np.array([0.0, 0.14, 3.62])
    b = np.array([0.0, 0.06, zb])
    m1 = a + (b - a) * 0.30 + np.array([0, -bow * 0.5, 0])
    m2 = a + (b - a) * 0.66 + np.array([0, bow * 1.6, 0])
    nr = o.get('neck_r', 1.0)
    neck_f, _ = P6.curve_tube([a, m1, m2, b], np.array([0.16, 0.135, 0.13, 0.145]) * nr, 5)
    return dict(
        cran=dict(c=(0.0, 0.06, 4.16), r=(0.51, 0.53, 0.56)),
        face=dict(c=(0.0, -0.14, 4.10), r=(0.42, 0.36, 0.35), k=0.16),
        cheek=dict(c=(0.24, -0.12, 3.90), r=(0.27, 0.29, 0.26), k=0.15),
        chin=dict(c=(0.0, -0.22, 3.72), r=(0.20, 0.24, 0.15), k=0.12),
        neck=dict(a=(0.0, 0.12, 3.68), b=(0.0, 0.13, 3.50), r=0.16, k=0.12),
        nape=dict(c=(0.0, 0.22, 3.82), r=(0.28, 0.27, 0.24), k=0.14),
        extra=[(0.10, neck_f)],
        eye=dict(x=0.20, z=4.22, axis=(0.26, -1.0, 0.03), W=0.135, H=0.195, lid_drop=o.get('lid', 0.0)),
        beak=dict(z=3.95, len=0.2, w=0.1, h=0.08, droop=0.0),          # replaced by the bent bill in features()
        brow=dict(z=4.49, x0=0.07, x1=0.34, arch=0.09, thick=0.042, mat='mask', tilt=-0.07 if o.get('worry') else -0.04),
        regions=[],
    )


def monocle(head, geo, side=1, mat='horn'):
    """A gold-rimmed monocle over one eye with a little chain looping down to the cheek."""
    import rk_body as BD
    eyes = geo.eyes
    piv, R = eyes.frame(side)
    c = eyes.sph(piv, R, eyes.R + 0.045, 0, -0.01)
    rr = max(eyes.W, eyes.H) + 0.035
    ring = [c + R @ np.array([math.cos(t) * rr * 0.95, math.sin(t) * rr, 0]) for t in np.linspace(0, 2 * math.pi, 20, endpoint=False)]
    p = BD.ring_sweep(ring, 0.022, 0.020, 5, True, mat, normals=[R[:, 2]] * len(ring))
    p.rigid('head')
    out = [K.orient_outward(p)]
    a = c + R @ np.array([side * rr * 0.6, -rr * 0.8, 0])
    end = K.march_to(geo.f, a + np.array([side * 0.75, 0.25, -0.30]), (-side, 0.0, 0.25)) + np.array([0, 0, 0])
    mid = (a + end) / 2 + np.array([side * 0.06, -0.06, -0.14])
    out.append(K.tube(K.curve_pts([a, mid, end], 5), 0.009, 4, mat, 'monocle_chain'))
    head.parts += out
    return out


def features(ctx, head, geo):
    o = ctx.opts
    beak, ctrl, y0 = bill(geo.f, o)
    P6.replace_beak(head, geo, beak)
    if ctx.acc.get('hair') == 'mustache':
        # across the top of the bill near its base, curling up over the cheeks
        z = 4.02
        yb = K.march_to(beak.upper_sdf(), np.array([0.0, y0 - 1.0, z]), (0, 1, 0))[1]
        P6.handlebar(head, np.array([0.0, yb - 0.005, z]), w=0.30, thick=0.03, curl=0.075, mat=ctx.acc.get('hair_mat', 'fur_dark'), droop=0.035)
    if o.get('monocle'):
        monocle(head, geo, side=1)
    if o.get('tuft'):
        base = np.array([0.0, -0.30, 4.62])
        for i, (dx, h) in enumerate(((-0.06, 0.20), (0.04, 0.26), (0.12, 0.17))):
            tip = base + np.array([dx * 1.8, -0.22, h])
            mid = base + np.array([dx, -0.08, h * 0.55])
            path = K.curve_pts([base + [dx, 0.05, -0.05], mid, tip], 4)
            head.parts.append(K.tube(path, np.linspace(0.05, 0.012, len(path)), 5, 'feather', 'cowlick', bone='cap'))
    P6.card_extras(ctx, head, geo)


def build(ctx):
    return B.build(ctx, params(ctx), features)

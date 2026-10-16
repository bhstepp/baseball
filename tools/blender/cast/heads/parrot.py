# parrot.py - a scarlet macaw: a round red head with a big cream face patch (the card's face mark; optional thin
# feather streaks under the eyes), and the big hooked bill - a yellow upper mandible curling down over a small dark-grey
# lower one. Head options: beak (size), crest (a feather topknot out of the back of the cap), lid, brow_tilt,
# streaks (the face lines). The catcher (no 'catcher' gear: a cage can't fit the hook) gets the chest protector and
# shin guards from the head module (head option catcher_gear).
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
    'build': 'small',
    'colors': {'beak': '#F2C24E', 'hoof': '#4A4448'},
    'body_over': {'hand_mat': 'feather', 'tail_mat': 'feather', 'tail_tip_mat': 'feather_accent', 'tail_len': 1.15},
}


def hooked(f, o):
    bs = o.get('beak', 1.0)
    z0 = 4.02
    y0 = K.surface_y(f, 0.0, z0)
    up = [np.array([0.0, y0 + 0.12, z0 + 0.03]), np.array([0.0, y0 - 0.14 * bs, z0 + 0.04 * bs]),
          np.array([0.0, y0 - 0.30 * bs, z0 - 0.08 * bs]), np.array([0.0, y0 - 0.32 * bs, z0 - 0.27 * bs]),
          np.array([0.0, y0 - 0.23 * bs, z0 - 0.40 * bs])]
    ur = np.array([0.19, 0.165, 0.125, 0.075, 0.028]) * bs ** 0.5
    ut, upts = P6.curve_tube(up, ur, 6)
    cu = np.mean(up, 0)
    upper = P6.squash(ut, (0.84, 1.0, 1.0), cu)
    lo = [np.array([0.0, y0 + 0.08, z0 - 0.14 * bs]), np.array([0.0, y0 - 0.07 * bs, z0 - 0.18 * bs]),
          np.array([0.0, y0 - 0.15 * bs, z0 - 0.16 * bs])]
    lr = np.array([0.12, 0.095, 0.05]) * bs ** 0.5
    lt, _ = P6.curve_tube(lo, lr, 5)
    lower = P6.squash(lt, (0.86, 1.0, 1.0), np.mean(lo, 0))
    # gape: from behind the hinge, along the top of the lower mandible, then up the inside of the hook
    g = [np.array([0.0, y0 + 0.6, z0 - 0.08]), np.array([0.0, y0 + 0.04, z0 - 0.09 * bs]),
         np.array([0.0, y0 - 0.17 * bs, z0 - 0.10 * bs]), np.array([0.0, y0 - 0.26 * bs, z0 - 0.22 * bs]),
         np.array([0.0, y0 - 0.20 * bs, z0 - 0.44 * bs])]
    hinge = np.array([0.0, y0 + 0.06, z0 - 0.12])
    whole = SD.union(upper, lower)
    allr = [('hoof', lambda P: np.full(np.asarray(P).shape[:-1], -1.0))]
    return P6.Beak(whole, g, hinge, cu - 0.6, cu + 0.6, open_deg=24.0, lift_deg=6.0, upper_shape=upper, lower_shape=lower,
                   regions=[], regions_lo=allr, tris=(300, 150), back_y=y0 + 0.04, half_w=0.16)


def face_patch():
    """The cream face: a big oval over the front of the face round the eyes and down to the bill (card 'face')."""
    def make(geo):
        def f(P):
            P = np.asarray(P, float)
            x, y, z = P[..., 0], P[..., 1], P[..., 2]
            d = np.hypot(x / 0.50, (z - 4.04) / 0.36) - 1.0
            return np.maximum(d * 0.3, y + 0.10)
        return f
    return make


def streaks(n=3):
    """Thin feather lines across the cream cheeks under each eye (macaw face lines)."""
    def make(geo):
        e = geo.P['eye']

        def f(P):
            P = np.asarray(P, float)
            x, z = np.abs(P[..., 0]), P[..., 2]
            out = np.full(P.shape[:-1], 1.0)
            for i in range(n):
                zc = e['z'] - 0.20 - 0.075 * i - 0.25 * (x - e['x']) ** 2
                band = np.abs(z - zc) - 0.011
                band = np.maximum(band, np.abs(x - (e['x'] + 0.02)) - (0.11 - 0.02 * i))
                out = np.minimum(out, band)
            return np.maximum(out, P[..., 1] + 0.12)
        return f
    return make


def params(ctx):
    o = ctx.opts
    regs = [('fur_light', face_patch())]
    if o.get('streaks', False):
        regs = [('mask', streaks())] + regs
    return dict(
        cran=dict(c=(0.0, 0.08, 4.16), r=(0.56, 0.57, 0.61)),
        face=dict(c=(0.0, -0.14, 4.10), r=(0.46, 0.38, 0.38), k=0.16),
        cheek=dict(c=(0.27, -0.12, 3.90), r=(0.30, 0.31, 0.28), k=0.15),
        chin=dict(c=(0.0, -0.24, 3.70), r=(0.24, 0.26, 0.17), k=0.12),
        eye=dict(x=0.215, z=4.22, axis=(0.24, -1.0, 0.03), W=0.14, H=0.19, lid_drop=o.get('lid', 0.0)),
        beak=dict(z=3.96, len=0.2, w=0.1, h=0.08, droop=0.0),           # replaced by the hook in features()
        brow=dict(z=4.48, x0=0.07, x1=0.36, arch=0.08, thick=0.05, mat='mask', tilt=o.get('brow_tilt', -0.03)),
        regions=regs,
        skin_tris=o.get('skin_tris', 2300),
    )


def crest(ctx, head, geo, size=1.0):
    """A topknot of three feathers springing from the back of the head over the cap's back band (rides on the cap)."""
    root = np.array([0.0, 0.42, 4.62])
    for dx, h, lean in ((0.0, 0.42, 0.0), (0.09, 0.32, 0.10), (-0.09, 0.32, -0.10)):
        ctrl = [root + [dx * 0.4, 0.0, -0.06], root + [dx + lean * 0.3, 0.10, h * 0.55 * size], root + [dx * 1.6 + lean, 0.30, h * size]]
        path = K.curve_pts(ctrl, 5)
        u = np.linspace(0, 1, len(path))
        p = P6.feather_blade(path, 0.06 * np.sin(np.clip(u * 1.2, 0.05, 1) * np.pi) + 0.012, 0.018, 'feather', 'crest',
                             bone='cap', n=6 if K.LOD == 0 else 4, up=(0, 1, 0))
        p.mat = ['feather_accent' if c[2] > root[2] + h * size * 0.62 else 'feather' for c in [p.V[f].mean(0) for f in p.F]]
        head.parts.append(p)


def features(ctx, head, geo):
    o = ctx.opts
    P6.replace_beak(head, geo, hooked(geo.f, o))
    if o.get('crest'):
        crest(ctx, head, geo, size=o.get('crest', 1.0))
    if o.get('catcher_gear'):
        P6.catcher_gear(head, P6.Frame(ctx.spec), K.LOD)
    P6.card_extras(ctx, head, geo)


def build(ctx):
    return B.build(ctx, params(ctx), features)

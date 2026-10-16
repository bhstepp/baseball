# puffin.py - Atlantic puffin: a round dark head with a big white face mask (white cheeks, dark crown, nape and
# throat), white brows on the dark crown, orange eye rings with a dark streak behind each eye, and the tall, flat
# triangular beak in bands: slate base, a yellow ridge line, orange tip. Gum (card accessory) blows a bubble at the
# beak tip. Head options (spec.head): beak (size factor).
# The beak is this module's own two-part loft (the same construction as gull.py, kept self-contained so each species'
# head cache depends on its own module only).
import math
import numpy as np
import hkit as K
import rk_sdf as SD
import rk_geo as G
import rk_mesh as MS
from rk_geo import Part, nrm
from heads import fam_bird as B
from heads import fam_mammal as M

FAMILY = 'bird'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'bird',
    'tail': 'fan',
    'build': 'stocky',
    'colors': {'beak': '#EE6A2E', 'skin': '#F2B632', 'horn': '#4A4E62'},
    'body_over': {'hand_mat': 'feather', 'tail_mat': 'feather', 'tail_tip_mat': 'feather_accent', 'tail_size': 0.75},
}


# ------------------------------------------------------------------------------------------- the lofted beak
class LoftBeak:
    """Two-part beak lofted from the face (s = 0) to the tip (s = 1) along -y: elliptic sections over / under a gape
    line that droops; the upper mandible hooks down past the lower's tip; the lower can carry a gonys bump."""
    def __init__(self, f, z, length, w, up, lo, droop=0.05, hook=0.05, gonys=0.0, tip_w=0.02, lo_end=0.95,
                 open_deg=26.0, bury=0.14, w_pow=0.55):
        y0 = K.surface_y(f, 0.0, z)
        self.y0, self.z, self.L = y0, z, length
        self.yb = y0 + bury
        self.w, self.up, self.lo = w, up, lo
        self.droop, self.hook, self.gonys, self.tip_w, self.lo_end = droop, hook, gonys, tip_w, lo_end
        self.open = open_deg
        self.w_pow = w_pow
        self.hinge = np.array([0.0, y0 + 0.06, z - lo * 0.3])
        self.face_y = y0
        self.base = np.array([0.0, self.yb, z])
        self.tip = np.array([0.0, y0 - length, z - droop])

    def s_of(self, y):
        return (self.y0 - y) / self.L

    def gape(self, s):
        return self.z - self.droop * np.clip(s, 0, 1.2) ** 1.4

    def width(self, s):
        s = np.clip(s, 0, 1)
        return (self.w - self.tip_w) * (1 - s) ** self.w_pow + self.tip_w

    def hook_dz(self, s):
        return -self.hook * K.sm(0.80, 1.0, s) ** 1.3

    def h_up(self, s):
        s = np.clip(s, 0, 1)
        return self.up * (1 - s) ** 0.75 + 0.022

    def h_lo(self, s):
        s = np.clip(s, 0, 1)
        return self.lo * (1 - s) ** 0.8 + 0.016 + self.gonys * np.exp(-((s - 0.72) / 0.10) ** 2)

    def upper_sdf(self):
        def f(P):
            P = np.asarray(P, float)
            x, y, z = P[..., 0], P[..., 1], P[..., 2]
            s = self.s_of(y)
            sc = np.clip(s, 0, 1)
            g = self.gape(sc) + self.hook_dz(sc)
            a, b = self.width(sc), self.h_up(sc)
            q = np.sqrt((x / a) ** 2 + ((z - g) / b) ** 2)
            d = (q - 1.0) * np.minimum(a, b)
            d = SD.smax(d, (g - 0.012 * K.sm(0.8, 1.0, sc)) - z, 0.006)
            d = SD.smax(d, (s - 1.0) * self.L, 0.012)
            return SD.smax(d, y - self.yb, 0.01)
        return f

    def lower_sdf(self):
        def f(P):
            P = np.asarray(P, float)
            x, y, z = P[..., 0], P[..., 1], P[..., 2]
            s = self.s_of(y)
            sc = np.clip(s, 0, self.lo_end)
            g = self.gape(sc)
            a, b = self.width(sc) * 0.93, self.h_lo(sc)
            q = np.sqrt((x / a) ** 2 + ((z - g) / b) ** 2)
            d = (q - 1.0) * np.minimum(a, b)
            d = SD.smax(d, z - g, 0.006)
            d = SD.smax(d, (s - self.lo_end) * self.L, 0.012)
            return SD.smax(d, y - self.yb, 0.01)
        return f

    def parts(self, mat='beak', inner='mouth', regions_up=(), regions_lo=(), tongue=True):
        c = np.array([0.0, self.y0 - self.L * 0.45, self.z - self.droop * 0.5])
        span = self.L * 0.6 + max(self.up, self.lo, self.w) + 0.25
        lo_, hi_ = c - span, c + span
        out = []
        for name, f, regs, bone, tris in (('beak_up', self.upper_sdf(), regions_up, 'head', 300),
                                          ('beak_lo', self.lower_sdf(), regions_lo, 'jaw', 220)):
            V, F = MS.sdf_mesh(f, lo_, hi_, K.hq(0.0065), tris=K.tq(int(tris * (0.6 + 0.5 * self.L)), int(tris * 0.42)))
            # inner faces along the gape show as the open mouth
            if name == 'beak_up':
                inside = lambda Q: (np.asarray(Q)[..., 2] - (self.gape(np.clip(self.s_of(np.asarray(Q)[..., 1]), 0, 1))
                                                            + self.hook_dz(np.clip(self.s_of(np.asarray(Q)[..., 1]), 0, 1)) + 0.004))
            else:
                inside = lambda Q: (self.gape(np.clip(self.s_of(np.asarray(Q)[..., 1]), 0, 1)) - 0.004) - np.asarray(Q)[..., 2]
            rr = [(inner, inside)] + list(regs)
            for _, rf in rr:
                V, F = MS.cut_by_field(V, F, rf, surf=f)
            p = Part(V, F, MS.faces_by_region(V, F, rr, mat), name)
            K.orient_outward(p)
            p.rigid(bone)
            out.append(p)
        pu, pl = out
        if tongue and K.LOD == 0:
            s0 = 0.30
            tc = np.array([0.0, self.y0 - self.L * s0, self.gape(s0) - 0.012])
            tg = SD.ellipsoid(tc, (self.width(s0) * 0.55, self.L * 0.18, 0.03))
            V, F = MS.sdf_mesh(tg, tc - 0.4, tc + 0.4, 0.008, tris=60)
            pt = Part(V, F, 'tongue', 'tongue')
            pt.rigid('jaw')
            out.append(pt)
        self.keys(out)
        return out

    def keys(self, parts):
        ang = np.radians(self.open)
        for p in parts:
            low = p.name != 'beak_up'
            a = ang if low else -np.radians(6)
            p.sk['mouth_open'] = K.rot_points(p.V, self.hinge, (1, 0, 0), np.full(p.n, a)) - p.V
            if p.name == 'tongue':
                continue
            back = G.smoothstep(self.y0 - 0.22, self.y0 + 0.02, p.V[:, 1])
            side = np.clip(np.abs(p.V[:, 0]) / (self.w + 1e-6), 0, 1)
            d = np.zeros_like(p.V)
            d[:, 2] = 0.045 * back * side
            p.sk['smile'] = d
            p.sk['frown'] = -d * 1.3
            sr = G.smoothstep(0.02, -0.06, p.V[:, 0])
            p.sk['smirk'] = d * sr[:, None] * 1.4


def replace_beak(head, geo, beak, parts):
    """Swap the family's cone beak for a module's own beak parts."""
    head.parts = [p for p in head.parts if p.name not in ('beak_up', 'beak_lo')] + parts
    geo.beak = beak
    head.joints['jaw'] = beak.hinge
    head.face_y = float(min(p.V[:, 1].min() for p in head.parts))


# ------------------------------------------------------------------------------------------- params / features
def params(ctx):
    P = dict(
        cran=dict(c=(0.0, 0.06, 4.14), r=(0.59, 0.57, 0.59)),
        face=dict(c=(0.0, -0.16, 4.07), r=(0.47, 0.38, 0.36), k=0.16),
        cheek=dict(c=(0.28, -0.15, 3.86), r=(0.33, 0.33, 0.30), k=0.15),
        chin=dict(c=(0.0, -0.28, 3.66), r=(0.27, 0.28, 0.18), k=0.12),
        eye=dict(x=0.22, z=4.19, axis=(0.20, -1.0, 0.03), W=0.135, H=0.185, pupil=(10.0, 14.0), ring='fur_dark',
                 lid='feather'),
        brow=dict(z=4.47, x0=0.07, x1=0.35, arch=0.07, thick=0.05, mat='fur_light', tilt=0.0),
        regions=[],
    )
    streak = [('feather', M.region_ellipsoid((s * 0.40, -0.18, 4.17), (0.16, 0.14, 0.028),
                                             R=G.rot_axis((0, 1.0, 0), -s * 0.35))) for s in (1, -1)]
    face = ('fur_light', M.region_ellipsoid((0.0, -0.30, 3.97), (0.62, 0.42, 0.40)))
    P['regions'] = streak + [face]
    return P


def features(ctx, head, geo):
    k = ctx.opts.get('beak', 1.0) * 1.22
    bk = LoftBeak(geo.f, 3.91, 0.42 * k, 0.085, 0.21 * k, 0.15 * k, droop=0.13 * k, hook=0.03, gonys=0.0, tip_w=0.018,
                  lo_end=0.92, w_pow=0.4, bury=0.12)

    def band(s0, s1):
        return lambda Q: np.maximum(s0 - bk.s_of(np.asarray(Q)[..., 1]), bk.s_of(np.asarray(Q)[..., 1]) - s1) * bk.L
    regs = [('horn', band(-1.0, 0.20)), ('skin', band(0.27, 0.33))]
    parts = bk.parts(regions_up=regs, regions_lo=regs)
    replace_beak(head, geo, bk, parts)
    if ctx.acc.get('gum'):
        s = 0.80
        K.gum_bubble(head, np.array([0.0, bk.y0 - bk.L * s, bk.gape(s) - 0.02]), r=0.105)


def build(ctx):
    return B.build(ctx, params(ctx), features)

# pelican.py - brown/white pelican: a smallish sleek head on a long neck, a very long flat beak with a hooked nail
# and a big throat pouch slung under the lower mandible (the pouch rides the jaw: mouth_open swings it down with the
# beak, cheeks_puff balloons it), a feather crest riding on the cap, cream cheek tufts (the old salt's whiskers).
# Head options (spec.head): beak (length factor), barnacles (n small barnacles stuck on the upper beak: 'Barnacle'),
# crest (size), tufts (cheek tufts, default on).
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

FAMILY = 'bird'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'bird',
    'tail': 'fan',
    'build': 'tall',
    'colors': {'beak': '#F2A23A', 'skin': '#F7B77A', 'horn': '#E4DED0'},
    'body_over': {'hand_mat': 'feather', 'tail_mat': 'feather', 'tail_tip_mat': 'feather_accent'},
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


# ------------------------------------------------------------------------------------------- pouch, crest, barnacles
def pouch(bk, mat='skin'):
    """The throat pouch: a soft sack under the lower mandible from its root to two thirds of its length."""
    s_mid = 0.42
    c = np.array([0.0, bk.y0 - bk.L * s_mid, bk.gape(s_mid) - 0.17])
    r = np.array([bk.width(s_mid) * 1.05, bk.L * 0.42, 0.215])

    def f(P):
        P = np.asarray(P, float)
        s = np.clip(bk.s_of(P[..., 1]), 0, 1)
        d = SD.ellipsoid(c, r)(P)
        d = SD.smooth_union(0.05, lambda Q: d, SD.ellipsoid(c + np.array([0, bk.L * 0.22, 0.05]), r * np.array([0.9, 0.55, 0.85])))(P)
        return SD.smax(d, P[..., 2] - (bk.gape(s) - 0.03), 0.02)
    lo, hi = c - r - 0.25, c + r + 0.25
    V, F = MS.sdf_mesh(f, lo, hi, K.hq(0.008), tris=K.tq(420, 60))
    p = Part(V, F, mat, 'pouch')
    K.orient_outward(p)
    p.rigid('jaw')
    p.sk['mouth_open'] = K.rot_points(p.V, bk.hinge, (1, 0, 0), np.full(p.n, np.radians(bk.open))) - p.V
    w = G.smoothstep(bk.gape(s_mid) - 0.02, bk.gape(s_mid) - 0.12, p.V[:, 2])
    p.sk['cheeks_puff'] = (p.V - (c + np.array([0, 0, 0.06]))) * np.array([0.45, 0.22, 0.55]) * w[:, None]
    p.sk['frown'] = np.stack([np.zeros(p.n), np.zeros(p.n), -0.05 * w], 1)
    return p


def crest(ctx, head, geo, size=1.0, mat='feather_accent'):
    """Two swept feather blades on top of the cap, curving back (rigid to the cap bone, like a comb)."""
    cr = geo.P['cran']
    top = np.array([0.0, cr['c'][1] + 0.02, cr['c'][2] + cr['r'][2] + 0.07])
    terms = []
    for i, (dx, h, back) in enumerate(((0.0, 0.34, 0.30), (0.05, 0.24, 0.26), (-0.05, 0.22, 0.22))):
        pts = [top + np.array([dx, -0.05, -0.04]), top + np.array([dx * 1.5, back * 0.3, h * 0.75 * size]),
               top + np.array([dx * 2, back * size, h * size])]
        terms.append(SD.ptube(list(K.curve_pts(pts, 5)), np.linspace(0.055, 0.012, 11)))
    g = SD.smooth_union(0.03, *terms)
    p = K.blob(g, top + np.array([0, 0.15, 0.15]), 0.6, 220, mat, 'crest', bone='cap', h=0.007)
    head.parts.append(p)
    return p


def barnacles(head, bk, n=3, mat='horn'):
    terms = []
    for i in range(n):
        s = 0.16 + 0.09 * i
        side = 1 if i % 2 == 0 else 0.6
        x = bk.width(s) * 0.82 * side
        z = bk.gape(s) + bk.h_up(s) * (0.45 + 0.15 * (i % 2))
        c = np.array([x, bk.y0 - bk.L * s, z])
        nn = nrm(np.array([x / max(bk.width(s), 1e-3), 0.0, 0.8]))
        r = 0.032 - 0.004 * i
        cone = SD.round_cone(c - nn * 0.02, c + nn * 0.035, r, r * 0.55)
        terms.append(SD.smooth_sub(0.006, cone, SD.sphere(c + nn * 0.045, r * 0.4)))
    g = SD.union(*terms)
    c0 = np.array([0.0, bk.y0 - bk.L * 0.25, bk.z])
    p = K.blob(g, c0, 0.45, 160, mat, 'barnacles', bone='head', h=0.005)
    head.parts.append(p)
    return p


# ------------------------------------------------------------------------------------------- params / features
def params(ctx):
    return dict(
        cran=dict(c=(0.0, 0.10, 4.15), r=(0.52, 0.55, 0.57)),
        face=dict(c=(0.0, -0.14, 4.07), r=(0.40, 0.37, 0.32), k=0.18),
        cheek=dict(c=(0.24, -0.11, 3.88), r=(0.27, 0.30, 0.25), k=0.15),
        chin=dict(c=(0.0, -0.26, 3.70), r=(0.22, 0.26, 0.15), k=0.12),
        eye=dict(x=0.20, z=4.22, axis=(0.20, -1.0, 0.03), W=0.13, H=0.185, pupil=(9.5, 14.0)),
        brow=dict(z=4.47, x0=0.07, x1=0.34, arch=0.06, thick=0.05, mat='mask', tilt=0.0),
    )


def features(ctx, head, geo):
    o = ctx.opts
    k = o.get('beak', 1.0)
    bk = LoftBeak(geo.f, 3.97, 1.22 * k, 0.125, 0.07, 0.05, droop=0.04, hook=0.07, gonys=0.0, tip_w=0.03, lo_end=0.93,
                  w_pow=0.35)
    parts = bk.parts()
    parts.append(pouch(bk))
    replace_beak(head, geo, bk, parts)
    if o.get('barnacles', 0):
        barnacles(head, bk, n=int(o['barnacles']))
    crest(ctx, head, geo, size=o.get('crest', 1.0))
    if o.get('tufts', True):
        B.cheek_tufts(ctx, head, geo, mat='fur_light', n=2, size=0.10)


def build(ctx):
    return B.build(ctx, params(ctx), features)

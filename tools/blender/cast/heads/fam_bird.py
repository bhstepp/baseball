# fam_bird.py - the BIRD head family (hen, rooster, pigeon, gull, owl, goose ...): a round feathered head with puffy
# cheeks, carved eyes (hkit.EyeRig), feather brows and a two-part beak (upper rigid to the head, lower on the jaw
# bone: mouth_open opens the beak). Combs, wattles and crests are species features. Birds have no grin (contract);
# smile / frown / smirk / cheeks_puff move the cheek feathers and the beak's gape.
import math
import copy
import numpy as np
import hkit as K
import rk_sdf as SD
import rk_geo as G
import rk_mesh as MS
from rk_geo import Part, nrm

DEFAULTS = dict(
    cran=dict(c=(0.0, 0.06, 4.13), r=(0.58, 0.56, 0.62)),
    face=dict(c=(0.0, -0.16, 4.10), r=(0.46, 0.38, 0.36), k=0.16),
    cheek=dict(c=(0.27, -0.16, 3.86), r=(0.31, 0.32, 0.29), k=0.15),
    chin=dict(c=(0.0, -0.30, 3.66), r=(0.26, 0.28, 0.18), k=0.12),
    neck=dict(a=(0.0, 0.10, 3.62), b=(0.0, 0.10, 3.00), r=0.225, k=0.14),
    nape=dict(c=(0.0, 0.24, 3.76), r=(0.33, 0.30, 0.26), k=0.14),
    extra=[],
    eye=dict(x=0.215, z=4.20, axis=(0.20, -1.0, 0.03), R=0.40, W=0.145, H=0.20, out=0.036, rim=0.04, lid='feather',
             pupil=(10.0, 14.5), lid_drop=0.0, ring='mask'),
    beak=dict(z=3.93, len=0.44, w=0.19, h=0.15, droop=0.10, lower=0.55, open=26.0, mat='beak'),
    brow=dict(z=4.46, x0=0.07, x1=0.36, arch=0.07, thick=0.05, mat='mask', tilt=0.0),
    cap=dict(lift=0.0, brim=1.0, cranium=None),
    regions=[],
    skin_tris=2300,
    skin_mat='feather',
)


def merged(over):
    P = copy.deepcopy(DEFAULTS)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(P.get(k), dict):
            P[k] = dict(P[k])
            P[k].update(v)
        else:
            P[k] = v
    return P


class Geo:
    def __init__(self, P):
        self.P = P
        self.f = None
        self.cranium = None
        self.eyes = None
        self.mouth = None
        self.slots = []
        self.beak = None


def skull_sdf(P):
    cr = P['cran']
    f = SD.ellipsoid(cr['c'], cr['r'])
    fc = P['face']
    f = SD.smooth_union(fc['k'], f, SD.ellipsoid(fc['c'], fc['r']))
    ch = P['cheek']
    c = np.asarray(ch['c'], float)
    f = SD.smooth_union(ch['k'], f, SD.union(SD.ellipsoid(c, ch['r']), SD.ellipsoid(c * np.array([-1, 1, 1]), ch['r'])))
    if P.get('chin'):
        f = SD.smooth_union(P['chin']['k'], f, SD.ellipsoid(P['chin']['c'], P['chin']['r']))
    nk = P['neck']
    f = SD.smooth_union(nk['k'], f, SD.capsule(nk['a'], nk['b'], nk['r']))
    na = P['nape']
    f = SD.smooth_union(na['k'], f, SD.ellipsoid(na['c'], na['r']))
    for k, g in P.get('extra', []):
        f = SD.smooth_union(k, f, g)
    return f


# ------------------------------------------------------------------------------------------- beak
class BeakRig:
    """Two-part beak: a cone from the face (base at the face surface, height z) pointing forward and drooping to a
    tip; split along a gape line into the upper mandible (head) and lower mandible (jaw)."""
    def __init__(self, f, z, length, w, h, droop, lower, open_deg):
        self.z = z
        y0 = K.surface_y(f, 0.0, z)
        self.base = np.array([0.0, y0 + 0.10, z])            # buried a little in the face
        self.tip = np.array([0.0, y0 - length, z - droop])
        self.w, self.h = w, h
        self.lower = lower
        self.open = open_deg
        self.hinge = np.array([0.0, y0 + 0.06, z - h * 0.25])
        self.face_y = y0

    def gape(self, P):
        """Signed height above the gape line (the line from the hinge to the tip, slightly below the axis)."""
        P = np.asarray(P, float)
        t = np.clip((P[..., 1] - self.base[1]) / (self.tip[1] - self.base[1]), 0, 1)
        zc = self.base[2] - self.h * 0.22 + (self.tip[2] - self.base[2] + self.h * 0.18) * t
        return P[..., 2] - zc

    def cone(self, scale=1.0):
        a, b = self.base, self.tip
        cone = SD.round_cone(a, b, self.h * scale, 0.018)
        mid = (a + b) / 2
        return SD.scaled(cone, (self.w / self.h, 1.0, 1.0), mid)

    def parts(self):
        upper_f = self.cone(1.0)
        hook = SD.ellipsoid(self.tip + np.array([0, 0.03, -0.015]), (0.035, 0.05, 0.04))
        upper = SD.smooth_union(0.02, upper_f, hook)
        up = lambda P: SD.smax(upper(P), -self.gape(P) + 0.004, 0.012)
        low_cone = SD.scaled(SD.round_cone(self.base + np.array([0, 0, -self.h * 0.15]), self.tip + np.array([0, 0.10, -0.01]),
                                           self.h * 0.85, 0.02), (self.w / self.h * 0.9, 1.0, 1.0), (self.base + self.tip) / 2)
        lo = lambda P: SD.smax(low_cone(P), self.gape(P) + 0.004, 0.012)
        c = (self.base + self.tip) / 2
        span = np.linalg.norm(self.tip - self.base) / 2 + self.h + 0.1
        Vu, Fu = MS.sdf_mesh(up, c - span, c + span, K.hq(0.007), tris=K.tq(260, 40))
        Vl, Fl = MS.sdf_mesh(lo, c - span, c + span, K.hq(0.007), tris=K.tq(180, 30))
        pu = Part(Vu, Fu, 'beak', 'beak_up')
        pl = Part(Vl, Fl, 'beak', 'beak_lo')
        K.orient_outward(pu)
        K.orient_outward(pl)
        pu.rigid('head')
        pl.rigid('jaw')
        # mouth_open: the lower mandible drops about the hinge, the upper lifts a little
        ang = np.radians(self.open)
        pl.sk['mouth_open'] = K.rot_points(pl.V, self.hinge, (1, 0, 0), np.full(pl.n, ang)) - pl.V
        pu.sk['mouth_open'] = K.rot_points(pu.V, self.hinge, (1, 0, 0), np.full(pu.n, -np.radians(6))) - pu.V
        # smile / frown: the gape corners (back of the beak) curl up / down; smirk on his right only
        for p, sgn in ((pu, 1.0), (pl, 1.0)):
            back = G.smoothstep(self.base[1] - 0.20, self.base[1], p.V[:, 1])
            side = np.clip(np.abs(p.V[:, 0]) / (self.w + 1e-6), 0, 1)
            d = np.zeros_like(p.V)
            d[:, 2] = 0.04 * back * side
            p.sk['smile'] = d
            p.sk['frown'] = -d * 1.3
            sr = G.smoothstep(0.02, -0.06, p.V[:, 0])
            p.sk['smirk'] = d * sr[:, None] * 1.4
        return [pu, pl]


# ------------------------------------------------------------------------------------------- combs and wattles
def comb(ctx, head, geo, lobes=3, size=0.16, mat='skin', on_cap=True):
    """A red comb: a flat blade of rounded points standing front-to-back along the top of the head (on the cap crown:
    rigid to the cap bone)."""
    cr = geo.P['cran']
    top = np.array([0.0, cr['c'][1] - 0.04, cr['c'][2] + cr['r'][2] + (0.10 if on_cap else -0.02)])
    th = 0.05
    blade = SD.ellipsoid(top + np.array([0, 0, size * 0.35]), (th, size * (0.55 + 0.32 * lobes), size * 0.55))
    terms = [blade]
    for i in range(lobes):
        t = (i - (lobes - 1) / 2) / max((lobes - 1) / 2, 1)
        hgt = size * (1.15 + 0.55 * (1 - t * t))
        c = top + np.array([0.0, t * size * (0.5 + 0.3 * lobes) * 0.85, hgt * 0.62])
        terms.append(SD.ellipsoid(c, (th, size * 0.30, hgt * 0.42)))
    f = SD.smooth_union(0.025, *terms)
    p = K.blob(f, top + np.array([0, 0, size]), size * 2.2 + lobes * 0.08, 160 + lobes * 50, mat, 'comb',
               bone='cap' if on_cap else 'head', h=0.007)
    head.parts.append(p)
    return p


def cheek_tufts(ctx, head, geo, mat='feather', n=2, size=0.12):
    """Ear-covert feather tufts flaring from the sides of the head (a bird silhouette under the cap)."""
    out = []
    cr = geo.P['cran']
    for s in (1, -1):
        terms = []
        for i in range(n):
            a = np.array([s * (cr['r'][0] * 0.85), 0.10 + 0.08 * i, 3.98 - 0.14 * i])
            b = a + np.array([s * size * 1.6, 0.12, -0.05 - 0.04 * i])
            terms.append(SD.round_cone(a, b, size * 0.75, size * 0.18))
        f = SD.smooth_union(0.04, *terms)
        c = np.array([s * (cr['r'][0] + 0.05), 0.15, 3.9])
        out.append(K.blob(f, c, 0.55, 140, mat, 'tuft_' + ('L' if s > 0 else 'R')))
    head.parts += out
    return out


def wattle(ctx, head, geo, size=0.12, mat='skin'):
    """Two red lobes hanging under the beak (on the jaw)."""
    b = geo.beak
    root = b.base + np.array([0.0, -0.10, -b.h * 0.9])
    terms = []
    for s in (1, -1):
        c = root + np.array([s * 0.045, -0.02, -size * 0.9])
        terms.append(SD.ellipsoid(c, (0.05, 0.045, size)))
    f = SD.smooth_union(0.03, *terms)
    p = K.blob(f, root + np.array([0, 0, -size]), size * 2 + 0.1, 120, mat, 'wattle', bone='jaw', h=0.007)
    head.parts.append(p)
    return p


# ------------------------------------------------------------------------------------------- build
def skin_keys(geo):
    """Feather-face keys: smile / smirk lift the cheeks (smiling eyes), frown drops them, cheeks_puff puffs them."""
    ch = np.asarray(geo.P['cheek']['c'], float)
    cr = np.asarray(geo.P['cheek']['r'], float)
    f = geo.f

    def cheek_w(V):
        x, y, z = V[:, 0], V[:, 1], V[:, 2]
        return np.exp(-(((np.abs(x) - ch[0]) / (cr[0] * 0.9)) ** 2 + ((y - ch[1]) / cr[1]) ** 2 + ((z - ch[2]) / (cr[2] * 0.9)) ** 2))

    def smile(V):
        d = np.zeros_like(V)
        d[:, 2] = 0.06 * cheek_w(V)
        d[:, 1] = -0.01 * cheek_w(V)
        return d

    def frown(V):
        d = np.zeros_like(V)
        d[:, 2] = -0.045 * cheek_w(V)
        return d

    def puff(V):
        return SD.normals(f, V) * (0.11 * cheek_w(V))[:, None]

    def smirk(V):
        return smile(V) * 1.3 * G.smoothstep(0.05, -0.12, V[:, 0])[:, None]
    return {'smile': smile, 'frown': frown, 'cheeks_puff': puff, 'smirk': smirk}


def build(ctx, over, features=None):
    P = merged(over)
    head = K.Head()
    head.keys = [k for k in K.SHAPE_KEYS if k != 'grin']
    geo = Geo(P)
    f = skull_sdf(P)
    geo.f = f
    cr = P['cran']
    geo.cranium = P['cap'].get('cranium') or SD.ellipsoid(cr['c'], cr['r'])
    e = P['eye']
    geo.eyes = K.fit_eyes(f, x=e['x'], z=e['z'], axis=e['axis'], R=e['R'], W=e['W'], H=e['H'], out=e['out'],
                          lid_mat=e['lid'], rim=e['rim'], pupil=tuple(e['pupil']))
    geo.eyes.lid_drop = e.get('lid_drop', 0.0)
    geo.eyes.ring_mat = e.get('ring')
    bk = P['beak']
    geo.beak = BeakRig(f, bk['z'], bk['len'], bk['w'], bk['h'], bk['droop'], bk['lower'], bk['open'])
    regions = [(mat, mk(geo)) for mat, mk in P.get('regions', [])]
    lo = (-1.3, -1.4, 2.6)
    hi = (1.3, 1.0, cr['c'][2] + cr['r'][2] + 0.3)
    K.skin(head, f, regions, None, geo.eyes, lo=lo, hi=hi, tris=P.get('skin_tris', 2300), default=P.get('skin_mat', 'feather'),
           extra_keys=skin_keys(geo))
    for s in (1, -1):
        e_parts, pupils = geo.eyes.parts(s)
        head.parts += e_parts
        head.pupils += pupils
    head.joints['eye.L'] = geo.eyes.frame(1)[0]
    b = P['brow']
    K.brows(head, head.skin_f, z=b['z'], x0=b['x0'], x1=b['x1'], arch=b['arch'], thick=b['thick'], mat=b['mat'], tilt=b.get('tilt', 0.0))
    beak = geo.beak.parts()
    head.parts += beak
    head.joints['jaw'] = geo.beak.hinge
    head.joints['ear.L'] = np.array([0.50, 0.10, 4.25])
    head.face_y = float(min(p.V[:, 1].min() for p in head.parts))
    if features is not None:
        features(ctx, head, geo)
    accessories(ctx, head, geo)
    cp = P['cap']
    fit = K.cap_fit(cp.get('cran_c') or cr['c'], cp.get('cran_r') or cr['r'], lift=cp.get('lift', 0.0), brim=cp.get('brim', 1.0))
    if ctx.spec.get('cap', True):
        K.cap_parts(head, geo.cranium, fit['cap_c'], band_front=fit['band_front'], slots=geo.slots, brim_z=fit['brim_z'],
                    brim_r=fit['brim_r'], brim_y=fit['brim_y'], back=ctx.cap_back, cy=fit['cy'], band_y0=fit['band_y0'],
                    crown_mat=ctx.cap_mats[0], brim_mat=ctx.cap_mats[1], button_mat=ctx.cap_mats[2],
                    letter=ctx.spec.get('cap_letter', True))
    else:
        head.joints['cap'] = np.asarray(fit['cap_c'], float)
    head.geo = geo
    return head


def accessories(ctx, head, geo):
    acc = ctx.acc
    if acc.get('gum'):          # a bubble blown at the tip of the beak (rides on the jaw)
        bk = geo.beak
        c = bk.tip + np.array([0.0, -0.10, -0.03])
        p = K.blob(SD.sphere(c, 0.12), c, 0.25, 160, 'accessory_a', 'gum', bone='jaw')
        head.parts.append(p)
    if acc.get('shades'):
        K.shades(head, geo.eyes, mat='accessory_b')
    if acc.get('glasses'):
        K.round_glasses(head, geo.eyes, mat='accessory_b')
    if acc.get('eyeblack'):
        K.eyeblack(head, head.skin_f, geo.eyes, mat='mask')

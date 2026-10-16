# hkit.py - the HEAD KIT: shared builders for species heads (see docs/CAST-CONTRACT.md "Head kit").
# A species module (cast/heads/<species>.py) defines `build(ctx) -> Head`. Everything is modelled in Rocco's head
# DESIGN SPACE (feet; Z up, the face looks down -Y, the neck top / head joint at HEAD_PIVOT = (0, 0.06, 3.30), cranium
# around z 4.1) and placed on the character with  world = J['head'] + K * (p - HEAD_PIVOT),  K = 1.08 * build['head'].
import math
import numpy as np
import cast_common as CC  # noqa: F401
import rk_geo as G
import rk_sdf as SD
import rk_mesh as MS
import rk_rig as RR
import rk_body as BD
from rk_geo import Part, nrm, rot_axis

HEAD_PIVOT = np.array([0.0, 0.06, 3.30])
SHAPE_KEYS = ['blink', 'smile', 'grin', 'frown', 'mouth_open', 'brows_up', 'brows_angry', 'brows_sad', 'squint',
              'cheeks_puff', 'smirk']
# build quality: LOD0 = 1.0 / LOD 0; LOD1 lowers every triangle target and drops small inner pieces (set by cbuild)
QUALITY = 1.0
LOD = 0


def tq(n, lo=16):
    """Triangle target scaled by the build quality."""
    return max(lo, int(round(n * QUALITY)))


def hq(h, k=1.0):
    """Grid step scaled for the build quality (coarser sampling for LOD1)."""
    return h * (1.0 if QUALITY >= 0.99 else 1.0 + k * 0.6)


def sm(e0, e1, x):
    return G.smoothstep(e0, e1, x)


def sdf_part(f, lo, hi, h, tris, mat, name):
    V, F = MS.sdf_mesh(f, np.asarray(lo, float), np.asarray(hi, float), h, tris=tris)
    return Part(V, F, mat, name)


def orient_outward(p):
    return BD.orient_outward(p)


def march_to(f, p, d, steps=160):
    """Move point p along direction d until it reaches the surface of f."""
    p = np.array(p, float)
    d = nrm(np.asarray(d, float))
    for _ in range(steps):
        v = f(p[None])[0]
        if abs(v) < 0.0015:
            break
        p = p + d * max(min(v, 0.05), 0.0015) * (1 if v > 0 else -1)
    return p


def surface_y(f, x, z, y0=-2.2, y1=0.9, n=1601):
    """y of the first surface crossing walking +y from the front at (x, z) (the face surface)."""
    ys = np.linspace(y0, y1, n)
    P = np.stack([np.full_like(ys, x), ys, np.full_like(ys, z)], 1)
    v = f(P)
    i = int(np.argmax(v < 0))
    if v[i] >= 0:
        return None
    if i == 0:
        return ys[0]
    a, b = v[i - 1], v[i]
    return ys[i - 1] + (ys[i] - ys[i - 1]) * a / (a - b)


def fit_eyes(f, x=0.18, z=4.17, axis=(0.13, -1.0, 0.02), R=0.40, W=0.128, H=0.195, out=0.036, **kw):
    """EyeRig whose visible centre sits `out` in front of the face surface f at (x, z) (Rocco: 0.036)."""
    y = surface_y(f, x, z)
    return EyeRig(front=(x, y - out, z), axis=axis, R=R, W=W, H=H, **kw)


def fit_mouth(f, z0=3.70, W=0.30, curve=0.62, depth=0.56, jaw_back=0.68, **kw):
    """MouthRig fitted to the face surface f. front = the upper lip's most forward point (calibrated on Rocco:
    -0.857 vs his -0.86), recede = 0.75 x how far the upper lip sets back at the corners; the teeth rows are kept at
    least 0.05 behind the surface at their own height (snouts that overhang a recessed chin), jaw hinge `jaw_back`
    behind the lips."""
    def band_min(x, za, zb):
        ys = [surface_y(f, x, zz) for zz in np.linspace(za, zb, 7)]
        ys = [y for y in ys if y is not None]
        return min(ys) if ys else None
    zc = lambda x: z0 + curve * min(abs(x), W) ** 2
    up0 = band_min(0.0, z0, z0 + 0.08)
    upw = band_min(W, zc(W), zc(W) + 0.08)
    if upw is None:
        upw = up0 + 0.3
    front = up0
    recede = float(np.clip((upw - up0) * 0.75, 0.06, 0.45))
    xs = np.linspace(0.0, W, 7)
    rows = {}
    for name, dz in (('up', 0.04), ('lo', -0.04)):
        ys = []
        for x in xs:
            y = surface_y(f, x, zc(x) + dz)
            ys.append((y if y is not None else front + 0.3) + 0.07)
        rows[name] = (xs, np.array(ys))
    if 'jaw_open' not in kw or kw.get('jaw_open') is None:
        kw['jaw_open'] = 31.0 * 0.68 / max(jaw_back, 0.4)        # the same lip opening as Rocco on longer jaws
    ks = kw.pop('key_scale', None)
    m = MouthRig(z0=z0, W=W, curve=curve, front=front, recede=recede, back=front + depth, depth=depth,
                 jaw=(0.0, front + jaw_back, z0 + 0.12), cheek=(W + 0.06, front + 0.44, z0 + 0.12), **kw)
    m.rows = rows
    m.key_scale = ks or {}
    return m


class Ctx:
    """What a head module gets: the character spec, its colours, a seeded rng and the card face parameters.
    acc: card accessories (+ the spec's), cap_back: cap worn backwards, cap_mats: (crown, brim, button) materials."""
    def __init__(self, spec, colors=None, rng=None, face=None):
        self.spec = spec
        self.colors = colors or {}
        self.rng = rng if rng is not None else np.random.default_rng(int(spec.get('seed', 1)) & 0xFFFFFFFF)
        self.face = face or spec.get('face') or {}
        self.acc = dict(self.face.get('acc') or {})
        self.acc.update(spec.get('accessories', {}))
        self.opts = spec.get('head', {})
        self.boss = bool(spec.get('boss'))
        self.cap_back = bool(spec.get('cap_back', self.face.get('cap') == 'back'))
        self.cap_mats = tuple(spec.get('cap_mats', ('cap', 'cap_brim', 'team_b')))


class Head:
    """A built head (design space). parts: skin and pieces; pupils: separate mesh; joints: eye.L, brow.L, ear.L,
    jaw, cap; cap: cap-fitting info; anchors: named points for accessories."""
    def __init__(self):
        self.parts = []
        self.pupils = []
        self.joints = {}
        self.cap = None
        self.anchors = {}
        self.skin_f = None
        self.cranium = None
        self.top = 4.9
        self.cap_letter = None      # UV'd decal patch on the cap front (goes into the decals object)
        self.decals = []            # other UV'd pieces
        self.keys = list(SHAPE_KEYS)   # the face shape keys this head provides
        self.face_y = -1.0          # most forward point of the face (catcher mask fitting)
        self.info = {}


# ------------------------------------------------------------------------------------------- eyes
class EyeRig:
    """Rocco-style eyes: an oval window cut from a sphere centred on the eye bone, so rotating the bone slides the
    pupil exactly over the white. front = visible centre of the LEFT eye, axis = its look direction."""
    def __init__(self, front=(0.18, -0.575, 4.17), axis=(0.13, -1.0, 0.02), R=0.40, W=0.128, H=0.195, lid_mat='fur',
                 pupil=(9.0, 13.5), socket=True, rim=0.042, rim_mat=None, slit=False):
        self.front = np.array(front, float)
        self.axis = nrm(np.array(axis, float))
        self.R, self.W, self.H = R, W, H
        self.lid_mat = lid_mat
        self.pupil = pupil
        self.socket = socket
        self.rim = rim
        self.slit = slit
        self.lid_drop = 0.0        # degrees the resting upper lid sits lower (sleepy / mean glare)
        self.ring_mat = None       # an inked ring round the eye opening (card style), e.g. 'mask'
        self.ring_w = 0.022

    def frame(self, s=1):
        front = self.front * np.array([s, 1, 1])
        ax = self.axis * np.array([s, 1, 1])
        up = np.array([0, 0, 1.0])
        up = nrm(up - np.dot(up, ax) * ax)
        x = np.cross(up, ax)
        return front - ax * self.R, np.stack([x, up, ax], 1)

    def sph(self, piv, R, rad, az, el):
        d = R @ np.array([math.sin(az) * math.cos(el), math.sin(el), math.cos(az) * math.cos(el)])
        return piv + d * rad

    def angles(self):
        return math.asin(min(self.W / self.R, 0.95)), math.asin(min(self.H / self.R, 0.95))

    def socket_sdf(self):
        terms = []
        for s in (1, -1):
            piv, R = self.frame(s)
            terms.append(SD.ellipsoid(self.sph(piv, R, self.R - 0.03, 0, 0), (self.W + 0.01, self.H + 0.01, 0.07), R=R))
        return SD.union(*terms)

    def rim_sdf(self):
        rims = []
        for s in (1, -1):
            piv, R = self.frame(s)
            pts = []
            for i in range(40):
                t = 2 * math.pi * i / 40
                pts.append(self.sph(piv, R, self.R - 0.006, math.asin(min((self.W + 0.03) / self.R, 0.97)) * math.cos(t),
                                    math.asin(min((self.H + 0.03) / self.R, 0.97)) * math.sin(t)))
            rims.append(SD.ptube(pts, self.rim, closed=True))
        return SD.union(*rims)

    def parts(self, s):
        """Eye white + lids (head mesh, blink / squint keys) and pupil + highlight (pupil mesh, eye bone)."""
        sd = 'L' if s > 0 else 'R'
        piv, R = self.frame(s)
        aw, ah = self.angles()
        ER, EW, EH = self.R, self.W, self.H

        def white_sdf(P):
            q = (np.asarray(P, float) - piv) @ R
            sphd = np.linalg.norm(q, axis=-1) - ER
            ov = (np.sqrt((q[..., 0] / (EW + 0.03)) ** 2 + (q[..., 1] / (EH + 0.03)) ** 2) - 1.0) * min(EW, EH)
            back = (ER - 0.12) - q[..., 2]
            return SD.smax(SD.smax(sphd, ov, 0.01), back, 0.01)
        cen = piv + R[:, 2] * (ER - 0.06)
        V, F = MS.sdf_mesh(white_sdf, cen - 0.3, cen + 0.3, hq(0.008), tris=tq(110, 24))
        white = Part(V, F, 'eye_white', 'eye_white_' + sd)
        white.rigid('head')
        out = [white]
        mw, me = math.radians(5), math.radians(6)

        def az_half(el):
            k = np.clip(1.0 - (el / (ah + me)) ** 2, 0.06, 1.0)
            return (aw + mw) * np.sqrt(k)

        def lid_positions(par, el_from, el_to, r_out, thick):
            Vn = []
            for (u, v, outer) in par:
                el = el_from + (el_to - el_from) * v
                az = (2 * u - 1) * az_half(el)
                Vn.append(self.sph(piv, R, r_out if outer > 0.5 else r_out - thick, az, el))
            return np.array(Vn)
        import rk_head as RH
        top = ah + me
        rest_edge = ah - math.radians(2.5 + self.lid_drop)
        closed_edge = -ah - math.radians(3)
        nu_, nv_ = (8, 4) if LOD == 0 else (4, 2)
        lid_mat = self.lid_mat if isinstance(self.lid_mat, str) else self.lid_mat[0 if s > 0 else 1]
        up = RH.sphere_shell_patch(piv, R, ER + 0.026, 0.018, -aw, aw, top, rest_edge, nu=nu_, nv=nv_, mat=lid_mat)
        par = up.params
        base_pos = lid_positions(par, top, rest_edge, ER + 0.026, 0.018)
        up.V = base_pos
        up = RH.fix_orientation(up, piv)
        up.sk['blink'] = lid_positions(par, top, closed_edge, ER + 0.034, 0.018) - base_pos
        up.sk['squint'] = lid_positions(par, top, rest_edge - math.radians(17), ER + 0.027, 0.018) - base_pos
        up.rigid('head')
        out.append(up)
        bot = -ah - me
        lrest = -ah + math.radians(2)
        lo_ = RH.sphere_shell_patch(piv, R, ER + 0.024, 0.016, -aw, aw, bot, lrest, nu=nu_, nv=2 if LOD == 0 else 1, mat=lid_mat)
        parl = lo_.params
        lb = lid_positions(parl, bot, lrest, ER + 0.024, 0.016)
        lo_.V = lb
        lo_ = RH.fix_orientation(lo_, piv)
        lo_.sk['squint'] = lid_positions(parl, bot, lrest + math.radians(16), ER + 0.026, 0.016) - lb
        lo_.sk['blink'] = lid_positions(parl, bot, lrest + math.radians(7), ER + 0.025, 0.016) - lb
        lo_.rigid('head')
        out.append(lo_)
        pa, pe = math.radians(self.pupil[0]), math.radians(self.pupil[1])
        paz, pel = -math.radians(1.0) * s, -math.radians(2.0)

        def pupil_sdf(P, rad=ER + 0.007, aa=pa, ee=pe, caz=paz, cel=pel, th=0.02):
            q = (np.asarray(P, float) - piv) @ R
            r = np.linalg.norm(q, axis=-1)
            az = np.arctan2(q[..., 0], q[..., 2])
            el = np.arcsin(np.clip(q[..., 1] / np.maximum(r, 1e-9), -1, 1))
            ov = (np.sqrt(((az - caz) / aa) ** 2 + ((el - cel) / ee) ** 2) - 1.0) * min(aa, ee) * ER
            shell = np.abs(r - (rad - th / 2)) - th / 2
            return SD.smax(ov, shell, 0.004)
        c = self.sph(piv, R, ER, paz, pel)
        V, F = MS.sdf_mesh(pupil_sdf, c - 0.16, c + 0.16, 0.0055, tris=tq(90, 20))
        pupil = Part(V, F, 'pupil', 'pupil_' + sd)
        pupil.rigid('eye.' + sd)
        if LOD > 0:
            return out, [pupil]
        hl_az, hl_el = paz + math.radians(3.4), pel + math.radians(5.5)
        hsdf = lambda P: pupil_sdf(P, ER + 0.016, math.radians(2.5), math.radians(3.2), hl_az, hl_el, 0.014)
        c2 = self.sph(piv, R, ER, hl_az, hl_el)
        V, F = MS.sdf_mesh(hsdf, c2 - 0.08, c2 + 0.08, 0.004, tris=40)
        hl = Part(V, F, 'eye_white', 'hl_' + sd)
        hl.rigid('eye.' + sd)
        return out, [pupil, hl]


# ------------------------------------------------------------------------------------------- mouth
class MouthRig:
    """A carved mouth slit (mammals): line z = z0 + curve * x^2 for |x| < W, lips at y = front (+ recede toward the
    corners), jaw hinge for mouth_open, cheeks for smile / cheeks_puff. Shapes as on Rocco (open lips show teeth)."""
    def __init__(self, z0=3.70, W=0.30, curve=0.62, front=-0.86, recede=0.27, back=-0.30, half=0.03,
                 jaw=(0.0, -0.18, 3.82), jaw_open=31.0, cheek=(0.36, -0.42, 3.82), teeth='rows', tongue=True, depth=0.56):
        self.z0, self.W, self.curve, self.front, self.recede = z0, W, curve, front, recede
        self.back, self.half = back, half
        self.ds = depth / 0.56            # longer snouts: the cavity and the jaw region reach further back
        self.jaw = np.array(jaw, float)
        self.jaw_open = jaw_open
        self.cheek = np.array(cheek, float)
        self.teeth = teeth
        self.tongue = tongue

    def z(self, x):
        return self.z0 + self.curve * np.clip(x, -self.W, self.W) ** 2

    def slit_sdf(self):
        W, back, front = self.W, self.back, self.front

        def f(P):
            P = np.asarray(P, float)
            x, y, z = P[..., 0], P[..., 1], P[..., 2]
            dz = np.abs(z - self.z(x)) - self.half
            w = W * np.clip(1.0 - np.maximum(y - (front + 0.31 * self.ds), 0) / (0.3 * self.ds), 0.35, 1.0)
            dx = np.abs(x) - w
            dy = y - back
            dyf = -(y - (front - 0.44))
            q = np.stack([dz, dx, dy, dyf], -1)
            outside = np.linalg.norm(np.maximum(q[..., :3], 0), axis=-1)
            inside = np.minimum(np.max(q[..., :3], axis=-1), 0)
            return np.maximum(outside + inside, dyf)
        return f

    def lip_front(self, x):
        return self.front + self.recede * (np.clip(np.abs(x), 0, self.W) / self.W) ** 2

    def close(self, V, gap=0.010):
        """Close the carved slit at the front of the mouth to a thin line (in place)."""
        x, y, z = V[:, 0], V[:, 1], V[:, 2]
        zc = self.z(x)
        dz = z - zc
        lf = self.lip_front(x)
        w = sm(0.078, 0.050, np.abs(dz)) * sm(self.W + 0.06, self.W - 0.04, np.abs(x)) * sm(lf + 0.36, lf + 0.26, y)
        half = gap * 0.5
        newdz = np.sign(dz) * (half + np.maximum(np.abs(dz) - half, 0) * (1 - w))
        V[:, 2] = zc + np.where(np.abs(dz) < 0.078, newdz, dz)
        return V

    def jaw_weight(self, P, neck_z=3.42):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        below = sm(0.001, -0.004, z - self.z(x))
        front = sm(self.front + 0.76 * self.ds, self.front + 0.44 * self.ds, y)
        side = sm(self.W + 0.16, self.W - 0.02, np.abs(x))
        low = sm(neck_z - 0.12, neck_z, z)
        return below * front * side * low

    def keys(self, V, head_f):
        """Mouth shape keys for skin vertices (Rocco's set, generalised)."""
        x, y, z = V[:, 0], V[:, 1], V[:, 2]
        W = self.W
        wj = self.jaw_weight(V)
        ks = {}
        zc = self.z(x)
        near = sm(0.16, 0.0, np.abs(z - zc)) * sm(self.front + 0.61, self.front + 0.36, y)
        corner = sm(W - 0.17, W + 0.02, np.abs(x)) * sm(W + 0.2, W + 0.02, np.abs(x))
        above = sm(-0.001, 0.004, z - zc)
        belowm = 1 - above
        band_y = sm(self.front + 0.56, self.front + 0.31, y)
        lipband_up = above * sm(0.10, 0.0, z - zc) * band_y
        lipband_lo = belowm * sm(0.10, 0.0, zc - z) * band_y
        sgn = np.sign(x)
        cx, cy, cz = self.cheek
        ch = np.exp(-(((np.abs(x) - cx) / 0.16) ** 2 + ((z - cz) / 0.12) ** 2 + ((y - cy) / 0.2) ** 2))
        ang = np.radians(self.jaw_open) * wj
        Pj = rot_points(V, self.jaw, (1, 0, 0), ang)
        d = Pj - V
        d[:, 0] += sgn * 0.035 * corner * near
        d[:, 2] += -0.03 * corner * near
        d[:, 2] += 0.035 * lipband_up * sm(W, 0.0, np.abs(x))
        ks['mouth_open'] = d
        d = np.zeros_like(V)
        mid = sm(W + 0.05, 0.04, np.abs(x))
        d[:, 2] += 0.075 * lipband_up * mid - 0.060 * lipband_lo * mid
        d[:, 1] += 0.016 * (lipband_up + lipband_lo)
        d[:, 2] += 0.085 * corner * near
        d[:, 0] += sgn * 0.045 * corner * near
        d[:, 1] += 0.035 * corner * near
        d[:, 2] += 0.03 * ch
        ks['grin'] = d
        d = np.zeros_like(V)
        d[:, 2] += 0.10 * corner * near + 0.05 * (x / W) ** 2 * near * sm(W + 0.1, 0.0, np.abs(x))
        d[:, 1] += 0.04 * corner * near
        d[:, 0] += sgn * 0.025 * corner * near
        d[:, 2] += 0.025 * ch
        ks['smile'] = d
        d = np.zeros_like(V)
        d[:, 2] += -0.20 * corner * near - 0.26 * (x / W) ** 2 * near * sm(W + 0.1, 0.0, np.abs(x))
        d[:, 2] += 0.045 * near * sm(W * 0.8, 0.0, np.abs(x))
        d[:, 2] += (0.006 * lipband_up - 0.008 * lipband_lo) * sm(W + 0.02, W * 0.5, np.abs(x))
        d[:, 0] += -sgn * 0.03 * corner * near
        d[:, 2] += -0.02 * ch
        ks['frown'] = d
        d = np.zeros_like(V)
        sr = sm(0.06, -0.16, x)
        d[:, 2] += (0.17 * corner * near + 0.08 * (x / W) ** 2 * near * sm(W + 0.1, 0.0, np.abs(x))) * sr
        d[:, 1] += 0.05 * corner * near * sr
        d[:, 0] += sgn * 0.03 * corner * near * sr
        d[:, 2] += 0.022 * lipband_up * sm(W, 0.06, np.abs(x)) * sr
        d[:, 2] += 0.06 * ch * sr
        d[:, 2] += -0.012 * corner * near * (1 - sr)
        ks['smirk'] = d
        N = SD.normals(head_f, V)
        pw = np.exp(-(((np.abs(x) - (cx + 0.02)) / 0.2) ** 2 + ((z - (cz - 0.10)) / 0.15) ** 2 + ((y - (cy - 0.06)) / 0.22) ** 2))
        d = N * (0.12 * pw)[:, None]
        d[:, 0] += -sgn * 0.025 * corner * near
        ks['cheeks_puff'] = d
        for k, sc in (getattr(self, 'key_scale', None) or {}).items():
            if k in ks:
                ks[k] = ks[k] * sc
        return ks

    def inner_parts(self):
        """Teeth rows and tongue inside the cavity, with their own mouth shape keys."""
        parts = []
        if LOD > 0:
            return parts
        W, front = self.W, self.front

        rows = getattr(self, 'rows', None)

        def teeth_sdf(P, zoff, h):
            P = np.asarray(P, float)
            x, y, z = P[..., 0], P[..., 1], P[..., 2]
            yc = (front + 0.12) + 0.30 * (x / (W - 0.04)) ** 2
            if rows is not None:
                xs, ys = rows['up' if zoff > 0 else 'lo']
                yc = np.maximum(yc, np.interp(np.abs(x), xs, ys))
            zc = self.z(x) + zoff
            d = np.stack([np.abs(y - yc) - 0.022, np.abs(z - zc) - h, np.abs(x) - (W - 0.08)], -1)
            return np.linalg.norm(np.maximum(d, 0), axis=-1) + np.minimum(d.max(-1), 0) - 0.008
        c = np.array([0, front + 0.12, self.z0])
        if self.teeth == 'rows':
            for name, zoff, h, bone in (('teeth_up', 0.040, 0.024, 'head'), ('teeth_lo', -0.040, 0.022, 'jaw')):
                V, F = MS.sdf_mesh(lambda P, zo=zoff, hh=h: teeth_sdf(P, zo, hh), c - [0.5, 0.35, 0.15], c + [0.5, 0.35, 0.15], 0.0085, tris=80)
                p = Part(V, F, 'teeth', name)
                p.rigid(bone)
                zc_ = self.z(p.V[:, 0]) + zoff
                if bone == 'jaw':
                    Pj = rot_points(p.V, self.jaw, (1, 0, 0), np.full(p.n, np.radians(self.jaw_open)))
                    p.sk['mouth_open'] = Pj - p.V + np.array([0, -0.035, 0])
                    p.sk['grin'] = np.stack([np.zeros(p.n), np.full(p.n, -0.080), 0.020 + 0.45 * (p.V[:, 2] - zc_)], 1)
                else:
                    p.sk['mouth_open'] = np.tile([0, -0.045, 0.006], (p.n, 1))
                    p.sk['grin'] = np.stack([np.zeros(p.n), np.full(p.n, -0.082), -0.008 + 0.45 * (p.V[:, 2] - zc_)], 1)
                p.sk['smirk'] = np.tile([0, -0.025, 0.003], (p.n, 1))
                parts.append(p)
        if self.tongue:
            tc = np.array([0, front + 0.42, self.z0 - 0.065])
            tg = SD.ellipsoid(tc, (min(0.14, W * 0.47), 0.16, 0.035))
            V, F = MS.sdf_mesh(tg, tc - 0.3, tc + 0.3, 0.01, tris=60)
            p = Part(V, F, 'tongue', 'tongue')
            p.rigid('jaw')
            Pj = rot_points(p.V, self.jaw, (1, 0, 0), np.full(p.n, np.radians(self.jaw_open)))
            p.sk['mouth_open'] = Pj - p.V + np.array([0, -0.035, 0])
            p.sk['grin'] = np.tile([0, -0.01, -0.02], (p.n, 1))
            parts.append(p)
        return parts


def rot_points(P, axis_pt, axis, ang):
    axis = nrm(axis)
    out = np.empty_like(P)
    for i in range(len(P)):
        out[i] = axis_pt + rot_axis(axis, ang[i]) @ (P[i] - axis_pt)
    return out


# ------------------------------------------------------------------------------------------- skin
def skin(head, skin_f, regions, mouth=None, eyes=None, lo=(-1.25, -1.45, 2.6), hi=(1.25, 0.85, 5.1), h=0.0105,
         tris=2700, default='fur', extra_keys=None):
    """Mesh the head skin: carve eye sockets and the mouth slit, add eye rims, cut colour regions, close the mouth,
    weight (head / neck / jaw) and attach the face shape keys. regions: [(material, sdf_region)] (negative inside)."""
    f = skin_f
    if eyes is not None and eyes.rim:
        f = SD.smooth_union(0.03, f, eyes.rim_sdf())
    if eyes is not None and eyes.socket:
        f = SD.smooth_sub(0.012, f, eyes.socket_sdf())
    if mouth is not None:
        f = SD.smooth_sub(0.024, f, mouth.slit_sdf())
    head.skin_f = f
    V, F = MS.sdf_mesh(f, np.array(lo, float), np.array(hi, float), hq(h, 1.2), tris=tq(tris, 200))
    regs = list(regions)
    if eyes is not None and getattr(eyes, 'ring_mat', None):
        sock = eyes.socket_sdf()
        rw = eyes.ring_w
        regs = [(eyes.ring_mat, lambda P, sk=sock, rw=rw: sk(P) - rw)] + regs
    if mouth is not None:
        slit = mouth.slit_sdf()
        regs = [('mouth', lambda P, sl=slit: sl(P) - 0.012)] + regs
    for mat, rf in regs:
        V, F = MS.cut_by_field(V, F, rf, surf=f)
    mats = MS.faces_by_region(V, F, regs, default)
    p = Part(V, F, mats, 'head_skin')
    if mouth is not None:
        p.V = mouth.close(p.V)
    zz = p.V[:, 2]
    wn = sm(3.42, 3.12, zz)
    wj = (mouth.jaw_weight(p.V) if mouth is not None else np.zeros(p.n)) * (1 - wn)
    p.set_weights({'neck': wn, 'jaw': wj, 'head': np.clip(1 - wn - wj, 0, 1)})
    ks = mouth.keys(p.V, f) if mouth is not None else {}
    if eyes is not None:
        d = np.zeros_like(p.V)
        for s in (1, -1):
            piv, R = eyes.frame(s)
            c = eyes.sph(piv, R, eyes.R, 0, -math.asin(min(eyes.H / eyes.R, 0.95)))
            w = np.exp(-((np.linalg.norm(p.V - c, axis=1) / 0.13) ** 2))
            d[:, 2] += 0.03 * w
        ks['squint'] = ks.get('squint', 0) + d
    if extra_keys:
        for k, fn in extra_keys.items():
            ks[k] = ks.get(k, 0) + fn(p.V)
    p.sk = ks
    head.parts.append(p)
    return p


# ------------------------------------------------------------------------------------------- brows
def brows(head, skin_f, z=4.44, x0=0.06, x1=0.37, arch=0.07, thick=0.052, mat='fur_light', bones=True, tilt=0.0):
    """Crescent brows on the forehead with brows_up / angry / sad keys (conformed back onto the skin)."""
    out = []
    for s in (1, -1):
        sd = 'L' if s > 0 else 'R'
        pts, rad = [], []
        n = 9
        for i in range(n):
            u = i / (n - 1)
            pts.append([(x0 + (x1 - x0) * u) * s, -0.2, z + arch * math.sin(u * math.pi * 0.85) - 0.012 * u - tilt * (1 - u)])
            rad.append(thick * (1 - u) ** 0.65 + 0.009)
        pts = np.array(pts)
        for k in range(len(pts)):
            pts[k] = march_to(skin_f, [pts[k][0], -1.4, pts[k][2]], (0, 1, 0))
        path = pts + SD.normals(skin_f, pts) * 0.012
        f = SD.ptube(list(path), rad)
        V, F = MS.sdf_mesh(f, path.min(0) - 0.1, path.max(0) + 0.1, hq(0.006), tris=tq(90, 16))
        p = Part(V, F, mat, 'brow_' + sd)
        p.rigid('brow.' + sd)
        u = np.clip((np.abs(p.V[:, 0]) - x0) / (x1 - x0), 0, 1)
        d0 = skin_f(p.V)

        def conform(Vn):
            dn = skin_f(Vn)
            N = SD.normals(skin_f, Vn)
            return Vn - N * (dn - d0)[:, None]
        up = p.V.copy()
        up[:, 2] += 0.075 + 0.02 * np.sin(u * math.pi)
        an = p.V.copy()
        an[:, 2] += -0.07 * (1 - u) + 0.035 * u
        an[:, 0] += -s * 0.025 * (1 - u)
        sa = p.V.copy()
        sa[:, 2] += 0.07 * (1 - u) - 0.04 * u
        p.sk = {'brows_up': conform(up) - p.V, 'brows_angry': conform(an) - p.V, 'brows_sad': conform(sa) - p.V}
        out.append(p)
        if s > 0:
            head.joints['brow.L'] = path[n // 2].copy()
        head.parts.append(p)
    return out


# ------------------------------------------------------------------------------------------- simple solids
def blob(f, center, size, tris, mat, name, bone='head', h=0.008):
    c = np.asarray(center, float)
    p = sdf_part(f, c - size, c + size, hq(h), tq(tris, 12), mat, name)
    p.rigid(bone)
    return p


def tube(path, radii, n, mat, name, bone='head', up=(0, 0, 1)):
    p = G.sweep(np.asarray(path, float), radii, n, mat, up=up, name=name)
    orient_outward(p)
    p.rigid(bone)
    return p


def curve_pts(ctrl, n=12):
    """Catmull-Rom through control points."""
    P = [np.asarray(c, float) for c in ctrl]
    P = [P[0] + (P[0] - P[1])] + P + [P[-1] + (P[-1] - P[-2])]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for t in np.linspace(0, 1, n, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-2])
    return np.array(out)


def horn(ctrl, r0, r1, mat='horn', name='horn', n=8, samples=18, ridges=0):
    """Tapered horn along a smooth curve (sweep with a rounded tip). ridges: ring bulges (ram-style)."""
    if LOD > 0:
        n, samples = max(5, n - 3), max(6, samples // 2)
    pts = curve_pts(ctrl, 8)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    L = s[-1]
    t = np.linspace(0, 1, samples)
    P = np.array([np.interp(t * L, s, pts[:, i]) for i in range(3)]).T
    rad = r0 + (r1 - r0) * t ** 0.9
    if ridges:
        rad = rad * (1 + 0.06 * np.maximum(np.sin(t * math.pi * ridges * 2), 0))
    rad[-1] = max(r1 * 0.4, 0.008)
    p = G.sweep(P, rad, n, mat, up=(0, 0, 1), name=name)
    orient_outward(p)
    p.rigid('head')
    return p


def ear_leaf(base, upv, fwd, H, Wd, T=0.045, cup=0.10, mat_out='fur', mat_in='fur_light', rim=None, side=1, droop=0.0,
             tris=200, name='ear', bone='ear.L', inner=True, shape='tri'):
    """Ear blade: shape 'tri' (rounded triangle: cats, foxes, horses), 'leaf' (ellipse: cattle, goats, hanging dog
    ears), 'round' (bears, mice, otters). Cupped toward fwd (the inner bowl, mat_in); optional rim colour; droop bends
    the blade back along its length."""
    base = np.asarray(base, float)
    upv = nrm(np.asarray(upv, float))
    fwd = nrm(np.asarray(fwd, float))
    fwd = nrm(fwd - np.dot(fwd, upv) * upv)
    sidev = np.cross(upv, fwd)
    R = np.stack([sidev, upv, fwd], 1)

    def tri2d(x, y):
        if shape == 'tri':
            k = (H - np.clip(y, 0, H)) / H
            half = Wd * (k ** 0.62) * (1.0 + 0.25 * np.sin(np.clip(k, 0, 1) * math.pi))
            dx = np.abs(x) - half
            dy = np.maximum(-y, y - H * 0.93)
            return np.maximum(dx * 0.9, dy) - 0.025 * (1 - k) ** 2
        # ellipse whose lower end is buried in the head (the base stays wide enough to attach)
        cyy = H * 0.5 if shape == 'leaf' else H * 0.55
        ry = H * 0.5 if shape == 'leaf' else H * 0.45
        q = np.sqrt((x / Wd) ** 2 + ((y - cyy) / ry) ** 2)
        return (q - 1.0) * min(Wd, ry)

    def loc(P):
        q = (np.asarray(P, float) - base) @ R
        x, y, z = q[..., 0], q[..., 1], q[..., 2]
        z = z + droop * (np.clip(y, 0, None) / H) ** 2
        return x, y, z

    def ear_sdf(P):
        x, y, z = loc(P)
        zz = z - cup * (x / Wd) ** 2
        out = np.maximum(tri2d(x, y) - 0.035, np.abs(zz) - T)
        if inner:
            bowl = np.maximum(tri2d(x * 1.25, (y - 0.06) * 1.18) - 0.012, -(zz - T * 0.25))
            out = SD.smax(out, -bowl, 0.015)
        return out
    lo, hi = base - (H + 0.4), base + (H + 0.4)
    V, F = MS.sdf_mesh(ear_sdf, lo, hi, hq(0.0075), tris=tq(tris, 24))
    p = Part(V, F, mat_out, name)
    regs = []
    if inner and mat_in:
        def inner_region(P):
            x, y, z = loc(P)
            return np.maximum(tri2d(x * 1.25, (y - 0.06) * 1.18) + 0.004, -(z - cup * (x / Wd) ** 2))
        regs.append((mat_in, inner_region))
    if rim:
        regs.append((rim, lambda P: -(tri2d(*loc(P)[:2]) + 0.018)))
    for m, rf in regs:
        p.V, p.F = MS.cut_by_field(p.V, p.F, rf, surf=ear_sdf)
    p.mat = MS.faces_by_region(p.V, p.F, regs, mat_out)
    q = (p.V - base) @ R
    w = np.clip((q[:, 1] + 0.02) / 0.12, 0, 1)
    p.set_weights({bone: w, 'head': 1 - w})
    return p


def mirror_part(p, swap=True):
    q = p.copy() if hasattr(p, 'copy') else None
    if q is None:
        import copy
        q = copy.deepcopy(p)
    q.V = p.V * np.array([-1, 1, 1])
    q.F = [f[::-1] for f in p.F]
    if p.sk:
        q.sk = {k: d * np.array([-1, 1, 1]) for k, d in p.sk.items()}
    if swap:
        q.W = {G.swap_lr(k): w for k, w in p.W.items()}
    return q


# ------------------------------------------------------------------------------------------- accessories
def shades(head, eyes, mat='accessory_b'):
    """Cartoon sunglasses: two rounded lenses on a bar, sitting in front of the eyes."""
    parts = []
    for s in (1, -1):
        piv, R = eyes.frame(s)
        c = eyes.sph(piv, R, eyes.R + 0.05, 0, 0)
        f = SD.ellipsoid(c, (eyes.W + 0.07, eyes.H + 0.03, 0.035), R=R)
        parts.append(blob(f, c, 0.35, 120, mat, 'shade_' + ('L' if s > 0 else 'R')))
    a = eyes.sph(*eyes.frame(1), eyes.R + 0.05, -math.asin(min((eyes.W + 0.05) / eyes.R, 0.9)), 0.05)
    b = eyes.sph(*eyes.frame(-1), eyes.R + 0.05, math.asin(min((eyes.W + 0.05) / eyes.R, 0.9)), 0.05)
    mid = (a + b) / 2 + np.array([0, -0.03, 0.01])
    parts.append(tube([a, mid, b], [0.022, 0.024, 0.022], 6, mat, 'shade_bridge'))
    head.parts += parts
    return parts


def round_glasses(head, eyes, mat='accessory_b', r=None):
    """Round wire spectacles (rims + bridge + temples)."""
    out = []
    for s in (1, -1):
        piv, R = eyes.frame(s)
        c = eyes.sph(piv, R, eyes.R + 0.045, 0, -0.02)
        rr = r or max(eyes.W, eyes.H) + 0.05
        ring = [c + R @ np.array([math.cos(t) * rr * 0.92, math.sin(t) * rr, 0]) for t in np.linspace(0, 2 * math.pi, 16, endpoint=False)]
        p = BD.ring_sweep(ring, 0.014, 0.014, 4, True, mat, normals=[R[:, 2]] * len(ring))
        p.rigid('head')
        out.append(orient_outward(p))
    head.parts += out
    return out


def gum_bubble(head, at, r=0.17, mat='accessory_a'):
    c = np.asarray(at, float) + np.array([0, -r * 0.85, -0.02])
    f = SD.sphere(c, r) if hasattr(SD, 'sphere') else SD.ellipsoid(c, (r, r, r))
    p = blob(f, c, r + 0.1, 160, mat, 'gum', bone='jaw')
    head.parts.append(p)
    return p


def stalk(head, at, side=1, mat='accessory_b'):
    a = np.asarray(at, float)
    path = [a + np.array([-0.04 * side, 0.05, 0.0]), a + np.array([0.12 * side, -0.10, 0.06]), a + np.array([0.36 * side, -0.16, 0.20])]
    p = tube(curve_pts(path, 5), 0.014, 5, mat, 'stalk', bone='jaw')
    head.parts.append(p)
    return p


def eyeblack(head, skin_f, eyes, mat='mask'):
    """Two dark grease stripes under the eyes (decal-thin slabs conformed to the skin)."""
    out = []
    for s in (1, -1):
        piv, R = eyes.frame(s)
        c0 = eyes.sph(piv, R, eyes.R, 0, -math.asin(min(eyes.H / eyes.R, 0.95)) - 0.32)
        c = march_to(skin_f, c0 + np.array([0, -0.5, 0]), (0, 1, 0))
        n_ = SD.normals(skin_f, c[None])[0]
        xt = nrm(np.cross([0, 0, 1.0], n_))              # horizontal tangent: the stripe runs across the cheek
        yt = np.cross(n_, xt)
        f = SD.ellipsoid(c, (0.10, 0.032, 0.012), R=np.stack([xt, yt, n_], 1))
        p = blob(f, c, 0.2, 40, mat, 'eyeblack')
        out.append(p)
    head.parts += out
    return out


def nose_ring(head, at, r=0.085, mat='accessory_b'):
    c = np.asarray(at, float)
    ring = [c + np.array([math.cos(t) * r, 0.0, -r + math.sin(t) * r]) for t in np.linspace(0, 2 * math.pi, 14, endpoint=False)]
    p = BD.ring_sweep(ring, 0.017, 0.017, 6, True, mat, normals=[nrm(q - (c + np.array([0, 0, -r]))) for q in ring])
    p.rigid('head')
    head.parts.append(orient_outward(p))
    return p


# ------------------------------------------------------------------------------------------- cap
def cap_fit(cran_c, cran_r, lift=0.0, brim=1.0):
    """Cap placement for a cranium ellipsoid (Rocco's numbers relative to his cranium (0, 0.08, 4.14) r (0.62, 0.56,
    0.62)). lift raises the band (a cap perched higher); brim scales the visor."""
    c = np.asarray(cran_c, float)
    r = np.asarray(cran_r, float)
    top = c[2] + r[2]
    return dict(cap_c=(0.0, c[1] - 0.04, top - 0.16 + lift), band_front=top - 0.115 + lift, brim_z=top - 0.095 + lift,
                brim_y=c[1] - 0.50 * r[1] / 0.56, brim_r=(0.52 * r[0] / 0.62 * brim, 0.41 * brim), cy=c[1],
                band_y0=0.63 * r[1] / 0.56)


def cap_parts(head, cranium, cap_c, band_front=4.645, band_slope=0.17, slots=(), brim_z=4.665, brim_r=(0.52, 0.41),
              brim_y=-0.42, back=False, letter=True, crown_lift=(0.04, 0.085), crown_mat='cap', brim_mat='cap_brim',
              cy=0.08, band_y0=0.63, button_mat='team_b'):
    """Six-panel ball cap fitted over a cranium SDF (Rocco's construction): slots = [(point, up, half_width)] for ears,
    horns, combs; back=True wears it backwards (brim over the nape; band and brim mirrored about the cranium centre
    y = cy). Rigid to the cap bone. The team-letter patch (decal_chest, UV'd) is left in head.cap_letter."""
    cap_c = np.asarray(cap_c, float)
    flip = -1.0 if back else 1.0
    parts = []
    if back:      # worn backwards: the band sits level and a little higher (the forehead and brows stay visible)
        band_slope = 0.03
        band_front += 0.05
        brim_z += 0.0

    def band(Q):
        return (band_front - band_slope * (flip * (Q[..., 1] - cy) + band_y0)) - Q[..., 2]

    def crown(Q):
        Q = np.asarray(Q, float)
        d = cranium(Q)
        lift = crown_lift[0] + crown_lift[1] * np.clip((Q[..., 2] - (band_front - 0.2)) / 0.33, 0, 1) ** 1.2
        shell = np.abs(d - lift - 0.012) - 0.026
        shell = SD.smax(shell, band(Q), 0.01)
        for pt, upv, hw in slots:
            pt = np.asarray(pt, float)
            upv = nrm(np.asarray(upv, float))
            hole = SD.capsule(pt - upv * 0.25, pt + upv * 0.6, hw)(Q)
            shell = SD.smax(shell, -hole, 0.012)
        if LOD == 0:
            rel = Q - (cap_c + np.array([0, 0.02, 0]))
            ang = np.arctan2(rel[..., 0], -rel[..., 1])
            k = np.round(ang / (math.pi / 3)) * (math.pi / 3)
            dist = np.abs(np.sin(ang - k)) * np.linalg.norm(rel[..., :2], axis=-1)
            seam = SD.smax(dist - 0.006, -(d - 0.092) - 0.012, 0.004)
            shell = SD.smax(shell, -seam, 0.006)
        return shell
    lo = cap_c + np.array([-1.05, -1.05, -0.6])
    hi = cap_c + np.array([1.05, 1.05, 0.6])
    cr = sdf_part(crown, lo, hi, hq(0.0085), tq(600, 60), crown_mat, 'crown')
    parts.append(cr)
    if LOD == 0:
        k = int(np.argmax(cr.V[:, 2] - 2.0 * np.abs(cr.V[:, 0]) - 2.0 * np.abs(cr.V[:, 1] - cap_c[1])))
        btn = G.ellipsoid(cr.V[k] + np.array([0, 0, 0.006]), (0.052, 0.052, 0.03), 8, 3, button_mat)
        parts.append(btn)
    bx, by = brim_r

    def brim(Q):
        Q = np.asarray(Q, float)
        x, z = Q[..., 0], Q[..., 2]
        y = cy + flip * (Q[..., 1] - cy)
        plan = np.sqrt((x / bx) ** 2 + (np.minimum(y - brim_y, 0) / by) ** 2) - 1.0
        plan = np.maximum(plan * 0.3, (y - (brim_y + 0.22)))
        zc = brim_z + 0.025 * np.clip((brim_y - y) / by, 0, 1) - 0.11 * (x / bx) ** 2 + 0.04 * np.clip((y - brim_y) / 0.22, 0, 1)
        if back:
            zc = zc - 0.10 * np.clip((brim_y - y) / by, 0, 1)
        return SD.smax(plan, np.abs(z - zc) - 0.021, 0.012)
    bl = cap_c + np.array([-1.0, -1.2, -0.7])
    bh = cap_c + np.array([1.0, 1.2, 0.3])
    br = sdf_part(brim, bl, bh, hq(0.008), tq(150, 24), brim_mat, 'brim')
    parts.append(br)
    if letter and not back and LOD == 0:
        # team-letter patch on the front panel (textured by the runtime like the chest letter)
        c0 = cap_c + np.array([0, -1.2, -0.08])
        Vq, U, Fq = [], [], []
        nu = nv = 3
        for j in range(nv + 1):
            for i in range(nu + 1):
                u, v = i / nu, j / nv
                q = np.array([(u - 0.5) * 0.26, -1.6, c0[2] + (v - 0.5) * 0.22])
                q = march_to(lambda P: cranium(P) - 0.10, q, (0, 1, 0))
                Vq.append(q)
        Vq = np.array(Vq)
        Vq = SD.project(lambda P: cranium(P) - 0.10, Vq, iters=4)
        Vq = Vq + SD.normals(cranium, Vq) * 0.004
        for j in range(nv):
            for i in range(nu):
                a = j * (nu + 1) + i
                Fq.append([a, a + 1, a + nu + 2, a + nu + 1])
                U.append([(i / nu, j / nv), ((i + 1) / nu, j / nv), ((i + 1) / nu, (j + 1) / nv), (i / nu, (j + 1) / nv)])
        lp = Part(Vq, Fq, 'decal_chest', 'cap_letter')
        lp.uv = U
        f0 = lp.F[0]
        nn = np.cross(lp.V[f0[1]] - lp.V[f0[0]], lp.V[f0[3]] - lp.V[f0[0]])
        if nn[1] > 0:
            lp.F = [ff[::-1] for ff in lp.F]
            lp.uv = [uu[::-1] for uu in lp.uv]
        lp.rigid('cap')
        head.cap_letter = lp
    for p in parts:
        p.rigid('cap')
    head.parts += parts
    head.joints['cap'] = cap_c
    head.cap = dict(crown=crown, cranium=cranium, cap_c=cap_c, back=back)
    return parts

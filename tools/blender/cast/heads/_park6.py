# _park6.py - private helpers for the park-6 species heads (goose, flamingo, heron, owl, parrot, peacock, bison) and
# Mabel. Not a species module (the registry skips '_' files); specs/park6.py and specs/mabel.py hash this file (and
# the body kit it calls) into each spec's head options, so editing it invalidates those cached heads.
#   Frame        the character's body joints + torso SDF (cskel / cbody / ctail, read-only), so a head module can hang
#                parts on the body through the documented features() hook: trains, manes, pearls, catcher gear.
#                Head parts live in hkit design space: world = J['head'] + Kh * (design - HEAD_PIVOT).
#   Beak         a two-part beak from any pair of SDFs (bent, hooked, dagger ...) with fam_bird's BeakRig keys.
#   feathers     crest quills, plumes, tufts, a waxed handlebar mustache for beaks, pearls, eye irises.
import math
import numpy as np
import hkit as K
import rk_sdf as SD
import rk_geo as G
import rk_mesh as MS
from rk_geo import Part, nrm




# ------------------------------------------------------------------------------------------- body frame
class Frame:
    """Body joints (world, feet) for a spec exactly as cbuild assembles them (cskel.joints_for + the tail chain
    re-seated on the torso SDF), with conversions between world and head design space."""
    def __init__(self, spec):
        import cskel as SK
        import cbody as CB
        import ctail as CT
        build = dict(SK.DEFAULT_BUILD)
        build.update(spec['build'])
        tail = spec.get('tail') or 'none'
        build['tail'] = tuple(np.array(CT.LENGTHS.get(tail, CT.LENGTHS['none'])) * spec['body'].get('tail_len', 1.0))
        self.build = build
        self.Kh = 1.08 * build.get('head', 1.0)
        J = SK.joints_for(build, None)
        self.bp = dict(spec['body'])
        self.f = CB.torso_sdf(J, self.bp)
        J = dict(J)
        CT.seat_root(J, self.f)
        self.J = {k: np.asarray(v, float) for k, v in J.items()}
        self.S = CB.scales(self.J)

    def j(self, n):
        return np.asarray(self.J[n], float)

    def d(self, P):
        """world -> design"""
        return K.HEAD_PIVOT + (np.asarray(P, float) - self.J['head']) / self.Kh

    def w(self, P):
        """design -> world"""
        return self.J['head'] + self.Kh * (np.asarray(P, float) - K.HEAD_PIVOT)

    def to_design(self, p):
        """A world-space part (weights on any bones) -> a design-space part for head.parts (unkeyed: body mesh)."""
        q = p.copy()
        q.V = self.d(q.V)
        q.sk = {k: v / self.Kh for k, v in q.sk.items()}
        return q

    def collar_z(self):
        """Top of the jersey collar ring (world z)."""
        return self.J['neck'][2] + 0.09 * self.S['ts'] + 0.03

    def collar_design_z(self):
        return float(self.d(np.array([0, 0, self.collar_z()]))[2])


# ------------------------------------------------------------------------------------------- SDF helpers
def squash(f, s, c):
    return SD.scaled(f, s, c)


def curve_tube(ctrl, radii, n=6):
    """Tube SDF along a Catmull-Rom curve through ctrl with radii interpolated along it (one per control point)."""
    pts = K.curve_pts(ctrl, n)
    t = np.linspace(0, 1, len(pts))
    tc = np.linspace(0, 1, len(ctrl))
    r = np.interp(t, tc, np.asarray(radii, float))
    return SD.ptube(list(pts), r), pts


def side2d(P, pts):
    """Signed side of points P relative to a polyline pts in the (y, z) plane: positive on the 'upper' side (left of
    the direction of travel when the curve heads forward along -y), i.e. the outer side of a downward hook."""
    P = np.asarray(P, float)
    q = P[..., 1:3]
    best = np.full(q.shape[:-1], np.inf)
    sgn = np.zeros(q.shape[:-1])
    for i in range(len(pts) - 1):
        a, b = np.asarray(pts[i], float)[1:3], np.asarray(pts[i + 1], float)[1:3]
        ab = b - a
        t = np.clip(((q - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
        c = a + t[..., None] * ab
        d = np.linalg.norm(q - c, axis=-1)
        cr = ab[0] * (q[..., 1] - c[..., 1]) - ab[1] * (q[..., 0] - c[..., 0])
        m = d < best
        best = np.where(m, d, best)
        sgn = np.where(m, -cr / max(np.linalg.norm(ab), 1e-9), sgn)
    # outside the end segments the cross product still gives the side; use it as a signed distance-ish value
    return sgn


# ------------------------------------------------------------------------------------------- beaks
class Beak:
    """A two-part beak from SDFs (design space): the upper mandible rigid to the head, the lower on the jaw.
    gape: polyline (design points) of the parting line from the hinge to the tip; upper = shape above it, lower =
    shape below it (or separate SDFs). Keys as fam_bird.BeakRig: mouth_open drops the lower about the hinge and lifts
    the upper a little; smile / frown / smirk curl the gape corners at the back. regions: [(mat, sdf)] colour regions
    (tips, nails, dark lower mandibles), applied to both mandibles (first match wins)."""
    def __init__(self, shape, gape, hinge, lo, hi, open_deg=26.0, lift_deg=6.0, lower_shape=None, upper_shape=None,
                 regions=(), regions_lo=None, mat='beak', tris=(300, 200), h=0.007, back_y=None, half_w=0.18, gap=0.004):
        self.shape = shape
        self.gape_pts = [np.asarray(p, float) for p in gape]
        self.hinge = np.asarray(hinge, float)
        self.lo, self.hi = np.asarray(lo, float), np.asarray(hi, float)
        self.open, self.lift = open_deg, lift_deg
        self.lower_shape, self.upper_shape = lower_shape, upper_shape
        self.regions = list(regions)
        self.regions_lo = self.regions if regions_lo is None else list(regions_lo)
        self.mat = mat
        self.tris = tris
        self.h = h
        self.back_y = self.gape_pts[0][1] if back_y is None else back_y
        self.half_w = half_w
        self.gap = gap

    def gape(self, P):
        return side2d(P, self.gape_pts)

    def upper_sdf(self):
        base = self.upper_shape or self.shape
        return lambda P: SD.smax(base(P), -self.gape(P) + self.gap, 0.012)

    def lower_sdf(self):
        base = self.lower_shape or self.shape
        return lambda P: SD.smax(base(P), self.gape(P) + self.gap, 0.012)

    def _mesh(self, f, tris, name, bone, regions):
        V, F = MS.sdf_mesh(f, self.lo, self.hi, K.hq(self.h), tris=K.tq(tris, 30))
        for m, rf in regions:
            V, F = MS.cut_by_field(V, F, rf, surf=f)
        mats = MS.faces_by_region(V, F, regions, self.mat) if regions else self.mat
        p = Part(V, F, mats, name)
        K.orient_outward(p)
        p.rigid(bone)
        return p

    def parts(self):
        pu = self._mesh(self.upper_sdf(), self.tris[0], 'beak_up', 'head', self.regions)
        pl = self._mesh(self.lower_sdf(), self.tris[1], 'beak_lo', 'jaw', self.regions_lo)
        ang = np.radians(self.open)
        pl.sk['mouth_open'] = K.rot_points(pl.V, self.hinge, (1, 0, 0), np.full(pl.n, ang)) - pl.V
        pu.sk['mouth_open'] = K.rot_points(pu.V, self.hinge, (1, 0, 0), np.full(pu.n, -np.radians(self.lift))) - pu.V
        for p in (pu, pl):
            back = G.smoothstep(self.back_y - 0.24, self.back_y, p.V[:, 1])
            side = np.clip(np.abs(p.V[:, 0]) / (self.half_w + 1e-6), 0, 1)
            d = np.zeros_like(p.V)
            d[:, 2] = 0.045 * back * side
            p.sk['smile'] = d
            p.sk['frown'] = -d * 1.3
            sr = G.smoothstep(0.02, -0.06, p.V[:, 0])
            p.sk['smirk'] = d * sr[:, None] * 1.5
        return [pu, pl]


def replace_beak(head, geo, beak, face_y=True):
    """Swap fam_bird's default cone beak for a custom Beak (call from features())."""
    head.parts = [p for p in head.parts if p.name not in ('beak_up', 'beak_lo')]
    parts = beak.parts()
    head.parts += parts
    head.joints['jaw'] = beak.hinge
    geo.beak_custom = beak
    if face_y:
        head.face_y = float(min(p.V[:, 1].min() for p in head.parts if p.name not in ('crown', 'brim')))
    return parts


def face_point(f, x, z):
    y = K.surface_y(f, x, z)
    return np.array([x, y, z])


# ------------------------------------------------------------------------------------------- feathers
def feather_blade(path, width, thick, mat, name='feather', bone='head', n=6, up=(0, -1, 0), tip_round=True):
    """A flat feather (flattened sweep) along a path; width / thick: arrays per path point (or scalars)."""
    P = np.asarray(path, float)
    m = len(P)
    w = np.broadcast_to(np.asarray(width, float), (m,)).copy()
    t = np.broadcast_to(np.asarray(thick, float), (m,)).copy()
    p = G.sweep(P, None, n, mat, up=up, rx=w, ry=t, name=name)
    K.orient_outward(p)
    if bone:
        p.rigid(bone)
    return p


def quill(base, tip, r0=0.016, tip_r=(0.07, 0.035, 0.10), mat='feather', tip_mat=None, bone='head', name='quill', bend=0.0,
          side=(1, 0, 0)):
    """A bare feather shaft ending in a spatulate tip (peacock crest): stalk tube + flattened teardrop."""
    base, tip = np.asarray(base, float), np.asarray(tip, float)
    d = tip - base
    L = np.linalg.norm(d)
    dn = d / L
    mid = base + d * 0.55 + np.asarray(side, float) * bend
    path = K.curve_pts([base, mid, tip - dn * tip_r[2] * 0.6], 4)
    stalk = K.tube(path, np.linspace(r0, r0 * 0.7, len(path)), 4, mat, name + '_stalk', bone=bone)
    R = G.frame_from(dn, (0, -1, 0))
    c = tip - dn * tip_r[2] * 0.15
    g = SD.ellipsoid(c, tip_r, R=np.stack([R[:, 0], R[:, 2], R[:, 1]], 1))
    head_p = K.blob(g, c, max(tip_r) + 0.06, 44, tip_mat or mat, name + '_tip', bone=bone, h=0.006)
    return [stalk, head_p]


def handlebar(head, ctr, w=0.30, thick=0.045, curl=0.08, mat='fur_dark', bone='head', droop=0.03):
    """A waxed handlebar mustache across the base of a beak (two tapered tubes ending in curls)."""
    out = []
    ctr = np.asarray(ctr, float)
    for s in (1, -1):
        ctrl = [ctr + [s * 0.01, 0.0, 0.0], ctr + [s * w * 0.35, 0.05, -droop], ctr + [s * w * 0.75, 0.13, -droop * 0.6],
                ctr + [s * w, 0.20, curl * 0.4], ctr + [s * (w - curl * 0.55), 0.21, curl * 0.95],
                ctr + [s * (w - curl * 0.9), 0.17, curl * 0.6]]
        pts = K.curve_pts(ctrl, 5)
        u = np.linspace(0, 1, len(pts))
        rad = thick * (0.75 + 0.6 * np.sin(np.clip(u / 0.45, 0, 1) * math.pi / 2)) * (1 - 0.82 * np.clip((u - 0.45) / 0.55, 0, 1)) + 0.006
        out.append(K.tube(pts, rad, 7 if K.LOD == 0 else 5, mat, 'mustache', bone=bone))
    head.parts += out
    return out


def iris_parts(head, eyes, mat='feather_accent', scale=1.9):
    """Coloured irises under the pupils (owls): a disc on the eye sphere, rigid to the eye bone (moves with the gaze)."""
    out = []
    for s in (1, -1):
        sd = 'L' if s > 0 else 'R'
        piv, R = eyes.frame(s)
        ER = eyes.R
        pa, pe = math.radians(eyes.pupil[0] * scale), math.radians(eyes.pupil[1] * scale * 0.8)
        paz, pel = -math.radians(1.0) * s, -math.radians(2.0)

        def iris_sdf(P, piv=piv, R=R):
            q = (np.asarray(P, float) - piv) @ R
            r = np.linalg.norm(q, axis=-1)
            az = np.arctan2(q[..., 0], q[..., 2])
            el = np.arcsin(np.clip(q[..., 1] / np.maximum(r, 1e-9), -1, 1))
            ov = (np.sqrt(((az - paz) / pa) ** 2 + ((el - pel) / pe) ** 2) - 1.0) * min(pa, pe) * ER
            shell = np.abs(r - ER) - 0.0035          # under the pupil (outer face ER + 0.007), over the white
            return SD.smax(ov, shell, 0.003)
        c = eyes.sph(piv, R, ER, paz, pel)
        V, F = MS.sdf_mesh(iris_sdf, c - 0.25, c + 0.25, 0.0055, tris=K.tq(110, 24))
        p = Part(V, F, mat, 'iris_' + sd)
        K.orient_outward(p)
        p.rigid('eye.' + sd)
        out.append(p)
    head.pupils += out
    return out


def pearls(head, fr, n=17, r=0.045, mat='teeth', drop=0.16, loose=0.04):
    """A string of pearls round the neck lying on the collar and dipping onto the chest (built in world space on the
    body frame, weighted chest / neck)."""
    J = fr.J
    neck = fr.j('neck')
    nr = fr.bp.get('neck_r', 1.0)
    zc = J['neck'][2] + 0.09 * fr.S['ts']
    out = []
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        x = (0.272 * nr + 0.05) * math.sin(a)
        y = neck[1] - (0.25 * nr + 0.05) * math.cos(a)
        front = max(-math.cos(a), 0.0)                 # 1 at the front
        z = zc + 0.03 - drop * front ** 2
        p = np.array([x, y, z])
        if front > 0.25:                                # rest it on the jersey front
            q = np.array([x, y - 0.8, z])
            for _ in range(160):
                v = fr.f(q[None])[0]
                if v < r * 0.85:
                    break
                q[1] += max(v - r * 0.85, 0.004)
            p = q
        pts.append(p)
    terms = [SD.sphere(c, r * (1.0 if K.LOD == 0 else 1.15)) for c in pts]
    f = SD.union(*terms)
    c = np.mean(pts, 0)
    hh = 0.006 if K.LOD == 0 else 0.012
    V, F = MS.sdf_mesh(f, c - 0.7, c + 0.7, hh, tris=K.tq(n * 24, 60))
    pp = Part(V, F, mat, 'pearls')
    K.orient_outward(pp)
    fw = G.smoothstep(zc + 0.02, zc - 0.10, pp.V[:, 2])
    pp.set_weights({'chest': 0.4 + 0.6 * fw, 'neck': 0.6 * (1 - fw)})
    out.append(fr.to_design(pp))
    head.parts += out
    return out


def catcher_gear(head, fr, lod, mat='team_b', trim='accessory_b'):
    """The catcher's chest protector and shin guards (cgear) hung on the body from the head module - for a beaked
    catcher who skips the generator's face mask (spec gear without 'catcher')."""
    import cgear as GR
    parts = [GR.chest_protector(fr.J, fr.f, mat=mat, trim=trim, lod=lod)]
    parts += GR.shin_guards(fr.J, mat=mat, trim=trim, lod=lod)
    out = [fr.to_design(p) for p in parts]
    head.parts += out
    return out


def region_ell(c, r, R=None):
    def make(geo):
        return SD.ellipsoid(c, r, R=R)
    return make


def region_union(*makers):
    def make(geo):
        fs = [m(geo) for m in makers]
        return SD.union(*fs) if len(fs) > 1 else fs[0]
    return make


def region_fn(fn):
    """A region from a plain function of points (negative inside)."""
    def make(geo):
        return fn
    return make


def card_extras(ctx, head, geo):
    """Card accessories fam_bird does not draw: freckles and a sticking plaster (fam_mammal's, they only need the skull
    SDF and the eye params), blush (a pink cheek region is added in params instead)."""
    from heads import fam_mammal as M
    acc = ctx.acc
    if acc.get('freckles'):
        M.freckles(ctx, head, geo, mat=acc.get('freckle_mat', 'fur_dark'))
    if acc.get('bandaid'):
        M.bandaid(ctx, head, geo)


def neck_stub(fr, top=(0.0, 0.10, 3.62), r_top=0.21, r_bot=0.19, fwd=0.0, below=0.16):
    """Neck capsule chain for a bird whose neck bone is long: from under the head down into the collar (design
    space), optionally bowed forward (fwd > 0: the middle sits further forward, a goose / flamingo S)."""
    zb = fr.collar_design_z() - below
    a = np.asarray(top, float)
    b = np.array([0.0, 0.06 + (0.06 - fr.J['neck'][1]) / fr.Kh * 0.0, zb])
    mid = (a + b) / 2 + np.array([0.0, -fwd, 0.0])
    return [(0.10, SD.round_cone(a, mid, r_top, (r_top + r_bot) / 2)), (0.10, SD.round_cone(mid, b, (r_top + r_bot) / 2, r_bot))], zb


def spectacles(head, eyes, mat='horn', grow=0.018, wire=0.011, lens=None, temples=True, cap_c=None):
    """Thin round wire spectacles: a rim round each eye, a bridge arched over the base of the beak and temples
    running back to the sides of the head (rigid to the head)."""
    import rk_body as BD
    out = []
    rims = {}
    for s in (1, -1):
        piv, R = eyes.frame(s)
        c = eyes.sph(piv, R, eyes.R + 0.04, 0, -0.01)
        rx, ry = eyes.W + grow, eyes.H + grow * 0.6
        ring = [c + R @ np.array([math.cos(t) * rx, math.sin(t) * ry, 0]) for t in np.linspace(0, 2 * math.pi, 18, endpoint=False)]
        p = BD.ring_sweep(ring, wire, wire, 4, True, mat, normals=[R[:, 2]] * len(ring))
        p.rigid('head')
        out.append(K.orient_outward(p))
        rims[s] = (c, R, rx, ry)
    # bridge: from the inner edge of one rim to the other, arched up over the beak base
    (cl, Rl, rxl, _), (cr, Rr, rxr, _) = rims[1], rims[-1]
    a = cl - Rl[:, 0] * rxl
    b = cr - Rr[:, 0] * rxr
    mid = (a + b) / 2 + np.array([0.0, -0.05, 0.035])
    out.append(K.tube(K.curve_pts([a, mid, b], 4), wire, 4, mat, 'spec_bridge'))
    if temples:
        for s, (c, R, rx, ry) in rims.items():
            e = c + R[:, 0] * rx
            back = e + np.array([s * 0.10, 0.42, 0.06])
            out.append(K.tube(K.curve_pts([e, e + np.array([s * 0.06, 0.16, 0.03]), back], 4), wire * 0.9, 4, mat, 'spec_temple'))
    head.parts += out
    return out

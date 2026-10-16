# gull.py - herring gull: a round white head whose brow slopes into a long yellow beak (the upper mandible hooks over
# the tip, the lower has a gonys angle with the red spot), grey 'wing' hands, a white fan tail with grey tips.
# Head options (spec.head): beak (length factor), hood (grey streaks behind the eyes, 0..1), crown (head height),
# tufts (scruffy cheek feathers). The boss (Winifred 'The Admiral' Gale, boss=True): a bigger hooked beak, a heavy brow
# ridge, narrowed eyes with gold irises and pinpoint pupils (the piercing stare), weathered grey streaks and scruffy
# cheek feathers, and a captain's gold braid along the cap brim with a gold cord and buttons on the crown.
# The beak is this module's own two-part loft (replacing the family's cone beak): upper on the head, lower on the jaw.
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
    'build': 'average',
    'colors': {'beak': '#F5C330', 'skin': '#E0483B'},
    'body_over': {'hand_mat': 'fur_light', 'tail_mat': 'feather', 'tail_tip_mat': 'feather_accent'},
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


# ------------------------------------------------------------------------------------------- eyes: gold irises
def irises(head, eyes, mat='fur_dark', scale=(1.75, 1.45)):
    """A coloured iris ring round each pupil (rigid to the eye bone, under the pupil, over the white)."""
    out = []
    for s in (1, -1):
        sd = 'L' if s > 0 else 'R'
        piv, R = eyes.frame(s)
        ER = eyes.R
        pa, pe = math.radians(eyes.pupil[0]) * scale[0], math.radians(eyes.pupil[1]) * scale[1]
        paz, pel = -math.radians(1.0) * s, -math.radians(2.0)

        def sdf(P, piv=piv, R=R):
            q = (np.asarray(P, float) - piv) @ R
            r = np.linalg.norm(q, axis=-1)
            az = np.arctan2(q[..., 0], q[..., 2])
            el = np.arcsin(np.clip(q[..., 1] / np.maximum(r, 1e-9), -1, 1))
            ov = (np.sqrt(((az - paz) / pa) ** 2 + ((el - pel) / pe) ** 2) - 1.0) * min(pa, pe) * ER
            shell = np.abs(r - (ER + 0.004 - 0.008)) - 0.008
            return SD.smax(ov, shell, 0.004)
        c = eyes.sph(piv, R, ER, paz, pel)
        V, F = MS.sdf_mesh(sdf, c - 0.2, c + 0.2, 0.005, tris=K.tq(110, 24))
        p = Part(V, F, mat, 'iris_' + sd)
        p.rigid('eye.' + sd)
        out.append(p)
    head.pupils += out
    return out


# ------------------------------------------------------------------------------------------- the captain's braid
def captain_braid(head, mat='accessory_a'):
    """Gold oak-leaf braid along the front edge of the brim, a gold cord across the crown just above the brim with a
    button at each end (rigid to the cap bone). Built from the cap's own meshes (call after the cap exists)."""
    brim = next(p for p in head.parts if p.name == 'brim')
    crown = next(p for p in head.parts if p.name == 'crown')
    V = brim.V
    xs = np.linspace(-0.80, 0.80, 15) * np.abs(V[:, 0]).max()
    edge = []
    for x in xs:
        near = V[np.argsort(np.abs(V[:, 0] - x))[:max(10, len(V) // 30)]]
        k = np.argmin(near[:, 1])
        fy = near[k, 1]
        band = near[near[:, 1] < fy + 0.10]
        edge.append(np.array([x, fy + 0.055, band[:, 2].max() + 0.004]))
    edge = np.array(edge)
    terms = [SD.ptube(list(K.curve_pts(edge, 4)), 0.02)]
    for i in range(len(edge) - 1):            # oak leaves leaning alternately in and out along the edge
        a, b = edge[i], edge[i + 1]
        t = nrm(b - a)
        for side in (1, -1):
            c = (a + b) / 2 + np.array([0, 0.035 * side, 0.002])
            ax = nrm(t + np.array([0, 0.6 * side, 0]))
            Rm = G.frame_from(ax, (0, 0, 1))
            terms.append(SD.ellipsoid(c, (0.026, 0.048, 0.012), R=Rm))
    f = SD.smooth_union(0.008, *terms)
    lo, hi = edge.min(0) - 0.15, edge.max(0) + 0.15
    p = K.sdf_part(f, lo, hi, K.hq(0.006), K.tq(520, 60), mat, 'braid')
    p.rigid('cap')
    out = [p]
    # the cord: round the front of the crown just above the brim's root
    C = crown.V
    cy = C[:, 1].mean()
    root = V[np.argsort(np.abs(V[:, 0]))[:max(16, len(V) // 20)]]
    z0 = root[root[:, 1] > root[:, 1].max() - 0.05][:, 2].max() + 0.05        # just above the brim's root
    pts = []
    for ang in np.linspace(-1.0, 1.0, 13):
        d = np.array([math.sin(ang), -math.cos(ang), 0.0])
        zc = z0 + 0.02 * (1 - math.cos(ang))
        rel = C[:, :2] - np.array([0.0, cy])
        along = rel @ d[:2]
        perp = np.abs(rel @ np.array([-d[1], d[0]]))
        sel = C[(perp < 0.08) & (along > 0) & (np.abs(C[:, 2] - zc) < (0.03 if K.LOD == 0 else 0.06))]
        if not len(sel):
            continue
        q = sel[np.argmax(sel[:, :2] @ d[:2])].copy()
        q[2] = zc
        pts.append(q + np.array([d[0], d[1], 0]) * 0.01)
    if len(pts) > 3:
        pts = np.array(pts)
        cord = SD.ptube(list(K.curve_pts(pts, 3)), 0.017)
        btn = [SD.sphere(pts[0] + np.array([0, 0, 0.0]), 0.034), SD.sphere(pts[-1], 0.034)]
        g = SD.smooth_union(0.01, cord, *btn)
        q = K.sdf_part(g, pts.min(0) - 0.15, pts.max(0) + 0.15, K.hq(0.006), K.tq(300, 40), mat, 'cord')
        q.rigid('cap')
        out.append(q)
    head.parts += out
    return out


# ------------------------------------------------------------------------------------------- params / features
def params(ctx):
    o = ctx.opts
    boss = bool(o.get('boss'))
    crown = o.get('crown', 1.0)
    P = dict(
        cran=dict(c=(0.0, 0.07, 4.14), r=(0.56, 0.58, 0.60 * crown)),
        face=dict(c=(0.0, -0.20, 4.06), r=(0.44, 0.40, 0.35), k=0.18),
        cheek=dict(c=(0.26, -0.15, 3.86), r=(0.30, 0.32, 0.27), k=0.15),
        chin=dict(c=(0.0, -0.30, 3.68), r=(0.25, 0.28, 0.16), k=0.12),
        eye=dict(x=0.21, z=4.19, axis=(0.20, -1.0, 0.03), W=0.135, H=0.19, pupil=(9.0, 13.5)),
        brow=dict(z=4.45, x0=0.07, x1=0.35, arch=0.05, thick=0.05, mat='mask', tilt=0.0),
        regions=[],
    )
    hood = o.get('hood', 0.0)
    if boss:
        hood = max(hood, 0.8)
        P['eye'].update(lid_drop=9.0, pupil=(5.5, 7.5), W=0.14, H=0.18)
        P['brow'].update(thick=0.075, arch=0.02, tilt=0.09, x1=0.38)
        P['extra'] = [(0.07, SD.capsule((-0.30, -0.46, 4.40), (0.30, -0.46, 4.40), 0.085))]        # heavy brow ridge
    if hood > 0:          # grey weathered streaks behind the eyes (winter plumage)
        r = (0.20 + 0.10 * hood, 0.30, 0.12 + 0.06 * hood)
        P['regions'] = [('fur_light', M.region_ellipsoid((s * 0.50, 0.12, 4.12), r)) for s in (1, -1)] + P['regions']
    return P


def beak_for(ctx, geo):
    o = ctx.opts
    boss = bool(o.get('boss'))
    k = o.get('beak', 1.0) * (1.12 if boss else 1.0)
    bk = LoftBeak(geo.f, 3.93, 0.64 * k, 0.135 * (1.08 if boss else 1.0), 0.105 * (1.1 if boss else 1.0), 0.075,
                  droop=0.05, hook=0.065 * (1.4 if boss else 1.0), gonys=0.022)
    s0 = 0.74
    spot_c = np.array([0.0, bk.y0 - bk.L * s0, bk.gape(s0) - bk.h_lo(s0) * 0.7])
    spot = (lambda Q, c=spot_c: SD.ellipsoid(c, (0.2, 0.06, 0.055))(Q))
    return bk, bk.parts(regions_lo=[('skin', spot)])


def features(ctx, head, geo):
    o = ctx.opts
    boss = bool(o.get('boss'))
    bk, parts = beak_for(ctx, geo)
    replace_beak(head, geo, bk, parts)
    if boss:
        irises(head, geo.eyes, mat='fur_dark')
    if boss or o.get('tufts'):
        B.cheek_tufts(ctx, head, geo, mat='feather', n=2 if boss else 1, size=0.10)
    if ctx.acc.get('freckles'):
        M.freckles(ctx, head, geo, n=3, mat='fur_light')


def epaulettes(ctx, head, mat='accessory_a', pad_mat='team_b'):
    """Gold-fringed shoulder boards on the jersey. They are body pieces, but the kit has no such gear, so they are
    built here: the body joints and the jersey surface come from the same kit functions cbuild uses (cskel.joints_for,
    cbody.torso_sdf), the pieces are skinned with the jersey's own weights (cbody.torso_weights) and handed back in
    head design space (cbuild places head parts with world = J['head'] + Kh (p - HEAD_PIVOT)). The spec repeats the
    build in head['epaulettes'] so the head cache follows build changes."""
    import cskel as SK
    import cbody as CB
    b = dict(SK.DEFAULT_BUILD)
    b.update(ctx.spec.get('build') or {})
    J = SK.joints_for(b, None)
    f = CB.torso_sdf(J, ctx.spec.get('body') or {})
    S = CB.scales(J)
    Kh = 1.08 * b.get('head', 1.0)
    out = []
    for s in (1, -1):
        ua = np.asarray(J['upper_arm.L'], float) * np.array([s, 1, 1])
        c = K.march_to(f, ua + np.array([s * 0.02, 0.0, 0.9]), (0, 0, -1))
        n_ = SD.normals(f, c[None])[0]
        ax = nrm(np.array([s * 1.0, 0.0, 0.0]) - np.dot([s * 1.0, 0, 0], n_) * n_)
        Rm = np.stack([ax, np.cross(n_, ax), n_], 1)
        pad = SD.ellipsoid(c + n_ * 0.03, (0.27 * S['ws'], 0.19, 0.04), R=Rm)
        board = SD.smooth_union(0.02, pad, SD.ellipsoid(c + n_ * 0.035 - ax * 0.05, (0.21 * S['ws'], 0.14, 0.05), R=Rm))
        V, F = MS.sdf_mesh(board, c - 0.5, c + 0.5, K.hq(0.009), tris=K.tq(220, 40))
        # gold rim round the board, team colour (dark) in the middle
        rim = lambda Q, c=c, Rm=Rm: -(SD.ellipsoid(c - ax * 0.03, (0.19 * S['ws'], 0.125, 0.2), R=Rm)(Q))
        V, F = MS.cut_by_field(V, F, lambda Q: -rim(Q), surf=board)
        pp = Part(V, F, MS.faces_by_region(V, F, [(pad_mat, lambda Q: -rim(Q))], mat), 'epaulette')
        K.orient_outward(pp)
        # bullion fringe hanging from the outer end
        tips = []
        end = c + ax * 0.25 * S['ws'] + n_ * 0.02
        for k in range(7):
            t = (k / 6 - 0.5) * 2
            a = end + Rm[:, 1] * 0.15 * t - ax * 0.04 * abs(t)
            tips.append(SD.capsule(a, a + np.array([0, 0, -0.19]) + ax * 0.04, 0.026))
        fr = SD.smooth_union(0.012, *tips)
        V2, F2 = MS.sdf_mesh(fr, end - 0.4, end + 0.4, K.hq(0.007), tris=K.tq(200, 40))
        fp = Part(V2, F2, mat, 'fringe')
        K.orient_outward(fp)
        for p in (pp, fp):
            W = CB.torso_weights(J, p.V, p.F)
            p.set_weights({k: w for k, w in W.items()})
            p.V = K.HEAD_PIVOT + (p.V - np.asarray(J['head'], float)) / Kh
            out.append(p)
    head.parts += out
    return out


def build(ctx):
    head = B.build(ctx, params(ctx), features)
    if ctx.opts.get('boss') and ctx.spec.get('cap', True) and not ctx.cap_back:
        captain_braid(head)
    if ctx.opts.get('epaulettes'):
        epaulettes(ctx, head)
    return head

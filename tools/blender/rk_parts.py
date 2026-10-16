# rk_parts.py - Rocco's gloves, cleats, tail, cap and bat.
import math
import numpy as np

import rk_geo as G
import rk_sdf as SD
import rk_mesh as MS
import rk_rig as RR
from rk_geo import Part, nrm


def side_name(s):
    return 'L' if s > 0 else 'R'


def orient_outward(p):
    V = p.V
    vol = 0.0
    for f in p.F:
        a = V[f[0]]
        for k in range(1, len(f) - 1):
            vol += np.dot(a, np.cross(V[f[k]], V[f[k + 1]]))
    if vol < 0:
        p.F = [f[::-1] for f in p.F]
    return p


def sdf_part(f, lo, hi, h, tris, mat, name):
    V, F = MS.sdf_mesh(f, np.asarray(lo, float), np.asarray(hi, float), h, tris=tris)
    return Part(V, F, mat, name)


# =========================================================================================== gloves
HANDLE_R = RR.HANDLE_R


def glove_frame(s):
    """Left-hand frame mirrored for the right: origin = wrist; x_g = pinky -> index, y_g = along the hand,
    z_g = back of the hand. Returns (W, X, Y, Z, GC)."""
    mir = np.array([s, 1.0, 1.0])
    W = RR.jv('hand.' + side_name(s))
    return W, RR.GLOVE_T * mir, RR.GLOVE_U * mir, RR.GLOVE_V * mir, RR.GRIP_C * mir


def _ring_weights(p, seg, wfun):
    """Per-vertex weights for a sweep from per-ring weights (wfun(s) -> {bone: w}); caps copy their end ring."""
    W = {}
    n = p.nside
    m = len(seg)
    for k, sv in enumerate(seg):
        for b, w in wfun(sv).items():
            W.setdefault(b, np.zeros(p.n))
            i0 = p.ring_index[k]
            W[b][i0:i0 + n] = w
    for b in W:
        if p.n > m * n:
            W[b][m * n] = W[b][0]
            W[b][m * n + 1] = W[b][(m - 1) * n]
    return W


def glove_parts(s):
    """Open cartoon glove: a puffy palm, three fat fingers and a thumb on their own bone chains (they curl round
    the bat handle in the grip), a rolled cuff and a team-colour wrist strap."""
    sd = side_name(s)
    W0, X, Y, Z, GC = glove_frame(s)

    def tuv(Q):
        q = np.asarray(Q, float) - W0
        return q @ X, q @ Y, q @ Z
    parts = []
    # palm: puffy rounded slab, wider across the knuckles, domed a touch on the back
    def palm_f(Q):
        t, u, v = tuv(Q)
        wt = 0.137 * (0.86 + 0.14 * np.clip(u / 0.23, 0, 1))
        dome = 0.013 * (1 - np.clip(t / 0.14, -1, 1) ** 2)
        c = np.stack([t / wt, (u - 0.126) / 0.136, (v - 0.006 - dome) / 0.053], -1)
        k = np.sum(np.abs(c) ** 2.6, axis=-1) ** (1 / 2.6)
        return (k - 1.0) * 0.05
    palm = sdf_part(palm_f, W0 - 0.4, W0 + 0.4, 0.006, 210, 'glove', 'palm_' + sd)
    _, pu, _ = tuv(palm.V)
    wf = G.smoothstep(0.18, 0.25, pu)
    palm.set_weights({'hand.' + sd: 1 - wf, 'fingers.' + sd: wf})
    parts.append(palm)
    # fingers and thumb: tubes along their rest chains, dense rings at the joints, round puffy tips
    chains = [(f[0], f[3], 'fingers.' + sd) for f in RR.FINGERS] + [('thumb', RR.THUMB['r'], 'hand.' + sd)]
    for name, r, base_bone in chains:
        K, M, T = (RR.jv(name + k + '.' + sd) for k in ('', '_2', '_end'))
        d1, d2 = nrm(M - K), nrm(T - M)
        L1, L2 = np.linalg.norm(M - K), np.linalg.norm(T - M)
        pts, rad, seg = [], [], []

        def add(p_, rr, sv):
            pts.append(p_)
            rad.append(rr)
            seg.append(sv)
        add(K - d1 * 0.075, r * 0.90, -0.075)
        add(K - d1 * 0.035, r * 0.96, -0.035)
        add(K, r * 0.99, 0.0)
        add(K + d1 * 0.028, r, 0.028)
        for w in (0.32, 0.58, 0.82):
            add(K + d1 * L1 * w, r * (1.0 + 0.035 * math.sin(w * math.pi)), L1 * w)
        add(M - d1 * 0.017, r * 0.955, L1 - 0.017)
        add(M, r * 0.945, L1)
        add(M + d2 * 0.017, r * 0.955, L1 + 0.017)
        for w in (0.36, 0.72):
            add(M + d2 * L2 * w, r * (0.99 + 0.04 * math.sin(w * math.pi)), L1 + L2 * w)
        rt = r * (1.04 if name != 'thumb' else 0.98)
        add(T, rt, L1 + L2)
        for ang in (34, 60, 80):
            a_ = math.radians(ang)
            add(T + d2 * rt * math.sin(a_), rt * math.cos(a_), L1 + L2 + rt * math.sin(a_))
        fp = G.sweep(pts, rad, 8, 'glove', up=tuple(Z), name=name + '_' + sd)
        orient_outward(fp)
        b1, b2 = name + '.' + sd, name + '_2.' + sd

        def wfun(sv, L1=L1, b1=b1, b2=b2, base_bone=base_bone, name=name):
            w0 = 1 - G.smoothstep(-0.035, 0.022, sv) if name != 'thumb' else 0.5 * (1 - G.smoothstep(-0.05, 0.02, sv))
            w2 = G.smoothstep(L1 - 0.024, L1 + 0.024, sv)
            return {base_bone: float(w0), b1: float((1 - w0) * (1 - w2)), b2: float((1 - w0) * w2)}
        fp.set_weights(_ring_weights(fp, seg, wfun))
        parts.append(fp)
    # rolled cuff: flares from the wrist up the forearm and rolls over at the top
    R = G.zframe(-Y)                                   # local z points up the forearm
    prof = [(0.088, -0.035), (0.095, 0.010), (0.103, 0.044), (0.112, 0.069)]
    cz, cr, tr = 0.088, 0.123, 0.022
    for ang in (-80, -40, 0, 40, 80, 120, 160, 200):
        a_ = math.radians(ang)
        prof.append((cr + tr * math.cos(a_), cz + tr * math.sin(a_)))
    prof += [(0.097, 0.075), (0.082, 0.020)]
    V, F = [], []
    nseg = 12
    for (rr, zz) in prof:
        for i in range(nseg):
            a_ = 2 * math.pi * (i + 0.5) / nseg
            V.append(W0 + R @ np.array([rr * math.cos(a_), rr * math.sin(a_), zz]))
    m = len(prof)
    for j in range(m):
        for i in range(nseg):
            q0 = j * nseg + i
            q1 = j * nseg + (i + 1) % nseg
            q2 = ((j + 1) % m) * nseg + (i + 1) % nseg
            q3 = ((j + 1) % m) * nseg + i
            F.append([q0, q1, q2, q3])
    cuff = Part(np.array(V), F, 'glove', 'cuff_' + sd)
    orient_outward(cuff)
    cuff.rigid('hand.' + sd)
    parts.append(cuff)
    # wrist strap (team colour) across the heel of the glove
    Vs, Fs = [], []
    npth = 16
    for i in range(npth):
        th_ = 2 * math.pi * i / npth
        tt, vv = math.cos(th_), math.sin(th_)
        base = np.array([0.110 * tt, 0.036, 0.009 + 0.050 * vv])
        nn = nrm(np.array([tt / 0.110, 0.0, vv / 0.050]))
        for du, dn in ((-0.024, 0.0), (0.024, 0.0), (0.024, 0.014), (-0.024, 0.014)):
            q = base + np.array([0, du, 0]) + nn * dn
            Vs.append(W0 + X * q[0] + Y * q[1] + Z * q[2])
    for i in range(npth):
        for k in range(4):
            a0 = i * 4 + k
            a1 = i * 4 + (k + 1) % 4
            b1_ = ((i + 1) % npth) * 4 + (k + 1) % 4
            b0 = ((i + 1) % npth) * 4 + k
            Fs.append([a0, a1, b1_, b0])
    strap = Part(np.array(Vs), Fs, 'team_a', 'strap_' + sd)
    orient_outward(strap)
    strap.rigid('hand.' + sd)
    parts.append(strap)
    return parts


# =========================================================================================== cleats
def shoe_parts(s):
    sd = side_name(s)
    mir = np.array([s, 1.0, 1.0])
    an = RR.jv('foot.' + sd)
    ball = RR.jv('toe.' + sd)
    cx = an[0]
    SOLE_Z = 0.045          # spikes below this
    parts = []
    # footprint (2D): rounded, wide at the toe, narrower heel
    def foot2d(x, y):
        # y from heel (+0.30) to toe (-0.80)
        yy = (y - (-0.25)) / 0.55
        w = np.where(y < -0.25, 0.235 - 0.06 * np.clip((-0.25 - y) / 0.55, 0, 1) ** 2, 0.215 - 0.04 * np.clip((y + 0.25) / 0.55, 0, 1))
        d = np.sqrt(((x - cx) / w) ** 2 + (yy) ** 2) - 1.0
        return d * 0.22
    def upper_f(Q):
        Q = np.asarray(Q, float)
        toe = SD.ellipsoid((cx, -0.50, 0.215), (0.255, 0.33, 0.215))(Q)        # big domed toe box
        mid = SD.ellipsoid((cx, -0.12, 0.215), (0.205, 0.30, 0.205))(Q)        # instep
        heel = SD.ellipsoid((cx, 0.13, 0.245), (0.18, 0.19, 0.235))(Q)
        collar = SD.capsule((cx, 0.07, 0.30), (cx, 0.08, 0.49), 0.152)(Q)
        u = SD.smin(SD.smin(toe, mid, 0.07), heel, 0.10)
        u = SD.smin(u, collar, 0.06)
        # flat bottom on the sole
        u = SD.smax(u, (SOLE_Z + 0.04) - Q[..., 2], 0.02)
        # the sock enters at the top
        hole = SD.capsule((cx, 0.09, 0.40), (cx, 0.09, 0.7), 0.10)(Q)
        return SD.smax(u, -hole, 0.015)
    up = sdf_part(upper_f, (cx - 0.4, -0.95, -0.05), (cx + 0.4, 0.5, 0.75), 0.009, 300, 'shoe', 'upper_' + sd)
    parts.append(up)
    # toe cap: a shell over the front of the toe box
    def cap_f(Q):
        Q = np.asarray(Q, float)
        inner = upper_f(Q)
        shell = np.abs(inner - 0.012) - 0.012
        front = Q[..., 1] - (-0.50) + 0.0
        # rounded edge: limit by an ellipse in plan
        lim = SD.ellipsoid((cx, -0.62, 0.15), (0.32, 0.30, 0.40))(Q)
        return SD.smax(shell, lim, 0.02)
    tc = sdf_part(cap_f, (cx - 0.4, -0.95, 0.0), (cx + 0.4, -0.2, 0.5), 0.008, 100, 'shoe', 'toecap_' + sd)
    parts.append(tc)
    # sole: a slab following the footprint, slightly wider than the upper; heel block
    def sole_f(Q):
        Q = np.asarray(Q, float)
        d2 = foot2d(Q[..., 0], Q[..., 1]) - 0.035
        dz = np.abs(Q[..., 2] - (SOLE_Z + 0.03)) - 0.032
        slab = SD.smax(d2, dz, 0.012)
        heel = SD.box((cx, 0.17, SOLE_Z + 0.0), (0.15, 0.11, 0.05), rnd=0.02)(Q)
        return SD.smin(slab, heel, 0.01)
    so = sdf_part(sole_f, (cx - 0.4, -0.95, -0.1), (cx + 0.4, 0.5, 0.2), 0.008, 90, 'sole', 'sole_' + sd)
    parts.append(so)
    # spikes: small cones under the sole (ball and heel)
    for (dx, y) in ((-0.12, -0.55), (0.12, -0.55), (0.0, -0.72), (-0.1, 0.16), (0.1, 0.16)):
        sp = G.lathe([(0.0, 0.0), (0.03, SOLE_Z + 0.012)], 5, 'sole', t=(cx + dx, y, 0.0), cap_ends=True)
        sp.flat = True
        parts.append(orient_outward(sp))
    # tongue + laces over the instep
    tongue_f = lambda Q: SD.ellipsoid((cx, -0.02, 0.47), (0.09, 0.05, 0.11), R=G.rot_x(-0.45))(Q)
    tg = sdf_part(tongue_f, (cx - 0.2, -0.3, 0.2), (cx + 0.2, 0.2, 0.65), 0.008, 50, 'shoe', 'tongue_' + sd)
    parts.append(tg)
    def on_top(x, y):
        q = np.array([x, y, 0.8])
        for _ in range(80):
            v = upper_f(q[None])[0]
            if v < 0.002:
                break
            q[2] -= max(v, 0.002)
        return q
    for i, y in enumerate((-0.34, -0.23, -0.12)):
        for sgn in (1, -1):
            a = on_top(cx - 0.115, y + 0.04 * sgn) + np.array([0, 0, 0.012])
            b = on_top(cx + 0.115, y - 0.04 * sgn) + np.array([0, 0, 0.012])
            m = on_top(cx, y) + np.array([0, 0, 0.026])
            lp = G.sweep([a, m, b], [0.020, 0.023, 0.020], 4, 'lace', up=(0, 0, 1))
            parts.append(orient_outward(lp))
    # bow on top of the last cross
    top = on_top(cx, -0.04) + np.array([0, 0, 0.03])
    for sgn in (1, -1):
        lp = G.sweep([top, top + [0.07 * sgn, 0.025, 0.035], top + [0.115 * sgn, -0.02, 0.0], top + [0.05 * sgn, -0.04, -0.018]],
                     [0.018, 0.024, 0.021, 0.016], 5, 'lace', up=(0, -1, 0))
        parts.append(orient_outward(lp))
    # weights: front of the shoe bends with the toe
    for p in parts:
        y = p.V[:, 1]
        wt = G.smoothstep(ball[1] + 0.08, ball[1] - 0.10, y)
        p.set_weights({'toe.' + sd: wt, 'foot.' + sd: 1 - wt})
    return parts


# =========================================================================================== tail
TAIL_BANDS = ['fur', 'mask', 'fur', 'mask', 'fur', 'mask']


def tail_path(n=60):
    """Smooth S-curve through the tail joints (Catmull-Rom), returns points and cumulative length."""
    J = [RR.jv(k) for k in ('tail.1', 'tail.2', 'tail.3', 'tail.4', 'tail.5', 'tail_tip')]
    J = [J[0] + (J[0] - J[1]) * 0.25] + J + [J[-1] + (J[-1] - J[-2]) * 0.5]
    pts = []
    for i in range(1, len(J) - 2):
        p0, p1, p2, p3 = J[i - 1], J[i], J[i + 1], J[i + 2]
        for t in np.linspace(0, 1, 12, endpoint=False):
            t2, t3 = t * t, t * t * t
            pts.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    pts.append(J[-2])
    pts = np.array(pts)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    return pts, s


def tail_part():
    pts, s = tail_path()
    L = s[-1]
    # rings: dense enough, and exactly at every band boundary for crisp colour rings
    start = 0.04 * L
    nb = len(TAIL_BANDS)
    edges = [start + (L - start) * (0.10 + 0.9 * (k / nb) ** 0.92) for k in range(1, nb)]
    edges = [start + (L - start) * x for x in (0.15, 0.31, 0.47, 0.62, 0.76)]
    samp = list(np.linspace(start, L * 0.985, 24)) + edges
    samp = np.array(sorted(set(np.round(samp, 5))))
    P = np.array([np.interp(samp, s, pts[:, i]) for i in range(3)]).T
    u = (samp - start) / (L - start)
    # bushy profile: narrow root, fat middle, pointed tip; each band bulges a little (fluffy scallops)
    base = 0.09 + 0.25 * np.sin(np.clip(u / 0.72, 0, 1) * math.pi / 2) ** 0.8
    base = np.where(u > 0.72, (0.09 + 0.25) * np.clip((1 - u) / 0.28, 0, 1) ** 0.75 + 0.012, base)
    bidx = np.searchsorted(np.array(edges), samp, side='right')
    bstart = np.array([start] + edges)[bidx]
    bend = np.array(edges + [L])[bidx]
    tb = np.clip((samp - bstart) / np.maximum(bend - bstart, 1e-6), 0, 1)
    scallop = 1.0 + 0.05 * np.sin(tb * math.pi) ** 1.5
    rad = base * np.where(u > 0.05, scallop, 1.0)
    rad[-1] = 0.012
    tail = G.sweep(P, rad, 9, 'fur', up=(1, 0, 0))
    ring_of = np.repeat(np.arange(len(P)), 9)
    mats = []
    for f in tail.F:
        rows = [ring_of[i] if i < len(ring_of) else (0 if i == len(ring_of) else len(P) - 1) for i in f]
        r0 = min(rows)
        mid = samp[min(r0, len(samp) - 1)] + 1e-4
        b = int(np.searchsorted(np.array(edges), mid, side='right'))
        mats.append(TAIL_BANDS[min(b, nb - 1)])
    tail.mat = mats
    tail = orient_outward(tail)
    J = [RR.jv(k) for k in ('tail.1', 'tail.2', 'tail.3', 'tail.4', 'tail.5', 'tail_tip')]
    chain = [('tail.%d' % i, J[i - 1], J[i]) for i in range(1, 6)]
    W, _ = RR.chain_weights(tail.V, chain, 0.18)
    # root blends into the hips
    rootw = G.smoothstep(0.25, 0.0, np.linalg.norm(tail.V - J[0], axis=1))
    W = {k: v * (1 - rootw) for k, v in W.items()}
    W['hips'] = rootw
    tail.set_weights(W)
    # slot hem where the tail leaves the knickers
    c = J[0] + (J[1] - J[0]) * 0.02
    d = nrm(J[1] - J[0])
    R = G.zframe(d)
    ring = [c + R @ np.array([0.125 * math.cos(t), 0.125 * math.sin(t), 0]) for t in np.linspace(0, 2 * math.pi, 12, endpoint=False)]
    import rk_body as BD
    hem = BD.ring_sweep(ring, 0.03, 0.025, 6, True, 'uniform', normals=[nrm(p - c) for p in ring])
    hem.rigid('hips')
    return [tail, orient_outward(hem)]


# =========================================================================================== cap
def cap_parts(head_cranium):
    """Six-panel 1940s cap: crown shell over the skull with panel seams and ear slots, top button, short brim.
    head_cranium: SDF of the skull the cap sits on."""
    cap_c = RR.jd('cap')
    parts = []
    # band: high at the front (above the brows), lower at the back of the skull
    def band(Q):
        return (4.645 - 0.17 * (Q[..., 1] + 0.55)) - Q[..., 2]          # negative above the band (pushed back: cocky)
    ears = []
    for s in (1, -1):
        e = RR.jd('ear.' + side_name(s))
        upv = nrm(np.array([0.42 * s, 0.05, 1.0]))
        fwd = nrm(np.array([0.30 * s, -1.0, 0.0]))
        fwd = nrm(fwd - np.dot(fwd, upv) * upv)
        side = np.cross(upv, fwd)
        ears.append((e, upv, side))

    def crown(Q):
        Q = np.asarray(Q, float)
        d = head_cranium(Q)
        # snug shell, a little roomier toward the top (crown height)
        lift = 0.04 + 0.085 * np.clip((Q[..., 2] - 4.45) / 0.33, 0, 1) ** 1.2
        shell = np.abs(d - lift - 0.012) - 0.026
        shell = SD.smax(shell, band(Q), 0.01)
        # ear slots
        for e, upv, side in ears:
            slot = np.minimum(SD.capsule(e - upv * 0.2 + side * 0.075, e + upv * 0.5 + side * 0.075, 0.105)(Q),
                              SD.capsule(e - upv * 0.2 - side * 0.075, e + upv * 0.5 - side * 0.075, 0.105)(Q))
            shell = SD.smax(shell, -slot, 0.012)
        # six panel seams: shallow grooves on meridian planes through the crown's top
        rel = Q - (cap_c + np.array([0, 0.02, 0]))
        ang = np.arctan2(rel[..., 0], -rel[..., 1])
        k = np.round(ang / (math.pi / 3)) * (math.pi / 3)
        dist = np.abs(np.sin(ang - k)) * np.linalg.norm(rel[..., :2], axis=-1)
        groove = dist - 0.006
        outer = d - 0.092
        seam = SD.smax(groove, -outer - 0.012, 0.004)
        shell = SD.smax(shell, -seam, 0.006)
        return shell
    lo = cap_c + np.array([-0.85, -0.85, -0.45])
    hi = cap_c + np.array([0.85, 0.85, 0.5])
    cr = sdf_part(crown, lo, hi, 0.0085, 600, 'team_a', 'crown')
    parts.append(cr)
    # button on top: sits on the crown's highest point
    k = int(np.argmax(cr.V[:, 2] - 2.0 * np.abs(cr.V[:, 0]) - 2.0 * np.abs(cr.V[:, 1] - 0.07)))
    top_pt = cr.V[k].copy()
    btn = G.ellipsoid(top_pt + np.array([0, 0, 0.006]), (0.052, 0.052, 0.03), 8, 3, 'team_b')
    parts.append(btn)
    # brim: a curved plate off the front of the band, slightly drooped, rounded front edge
    def brim(Q):
        Q = np.asarray(Q, float)
        x, y, z = Q[..., 0], Q[..., 1], Q[..., 2]
        # plan shape: half-ellipse in front of the band
        yb = -0.42
        plan = np.sqrt((x / 0.52) ** 2 + (np.minimum(y - yb, 0) / 0.41) ** 2) - 1.0
        plan = np.maximum(plan * 0.3, (y - (yb + 0.22)))
        # curved visor: tipped up a touch, curled down at the sides
        zc = 4.665 + 0.025 * np.clip((yb - y) / 0.41, 0, 1) - 0.11 * (x / 0.52) ** 2 + 0.04 * np.clip((y - yb) / 0.22, 0, 1)
        dz = np.abs(z - zc) - 0.021
        return SD.smax(plan, dz, 0.012)
    bl = cap_c + np.array([-0.7, -1.0, -0.45])
    bh = cap_c + np.array([0.7, -0.1, 0.2])
    br = sdf_part(brim, bl, bh, 0.008, 150, 'team_a', 'brim')
    parts.append(br)
    for p in parts:
        p.rigid('cap')
    return parts


# =========================================================================================== bat
def bat_part():
    piv = RR.jv('bat')
    K, T = RR.BAT_KNOB, RR.BAT_TIP
    prof = [(0.0, K - 0.045), (0.06, K - 0.043), (0.083, K - 0.02), (0.08, K + 0.0), (0.052, K + 0.035), (0.047, K + 0.1),
            (0.047, 0.30), (0.052, 0.55), (0.066, 0.85), (0.092, 1.2), (0.118, 1.55), (0.13, 1.9), (0.131, T - 0.12),
            (0.124, T - 0.04), (0.10, T - 0.008), (0.0, T)]
    R = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)   # lathe +z -> bat axis (-Y)
    bat = G.lathe(prof, 10, 'bat_wood', R=R, t=piv)
    along = -(bat.V[:, 1] - piv[1])
    for i, f in enumerate(bat.F):
        a = along[f].mean()
        if -0.25 < a < 0.32:
            bat.mat[i] = 'bat_tape'
    bat.rigid('bat')
    return orient_outward(bat)

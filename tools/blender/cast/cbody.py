# cbody.py - parametric cast body on a cskel joint table: uniform torso + knickers (SDF, QuadriFlow), arms, stirrup
# socks, cleats and gloves (Rocco's parts re-fitted to the joints), uniform details and decal patches.
# Body params (bp, 1.0 = Rocco): chest_w, chest_d, belly, belly_drop, seat, thigh, shoulder, arm_r, neck_r.
import math
import numpy as np
import cast_common as CC  # noqa: F401
import rk_geo as G
import rk_sdf as SD
import rk_mesh as MS
import rk_rig as RR
import rk_body as BD
import rk_parts as PT
from rk_geo import Part, nrm

DEFAULT_BP = dict(chest_w=1.0, chest_d=1.0, belly=1.0, belly_drop=0.0, seat=1.0, thigh=1.0, shoulder=1.0, arm_r=1.0,
                  neck_r=1.0, cuff=1.0)
SLEEVE_LEN = 0.36


def jl(J, name, s=1):
    return np.asarray(J[name + ('.L' if s > 0 else '.R')], float)


def scales(J):
    """Overall proportions of a joint table relative to Rocco's (torso length, shoulder width, hip width, leg)."""
    ts = (J['neck'][2] - J['hips'][2]) / (RR.J['neck'][2] - RR.J['hips'][2])
    ws = J['upper_arm.L'][0] / RR.J['upper_arm.L'][0]
    hw = J['thigh.L'][0] / RR.J['thigh.L'][0]
    ls = np.linalg.norm(J['shin.L'] - J['thigh.L']) / np.linalg.norm(np.subtract(RR.J['shin.L'], RR.J['thigh.L']))
    hs = np.linalg.norm(J['index.L'] - J['hand.L']) / np.linalg.norm(np.subtract(RR.J['index.L'], RR.J['hand.L']))
    fs = np.linalg.norm(J['toe.L'] - J['foot.L']) / np.linalg.norm(np.subtract(RR.J['toe.L'], RR.J['foot.L']))
    return dict(ts=ts, ws=ws, hw=hw, ls=ls, hs=hs, fs=fs)


def cuff_z(J):
    return J['shin.L'][2] - 0.14 * scales(J)['ls']


def torso_sdf(J, bp):
    b = dict(DEFAULT_BP)
    b.update(bp or {})
    S = scales(J)
    ts, ws, hw = S['ts'], S['ws'], S['hw']
    hips, spine, chest, neck = (np.asarray(J[k], float) for k in ('hips', 'spine', 'chest', 'neck'))
    chest_e = SD.ellipsoid(chest + np.array([0, 0, 0.22 * ts]), (0.40 * ws * b['chest_w'], 0.31 * b['chest_d'], 0.42 * ts))
    shoulders = SD.capsule(chest + np.array([-0.34 * ws, 0.02, 0.50 * ts]), chest + np.array([0.34 * ws, 0.02, 0.50 * ts]),
                           0.17 * b['shoulder'])
    bel = b['belly']
    belly = SD.ellipsoid(spine + np.array([0, -0.16 - 0.06 * (bel - 1), 0.15 * ts - b['belly_drop']]),
                         (0.49 * max(hw, ws) ** 0.5 * bel, 0.50 * bel, 0.41 * ts * (0.6 + 0.4 * bel)))
    st = b['seat']
    seat = SD.ellipsoid(hips + np.array([0, 0.15, 0]), (0.55 * hw * st, 0.52 * st, 0.37 * st * ts ** 0.5))
    yoke = SD.ellipsoid(neck + np.array([0, 0.03, -0.05 * ts]), (0.44 * ws, 0.36 * b['chest_d'], 0.17 * ts))
    base = SD.smooth_union(0.14, chest_e, shoulders)
    base = SD.smooth_union(0.10, base, yoke)
    base = SD.smooth_union(0.20, base, belly)
    base = SD.smooth_union(0.20, base, seat)
    cz = cuff_z(J)
    th = b['thigh']
    for s in (1, -1):
        hj, kn = jl(J, 'thigh', s), jl(J, 'shin', s)
        ax = nrm(kn - hj)
        thigh = SD.round_cone(hj + np.array([0, 0.02, 0.06]), kn + ax * -0.02, 0.215 * th, 0.225 * th)
        bulge = SD.ellipsoid(kn + np.array([0.0, -0.01, 0.05]), (0.235 * th, 0.235 * th, 0.17 * th))
        cuff = SD.round_cone(kn, np.array([kn[0], kn[1], cz + 0.02]), 0.205 * th, 0.138 * b['cuff'] * th ** 0.5)
        leg = SD.smooth_union(0.06, SD.smooth_union(0.10, thigh, bulge), cuff)
        base = SD.smooth_union(0.07, base, leg)
    for s in (1, -1):
        sh = jl(J, 'upper_arm', s)
        d = RR.ARM_DIR * np.array([s, 1, 1])
        base = SD.smooth_union(0.07, base, SD.round_cone(sh - d * 0.10 + np.array([0, 0, 0.04]), sh + d * SLEEVE_LEN,
                                                          0.19 * b['arm_r'], 0.172 * b['arm_r']))
    nr = b['neck_r']
    holes = [SD.capsule(neck + np.array([0, 0, -0.18]), neck + np.array([0, 0, 0.42]), 0.252 * nr)]
    for s in (1, -1):
        sh = jl(J, 'upper_arm', s)
        d = RR.ARM_DIR * np.array([s, 1, 1])
        end = sh + d * SLEEVE_LEN
        holes.append(SD.round_cone(end - d * 0.16, end + d * 0.2, 0.128 * b['arm_r'], 0.14 * b['arm_r']))
        kn = jl(J, 'shin', s)
        holes.append(SD.capsule(np.array([kn[0], kn[1], cz + 0.12]), np.array([kn[0], kn[1], cz - 0.2]), 0.112 * b['cuff'] * th ** 0.5))
    return SD.smooth_sub(0.025, base, SD.union(*holes))


def torso_segments(J):
    hips, spine, chest, neck = (np.asarray(J[k], float) for k in ('hips', 'spine', 'chest', 'neck'))
    S = scales(J)
    segs = [('hips', hips + np.array([0, 0.04, -0.40 * S['ts']]), hips + np.array([0, 0.02, 0.16 * S['ts']]), 0.55 * S['hw']),
            ('spine', spine + np.array([0, 0, -0.08 * S['ts']]), spine + np.array([0, 0, 0.34 * S['ts']]), 0.50 * S['ws']),
            ('chest', chest + np.array([0, 0, -0.02 * S['ts']]), chest + np.array([0, 0, 0.58 * S['ts']]), 0.42 * S['ws'])]
    for s in (1, -1):
        sd = 'L' if s > 0 else 'R'
        segs += [('shoulder.' + sd, jl(J, 'shoulder', s), jl(J, 'upper_arm', s), 0.20),
                 ('upper_arm.' + sd, jl(J, 'upper_arm', s) + RR.ARM_DIR * np.array([s, 1, 1]) * 0.08, jl(J, 'forearm', s), 0.17),
                 ('thigh.' + sd, jl(J, 'thigh', s), jl(J, 'shin', s), 0.24),
                 ('shin.' + sd, jl(J, 'shin', s) + np.array([0, 0, -0.06]), jl(J, 'foot', s), 0.17)]
    return segs


def torso_weights(J, V, F):
    x, z = V[:, 0], V[:, 2]
    S = scales(J)
    hipz, knz = J['thigh.L'][2], J['shin.L'][2]
    shz = J['upper_arm.L'][2]
    mask = {}
    for s, sd in ((1, 'L'), (-1, 'R')):
        side_ok = G.smoothstep(-0.05 * s, 0.12 * s, x) if s > 0 else G.smoothstep(0.05, -0.12, x)
        for b in ('shoulder', 'upper_arm', 'thigh', 'shin'):
            mask[b + '.' + sd] = side_ok
    for sd in ('L', 'R'):
        mask['thigh.' + sd] = mask['thigh.' + sd] * G.smoothstep(hipz + 0.15, hipz - 0.15, z)
        mask['shin.' + sd] = mask['shin.' + sd] * G.smoothstep(knz + 0.20, knz - 0.05, z)
        mask['upper_arm.' + sd] = mask['upper_arm.' + sd] * G.smoothstep(shz - 0.39, shz - 0.14, z)
        mask['shoulder.' + sd] = mask['shoulder.' + sd] * G.smoothstep(shz - 0.34, shz - 0.09, z)
    W = BD.seg_weights(V, torso_segments(J), power=5.0, mask=mask)
    W = BD.smooth_weights(W, F, len(V), iters=8, lam=0.6)
    for sd, sgn in (('L', 1), ('R', -1)):          # thighs own their trouser legs (see rk_body)
        g = G.smoothstep(hipz - 0.08, hipz - 0.45 * S['ls'], z) * G.smoothstep(0.04, 0.16, x * sgn)
        mv = W['hips'] * g
        W['hips'] = W['hips'] - mv
        W['thigh.' + sd] = W['thigh.' + sd] + mv
    for sd in ('L', 'R'):                          # knee: split by height over the knee bulge
        tot = W['thigh.' + sd] + W['shin.' + sd]
        f = G.smoothstep(knz + 0.20 * S['ls'], knz - 0.10 * S['ls'], z)
        W['shin.' + sd] = tot * f
        W['thigh.' + sd] = tot * (1 - f)
    return W


def torso_part(J, bp, f, quads=1250):
    S = scales(J)
    top = J['neck'][2] + 0.4
    lo = np.array([-1.0 * max(S['ws'], S['hw']) - 0.3, -0.95, cuff_z(J) - 0.2])
    hi = np.array([1.0 * max(S['ws'], S['hw']) + 0.3, 0.95, top])
    V, F = MS.sdf_mesh(f, lo, hi, 0.014 * max(S['ts'], 0.8), quads=quads, seed=3)
    knz = J['shin.L'][2]
    knee = lambda P: (P[:, 2] > knz - 0.20) & (P[:, 2] < knz + 0.36) & (np.abs(P[:, 0]) > 0.08)
    V, F = MS.refine_region(V, F, knee, f)
    p = Part(V, F, 'team_a', 'torso')
    # jersey (team colour) above the belt, knickers (uniform) below
    beltz = J['spine'][2] + 0.005
    mats = ['team_a' if V[fc].mean(0)[2] > beltz else 'uniform' for fc in F]
    p.mat = mats
    p.set_weights(torso_weights(J, V, F))
    return p


def arm_part(J, s, bp):
    sd = 'L' if s > 0 else 'R'
    ar = (bp or {}).get('arm_r', 1.0)
    d = RR.ARM_DIR * np.array([s, 1, 1])
    sh, el, wr = jl(J, 'upper_arm', s), jl(J, 'forearm', s), jl(J, 'hand', s)
    L1, L2 = np.linalg.norm(el - sh), np.linalg.norm(wr - el)
    ts = np.concatenate([[0.06, 0.20, 0.35, 0.50, 0.62, 0.72, 0.80, 0.86, 0.91, 0.955, 1.0],
                         1.0 + np.array([0.045, 0.09, 0.14, 0.20, 0.28, 0.40, 0.55, 0.70, 0.85, 1.0]) * (L2 / L1)])
    path = [sh + d * (t * L1) for t in ts]
    path.append(wr + d * 0.04)
    u = np.linspace(0, 1, len(path))
    rad = (0.108 - 0.040 * u - 0.01 * np.sin(u * math.pi) + 0.012 * np.exp(-((u - 0.18) / 0.15) ** 2)) * ar
    p = G.sweep(path, rad, 9, (bp or {}).get('arm_mat', 'team_a'), up=(0, 1, 0))
    chain = [('upper_arm.' + sd, sh, el), ('forearm.' + sd, el, wr), ('hand.' + sd, wr, wr + d * 0.2)]
    W, _ = RR.chain_weights(p.V, chain, 0.21)
    p.set_weights(W)
    return p


def sock_part(J, s):
    """Stirrup sock re-fitted between the knicker cuff and the ankle (Rocco's design)."""
    sd = 'L' if s > 0 else 'R'
    kn, an = jl(J, 'shin', s), jl(J, 'foot', s)
    cz = cuff_z(J)
    top = np.array([kn[0], kn[1], cz + 0.10])
    bot = an + np.array([0, 0, -0.06])
    n = 11
    path = [top + (bot - top) * t for t in np.linspace(0, 1, n)]
    u = np.linspace(0, 1, n)
    rad = 0.118 + 0.022 * np.exp(-((u - 0.28) / 0.22) ** 2) - 0.03 * u
    p = G.sweep(path, rad, 12, 'team_a', up=(0, -1, 0))
    axis = nrm(bot - top)
    L = np.linalg.norm(bot - top)

    def local(P):
        P = np.asarray(P, float)
        q = P - top
        h = q @ axis
        r = q - np.outer(h, axis) if q.ndim == 2 else q - h[..., None] * axis
        ang = np.arctan2(r @ np.array([1.0 * s, 0, 0]), r @ np.array([0, -1.0, 0]))
        return h / L, ang

    def arch(P):
        hh, ang = local(P)
        sa = np.abs(np.sin(ang))
        top_h = 0.56 - 0.26 * np.sqrt(np.clip((sa - 0.62) / 0.38, 0, 1))
        return np.maximum((0.62 - sa) * 0.6, top_h - hh)

    def stripe(P):
        hh, ang = local(P)
        return np.abs(hh - 0.14) - 0.035
    p.V, p.F = MS.cut_by_field(p.V, p.F, arch)
    p.V, p.F = MS.cut_by_field(p.V, p.F, stripe)
    p.mat = MS.faces_by_region(p.V, p.F, [('sock', arch), ('team_b', stripe)], 'team_a')
    p.rigid('shin.' + sd)
    return p


def refit(parts, src, dst, k):
    """Similarity-move parts built on Rocco's joints: p' = dst + (p - src) * k."""
    for p in parts:
        p.V = np.asarray(dst, float) + (p.V - np.asarray(src, float)) * k
        if p.sk:
            p.sk = {kk: d * k for kk, d in p.sk.items()}
    return parts


def shoes(J, s):
    sd = 'L' if s > 0 else 'R'
    S = scales(J)
    src = np.array(RR.J['toe.' + sd], float)
    src_g = src * np.array([1, 1, 0])
    dst = np.asarray(J['toe.' + sd], float) * np.array([1, 1, 0])
    return refit(PT.shoe_parts(s), src_g, dst, S['fs'])


def gloves(J, s):
    """Rocco's open four-finger glove re-fitted to this hand (batting / bare hand)."""
    sd = 'L' if s > 0 else 'R'
    S = scales(J)
    return refit(PT.glove_parts(s), RR.J['hand.' + sd], J['hand.' + sd], S['hs'])


def details(J, f, bp=None):
    """Collar and placket trim, buttons, belt and buckle, sleeve trim, knicker cuff bands."""
    S = scales(J)
    neck, spine, chest = (np.asarray(J[k], float) for k in ('neck', 'spine', 'chest'))
    nr = (bp or {}).get('neck_r', 1.0)
    parts = []
    segs = torso_segments(J)[:3]
    col = []
    for i in range(18):
        a = 2 * math.pi * i / 18
        col.append([0.272 * nr * math.sin(a), neck[1] - 0.25 * nr * math.cos(a), neck[2] + 0.09 * S['ts'] - 0.035 * math.cos(a)])
    ring = BD.ring_sweep(col, 0.03, 0.026, 6, True, 'uniform', up=(0, 0, 1))
    ring.set_weights({'chest': np.full(ring.n, 0.7), 'neck': np.full(ring.n, 0.3)})
    parts.append(BD.orient_outward(ring))
    ztop, zbot = neck[2] + 0.05 * S['ts'], spine[2] + 0.05
    zs = np.linspace(ztop, zbot, 11)
    pts = BD.project_to(f, np.array([[0.0, -1.2, z] for z in zs]), 0.004)
    pl = BD.ring_sweep(pts, 0.012, 0.042, 6, False, 'uniform', normals=SD.normals(f, pts))
    pl.set_weights(BD.seg_weights(pl.V, segs, 5.0))
    parts.append(BD.orient_outward(pl))
    for z in np.linspace(ztop - 0.17 * S['ts'], zbot + 0.12, 4):
        c = BD.project_to(f, np.array([[0.0, -1.2, z]]), 0.016)[0]
        n_ = SD.normals(f, c[None])[0]
        btn = G.ellipsoid(c, (0.03, 0.03, 0.012), 6, 3, 'uniform', R=G.zframe(n_))
        btn.set_weights(BD.seg_weights(btn.V, segs, 5.0))
        parts.append(btn)
    beltz = spine[2] + 0.005
    loop = BD.surface_loop(f, beltz, cy=spine[1], offset=0.012, n=24, r0=1.6)
    nrms = np.array([nrm(np.array([p[0], p[1] - spine[1], 0])) for p in loop])
    belt = BD.ring_sweep(loop, 0.026, 0.055, 6, True, 'belt', normals=nrms)
    belt.set_weights(BD.seg_weights(belt.V, segs, 5.0))
    parts.append(BD.orient_outward(belt))
    front = loop[0]
    bc = front + np.array([0, -0.03, 0])
    fr = [bc + np.array([0.075 * math.cos(t), 0, 0.058 * math.sin(t)]) for t in np.linspace(0, 2 * math.pi, 12, endpoint=False)]
    bk = BD.ring_sweep(fr, 0.016, 0.016, 4, True, 'lace', normals=[np.array([0, -1.0, 0])] * len(fr))
    bk.rigid('spine')
    parts.append(BD.orient_outward(bk))
    prong = G.box(bc + np.array([0, -0.012, 0]), (0.02, 0.012, 0.09), 'lace')
    prong.rigid('spine')
    parts.append(prong)
    ar = (bp or {}).get('arm_r', 1.0)
    cz = cuff_z(J)
    th = (bp or {}).get('thigh', 1.0)
    for s in (1, -1):
        sd = 'L' if s > 0 else 'R'
        sh = jl(J, 'upper_arm', s)
        d = RR.ARM_DIR * np.array([s, 1, 1])
        c = sh + d * (SLEEVE_LEN - 0.015)
        R = G.zframe(d)
        pts = [c + R @ np.array([math.cos(t) * 0.176 * ar, math.sin(t) * 0.176 * ar, 0]) for t in np.linspace(0, 2 * math.pi, 12, endpoint=False)]
        r = BD.ring_sweep(pts, 0.022, 0.03, 6, True, 'uniform', normals=[nrm(p - c) for p in pts])
        r.set_weights({'upper_arm.' + sd: np.full(r.n, 0.85), 'shoulder.' + sd: np.full(r.n, 0.15)})
        parts.append(BD.orient_outward(r))
        kn = jl(J, 'shin', s)
        c = np.array([kn[0], kn[1], cz + 0.035])
        rr = 0.142 * (bp or {}).get('cuff', 1.0) * th ** 0.5
        pts = [c + np.array([math.cos(t) * rr, math.sin(t) * rr, 0.0]) for t in np.linspace(0, 2 * math.pi, 10, endpoint=False)]
        r = BD.ring_sweep(pts, 0.024, 0.032, 6, True, 'team_a', normals=[nrm(np.array([p[0] - c[0], p[1] - c[1], 0])) for p in pts])
        r.rigid('shin.' + sd)
        parts.append(BD.orient_outward(r))
    return parts


def decal_parts(J, f):
    """UV'd patches on the jersey: team letter on the chest (left side), card number on the back."""
    S = scales(J)
    chest = np.asarray(J['chest'], float)
    segs = torso_segments(J)[:3]

    def patch(cx, cz, wdt, hgt, back, mat):
        nu = nv = 4
        V, U, F = [], [], []
        for j in range(nv + 1):
            for i in range(nu + 1):
                u, v = i / nu, j / nv
                V.append([cx + (u - 0.5) * wdt * (-1 if back else 1), 1.4 if back else -1.4, cz + (v - 0.5) * hgt])
        V = np.array(V)
        d = np.array([0, -1.0, 0]) if back else np.array([0, 1.0, 0])
        for k in range(len(V)):
            p = V[k]
            for _ in range(140):
                v = f(p[None])[0]
                if v < 0.002:
                    break
                p = p + d * max(v, 0.002)
            V[k] = p
        V = V + SD.normals(f, V) * 0.007
        for j in range(nv):
            for i in range(nu):
                a = j * (nu + 1) + i
                F.append([a, a + 1, a + nu + 2, a + nu + 1])
                U.append([(i / nu, j / nv), ((i + 1) / nu, j / nv), ((i + 1) / nu, (j + 1) / nv), (i / nu, (j + 1) / nv)])
        p = Part(V, F, mat, mat)
        p.uv = U
        p.set_weights(BD.seg_weights(p.V, segs, 5.0))
        out = np.array([0, 1.0, 0]) if back else np.array([0, -1.0, 0])
        f0 = p.F[0]
        nn = np.cross(p.V[f0[1]] - p.V[f0[0]], p.V[f0[3]] - p.V[f0[0]])
        if np.dot(nn, out) < 0:
            p.F = [ff[::-1] for ff in p.F]
            p.uv = [uu[::-1] for uu in p.uv]
        return p
    a = patch(0.21 * S['ws'], chest[2] + 0.22 * S['ts'], 0.30, 0.32, False, 'decal_chest')
    b = patch(0.0, chest[2] + 0.18 * S['ts'], 0.44, 0.46, True, 'decal_back')
    return [a, b]


def build_body(J, bp, hands=('glove', 'mitt'), quads=1250):
    """Torso, arms, socks, cleats, hands and uniform details for a joint table. hands = (right, left):
    'glove' (open four-finger glove) or 'mitt' (fielding mitt, left hand only)."""
    import cgear as GR
    f = torso_sdf(J, bp)
    parts = [torso_part(J, bp, f, quads)]
    for s in (1, -1):
        parts.append(arm_part(J, s, bp))
        parts.append(sock_part(J, s))
        parts += shoes(J, s)
    right, left = hands
    if right == 'glove':
        parts += gloves(J, -1)
    if left == 'glove':
        parts += gloves(J, 1)
    elif left == 'mitt':
        parts.append(GR.mitt_part(J, scales(J)['hs']))
    parts += details(J, f, bp)
    return parts, decal_parts(J, f), f

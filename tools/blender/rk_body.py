# rk_body.py - Rocco's body: jersey + knickers (one sculpted SDF surface), noodle arms in team-colour
# undersleeves, stirrup socks, and the clothing details (collar/placket/sleeve piping, buttons, belt, buckle, cuffs).
import math
import numpy as np

import rk_geo as G
import rk_sdf as SD
import rk_mesh as MS
import rk_rig as RR
from rk_geo import Part, nrm

ARM = RR.ARM_DIR


def jl(name, s=1):
    return RR.jv(name + ('.L' if s > 0 else '.R'))


# ------------------------------------------------------------------------------------------- torso SDF
SLEEVE_LEN = 0.36            # beyond the shoulder joint, along the arm
CUFF_Z = 0.86                # knickers end (gathered) just below the knee


def torso_sdf():
    chest = SD.ellipsoid((0, 0.05, 2.62), (0.40, 0.31, 0.42))
    shoulders = SD.capsule((-0.34, 0.07, 2.90), (0.34, 0.07, 2.90), 0.17)
    belly = SD.ellipsoid((0, -0.11, 2.13), (0.49, 0.50, 0.41))
    seat = SD.ellipsoid((0, 0.19, 1.70), (0.55, 0.52, 0.37))
    yoke = SD.ellipsoid((0, 0.09, 2.93), (0.44, 0.36, 0.17))
    base = SD.smooth_union(0.14, chest, shoulders)
    base = SD.smooth_union(0.10, base, yoke)
    base = SD.smooth_union(0.20, base, belly)
    base = SD.smooth_union(0.20, base, seat)
    legs = []
    for s in (1, -1):
        hj, kn = jl('thigh', s), jl('shin', s)
        ax = nrm(kn - hj)
        thigh = SD.round_cone(hj + np.array([0, 0.02, 0.06]), kn + ax * -0.02, 0.215, 0.225)
        bulge = SD.ellipsoid(kn + np.array([0.0, -0.01, 0.05]), (0.235, 0.235, 0.17))
        cuff = SD.round_cone(kn + np.array([0, 0, 0.0]), np.array([kn[0], kn[1], CUFF_Z + 0.02]), 0.205, 0.138)
        leg = SD.smooth_union(0.06, SD.smooth_union(0.10, thigh, bulge), cuff)
        legs.append(leg)
    base = SD.smooth_union(0.07, base, legs[0])
    base = SD.smooth_union(0.07, base, legs[1])
    sleeves = []
    for s in (1, -1):
        sh = jl('upper_arm', s)
        d = ARM * np.array([s, 1, 1])
        a = sh - d * 0.10 + np.array([0, 0, 0.04])
        b = sh + d * SLEEVE_LEN
        sleeves.append(SD.round_cone(a, b, 0.19, 0.172))
    base = SD.smooth_union(0.07, base, sleeves[0])
    base = SD.smooth_union(0.07, base, sleeves[1])
    # openings: neckline well, sleeve mouths, knicker cuffs (the neck/arms/socks come out of them)
    holes = [SD.capsule((0, 0.06, 2.80), (0, 0.06, 3.40), 0.252)]
    for s in (1, -1):
        sh = jl('upper_arm', s)
        d = ARM * np.array([s, 1, 1])
        end = sh + d * SLEEVE_LEN
        holes.append(SD.round_cone(end - d * 0.16, end + d * 0.2, 0.128, 0.14))
        kn = jl('shin', s)
        holes.append(SD.capsule(np.array([kn[0], kn[1], CUFF_Z + 0.12]), np.array([kn[0], kn[1], CUFF_Z - 0.2]), 0.112))
    return SD.smooth_sub(0.025, base, SD.union(*holes))


# ------------------------------------------------------------------------------------------- weights
def seg_weights(P, segs, power=4.0, mask=None):
    """Inverse normalized-distance weights to bone proxy segments. segs: [(bone, a, b, radius)]."""
    W = {}
    for bone, a, b, r in segs:
        d, _ = RR.seg_dist(P, a, b)
        w = 1.0 / np.maximum(d / r, 0.02) ** power
        if mask is not None and bone in mask:
            w = w * mask[bone]
        W[bone] = W.get(bone, 0) + w
    tot = sum(W.values())
    return {k: w / tot for k, w in W.items()}


def smooth_weights(W, F, n, iters=6, lam=0.5):
    nb = G.vertex_neighbors(n, F)
    W = MS_smooth(W, nb, iters, lam)
    tot = sum(W.values())
    return {k: w / np.maximum(tot, 1e-9) for k, w in W.items()}


def MS_smooth(W, nb, iters, lam):
    keys = list(W)
    M = np.stack([W[k] for k in keys], 1)
    # sparse neighbour averaging
    idx = np.concatenate([ix for ix in nb])
    rows = np.repeat(np.arange(len(nb)), [len(ix) for ix in nb])
    cnt = np.array([max(len(ix), 1) for ix in nb], float)
    for _ in range(iters):
        acc = np.zeros_like(M)
        np.add.at(acc, rows, M[idx])
        avg = acc / cnt[:, None]
        M = M + lam * (avg - M)
    return {k: M[:, i] for i, k in enumerate(keys)}


def torso_segments():
    segs = [('hips', (0, 0.08, 1.30), (0, 0.06, 1.86), 0.55),
            ('spine', (0, 0.05, 1.90), (0, 0.05, 2.32), 0.50),
            ('chest', (0, 0.05, 2.38), (0, 0.05, 2.98), 0.42)]
    for s in (1, -1):
        sd = 'L' if s > 0 else 'R'
        segs += [('shoulder.' + sd, jl('shoulder', s), jl('upper_arm', s), 0.20),
                 ('upper_arm.' + sd, jl('upper_arm', s) + ARM * np.array([s, 1, 1]) * 0.08, jl('forearm', s), 0.17),
                 ('thigh.' + sd, jl('thigh', s), jl('shin', s), 0.24),
                 ('shin.' + sd, jl('shin', s) + np.array([0, 0, -0.06]), jl('foot', s), 0.17)]
    return segs


def torso_weights(V, F):
    x = V[:, 0]
    mask = {}
    for s, sd in ((1, 'L'), (-1, 'R')):
        side_ok = G.smoothstep(-0.05 * s, 0.12 * s, x) if s > 0 else G.smoothstep(0.05, -0.12, x)
        for b in ('shoulder', 'upper_arm', 'thigh', 'shin'):
            mask[b + '.' + sd] = side_ok
    # legs only below the seat; arms only up high
    z = V[:, 2]
    for sd in ('L', 'R'):
        mask['thigh.' + sd] = mask['thigh.' + sd] * G.smoothstep(1.75, 1.45, z)
        mask['shin.' + sd] = mask['shin.' + sd] * G.smoothstep(1.2, 0.95, z)
        mask['upper_arm.' + sd] = mask['upper_arm.' + sd] * G.smoothstep(2.45, 2.7, z)
        mask['shoulder.' + sd] = mask['shoulder.' + sd] * G.smoothstep(2.5, 2.75, z)
    W = seg_weights(V, torso_segments(), power=5.0, mask=mask)
    W = smooth_weights(W, F, len(V), iters=8, lam=0.6)
    # thighs: the pelvis segment's big radius (it has to cover the seat) leaked 25-70% 'hips' weight down the baggy
    # knickers to the knee, so a lifted knee left its trouser leg behind. Hand that weight to the thigh, fully below
    # 1.15 ft and fading out by the seat (the buttocks and crotch stay on the pelvis).
    for sd, sgn in (('L', 1), ('R', -1)):
        g = G.smoothstep(1.52, 1.15, z) * G.smoothstep(0.04, 0.16, x * sgn)
        mv = W['hips'] * g
        W['hips'] = W['hips'] - mv
        W['thigh.' + sd] = W['thigh.' + sd] + mv
    # knee: re-split the leg's weight by height, not by distance to the bone segments (the baggy knickers are far
    # from the shin axis, so distance weights left the cuff on the thigh and the sock top poked out when the knee
    # folded). Everything below the cuff band follows the shin; the bend is spread over the knee bulge.
    for sd in ('L', 'R'):
        tot = W['thigh.' + sd] + W['shin.' + sd]
        f = G.smoothstep(1.20, 0.90, z)
        W['shin.' + sd] = tot * f
        W['thigh.' + sd] = tot * (1 - f)
    return W


# ------------------------------------------------------------------------------------------- helpers
def surface_loop(f, z, cx=0.0, cy=0.05, n=48, r0=1.2, offset=0.0, zfun=None):
    """Horizontal loop on the surface of f at height z (ray-march inward from radius r0)."""
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        d = np.array([math.sin(a), -math.cos(a), 0.0])
        zz = z if zfun is None else zfun(a)
        p = np.array([cx, cy, zz]) + d * r0
        for _ in range(80):
            v = f(p[None])[0]
            if abs(v) < 5e-4:
                break
            p = p - d * v * 0.9
        pts.append(p + d * offset)
    return np.array(pts)


def project_to(f, P, offset=0.0, iters=4):
    P = SD.project(f, np.asarray(P, float), iters=iters)
    return P + SD.normals(f, P) * offset


def ring_sweep(path, prof_w, prof_h, n_prof=8, closed=True, mat='belt', normals=None, up=None):
    """Sweep a rounded-rectangle profile (width along the surface normal, height along `up`) along a path."""
    P = np.asarray(path, float)
    m = len(P)
    V, F = [], []
    prof = []
    for k in range(n_prof):
        a = 2 * math.pi * (k + 0.5) / n_prof
        cx, cy = math.cos(a), math.sin(a)
        # superellipse-ish rounded rectangle
        ex = np.sign(cx) * abs(cx) ** 0.5
        ey = np.sign(cy) * abs(cy) ** 0.5
        prof.append((ex * prof_w, ey * prof_h))
    for i in range(m):
        t = P[(i + 1) % m] - P[i - 1] if closed else (P[min(i + 1, m - 1)] - P[max(i - 1, 0)])
        t = nrm(t)
        nv = normals[i] if normals is not None else nrm(np.cross(up if up is not None else [0, 0, 1.0], t))
        nv = nrm(nv - np.dot(nv, t) * t)
        uv = np.cross(t, nv)
        for (a, b) in prof:
            V.append(P[i] + nv * a + uv * b)
    rows = m if closed else m - 1
    for i in range(rows):
        for k in range(n_prof):
            a = i * n_prof + k
            b = i * n_prof + (k + 1) % n_prof
            c = ((i + 1) % m) * n_prof + (k + 1) % n_prof
            d = ((i + 1) % m) * n_prof + k
            F.append([a, b, c, d])
    if not closed:
        F.append(list(range(n_prof))[::-1])
        F.append([(m - 1) * n_prof + k for k in range(n_prof)])
    p = Part(np.array(V), F, mat, 'ring')
    return p


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


# ------------------------------------------------------------------------------------------- parts
def torso_part(f):
    V, F = MS.sdf_mesh(f, (-0.95, -0.75, 0.55), (0.95, 0.80, 3.20), 0.014, quads=1250, seed=3)
    p = Part(V, F, 'uniform', 'torso')
    p.set_weights(torso_weights(V, F))
    return p


def arm_part(s):
    sd = 'L' if s > 0 else 'R'
    d = ARM * np.array([s, 1, 1])
    sh, el, wr = jl('upper_arm', s), jl('forearm', s), jl('hand', s)
    L1, L2 = np.linalg.norm(el - sh), np.linalg.norm(wr - el)
    ts = np.concatenate([np.linspace(0.06, 1.0, 8), 1.0 + np.linspace(0.12, 1.0, 8) * (L2 / L1)])
    path = [sh + d * (t * L1) for t in ts]
    path.append(wr + d * 0.04)
    u = np.linspace(0, 1, len(path))
    rad = 0.108 - 0.040 * u - 0.01 * np.sin(u * math.pi) + 0.012 * np.exp(-((u - 0.18) / 0.15) ** 2)
    p = G.sweep(path, rad, 9, 'team_a', up=(0, 1, 0))
    chain = [('upper_arm.' + sd, sh, el), ('forearm.' + sd, el, wr), ('hand.' + sd, wr, wr + d * 0.2)]
    W, _ = RR.chain_weights(p.V, chain, 0.16)
    p.set_weights(W)
    return p


def sock_part(s):
    """Stirrup sock: white sanitary sock with the team-colour stirrup over it (open arch on each side),
    plus a thin team_b stripe near the top."""
    sd = 'L' if s > 0 else 'R'
    kn, an = jl('shin', s), jl('foot', s)
    top = np.array([kn[0], kn[1], CUFF_Z + 0.10])
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
        h = q @ axis                                       # distance down the leg
        r = q - np.outer(h, axis) if q.ndim == 2 else q - h[..., None] * axis
        fwd = np.array([0, -1.0, 0])
        side = np.array([1.0 * s, 0, 0])
        ang = np.arctan2(r @ side, r @ fwd)                 # 0 front, +-pi/2 sides
        return h / L, ang

    def arch(P):
        """Negative inside the stirrup's side cut-outs (white sanitary sock shows): sides, below a rounded top."""
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


def details(f):
    parts = []
    # collar piping around the neckline
    col = []
    for i in range(18):
        a = 2 * math.pi * i / 18
        col.append([0.272 * math.sin(a), 0.06 - 0.25 * math.cos(a), 3.07 - 0.035 * math.cos(a)])
    ring = ring_sweep(col, 0.03, 0.026, 6, True, 'team_a', up=(0, 0, 1))
    ring.set_weights({'chest': np.full(ring.n, 0.7), 'neck': np.full(ring.n, 0.3)})
    parts.append(orient_outward(ring))
    # placket: team-colour strip from the collar down to the belt, with buttons
    zs = np.linspace(3.03, 2.03, 11)
    pts = np.array([[0.0, -0.9, z] for z in zs])
    pts = project_to(f, pts, 0.004)
    nrms = SD.normals(f, pts)
    pl = ring_sweep(pts, 0.012, 0.042, 6, False, 'team_a', normals=nrms)
    pl.set_weights(seg_weights(pl.V, torso_segments()[:3], 5.0))
    parts.append(orient_outward(pl))
    for z in (2.86, 2.62, 2.38, 2.15):
        c = project_to(f, np.array([[0.0, -0.9, z]]), 0.016)[0]
        n_ = SD.normals(f, c[None])[0]
        b = G.ellipsoid(c, (0.03, 0.03, 0.012), 6, 3, 'lace', R=G.zframe(n_))
        b.set_weights(seg_weights(b.V, torso_segments()[:3], 5.0))
        parts.append(b)
    # belt with buckle
    loop = surface_loop(f, 1.985, offset=0.012, n=24)
    nrms = np.array([nrm(np.array([p[0], p[1] - 0.05, 0])) for p in loop])
    belt = ring_sweep(loop, 0.026, 0.055, 6, True, 'belt', normals=nrms)
    belt.set_weights(seg_weights(belt.V, torso_segments()[:3], 5.0))
    parts.append(orient_outward(belt))
    front = loop[0]
    # buckle: a rounded frame (a short closed ring sweep) with the belt showing through its middle
    bc = front + np.array([0, -0.03, 0])
    fr = [bc + np.array([0.075 * math.cos(t), 0, 0.058 * math.sin(t)]) for t in np.linspace(0, 2 * math.pi, 12, endpoint=False)]
    bk = ring_sweep(fr, 0.016, 0.016, 4, True, 'lace', normals=[np.array([0, -1.0, 0])] * len(fr))
    bk.rigid('spine')
    parts.append(orient_outward(bk))
    prong = G.box(bc + np.array([0, -0.012, 0]), (0.02, 0.012, 0.09), 'lace')
    prong.rigid('spine')
    parts.append(prong)
    # sleeve piping rings
    for s in (1, -1):
        sd = 'L' if s > 0 else 'R'
        sh = jl('upper_arm', s)
        d = ARM * np.array([s, 1, 1])
        c = sh + d * (SLEEVE_LEN - 0.015)
        R = G.zframe(d)
        pts = [c + R @ np.array([math.cos(t) * 0.176, math.sin(t) * 0.176, 0]) for t in np.linspace(0, 2 * math.pi, 12, endpoint=False)]
        r = ring_sweep(pts, 0.022, 0.03, 6, True, 'team_a', normals=[nrm(p - c) for p in pts])
        r.set_weights({'upper_arm.' + sd: np.full(r.n, 0.85), 'shoulder.' + sd: np.full(r.n, 0.15)})
        parts.append(orient_outward(r))
        # knicker cuff band (gathered elastic)
        kn = jl('shin', s)
        c = np.array([kn[0], kn[1], CUFF_Z + 0.035])
        pts = [c + np.array([math.cos(t) * 0.142, math.sin(t) * 0.142, 0.0]) for t in np.linspace(0, 2 * math.pi, 10, endpoint=False)]
        r = ring_sweep(pts, 0.024, 0.032, 6, True, 'uniform', normals=[nrm(np.array([p[0] - c[0], p[1] - c[1], 0])) for p in pts])
        r.rigid('shin.' + sd)
        parts.append(orient_outward(r))
    return parts


def MS_round_box(c, half, rnd, mat):
    f = SD.box(c, half, rnd=rnd)
    m = np.max(half) + 0.05
    V, F = MS.sdf_mesh(f, np.asarray(c) - m, np.asarray(c) + m, min(half) / 3.0, tris=60)
    return Part(V, F, mat, 'rbox')


def decal_parts(f):
    def patch(center_hint, wdt, hgt, back, mat, bone='chest'):
        nu = nv = 4
        V, U, F = [], [], []
        for j in range(nv + 1):
            for i in range(nu + 1):
                u, v = i / nu, j / nv
                x = center_hint[0] + (u - 0.5) * wdt * (-1 if back else 1)
                z = center_hint[2] + (v - 0.5) * hgt
                y = 1.2 if back else -1.2
                V.append([x, y, z])
        V = np.array(V)
        # march to the surface along +-y
        d = np.array([0, -1.0, 0]) if back else np.array([0, 1.0, 0])
        for k in range(len(V)):
            p = V[k]
            for _ in range(100):
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
        if back:
            p.F = [ff for ff in p.F]
        p.set_weights(seg_weights(p.V, torso_segments()[:3], 5.0))
        return p
    a = patch((0.21, 0, 2.62), 0.30, 0.32, False, 'decal_chest')
    b = patch((0.0, 0, 2.58), 0.44, 0.46, True, 'decal_back')
    # face the decal normals outward
    for p, out in ((a, np.array([0, -1.0, 0])), (b, np.array([0, 1.0, 0]))):
        f0 = p.F[0]
        nn = np.cross(p.V[f0[1]] - p.V[f0[0]], p.V[f0[3]] - p.V[f0[0]])
        if np.dot(nn, out) < 0:
            p.F = [ff[::-1] for ff in p.F]
            p.uv = [uu[::-1] for uu in p.uv]
    return [a, b]


def build():
    f = torso_sdf()
    parts = [torso_part(f)]
    for s in (1, -1):
        parts.append(arm_part(s))
        parts.append(sock_part(s))
    parts += details(f)
    return parts, decal_parts(f), f

# cgear.py - worn gear for the cast: the fielding mitt and the catcher's mitt (left hand), LOD1 mittens, the catcher's
# gear (mask, chest protector, shin guards) and the umpire's (chest protector, trousers, bow tie, ball bag).
# Hand frame (rk_rig): t = pinky -> index, u = along the hand, v = out of the back of the hand; origin at the wrist.
import math
import numpy as np
import cast_common as CC  # noqa: F401
import rk_geo as G
import rk_sdf as SD
import rk_mesh as MS
import rk_rig as RR
import rk_body as BD
from rk_geo import Part, nrm


def glove_frame(J, s=1, scale=1.0):
    """Frame of the hand: origin at the wrist (hand joint); t = pinky->index, u = along the hand, v = back of the hand."""
    mir = np.array([s, 1.0, 1.0])
    sd = 'L' if s > 0 else 'R'
    W = np.asarray(J['hand.' + sd], float)
    return W, RR.GLOVE_T * mir, RR.GLOVE_U * mir, RR.GLOVE_V * mir


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


class HandSpace:
    def __init__(self, J, s, k):
        self.W0, self.X, self.Y, self.Z = glove_frame(J, s)
        self.k = k
        self.R = np.stack([self.X, self.Y, self.Z], 1)

    def tuv(self, Q):
        q = np.asarray(Q, float) - self.W0
        return q @ self.X / self.k, q @ self.Y / self.k, q @ self.Z / self.k

    def P(self, t, u, v):
        return self.W0 + (self.X * t + self.Y * u + self.Z * v) * self.k

    def rbox(self, c, half, e=2.4):
        c = np.asarray(c, float)
        h = np.asarray(half, float)
        k = self.k

        def f(Q):
            t, u, v = self.tuv(Q)
            q = np.stack([(t - c[0]) / h[0], (u - c[1]) / h[1], (v - c[2]) / h[2]], -1)
            kk = np.sum(np.abs(q) ** e, axis=-1) ** (1 / e)
            return (kk - 1.0) * min(h) * k
        return f


def finger_weights(J, sd, V, with_thumb=True, sigma=0.05):
    """Soft weights to the finger chains (index / middle / pinky (+ thumb)) by distance to their segments."""
    segs = []
    names = ['index', 'middle', 'pinky'] + (['thumb'] if with_thumb else [])
    for f in names:
        K_, M_, T_ = (np.asarray(J[f + k + '.' + sd], float) for k in ('', '_2', '_end'))
        segs += [(f + '.' + sd, K_, M_), (f + '_2.' + sd, M_, T_)]
    D = np.stack([RR.seg_dist(V, a, b)[0] for (_, a, b) in segs], 1)
    w = np.exp(-(D / sigma) ** 2) + 1e-9
    w = w / w.sum(1, keepdims=True)
    return {segs[i][0]: w[:, i] for i in range(len(segs))}


# ------------------------------------------------------------------------------------------- LOD1 mitten
def mitten(J, s, mat, scale=1.0, tris=70):
    """Low-detail hand for LOD1: palm + one finger mass + thumb, curling with the finger chains."""
    sd = 'L' if s > 0 else 'R'
    H = HandSpace(J, s, scale)
    palm = H.rbox((0.0, 0.13, 0.005), (0.14, 0.15, 0.058))
    fing = H.rbox((0.0, 0.33, -0.012), (0.135, 0.13, 0.05))
    th = SD.round_cone(H.P(0.10, 0.07, -0.01), H.P(0.17, 0.20, -0.07), 0.05 * scale, 0.042 * scale)
    f = SD.smooth_union(0.03 * scale, SD.smooth_union(0.03 * scale, palm, fing), th)
    V, F = MS.sdf_mesh(f, H.W0 - 0.6 * scale, H.W0 + 0.6 * scale, 0.016 * scale, tris=tris)
    p = Part(V, F, mat, 'mitten_' + sd)
    orient_outward(p)
    t, u, v = H.tuv(p.V)
    wf = G.smoothstep(0.20, 0.28, u)
    fw = finger_weights(J, sd, p.V, with_thumb=True)
    tw = (fw['thumb.' + sd] + fw['thumb_2.' + sd])
    W = {'hand.' + sd: (1 - wf) * (1 - tw)}
    for b, w in fw.items():
        W[b] = w * (tw if b.startswith('thumb') else wf * (1 - tw))
    p.set_weights(W)
    return p


# ------------------------------------------------------------------------------------------- fielding mitt
BALL_R = 0.121
POCKET = np.array(RR.MITT_POCKET_TUV, float)       # the `mitt` socket in the hand frame (Rocco's hand size)


def _pocket_center(v_r):
    """Centre of a pocket ellipsoid (v radius v_r) whose surface holds a ball centred on the socket."""
    return np.array([POCKET[0], POCKET[1] + 0.02, POCKET[2] + BALL_R - v_r])


def mitt_part(J, scale=1.0, tris=900, catcher=False):
    """Cartoon fielding mitt on the left hand (bigger than the hand, like the card icon: a light leather paddle with a
    dark round pocket): four fat finger stalls, a thumb stall, a laced web, a heel roll; the pocket holds a ball
    centred on the `mitt` socket. catcher=True: the round pillow of a catcher's mitt. Weighted to hand.L, the finger
    chains (curling the fingers closes the mitt) and the thumb chain."""
    if catcher:
        return catcher_mitt(J, scale, tris)
    H = HandSpace(J, 1, scale)
    P, k = H.P, scale
    lowd = tris < 400
    paddle = H.rbox((-0.01, 0.34, 0.0), (0.25, 0.36, 0.10))
    heel = H.rbox((0.0, 0.06, 0.0), (0.20, 0.14, 0.11))
    stalls = [SD.capsule(P(t, 0.36, 0.012), P(t * 1.06, 0.80 - 0.06 * abs(t) / 0.17, 0.010), 0.085 * k)
              for t in (-0.17, -0.057, 0.057, 0.17)]
    thumb = SD.round_cone(P(0.18, 0.06, -0.05), P(0.32, 0.52, -0.18), 0.11 * k, 0.08 * k)
    web = H.rbox((0.24, 0.55, -0.13), (0.06, 0.18, 0.07), e=2.0)
    v_r = 0.26
    pocket = SD.ellipsoid(P(*_pocket_center(v_r)), (0.25 * k, 0.32 * k, v_r * k), R=H.R)
    body = SD.smooth_union(0.06 * k, paddle, heel)
    for st in stalls:
        body = SD.smooth_union(0.045 * k, body, st)
    body = SD.smooth_union(0.05 * k, body, thumb)
    body = SD.smooth_union(0.03 * k, body, web)
    roll = SD.capsule(P(-0.20, 0.0, 0.0), P(0.20, 0.0, 0.0), 0.11 * k)
    body = SD.smooth_union(0.03 * k, body, roll)
    wrist_hole = SD.capsule(P(0.0, -0.30, 0.0), P(0.0, 0.02, 0.0), 0.09 * k)
    f = SD.smooth_sub(0.06 * k, body, pocket)
    f = SD.smooth_sub(0.015 * k, f, wrist_hole)
    V, F = MS.sdf_mesh(f, H.W0 - 1.1 * k, H.W0 + 1.1 * k, (0.011 if not lowd else 0.02) * k, tris=tris)

    def lace_region(Q):
        t, u, v = H.tuv(Q)
        webr = np.maximum(np.abs(t - 0.24) - 0.065, np.maximum(np.abs(u - 0.55) - 0.17, v + 0.05))
        tips = np.maximum(np.abs(u - (0.86 - 0.06 * np.abs(t) / 0.17)) - 0.025, -v - 0.03)
        between = np.maximum(np.abs(np.abs(t) - 0.113) - 0.012, np.maximum(u - 0.76, 0.40 - u))
        between = np.maximum(between, -v - 0.02)
        return np.minimum(np.minimum(webr, tips), between) * k

    def pocket_region(Q):
        t, u, v = H.tuv(Q)
        c = _pocket_center(v_r)
        return (np.sqrt(((t - c[0]) / 0.17) ** 2 + ((u - c[1]) / 0.21) ** 2) - 1.0) * 0.1 * k + np.maximum(v + 0.04, 0) * 2

    if not lowd:
        V, F = MS.cut_by_field(V, F, lace_region, surf=f)
    V, F = MS.cut_by_field(V, F, pocket_region, surf=f)
    regs = ([('mitt_lace', lace_region)] if not lowd else []) + [('mitt_lace', pocket_region)]
    p = Part(V, F, MS.faces_by_region(V, F, regs, 'mitt'), 'mitt')
    orient_outward(p)
    t, u, v = H.tuv(p.V)
    wt = G.smoothstep(0.15, 0.23, t) * G.smoothstep(0.62, 0.36, u) * G.smoothstep(0.0, -0.08, v)
    fw = finger_weights(J, 'L', p.V, with_thumb=False, sigma=0.12)
    wf = G.smoothstep(0.30, 0.48, u) * (1 - wt)
    W = {'hand.L': np.clip(1 - wf - wt, 0, 1), 'thumb.L': wt * 0.6, 'thumb_2.L': wt * 0.4}
    for b, w in fw.items():
        W[b] = w * wf
    p.set_weights(W)
    return p


def catcher_mitt(J, scale=1.0, tris=900):
    """The catcher's mitt: a round padded pillow with a thick laced rim, a deep dark pocket and a thumb roll."""
    H = HandSpace(J, 1, scale)
    P, k = H.P, scale
    lowd = tris < 400
    pillow = H.rbox((0.02, 0.27, 0.0), (0.25, 0.31, 0.11), e=2.2)
    thumb = SD.round_cone(P(0.17, 0.06, -0.04), P(0.26, 0.34, -0.13), 0.09 * k, 0.08 * k)
    body = SD.smooth_union(0.04 * k, pillow, thumb)
    roll = SD.capsule(P(-0.18, 0.0, 0.0), P(0.18, 0.0, 0.0), 0.10 * k)
    body = SD.smooth_union(0.03 * k, body, roll)
    v_r = 0.20
    pocket = SD.ellipsoid(P(*_pocket_center(v_r)), (0.17 * k, 0.21 * k, v_r * k), R=H.R)
    wrist_hole = SD.capsule(P(0.0, -0.30, 0.0), P(0.0, 0.02, 0.0), 0.085 * k)
    f = SD.smooth_sub(0.04 * k, body, pocket)
    f = SD.smooth_sub(0.015 * k, f, wrist_hole)
    V, F = MS.sdf_mesh(f, H.W0 - 0.95 * k, H.W0 + 0.95 * k, (0.010 if not lowd else 0.018) * k, tris=tris)

    def lace_region(Q):
        t, u, v = H.tuv(Q)
        r = np.sqrt(((t - 0.02) / 0.25) ** 2 + ((u - 0.27) / 0.31) ** 2)
        ring = np.abs(r - 0.93) * 0.25 - 0.012
        return np.maximum(ring, -(v + 0.02)) * k

    def pocket_region(Q):
        t, u, v = H.tuv(Q)
        c = _pocket_center(v_r)
        return (np.sqrt(((t - c[0]) / 0.13) ** 2 + ((u - c[1]) / 0.16) ** 2) - 1.0) * 0.1 * k + np.maximum(v + 0.035, 0) * 2
    if not lowd:
        V, F = MS.cut_by_field(V, F, lace_region, surf=f)
    V, F = MS.cut_by_field(V, F, pocket_region, surf=f)
    regs = ([('mitt_lace', lace_region)] if not lowd else []) + [('mitt_lace', pocket_region)]
    p = Part(V, F, MS.faces_by_region(V, F, regs, 'mitt'), 'mitt')
    orient_outward(p)
    t, u, v = H.tuv(p.V)
    wt = G.smoothstep(0.14, 0.21, t) * G.smoothstep(0.45, 0.25, u)
    wf = G.smoothstep(0.32, 0.50, u) * (1 - wt)
    fw = finger_weights(J, 'L', p.V, with_thumb=False, sigma=0.12)
    W = {'hand.L': np.clip(1 - wf - wt, 0, 1), 'thumb.L': wt * 0.6, 'thumb_2.L': wt * 0.4}
    for b, w in fw.items():
        W[b] = w * wf
    p.set_weights(W)
    return p


# ------------------------------------------------------------------------------------------- catcher's gear
def chest_protector(J, f, mat='team_b', trim='accessory_b', lod=0, ump=False):
    """Padded chest protector over the jersey front (catcher: team colour with dark piping; umpire: a big black
    balloon-style pad). f: the torso SDF it sits on. Weighted to the spine / chest."""
    import cbody as CB
    S = CB.scales(J)
    chest, spine, neck = (np.asarray(J[k], float) for k in ('chest', 'spine', 'neck'))
    top = neck[2] + 0.02 * S['ts']
    bot = spine[2] - (0.10 if not ump else 0.02)
    th = 0.075 if not ump else 0.12

    def plate(Q):
        Q = np.asarray(Q, float)
        x, y, z = Q[..., 0], Q[..., 1], Q[..., 2]
        d = f(Q)
        shell = np.abs(d - th) - th * 0.85
        # outline: shield shape on the front (narrower at the bottom), cut away behind the side seams
        zz = (z - bot) / (top - bot)
        half = (0.36 + 0.10 * np.clip(zz, 0, 1)) * S['ws']
        out = np.maximum(np.abs(x) - half, np.maximum(bot - z, z - top))
        out = np.maximum(out, y - (chest[1] - 0.12))
        neckhole = 0.20 - np.sqrt(x ** 2 + ((z - top) * 1.3) ** 2)
        out = np.maximum(out, neckhole)
        return SD.smax(shell, out, 0.03)
    c = (chest + spine) / 2
    lo = c + np.array([-1.0, -1.1, -1.0])
    hi = c + np.array([1.0, 0.2, 1.2])
    V, F = MS.sdf_mesh(plate, lo, hi, 0.012 if lod == 0 else 0.02, tris=800 if lod == 0 else 120)

    def piping(Q):
        Q = np.asarray(Q, float)
        x, z = Q[..., 0], Q[..., 2]
        zz = (z - bot) / (top - bot)
        half = (0.36 + 0.10 * np.clip(zz, 0, 1)) * S['ws']
        edge = np.minimum(np.minimum(half - np.abs(x), z - bot), top - z)
        seam = np.minimum(np.abs(z - (bot + (top - bot) * 0.36)), np.abs(z - (bot + (top - bot) * 0.68))) - 0.016
        if ump:
            seam = np.full_like(z, 1.0)
        return np.minimum(edge - 0.04, seam)
    if lod == 0:
        V, F = MS.cut_by_field(V, F, piping, surf=plate)
        mats = MS.faces_by_region(V, F, [(trim, piping)], mat)
    else:
        mats = [mat] * len(F)
    p = Part(V, F, mats, 'chest_protector')
    orient_outward(p)
    segs = CB.torso_segments(J)[:3]
    p.set_weights(BD.seg_weights(p.V, segs, 5.0))
    return p


def shin_guards(J, mat='team_b', trim='accessory_b', lod=0):
    """Catcher's shin guards: a shell over the shin and a knee cup, straps at the back."""
    import cbody as CB
    out = []
    for s in (1, -1):
        sd = 'L' if s > 0 else 'R'
        kn, an = (np.asarray(J[k + '.' + sd], float) for k in ('shin', 'foot'))
        ax = nrm(an - kn)

        def guard(Q, kn=kn, an=an, ax=ax):
            Q = np.asarray(Q, float)
            shell = SD.round_cone(kn + ax * 0.05, an - ax * 0.10, 0.19, 0.15)(Q)
            shell = np.abs(shell) - 0.03
            front = (Q[..., 1] - (kn[1] + 0.02))          # keep the front half
            g = SD.smax(shell, front, 0.03)
            cup = SD.ellipsoid(kn + np.array([0, -0.12, 0.02]), (0.17, 0.12, 0.17))(Q)
            return SD.smin(g, cup, 0.05)
        c = (kn + an) / 2
        V, F = MS.sdf_mesh(guard, c - 0.8, c + 0.8, 0.012 if lod == 0 else 0.02, tris=420 if lod == 0 else 70)

        def ribs(Q, kn=kn, ax=ax):
            h = (np.asarray(Q, float) - kn) @ ax
            return np.abs(np.mod(h + 0.05, 0.22) - 0.11) - 0.014
        if lod == 0:
            V, F = MS.cut_by_field(V, F, ribs, surf=guard)
            mats = MS.faces_by_region(V, F, [(trim, ribs)], mat)
        else:
            mats = [mat] * len(F)
        p = Part(V, F, mats, 'shin_guard_' + sd)
        orient_outward(p)
        h = (p.V - kn) @ ax
        wk = G.smoothstep(0.06, -0.06, h)
        p.set_weights({'shin.' + sd: 1 - wk * 0.5, 'thigh.' + sd: wk * 0.5})
        out.append(p)
    return out


def catcher_mask(head_world_f, J, face_front, Kh, mat='accessory_b', pad='accessory_a', lod=0):
    """Catcher's mask: a padded frame around the face and a cage of bars standing off the face, sized from the head's
    forward extent (long snouts get a deeper cage). head_world_f: the head skin SDF in world space. Rigid to the head."""
    hd = np.asarray(J['head'], float)
    eye = np.asarray(J['eye.L'], float)
    # frame: an oval ring round the face (brow to chin) just in front of the eyes
    cz = eye[2] - 0.20 * Kh
    rx, rz = 0.50 * Kh, 0.58 * Kh
    y_frame = eye[1] - 0.47 * Kh          # eye.L is the eye-sphere centre: the visible eye is ~0.43 Kh in front of it
    out = []
    ring = [np.array([rx * math.sin(t), y_frame + 0.10 * Kh * math.sin(t) ** 2, cz + rz * math.cos(t)])
            for t in np.linspace(0, 2 * math.pi, 20 if lod == 0 else 10, endpoint=False)]
    fr = BD.ring_sweep(ring, 0.04 * Kh, 0.05 * Kh, 6 if lod == 0 else 4, True, pad, normals=[np.array([0, -1.0, 0])] * len(ring))
    out.append(orient_outward(fr))
    # cage: bars from the frame curving forward round the snout, a little clearance in front of the nose
    depth = max(y_frame - (face_front - 0.05 * Kh), 0.25 * Kh)
    nb = 3 if lod == 0 else 2
    for i in range(nb):
        zc = cz + (i - (nb - 1) / 2) * (rz * 1.2 / max(nb - 1, 1))
        ext = rx * math.sqrt(max(1 - ((zc - cz) / rz) ** 2, 0.15))
        pts = []
        for t in np.linspace(-1, 1, 11):
            x = ext * t * (0.55 + 0.45 * abs(t))
            y = y_frame - depth * (1 - t * t) ** 1.3 * (1.0 - 0.25 * abs(zc - cz) / rz)
            pts.append([x, y, zc])
        out.append(BD.orient_outward(G.sweep(np.array(pts), 0.015 * Kh, 5 if lod == 0 else 4, mat, up=(0, 0, 1), name='bar')))
    if lod == 0:
        for sgn in (1, -1):        # two vertical bars
            pts = []
            for t in np.linspace(-1, 1, 9):
                z = cz + rz * 0.85 * t
                y = y_frame - depth * (1 - (0.14 * Kh / rx) ** 2) ** 1.3 * (1.0 - 0.25 * abs(t))
                pts.append([sgn * 0.14 * Kh * (0.55 + 0.45 * 0.28), y, z])
            out.append(BD.orient_outward(G.sweep(np.array(pts), 0.014 * Kh, 5, mat, up=(1, 0, 0), name='bar')))
    # straps from the frame round the back of the head (over the backwards cap)
    cyh = hd[1] + 0.02 * Kh
    for z0 in ((cz + rz * 0.55, cz - rz * 0.30) if lod == 0 else (cz + rz * 0.2,)):
        pts = [np.array([rx * 0.98, y_frame + 0.05 * Kh, z0])]
        for ph in np.linspace(0, math.pi, 9 if lod == 0 else 5):
            pts.append(np.array([0.72 * Kh * math.cos(ph), cyh + 0.70 * Kh * math.sin(ph), z0 + 0.04 * Kh * math.sin(ph)]))
        pts.append(np.array([-rx * 0.98, y_frame + 0.05 * Kh, z0]))
        out.append(BD.orient_outward(G.sweep(np.array(pts), None, 4, mat, up=(0, 0, 1), rx=np.full(len(pts), 0.010 * Kh),
                                             ry=np.full(len(pts), 0.03 * Kh), name='strap')))
    for p in out:
        p.rigid('head')
    return out


# ------------------------------------------------------------------------------------------- umpire
def bow_tie(J, mat='accessory_a', lod=0):
    neck = np.asarray(J['neck'], float)
    c = neck + np.array([0, -0.25, 0.06])
    f = SD.smooth_union(0.03, SD.round_cone(c + [0.13, 0, 0], c, 0.07, 0.03), SD.round_cone(c - [0.13, 0, 0], c, 0.07, 0.03))
    f = SD.smooth_union(0.02, f, SD.ellipsoid(c, (0.04, 0.035, 0.04)))
    V, F = MS.sdf_mesh(f, c - 0.3, c + 0.3, 0.008 if lod == 0 else 0.014, tris=120 if lod == 0 else 30)
    p = Part(V, F, mat, 'bow_tie')
    orient_outward(p)
    p.set_weights({'chest': np.full(p.n, 0.6), 'neck': np.full(p.n, 0.4)})
    return p


def ball_bag(J, f, mat='accessory_b', lod=0):
    """Umpire's ball bag on his right hip (rigid to the hips)."""
    hips = np.asarray(J['hips'], float)
    p0 = np.array([-1.5, hips[1] - 0.15, hips[2] + 0.12])
    for _ in range(200):
        v = f(p0[None])[0]
        if v < 0.004:
            break
        p0[0] += max(v, 0.004)
    c = p0 + np.array([-0.08, 0, -0.05])
    g = SD.smooth_union(0.04, SD.ellipsoid(c, (0.10, 0.17, 0.15)), SD.ellipsoid(c + [0, 0, 0.12], (0.10, 0.15, 0.05)))
    V, F = MS.sdf_mesh(g, c - 0.4, c + 0.4, 0.01 if lod == 0 else 0.018, tris=160 if lod == 0 else 30)
    p = Part(V, F, mat, 'ball_bag')
    orient_outward(p)
    p.set_weights({'hips': np.full(p.n, 0.7), 'thigh.R': np.full(p.n, 0.3)})
    return p


# ------------------------------------------------------------------------------------------- shells (body gear)
def shell_part(J, f, kind='tortoise', mat='shell', rim='fur_dark', lod=0):
    """A shell worn on the back over the jersey (tortoises, turtles: a domed carapace with plate seams; armadillos:
    banded plates). f: the torso SDF. Weighted to spine / chest like the jersey."""
    import cbody as CB
    S = CB.scales(J)
    chest, spine, hips = (np.asarray(J[k], float) for k in ('chest', 'spine', 'hips'))
    c = (chest + spine) / 2 + np.array([0, 0.30, 0.05])
    dome = SD.ellipsoid(c, (0.62 * S['ws'], 0.42, 0.78 * S['ts']))

    def shell(Q):
        Q = np.asarray(Q, float)
        d = SD.smax(dome(Q), -(f(Q) - 0.06), 0.04)                # sits on the back, hollow against the body
        return SD.smax(d, (c[1] - 0.05) - Q[..., 1], 0.03)       # back half only
    V, F = MS.sdf_mesh(shell, c - 1.2, c + 1.2, 0.014 if lod == 0 else 0.024, tris=900 if lod == 0 else 140)

    def seams(Q):
        Q = np.asarray(Q, float)
        rel = Q - c
        if kind == 'armadillo':
            return np.abs(np.mod(rel[..., 2] + 0.06, 0.16) - 0.08) - 0.012
        hexd = np.minimum(np.abs(np.mod(rel[..., 0] + 0.1, 0.28) - 0.14), np.abs(np.mod(rel[..., 2] + 0.1, 0.30) - 0.15))
        return hexd - 0.012
    if lod == 0:
        V, F = MS.cut_by_field(V, F, seams, surf=shell)
        mats = MS.faces_by_region(V, F, [(rim, seams)], mat)
    else:
        mats = [mat] * len(F)
    p = Part(V, F, mats, 'shell')
    orient_outward(p)
    p.set_weights(BD.seg_weights(p.V, CB.torso_segments(J)[:3], 5.0))
    return p


# ------------------------------------------------------------------------------------------- the landlord's keys
def key_ring(J, f, mat='accessory_b', lod=0, side=-1):
    """A big ring of keys hanging from the belt on one hip (his right by default): a steel ring and five keys fanned
    below it. Rigid to the hips (it swings with the pelvis)."""
    spine = np.asarray(J['spine'], float)
    hips = np.asarray(J['hips'], float)
    beltz = spine[2] + 0.005
    # the belt surface on the side, a little to the front
    p = np.array([side * 1.6, spine[1] - 0.18, beltz])
    for _ in range(240):
        v = f(p[None])[0]
        if v < 0.004:
            break
        p[0] -= side * max(v, 0.004)
    p = p + np.array([side * 0.03, 0.0, -0.02])
    nrm_ = np.array([side * 1.0, -0.3, 0.0])
    nrm_ = nrm_ / np.linalg.norm(nrm_)
    out = []
    # ring (lies in the plane of the hip side)
    up = np.array([0, 0, 1.0])
    t2 = np.cross(up, nrm_)
    c = p + np.array([0, 0, -0.16])
    rr = 0.13
    ring = [c + (up * np.cos(a) + t2 * np.sin(a)) * rr for a in np.linspace(0, 2 * np.pi, 16 if lod == 0 else 8, endpoint=False)]
    r = BD.ring_sweep(ring, 0.018, 0.018, 5 if lod == 0 else 4, True, mat, normals=[(q - c) / rr for q in ring])
    out.append(orient_outward(r))
    # clip to the belt
    out.append(G.box(p + np.array([0, 0, -0.01]), (0.05, 0.06, 0.07), mat, R=G.frame_from(nrm_, (0, 0, 1))))
    # keys: shaft + bow (the round end), fanned along the bottom of the ring
    nk = 5 if lod == 0 else 3
    for i in range(nk):
        a = np.pi * (1.25 + 0.5 * i / max(nk - 1, 1))          # angles round the lower half of the ring
        hang = c + (up * np.cos(a) + t2 * np.sin(a)) * rr
        d = (hang - c) / rr
        d = d - up * 0.6
        d = d / np.linalg.norm(d)
        bow = hang + d * 0.05
        shaft_end = hang + d * 0.24
        kb = SD.smooth_union(0.01, SD.ellipsoid(bow, (0.045, 0.012, 0.045), R=G.frame_from(nrm_, (0, 0, 1))),
                             SD.capsule(bow, shaft_end, 0.014))
        V, F = MS.sdf_mesh(kb, bow - 0.3, bow + 0.3, 0.008 if lod == 0 else 0.016, tris=60 if lod == 0 else 16)
        k = Part(V, F, mat, 'key')
        out.append(orient_outward(k))
    for q in out:
        q.set_weights({'hips': np.full(q.n, 0.7), ('thigh.R' if side < 0 else 'thigh.L'): np.full(q.n, 0.3)})
    return out

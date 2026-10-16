# ctail.py - species tails on the shared tail chain (tail.1 ... tail.5, tail_tip). Rest directions are Rocco's (the
# contract never changes rest orientations); a tail type picks per-segment LENGTHS (cskel build['tail']) and a profile:
#   bushy (fox, squirrel), dog, thin (rat, mouse), tufted (ox, cow), stub (goat, sheep, bear), hair (horse),
#   flat (beaver), thick (otter), lizard, fan (hens / roosters: a fan of feather blades), none.
import math
import numpy as np
import cast_common as CC  # noqa: F401
import rk_geo as G
import rk_sdf as SD
import rk_mesh as MS
import rk_rig as RR
import rk_body as BD
from rk_geo import Part, nrm

# per-segment length factors (x Rocco's segment) for each type: the chain runs back, then up, then curls forward
LENGTHS = {
    'bushy': (1.0, 1.0, 1.0, 1.0, 1.0),
    'dog': (0.55, 0.55, 0.75, 0.75, 0.55),
    'thin': (1.0, 1.0, 1.0, 0.9, 0.8),
    'tufted': (0.85, 0.9, 0.8, 0.6, 0.45),
    'stub': (0.12, 0.10, 0.30, 0.35, 0.20),
    'hair': (0.85, 1.05, 0.75, 0.45, 0.30),
    'flat': (0.55, 1.0, 0.55, 0.12, 0.08),
    'thick': (0.9, 1.0, 0.8, 0.5, 0.3),
    'lizard': (1.0, 1.25, 1.1, 0.6, 0.4),
    'fan': (0.20, 0.16, 0.80, 1.00, 0.80),
    'none': (0.1, 0.1, 0.1, 0.1, 0.1),
}
CHAIN = ('tail.1', 'tail.2', 'tail.3', 'tail.4', 'tail.5', 'tail_tip')


def chain_pts(J):
    return [np.asarray(J[k], float) for k in CHAIN]


def tail_path(J, n=12):
    """Smooth curve through the tail joints (Catmull-Rom) with cumulative arc length."""
    P = chain_pts(J)
    P = [P[0] + (P[0] - P[1]) * 0.25] + P + [P[-1] + (P[-1] - P[-2]) * 0.5]
    pts = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for t in np.linspace(0, 1, n, endpoint=False):
            t2, t3 = t * t, t * t * t
            pts.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    pts.append(P[-2])
    pts = np.array(pts)
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
    return pts, s


def seat_root(J, f, z_off=0.0):
    """Move the tail chain so it starts just inside the seat surface of the torso SDF f (bigger seats push it back)."""
    t1 = np.asarray(J['tail.1'], float)
    p = np.array([0.0, t1[1] + 1.5, t1[2] + z_off])
    for _ in range(200):
        v = f(p[None])[0]
        if v < 0.004:
            break
        p[1] -= max(v, 0.004)
    target = p + np.array([0, -0.06, 0])
    d = target - t1
    for k in CHAIN:
        J[k] = np.asarray(J[k], float) + d
    return J


def chain_weights(J, V, blend=0.16):
    P = chain_pts(J)
    chain = [('tail.%d' % i, P[i - 1], P[i]) for i in range(1, 6)]
    W, _ = RR.chain_weights(V, chain, blend)
    rootw = G.smoothstep(0.22, 0.0, np.linalg.norm(V - P[0], axis=1))
    W = {k: v * (1 - rootw) for k, v in W.items()}
    W['hips'] = rootw
    return W


def _sweep_tail(J, prof, mat, sides=9, n=26, start=0.03, mats=None, flat=None, up=(1, 0, 0)):
    pts, s = tail_path(J)
    L = s[-1]
    samp = np.linspace(start * L, L * 0.995, n)
    P = np.array([np.interp(samp, s, pts[:, i]) for i in range(3)]).T
    u = (samp - start * L) / (L * (1 - start))
    rad = np.array([prof(x) for x in u])
    if flat is not None:
        rx = rad * flat[0]
        ry = rad * flat[1]
        p = G.sweep(P, None, sides, mat, up=up, rx=rx, ry=ry, name='tail')
    else:
        p = G.sweep(P, rad, sides, mat, up=up, name='tail')
    if mats is not None:
        ring_of = np.repeat(np.arange(len(P)), sides)
        out = []
        for fc in p.F:
            rows = [ring_of[i] if i < len(ring_of) else (0 if i == len(ring_of) else len(P) - 1) for i in fc]
            out.append(mats(u[min(max(rows), len(u) - 1)]))
        p.mat = out
    BD.orient_outward(p)
    p.set_weights(chain_weights(J, p.V))
    return p


def hem(J, r=0.12):
    """Slot hem where the tail leaves the knickers."""
    P = chain_pts(J)
    c = P[0] + (P[1] - P[0]) * 0.02
    d = nrm(P[1] - P[0])
    R = G.zframe(d)
    ring = [c + R @ np.array([r * math.cos(t), r * math.sin(t), 0]) for t in np.linspace(0, 2 * math.pi, 12, endpoint=False)]
    h = BD.ring_sweep(ring, 0.03, 0.025, 6, True, 'uniform', normals=[nrm(p - c) for p in ring])
    h.rigid('hips')
    return BD.orient_outward(h)


def tail_parts(J, kind, mat='fur', tip_mat=None, lod=0, size=1.0, rng=None):
    """Tail mesh(es) for a type, weighted to the tail chain (and hips at the root)."""
    sides = 9 if lod == 0 else 5
    n = 26 if lod == 0 else 10
    k = size
    parts = []
    if kind in (None, 'none'):
        return parts
    if kind == 'bushy':
        def prof(u):
            b = 0.09 + 0.25 * math.sin(min(u / 0.72, 1) * math.pi / 2) ** 0.8
            if u > 0.72:
                b = 0.34 * max((1 - u) / 0.28, 0) ** 0.75 + 0.012
            return b * k * (1 + 0.04 * math.sin(u * math.pi * 7))
        parts.append(_sweep_tail(J, prof, mat, sides, n, mats=(lambda u: tip_mat if (tip_mat and u > 0.8) else mat)))
        r0 = 0.10 * k
    elif kind == 'dog':
        def prof(u):
            return (0.075 + 0.06 * math.sin(min(u / 0.5, 1) * math.pi / 2)) * (1 - 0.75 * max(u - 0.5, 0) / 0.5) * k + 0.01
        parts.append(_sweep_tail(J, prof, mat, sides, n, mats=(lambda u: tip_mat if (tip_mat and u > 0.82) else mat)))
        r0 = 0.08 * k
    elif kind == 'thin':
        def prof(u):
            return (0.07 * (1 - u) + 0.012) * k
        parts.append(_sweep_tail(J, prof, mat, max(sides - 2, 5), n))
        r0 = 0.07 * k
    elif kind == 'tufted':
        def prof(u):
            return (0.045 * (1 - 0.4 * u) + 0.01) * k
        p = _sweep_tail(J, prof, mat, max(sides - 3, 5), n)
        parts.append(p)
        tip = np.asarray(J['tail_tip'], float)
        d = nrm(tip - np.asarray(J['tail.5'], float))
        c = tip - d * 0.06 * k
        R = G.frame_from(d, (1, 0, 0))
        tuft = SD.smooth_union(0.04, SD.ellipsoid(c, (0.085 * k, 0.15 * k, 0.085 * k), R=R),
                               SD.round_cone(c + d * 0.05 * k, c + d * 0.24 * k, 0.07 * k, 0.012))
        q = Part(*MS.sdf_mesh(tuft, c - 0.4 * k, c + 0.4 * k, 0.012 if lod == 0 else 0.02, tris=140 if lod == 0 else 36),
                 tip_mat or 'fur_dark', 'tail_tuft')
        BD.orient_outward(q)
        q.rigid('tail.5')
        parts.append(q)
        r0 = 0.05 * k
    elif kind == 'stub':
        def prof(u):
            return (0.10 + 0.05 * math.sin(min(u / 0.45, 1) * math.pi / 2)) * (1 - 0.8 * max(u - 0.45, 0) / 0.55) * k + 0.015
        parts.append(_sweep_tail(J, prof, mat, sides, max(n // 2, 8), mats=(lambda u: tip_mat if (tip_mat and u > 0.55) else mat)))
        r0 = 0.10 * k
    elif kind == 'hair':
        def prof(u):
            return (0.07 + 0.12 * math.sin(min(u / 0.6, 1) * math.pi / 2)) * (1 - 0.55 * max(u - 0.6, 0) / 0.4) * k
        p = _sweep_tail(J, prof, mat, sides, n, flat=(1.0, 0.55))
        parts.append(p)
        r0 = 0.07 * k
    elif kind == 'flat':
        def prof(u):
            return (0.06 + 0.20 * math.sin(min(max(u - 0.08, 0) / 0.5, 1) * math.pi / 2)) * (1 - 0.45 * max(u - 0.75, 0) / 0.25) * k
        p = _sweep_tail(J, prof, mat, sides + 3, n, flat=(1.0, 0.18), up=(0, 0, 1))
        parts.append(p)
        r0 = 0.06 * k
    elif kind == 'thick':
        def prof(u):
            return (0.12 * (1 - u) ** 0.8 + 0.015) * k
        parts.append(_sweep_tail(J, prof, mat, sides, n))
        r0 = 0.12 * k
    elif kind == 'lizard':
        def prof(u):
            return (0.16 * (1 - u) ** 1.1 + 0.01) * k
        parts.append(_sweep_tail(J, prof, mat, sides, n, mats=(lambda u: tip_mat if (tip_mat and int(u * 9) % 2 == 1 and u > 0.3) else mat)))
        r0 = 0.16 * k
    elif kind == 'fan':
        parts += feather_fan(J, mat, tip_mat or mat, lod, k, rng)
        r0 = 0.11 * k
    else:
        raise ValueError('tail kind ' + kind)
    parts.append(hem(J, r=max(r0, 0.06) + 0.035))
    return parts


def feather_fan(J, mat, accent, lod, k, rng):
    """Hen / rooster tail: a fan of long curved feather blades rooted at the tail base, following the chain (the
    longest sickle feathers arch up and over)."""
    pts, s = tail_path(J)
    L = s[-1]
    out = []
    nf = 7 if lod == 0 else 4
    root = np.asarray(J['tail.1'], float)
    for i in range(nf):
        a = (i / (nf - 1) - 0.5) * 2              # -1 .. 1 across the fan
        length = (0.60 + 0.40 * (1 - abs(a)) ** 0.7) * L
        m = 12 if lod == 0 else 6
        ss = np.linspace(0.02 * L, length, m)
        P = np.array([np.interp(ss, s, pts[:, j]) for j in range(3)]).T
        spread = a * 0.55 * k * np.sin(np.clip(ss / length, 0, 1) * math.pi * 0.6)
        P[:, 0] += spread
        P[:, 2] -= abs(a) * 0.22 * (ss / length) ** 1.5
        u = ss / length
        w = (0.06 + 0.11 * np.sin(np.clip(u, 0, 1) * math.pi) ** 0.7) * k
        p = G.sweep(P, None, 6 if lod == 0 else 4, accent if (i % 2 == 1) else mat, up=(1, 0, 0), rx=w * (1.0 + 0.6 * abs(a)),
                    ry=w * 0.28, name='feather')
        BD.orient_outward(p)
        p.set_weights(chain_weights(J, p.V))
        out.append(p)
    return out

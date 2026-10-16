# cgear.py - worn gear for the cast: the fielding mitt (left hand), more to come (caps, catcher's and umpire's gear).
import math
import numpy as np
import cast_common as CC  # noqa: F401
import rk_geo as G
import rk_sdf as SD
import rk_mesh as MS
import rk_rig as RR
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


def mitt_part(J, scale=1.0, tris=900):
    """Cartoon fielding mitt on the left hand: padded paddle with four stalls, a thumb stall, a laced web and a deep
    pocket around the `mitt` socket. Weighted to hand.L, the knuckle row (fingers.L closes it) and thumb.L."""
    W0, X, Y, Z = glove_frame(J, 1)
    k = scale

    def tuv(Q):
        q = np.asarray(Q, float) - W0
        return q @ X / k, q @ Y / k, q @ Z / k

    def P(t, u, v):
        return W0 + (X * t + Y * u + Z * v) * k

    def rbox(c, half, e=2.4):
        c = np.asarray(c, float)
        h = np.asarray(half, float)

        def f(Q):
            t, u, v = tuv(Q)
            q = np.stack([(t - c[0]) / h[0], (u - c[1]) / h[1], (v - c[2]) / h[2]], -1)
            kk = np.sum(np.abs(q) ** e, axis=-1) ** (1 / e)
            return (kk - 1.0) * min(h) * k
        return f

    paddle = rbox((-0.005, 0.30, 0.0), (0.155, 0.27, 0.075))
    heel = rbox((0.0, 0.08, 0.0), (0.135, 0.13, 0.088))
    stalls = [SD.capsule(P(t, 0.24, 0.015), P(t * 1.05, 0.60 - 0.035 * abs(t) / 0.1, 0.012), 0.050 * k)
              for t in (-0.108, -0.036, 0.036, 0.108)]
    thumb = SD.round_cone(P(0.12, 0.05, -0.03), P(0.205, 0.40, -0.13), 0.078 * k, 0.058 * k)
    web = rbox((0.165, 0.43, -0.085), (0.035, 0.13, 0.045), e=2.0)
    pocket = SD.ellipsoid(P(0.03, 0.27, -0.29), (0.19 * k, 0.24 * k, 0.20 * k), R=np.stack([X, Y, Z], 1))
    body = SD.smooth_union(0.05 * k, paddle, heel)
    for st in stalls:
        body = SD.smooth_union(0.03 * k, body, st)
    body = SD.smooth_union(0.04 * k, body, thumb)
    body = SD.smooth_union(0.02 * k, body, web)
    wrist_hole = SD.capsule(P(0.0, -0.30, 0.0), P(0.0, 0.02, 0.0), 0.075 * k)
    f = SD.smooth_sub(0.05 * k, body, pocket)
    f = SD.smooth_sub(0.015 * k, f, wrist_hole)
    lo = W0 - 0.8 * k
    hi = W0 + 0.8 * k
    V, F = MS.sdf_mesh(f, lo, hi, 0.009 * k, tris=tris)

    def lace_region(Q):
        t, u, v = tuv(Q)
        webr = np.maximum(np.abs(t - 0.165) - 0.05, np.maximum(np.abs(u - 0.44) - 0.12, v + 0.02))
        tips = np.abs(u - (0.585 - 0.035 * np.abs(t) / 0.1)) - 0.018
        return np.minimum(webr, tips) * k
    V, F = MS.cut_by_field(V, F, lace_region, surf=f)
    mats = MS.faces_by_region(V, F, [('mitt_lace', lace_region)], 'mitt')
    p = Part(V, F, mats, 'mitt')
    orient_outward(p)
    t, u, v = tuv(p.V)
    wt = G.smoothstep(0.10, 0.02, t) * 0 + G.smoothstep(0.11, 0.17, t) * G.smoothstep(0.48, 0.30, u) * G.smoothstep(-0.0, -0.06, v)
    wf = G.smoothstep(0.20, 0.34, u) * (1 - wt)
    p.set_weights({'hand.L': np.clip(1 - wf - wt, 0, 1), 'fingers.L': wf, 'thumb.L': wt})
    return p

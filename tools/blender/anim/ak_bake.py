# ak_bake.py - bake clips (sampled at 40 fps) into per-bone local TRS tracks in glTF convention, check the library
# rules (translation only on root/hips, no scale except the root's squash), and measure sockets at markers.
import math
import numpy as np

from ak_math import M4, decompose, quat_from_mat, nrm
from ak_skel import C, C4
import ak_rig as AR
import ak_clip as AC

FPS = AC.FPS
TRANSLATING = ('root', 'hips')


def gl(v):
    """model-space point/vector -> glTF model space"""
    return C @ np.asarray(v, float)


class Baked:
    pass


def bake(clip, sk, solver, verbose=False):
    n = clip.frames()
    times = np.arange(n + 1) / FPS
    ch = AC.evaluate(clip, times, sk)
    base = AR.rest_channels(sk)
    names = sk.names
    T = {b: np.zeros((n + 1, 3)) for b in names}
    Q = {b: np.zeros((n + 1, 4)) for b in names}           # glTF order (x, y, z, w)
    S = {b: np.ones((n + 1, 3)) for b in names}
    worlds = []
    viol = []
    n_warn0 = len(solver.warn)
    for j, t in enumerate(times):
        c = dict(base)
        for k, arr in ch.items():
            c[k] = float(arr[j])
        W = solver.solve(c, float(t))
        worlds.append(W)
        for b in names:
            p = sk.parent[b]
            if p is None:
                s = max(c['root.s'], 1e-3)
                hs = 1.0 / math.sqrt(s)
                L = M4(np.diag([hs, s, hs])) @ C4 @ W[b]          # squash in glTF axes (Y up)
            else:
                L = np.linalg.inv(W[p]) @ W[b]
            tr, R, sc = decompose(L)
            q = quat_from_mat(R)                                     # (w, x, y, z)
            q = np.array([q[1], q[2], q[3], q[0]])
            if j > 0 and np.dot(q, Q[b][j - 1]) < 0:
                q = -q
            T[b][j], Q[b][j], S[b][j] = tr, q, sc
            if b not in TRANSLATING:
                dt_ = np.linalg.norm(tr - sk.local[b][:3, 3])
                ds_ = np.max(np.abs(sc - 1.0))
                if dt_ > 1e-4 or ds_ > 1e-4:
                    viol.append((b, round(float(t), 3), round(float(dt_), 5), round(float(ds_), 5)))
    res = Baked()
    res.name, res.times, res.T, res.Q, res.S, res.worlds, res.channels = clip.name, times, T, Q, S, worlds, ch
    res.violations = viol
    res.warnings = solver.warn[n_warn0:]
    res.clip = clip
    return res


def _squashed(res, j, name):
    """World position (model space, root on the ground at the origin) of a bone at frame j, with the root's squash
    (vertical s, horizontal 1/sqrt(s), about the root) applied like the exported root node does."""
    p = res.worlds[j][name][:3, 3]
    s = float(res.channels['root.s'][j]) if 'root.s' in res.channels else 1.0
    hs = 1.0 / math.sqrt(max(s, 1e-3))
    return p * np.array([hs, hs, s])


def socket_at(res, sk, name, t):
    """World position of a bone at time t (model space, root at the origin), interpolated between frames."""
    f = t * FPS
    j0 = int(math.floor(f + 1e-9))
    j1 = min(j0 + 1, len(res.times) - 1)
    u = f - j0
    return _squashed(res, j0, name) * (1 - u) + _squashed(res, j1, name) * u


def socket_vel(res, name, t):
    j = int(round(t * FPS))
    j0, j1 = max(j - 1, 0), min(j + 1, len(res.times) - 1)
    return (_squashed(res, j1, name) - _squashed(res, j0, name)) / ((j1 - j0) / FPS)


def face_tracks(res, tol=0.01):
    """Shape-key curves for the sidecar: [[t, v], ...] reduced (piecewise linear within tol), only non-zero keys."""
    out = {}
    times = res.times
    for k in AR.SHAPE_KEYS:
        v = np.clip(res.channels.get('sk.' + k, np.zeros(len(times))), 0, 1)
        if np.max(v) < 0.02:
            continue
        idx = dp_reduce(times, v[:, None], tol)
        out[k] = [[round(float(times[i]), 3), round(float(v[i]), 3)] for i in idx]
    return out


def dp_reduce(T, V, tol, forced=()):
    n = len(T)
    if n <= 2:
        return list(range(n))
    keep = np.zeros(n, bool)
    keep[0] = keep[-1] = True
    for ft in forced:
        k = int(np.argmin(np.abs(T - ft)))
        if abs(T[k] - ft) < 1e-4:
            keep[k] = True
    ks = list(np.nonzero(keep)[0])
    stack = list(zip(ks[:-1], ks[1:]))
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        u = (T[a + 1:b] - T[a]) / (T[b] - T[a])
        L = V[a] + (V[b] - V[a]) * u[:, None]
        e = np.max(np.abs(L - V[a + 1:b]), axis=1)
        i = int(np.argmax(e))
        if e[i] > tol:
            m = a + 1 + i
            keep[m] = True
            stack.append((a, m))
            stack.append((m, b))
    return list(np.nonzero(keep)[0])

# ak_clip.py - key-pose clips for the shared libraries (the same model as rk_anim.Clip, Rocco's clip framework):
# a clip is key poses (full channel dicts) at times, interpolated per channel with a clamped Hermite spline (flows
# through the keys, eases at extremes, no overshoot between keys: overshoot is keyed), optionally lagged per channel
# prefix (overlapping action), plus procedural layers (breathing, shakes) and overrides; the tail, ears and cap get
# spring-driven secondary motion from the hips/head motion. Markers name event times (release, mitt arrival...).
import math
import numpy as np

from ak_math import euler, rot_vec
import ak_rig as AR

FPS = 40
SETTLE = 0.3            # s: one-shot clips fade their spring follow-through out over this much of their end


class Clip:
    def __init__(self, name, length, loop=False):
        self.name, self.length, self.loop = name, float(length), loop
        self.keys = []          # (t, channels, mode)
        self.lags = {}          # channel prefix -> lag (s)
        self.layers = []        # f(t) -> {channel: additive offset}
        self.overrides = []     # f(t) -> {channel: (value, weight)}
        self.tail_lag = 0.035
        self.secondary = True
        self.sec_gain = 1.0
        self.markers = {}       # name -> time (s)
        self.meta = {}          # anything else for the sidecar (from/to poses, notes)
        self.post = []          # f(t, W, solver) -> None (bake-time checks, e.g. contact positions)

    def key(self, t, pose, mode='auto'):
        self.keys.append((float(t), dict(pose), mode))
        return pose

    def frames(self):
        return int(round(self.length * FPS))


def hermite_eval(T, V, modes, times, loop=False, L=None):
    """Clamped Hermite spline through keys (rk_anim.hermite_eval). modes per key affect the segment starting at that
    key: 'auto', 'lin', 'step', 'stop' (zero tangent at this key)."""
    T = np.asarray(T, float)
    V = np.asarray(V, float)
    n = len(T)
    if n == 1:
        return np.full(len(times), V[0])
    m = np.zeros(n)
    for i in range(n):
        if modes[i] == 'stop':
            continue
        if 0 < i < n - 1:
            t0, t1, v0, v1 = T[i - 1], T[i + 1], V[i - 1], V[i + 1]
        elif loop and n > 2:
            if i == 0:
                t0, v0 = T[-2] - L, V[-2]
                t1, v1 = T[1], V[1]
            else:
                t0, v0 = T[-2], V[-2]
                t1, v1 = T[1] + L, V[1]
        else:
            continue
        mi = (v1 - v0) / max(t1 - t0, 1e-9)
        dl, dr = V[i] - v0, v1 - V[i]
        if dl * dr <= 0:
            mi = 0.0
        else:
            hl = dl / max(T[i] - t0, 1e-9)
            hr = dr / max(t1 - T[i], 1e-9)
            lim = 3.0 * min(abs(hl), abs(hr))
            if abs(mi) > lim:
                mi = math.copysign(lim, mi)
        m[i] = mi
    out = np.empty(len(times))
    for j, t in enumerate(times):
        if t <= T[0]:
            out[j] = V[0]
            continue
        if t >= T[-1]:
            out[j] = V[-1]
            continue
        i = int(np.searchsorted(T, t, side='right') - 1)
        t0, t1 = T[i], T[i + 1]
        u = (t - t0) / (t1 - t0)
        md = modes[i]
        if md == 'step':
            out[j] = V[i]
        elif md == 'lin':
            out[j] = V[i] + (V[i + 1] - V[i]) * u
        else:
            h = t1 - t0
            m0 = m[i] * h
            m1 = (0.0 if modes[i + 1] == 'stop' else m[i + 1]) * h
            u2, u3 = u * u, u * u * u
            out[j] = (2 * u3 - 3 * u2 + 1) * V[i] + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * V[i + 1] + (u3 - u2) * m1
    return out


def evaluate(clip, times, sk):
    keys = sorted(clip.keys, key=lambda k: k[0])
    T = [k[0] for k in keys]
    modes = [k[2] for k in keys]
    base = AR.rest_channels(sk)
    chans = set(base)
    for k in keys:
        chans.update(k[1].keys())
    out = {}
    for ch in chans:
        V = [float(k[1].get(ch, base.get(ch, 0.0))) for k in keys]
        if max(V) - min(V) < 1e-12:
            out[ch] = np.full(len(times), V[0], dtype=float)
            continue
        lag = 0.0
        for pre, lg in clip.lags.items():
            if ch.startswith(pre):
                lag = lg
        tt = np.asarray(times) - lag
        tt = np.mod(tt, clip.length) if clip.loop else np.clip(tt, 0, clip.length)
        out[ch] = hermite_eval(T, V, modes, tt, clip.loop, clip.length)
    for layer in clip.layers:
        for j, t in enumerate(times):
            for ch, dv in layer(t).items():
                if ch not in out:
                    out[ch] = np.full(len(times), float(base.get(ch, 0.0)), dtype=float)
                out[ch][j] += dv
    for ov in clip.overrides:
        for j, t in enumerate(times):
            for ch, (val, w) in ov(t).items():
                if ch not in out:
                    out[ch] = np.full(len(times), float(base.get(ch, 0.0)), dtype=float)
                out[ch][j] = out[ch][j] * (1 - w) + val * w
    # one-shot clips settle their follow-through over the last SETTLE s (the tail's lag and the springs fade out), so
    # each ends exactly on its keyed pose: the next clip starts there without a pop, and a held last frame is at rest
    n = len(times)
    env = np.ones(n)
    if not clip.loop and clip.length > 0:
        tf = min(SETTLE, 0.25 * clip.length)
        u = np.clip((np.asarray(times, float) - (clip.length - tf)) / tf, 0.0, 1.0)
        env = 1.0 - u * u * (3 - 2 * u)
    # tail: per-bone values from the tail.* channels with progressive lag (a whip down the chain)
    for i in range(1, 6):
        lag = clip.tail_lag * i
        tt = np.asarray(times) - lag * env
        tt = np.mod(tt, clip.length) if clip.loop else np.clip(tt, 0, clip.length)
        vals = {}
        for k in ('rx', 'rz', 'curl'):
            ch = 'tail.' + k
            V = [kk[1].get(ch, 0.0) for kk in keys]
            vals[k] = hermite_eval(T, V, modes, tt, clip.loop, clip.length)
            for layer in clip.layers:
                vals[k] = vals[k] + np.array([layer(x).get(ch, 0.0) for x in tt])
        w = [1.0, 0.8, 0.7, 0.6, 0.5][i - 1]
        out['_tail%d.rx' % i] = vals['rx'] * w + vals['curl'] * (0.4 + 0.15 * i)
        out['_tail%d.ry' % i] = np.zeros(n)
        out['_tail%d.rz' % i] = vals['rz'] * w
    if clip.secondary and n > 4:
        dt = float(times[1] - times[0])
        Rs = chain_rotations(out, n)
        hp = np.stack([out['hip.x'], out['hip.y'], out['hip.z'] + sk.J['hips'][2] / sk.U], 1) * sk.U
        g = clip.sec_gain
        tr = spring_response(Rs['hips'], hp, dt, freq=2.2, damp=0.28, gain=0.55 * g, loop=clip.loop, lin_gain=0.6 * g, u=(0, 1, 0))
        tr = tr * env[:, None]
        for i in range(1, 6):
            k = 0.35 + 0.22 * i
            out['_tail%d.rx' % i] = out['_tail%d.rx' % i] + np.degrees(tr[:, 0]) * k * 0.6
            out['_tail%d.rz' % i] = out['_tail%d.rz' % i] + np.degrees(tr[:, 2]) * k
        hr = spring_response(Rs['head'], hp + np.array([0, 0, 2.3]), dt, freq=3.2, damp=0.3, gain=0.35 * g, loop=clip.loop, lin_gain=0.4 * g, u=(0, 0, 1))
        hr = hr * env[:, None]
        for sd in ('L', 'R'):
            for ax, idx in (('rx', 0), ('ry', 1), ('rz', 2)):
                key = 'ear%s.%s' % (sd, ax)
                out[key] = out[key] + np.degrees(hr[:, idx]) * 1.4
        cr = spring_response(Rs['head'], hp + np.array([0, 0, 2.6]), dt, freq=4.0, damp=0.45, gain=0.12 * g, loop=clip.loop, lin_gain=0.15 * g, u=(0, 0, 1))
        cr = cr * env[:, None]
        for ax, idx in (('rx', 0), ('ry', 1), ('rz', 2)):
            out['cap.' + ax] = out['cap.' + ax] + np.degrees(cr[:, idx]) * 0.5
    return out


def chain_rotations(ch, n):
    out = {'hips': [], 'chest': [], 'head': []}
    for j in range(n):
        g = lambda k: float(ch[k][j]) if k in ch else 0.0
        Rh = euler(g('hip.rx'), g('hip.ry'), g('hip.rz'))
        Rs = Rh @ euler(g('spine.rx'), g('spine.ry'), g('spine.rz'))
        Rc = Rs @ euler(g('chest.rx'), g('chest.ry'), g('chest.rz'))
        Rn = Rc @ euler(g('neck.rx'), g('neck.ry'), g('neck.rz'))
        Rd = Rn @ euler(g('head.rx'), g('head.ry'), g('head.rz'))
        out['hips'].append(Rh)
        out['chest'].append(Rc)
        out['head'].append(Rd)
    return {k: np.array(v) for k, v in out.items()}


def spring_response(R, pos, dt, freq=3.0, damp=0.35, gain=1.0, loop=False, lin_gain=0.0, u=(0, 0, 1)):
    """Lagging response (rotation vector in the parent's frame, radians) of a pendulum along u on a spring attached to
    a moving frame (rk_anim.spring_response). R: (n,3,3) parent world rotations; pos: (n,3) pivot positions."""
    u = np.asarray(u, float)
    n = len(R)
    w = 2 * math.pi * freq
    k, c = w * w, 2 * damp * w
    om = np.zeros((n, 3))
    for j in range(1, n):
        om[j] = rot_vec(R[j - 1], R[j]) / dt
    om[0] = om[1] if n > 1 else 0
    alpha = np.gradient(om, dt, axis=0) if n > 2 else np.zeros_like(om)
    vel = np.gradient(pos, dt, axis=0) if n > 2 else np.zeros_like(pos)
    acc = np.gradient(vel, dt, axis=0) if n > 2 else np.zeros_like(pos)
    acc_local = np.einsum('nji,nj->ni', R, acc)
    reps = 3 if loop else 1
    th = np.zeros(3)
    thd = np.zeros(3)
    out = np.zeros((n, 3))
    sub = 4
    for r in range(reps):
        for j in range(n):
            al = alpha[j] - np.dot(alpha[j], u) * u
            fa = -gain * al
            fl = -lin_gain * np.cross(u, acc_local[j])
            for _ in range(sub):
                h = dt / sub
                thdd = -k * th - c * thd + fa + fl
                thd = thd + thdd * h
                th = th + thd * h
            out[j] = th
    if loop and n > 4:
        d = out[-1] - out[0]
        out = out - np.outer(np.linspace(0, 1, n), d)
    return out

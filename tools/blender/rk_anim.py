# rk_anim.py - pose solver + key-pose clip system + baking into glTF-ready actions.
# A clip is a list of key poses (dicts of named channels) at times; channels are interpolated with a clamped
# Hermite spline (flows through keys, eases at extremes), optionally lagged per channel (overlapping action),
# plus procedural layers (breathing, waggle, tremble). Every sampled frame is solved (FK, two-bone IK with poles,
# hands attached to the bat) and written as bone loc/rot/scale + shape-key values into one action per clip.
import math
import numpy as np
import bpy
from mathutils import Matrix

import rk_rig as RR
from rk_geo import rot_axis, nrm

FPS = 40
D2R = math.pi / 180.0

SHAPE_KEYS = ['blink', 'smile', 'grin', 'frown', 'mouth_open', 'brows_up', 'brows_angry', 'brows_sad', 'squint', 'cheeks_puff']


# ------------------------------------------------------------------------------------------- rotations
def euler(rx=0.0, ry=0.0, rz=0.0):
    """XYZ euler in degrees (applied X, then Y, then Z in the parent frame): R = Rz @ Ry @ Rx."""
    return rot_axis((0, 0, 1), rz * D2R) @ rot_axis((0, 1, 0), ry * D2R) @ rot_axis((1, 0, 0), rx * D2R)


def M4(R=None, t=None, s=None):
    M = np.eye(4)
    if R is not None:
        M[:3, :3] = R
    if s is not None:
        M[:3, :3] = M[:3, :3] @ np.diag(s)
    if t is not None:
        M[:3, 3] = t
    return M


def frame3(a, b):
    """Right-handed frame from two (not necessarily orthogonal) directions: columns [a, b_perp, a x b_perp]."""
    a = nrm(a)
    b = np.asarray(b, float) - np.dot(b, a) * a
    if np.linalg.norm(b) < 1e-8:
        b = np.cross(a, [0, 0, 1]) if abs(a[2]) < 0.9 else np.cross(a, [1, 0, 0])
    b = nrm(b)
    return np.stack([a, b, np.cross(a, b)], 1)


# ------------------------------------------------------------------------------------------- default pose
def rest_channels():
    c = {}
    c['root.s'] = 1.0
    for k in ('x', 'y', 'z', 'rx', 'ry', 'rz'):
        c['hip.' + k] = 0.0
    for b in ('spine', 'chest', 'neck', 'head', 'jaw', 'cap', 'eye', 'eyeL', 'eyeR', 'earL', 'earR', 'browL', 'browR', 'shL', 'shR'):
        for k in ('rx', 'ry', 'rz'):
            c[b + '.' + k] = 0.0
    c['chest.s'] = 1.0
    c['head.s'] = 1.0
    c['cap.z'] = 0.0
    c['browL.z'] = 0.0
    c['browR.z'] = 0.0
    for k in ('rx', 'rz', 'curl', 'fluff'):
        c['tail.' + k] = 0.0
    # bat (pivot, barrel direction, top-hand palm direction), visibility
    p = RR.jv('bat')
    c['bat.x'], c['bat.y'], c['bat.z'] = p
    c['bat.dx'], c['bat.dy'], c['bat.dz'] = 0.0, -1.0, 0.0
    pn = RR.HAND_N * np.array([-1, 1, 1])
    c['bat.px'], c['bat.py'], c['bat.pz'] = pn
    c['bat.vis'] = 1.0
    c['bat.len'] = 1.0        # stretch along the bat axis (smear frames)
    c['smear'] = 0.0          # arms thrown out and stretched along shoulder -> hand (smear frames)
    for s in ('L', 'R'):
        sx = RR.SIDE[s]
        w = RR.jv('hand.' + s)
        c['hand%s.x' % s], c['hand%s.y' % s], c['hand%s.z' % s] = w
        for k in ('rx', 'ry', 'rz'):
            c['hand%s.%s' % (s, k)] = 0.0
        c['elbow%s.x' % s], c['elbow%s.y' % s], c['elbow%s.z' % s] = 0.0, 1.0, 0.0
        c['grip' + s] = 1.0 if s == 'R' else 0.0
        c['hand%s.rel' % s] = 0.0          # 1: hand target / elbow pole given in the rest body frame, carried by the chest
        c['hand%s.relh' % s] = 0.0         # 1: hand target given in the rest frame of the head (carried by the head)
        c['roll' + s] = 0.0
        c['fing' + s] = 0.0
        c['thumb' + s] = 0.0
        b = RR.jv('toe.' + s)
        c['foot%s.x' % s], c['foot%s.y' % s], c['foot%s.z' % s] = b
        for k in ('rx', 'ry', 'rz'):
            c['foot%s.%s' % (s, k)] = 0.0
        c['toe%s.rx' % s] = 0.0
        c['knee%s.x' % s], c['knee%s.y' % s], c['knee%s.z' % s] = 0.15 * sx, -1.0, 0.0
    for k in SHAPE_KEYS:
        c['sk.' + k] = 0.0
    return c


CHANNELS = list(rest_channels().keys())


# ------------------------------------------------------------------------------------------- solver
class Solver:
    def __init__(self, rig_ob):
        self.ob = rig_ob
        self.rest = {b.name: np.array(b.matrix_local) for b in rig_ob.data.bones}
        self.rest_inv = {k: np.linalg.inv(m) for k, m in self.rest.items()}
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in rig_ob.data.bones}
        self.order = [b[0] for b in RR.BONES]
        # grip frames (rest) for both fists
        self.grip = {}
        A = np.array([0.0, -1.0, 0.0])                       # bat axis in bat-local (towards the barrel)
        P = RR.HAND_N * np.array([-1, 1, 1])                # top (right) hand palm normal in bat-local
        for s in ('L', 'R'):
            mir = np.array([RR.SIDE[s], 1, 1])
            t = RR.HAND_T * mir
            n = RR.HAND_N * mir
            G_rest = frame3(t, n)
            gc = RR.GRIP_C * mir
            G_bat = frame3(A, P if s == 'R' else -P)
            along = RR.GRIP_R if s == 'R' else RR.GRIP_L
            self.grip[s] = dict(G_rest=G_rest, G_bat=G_bat, gc=gc, along=along,
                                wrist_off=RR.jv('hand.' + s) - gc)
        self.bat_frame_local = frame3(A, P)
        self.warn = []

    def _local_rest(self, name):
        p = self.parent[name]
        return (self.rest_inv[p] @ self.rest[name]) if p else self.rest[name]

    def head_pos(self, W, name):
        """World position of bone `name`'s head given its parent's world matrix."""
        p = self.parent[name]
        M = (W[p] @ self._local_rest(name)) if p else self.rest[name]
        return M[:3, 3].copy()

    def solve(self, c, t=0.0):
        W, B = {}, {}
        rest = self.rest

        def fk(name, basis):
            p = self.parent[name]
            Pw = W[p] if p else np.eye(4)
            W[name] = Pw @ self._local_rest(name) @ basis
            B[name] = basis

        def set_world(name, M):
            p = self.parent[name]
            Pw = W[p] if p else np.eye(4)
            B[name] = np.linalg.inv(Pw @ self._local_rest(name)) @ M
            W[name] = M

        def world_delta(name, Rd, pos=None, scale=None):
            """Rotate the bone's rest orientation by a world-space delta Rd, at its (posed) head position."""
            h = self.head_pos(W, name) if pos is None else pos
            set_world(name, M4(Rd @ rest[name][:3, :3], h, scale))

        def rot_of(M):
            R = M[:3, :3]
            return R / np.linalg.norm(R, axis=0, keepdims=True)

        def rel_delta(name, Rl):
            """Rotation Rl (in the parent's posed axes) applied on top of the rest pose relation to the parent."""
            p = self.parent[name]
            Rp = rot_of(W[p]) @ rest[p][:3, :3].T
            set_world(name, M4(Rp @ Rl @ rest[name][:3, :3], self.head_pos(W, name)))

        def fkm(name, E=None, tr=None, sc=None):
            """FK for control bones with rotation / translation / scale given in model (Blender) axes."""
            Rr = np.eye(4)
            Rr[:3, :3] = rest[name][:3, :3]
            Mm = M4(E, tr, sc)
            fk(name, Rr.T @ Mm @ Rr)

        g = lambda k: c[k]
        vec = lambda k: np.array([c[k + '.x'], c[k + '.y'], c[k + '.z']])
        self.smearing = c.get('smear', 0.0) > 1e-4
        eul = lambda k: euler(c[k + '.rx'], c[k + '.ry'], c[k + '.rz'])

        # root squash (vertical stretch s, volume preserving)
        s = g('root.s')
        hs = 1.0 / math.sqrt(max(s, 1e-3))
        fkm('root', sc=(hs, hs, s))
        fkm('hips', eul('hip'), vec('hip'))
        fkm('spine', eul('spine'))
        cs = g('chest.s')
        fkm('chest', eul('chest'), sc=(1 / math.sqrt(cs), 1 / math.sqrt(cs), cs))
        fkm('neck', eul('neck'))
        hsq = g('head.s')
        fkm('head', eul('head'), sc=(1 / math.sqrt(hsq), 1 / math.sqrt(hsq), hsq))
        fkm('jaw', euler(g('jaw.rx'), 0, 0))
        fkm('cap', eul('cap'), (0, 0, g('cap.z')))
        for sd in ('L', 'R'):
            fkm('eye.' + sd, euler(g('eye.rx') + g('eye%s.rx' % sd), 0, g('eye.rz') + g('eye%s.rz' % sd)))
            fkm('brow.' + sd, euler(g('brow%s.rx' % sd), g('brow%s.ry' % sd), g('brow%s.rz' % sd)), (0, 0, g('brow%s.z' % sd)))
            fkm('ear.' + sd, eul('ear' + sd))
        # tail: local curl about the bone's X (in its plane), swing about its Z
        for i in range(1, 6):
            nm = 'tail.%d' % i
            sc = c.get('_tail%d.s' % i, 1.0)
            fk(nm, M4(euler(c['_tail%d.rx' % i], c['_tail%d.ry' % i], c['_tail%d.rz' % i]), s=(sc, sc, sc)))
        # bat
        d = np.array([g('bat.dx'), g('bat.dy'), g('bat.dz')])
        pal = np.array([g('bat.px'), g('bat.py'), g('bat.pz')])
        Rb = frame3(d, pal) @ self.bat_frame_local.T
        vis = max(g('bat.vis'), 1e-4)
        set_world('bat', M4(Rb @ rest['bat'][:3, :3], vec('bat'), (vis, vis, vis * max(g('bat.len'), 1e-3))))
        fk('bat_sweet', np.eye(4))
        fk('bat_tip', np.eye(4))
        Wbat = M4(Rb, vec('bat'))
        # arms
        for sd in ('L', 'R'):
            sx = RR.SIDE[sd]
            rel_delta('shoulder.' + sd, euler(g('sh%s.rx' % sd), g('sh%s.ry' % sd), g('sh%s.rz' % sd)))
            S = self.head_pos(W, 'upper_arm.' + sd)
            # hand target: free (world, or carried by the chest) or on the bat
            Pfree = vec('hand' + sd)
            rel = g('hand%s.rel' % sd)
            Rc = rot_of(W['chest']) @ rest['chest'][:3, :3].T
            relh = g('hand%s.relh' % sd)
            if relh > 1e-4:
                Rhd = rot_of(W['head']) @ rest['head'][:3, :3].T
                Ph = W['head'][:3, 3] + Rhd @ (Pfree - RR.jv('head'))
                Pfree = Pfree * (1 - relh) + Ph * relh
            elif rel > 1e-4:
                Pc = W['chest'][:3, 3] + Rc @ (Pfree - RR.jv('chest'))
                Pfree = Pfree * (1 - rel) + Pc * rel
            gw = np.clip(g('grip' + sd), 0, 1)
            Rfree = None
            if gw > 1e-4:
                G = self.grip[sd]
                Gb = G['G_bat']
                if abs(g('roll' + sd)) > 1e-6:
                    Gb = rot_axis((0, -1, 0), g('roll' + sd) * D2R) @ Gb
                Q = Wbat[:3, :3] @ Gb @ G['G_rest'].T
                gc_w = Wbat[:3, :3] @ (np.array([0, -1.0, 0]) * G['along']) + Wbat[:3, 3]
                Pgrip = gc_w + Q @ G['wrist_off']
                Rgrip = Q @ rest['hand.' + sd][:3, :3]
                Pt = Pgrip if gw >= 1 - 1e-4 else Pfree * (1 - gw) + Pgrip * gw
            else:
                Pt, Rgrip = Pfree, None
            sm = g('smear')
            if sm > 1e-4:
                Pt = S + (Pt - S) * (1.0 + 0.28 * sm)
            pole = vec('elbow' + sd)
            if rel > 1e-4:
                pole = pole * (1 - rel) + (Rc @ pole) * rel
            self._ik2(W, B, set_world, 'upper_arm.' + sd, 'forearm.' + sd, S, Pt, pole, max_stretch=1.45, tag='arm' + sd, t=t)
            Wr = W['forearm.' + sd] @ self._local_rest('hand.' + sd)
            Rfa = rot_of(W['forearm.' + sd]) @ rest['forearm.' + sd][:3, :3].T
            Rhr = rest['hand.' + sd][:3, :3]
            Rfree = Rfa @ Rhr @ eul('hand' + sd)
            if Rgrip is None:
                Rt = Rfree
            elif gw >= 1 - 1e-4:
                Rt = Rgrip
            else:
                Rt = slerp_mat(Rfree, Rgrip, gw)
            set_world('hand.' + sd, M4(Rt, Wr[:3, 3]))
            # fingers / thumb: curl about the fist's tunnel axis (positive = open)
            tw = Rt @ rest['hand.' + sd][:3, :3].T @ (RR.HAND_T * np.array([sx, 1, 1]))
            nw = Rt @ rest['hand.' + sd][:3, :3].T @ (RR.HAND_N * np.array([sx, 1, 1]))
            aw = np.cross(tw, nw)   # along the hand
            Rh = Rt @ rest['hand.' + sd][:3, :3].T
            world_delta('fingers.' + sd, rot_axis(tw * sx, -g('fing' + sd) * D2R) @ Rh)
            world_delta('thumb.' + sd, rot_axis(aw * sx, g('thumb' + sd) * D2R) @ Rh)
        # legs
        for sd in ('L', 'R'):
            Rf = euler(0, 0, g('foot%s.rz' % sd)) @ euler(g('foot%s.rx' % sd), g('foot%s.ry' % sd), 0)
            ball = vec('foot' + sd)
            ball_rest = RR.jv('toe.' + sd)
            ankle_t = ball + Rf @ (RR.jv('foot.' + sd) - ball_rest)
            H = self.head_pos(W, 'thigh.' + sd)
            pole = vec('knee' + sd)
            self._ik2(W, B, set_world, 'thigh.' + sd, 'shin.' + sd, H, ankle_t, pole, max_stretch=1.12, tag='leg' + sd, t=t)
            A = (W['shin.' + sd] @ self._local_rest('foot.' + sd))[:3, 3]
            set_world('foot.' + sd, M4(Rf @ rest['foot.' + sd][:3, :3], A))
            Rt_ = euler(0, 0, g('foot%s.rz' % sd)) @ euler(g('toe%s.rx' % sd), g('foot%s.ry' % sd), 0)
            Tp = (W['foot.' + sd] @ self._local_rest('toe.' + sd))[:3, 3]
            set_world('toe.' + sd, M4(Rt_ @ rest['toe.' + sd][:3, :3], Tp))
        return W, B

    def _ik2(self, W, B, set_world, b1, b2, S, T, pole, max_stretch=1.0, tag='', t=0.0):
        r1, r2 = self.rest[b1], self.rest[b2]
        a = np.linalg.norm(r2[:3, 3] - r1[:3, 3])
        end = self.rest[self.order[self.order.index(b2) + 0]]
        # length of b2: distance to its child's head (hand / foot)
        child = 'hand.' + b2[-1] if b2.startswith('forearm') else 'foot.' + b2[-1]
        b = np.linalg.norm(self.rest[child][:3, 3] - r2[:3, 3])
        dvec = T - S
        dist = np.linalg.norm(dvec)
        k = 1.0
        if dist > (a + b) * 0.9995:
            k = min(dist / ((a + b) * 0.9995), max_stretch)
            if dist > (a + b) * max_stretch * 0.9995:
                self.warn.append('%s out of reach at t=%.3f by %.3f ft' % (tag, t, dist - (a + b) * max_stretch))
            elif tag.startswith('arm') and k > 1.12 and not getattr(self, 'smearing', False):
                self.warn.append('%s stretched x%.2f at t=%.3f' % (tag, k, t))
        a2, b2l = a * k, b * k
        dist = min(dist, (a2 + b2l) * 0.9999)
        dist = max(dist, abs(a2 - b2l) + 1e-4)
        dn = nrm(dvec)
        x = (a2 * a2 - b2l * b2l + dist * dist) / (2 * dist)
        h = math.sqrt(max(a2 * a2 - x * x, 0.0))
        pn = np.asarray(pole, float) - np.dot(pole, dn) * dn
        if np.linalg.norm(pn) < 1e-6:
            pn = np.cross(dn, [1, 0, 0])
        pn = nrm(pn)
        E = S + dn * x + pn * h
        Tr = S + dn * dist
        for bone, p0, p1 in ((b1, S, E), (b2, E, Tr)):
            y = nrm(p1 - p0)
            z = nrm(pn - np.dot(pn, y) * y) if np.linalg.norm(pn - np.dot(pn, y) * y) > 1e-6 else nrm(np.cross([1, 0, 0], y))
            # keep the rest roll relation: rest Z ~ pole side for both bones
            x_ = np.cross(y, z)
            R = np.stack([x_, y, z], 1)
            set_world(bone, M4(R, p0))      # stretch = joint translation (no bone scale -> no shear on children)


def slerp_mat(Ra, Rb, t):
    from mathutils import Matrix as MM
    qa = MM(Ra.tolist()).to_quaternion()
    qb = MM(Rb.tolist()).to_quaternion()
    return np.array(qa.slerp(qb, t).to_matrix())


# ------------------------------------------------------------------------------------------- splines
class Clip:
    def __init__(self, name, length, loop=False):
        self.name, self.length, self.loop = name, float(length), loop
        self.keys = []          # (t, channels dict, mode)
        self.lags = {}          # channel prefix -> lag seconds
        self.layers = []        # f(t) -> {channel: additive offset}
        self.tail_lag = 0.035
        self.secondary = True
        self.sec_gain = 1.0
        self.overrides = []     # f(t) -> {channel: (value, weight)} replaces evaluated channels (blended by weight)

    def key(self, t, base=None, mode='auto', **ch):
        prev = dict(self.keys[-1][1]) if (self.keys and base is None) else dict(base if base is not None else rest_channels())
        for k, v in ch.items():
            prev[k.replace('__', '.')] = v
        self.keys.append((float(t), prev, mode))
        return prev

    def pose(self, t, base=None, mode='auto', **ch):
        """Add a key from a pose dict (base) updated by **ch with 'a__b' -> 'a.b' names."""
        return self.key(t, base=base, mode=mode, **ch)

    def frames(self):
        return int(round(self.length * FPS))


def hermite_eval(T, V, modes, times, loop=False, L=None):
    """Clamped Hermite spline through keys (T sorted). modes per key affect the segment starting at that key:
    'auto', 'lin', 'step', 'stop' (zero tangent at this key)."""
    T = np.asarray(T, float)
    V = np.asarray(V, float)
    n = len(T)
    if n == 1:
        return np.full(len(times), V[0])
    m = np.zeros(n)
    for i in range(n):
        if modes[i] == 'stop':
            m[i] = 0.0
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
            m[i] = 0.0
            continue
        mi = (v1 - v0) / max(t1 - t0, 1e-9)
        # clamp at extremes and limit overshoot (Fritsch-Carlson style)
        dl = (V[i] - v0)
        dr = (v1 - V[i])
        if dl * dr <= 0:
            mi = 0.0
        else:
            hl = (V[i] - v0) / max(T[i] - t0 if i > 0 or not loop else T[i] - t0, 1e-9)
            hr = (v1 - V[i]) / max(t1 - T[i], 1e-9)
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
            hdt = t1 - t0
            m0 = m[i] * hdt
            m1 = (0.0 if modes[i + 1] == 'stop' else m[i + 1]) * hdt
            u2, u3 = u * u, u * u * u
            out[j] = (2 * u3 - 3 * u2 + 1) * V[i] + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * V[i + 1] + (u3 - u2) * m1
    return out


def evaluate_clip(clip, times):
    keys = sorted(clip.keys, key=lambda k: k[0])
    T = [k[0] for k in keys]
    modes = [k[2] for k in keys]
    chans = set()
    for k in keys:
        chans.update(k[1].keys())
    base = rest_channels()
    out = {}
    for ch in chans:
        V = [k[1].get(ch, base.get(ch, 0.0)) for k in keys]
        lag = 0.0
        for pre, lg in clip.lags.items():
            if ch.startswith(pre):
                lag = lg
        tt = np.asarray(times) - lag
        if clip.loop:
            tt = np.mod(tt, clip.length)
        else:
            tt = np.clip(tt, 0, clip.length)
        out[ch] = hermite_eval(T, V, modes, tt, clip.loop, clip.length)
    for layer in clip.layers:
        for j, t in enumerate(times):
            for ch, dv in layer(t).items():
                if ch not in out:
                    out[ch] = np.full(len(times), base.get(ch, 0.0))
                out[ch][j] += dv
    for ov in getattr(clip, 'overrides', []):
        for j, t in enumerate(times):
            for ch, (val, w) in ov(t).items():
                if ch not in out:
                    out[ch] = np.full(len(times), base.get(ch, 0.0))
                out[ch][j] = out[ch][j] * (1 - w) + val * w
    # tail: per-bone values from tail.* channels with progressive lag
    for i in range(1, 6):
        lag = clip.tail_lag * i
        tt = np.asarray(times) - lag
        tt = np.mod(tt, clip.length) if clip.loop else np.clip(tt, 0, clip.length)
        vals = {}
        for k in ('rx', 'rz', 'curl', 'fluff'):
            ch = 'tail.' + k
            V = [kk[1].get(ch, 0.0) for kk in keys]
            vals[k] = hermite_eval(T, V, modes, tt, clip.loop, clip.length)
            for layer in clip.layers:
                vals[k] = vals[k] + np.array([layer(x).get(ch, 0.0) for x in tt])
        w = [1.0, 0.8, 0.7, 0.6, 0.5][i - 1]
        out['_tail%d.rx' % i] = vals['rx'] * w + vals['curl'] * (0.4 + 0.15 * i)
        out['_tail%d.ry' % i] = np.zeros(len(times))
        out['_tail%d.rz' % i] = vals['rz'] * w
        out['_tail%d.s' % i] = (1.0 + vals['fluff']) if i == 1 else np.ones(len(times))
    if getattr(clip, 'secondary', True) and len(times) > 4:
        dt = float(times[1] - times[0])
        Rs = chain_rotations(out, len(times))
        hp_ = np.stack([out.get('hip.x', np.zeros(len(times))), out.get('hip.y', np.zeros(len(times))),
                        out.get('hip.z', np.zeros(len(times))) + 1.7], 1)
        # tail: a chain of springs; deeper bones swing more and later
        tr = spring_response(Rs['hips'], hp_, dt, freq=2.2, damp=0.28, gain=0.55 * clip.sec_gain, loop=clip.loop, lin_gain=0.6 * clip.sec_gain, u=(0, 1, 0))
        for i in range(1, 6):
            k = 0.35 + 0.22 * i
            out['_tail%d.rx' % i] = out['_tail%d.rx' % i] + np.degrees(tr[:, 0]) * k * 0.6
            out['_tail%d.rz' % i] = out['_tail%d.rz' % i] + np.degrees(tr[:, 2]) * k
        # ears and cap: springs on the head
        hr = spring_response(Rs['head'], hp_ + np.array([0, 0, 2.3]), dt, freq=3.2, damp=0.3, gain=0.35 * clip.sec_gain, loop=clip.loop, lin_gain=0.4 * clip.sec_gain, u=(0, 0, 1))
        for sd in ('L', 'R'):
            for ax, idx in (('rx', 0), ('ry', 1), ('rz', 2)):
                key = 'ear%s.%s' % (sd, ax)
                out[key] = out.get(key, np.zeros(len(times))) + np.degrees(hr[:, idx]) * 1.4
        cr = spring_response(Rs['head'], hp_ + np.array([0, 0, 2.6]), dt, freq=4.0, damp=0.45, gain=0.12 * clip.sec_gain, loop=clip.loop, lin_gain=0.15 * clip.sec_gain, u=(0, 0, 1))
        for ax, idx in (('rx', 0), ('ry', 1), ('rz', 2)):
            key = 'cap.' + ax
            out[key] = out.get(key, np.zeros(len(times))) + np.degrees(cr[:, idx]) * 0.5
    return out


# ------------------------------------------------------------------------------------------- secondary motion
def chain_rotations(ch, n):
    """World rotations of hips/chest/head per frame from the evaluated euler channels (model axes)."""
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


def rot_vec(Ra, Rb):
    """Small rotation vector taking Ra to Rb, expressed in Ra's frame."""
    from mathutils import Matrix as MM
    q = MM((Ra.T @ Rb).tolist()).to_quaternion()
    ax, ang = q.to_axis_angle()
    if ang > math.pi:
        ang -= 2 * math.pi
    return np.array(ax) * ang


def spring_response(R, pos, dt, freq=3.0, damp=0.35, gain=1.0, loop=False, lin_gain=0.0, u=(0, 0, 1)):
    """Lagging response (rotation vector in the parent's frame, radians) of a pendulum pointing along u (parent
    frame) on a spring attached to a moving frame. R: (n,3,3) parent world rotations; pos: (n,3) pivot positions."""
    u = np.asarray(u, float)
    n = len(R)
    w = 2 * math.pi * freq
    k, c = w * w, 2 * damp * w
    # angular velocity (parent frame) and linear acceleration (parent frame)
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
            # inertial forcing: the child lags the parent's angular acceleration; linear acceleration tips it
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
        # blend the seam
        d = out[-1] - out[0]
        out = out - np.outer(np.linspace(0, 1, n), d)
    return out


# ------------------------------------------------------------------------------------------- baking
def bake_clip(solver, rig_ob, head_ob, clip, verbose=False):
    nfr = clip.frames()
    frames = np.arange(nfr + 1)
    times = frames / FPS
    ch = evaluate_clip(clip, times)
    base = rest_channels()
    names = solver.order
    loc = {n: np.zeros((len(frames), 3)) for n in names}
    rot = {n: np.zeros((len(frames), 4)) for n in names}
    scl = {n: np.ones((len(frames), 3)) for n in names}
    sk = {k: np.zeros(len(frames)) for k in SHAPE_KEYS}
    worlds = []
    for j, t in enumerate(times):
        c = dict(base)
        for k, arr in ch.items():
            c[k] = float(arr[j])
        W, B = solver.solve(c, t)
        worlds.append(W)
        for n in names:
            m = Matrix(B[n].tolist())
            l, q, s = m.decompose()
            if j > 0:
                pq = rot[n][j - 1]
                if pq[0] * q.w + pq[1] * q.x + pq[2] * q.y + pq[3] * q.z < 0:
                    q = -q
            loc[n][j] = l
            rot[n][j] = (q.w, q.x, q.y, q.z)
            scl[n][j] = s
        for k in SHAPE_KEYS:
            sk[k][j] = min(1.0, max(0.0, c['sk.' + k]))
    act = bpy.data.actions.new(clip.name)
    rig_ob.animation_data_create()
    rig_ob.animation_data.action = act
    for n in names:
        for path, arr, cnt in (('location', loc[n], 3), ('rotation_quaternion', rot[n], 4), ('scale', scl[n], 3)):
            for i in range(cnt):
                fc = act.fcurve_ensure_for_datablock(rig_ob, 'pose.bones["%s"].%s' % (n, path), index=i, group_name=n)
                fc.keyframe_points.add(len(frames))
                co = np.empty(len(frames) * 2)
                co[0::2] = frames
                co[1::2] = arr[:, i]
                fc.keyframe_points.foreach_set('co', co)
                fc.update()
    key = head_ob.data.shape_keys if head_ob is not None else None
    if key is not None:
        key.animation_data_create()
        key.animation_data.action = act
        for k in SHAPE_KEYS:
            if k not in key.key_blocks:
                continue
            fc = act.fcurve_ensure_for_datablock(key, 'key_blocks["%s"].value' % k, index=0)
            fc.keyframe_points.add(len(frames))
            co = np.empty(len(frames) * 2)
            co[0::2] = frames
            co[1::2] = sk[k]
            fc.keyframe_points.foreach_set('co', co)
            fc.update()
    # stash in NLA so the exporter finds every clip; clear active actions
    tr = rig_ob.animation_data.nla_tracks.new()
    tr.name = clip.name
    st = tr.strips.new(clip.name, 0, act)
    st.action_slot = rig_ob.animation_data.action_slot
    rig_ob.animation_data.action = None
    if key is not None:
        slot = key.animation_data.action_slot
        tr2 = key.animation_data.nla_tracks.new()
        tr2.name = clip.name
        st2 = tr2.strips.new(clip.name, 0, act)
        st2.action_slot = slot
        key.animation_data.action = None
    act.use_fake_user = True
    return dict(times=times, worlds=worlds, channels=ch)

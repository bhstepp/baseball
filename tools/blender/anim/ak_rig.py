# ak_rig.py - pose channels and the pose solver for the shared animation libraries.
# Adapted from rk_anim.Solver (Rocco's clips) with the rules of the shared libraries (docs/CAST-CONTRACT.md):
#   - rotations on every bone, translation only on root and hips: the IK never stretches a limb (an out-of-reach
#     target is clamped and reported), there is no bat, and no control-bone translation (cap, brows);
#   - hands can be aimed by a socket (grip.L/R: the centre of a closed grip; mitt: the pocket of the fielding mitt on
#     the left hand), with an absolute orientation (finger direction + palm normal) blended with the forearm-relative
#     one, and the wrist twist shared with the forearm;
#   - the skeleton comes from a glb (ak_skel), and authored positions are in "Rocco units" (hips at 1.70 ft) scaled by
#     U = hipHeight / 1.70 so the same clips re-solve on the reference body.
# Model space: Z up, the character faces -Y, his left is +X; feet; the root sits on the ground between the feet.
import math
import numpy as np

from ak_math import euler, M4, frame3, nrm, rot_axis, slerp_mat, orthonormal, quat_from_mat, D2R

SHAPE_KEYS = ['blink', 'smile', 'grin', 'frown', 'mouth_open', 'brows_up', 'brows_angry', 'brows_sad', 'squint', 'cheeks_puff',
              'smirk']
SIDES = ('L', 'R')
SX = {'L': 1.0, 'R': -1.0}
FINGERS = (('index', 'index_2'), ('middle', 'middle_2'), ('pinky', 'pinky_2'), ('thumb', 'thumb_2'))
POS_CHANNELS = ('hip.x', 'hip.y', 'hip.z')


def rest_channels(sk):
    """Default channel values: the rest pose (in authoring units)."""
    U = sk.U
    c = {'root.s': 1.0}
    for k in ('x', 'y', 'z', 'rx', 'ry', 'rz'):
        c['hip.' + k] = 0.0
    for b in ('spine', 'chest', 'neck', 'head', 'cap', 'eye', 'eyeL', 'eyeR', 'earL', 'earR', 'browL', 'browR', 'shL', 'shR'):
        for k in ('rx', 'ry', 'rz'):
            c[b + '.' + k] = 0.0
    c['jaw.rx'] = 0.0
    for k in ('rx', 'rz', 'curl'):
        c['tail.' + k] = 0.0
    for s in SIDES:
        w = sk.J['hand.' + s] / U
        c['hand%s.x' % s], c['hand%s.y' % s], c['hand%s.z' % s] = w
        for k in ('rx', 'ry', 'rz'):
            c['hand%s.%s' % (s, k)] = 0.0
        Rh = sk.R('hand.' + s)
        f, p = Rh[:, 1], Rh[:, 0] * (-SX[s])          # finger direction (bone Y), palm normal (-X left, +X right)
        c['hand%s.fx' % s], c['hand%s.fy' % s], c['hand%s.fz' % s] = f
        c['hand%s.px' % s], c['hand%s.py' % s], c['hand%s.pz' % s] = p
        c['hand%s.abs' % s] = 0.0       # 0: orientation from hand.rx/ry/rz relative to the forearm; 1: from f/p
        c['hand%s.rel' % s] = 0.0       # 1: target (and f/p, pole) given in the rest body frame, carried by the chest
        c['hand%s.relh' % s] = 0.0      # 1: target given in the rest head frame, carried by the head
        c['hand%s.sg' % s] = 0.0        # 1: the target is the grip socket (grip.L/R) instead of the wrist
        if s == 'L':
            c['handL.sm'] = 0.0         # 1: the target is the mitt pocket
        c['elbow%s.x' % s], c['elbow%s.y' % s], c['elbow%s.z' % s] = 0.0, 1.0, 0.0
        c['fing' + s] = 0.0
        c['thumb' + s] = 0.0
        c['spread' + s] = 0.0
        c['point' + s] = 0.0
        b = sk.J['toe.' + s] / U
        c['foot%s.x' % s], c['foot%s.y' % s], c['foot%s.z' % s] = b
        for k in ('rx', 'ry', 'rz'):
            c['foot%s.%s' % (s, k)] = 0.0
        c['toe%s.rx' % s] = 0.0
        kp = rest_pole(sk, 'thigh.' + s, 'shin.' + s, 'foot.' + s, (0.15 * SX[s], -1.0, 0.0))
        c['knee%s.x' % s], c['knee%s.y' % s], c['knee%s.z' % s] = kp
    for k in SHAPE_KEYS:
        c['sk.' + k] = 0.0
    return c


def rest_pole(sk, a, b, e, default):
    """Direction from the a-e line to joint b at rest (the limb's bend direction), or `default` for a straight limb."""
    A, B, E = sk.J[a], sk.J[b], sk.J[e]
    d = nrm(E - A)
    k = B - A
    perp = k - np.dot(k, d) * d
    if np.linalg.norm(perp) < 1e-3:
        return np.asarray(default, float)
    return nrm(perp)


def pole_frame(y, p):
    y = nrm(y)
    zz = np.asarray(p, float) - np.dot(p, y) * y
    z = nrm(zz) if np.linalg.norm(zz) > 1e-6 else nrm(np.cross([1, 0, 0], y))
    return np.stack([np.cross(y, z), y, z], 1)


def is_position(ch):
    if ch in POS_CHANNELS:
        return True
    head, _, tail = ch.partition('.')
    return tail in ('x', 'y', 'z') and (head.startswith('hand') or head.startswith('foot'))


class Solver:
    def __init__(self, sk, twist_share=0.5):
        self.sk = sk
        self.U = sk.U
        self.rest = sk.world
        self.parent = sk.parent
        self.order = sk.names
        self.twist_share = twist_share
        self.warn = []
        self.lr = {n: sk.local[n] for n in sk.names}
        # socket offsets (hand-local)
        self.sock = {}
        for s in SIDES:
            g = 'grip.' + s
            self.sock['grip' + s] = self.lr[g][:3, 3].copy() if sk.has(g) else np.zeros(3)
        self.sock['mitt'] = self.lr['mitt'][:3, 3].copy() if sk.has('mitt') else np.zeros(3)
        self.rest_rel = {n: (np.linalg.inv(self.rest[self.parent[n]]) @ self.rest[n]) if self.parent[n] else self.rest[n] for n in sk.names}
        # finger fan directions: +rotation about local Z fans the finger toward the index side?
        self.fspread = {}
        for s in SIDES:
            for a, b in FINGERS:
                nm = a + '.' + s
                if not sk.has(nm):
                    continue
                R1 = sk.R(nm)
                dy = R1 @ (rot_axis((0, 0, 1), 0.1) @ np.array([0, 1.0, 0]) - np.array([0, 1.0, 0]))
                self.fspread[nm] = 1.0 if np.dot(dy, [0, -1.0, 0]) > 0 else -1.0
        # each limb bone keeps its rest relation to the bend plane (so the default poles reproduce the rest pose)
        self.K = {}
        for s in SIDES:
            for (a, b, e, dflt) in (('upper_arm.' + s, 'forearm.' + s, 'hand.' + s, (0.0, 1.0, 0.0)),
                                    ('thigh.' + s, 'shin.' + s, 'foot.' + s, (0.15 * SX[s], -1.0, 0.0))):
                p0 = rest_pole(sk, a, b, e, dflt)
                for bn, nx in ((a, b), (b, e)):
                    F = pole_frame(sk.J[nx] - sk.J[bn], p0)
                    self.K[bn] = F.T @ sk.R(bn)
        self.limb = {}
        for s in SIDES:
            self.limb['arm' + s] = (sk.seg('upper_arm.' + s, 'forearm.' + s), sk.seg('forearm.' + s, 'hand.' + s))
            self.limb['leg' + s] = (sk.seg('thigh.' + s, 'shin.' + s), sk.seg('shin.' + s, 'foot.' + s))

    # ------------------------------------------------------------------------------------------- helpers
    def head_pos(self, W, name):
        p = self.parent[name]
        M = (W[p] @ self.rest_rel[name]) if p else self.rest[name]
        return M[:3, 3].copy()

    @staticmethod
    def rot_of(M):
        R = M[:3, :3]
        return R / np.linalg.norm(R, axis=0, keepdims=True)

    def solve(self, c, t=0.0):
        """Channels -> world matrices (model space, root squash NOT applied: bake() puts it on the root node only)."""
        sk, rest, U = self.sk, self.rest, self.U
        W = {}

        def fk(name, basis):
            if not sk.has(name):
                return
            p = self.parent[name]
            W[name] = (W[p] @ self.rest_rel[name] @ basis) if p else (self.rest[name] @ basis)

        def set_world(name, M):
            if sk.has(name):
                W[name] = M

        def fkm(name, E=None):
            """FK with a rotation given in model axes (about the bone's rest frame)."""
            if not sk.has(name):
                return
            Rr = rest[name][:3, :3]
            fk(name, M4(Rr.T @ (E if E is not None else np.eye(3)) @ Rr))

        def rel_delta(name, Rl):
            p = self.parent[name]
            Rp = self.rot_of(W[p]) @ rest[p][:3, :3].T
            set_world(name, M4(Rp @ Rl @ rest[name][:3, :3], self.head_pos(W, name)))

        g = lambda k: c[k]
        vec = lambda k: np.array([c[k + '.x'], c[k + '.y'], c[k + '.z']])
        eul = lambda k: euler(c[k + '.rx'], c[k + '.ry'], c[k + '.rz'])

        W['root'] = rest['root'].copy()
        Rr = rest['hips'][:3, :3]
        W['hips'] = W['root'] @ self.rest_rel['hips'] @ M4(Rr.T @ eul('hip') @ Rr)
        W['hips'][:3, 3] = sk.J['hips'] + vec('hip') * U
        fkm('spine', eul('spine'))
        fkm('chest', eul('chest'))
        fkm('neck', eul('neck'))
        fkm('head', eul('head'))
        fkm('jaw', euler(g('jaw.rx'), 0, 0))
        fkm('cap', eul('cap'))
        for sd in SIDES:
            fkm('eye.' + sd, euler(g('eye.rx') + g('eye%s.rx' % sd), 0, g('eye.rz') + g('eye%s.rz' % sd)))
            fkm('brow.' + sd, eul('brow' + sd))
            fkm('ear.' + sd, eul('ear' + sd))
        for i in range(1, 6):
            nm = 'tail.%d' % i
            if sk.has(nm):
                fk(nm, M4(euler(c.get('_tail%d.rx' % i, 0.0), c.get('_tail%d.ry' % i, 0.0), c.get('_tail%d.rz' % i, 0.0))))
        Rc = self.rot_of(W['chest']) @ rest['chest'][:3, :3].T
        Rhd = self.rot_of(W['head']) @ rest['head'][:3, :3].T
        # ---------------------------------------------------------------- arms
        for sd in SIDES:
            rel_delta('shoulder.' + sd, eul('sh' + sd))
            S = self.head_pos(W, 'upper_arm.' + sd)
            P = vec('hand' + sd) * U
            rel, relh = g('hand%s.rel' % sd), g('hand%s.relh' % sd)
            fdir = np.array([c['hand%s.fx' % sd], c['hand%s.fy' % sd], c['hand%s.fz' % sd]])
            pdir = np.array([c['hand%s.px' % sd], c['hand%s.py' % sd], c['hand%s.pz' % sd]])
            pole = vec('elbow' + sd)
            # world / chest-carried / head-carried targets, blended by weight (head wins over chest)
            wh = min(max(relh, 0.0), 1.0)
            wc = min(max(rel, 0.0), 1.0) * (1.0 - wh)
            ww = 1.0 - wh - wc
            if wh > 1e-4 or wc > 1e-4:
                Pc = W['chest'][:3, 3] + Rc @ (P - sk.J['chest'])
                Ph = W['head'][:3, 3] + Rhd @ (P - sk.J['head'])
                P = P * ww + Pc * wc + Ph * wh
                fdir = fdir * ww + (Rc @ fdir) * wc + (Rhd @ fdir) * wh
                pdir = pdir * ww + (Rc @ pdir) * wc + (Rhd @ pdir) * wh
                pole = pole * (ww + wh) + (Rc @ pole) * wc
            wabs = float(np.clip(g('hand%s.abs' % sd), 0, 1))
            Rh_rest = rest['hand.' + sd][:3, :3]
            f0, p0 = Rh_rest[:, 1], Rh_rest[:, 0] * (-SX[sd])
            Rabs = frame3(fdir, pdir) @ frame3(f0, p0).T @ Rh_rest if wabs > 1e-4 else None
            off = self.sock['grip' + sd] * g('hand%s.sg' % sd)
            if sd == 'L':
                off = off + self.sock['mitt'] * g('handL.sm')
            # a socket target: the wrist goes where the socket lands on the target (the hand's rotation depends on
            # the arm when it is forearm-relative, so iterate a few times)
            wrist = P.copy()
            Rt = None
            has_off = np.linalg.norm(off) > 1e-6
            for it in range(5 if has_off else 1):
                self._ik2(W, 'upper_arm.' + sd, 'forearm.' + sd, S, wrist, pole, tag='arm' + sd, t=t, report=False)
                Rfa = self.rot_of(W['forearm.' + sd]) @ rest['forearm.' + sd][:3, :3].T
                Rfree = Rfa @ Rh_rest @ eul('hand' + sd)
                Rt = Rfree if Rabs is None else (Rabs if wabs >= 1 - 1e-4 else slerp_mat(Rfree, Rabs, wabs))
                if not has_off:
                    break
                wrist = P - Rt @ off
            self._ik2(W, 'upper_arm.' + sd, 'forearm.' + sd, S, wrist, pole, tag='arm' + sd, t=t, report=True)
            Wr = W['forearm.' + sd] @ self.rest_rel['hand.' + sd]
            # share the wrist twist with the forearm (roll about its long axis; the elbow stays put)
            Wf = W['forearm.' + sd]
            Rf_ = self.rot_of(Wf)
            Lr_h = self.rest_rel['hand.' + sd][:3, :3]
            D = Rf_.T @ Rt @ Lr_h.T
            q = quat_from_mat(orthonormal(D))
            tw = 2 * math.atan2(q[2], q[0])
            if tw > math.pi:
                tw -= 2 * math.pi
            if tw < -math.pi:
                tw += 2 * math.pi
            if abs(tw) > 1e-4 and self.twist_share > 0:
                Wf2 = Wf.copy()
                Wf2[:3, :3] = Rf_ @ rot_axis((0, 1, 0), tw * self.twist_share)
                W['forearm.' + sd] = Wf2
                Wr = Wf2 @ self.rest_rel['hand.' + sd]
            set_world('hand.' + sd, M4(Rt, Wr[:3, 3]))
            self._hand_shape(c, sd, fk)
            fk('grip.' + sd, np.eye(4))
            if sd == 'L':
                fk('mitt', np.eye(4))
        # ---------------------------------------------------------------- legs
        for sd in SIDES:
            Rf = euler(0, 0, g('foot%s.rz' % sd)) @ euler(g('foot%s.rx' % sd), g('foot%s.ry' % sd), 0)
            ball = vec('foot' + sd) * U
            ankle_t = ball + Rf @ (sk.J['foot.' + sd] - sk.J['toe.' + sd])
            H = self.head_pos(W, 'thigh.' + sd)
            self._ik2(W, 'thigh.' + sd, 'shin.' + sd, H, ankle_t, vec('knee' + sd), tag='leg' + sd, t=t, report=True)
            A = (W['shin.' + sd] @ self.rest_rel['foot.' + sd])[:3, 3]
            set_world('foot.' + sd, M4(Rf @ rest['foot.' + sd][:3, :3], A))
            Rt_ = euler(0, 0, g('foot%s.rz' % sd)) @ euler(g('toe%s.rx' % sd), g('foot%s.ry' % sd), 0)
            Tp = (W['foot.' + sd] @ self.rest_rel['toe.' + sd])[:3, 3]
            set_world('toe.' + sd, M4(Rt_ @ rest['toe.' + sd][:3, :3], Tp))
        # anything else (bones this solver does not know): rest relation to the parent
        for n in self.order:
            if n not in W:
                p = self.parent[n]
                W[n] = (W[p] @ self.rest_rel[n]) if p else self.rest[n].copy()
        return W

    def _hand_shape(self, c, s, fk):
        curl, th, sp, pt = c['fing' + s], c['thumb' + s], c['spread' + s], c['point' + s]
        fan = {'index': 11.0, 'middle': 1.5, 'pinky': -13.0}
        for a, b in FINGERS:
            A_, B_ = a + '.' + s, b + '.' + s
            if a == 'thumb':
                if th >= 0:      # tuck across the palm
                    R1 = rot_axis((1, 0, 0), th * 38 * D2R) @ rot_axis((0, 0, 1), -th * 10 * D2R * self.fspread.get(A_, 1))
                    R2 = rot_axis((1, 0, 0), th * 50 * D2R)
                else:            # stick out
                    R1 = rot_axis((0, 0, 1), -th * 26 * D2R * self.fspread.get(A_, 1)) @ rot_axis((1, 0, 0), th * 18 * D2R)
                    R2 = rot_axis((1, 0, 0), th * 14 * D2R)
            else:
                cv = curl * ((1.0 - pt) if a == 'index' else 1.0) - (0.25 * pt if a == 'index' else 0.0)
                if cv >= 0:
                    R1 = rot_axis((1, 0, 0), cv * 72 * D2R)
                    R2 = rot_axis((1, 0, 0), cv * 88 * D2R)
                else:
                    R1 = rot_axis((1, 0, 0), cv * 22 * D2R)
                    R2 = rot_axis((1, 0, 0), cv * 16 * D2R)
                if abs(sp) > 1e-6:
                    R1 = rot_axis((0, 0, 1), sp * fan[a] * D2R * self.fspread.get(A_, 1)) @ R1
            fk_name = 'fingers.' + s
            if a == 'index':
                fk(fk_name, M4(rot_axis((1, 0, 0), 10.0 * max(curl, 0.0) * D2R)))
            fk(A_, M4(R1))
            fk(B_, M4(R2))

    def _ik2(self, W, b1, b2, S, T, pole, tag='', t=0.0, report=True):
        a, b = self.limb[tag]
        dvec = T - S
        dist = float(np.linalg.norm(dvec))
        reach = (a + b) * 0.9995
        if dist > reach and report:
            over = dist - reach
            if over > 0.015:
                self.warn.append((tag, round(t, 3), round(over, 3)))
        dist = min(dist, reach)
        dist = max(dist, abs(a - b) + 1e-4)
        dn = nrm(dvec)
        x = (a * a - b * b + dist * dist) / (2 * dist)
        h = math.sqrt(max(a * a - x * x, 0.0))
        pn = np.asarray(pole, float) - np.dot(pole, dn) * dn
        if np.linalg.norm(pn) < 1e-6:
            pn = np.cross(dn, [1, 0, 0])
        pn = nrm(pn)
        E = S + dn * x + pn * h
        Tr = S + dn * dist
        for bone, p0, p1 in ((b1, S, E), (b2, E, Tr)):
            W[bone] = M4(pole_frame(p1 - p0, pn) @ self.K[bone], p0)

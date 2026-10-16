# lib_fielder.py - the fielder library (docs/CAST-CONTRACT.md): f_ready (loop), f_idle (loop: glove punch, cap
# adjust), f_run (loop; planted feet move at a constant ground speed, given in the sidecar), f_catch_fly (pocket at a
# head-high catch point at the 'catch' marker), f_catch_dive, f_field_grounder (the mitt scoops at ground level at
# the marker), f_throw (release at the marker), f_celebrate, f_tag, f_slump (watching a homer go over).
# Model space: Z up, he faces -Y, his left is +X (the mitt is on the left hand). The runtime yaws and moves him along
# play.fielderAt paths; seen in the field view at 30-60 px, so silhouettes are big and simple.
import math
import numpy as np

import ak_pose as PZ
from ak_pose import P, put, V, foot, hand, orient, free, hshape, face, look_at, turn_pose, J
from ak_clip import Clip
from ak_math import euler, nrm, smooth
from ak_lib import solved, where, at_sh, at_shw, at_hip, foot_at_ankle, lerp_keys

BATTER = np.array([0.0, -120.0, 3.0])        # looking in toward home from the field
BRIM_R = np.array([-0.43, -0.76, 4.45])


# ------------------------------------------------------------------------------------------- poses
def ready_pose():
    """READY: athletic crouch, feet wide on the balls of the feet, hands out low in front, mitt open, eyes on the
    batter."""
    c = PZ.base()
    put(c, hip__y=0.10, hip__z=-0.36, hip__rx=26, spine__rx=8, chest__rx=0)
    foot(c, 'L', (0.62, -0.32, 0.12), rz=14, rx=10, toe=-8, knee=(0.5, -1, 0.1))
    foot(c, 'R', (-0.62, -0.32, 0.12), rz=-14, rx=10, toe=-8, knee=(-0.5, -1, 0.1))
    hand(c, 'L', (0.45, -1.25, 1.40), sock='mitt', elbow=(1, 0.5, -0.2))
    orient(c, 'L', (0.2, -0.6, -0.6), (0.0, -1.0, 0.4), 0.8)
    hshape(c, 'L', 'mitt_open', 0.6)
    hand(c, 'R', (-0.40, -1.20, 1.35), elbow=(-1, 0.5, -0.2))
    orient(c, 'R', (-0.2, -0.6, -0.6), (0.0, -1.0, 0.4), 0.6)
    hshape(c, 'R', 'relaxed')
    put(c, tail__rx=10)
    look_at(c, BATTER, tilt=0)
    face(c, squint=0.3, brows_angry=0.3)
    return c


def stand_pose():
    c = PZ.base()
    put(c, hip__x=-0.04, hip__z=-0.05, hip__ry=-2, chest__ry=1.5)
    foot(c, 'L', (0.46, -0.30, 0.11), rz=14, knee=(0.3, -1, 0))
    foot(c, 'R', (-0.42, -0.24, 0.11), rz=-12, knee=(-0.25, -1, 0))
    hand(c, 'L', (0.66, -0.25, 1.90), sock='mitt', rel=1, elbow=(1, 0.4, 0))
    orient(c, 'L', (0.2, -0.3, -1.0), (-1.0, 0.0, 0.0), 0.6)
    hand(c, 'R', (-0.64, -0.10, 1.85), rel=1, elbow=(-1, 0.4, 0))
    hshape(c, 'R', 'relaxed')
    look_at(c, BATTER, tilt=0)
    face(c, smile=0.2)
    return c


def ready():
    L = 1.2
    c = Clip('f_ready', L, loop=True)
    R = ready_pose()
    c.key(0.0, R)
    a = P(R)                                  # a little bounce on the balls of his feet, weight rocking
    put(a, hip__z=-0.40, hip__x=0.04)
    c.key(0.3, a)
    b = P(R)
    put(b, hip__z=-0.33, root__s=1.01)
    c.key(0.6, b)
    d = P(R)
    put(d, hip__z=-0.40, hip__x=-0.04)
    c.key(0.9, d)
    c.key(L, R)
    c.layers.append(PZ.breathing(L, 1, 0.6))
    c.meta = {'from': 'READY', 'to': 'READY', 'ball': [[None, 0.0]]}
    return c


def idle():
    """Between pitches: punches the mitt pocket twice, tugs his cap brim, shifts his weight, looks around."""
    L = 3.2
    c = Clip('f_idle', L, loop=True)
    S = stand_pose()
    c.key(0.0, S)
    g = P(S)                                  # mitt up in front of the chest
    hand(g, 'L', (0.20, -0.85, 2.55), sock='mitt', rel=1, elbow=(1, 0.3, -0.6))
    orient(g, 'L', (-0.4, -0.2, 0.9), (-0.9, 0.2, 0.0))
    hshape(g, 'L', 'mitt_open', 0.5)
    hand(g, 'R', (-0.45, -0.70, 2.40), rel=1, elbow=(-1, 0.4, -0.4))
    hshape(g, 'R', 'fist')
    c.key(0.30, g)
    for t, dd in ((0.45, 0.0), (0.55, 1.0), (0.68, 0.0), (0.78, 1.0), (0.92, 0.0)):
        k = P(g)
        W = solved(k)
        m = where(k, 'mitt', W)
        Rc = W['chest'][:3, :3] @ PZ.SK.R('chest').T
        fist = m + Rc @ np.array([-0.30 + 0.20 * dd, -0.10, 0.02])
        hand(k, 'R', fist, sock='grip', elbow=(-1, 0.4, -0.4))
        orient(k, 'R', (0.9, -0.2, 0.2), (1.0, 0.0, 0.0), 0.6)
        hshape(k, 'R', 'fist')
        put(k, hip__z=-0.05 - 0.02 * dd)
        c.key(t, k)
    k = P(S)                                  # the cap tug
    hand(k, 'R', BRIM_R + np.array([-0.08, 0.25, -0.34]), relh=1, elbow=(-1.0, 0.1, -0.2))
    orient(k, 'R', (0.4, -0.5, 0.3), (0.0, 0.2, -1.0), 0.5)
    hshape(k, 'R', 'tip')
    put(k, cap__rx=6, head__rx=8)
    c.key(1.35, k)
    k2 = P(k)
    put(k2, cap__rx=-3, head__rx=-2)
    c.key(1.55, k2)
    s1 = P(S)                                 # shifts his weight, looks around
    put(s1, hip__x=0.05, hip__ry=3, chest__ry=-2, chest__rz=6)
    look_at(s1, np.array([-60.0, -60.0, 8.0]), tilt=0)
    c.key(2.1, s1)
    s2 = P(S)
    look_at(s2, np.array([50.0, -80.0, 6.0]), tilt=0)
    c.key(2.65, s2)
    c.key(L, S)
    c.layers.append(PZ.breathing(L, 2, 0.8))
    c.layers.append(PZ.blink_at([1.0, 2.4]))
    c.meta = {'from': 'STAND', 'to': 'STAND', 'ball': [[None, 0.0]]}
    return c


# ------------------------------------------------------------------------------------------- run cycle
# One leg's cycle (contact at phase 0, after rk_clips' run): the stance is planned on the ground (the ball of the foot
# slides straight back at a constant speed: heel strike -> flat -> heel rise -> toe-off), the swing in joint-angle
# space so the foot travels on arcs (heel kick, fold under the seat, knee drive, reach, paw back to contact).
SOLE_PTS = [np.array(p) for p in ((0, 0.64, -0.11), (0, 0.40, -0.11), (0, 0.0, -0.11), (0, -0.40, -0.09), (0, -0.46, -0.04))]
RUN = dict(L=0.45, LEAN=22.0, SIDE=0.30, TOEOFF=0.32, Y0=-0.78, Y1=0.86,
           STANCE_RX=[(0.0, -16), (0.08, 0), (0.15, 4), (0.24, 24), (0.32, 50)],
           SWING=[(0.36, -24, 64, 8), (0.43, -14, 92, 30), (0.51, 0, 118, 12), (0.61, 16, 126, -22), (0.70, 32, 122, -42),
                  (0.79, 48, 98, -40), (0.88, 52, 48, -25)])


def run_hz(ph):
    return -0.10 + 0.09 * math.cos(4 * math.pi * (ph - 0.40))


def _sole_lift(rx):
    R = euler(rx, 0, 0)
    return -min((R @ q)[2] for q in SOLE_PTS)


def _catmull(keys, x):
    n = len(keys)
    i = 0
    while i < n - 2 and x > keys[i + 1][0]:
        i += 1
    p0, p1, p2, p3 = keys[max(i - 1, 0)], keys[i], keys[i + 1], keys[min(i + 2, n - 1)]
    h = p2[0] - p1[0]
    u = min(max((x - p1[0]) / h, 0.0), 1.0)
    out = []
    for k in range(1, len(p1)):
        m1 = (p2[k] - p0[k]) / (p2[0] - p0[0]) * h if p2[0] != p0[0] else 0.0
        m2 = (p3[k] - p1[k]) / (p3[0] - p1[0]) * h if p3[0] != p1[0] else 0.0
        out.append((2 * u ** 3 - 3 * u ** 2 + 1) * p1[k] + (u ** 3 - 2 * u ** 2 + u) * m1 + (-2 * u ** 3 + 3 * u ** 2) * p2[k] + (u ** 3 - u ** 2) * m2)
    return out


class RunLeg:
    def __init__(self, side):
        self.sd = side
        self.TL = float(np.linalg.norm(J('shin.' + side) - J('thigh.' + side)))
        self.SL = float(np.linalg.norm(J('foot.' + side) - J('shin.' + side)))
        self.A2B = J('toe.' + side) - J('foot.' + side)
        self.A2B[0] = 0.0

    def hip(self, ph):
        hipp = J('hips') + np.array([0, 0, run_hz(ph % 1.0)])
        H = hipp + euler(RUN['LEAN'], 0, 0) @ (J('thigh.' + self.sd) - J('hips'))
        return np.array([0.0, H[1], H[2]])

    def fk(self, H, th, ka, p):
        t, s_ = math.radians(th), math.radians(th - ka)
        K = H + self.TL * np.array([0, -math.sin(t), -math.cos(t)])
        A = K + self.SL * np.array([0, -math.sin(s_), -math.cos(s_)])
        rx = ka - th + p
        return A + euler(rx, 0, 0) @ self.A2B, rx

    def ik(self, H, ball, rx):
        A = ball - euler(rx, 0, 0) @ self.A2B
        d = A - H
        L = min(float(np.linalg.norm(d)), self.TL + self.SL - 1e-6)
        phi = math.atan2(-d[1], -d[2])
        a = math.acos(max(-1.0, min(1.0, (self.TL ** 2 + L * L - self.SL ** 2) / (2 * self.TL * L))))
        k = math.acos(max(-1.0, min(1.0, (self.TL ** 2 + self.SL ** 2 - L * L) / (2 * self.TL * self.SL))))
        th, ka = math.degrees(phi + a), 180.0 - math.degrees(k)
        return th, ka, rx - (ka - th)

    def ground(self, y, rx):
        return np.array([0.0, y, _sole_lift(rx)])

    def at(self, ph):
        ph %= 1.0
        T0 = RUN['TOEOFF']
        if ph <= T0:
            rx = _catmull(RUN['STANCE_RX'], ph)[0]
            return self.ground(RUN['Y0'] + (RUN['Y1'] - RUN['Y0']) * ph / T0, rx), rx
        rx0, rx1 = RUN['STANCE_RX'][-1][1], RUN['STANCE_RX'][0][1]
        k0 = (T0,) + self.ik(self.hip(T0), self.ground(RUN['Y1'], rx0), rx0)
        k1 = (1.0,) + self.ik(self.hip(1.0), self.ground(RUN['Y0'], rx1), rx1)
        th, ka, p = _catmull([k0] + RUN['SWING'] + [k1], ph)
        b, rx = self.fk(self.hip(ph), th, ka, p)
        b[2] = max(b[2], _sole_lift(rx))
        return b, rx


def ground_speed():
    """ft/s (reference build, timeScale 1) at which the planted foot is still on the ground."""
    return (RUN['Y1'] - RUN['Y0']) / (RUN['TOEOFF'] * RUN['L'])


def run():
    """Sprint, two strides per loop, in place: forward lean, pelvis leads the forward leg, shoulders counter-rotate,
    the mitt hand and the bare fist pump from the chin to behind the hip."""
    L = RUN['L']
    c = Clip('f_run', L, loop=True)
    b0 = stand_pose()
    put(b0, hip__x=0.0, hip__ry=0.0, chest__ry=0.0, hip__rx=RUN['LEAN'], spine__rx=6, chest__rx=6, neck__rx=-12, head__rx=-16,
        tail__rx=-26, tail__curl=-6)
    face(b0, brows_angry=0.5, squint=0.2, mouth_open=0.15, grin=0.3)
    legs = {'L': RunLeg('L'), 'R': RunLeg('R')}
    n = 20
    for k in range(n + 1):
        ph = k / n
        q = P(b0)
        for side, sg, off in (('L', 1, 0.0), ('R', -1, 0.5)):
            ball, rx = legs[side].at(ph + off)
            lp = (ph + off) % 1.0
            tb = -0.45 * max(rx - 5, 0) if lp <= RUN['TOEOFF'] else -0.45 * 45 * max(0.0, 1 - (lp - RUN['TOEOFF']) / 0.08)
            foot(q, side, (sg * RUN['SIDE'], ball[1], ball[2]), rx=rx, toe=tb, knee=(0.05 * sg, -1, 0.3))
            fwd = 0.5 - 0.5 * math.cos(2 * math.pi * (ph + off))
            fs = fwd * fwd * (3 - 2 * fwd)
            hand(q, side, (sg * (0.52 - 0.14 * fs), 0.50 - 1.18 * fs, 1.98 + 0.84 * fs), rx=-35 - 40 * fs, rel=1,
                 sock='mitt' if side == 'L' else None, elbow=(0.35 * sg, 1.0, -0.7 + 0.6 * fs))
            if side == 'L':
                orient(q, 'L', (0.0, -0.35 - 0.5 * fs, 1.0), (-1.0, 0.1, 0.0), 0.6)
            else:
                free(q, 'R')
                hshape(q, 'R', 'fist', 0.8)
        cy = math.cos(2 * math.pi * ph)
        put(q, hip__z=run_hz(ph), hip__rz=-10 * cy, chest__rz=16 * cy, hip__ry=-3 * math.sin(2 * math.pi * ph),
            head__rz=-5 * cy, neck__rx=-12 + 3 * math.cos(4 * math.pi * (ph - 0.40)))
        c.key(ph * L, q)
    c.tail_lag = 0.03

    def stream(t):
        a = 2 * math.pi * t / L
        return {'tail.rz': 12 * math.sin(a), 'tail.rx': 4 * math.sin(2 * a), 'earL.rx': -24, 'earR.rx': -24}
    c.layers.append(stream)
    c.sec_gain = 0.7
    c.meta = {'from': 'RUN', 'to': 'RUN', 'ball': [[None, 0.0]]}
    return c


# ------------------------------------------------------------------------------------------- plays
def catch_fly():
    """Settles under a fly: drifts in (a couple of short steps), both hands up, the mitt pocket at the head-high catch
    point at the 'catch' marker, the squeeze (squash), brings it down to the chest and looks in."""
    L = 1.4
    T = 0.55
    c = Clip('f_catch_fly', L)
    R = ready_pose()
    a = P(R)                                  # tracking it, up out of the crouch
    put(a, hip__z=-0.20, hip__rx=8, chest__rx=-8)
    W = solved(a)
    hand(a, 'L', at_shw(a, 'L', (0.10, -0.70, -0.80), W), sock='mitt', elbow=(1, 0.5, -0.2))
    hand(a, 'R', at_shw(a, 'R', (-0.10, -0.70, -0.85), W), elbow=(-1, 0.5, -0.2))
    look_at(a, np.array([0.3, -12.0, 40.0]), tilt=0)
    face(a, brows_up=0.4, squint=0.3)
    c.key(0.0, a)
    s1 = P(a)                                 # a little settling step
    foot(s1, 'L', (0.55, -0.55, 0.30), rz=10, rx=-10)
    put(s1, hip__y=-0.10)
    c.key(0.16, s1)
    u = P(s1)                                 # arms up, calling for it
    foot(u, 'L', (0.50, -0.70, 0.11), rz=10)
    put(u, hip__y=-0.25, hip__z=-0.08, chest__rx=-12, hip__rx=4, root__s=1.05)
    foot(u, 'R', PZ.get(u, 'footR'), rz=u['footR.rz'], rx=14, toe=-10)
    W = solved(u)
    pk = np.array([0.78, -0.62, 4.05])
    hand(u, 'L', pk + np.array([0.05, 0.10, -0.35]), sock='mitt', elbow=(1, 0.3, -0.3))
    orient(u, 'L', (0.0, -0.4, 1.0), (0.0, -0.3, 1.0))
    hshape(u, 'L', 'mitt_open', 1.0)
    hand(u, 'R', pk + np.array([-0.55, 0.05, -0.30]), elbow=(-1, 0.3, -0.3))
    orient(u, 'R', (0.1, -0.3, 1.0), (0.4, -0.2, 1.0), 0.6)
    hshape(u, 'R', 'open', 0.6)
    look_at(u, pk + np.array([0, -3.0, 8.0]), tilt=0)
    face(u, brows_up=0.6, mouth_open=0.3)
    c.key(0.36, u)
    k = P(u)                                  # CATCH: pocket at the catch point
    hand(k, 'L', pk, sock='mitt', elbow=(1, 0.3, -0.3))
    hand(k, 'R', pk + np.array([-0.40, 0.06, -0.14]), elbow=(-1, 0.3, -0.3))
    look_at(k, pk + np.array([0, -1.0, 0.6]), tilt=0)
    c.key(T, k, mode='lin')
    sq = P(k)                                 # the squeeze: the mitt gives, a squash
    hand(sq, 'L', pk + np.array([0.0, 0.18, -0.25]), sock='mitt', elbow=(1, 0.3, -0.3))
    hshape(sq, 'L', 'mitt_shut', 1.0)
    hand(sq, 'R', pk + np.array([-0.46, 0.14, -0.22]), elbow=(-1, 0.3, -0.3))
    put(sq, root__s=0.96, hip__z=-0.22)
    face(sq, squint=0.6, grin=0.4)
    c.key(0.63, sq)
    d = P(R)                                  # brings it down to the chest, looks in
    put(d, hip__z=-0.18, hip__rx=10, chest__rx=0, root__s=1.0, hip__y=-0.25)
    foot(d, 'L', (0.50, -0.70, 0.11), rz=10)
    hand(d, 'L', (0.25, -0.85, 2.45), sock='mitt', rel=1, elbow=(1, 0.3, -0.6))
    orient(d, 'L', (-0.4, -0.3, 0.8), (-0.9, 0.3, 0.0))
    hshape(d, 'L', 'mitt_shut', 1.0)
    hand(d, 'R', (-0.10, -0.85, 2.45), rel=1, elbow=(-1, 0.4, -0.5))
    face(d, smirk=0.6, squint=0.3)
    c.key(0.95, d)
    c.key(L, P(d), mode='stop')
    c.markers = {'catch': T}
    c.meta = {'from': 'READY (tracking)', 'to': 'ball in the mitt at the chest', 'ball': [[None, 0.0], ['mitt', T]]}
    return c


def catch_dive():
    """The diving catch to his glove side: two hard steps, launches out flat with the mitt stretched ahead, the ball in
    the pocket at the 'catch' marker while airborne, a belly-flop slide, then he holds the mitt up from the dirt."""
    L = 1.7
    T = 0.425
    c = Clip('f_catch_dive', L)
    R = ready_pose()
    c.key(0.0, R)
    a = P(R)                                  # crossover step, loading
    put(a, hip__x=0.35, hip__z=-0.50, hip__rz=40, hip__rx=24, chest__rz=10, root__s=0.95)
    foot(a, 'R', (0.30, -0.25, 0.12), rz=50, rx=20)
    foot(a, 'L', (1.05, -0.20, 0.12), rz=70)
    look_at(a, np.array([12.0, -4.0, 2.0]))
    face(a, brows_angry=0.8, squint=0.5)
    c.key(0.14, a)
    l_ = P(a)                                 # launch: body stretches out toward his left
    put(l_, hip__x=1.10, hip__z=-0.30, hip__rz=90, hip__ry=0, hip__rx=60, spine__rx=10, chest__rx=4, root__s=1.06)
    W = solved(l_)
    foot_at_ankle(l_, 'L', at_hip(l_, 'L', (0.0, 0.25, -1.00), W), rz=90, rx=45, toe=-20, knee=(0, -0.3, -1))
    foot_at_ankle(l_, 'R', at_hip(l_, 'R', (0.0, 0.55, -0.85), W), rz=90, rx=-30, knee=(0, -0.3, -1))
    W = solved(l_)
    hand(l_, 'L', at_shw(l_, 'L', (1.15, -0.20, 0.30), W), sock='mitt', elbow=(0, 1, 0.3))
    orient(l_, 'L', (1.0, 0.0, 0.2), (0.0, -1.0, 0.3))
    hshape(l_, 'L', 'mitt_open', 1.0)
    hand(l_, 'R', at_shw(l_, 'R', (0.60, 0.40, 0.20), W), elbow=(0, 1, 0))
    hshape(l_, 'R', 'jazz')
    look_at(l_, np.array([20.0, -1.0, 1.5]))
    face(l_, brows_up=0.6, mouth_open=0.6)
    c.key(0.26, l_)
    f = P(l_)                                 # flying flat: the CATCH at the marker
    put(f, hip__x=2.10, hip__z=-0.55, hip__rz=90, hip__rx=82, spine__rx=4, chest__rx=-6, neck__rx=-20, root__s=1.04)
    W = solved(f)
    foot_at_ankle(f, 'L', at_hip(f, 'L', (0.0, 0.35, -1.00), W), rz=90, rx=-70, knee=(0, 0, 1))
    foot_at_ankle(f, 'R', at_hip(f, 'R', (0.0, 0.60, -0.80), W), rz=90, rx=-75, knee=(0, 0, 1))
    W = solved(f)
    pk = at_shw(f, 'L', (1.30, -0.15, 0.10), W)
    hand(f, 'L', pk, sock='mitt', elbow=(0, 0.3, 1))
    orient(f, 'L', (1.0, 0.0, 0.05), (0.0, -1.0, 0.2))
    hand(f, 'R', at_shw(f, 'R', (1.00, -0.20, 0.20), W), elbow=(0, 0.3, 1))
    look_at(f, pk + np.array([2.0, 0, 0]))
    face(f, brows_up=0.8, mouth_open=0.4, squint=0.2)
    c.key(T, f, mode='lin')
    b = P(f)                                  # belly flop (squash), sliding on
    put(b, hip__x=2.85, hip__z=-1.10, hip__rx=88, root__s=0.92, chest__rx=-10, neck__rx=-28)
    W = solved(b)
    foot_at_ankle(b, 'L', at_hip(b, 'L', (0.0, 0.30, -1.05), W), rz=90, rx=-80, knee=(0, 0, 1))
    foot_at_ankle(b, 'R', at_hip(b, 'R', (0.0, 0.55, -0.90), W), rz=90, rx=-80, knee=(0, 0, 1))
    W = solved(b)
    hand(b, 'L', at_shw(b, 'L', (1.30, -0.10, 0.05), W), sock='mitt', elbow=(0, 0.3, 1))
    hshape(b, 'L', 'mitt_shut', 1.0)
    face(b, squint=0.9, frown=0.4)
    c.key(0.58, b)
    s_ = P(b)
    put(s_, hip__x=3.15, root__s=1.0)
    W = solved(s_)
    foot_at_ankle(s_, 'L', at_hip(s_, 'L', (0.0, 0.30, -1.05), W), rz=90, rx=-80, knee=(0, 0, 1))
    foot_at_ankle(s_, 'R', at_hip(s_, 'R', (0.0, 0.55, -0.90), W), rz=90, rx=-80, knee=(0, 0, 1))
    W = solved(s_)
    hand(s_, 'L', at_shw(s_, 'L', (1.30, -0.10, 0.05), W), sock='mitt', elbow=(0, 0.3, 1))
    c.key(0.85, s_)
    up = P(s_)                                # holds the mitt up from the dirt: "got it!"
    put(up, chest__rx=-24, neck__rx=-20)
    W = solved(up)
    hand(up, 'L', at_shw(up, 'L', (0.55, -0.20, 1.10), W), sock='mitt', elbow=(0.3, 0.3, 1))
    orient(up, 'L', (0.0, 0.0, 1.0), (0.0, -1.0, 0.0))
    look_at(up, np.array([10.0, -40.0, 4.0]))
    face(up, grin=1.0, brows_up=0.5)
    c.key(1.15, up)
    c.key(L, P(up), mode='stop')
    c.markers = {'catch': T}
    c.meta = {'from': 'READY', 'to': 'lying on his belly, mitt up', 'ball': [[None, 0.0], ['mitt', T]],
              'note': 'the hips travel about 3 ft to his left (+X) and end on the ground; the runtime moves the root'}
    return c


def field_grounder():
    """Charges a step, gets down low (squash), the mitt open on the ground in front with the bare hand over it: the
    scoop at the 'catch' marker, the transfer to the throwing hand, up to throw (ends in THROW, f_throw's start)."""
    L = 1.1
    T = 0.40
    c = Clip('f_field_grounder', L)
    R = ready_pose()
    c.key(0.0, R)
    a = P(R)                                  # creeps in: a short step with the left foot
    foot(a, 'L', (0.55, -0.80, 0.25), rz=14, rx=-10)
    put(a, hip__y=-0.15, hip__z=-0.30)
    c.key(0.14, a)
    d = P(R)                                  # down: wide, low, mitt open on the dirt
    put(d, hip__y=-0.30, hip__z=-0.80, hip__rx=40, spine__rx=14, chest__rx=10, root__s=0.96)
    foot(d, 'L', (0.70, -1.05, 0.12), rz=20, knee=(0.7, -1, 0.2))
    foot(d, 'R', (-0.70, -0.30, 0.14), rz=-20, rx=20, toe=-12, knee=(-0.7, -1, 0.2))
    gp = np.array([0.10, -1.50, 0.22])
    hand(d, 'L', gp + np.array([0.0, -0.05, 0.10]), sock='mitt', elbow=(1, 0.3, 0.6))
    orient(d, 'L', (0.0, -1.0, -0.2), (0.0, -0.6, 1.0))
    hshape(d, 'L', 'mitt_open', 1.0)
    hand(d, 'R', gp + np.array([-0.15, 0.10, 0.45]), elbow=(-1, 0.3, 0.6))
    orient(d, 'R', (0.0, -1.0, -0.4), (0.0, 0.0, -1.0), 0.7)
    hshape(d, 'R', 'open', 0.5)
    look_at(d, gp + np.array([0, -2.0, 0.0]))
    face(d, squint=0.6, brows_angry=0.6)
    c.key(0.30, d)
    k = P(d)                                  # SCOOP: the pocket on the ground
    hand(k, 'L', gp, sock='mitt', elbow=(1, 0.3, 0.6))
    hand(k, 'R', gp + np.array([-0.12, 0.05, 0.30]), elbow=(-1, 0.3, 0.6))
    c.key(T, k, mode='lin')
    k2 = P(k)                                 # the scoop comes up the shins
    put(k2, hip__z=-0.72, hip__rx=34)
    hand(k2, 'L', gp + np.array([0.0, 0.45, 0.55]), sock='mitt', elbow=(1, 0.3, 0.4))
    hand(k2, 'R', gp + np.array([-0.12, 0.45, 0.75]), elbow=(-1, 0.3, 0.4))
    hshape(k2, 'L', 'mitt_shut', 0.8)
    c.key(0.48, k2)
    u = P(k)                                  # gathers it to the belly
    put(u, hip__z=-0.55, hip__rx=24, spine__rx=8, chest__rx=4, root__s=1.0)
    hand(u, 'L', PZ.chest_point(u, (0.15, -0.75, 1.90)), sock='mitt', elbow=(1, 0.3, -0.4))
    orient(u, 'L', (-0.5, -0.3, 0.6), (-0.8, 0.3, 0.0))
    hshape(u, 'L', 'mitt_shut', 1.0)
    hand(u, 'R', PZ.chest_point(u, (-0.05, -0.80, 1.95)), sock='grip', elbow=(-1, 0.4, -0.4))
    hshape(u, 'R', 'ball')
    look_at(u, np.array([0.0, -60.0, 4.0]))
    c.key(0.58, u)
    c.key(0.80, P(u))
    Tp = throw_start_pose()
    c.key(L, Tp, mode='stop')
    c.markers = {'catch': T}
    c.meta = {'from': 'READY', 'to': 'THROW', 'ball': [[None, 0.0], ['mitt', T], ['grip.R', 0.70]]}
    return c


def throw_start_pose():
    """THROW: square to the target (-Y), ball in the right hand at the chest, mitt beside it."""
    c = PZ.base()
    put(c, hip__z=-0.14, hip__rx=8, chest__rx=0)
    foot(c, 'L', (0.45, -0.35, 0.11), rz=12, knee=(0.4, -1, 0.1))
    foot(c, 'R', (-0.45, -0.25, 0.11), rz=-12, knee=(-0.4, -1, 0.1))
    hand(c, 'L', (0.20, -0.85, 2.35), sock='mitt', rel=1, elbow=(1, 0.3, -0.5))
    orient(c, 'L', (-0.5, -0.3, 0.7), (-0.8, 0.3, 0.0))
    hshape(c, 'L', 'mitt_shut', 0.8)
    hand(c, 'R', (-0.10, -0.85, 2.35), rel=1, sock='grip', elbow=(-1, 0.4, -0.5))
    orient(c, 'R', (0.4, -0.3, 0.8), (0.8, -0.2, -0.2), 0.6)
    hshape(c, 'R', 'ball')
    look_at(c, np.array([0.0, -80.0, 4.0]))
    face(c, brows_angry=0.5, squint=0.4)
    return c


def throw():
    """A crow-hop throw at the target (-Y): sideways hop, the stride, the arm cocked, over the top, release at the
    marker, follow-through across his body, then recovers square."""
    L = 1.1
    T = 0.425
    c = Clip('f_throw', L)
    S = throw_start_pose()
    c.key(0.0, S)
    h = P(S)                                  # the crow hop: turns sideways, right foot skips behind the left
    put(h, hip__z=-0.02, hip__rz=-80, chest__rz=-12, root__s=1.04, hip__y=-0.20)
    foot(h, 'R', (-0.05, -0.10, 0.40), rz=-90, rx=-10)
    foot(h, 'L', (0.25, -0.75, 0.30), rz=-40, rx=-10)
    W = solved(h)
    hand(h, 'R', at_shw(h, 'R', (0.30, 0.60, 0.20), W), sock='grip', elbow=(-0.3, 1, -0.6))
    hand(h, 'L', at_shw(h, 'L', (-0.30, -0.80, 0.20), W), sock='mitt', elbow=(1, 0.3, -0.5))
    face(h, brows_angry=0.8, squint=0.5)
    c.key(0.14, h)
    st = P(h)                                 # lands, strides at the target, the arm cocked high
    put(st, hip__y=-0.60, hip__z=-0.32, hip__rz=-55, hip__rx=6, chest__rz=-20, chest__rx=-4, root__s=0.96)
    foot(st, 'R', (-0.25, -0.20, 0.12), rz=-85, rx=10)
    foot(st, 'L', (0.25, -1.55, 0.11), rz=10, knee=(0.3, -1, 0.2))
    W = solved(st)
    hand(st, 'R', at_shw(st, 'R', (-0.55, 0.45, 0.95), W), sock='grip', elbow=(-0.5, 0.6, -1))
    orient(st, 'R', (-0.1, 0.4, 1.0), (-0.3, 1.0, -0.1))
    hand(st, 'L', at_shw(st, 'L', (0.20, -1.00, 0.30), W), sock='mitt', elbow=(1, 0, -0.6))
    c.key(0.30, st)
    r = P(st)                                 # RELEASE over the top
    put(r, hip__y=-0.90, hip__z=-0.20, hip__rz=6, hip__rx=14, hip__ry=4, spine__rx=8, chest__rx=8, chest__rz=12, chest__ry=6, root__s=1.03)
    foot(r, 'R', (-0.28, -0.35, 0.22), rz=-70, rx=60, toe=-30)
    W = solved(r)
    hand(r, 'R', at_shw(r, 'R', (-0.75, -0.85, 1.00), W), sock='grip', elbow=(-0.6, 1.0, -0.5))
    orient(r, 'R', (-0.3, -0.45, 1.0), (0.1, -1.0, -0.3))
    hand(r, 'L', (0.40, -0.60, 2.30), sock='mitt', rel=1, elbow=(1, 0.5, -0.4))
    face(r, brows_angry=1.0, squint=0.6, grin=0.5)
    c.key(T, r)
    ft = P(r)                                 # follow-through
    put(ft, hip__y=-1.15, hip__z=-0.30, hip__rx=30, hip__rz=24, spine__rx=10, chest__rx=10, root__s=0.98)
    W = solved(ft)
    foot_at_ankle(ft, 'R', at_hip(ft, 'R', (-0.10, 0.70, 0.05), W), rz=-30, rx=-60, knee=(-0.2, 0.2, -1.0))
    hand(ft, 'R', (0.65, -1.85, 1.10), sock='grip', elbow=(-0.6, 0.5, 0.4))
    orient(ft, 'R', (0.6, -0.3, -0.7), (0.2, 0.8, 0.0), 0.6)
    hshape(ft, 'R', 'open', 0.8)
    c.key(0.58, ft)
    e = P(S)                                  # recovers square, a step ahead
    put(e, hip__y=-1.30, hip__z=-0.18)
    foot(e, 'L', (0.45, -1.65, 0.11), rz=12)
    foot(e, 'R', (-0.45, -1.55, 0.11), rz=-12)
    hand(e, 'R', (-0.62, -0.30, 1.90), rel=1, elbow=(-1, 0.4, 0))
    free(e, 'R')
    hshape(e, 'R', 'relaxed')
    c.key(0.85, e)
    c.key(L, P(e), mode='stop')
    c.markers = {'release': T}
    c.meta = {'from': 'THROW', 'to': 'standing about 1.3 ft ahead', 'ball': [['grip.R', 0.0], [None, T]]}
    return c


def celebrate():
    """Jump for joy: crouch, spring up with the mitt and fist punched high, tuck at the apex, land in a squash with
    a fist pump."""
    L = 1.3
    c = Clip('f_celebrate', L)
    S = stand_pose()
    c.key(0.0, S)
    a = P(S)                                  # crouch, arms swung back
    put(a, hip__z=-0.36, hip__rx=24, chest__rx=12, root__s=0.92)
    hand(a, 'R', (-0.56, 0.48, 1.80), rel=1, elbow=(-0.4, -1.0, 0.2))
    hand(a, 'L', (0.56, 0.48, 1.80), sock='mitt', rel=1, elbow=(0.4, -1.0, 0.2))
    hshape(a, 'R', 'fist')
    face(a, grin=0.6, squint=0.6)
    c.key(0.16, a)
    u = P(S)                                  # launch: stretch, toes pushing, arms whip up
    put(u, hip__z=0.22, hip__rx=-4, chest__rx=-10, root__s=1.10)
    foot(u, 'L', (0.36, -0.30, 0.20), rx=35, toe=-14)
    foot(u, 'R', (-0.36, -0.30, 0.20), rx=35, toe=-14)
    W = solved(u)
    hand(u, 'R', at_shw(u, 'R', (-0.85, -0.20, 1.05), W), elbow=(-1, 0.2, -0.2))
    hand(u, 'L', at_shw(u, 'L', (0.85, -0.20, 1.00), W), sock='mitt', elbow=(1, 0.2, -0.2))
    orient(u, 'L', (0.2, 0.0, 1.0), (0.0, -1.0, 0.0))
    face(u, grin=0.9, brows_up=0.6, mouth_open=0.3)
    c.key(0.30, u)
    j = P(u)                                  # apex: legs tucked
    put(j, hip__z=0.62, root__s=1.04)
    foot(j, 'L', (0.36, 0.02, 0.98), rx=45)
    foot(j, 'R', (-0.36, 0.10, 1.02), rx=50)
    face(j, grin=1.0, brows_up=0.9, mouth_open=0.4)
    c.key(0.48, j)
    p2 = P(j)
    put(p2, hip__z=0.44, root__s=1.02)
    foot(p2, 'L', (0.36, -0.14, 0.52), rx=22)
    foot(p2, 'R', (-0.36, -0.08, 0.58), rx=24)
    c.key(0.60, p2)
    l_ = P(S)                                 # land: squash, the fist yanks down
    put(l_, hip__z=-0.32, hip__rx=16, chest__rx=12, root__s=0.88)
    hand(l_, 'R', (-0.55, -0.50, 2.40), rel=1, elbow=(-1, 0.6, -0.2))
    hshape(l_, 'R', 'fist')
    hand(l_, 'L', (0.62, -0.25, 2.30), sock='mitt', rel=1, elbow=(1, 0.5, -0.3))
    face(l_, grin=1.0, squint=0.55)
    c.key(0.74, l_)
    e = P(S)
    put(e, hip__z=-0.04, root__s=1.01)
    hand(e, 'R', (-0.50, -0.46, 2.55), rel=1, elbow=(-1, 0.6, -0.2))
    hshape(e, 'R', 'fist')
    face(e, grin=0.9, brows_up=0.4, squint=0.3)
    c.key(0.95, e)
    c.key(L, P(e), mode='stop')
    c.meta = {'from': 'STAND', 'to': 'STAND (fist up)', 'ball': [[None, 0.0]]}
    return c


def tag():
    """The tag: drops low and sweeps the mitt down to the bag in front of him (pocket at the 'tag' marker), then pops
    up showing the ball high."""
    L = 1.1
    T = 0.30
    c = Clip('f_tag', L)
    R = ready_pose()
    c.key(0.0, R)
    d = P(R)                                  # down onto one knee, the mitt at the bag
    put(d, hip__y=-0.10, hip__z=-0.85, hip__rx=32, spine__rx=14, chest__rx=10, root__s=0.96)
    foot(d, 'L', (0.55, -0.90, 0.12), rz=14, knee=(0.6, -1, 0.3))
    foot(d, 'R', (-0.50, 0.55, 0.15), rz=-14, rx=40, toe=-30, knee=(-0.3, -1, -0.6))
    tp = np.array([0.35, -1.55, 0.30])
    hand(d, 'L', tp, sock='mitt', elbow=(1, 0.3, 0.6))
    orient(d, 'L', (0.0, -0.8, -0.6), (0.0, -0.6, -0.8))
    hshape(d, 'L', 'mitt_shut', 1.0)
    hand(d, 'R', tp + np.array([-0.25, 0.10, 0.25]), elbow=(-1, 0.3, 0.6))
    look_at(d, tp + np.array([0, -1.0, 0]))
    face(d, squint=0.8, brows_angry=0.8)
    c.key(T, d, mode='lin')
    d2 = P(d)
    put(d2, root__s=1.0)
    c.key(0.42, d2)
    u = P(stand_pose())                       # pops up, mitt high: "OUT!"
    put(u, root__s=1.06, hip__z=0.0, chest__rx=-10)
    W = solved(u)
    hand(u, 'L', at_shw(u, 'L', (0.30, -0.25, 1.30), W), sock='mitt', elbow=(1, 0.3, 0))
    orient(u, 'L', (0.0, 0.0, 1.0), (0.0, -1.0, 0.0))
    hshape(u, 'L', 'mitt_shut', 1.0)
    hand(u, 'R', (-0.60, -0.40, 2.20), rel=1, elbow=(-1, 0.4, -0.2))
    hshape(u, 'R', 'fist')
    look_at(u, np.array([0.0, -30.0, 6.0]))
    face(u, grin=0.8, brows_up=0.5, mouth_open=0.3)
    c.key(0.62, u)
    e = P(u)
    put(e, root__s=1.0)
    c.key(L, e, mode='stop')
    c.markers = {'tag': T}
    c.meta = {'from': 'READY', 'to': 'STAND, mitt held high', 'ball': [['mitt', 0.0]]}
    return c


def slump():
    """Watching a homer go over: turns and looks up as it sails over the wall behind him, a little hop as if he could
    still get it, then slumps, hands on his knees, head hanging."""
    L = 1.8
    c = Clip('f_slump', L)
    R = ready_pose()
    c.key(0.0, R)
    t = P(stand_pose())                       # turns to the wall, looking up
    put(t, hip__z=-0.06, chest__rx=-14, root__s=1.03)
    turn_pose(t, 150, pivot=(0.0, 0.0))
    look_at(t, np.array([10.0, 60.0, 60.0]), neck=0.5)
    face(t, mouth_open=0.6, brows_up=0.9)
    c.key(0.30, t)
    h = P(t)                                  # a hopeless hop
    put(h, hip__z=0.25, root__s=1.06)
    foot(h, 'L', PZ.get(t, 'footL') + np.array([0, 0, 0.30]), rz=t['footL.rz'], rx=30)
    foot(h, 'R', PZ.get(t, 'footR') + np.array([0, 0, 0.30]), rz=t['footR.rz'], rx=30)
    W = solved(h)
    hand(h, 'L', at_shw(h, 'L', (0.20, 0.0, 1.30), W), sock='mitt', elbow=(1, 0.2, 0))
    c.key(0.48, h)
    s_ = P(stand_pose())                      # the slump: hands on his knees, head down
    put(s_, hip__z=-0.38, hip__rx=32, spine__rx=14, chest__rx=14, root__s=0.97)
    foot(s_, 'L', (0.55, -0.35, 0.11), rz=16, knee=(0.6, -1, 0))
    foot(s_, 'R', (-0.55, -0.35, 0.11), rz=-16, knee=(-0.6, -1, 0))
    W = solved(s_)
    kL, kR = where(s_, 'shin.L', W), where(s_, 'shin.R', W)
    hand(s_, 'L', kL + np.array([-0.05, -0.05, 0.30]), sock='mitt', elbow=(1, 0.4, 0))
    hand(s_, 'R', kR + np.array([0.05, -0.05, 0.25]), elbow=(-1, 0.4, 0))
    look_at(s_, np.array([0.0, -4.0, -1.0]))
    face(s_, frown=0.9, brows_sad=1.0, blink=0.3)
    c.key(0.95, s_)
    s2 = P(s_)
    put(s2, neck__rx=16, root__s=0.98)
    c.key(1.35, s2)
    c.key(L, P(s2), mode='stop')
    c.meta = {'from': 'READY', 'to': 'hands on knees', 'ball': [[None, 0.0]]}
    return c


def clips():
    return [ready(), idle(), run(), catch_fly(), catch_dive(), field_grounder(), throw(), celebrate(), tag(), slump()]


def gl(v):
    return [float(v[0]), float(v[2]), float(-v[1])]


def sidecar(side, baked, sk):
    import ak_bake as AB
    side['poses'] = {'READY': 'athletic crouch, hands out low', 'STAND': 'standing between pitches',
                     'THROW': 'square to the target, ball in the right hand at the chest'}
    gs = ground_speed() * sk.U
    side['clips']['f_run']['groundSpeed'] = round(gs, 4)
    side['run'] = {'groundSpeed': round(gs, 4), 'note': 'ft/s at timeScale 1 for the reference build where the planted foot stays '
                   'put; for a character scale it by hipHeight / refHipHeight, then timeScale = path speed / that'}
    for r in baked:
        m = r.clip.markers
        e = side['clips'][r.name]
        for k, t in m.items():
            out = {'t': t}
            for b in ('mitt', 'grip.R', 'hand.R', 'hips'):
                out[b] = gl(AB.socket_at(r, sk, b, t))
            e.setdefault('at', {})[k] = out


def report(side):
    print('f_run ground speed %.2f ft/s (reference build)' % side['run']['groundSpeed'])
    for n, e in side['clips'].items():
        for k, v in e.get('at', {}).items():
            print('%-18s %-8s @%.2f mitt %s grip.R %s' % (n, k, v['t'], np.round(v['mitt'], 3), np.round(v['grip.R'], 3)))

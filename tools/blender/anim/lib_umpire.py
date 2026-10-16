# lib_umpire.py - the umpire library (docs/CAST-CONTRACT.md): u_stance (crouched behind the catcher, loop), u_strike
# (cartoon punch-out: the fist lands at t = 0.35 s), u_strike3 (bigger, with a spin), u_ball (stays down, a tiny shake
# of the head), u_out (hammer), u_safe (arms swept wide), u_hr (twirling finger). Every call starts and ends in
# STANCE. Model space: Z up, he faces -Y (the mound when staged behind the catcher; the runtime may turn him toward
# the camera for the calls, which read from the front and in silhouette from behind), his left is +X.
import math
import numpy as np

import ak_pose as PZ
from ak_pose import P, put, V, foot, hand, orient, free, hshape, face, look_at, turn_pose, J
from ak_clip import Clip
from ak_math import euler, nrm
from ak_lib import solved, where, at_sh, at_shw, at_hip, foot_at_ankle, lerp_keys

T_PUNCH = 0.35
PITCHER = np.array([0.0, -64.0, 6.0])
CAMERA = np.array([0.0, -40.0, 6.0])


def stance_pose():
    """STANCE: the slot behind the catcher: feet wide, knees bent, leaning in with his hands braced on his thighs,
    chin up, peering out at the pitcher."""
    c = PZ.base()
    put(c, hip__y=0.10, hip__z=-0.42, hip__rx=24, spine__rx=10, chest__rx=4)
    foot(c, 'L', (0.62, -0.25, 0.11), rz=20, knee=(0.6, -1, 0.1))
    foot(c, 'R', (-0.62, -0.25, 0.11), rz=-20, knee=(-0.6, -1, 0.1))
    W = solved(c)
    for sd, sx in (('L', 1), ('R', -1)):
        k = where(c, 'shin.' + sd, W)
        hand(c, sd, k + np.array([-0.06 * sx, 0.12, 0.20]), elbow=(sx, 0.8, 0.0))
        orient(c, sd, (-0.25 * sx, -0.55, -0.8), (0.0, 0.2, -1.0), 0.8)
        hshape(c, sd, 'relaxed')
    look_at(c, PITCHER, tilt=0)
    face(c, squint=0.45, brows_angry=0.4, frown=0.2)
    return c


def up_pose():
    """Standing tall for a call (shared start of the gestures)."""
    c = PZ.base()
    put(c, hip__z=-0.06, hip__rx=-2, chest__rx=-6)
    foot(c, 'L', (0.52, -0.30, 0.11), rz=18, knee=(0.4, -1, 0))
    foot(c, 'R', (-0.52, -0.30, 0.11), rz=-18, knee=(-0.4, -1, 0))
    hand(c, 'L', (0.66, -0.20, 1.85), rel=1, elbow=(1, 0.3, 0))
    hand(c, 'R', (-0.66, -0.20, 1.85), rel=1, elbow=(-1, 0.3, 0))
    look_at(c, CAMERA, tilt=0)
    face(c, brows_angry=0.6)
    return c


def stance():
    L = 2.4
    c = Clip('u_stance', L, loop=True)
    S = stance_pose()
    c.key(0.0, S)
    a = P(S)
    put(a, hip__x=0.03, hip__z=-0.44, chest__rz=3)
    look_at(a, PITCHER + np.array([1.0, 0, -0.5]), tilt=2)
    c.key(0.9, a)
    b = P(S)
    put(b, hip__x=-0.03, hip__z=-0.41, chest__rz=-3)
    look_at(b, PITCHER + np.array([-0.8, 0, 0.3]), tilt=-2)
    c.key(1.7, b)
    c.key(L, S)
    c.layers.append(PZ.breathing(L, 2, 0.9))
    c.layers.append(PZ.blink_at([0.6, 1.95]))
    c.meta = {'from': 'STANCE', 'to': 'STANCE'}
    return c


def back_to_stance(c, t0, t1, last):
    """Settle from the end of a call back into STANCE (an anticipation dip, then down)."""
    S = stance_pose()
    m = PZ.lerp_pose(last, S, 0.45)
    put(m, hip__z=min(last['hip.z'], S['hip.z']) + 0.05)
    c.key(t0, m)
    c.key(t1, S, mode='stop')


def strike():
    """The cartoon punch-out: pops up, winds the right fist back by his ear with a twist away, and PUNCHES out to his
    right side: the fist lands fully extended at t = 0.35 s, with a lunge and a squash; holds it, shouting."""
    L = 1.3
    c = Clip('u_strike', L)
    S, U = stance_pose(), up_pose()
    c.key(0.0, S)
    a = P(U)                                  # pops up, stretching tall
    put(a, hip__z=0.02, root__s=1.05)
    look_at(a, CAMERA + np.array([0, 0, 4]))
    face(a, brows_up=0.6, mouth_open=0.3)
    c.key(0.10, a)
    w = P(U)                                  # wind-up: twist away to his left, fist cocked back by the ear
    put(w, hip__z=-0.10, hip__rz=22, chest__rz=18, chest__rx=-8, root__s=1.02, hip__x=0.10)
    foot(w, 'R', (-0.50, -0.20, 0.30), rz=-10, rx=-15, knee=(-0.4, -1, 0.3))
    W = solved(w)
    hand(w, 'R', at_sh(w, 'R', (-0.25, 0.45, 0.55), W), elbow=(-1, 0.6, -0.4))
    orient(w, 'R', (0.0, 0.4, 1.0), (1.0, 0.0, 0.0), 0.6)
    hshape(w, 'R', 'fist')
    hand(w, 'L', at_sh(w, 'L', (0.35, -0.75, 0.10), W), elbow=(1, 0.2, -0.6))
    hshape(w, 'L', 'open')
    look_at(w, CAMERA + np.array([-6, 0, 2]))
    face(w, mouth_open=0.6, brows_angry=1.0, squint=0.4)
    c.key(0.24, w)
    p = P(U)                                  # PUNCH: fist fully out to his right, lunge, squash
    put(p, hip__x=-0.22, hip__z=-0.22, hip__rz=-34, hip__ry=-6, chest__rz=-22, chest__ry=-6, chest__rx=-4, root__s=0.96)
    foot(p, 'R', (-1.05, -0.35, 0.11), rz=-40, knee=(-0.8, -1, 0))
    foot(p, 'L', (0.50, -0.20, 0.11), rz=10, knee=(0.4, -1, 0))
    W = solved(p)
    hand(p, 'R', at_shw(p, 'R', (-1.36, -0.40, 0.12), W), elbow=(-0.2, 1.0, 0.0))
    orient(p, 'R', (-1.0, -0.2, 0.0), (0.0, 0.2, -1.0), 0.8)
    hshape(p, 'R', 'fist')
    hand(p, 'L', at_shw(p, 'L', (0.45, 0.40, -0.55), W), elbow=(1, 0.6, 0))
    hshape(p, 'L', 'fist')
    look_at(p, CAMERA + np.array([-10, 0, 1]), neck=0.5)
    face(p, mouth_open=1.0, brows_angry=1.0, squint=0.5)
    put(p, jaw__rx=14)
    c.key(T_PUNCH, p, mode='lin')
    o = P(p)                                  # overshoot: the arm drives a hair further, then holds
    put(o, root__s=1.02, hip__z=-0.18)
    W = solved(o)
    hand(o, 'R', at_shw(o, 'R', (-1.38, -0.46, 0.16), W), elbow=(-0.2, 1.0, 0.0))
    c.key(0.44, o)
    h = P(o)
    put(h, root__s=1.0, jaw__rx=10)
    face(h, mouth_open=0.8, brows_angry=1.0, squint=0.6)
    c.key(0.78, h)
    back_to_stance(c, 1.02, L, h)
    c.markers = {'punch': T_PUNCH}
    c.meta = {'from': 'STANCE', 'to': 'STANCE'}
    return c


def strike3():
    """Strike three: pops up, spins all the way round on one foot with the fist cocked, a knee up, and lands the big
    punch-out (marker 'punch'), held with a lunge."""
    L = 2.0
    c = Clip('u_strike3', L)
    S, U = stance_pose(), up_pose()
    c.key(0.0, S)
    a = P(U)
    put(a, hip__z=0.04, root__s=1.06)
    face(a, brows_up=0.8, mouth_open=0.4)
    c.key(0.12, a)
    # the spin: three keys round a full turn to his left on the left foot, right knee up, fist cocked
    for i, (t, deg) in enumerate(((0.26, 60.0), (0.40, 180.0), (0.54, 300.0))):
        s_ = P(U)
        put(s_, hip__z=-0.02, root__s=1.03, chest__rx=-6)
        foot_at_ankle(s_, 'R', (-0.20, -0.30, 1.05), rz=0, rx=50, knee=(-0.2, -1, 0.6))
        foot(s_, 'L', (0.20, -0.28, 0.11), rz=10)
        W = solved(s_)
        hand(s_, 'R', at_sh(s_, 'R', (-0.30, 0.40, 0.60), W), elbow=(-1, 0.5, -0.4))
        hshape(s_, 'R', 'fist')
        hand(s_, 'L', at_sh(s_, 'L', (0.55, -0.45, 0.15), W), elbow=(1, 0.2, -0.6))
        hshape(s_, 'L', 'jazz')
        turn_pose(s_, deg, pivot=(0.20, -0.28))
        look_at(s_, CAMERA + np.array([0, 0, 2]), neck=0.6)
        face(s_, mouth_open=0.7, brows_angry=1.0, squint=0.3)
        c.key(t, s_)
    w = P(U)                                  # back round to front, coiled
    put(w, hip__z=-0.12, hip__rz=18, chest__rz=16, root__s=1.02, hip__x=0.10)
    foot(w, 'R', (-0.40, -0.20, 0.30), rz=-10, rx=-15)
    W = solved(w)
    hand(w, 'R', at_sh(w, 'R', (-0.25, 0.45, 0.60), W), elbow=(-1, 0.6, -0.4))
    hshape(w, 'R', 'fist')
    hand(w, 'L', at_sh(w, 'L', (0.35, -0.75, 0.10), W), elbow=(1, 0.2, -0.6))
    face(w, mouth_open=0.8, brows_angry=1.0, squint=0.4)
    c.key(0.68, w)
    p = P(U)                                  # the big punch-out
    put(p, hip__x=-0.30, hip__z=-0.30, hip__rz=-40, hip__ry=-8, chest__rz=-24, chest__ry=-8, chest__rx=-6, root__s=0.95)
    foot(p, 'R', (-1.25, -0.40, 0.11), rz=-45, knee=(-0.9, -1, 0))
    foot(p, 'L', (0.55, -0.15, 0.11), rz=10, rx=10, knee=(0.4, -1, 0))
    W = solved(p)
    hand(p, 'R', at_shw(p, 'R', (-1.36, -0.42, 0.22), W), elbow=(-0.2, 1.0, 0.0))
    orient(p, 'R', (-1.0, -0.2, 0.1), (0.0, 0.2, -1.0), 0.8)
    hshape(p, 'R', 'fist')
    hand(p, 'L', at_shw(p, 'L', (0.45, 0.40, -0.55), W), elbow=(1, 0.6, 0))
    hshape(p, 'L', 'fist')
    look_at(p, CAMERA + np.array([-10, 0, 1]), neck=0.5)
    face(p, mouth_open=1.0, brows_angry=1.0, squint=0.6)
    put(p, jaw__rx=16)
    c.key(0.825, p, mode='lin')
    o = P(p)
    put(o, root__s=1.03, hip__z=-0.25)
    c.key(0.92, o)
    h = P(o)
    put(h, root__s=1.0, jaw__rx=12)
    c.key(1.40, h)
    back_to_stance(c, 1.66, L, h)
    # unwrap the yaw: the spin keys go 60 -> 300 deg, the coil sits at 18 (= 378): keep the channel continuous
    # (360 deg is the same orientation, so the clip still ends exactly in STANCE)
    for t, pz, m in c.keys:
        if t >= 0.66:
            pz['hip.rz'] += 360.0
            for sd in ('L', 'R'):
                pz['foot%s.rz' % sd] += 360.0
    c.markers = {'punch': 0.825}
    c.meta = {'from': 'STANCE', 'to': 'STANCE', 'note': 'a full spin: the hip yaw runs on to +360 deg and stays there (the same orientation), so the clip ends exactly in STANCE without unwinding'}
    return c


def ball():
    """Ball: stays down in the stance, a tiny shake of the head (and a sniff)."""
    L = 0.9
    c = Clip('u_ball', L)
    S = stance_pose()
    c.key(0.0, S)
    for i, (t, rz) in enumerate(((0.16, 9.0), (0.30, -9.0), (0.44, 7.0), (0.58, -4.0))):
        k = P(S)
        put(k, head__rz=S['head.rz'] + rz, neck__rz=S['neck.rz'] + rz * 0.3, hip__z=-0.43)
        face(k, frown=0.4, squint=0.5, brows_angry=0.2)
        c.key(t, k)
    c.key(L, S, mode='stop')
    c.markers = {'call': 0.15}                # the first shake of the head (sync point for the call)
    c.meta = {'from': 'STANCE', 'to': 'STANCE'}
    return c


def out_call():
    """Out: stands, the right fist goes up high (wind), then hammers down in front of him with a stomp."""
    L = 1.2
    c = Clip('u_out', L)
    S, U = stance_pose(), up_pose()
    c.key(0.0, S)
    a = P(U)
    put(a, hip__z=0.02, root__s=1.05, chest__rx=-10)
    W = solved(a)
    hand(a, 'R', at_shw(a, 'R', (-0.35, 0.15, 1.38), W), elbow=(-1, 0.3, 0.0))
    hshape(a, 'R', 'fist')
    put(a, hip__ry=-4, chest__ry=-6)
    face(a, mouth_open=0.4, brows_angry=0.8)
    c.key(0.20, a)
    h = P(U)                                  # HAMMER
    put(h, hip__z=-0.20, hip__rx=10, chest__rx=10, root__s=0.95)
    foot(h, 'R', (-0.55, -0.40, 0.11), rz=-18)
    W = solved(h)
    hand(h, 'R', at_sh(h, 'R', (-0.30, -0.95, -0.25), W), elbow=(-1, 0.5, 0.2))
    orient(h, 'R', (0.0, -1.0, -0.3), (0.5, 0.0, -1.0), 0.6)
    hshape(h, 'R', 'fist')
    look_at(h, CAMERA)
    face(h, mouth_open=1.0, brows_angry=1.0, squint=0.5)
    put(h, jaw__rx=12)
    c.key(0.35, h, mode='lin')
    o = P(h)
    put(o, root__s=1.01, hip__z=-0.16)
    c.key(0.45, o)
    c.key(0.75, P(o))
    back_to_stance(c, 0.95, L, o)
    c.markers = {'call': 0.35}
    c.meta = {'from': 'STANCE', 'to': 'STANCE'}
    return c


def safe_call():
    """Safe: crosses his arms in front (anticipation), then sweeps them out wide, palms down, on his toes."""
    L = 1.2
    c = Clip('u_safe', L)
    S, U = stance_pose(), up_pose()
    c.key(0.0, S)
    a = P(U)                                  # arms crossed in front of the chest
    put(a, hip__z=-0.08, root__s=0.98, chest__rx=4)
    hand(a, 'L', (-0.25, -0.75, 2.60), rel=1, elbow=(1, 0.0, -1))
    hand(a, 'R', (0.25, -0.80, 2.50), rel=1, elbow=(-1, 0.0, -1))
    hshape(a, 'L', 'flat')
    hshape(a, 'R', 'flat')
    face(a, mouth_open=0.3, brows_angry=0.5, squint=0.4)
    c.key(0.18, a)
    s_ = P(U)                                 # SAFE: swept out wide, palms down
    put(s_, hip__z=0.0, root__s=1.05, chest__rx=-6)
    foot(s_, 'L', PZ.get(U, 'footL'), rz=U['footL.rz'], rx=12, toe=-8)
    foot(s_, 'R', PZ.get(U, 'footR'), rz=U['footR.rz'], rx=12, toe=-8)
    W = solved(s_)
    hand(s_, 'L', at_sh(s_, 'L', (1.40, -0.30, 0.05), W), elbow=(0, 1, 0))
    orient(s_, 'L', (1.0, 0.0, 0.0), (0.0, 0.0, -1.0), 0.9)
    hand(s_, 'R', at_sh(s_, 'R', (-1.40, -0.30, 0.05), W), elbow=(0, 1, 0))
    orient(s_, 'R', (-1.0, 0.0, 0.0), (0.0, 0.0, -1.0), 0.9)
    hshape(s_, 'L', 'flat')
    hshape(s_, 'R', 'flat')
    look_at(s_, CAMERA)
    face(s_, mouth_open=1.0, brows_up=0.6)
    put(s_, jaw__rx=12)
    c.key(0.35, s_, mode='lin')
    o = P(s_)
    put(o, root__s=1.0)
    c.key(0.75, o)
    back_to_stance(c, 0.95, L, o)
    c.markers = {'call': 0.35}
    c.meta = {'from': 'STANCE', 'to': 'STANCE'}
    return c


def hr_call():
    """Home run: stands, the right index finger goes up high and twirls three circles, looking up at the ball."""
    L = 1.7
    c = Clip('u_hr', L)
    S, U = stance_pose(), up_pose()
    c.key(0.0, S)
    a = P(U)
    put(a, hip__z=0.0, root__s=1.03, chest__rx=-8)
    look_at(a, np.array([0.0, -60.0, 60.0]))
    face(a, brows_up=0.8, mouth_open=0.4)
    c.key(0.20, a)
    for i in range(10):
        t = 0.30 + i * 0.1
        ang = i * (2 * math.pi / 3.3)
        k = P(a)
        W = solved(k)
        hand(k, 'R', at_sh(k, 'R', (-0.35 + 0.20 * math.cos(ang), -0.25 + 0.20 * math.sin(ang), 1.30), W), elbow=(-1, 0.2, 0.0))
        orient(k, 'R', (0.0, 0.0, 1.0), (0.3, -1.0, 0.0), 0.7)
        hshape(k, 'R', 'point')
        put(k, hip__ry=2 * math.sin(ang), root__s=1.03)
        face(k, brows_up=0.8, mouth_open=0.5 + 0.2 * math.sin(ang * 2))
        c.key(t, k)
    back_to_stance(c, 1.45, L, k)
    c.markers = {'call': 0.3}                 # the finger is up and the twirl starts
    c.meta = {'from': 'STANCE', 'to': 'STANCE'}
    return c


def clips():
    return [stance(), strike(), strike3(), ball(), out_call(), safe_call(), hr_call()]


def gl(v):
    return [float(v[0]), float(v[2]), float(-v[1])]


def sidecar(side, baked, sk):
    import ak_bake as AB
    side['poses'] = {'STANCE': 'crouched in the slot behind the catcher, hands on his thighs, facing the mound'}
    for r in baked:
        m = r.clip.markers
        if 'punch' in m:
            side['clips'][r.name]['fist'] = {'t': m['punch'], 'hand.R': gl(AB.socket_at(r, sk, 'hand.R', m['punch']))}


def report(side):
    for n, e in side['clips'].items():
        if 'fist' in e:
            print('%-10s fist @%.2f hand.R %s' % (n, e['fist']['t'], np.round(e['fist']['hand.R'], 3)))

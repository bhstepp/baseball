# lib_catcher.py - the catcher library (docs/CAST-CONTRACT.md): c_crouch (loop), c_sign, c_receive_high/mid/low (the
# mitt pocket arrives at t = 0.30 s at the zone heights 3.3 / 2.5 / 1.8 ft on the plate's centre line), c_throw_back,
# c_stand, c_react_hr. Model space: Z up, he faces -Y (the mound), his left is +X; the root is on the ground about
# 2.7 ft behind the plate centre, so the plate is at (0, -2.7, 0). The bat camera sits behind him: it sees his back,
# his mitt reaching into the zone and his head, so poses are staged to read from behind.
import math
import numpy as np

import ak_pose as PZ
from ak_pose import P, put, V, foot, hand, orient, free, hshape, face, look_at, turn_pose, J
from ak_clip import Clip
from ak_math import euler, nrm
from ak_lib import solved, where, at_sh, at_shw, at_hip, foot_at_ankle, lerp_keys, to_rest_frame

T_CATCH = 0.30
PLATE_D = 2.7                                  # root behind the plate centre
ZONE = {'high': 3.3, 'mid': 2.5, 'low': 1.8}
POCKET_Y = -1.80                               # how far in front of the root the pocket meets the ball (reach-limited)
POCKET_X = 0.85                                # ...and out to his glove side, so the bat camera behind him sees the mitt
                                               # beside his head (the runtime sets the catcher this far right of the ball)
PITCHER = np.array([0.0, -57.2, 6.0])          # the pitcher's release, seen from the catcher
MOUND = np.array([0.0, -61.5, 3.5])            # the pitcher's chest after his follow-through
SKY = np.array([0.0, -40.0, 60.0])


def crouch_pose():
    """CROUCH: a deep squat on the balls of the feet, knees wide, the mitt up as a target at mid-zone, the bare hand
    tucked behind the right knee, eyes on the pitcher."""
    c = PZ.base()
    put(c, hip__y=0.12, hip__z=-0.70, hip__rx=20, spine__rx=4, chest__rx=-6)
    foot(c, 'L', (0.72, -0.16, 0.14), rz=28, rx=24, toe=-22, knee=(0.85, -1, 0.25))
    foot(c, 'R', (-0.72, -0.16, 0.14), rz=-28, rx=24, toe=-22, knee=(-0.85, -1, 0.25))
    hand(c, 'L', (0.92, -1.45, 2.15), sock='mitt', elbow=(1.0, 0.3, -0.8))
    orient(c, 'L', (0.15, -0.15, 1.0), (0.0, -1.0, 0.1))
    hshape(c, 'L', 'mitt_open', 0.6)
    hand(c, 'R', to_rest_frame(c, (-0.62, 0.10, 1.05)), rel=1, elbow=(-0.8, 0.6, 0.0))   # rides with the body
    orient(c, 'R', (0.2, 0.2, -1.0), (1.0, 0.0, 0.0), 0.6)
    hshape(c, 'R', 'fist')
    put(c, tail__rx=-20, tail__curl=-10)
    look_at(c, PITCHER, tilt=0)
    face(c, squint=0.3, brows_angry=0.2)
    return c


def hold_pose():
    """HOLD: still crouched, ball in the closed mitt held in front of the chest (end of the receives)."""
    c = crouch_pose()
    hand(c, 'L', (0.70, -1.25, 2.00), sock='mitt', elbow=(1.0, 0.2, -0.8))
    orient(c, 'L', (0.0, -0.3, 1.0), (-0.3, -1.0, 0.0))
    hshape(c, 'L', 'mitt_shut', 1.0)
    face(c, squint=0.2)
    return c


def receive(height):
    """From CROUCH the mitt dips as he reads the pitch, then meets the ball (pocket at the zone height on the plate's
    centre line at t = 0.30), pops back with the impact, frames it toward the zone, holds for the call, ends in HOLD."""
    L = 0.9
    H = ZONE[height]
    c = Clip('c_receive_' + height, L)
    C0 = crouch_pose()
    c.key(0.0, C0)
    hi, lo = height == 'high', height == 'low'
    # body for this height: rises for the high one, folds forward for the low one
    body = dict(hip__z=-0.70 + 0.36 * hi - 0.02 * lo, hip__y=0.12 - 0.34 * hi + 0.06 * lo - 0.10, hip__rx=20 - 6 * hi + 8 * lo,
                spine__rx=4 + 6 * lo, chest__rx=-6 - 4 * hi + 4 * lo)
    a = P(C0)                                 # reads it: the mitt dips and relaxes
    put(a, hip__z=-0.72)
    hand(a, 'L', (0.92, -1.42, 1.95), sock='mitt', elbow=(1.0, 0.3, -0.8))
    hshape(a, 'L', 'mitt_open', 0.9)
    look_at(a, PITCHER * np.array([1, 0.6, 0.5]), tilt=0)
    c.key(0.10, a)
    b = P(C0)                                 # moving to it
    put(b, **body)
    pk = np.array([POCKET_X + 0.04, POCKET_Y + 0.12, H + (0.12 if not lo else 0.10)])
    hand(b, 'L', pk, sock='mitt', elbow=(1.0, 0.3, -0.6) if not lo else (1.0, 0.6, 0.4))
    orient(b, 'L', (0.1, -0.2, 1.0) if not lo else (0.25, -0.35, -1.0), (0.0, -1.0, 0.1) if not lo else (0.0, -1.0, -0.2))
    hshape(b, 'L', 'mitt_open', 1.0)
    look_at(b, np.array([0.0, -4.0, H]), tilt=0)
    face(b, squint=0.5, brows_angry=0.4)
    c.key(0.22, b)
    k = P(b)                                  # CATCH: the pocket on the plate's centre line at the zone height
    hand(k, 'L', (POCKET_X, POCKET_Y, H), sock='mitt', elbow=PZ.get(b, 'elbowL'))
    look_at(k, np.array([POCKET_X, POCKET_Y - 0.5, H]), tilt=0)
    face(k, squint=0.8, brows_angry=0.6, blink=0.3)
    c.key(T_CATCH, k, mode='lin')
    pop = P(k)                                # the pop: the ball drives the mitt back, the fingers close, a squash
    hand(pop, 'L', (POCKET_X, POCKET_Y + 0.16, H - 0.05), sock='mitt', elbow=PZ.get(b, 'elbowL'))
    hshape(pop, 'L', 'mitt_shut', 1.0)
    put(pop, root__s=0.96, hip__z=body['hip__z'] - 0.05)
    face(pop, squint=1.0, brows_angry=0.8)
    c.key(0.36, pop)
    fr = P(pop)                               # frames it: sticks the mitt, nudges it toward the middle of the zone
    hand(fr, 'L', (POCKET_X - 0.04, POCKET_Y + 0.10, H + (2.5 - H) * 0.12), sock='mitt', elbow=PZ.get(b, 'elbowL'))
    put(fr, root__s=1.0, hip__z=body['hip__z'])
    look_at(fr, np.array([0.0, -6.0, H]), tilt=0)
    face(fr, smirk=0.4, squint=0.4)
    c.key(0.46, fr)
    c.key(0.66, P(fr))
    Hd = hold_pose()
    c.key(L, Hd, mode='stop')
    c.markers = {'catch': T_CATCH}
    c.meta = {'from': 'CROUCH', 'to': 'HOLD', 'zoneHeight': H, 'ball': [[None, 0.0], ['mitt', T_CATCH]]}
    return c


def crouch():
    L = 2.0
    c = Clip('c_crouch', L, loop=True)
    C0 = crouch_pose()
    c.key(0.0, C0)
    a = P(C0)                                 # settles, mitt pulses the target
    put(a, hip__z=-0.72, hip__x=0.03, hip__ry=2)
    hand(a, 'L', (0.94, -1.48, 2.20), sock='mitt', elbow=(1.0, 0.3, -0.8))
    c.key(0.7, a)
    b = P(C0)
    put(b, hip__z=-0.69, hip__x=-0.03, hip__ry=-2)
    hand(b, 'L', (0.90, -1.43, 2.10), sock='mitt', elbow=(1.0, 0.3, -0.8))
    look_at(b, PITCHER + np.array([0.4, 0, -0.5]), tilt=2)
    c.key(1.35, b)
    c.key(L, C0)
    c.layers.append(PZ.breathing(L, 2, 0.8))
    c.layers.append(PZ.blink_at([0.9]))
    c.meta = {'from': 'CROUCH', 'to': 'CROUCH', 'ball': [[None, 0.0]]}
    return c


def sign():
    """CROUCH -> the mitt drops over the left knee to hide it, the bare hand flashes the sign between his thighs
    (one finger, then two, a wiggle) -> CROUCH."""
    L = 1.3
    c = Clip('c_sign', L)
    C0 = crouch_pose()
    c.key(0.0, C0)
    def s_pose(fingers, dz=0.0, wig=0.0):
        k = P(C0)
        put(k, hip__z=-0.74, hip__rx=24, spine__rx=6)
        hand(k, 'L', (0.70, -0.75, 1.30), sock='mitt', elbow=(1.0, 0.2, -0.4))
        orient(k, 'L', (-0.2, -0.6, -0.8), (-1.0, 0.0, 0.0))
        hshape(k, 'L', 'mitt_open', 0.3)
        hand(k, 'R', (-0.05, -0.38, 0.62 + dz), elbow=(-0.9, 0.4, 0.0))
        orient(k, 'R', (0.15 * wig, -0.30, -1.0), (0.0, 1.0, -0.2))
        if fingers == 1:
            hshape(k, 'R', 'sign1')
        else:
            put(k, fingR=0.15, thumbR=0.9, spreadR=0.2, pointR=0.0)
        look_at(k, PITCHER, tilt=0)
        face(k, squint=0.5, brows_angry=0.3)
        return k
    c.key(0.18, s_pose(1, 0.05))
    c.key(0.36, s_pose(1, 0.0, 1.0))
    c.key(0.52, s_pose(2, 0.02, -1.0))
    c.key(0.68, s_pose(2, 0.0, 1.0))
    c.key(0.84, s_pose(1, 0.03))
    b = P(C0)
    put(b, hip__z=-0.68)
    c.key(1.05, b)
    c.key(L, C0, mode='stop')
    c.meta = {'from': 'CROUCH', 'to': 'CROUCH', 'ball': [[None, 0.0]], 'note': 'the sign hand is between his thighs, visible from the bat camera behind him'}
    return c


def throw_back():
    """HOLD -> pulls the ball out of the mitt, half rises, lobs it back to the pitcher from the ear (release marker),
    then sinks back into CROUCH."""
    L = 1.3
    c = Clip('c_throw_back', L)
    Hd, C0 = hold_pose(), crouch_pose()
    c.key(0.0, Hd)
    a = P(Hd)                                 # transfer: the bare hand meets the mitt
    hand(a, 'L', (0.12, -1.15, 2.05), sock='mitt', elbow=(1.0, 0.2, -0.8))
    hand(a, 'R', (0.04, -1.12, 2.02), sock='grip', elbow=(-1.0, 0.3, -0.6))
    orient(a, 'R', (0.2, -0.4, 0.9), (1.0, -0.2, 0.0))
    hshape(a, 'R', 'ball')
    c.key(0.22, a)
    r = P(a)                                  # half rises, the arm cocks up by the ear, glove points at the mound
    put(r, hip__z=-0.42, hip__y=0.05, hip__rx=10, chest__rz=-18, hip__rz=-10)
    foot(r, 'L', (0.66, -0.30, 0.12), rz=20, rx=8, knee=(0.7, -1, 0.2))
    foot(r, 'R', (-0.70, -0.05, 0.13), rz=-35, rx=16, knee=(-0.7, -1, 0.2))
    W = solved(r)
    hand(r, 'R', at_shw(r, 'R', (-0.35, 0.45, 0.85), W), sock='grip', elbow=(-1.0, 0.3, -0.6))
    orient(r, 'R', (-0.1, 0.2, 1.0), (0.2, -1.0, 0.0))
    hand(r, 'L', at_shw(r, 'L', (-0.10, -1.05, 0.30), W), sock='mitt', elbow=(1.0, 0.0, -0.6))
    hshape(r, 'L', 'mitt_open', 0.4)
    look_at(r, MOUND, tilt=0)
    face(r, squint=0.3)
    c.key(0.42, r)
    rel = P(r)                                # release: the arm extends toward the mound
    put(rel, chest__rz=10, hip__rz=4, hip__rx=14, chest__rx=4)
    W = solved(rel)
    hand(rel, 'R', at_shw(rel, 'R', (-0.25, -0.95, 0.85), W), sock='grip', elbow=(-1.0, 0.5, -0.3))
    orient(rel, 'R', (-0.1, -0.5, 1.0), (0.1, -1.0, -0.3))
    hand(rel, 'L', (0.55, -0.40, 2.10), sock='mitt', rel=1, elbow=(1.0, 0.4, -0.4))
    c.key(0.575, rel)
    f = P(rel)                                # the wrist flicks through
    W = solved(f)
    hand(f, 'R', at_shw(f, 'R', (0.05, -1.05, 0.10), W), sock='grip', elbow=(-1.0, 0.5, 0.2))
    orient(f, 'R', (0.1, -1.0, -0.3), (0.0, -0.3, -1.0))
    hshape(f, 'R', 'open', 0.6)
    c.key(0.72, f)
    d = P(C0)                                 # back down into the crouch
    put(d, hip__z=-0.76)
    c.key(1.05, d)
    c.key(L, C0, mode='stop')
    c.markers = {'release': 0.575}
    c.meta = {'from': 'HOLD', 'to': 'CROUCH', 'ball': [['mitt', 0.0], ['grip.R', 0.22], [None, 0.575]]}
    return c


def stand_pose():
    c = PZ.base()
    put(c, hip__z=-0.14, hip__rx=8, chest__rx=-2)
    foot(c, 'L', (0.55, -0.35, 0.11), rz=18, knee=(0.4, -1, 0))
    foot(c, 'R', (-0.55, -0.35, 0.11), rz=-18, knee=(-0.4, -1, 0))
    hand(c, 'L', (0.55, -0.95, 2.60), sock='mitt', rel=1, elbow=(1.0, 0.4, -0.6))
    orient(c, 'L', (0.2, -0.2, 1.0), (0.0, -1.0, 0.0))
    hshape(c, 'L', 'mitt_open', 0.5)
    hand(c, 'R', (-0.62, -0.40, 1.95), rel=1, elbow=(-1.0, 0.4, -0.3))
    hshape(c, 'R', 'loose')
    return c


def stand():
    """Pops up out of the crouch on a ball in play: springs up (anticipation dip, stretch, settle), mitt up, ready."""
    L = 0.7
    c = Clip('c_stand', L)
    C0 = crouch_pose()
    c.key(0.0, C0)
    a = P(C0)                                 # a quick dip
    put(a, hip__z=-0.76, hip__rx=24, root__s=0.96)
    c.key(0.08, a)
    S0 = stand_pose()
    b = P(S0)                                 # springs up (stretch, up on his toes)
    put(b, hip__z=0.02, root__s=1.05, chest__rx=-6)
    foot(b, 'L', PZ.get(S0, 'footL'), rz=S0['footL.rz'], rx=14, toe=-10)
    foot(b, 'R', PZ.get(S0, 'footR'), rz=S0['footR.rz'], rx=14, toe=-10)
    look_at(b, SKY * np.array([1, 0.3, 0.4]), tilt=0)
    face(b, brows_up=0.6, mouth_open=0.3)
    c.key(0.24, b)
    s = P(S0)
    put(s, hip__z=-0.18, root__s=0.98)
    look_at(s, np.array([0.0, -40.0, 12.0]))
    face(s, brows_up=0.3, squint=0.2)
    c.key(0.45, s)
    S1 = P(S0)
    look_at(S1, np.array([0.0, -40.0, 12.0]))
    face(S1, brows_up=0.2, squint=0.2)
    c.key(L, S1, mode='stop')
    c.meta = {'from': 'CROUCH', 'to': 'STAND', 'ball': [[None, 0.0]]}
    return c


def react_hr():
    """A homer: pops up, follows it way up, a dejected flop of the arms, hands on his knees, head shaking."""
    L = 1.8
    c = Clip('c_react_hr', L)
    C0 = crouch_pose()
    c.key(0.0, C0)
    S0 = stand_pose()
    a = P(S0)                                 # up, head thrown back watching it go
    put(a, hip__z=-0.02, root__s=1.04, chest__rx=-14, spine__rx=-4)
    hand(a, 'L', (0.70, -0.45, 2.20), sock='mitt', rel=1, elbow=(1.0, 0.3, -0.2))
    look_at(a, np.array([0.0, -60.0, 70.0]), tilt=0)
    face(a, mouth_open=0.8, brows_up=1.0)
    put(a, jaw__rx=14)
    c.key(0.28, a)
    a2 = P(a)
    look_at(a2, np.array([0.0, -120.0, 80.0]), tilt=0)
    c.key(0.62, a2)
    f = P(S0)                                 # arms flop
    put(f, hip__z=-0.20, chest__rx=10, root__s=0.97)
    hand(f, 'L', (0.70, -0.15, 1.55), sock='mitt', rel=1, elbow=(1, 0.3, 0))
    hand(f, 'R', (-0.70, -0.15, 1.55), rel=1, elbow=(-1, 0.3, 0))
    hshape(f, 'R', 'loose')
    look_at(f, np.array([0.0, -30.0, 10.0]), tilt=0)
    face(f, frown=0.8, brows_sad=0.9)
    c.key(0.85, f)
    k = P(S0)                                 # hands on his knees, head down, shaking it
    put(k, hip__z=-0.40, hip__rx=30, spine__rx=14, chest__rx=14, root__s=0.98)
    foot(k, 'L', (0.62, -0.35, 0.11), rz=18, knee=(0.6, -1, 0))
    foot(k, 'R', (-0.62, -0.35, 0.11), rz=-18, knee=(-0.6, -1, 0))
    W = solved(k)
    kL, kR = where(k, 'shin.L', W), where(k, 'shin.R', W)
    hand(k, 'L', kL + np.array([-0.05, -0.05, 0.30]), sock='mitt', elbow=(1, 0.4, 0))
    hand(k, 'R', kR + np.array([0.05, -0.05, 0.25]), elbow=(-1, 0.4, 0))
    orient(k, 'R', (0.0, -0.4, -1.0), (0.0, 0.3, -1.0), 0.6)
    face(k, frown=0.9, brows_sad=1.0, blink=0.3)
    for i, t in enumerate((1.1, 1.25, 1.4, 1.55)):
        kk = P(k)
        put(kk, head__rz=12 * (1 if i % 2 == 0 else -1), neck__rx=12)
        c.key(t, kk)
    c.key(L, P(k), mode='stop')
    c.meta = {'from': 'CROUCH', 'to': 'hands on knees', 'ball': [[None, 0.0]]}
    return c


def clips():
    return [crouch(), sign(), receive('high'), receive('mid'), receive('low'), throw_back(), stand(), react_hr()]


def gl(v):
    return [float(v[0]), float(v[2]), float(-v[1])]


def sidecar(side, baked, sk):
    import ak_bake as AB
    side['poses'] = {'CROUCH': 'receiving squat, mitt up as a target', 'HOLD': 'crouched, ball in the closed mitt at the chest',
                     'STAND': 'standing, mitt up'}
    side['plate'] = {'rootBehindPlate': PLATE_D, 'note': 'authored with the root 2.7 ft behind the plate centre (model space: the plate is 2.7 ft in front)'}
    rec = {}
    for r in baked:
        if r.name.startswith('c_receive_'):
            h = r.name.split('_')[-1]
            m = AB.socket_at(r, sk, 'mitt', T_CATCH)
            e = {'t': T_CATCH, 'mitt': gl(m), 'zoneHeight': ZONE[h], 'pocketInFrontOfRoot': float(-m[1]), 'pocketToGloveSide': float(m[0]),
                 'pocketBehindZonePlane': float(PLATE_D + m[1])}
            side['clips'][r.name]['catch'] = e
            rec[h] = e
        if r.name == 'c_throw_back':
            t = r.clip.markers['release']
            g = AB.socket_at(r, sk, 'grip.R', t)
            v = AB.socket_vel(r, 'grip.R', t)
            side['clips'][r.name]['release'] = {'t': t, 'grip.R': gl(g), 'velocity': gl(v)}
    side['receive'] = rec


def report(side):
    for h, e in side['receive'].items():
        print('c_receive_%-5s mitt@0.30 %s (zone %.1f) pocket %.2f ft in front of the root = %.2f ft behind the zone plane' % (
            h, np.round(e['mitt'], 3), e['zoneHeight'], e['pocketInFrontOfRoot'], e['pocketBehindZonePlane']))
    r = side['clips']['c_throw_back']['release']
    print('c_throw_back release %.2f grip.R %s' % (r['t'], np.round(r['grip.R'], 3)))

# lib_pitcher.py - the pitcher library (docs/CAST-CONTRACT.md): p_idle, p_set, the four windups (classic, sidearm,
# submarine, highkick; each from SET, ball released from grip.R at exactly t = 1.15 s = BB.K.WINDUP, follow-through to
# ~2.0 s ending in FINISH), and the reactions. A right-handed pitcher on the rubber facing home plate; lefties are
# mirrored by the runtime. Model space: Z up, he faces -Y (the plate), his left is +X (first-base side); the root
# is on the rubber (the mound top, 0.83 ft above the plate) and never moves: the stride is carried by the hips.
# The game's bat camera sits behind home plate, so it sees the pitcher's front: every pose is staged for that view.
import math
import numpy as np

import ak_pose as PZ
import ak_rig as AR
from ak_pose import P, put, V, foot, hand, orient, free, hshape, face, look_at, turn_pose, J
from ak_clip import Clip
from ak_math import euler, nrm, smooth

RELEASE_T = 1.15
MOUND_Z = 0.83
RUBBER_TO_RELEASE = 6.0                       # BB.K.RUBBER_Y - BB.K.RELEASE_Y
PLATE = np.array([0.0, -60.5, -MOUND_Z])      # home plate, seen from the rubber (model space)
CATCH = np.array([0.0, -63.2, 1.47])          # the catcher's target (mitt ~2.3 ft above the plate)
BATTER = np.array([-2.35, -59.6, 3.5])        # Rocco's head in the box
CAM = np.array([-0.6, -88.5, 8.77])           # the bat camera
OUTFIELD = np.array([-60.0, 260.0, 60.0])     # a homer sailing over his shoulder (left-centre)
# BB.Pitch.releasePoint (right-handed): x to the catcher's left (his right), z above the plate
PHYS = {'classic': (1.75, 6.0), 'highkick': (1.55, 6.35), 'sidearm': (2.75, 4.7), 'submarine': (2.35, 2.6)}
STYLES = ('classic', 'sidearm', 'submarine', 'highkick')

_solver = None


def solver():
    global _solver
    if _solver is None:
        _solver = AR.Solver(PZ.SK)
    return _solver


def where(c, bone):
    """Solved world position (authoring units) of a bone for pose c."""
    W = solver().solve(c)
    return W[bone][:3, 3] / PZ.SK.U


def solved(c):
    return solver().solve(c)


def crot(c, W=None):
    """Rotation of the chest relative to its rest (model space) for pose c."""
    W = W or solved(c)
    return W['chest'][:3, :3] @ PZ.SK.R('chest').T


def at_sh(c, side, off, W=None):
    """A point offset from the posed shoulder (upper_arm joint) by `off`, given in the chest's frame
    (x his left, y back, z up; authoring units)."""
    W = W or solved(c)
    return W['upper_arm.' + side][:3, 3] / PZ.SK.U + crot(c, W) @ np.asarray(off, float)


def at_shw(c, side, off, W=None):
    """A point offset from the posed shoulder by `off` in world (model) axes."""
    W = W or solved(c)
    return W['upper_arm.' + side][:3, 3] / PZ.SK.U + np.asarray(off, float)


def at_hip(c, side, off, W=None):
    """A point offset from the posed hip joint (thigh head) by `off` in the pelvis frame."""
    W = W or solved(c)
    Rh = W['hips'][:3, :3] @ PZ.SK.R('hips').T
    return W['thigh.' + side][:3, 3] / PZ.SK.U + Rh @ np.asarray(off, float)


def foot_at_ankle(c, side, ankle, rz=0.0, rx=0.0, ry=0.0, toe=0.0, knee=None):
    Rf = euler(0, 0, rz) @ euler(rx, ry, 0)
    ball = np.asarray(ankle, float) - Rf @ (J('foot.' + side) - J('toe.' + side))
    return foot(c, side, ball, rz, rx, ry, toe, knee)


def both_hands(c, p, fingers=(0, 0, 1), palm=(0, 1, 0), rel=0, relh=0, eL=(0.9, 0.3, -1.0), eR=(-0.9, 0.3, -1.0)):
    """Hands together with the ball: the mitt pocket and the right grip at the same point (the right hand is inside
    the mitt), the mitt's palm facing `palm`, the right palm facing the opposite way."""
    p = np.asarray(p, float)
    hand(c, 'L', p, sock='mitt', rel=rel, relh=relh, elbow=eL)
    orient(c, 'L', fingers, palm)
    hand(c, 'R', p + np.asarray([-0.02, 0.0, -0.02]), sock='grip', rel=rel, relh=relh, elbow=eR)
    orient(c, 'R', fingers, -np.asarray(palm, float))
    hshape(c, 'R', 'ball')
    hshape(c, 'L', 'mitt_shut', 0.5)
    return c


# ------------------------------------------------------------------------------------------- key poses
def pose_idle():
    """On the rubber between pitches: weight on the right leg, ball in the mitt at the belt, right fist on the hip,
    a smug look in at the batter."""
    c = PZ.base()
    put(c, hip__x=-0.06, hip__z=-0.06, hip__ry=-3, hip__rz=6, spine__ry=1.5, chest__ry=2.5, chest__rx=-3, chest__rz=-4)
    foot(c, 'L', (0.48, -0.28, 0.11), rz=14, knee=(0.3, -1, 0))
    foot(c, 'R', (-0.40, -0.18, 0.11), rz=-12, knee=(-0.25, -1, 0))
    hand(c, 'L', (0.34, -0.62, 1.98), sock='mitt', rel=1, elbow=(0.8, 0.6, -0.3))
    orient(c, 'L', (-0.55, -0.5, 0.35), (-0.25, 0.15, 1.0))
    hshape(c, 'L', 'mitt_shut', 0.3)
    hand(c, 'R', (-0.66, 0.02, 1.84), rel=1, elbow=(-1, 0.25, 0.1))
    orient(c, 'R', (0.25, -0.15, -1.0), (1.0, 0.1, 0.0))
    hshape(c, 'R', 'fist')
    put(c, tail__rx=8, tail__curl=6)
    look_at(c, BATTER, tilt=-5)
    face(c, smirk=0.55, squint=0.25, brows_angry=0.2)
    return c


def pose_set():
    """SET: square to the plate, a little crouched, peering in for the sign over the mitt held at the chin; the right
    hand is in the mitt gripping the ball."""
    c = PZ.base()
    put(c, hip__x=-0.02, hip__y=0.04, hip__z=-0.12, hip__rx=7, spine__rx=4, chest__rx=9, chest__rz=-3)
    foot(c, 'L', (0.42, -0.36, 0.11), rz=10, knee=(0.2, -1, 0))
    foot(c, 'R', (-0.40, -0.12, 0.11), rz=-8, knee=(-0.2, -1, 0))
    look_at(c, CATCH, tilt=-3)
    both_hands(c, J('head') + np.array([0.03, -0.96, 0.50]), fingers=(0.12, -0.12, 1.0), palm=(0, 1, 0), relh=1)
    put(c, tail__rx=14, tail__curl=8)
    face(c, squint=0.55, brows_angry=0.65, smirk=0.25)
    return c


def pose_finish():
    """FINISH (end of every windup, start of the reactions): fielding position a couple of feet in front of the rubber,
    square to the plate, glove up, eyes on the batter."""
    c = PZ.base()
    put(c, hip__x=0.0, hip__y=-1.75, hip__z=-0.34, hip__rx=16, spine__rx=6, chest__rx=6)
    foot(c, 'L', (0.56, -2.18, 0.11), rz=16, knee=(0.35, -1, 0))
    foot(c, 'R', (-0.54, -1.98, 0.11), rz=-16, knee=(-0.35, -1, 0))
    hand(c, 'L', (0.42, -0.78, 2.42), sock='mitt', rel=1, elbow=(0.9, 0.2, -1.0))
    orient(c, 'L', (0.1, -0.35, 1.0), (0.05, -1.0, 0.25))
    hshape(c, 'L', 'mitt_open', 0.6)
    hand(c, 'R', (-0.56, -0.62, 1.86), rel=1, elbow=(-1, 0.4, -0.5))
    orient(c, 'R', (0.1, -0.6, -0.8), (0.8, 0.0, -0.3), 0.6)
    hshape(c, 'R', 'loose')
    put(c, tail__rx=20, tail__curl=10)
    look_at(c, BATTER + np.array([0, 0, -0.5]), tilt=0)
    face(c, brows_angry=0.35, squint=0.25)
    return c


# ------------------------------------------------------------------------------------------- windups
def release_pose(style):
    """Release frame: front leg braced, chest square to the plate (a touch past), the throwing arm reaching up and
    out toward the plate in the style's slot (target set relative to the posed shoulder, so it is always reachable),
    glove tucked into the chest, back foot dragging on its toe."""
    c = PZ.base()
    if style in ('classic', 'highkick'):
        hk = 1.0 if style == 'highkick' else 0.0
        put(c, hip__x=-0.02, hip__y=-1.28, hip__z=-0.08, hip__rx=11, hip__ry=3 + hk, hip__rz=6,
            spine__rx=5, spine__ry=3 + 2 * hk, chest__rx=4, chest__ry=4 + 4 * hk, chest__rz=12)
        foot(c, 'L', (0.28, -2.05, 0.11), rz=12, knee=(0.3, -1, 0.2))
        foot(c, 'R', (-0.30, -0.42, 0.24), rz=-70, rx=64, toe=-32, knee=(-0.2, -1, 0.4))
        W = solved(c)
        grip = at_shw(c, 'R', (-0.86 + 0.18 * hk, -0.60, 1.12 + 0.14 * hk), W)
        hand(c, 'R', grip, sock='grip', elbow=(-0.6, 1.0, -0.5))
        orient(c, 'R', (-0.35 + 0.15 * hk, -0.45, 1.0), (0.1, -1.0, -0.3))
        hshape(c, 'R', 'ball')
    hand(c, 'L', (0.36, -0.55, 2.42), sock='mitt', rel=1, elbow=(1.0, 0.5, -0.4))
    orient(c, 'L', (-0.3, -0.2, 1.0), (-0.6, 0.6, 0.0))
    hshape(c, 'L', 'mitt_shut', 0.7)
    put(c, tail__rx=-10, tail__rz=-20)
    look_at(c, CATCH, tilt=4, neck=0.5)
    face(c, brows_angry=1.0, squint=0.6, grin=0.6, cheeks_puff=0.2)
    return c


def windup_classic():
    L = 2.0
    c = Clip('p_windup_classic', L)
    S = pose_set()
    c.key(0.0, S)
    # 0.12 gather: a dip, hands sink to the belly (anticipation for the pump)
    a = P(S)
    put(a, hip__z=-0.21, hip__rx=10, chest__rx=13, root__s=0.97)
    both_hands(a, (0.04, -0.74, 2.40), fingers=(0.1, -0.3, 1.0), palm=(0, 1, 0.1), rel=1)
    face(a, squint=0.4, brows_angry=0.8)
    c.key(0.12, a)
    # 0.30 the pump: hands swing up over the brow, elbows wide, up tall and arched, the left foot rocks back
    b = P(S)
    put(b, hip__y=0.14, hip__z=-0.02, hip__rx=-4, spine__rx=-3, chest__rx=-8, root__s=1.035, shL__ry=-18, shR__ry=18)
    foot(b, 'L', (0.40, 0.20, 0.13), rz=12, rx=12)
    foot(b, 'R', (-0.38, -0.12, 0.11), rz=-8)
    both_hands(b, (0.0, -0.56, 4.10), fingers=(0.0, -0.35, 1.0), palm=(0, 1, -0.1), eL=(1, 0.4, 0.1), eR=(-1, 0.4, 0.1))
    look_at(b, CATCH, tilt=-2)
    face(b, brows_up=0.4, squint=0.2, grin=0.25)
    c.key(0.30, b)
    # 0.44 pivot: the right foot turns parallel to the rubber, hips start round, hands come down to the chest
    p = P(S)
    put(p, hip__y=0.08, hip__z=-0.06, hip__rz=-50, hip__rx=0, chest__rz=-12, chest__rx=0, spine__rx=0)
    foot(p, 'R', (-0.36, 0.06, 0.11), rz=-88)
    foot(p, 'L', (0.34, 0.06, 0.26), rz=-30, rx=28)
    both_hands(p, (0.04, -0.70, 3.05), fingers=(0.05, -0.2, 1.0), palm=(0, 1, 0), rel=1)
    look_at(p, CATCH)
    face(p, brows_angry=0.8, squint=0.5)
    c.key(0.44, p)
    # 0.58 leg lift (balance point): left side to the plate, knee up to the chest, leaning back from the plate
    k = P(S)
    put(k, hip__x=0.0, hip__y=0.0, hip__z=-0.03, hip__rx=-7, hip__ry=0, spine__rx=-4, chest__rx=-4, chest__rz=-6)
    foot(k, 'R', (-0.26, -0.30, 0.11), rz=0, knee=(-0.1, -1, 0))
    foot_at_ankle(k, 'L', (0.18, -0.58, 1.38), rz=0, rx=58, knee=(0.05, -1, 0.5))
    both_hands(k, (0.06, -0.70, 2.80), fingers=(0.0, -0.1, 1.0), palm=(0, 1, 0), rel=1)
    put(k, tail__rx=30)
    turn_pose(k, -90, pivot=(-0.30, 0.20))
    look_at(k, CATCH, neck=0.45)
    face(k, brows_angry=1.0, squint=0.65, smirk=0.3)
    c.key(0.58, k)
    # 0.70 coil: the knee a touch higher, shoulders wind a little further from the plate (the hold)
    k2 = P(k)
    put(k2, chest__rz=-14, hip__rz=k['hip.rz'] - 6, hip__z=-0.02, hip__rx=-9)
    look_at(k2, CATCH, neck=0.45)
    c.key(0.70, k2)
    # 0.80 break: the knee kicks toward the plate, hips drift forward and drop; the glove reaches for the plate,
    # the ball hand swings down past the right hip (pendulum)
    d = P(k2)
    put(d, hip__y=-0.30, hip__z=-0.14, hip__rx=0, chest__rz=-10)
    foot_at_ankle(d, 'L', (0.0, -0.95, 0.95), rz=-60, rx=20, knee=(0.2, -1, 0.3))
    W = solved(d)
    hand(d, 'L', at_sh(d, 'L', (0.25, -0.95, 0.10), W), sock='mitt', rel=0, elbow=(0.5, 0.6, -1.0))
    orient(d, 'L', (0.0, -0.6, 0.8), (0.3, -0.3, -1.0))
    hand(d, 'R', at_sh(d, 'R', (-0.30, 0.35, -1.05), W), sock='grip', rel=0, elbow=(-0.3, -1.0, 0.0))
    orient(d, 'R', (0.0, 0.3, -1.0), (0.0, 1.0, 0.0))
    look_at(d, CATCH, neck=0.5)
    c.key(0.80, d)
    # 0.88 stride: the leg reaches for the plate, low; the ball arm swings back and up behind him
    s = P(d)
    put(s, hip__x=0.05, hip__y=-0.72, hip__z=-0.30, hip__rz=-70, hip__rx=4, chest__rz=-12, chest__rx=-4, spine__ry=4)
    foot_at_ankle(s, 'L', (0.12, -1.62, 0.48), rz=-20, rx=-14, knee=(0.4, -1, 0.3))
    foot(s, 'R', (-0.30, 0.10, 0.12), rz=-86, rx=12)
    W = solved(s)
    hand(s, 'L', at_sh(s, 'L', (0.35, -1.05, 0.30), W), sock='mitt', rel=0, elbow=(0.6, 0.3, -1.0))
    orient(s, 'L', (0.2, -0.8, 0.4), (0.4, -0.5, -0.8))
    hand(s, 'R', at_sh(s, 'R', (-0.95, 0.65, 0.05), W), sock='grip', rel=0, elbow=(-0.6, -0.4, -1.0))
    orient(s, 'R', (-0.3, 0.6, 0.8), (-0.3, 0.4, -0.8))
    c.key(0.88, s)
    # 0.96 foot strike: front foot plants, hips still closed, the ball cocked high beside his head
    f = P(s)
    put(f, hip__x=0.06, hip__y=-1.00, hip__z=-0.36, hip__rz=-52, hip__rx=8, hip__ry=2, chest__rz=-16, chest__rx=-4, chest__ry=-4, spine__ry=2)
    foot(f, 'L', (0.28, -2.05, 0.11), rz=12, knee=(0.3, -1, 0.2))
    foot(f, 'R', (-0.30, 0.02, 0.14), rz=-82, rx=26, toe=-14)
    W = solved(f)
    hand(f, 'L', at_sh(f, 'L', (0.35, -1.05, 0.35), W), sock='mitt', elbow=(1.0, 0.0, -0.6))
    orient(f, 'L', (0.0, -0.7, 0.7), (0.3, -0.9, -0.2))
    hand(f, 'R', at_sh(f, 'R', (-0.70, 0.30, 0.95), W), sock='grip', elbow=(-0.5, 0.6, -1.0))
    orient(f, 'R', (-0.1, 0.4, 1.0), (-0.3, 1.0, -0.1))
    look_at(f, CATCH, neck=0.5)
    face(f, brows_angry=1.0, squint=0.7, grin=0.4)
    c.key(0.96, f)
    # 1.06 layback: hips fire open, the chest follows, the elbow leads and the ball lags back behind the shoulder
    lb = P(f)
    put(lb, hip__y=-1.14, hip__z=-0.28, hip__rz=-16, hip__rx=10, hip__ry=3, chest__rz=-4, chest__rx=0, chest__ry=2, spine__rx=3, spine__ry=2)
    foot(lb, 'R', (-0.30, -0.12, 0.17), rz=-76, rx=44, toe=-24)
    W = solved(lb)
    hand(lb, 'R', at_sh(lb, 'R', (-0.85, 0.55, 0.55), W), sock='grip', elbow=(-0.4, -0.6, -1.0))
    orient(lb, 'R', (-0.3, 0.7, 0.6), (-0.7, -0.2, -0.6))
    hand(lb, 'L', (0.42, -0.72, 2.55), sock='mitt', rel=1, elbow=(1.0, 0.5, -0.5))
    face(lb, brows_angry=1.0, squint=0.75, grin=0.7, cheeks_puff=0.3)
    c.key(1.06, lb)
    R = release_pose('classic')
    # 1.11 over the top: the hand comes up high beside the cap
    ot = lerp_keys(lb, R, 0.55)
    W = solved(ot)
    hand(ot, 'R', at_sh(ot, 'R', (-0.62, 0.05, 1.38), W), sock='grip', elbow=(-0.5, 0.6, -0.8))
    orient(ot, 'R', (-0.2, 0.1, 1.0), (0.0, -1.0, 0.1))
    c.key(1.11, ot)
    c.key(RELEASE_T, R)
    # 1.26 follow-through: the arm whips across to the outside of the left knee, chest over the front leg, the back
    # leg flies up behind
    ft = P(R)
    put(ft, hip__x=0.10, hip__y=-1.52, hip__z=-0.34, hip__rx=36, hip__rz=26, hip__ry=4, spine__rx=12, chest__rx=12, chest__rz=12, chest__ry=0)
    W = solved(ft)
    foot_at_ankle(ft, 'R', at_hip(ft, 'R', (-0.10, 0.80, 0.05), W), rz=-30, rx=-70, knee=(-0.2, 0.2, -1.0))
    hand(ft, 'R', (0.72, -2.45, 1.15), sock='grip', elbow=(-0.6, 0.5, 0.4))
    orient(ft, 'R', (0.6, -0.3, -0.7), (0.2, 0.8, 0.0), 0.7)
    hshape(ft, 'R', 'open', 0.8)
    look_at(ft, CATCH + np.array([0, 0, 1.0]), neck=0.5)
    face(ft, brows_angry=0.6, mouth_open=0.4, squint=0.3)
    c.key(1.26, ft)
    # 1.42 the back leg swings through and lands: squaring up
    rc = P(ft)
    put(rc, hip__x=0.0, hip__y=-1.75, hip__z=-0.30, hip__rx=22, hip__rz=8, chest__rz=2, spine__rx=8, chest__rx=8)
    foot(rc, 'R', (-0.56, -2.02, 0.20), rz=-20, rx=-10, knee=(-0.35, -1, 0))
    hand(rc, 'R', (-0.50, -0.85, 1.75), rel=1, elbow=(-1, 0.4, -0.3))
    free(rc, 'R')
    hshape(rc, 'R', 'loose')
    look_at(rc, BATTER)
    c.key(1.42, rc)
    F = pose_finish()
    o = P(F)
    put(o, hip__z=-0.40, hip__rx=19)
    c.key(1.70, o)
    c.key(L, F, mode='stop')
    c.sec_gain = 1.0
    c.markers = {'release': RELEASE_T, 'legLift': 0.58, 'handBreak': 0.80, 'footStrike': 0.96, 'finish': 1.70}
    c.meta = {'from': 'SET', 'to': 'FINISH', 'style': 'classic', 'ball': [['grip.R', 0.0], [None, RELEASE_T]]}
    return c


def lerp_keys(a, b, t):
    return PZ.lerp_pose(a, b, t)


# ------------------------------------------------------------------------------------------- loops & transitions
def idle():
    L = 2.4
    c = Clip('p_idle', L, loop=True)
    I = pose_idle()
    c.key(0.0, I)
    a = P(I)                                  # shifts his weight, rolls the shoulder, glances at the camera
    put(a, hip__x=-0.08, hip__ry=-4.5, chest__ry=3.5, shR__rx=-6, shR__ry=-6, chest__rz=-6)
    look_at(a, BATTER + np.array([0.5, 0, 0.4]), tilt=-7)
    c.key(0.8, a)
    b = P(I)
    put(b, hip__x=-0.04, hip__ry=-2, chest__ry=1.5, shR__rx=3, shR__ry=4)
    look_at(b, BATTER + np.array([-0.4, 0, 0.0]), tilt=-4)
    face(b, smirk=0.75, squint=0.35, brows_angry=0.1, brows_up=0.15)
    c.key(1.6, b)
    c.key(L, I)
    c.layers.append(PZ.breathing(L, 2))
    c.layers.append(PZ.blink_at([0.55, 1.9]))
    c.meta = {'from': 'IDLE', 'to': 'IDLE', 'ball': [['mitt', 0.0]]}
    return c


def set_clip():
    L = 0.7
    c = Clip('p_set', L)
    I, S = pose_idle(), pose_set()
    c.key(0.0, I)
    a = P(I)                                  # a little hitch, the right hand comes over to the mitt
    put(a, hip__z=-0.08, chest__rx=2)
    hand(a, 'R', (-0.25, -0.75, 2.20), rel=1, elbow=(-1, 0.4, -0.4))
    orient(a, 'R', (0.3, -0.5, 0.8), (0.9, 0.0, 0.3), 0.8)
    hshape(a, 'R', 'ball', 0.6)
    hand(a, 'L', (0.20, -0.68, 2.10), sock='mitt', rel=1, elbow=(0.8, 0.5, -0.4))
    face(a, squint=0.4, brows_angry=0.5)
    c.key(0.22, a)
    b = P(S)                                  # into the set, overshooting the crouch
    put(b, hip__z=-0.15, chest__rx=11)
    c.key(0.48, b)
    c.key(L, S, mode='stop')
    c.markers = {'ballToHand': 0.30}
    c.meta = {'from': 'IDLE', 'to': 'SET', 'ball': [['mitt', 0.0], ['grip.R', 0.30]]}
    return c


def clips():
    return [idle(), set_clip(), windup_classic()]


# ------------------------------------------------------------------------------------------- sidecar
def gl(v):
    return [float(v[0]), float(v[2]), float(-v[1])]


def sidecar(side, baked, sk):
    import ak_bake as AB
    side['poses'] = {'IDLE': 'on the rubber, ball in the mitt', 'SET': 'square, mitt at the chin, right hand in the mitt',
                     'FINISH': 'fielding position about 1.8 ft in front of the rubber (hips), square to the plate'}
    side['mound'] = {'rubberHeight': MOUND_Z, 'note': 'the root stands on the rubber (BB.K.RUBBER_Y, z = mound top 0.83 ft)'}
    rel = {}
    for r in baked:
        cm = r.clip.meta
        if cm.get('style'):
            st = cm['style']
            g = AB.socket_at(r, sk, 'grip.R', RELEASE_T)
            v = AB.socket_vel(r, 'grip.R', RELEASE_T)
            px, pz = PHYS[st]
            phys = np.array([-px, -RUBBER_TO_RELEASE, pz - MOUND_Z])       # model space, relative to the root on the rubber
            k = phys[2] / g[2]
            e = {'t': RELEASE_T, 'grip.R': gl(g), 'velocity': gl(v), 'speed': float(np.linalg.norm(v)),
                 'physics': gl(phys), 'scaleToMatchHeight': float(k),
                 'afterScale': {'grip.R': gl(g * k), 'offset': gl(phys - g * k)}}
            side['clips'][r.name]['release'] = e
            rel[st] = e
    side['release'] = rel


def report(side):
    for n, e in side['clips'].items():
        if 'release' in e:
            r = e['release']
            print('%-22s grip.R@1.15 %s  phys %s  k=%.3f  after scale offset %s  |v| %.1f ft/s' % (
                n, np.round(r['grip.R'], 3), np.round(r['physics'], 3), r['scaleToMatchHeight'], np.round(r['afterScale']['offset'], 3), r['speed']))

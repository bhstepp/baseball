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

from ak_lib import solver, solved, where, crot, at_sh, at_shw, at_hip, foot_at_ankle, lerp_keys


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
    both_hands(c, J('head') + np.array([0.03, -0.92, 0.34]), fingers=(0.12, -0.12, 1.0), palm=(0, 1, 0), relh=1)
    put(c, tail__rx=14, tail__curl=8)
    face(c, squint=0.55, brows_angry=0.65, smirk=0.25)
    return c


def pose_finish():
    """FINISH (end of every windup, start of the reactions): the fielding-ready crouch a couple of feet in front of
    the rubber, square to the plate, weight forward, glove open low in front, eyes on the batter."""
    c = PZ.base()
    put(c, hip__x=0.0, hip__y=-1.75, hip__z=-0.36, hip__rx=24, spine__rx=8, chest__rx=0)
    foot(c, 'L', (0.62, -2.18, 0.12), rz=16, rx=8, toe=-6, knee=(0.5, -1, 0.1))
    foot(c, 'R', (-0.60, -1.98, 0.12), rz=-16, rx=8, toe=-6, knee=(-0.5, -1, 0.1))
    hand(c, 'L', (0.40, -1.10, 1.88), sock='mitt', rel=1, elbow=(1.0, 0.5, -0.2))
    orient(c, 'L', (0.2, -0.6, -0.5), (0.0, -1.0, 0.4), 0.8)
    hshape(c, 'L', 'mitt_open', 0.8)
    hand(c, 'R', (-0.40, -0.92, 1.86), rel=1, elbow=(-1.0, 0.5, -0.2))
    orient(c, 'R', (-0.2, -0.6, -0.6), (0.0, -1.0, 0.4), 0.6)
    hshape(c, 'R', 'relaxed')
    put(c, tail__rx=20, tail__curl=10)
    look_at(c, BATTER + np.array([0, 0, -0.5]), tilt=0)
    face(c, brows_angry=0.35, squint=0.25)
    return c


# ------------------------------------------------------------------------------------------- windups
# Per style: release slot relative to the posed shoulder (world axes), trunk at release, and the timing of the
# delivery. Release targets (reference build) keep the ratios of BB.Pitch.releasePoint at one common scale (~1.35):
#   classic (-1.30, 3.83)  highkick (-1.15, 4.09)  sidearm (-2.04, 2.87)  submarine (-1.74, 1.31)   (x, height)
T_GATHER, T_WIND, T_PIVOT, T_LIFT, T_COIL, T_HANG = 0.10, 0.26, 0.40, 0.55, 0.66, 0.76
T_DRIVE, T_STRIDE, T_STRIKE, T_LOAD, T_ARC, T_POST, T_FOLLOW, T_LAND, T_SETTLE = 0.85, 0.92, 0.975, 1.07, 1.11, 1.19, 1.27, 1.44, 1.70


def release_pose(style):
    """Release frame: front leg braced, the chest square to the plate or past it, the throwing arm reaching toward
    the plate in the style's slot (target relative to the posed shoulder, so always in reach), glove tucked in, the
    back foot dragging on its toe."""
    c = PZ.base()
    hk = 1.0 if style == 'highkick' else 0.0
    if style in ('classic', 'highkick'):
        put(c, hip__x=-0.20, hip__y=-1.48, hip__z=-0.10, hip__rx=16, hip__ry=4 + hk, hip__rz=5,
            spine__rx=10, spine__ry=5 + 2 * hk, chest__rx=10, chest__ry=7 + 4 * hk, chest__rz=9, root__s=1.03)
        foot(c, 'L', (0.28, -2.05, 0.11), rz=12, knee=(0.3, -1, 0.2))
        foot(c, 'R', (-0.30, -0.42, 0.24), rz=-70, rx=64, toe=-32, knee=(-0.2, -1, 0.4))
        off = (-0.96 + 0.16 * hk, -0.82, 0.92 + 0.22 * hk)
        fingers, palm, elbow = (-0.35 + 0.15 * hk, -0.45, 1.0), (0.1, -1.0, -0.3), (-0.6, 1.0, -0.5)
    elif style == 'sidearm':
        put(c, hip__x=-0.10, hip__y=-1.36, hip__z=-0.14, hip__rx=12, hip__ry=-4, hip__rz=10,
            spine__rx=6, spine__ry=-5, chest__rx=4, chest__ry=-6, chest__rz=16, root__s=1.02)
        foot(c, 'L', (0.34, -2.02, 0.11), rz=16, knee=(0.3, -1, 0.2))
        foot(c, 'R', (-0.36, -0.40, 0.22), rz=-66, rx=60, toe=-30, knee=(-0.2, -1, 0.4))
        off = (-1.38, -0.66, 0.20)
        fingers, palm, elbow = (-0.6, -0.55, 0.45), (0.2, -1.0, 0.3), (-0.3, 1.0, -0.8)
    else:   # submarine
        put(c, hip__x=-0.12, hip__y=-1.30, hip__z=-0.58, hip__rx=26, hip__ry=-14, hip__rz=8,
            spine__rx=16, spine__ry=-10, chest__rx=14, chest__ry=-10, chest__rz=12, root__s=0.97)
        foot(c, 'L', (0.40, -2.05, 0.11), rz=20, knee=(0.35, -1, 0.1))
        foot(c, 'R', (-0.40, -0.25, 0.20), rz=-60, rx=55, toe=-30, knee=(-0.3, -1, -0.2))
        off = (-0.92, -0.85, -0.30)
        fingers, palm, elbow = (-0.3, -0.6, -0.7), (0.1, -1.0, 0.5), (-0.2, 1.0, 0.6)
    W = solved(c)
    hand(c, 'R', at_shw(c, 'R', off, W), sock='grip', elbow=elbow)
    orient(c, 'R', fingers, palm)
    hshape(c, 'R', 'ball')
    hand(c, 'L', (0.36, -0.55, 2.42), sock='mitt', rel=1, elbow=(1.0, 0.5, -0.4))
    orient(c, 'L', (-0.3, -0.2, 1.0), (-0.6, 0.6, 0.0))
    hshape(c, 'L', 'mitt_shut', 0.7)
    put(c, tail__rx=-10, tail__rz=-20)
    look_at(c, CATCH, tilt=4 if style != 'submarine' else -6, neck=0.5)
    face(c, brows_angry=1.0, squint=0.6, grin=0.65, cheeks_puff=0.2)
    return c


def lift_pose(style, S):
    """The leg lift, authored square to the plate and turned -90 deg about the pivot foot."""
    k = P(S)
    if style == 'highkick':      # the leg goes way up in front, the body leans far back to balance it
        put(k, hip__x=0.0, hip__y=0.05, hip__z=0.0, hip__rx=-24, spine__rx=-8, chest__rx=-6, chest__rz=-4, root__s=1.04)
        foot_at_ankle(k, 'L', (0.16, -1.05, 2.15), rz=0, rx=-30, knee=(0.0, -1, 1.0))
        hk = (0.06, -0.62, 2.95)
    elif style == 'sidearm':     # a compact lift, already leaning toward the arm side
        put(k, hip__x=-0.04, hip__y=0.0, hip__z=-0.06, hip__rx=-4, hip__ry=-4, spine__rx=-2, chest__rx=-2, chest__ry=-4, chest__rz=-6, root__s=1.02)
        foot_at_ankle(k, 'L', (0.18, -0.42, 1.30), rz=0, rx=60, knee=(0.0, -1, 0.6))
        hk = (0.06, -0.70, 2.55)
    elif style == 'submarine':   # sinking already: knee up, hips down, a bow toward the plate
        put(k, hip__x=0.0, hip__y=0.0, hip__z=-0.16, hip__rx=8, spine__rx=6, chest__rx=4, chest__rz=-6, root__s=0.99)
        foot_at_ankle(k, 'L', (0.16, -0.40, 1.40), rz=0, rx=66, knee=(0.0, -1, 0.7))
        hk = (0.06, -0.72, 2.45)
    else:
        put(k, hip__x=0.0, hip__y=0.0, hip__z=-0.02, hip__rx=-10, spine__rx=-5, chest__rx=-6, chest__rz=-6, root__s=1.03)
        foot_at_ankle(k, 'L', (0.16, -0.36, 1.66), rz=0, rx=72, knee=(0.0, -1, 0.9))
        hk = (0.06, -0.70, 2.80)
    foot(k, 'R', (-0.26, -0.30, 0.11), rz=0, knee=(-0.1, -1, 0))
    both_hands(k, hk, fingers=(0.0, -0.1, 1.0), palm=(0, 1, 0), rel=1)
    put(k, tail__rx=30)
    turn_pose(k, -90, pivot=(-0.30, 0.20))
    look_at(k, CATCH, neck=0.45)
    face(k, brows_angry=1.0, squint=0.65, smirk=0.3)
    return k


def windup(style):
    L = 2.0
    c = Clip('p_windup_' + style, L)
    S = pose_set()
    c.key(0.0, S)
    sub, side, hk = style == 'submarine', style == 'sidearm', style == 'highkick'
    # ---- gather: a dip, hands sink to the belly (anticipation for the wind)
    a = P(S)
    put(a, hip__z=-0.21, hip__rx=10, chest__rx=13, root__s=0.96)
    both_hands(a, (0.04, -0.74, 2.40), fingers=(0.1, -0.3, 1.0), palm=(0, 1, 0.1), rel=1)
    face(a, squint=0.4, brows_angry=0.8)
    c.key(T_GATHER, a)
    # ---- the wind
    b = P(S)
    if style in ('classic', 'highkick'):
        # up on his toes, arms flung up and out in a big V (ball in the right hand, mitt in the left), the left foot
        # rocks back
        put(b, hip__y=0.12, hip__z=0.02, hip__rx=-5 - 4 * hk, spine__rx=-3, chest__rx=-8 - 4 * hk, root__s=1.05, shL__ry=-14, shR__ry=14)
        foot(b, 'L', (0.40, 0.22, 0.16), rz=12, rx=16, toe=-10)
        foot(b, 'R', (-0.38, -0.10, 0.14), rz=-8, rx=10, toe=-8)
        W = solved(b)
        hand(b, 'L', at_shw(b, 'L', (0.72, -0.25, 1.15 + 0.1 * hk), W), sock='mitt', elbow=(1, 0.3, -0.2))
        orient(b, 'L', (0.4, -0.1, 1.0), (-0.2, -1.0, 0.0))
        hshape(b, 'L', 'mitt_open', 0.5)
        hand(b, 'R', at_shw(b, 'R', (-0.72, -0.25, 1.15 + 0.1 * hk), W), sock='grip', elbow=(-1, 0.3, -0.2))
        orient(b, 'R', (-0.4, -0.1, 1.0), (0.2, -1.0, 0.0))
        hshape(b, 'R', 'ball')
        look_at(b, CATCH, tilt=-4)
        face(b, brows_up=0.6, squint=0.15, grin=0.5)
    elif side:
        # a sly rock: weight back on the right leg, hands at the belt, a lean toward the arm side
        put(b, hip__x=-0.10, hip__y=0.10, hip__z=-0.10, hip__ry=-5, chest__ry=-6, chest__rz=-8, root__s=1.0)
        foot(b, 'L', (0.42, 0.08, 0.16), rz=10, rx=14, toe=-8)
        both_hands(b, (0.0, -0.78, 2.30), fingers=(0.3, -0.4, 1.0), palm=(0, 1, 0.1), rel=1)
        look_at(b, CATCH, tilt=-8)
        face(b, smirk=0.8, squint=0.5, brows_angry=0.3)
    else:
        # the submariner's bow: folds forward, hands down by the knees, then comes up for the turn
        put(b, hip__y=0.20, hip__z=-0.30, hip__rx=26, spine__rx=18, chest__rx=14, root__s=0.97)
        foot(b, 'L', (0.44, -0.30, 0.11), rz=12)
        both_hands(b, (0.02, -1.15, 1.25), fingers=(0.0, -0.6, -0.6), palm=(0, 1, -0.4), rel=0, eL=(1, 0.6, 0), eR=(-1, 0.6, 0))
        look_at(b, CATCH, tilt=-4)
        face(b, squint=0.6, brows_angry=0.6, smirk=0.3)
    c.key(T_WIND, b)
    # ---- pivot: the right foot turns parallel to the rubber, hips start round, hands come together at the chest
    p = P(S)
    put(p, hip__y=0.08, hip__z=-0.06 - 0.08 * sub, hip__rz=-50, hip__rx=0, chest__rz=-12, chest__rx=0, spine__rx=0, root__s=1.0)
    foot(p, 'R', (-0.36, 0.06, 0.11), rz=-88)
    foot(p, 'L', (0.34, 0.06, 0.26), rz=-30, rx=28)
    both_hands(p, (0.04, -0.70, 3.05 - 0.3 * sub), fingers=(0.05, -0.2, 1.0), palm=(0, 1, 0), rel=1)
    look_at(p, CATCH)
    face(p, brows_angry=0.8, squint=0.5)
    c.key(T_PIVOT, p)
    # ---- leg lift, then the coil: a cartoon twist that shows the batter his back number, then the hang
    k = lift_pose(style, S)
    c.key(T_LIFT, k)
    tw = {'classic': 26, 'highkick': 30, 'sidearm': 18, 'submarine': 22}[style]
    k2 = P(k)
    put(k2, hip__rz=k['hip.rz'] - tw * 0.45, chest__rz=k['chest.rz'] - tw * 0.55, hip__rx=k['hip.rx'] - 3, root__s=1.0 + 0.02)
    look_at(k2, CATCH, neck=0.55)
    face(k2, brows_angry=1.0, squint=0.8, smirk=0.5)
    c.key(T_COIL, k2)
    k3 = P(k2)
    put(k3, hip__z=k2['hip.z'] - 0.03, hip__rz=k2['hip.rz'] - 3)
    look_at(k3, CATCH, neck=0.55)
    c.key(T_HANG, k3)
    # ---- drive: the knee kicks toward the plate, hips drift forward and drop; hands break: glove reaches for the
    # plate, the ball hand swings down past the right hip (pendulum)
    d = P(k3)
    put(d, hip__y=-0.30, hip__z=-0.14 - 0.10 * sub, hip__rx=0 + 10 * sub, hip__rz=-95, chest__rz=-10, chest__rx=0, root__s=0.99)
    foot_at_ankle(d, 'L', (-0.15, -0.95, 0.95 - 0.15 * sub), rz=-60, rx=20, knee=(0.2, -1, 0.3))
    W = solved(d)
    hand(d, 'L', at_shw(d, 'L', (-0.65, -0.80, 0.25), W), sock='mitt', rel=0, elbow=(0.5, 0.6, -1.0))
    orient(d, 'L', (-0.3, -0.7, 0.6), (0.3, -0.3, -1.0))
    hand(d, 'R', at_shw(d, 'R', (0.05, 0.40, -1.10 - 0.1 * sub), W), sock='grip', rel=0, elbow=(-0.3, -1.0, 0.0))
    orient(d, 'R', (0.0, 0.3, -1.0), (0.0, 1.0, 0.0))
    look_at(d, CATCH, neck=0.5)
    c.key(T_DRIVE, d)
    # ---- stride: the leg reaches for the plate, low; the ball arm swings back behind him (high for over-the-top,
    # at the hip for sidearm, down by the knee for submarine)
    st = P(d)
    put(st, hip__x=0.05, hip__y=-0.72, hip__z=-0.30 - 0.15 * sub, hip__rz=-70, hip__rx=4 + 10 * sub, chest__rz=-12, chest__rx=-4 + 6 * sub, spine__ry=4 - 8 * (side or sub), root__s=0.98)
    foot_at_ankle(st, 'L', (0.12, -1.62, 0.48), rz=-20, rx=-14, knee=(0.4, -1, 0.3))
    foot(st, 'R', (-0.30, 0.10, 0.12), rz=-86, rx=12)
    W = solved(st)
    hand(st, 'L', at_shw(st, 'L', (-0.55, -0.95, 0.30), W), sock='mitt', rel=0, elbow=(0.6, 0.3, -1.0))
    orient(st, 'L', (0.1, -0.9, 0.4), (0.3, -0.6, -0.8))
    arm_back = {'classic': (0.75, 0.95, 0.40), 'highkick': (0.70, 0.90, 0.60), 'sidearm': (0.70, 1.05, -0.30), 'submarine': (0.55, 0.80, -1.00)}[style]
    hand(st, 'R', at_shw(st, 'R', arm_back, W), sock='grip', rel=0, elbow=(-0.6, -0.4, -1.0))
    orient(st, 'R', (0.0, 0.8, 0.5 - 0.9 * sub), (-0.4, 0.3, -0.8))
    c.key(T_STRIDE, st)
    # ---- foot strike: the front foot plants (squash), hips still closed, the ball loaded
    f = P(st)
    put(f, hip__x=0.06, hip__y=-1.00, hip__z=-0.36 - 0.18 * sub, hip__rz=-52, hip__rx=8 + 10 * sub, hip__ry=2, chest__rz=-16, chest__rx=-4 + 8 * sub,
        chest__ry=-4, spine__ry=2 - 8 * (side or sub), root__s=0.95)
    foot(f, 'L', (0.28 + 0.06 * (side or sub), -2.05, 0.11), rz=12, knee=(0.3, -1, 0.2))
    foot(f, 'R', (-0.30, 0.02, 0.14), rz=-82, rx=26, toe=-14)
    W = solved(f)
    hand(f, 'L', at_shw(f, 'L', (0.30, -1.00, 0.30), W), sock='mitt', elbow=(1.0, 0.0, -0.6))
    orient(f, 'L', (0.0, -0.7, 0.7), (0.3, -0.9, -0.2))
    cock = {'classic': (-0.70, 0.40, 0.95), 'highkick': (-0.55, 0.45, 1.10), 'sidearm': (-1.10, 0.70, 0.10), 'submarine': (-0.75, 0.75, -0.80)}[style]
    hand(f, 'R', at_shw(f, 'R', cock, W), sock='grip', elbow=(-0.5, 0.6, -1.0) if not sub else (-0.5, 0.6, 0.4))
    orient(f, 'R', (-0.1, 0.4, 1.0) if not (side or sub) else (-0.4, 0.8, -0.2), (-0.3, 1.0, -0.1))
    look_at(f, CATCH, neck=0.5)
    face(f, brows_angry=1.0, squint=0.7, grin=0.4)
    c.key(T_STRIKE, f)
    R = release_pose(style)
    # ---- load (layback): hips fire open, the chest follows, the elbow leads, the ball lags behind
    lb = lerp_keys(f, R, 0.45)
    put(lb, root__s=1.0)
    foot(lb, 'L', PZ.get(R, 'footL'), rz=R['footL.rz'], knee=PZ.get(R, 'kneeL'))
    W = solved(lb)
    load = {'classic': (-0.85, 0.55, 0.55), 'highkick': (-0.70, 0.55, 0.75), 'sidearm': (-1.25, 0.55, 0.05), 'submarine': (-0.95, 0.50, -0.85)}[style]
    hand(lb, 'R', at_shw(lb, 'R', load, W), sock='grip', elbow=(-0.4, -0.6, -1.0) if not sub else (-0.3, 0.2, 1.0))
    orient(lb, 'R', (-0.3, 0.7, 0.6) if not sub else (-0.3, 0.6, -0.7), (-0.7, -0.2, -0.6))
    hand(lb, 'L', (0.42, -0.72, 2.55), sock='mitt', rel=1, elbow=(1.0, 0.5, -0.5))
    face(lb, brows_angry=1.0, squint=0.75, grin=0.7, cheeks_puff=0.3)
    c.key(T_LOAD, lb)
    # ---- the arc in-between: over the top / round the side / up from under
    ot = lerp_keys(lb, R, 0.55)
    W = solved(ot)
    arc = {'classic': (-0.62, 0.05, 1.38), 'highkick': (-0.45, 0.05, 1.46), 'sidearm': (-1.52, 0.05, 0.30), 'submarine': (-1.05, 0.10, -1.05)}[style]
    hand(ot, 'R', at_shw(ot, 'R', arc, W), sock='grip', elbow=(-0.5, 0.6, -0.8) if not sub else (-0.3, 0.6, 1.0))
    orient(ot, 'R', (-0.2, 0.1, 1.0) if not (side or sub) else ((-1.0, 0.1, 0.2) if side else (-0.4, -0.2, -1.0)), (0.0, -1.0, 0.1))
    c.key(T_ARC, ot)
    c.key(RELEASE_T, R)
    # ---- just after release: the arm keeps driving through at the plate
    pr = P(R)
    put(pr, hip__y=R['hip.y'] - 0.08, hip__rx=R['hip.rx'] + 6, spine__rx=R['spine.rx'] + 2, chest__rx=R['chest.rx'] + 4, chest__rz=R['chest.rz'] + 8, root__s=1.0)
    foot(pr, 'R', PZ.get(R, 'footR') + np.array([0.0, -0.22, 0.04]), rz=R['footR.rz'], rx=R['footR.rx'] + 4, toe=R['toeR.rx'], knee=PZ.get(R, 'kneeR'))
    W = solved(pr)
    post = {'classic': (-0.45, -1.30, 0.15), 'highkick': (-0.40, -1.30, 0.25), 'sidearm': (-0.75, -1.30, 0.05), 'submarine': (-0.35, -1.35, -0.45)}[style]
    hand(pr, 'R', at_shw(pr, 'R', post, W), sock='grip', elbow=(-0.8, 0.5, 0.4))
    orient(pr, 'R', (-0.2, -1.0, -0.2), (0.3, -0.2, -1.0))
    hshape(pr, 'R', 'open', 0.5)
    c.key(T_POST, pr)
    # ---- follow-through
    ft = P(R)
    if sub:     # the arm sweeps up and across (an underhand finish), he comes up out of the crouch
        put(ft, hip__x=0.08, hip__y=-1.55, hip__z=-0.34, hip__rx=24, hip__rz=26, hip__ry=0, spine__rx=10, spine__ry=0, chest__rx=6, chest__rz=14, chest__ry=4, root__s=1.02)
        W = solved(ft)
        foot_at_ankle(ft, 'R', at_hip(ft, 'R', (-0.10, 0.65, -0.35), W), rz=-30, rx=-40, knee=(-0.2, 0.2, -1.0))
        hand(ft, 'R', at_shw(ft, 'R', (0.85, -0.90, 0.75), W), sock='grip', elbow=(-0.6, 0.2, -1.0))
        orient(ft, 'R', (0.6, -0.5, 0.6), (-0.3, -0.6, -0.6), 0.6)
    elif side:  # the arm wraps round the waist, the body spins on
        put(ft, hip__x=0.10, hip__y=-1.55, hip__z=-0.28, hip__rx=28, hip__rz=34, hip__ry=0, spine__rx=10, spine__ry=0, chest__rx=10, chest__rz=18, chest__ry=0, root__s=0.98)
        W = solved(ft)
        foot_at_ankle(ft, 'R', at_hip(ft, 'R', (-0.30, 0.75, 0.00), W), rz=-10, rx=-60, knee=(-0.5, 0.2, -1.0))
        hand(ft, 'R', (0.95, -2.20, 1.75), sock='grip', elbow=(-0.3, 1.0, 0.0))
        orient(ft, 'R', (0.8, 0.3, -0.3), (0.0, 0.6, 0.8), 0.6)
    else:       # down across to the outside of the left knee, chest over the front leg, the back leg flies up
        put(ft, hip__x=0.10, hip__y=-1.52, hip__z=-0.34, hip__rx=36, hip__rz=26, hip__ry=4, spine__rx=12, chest__rx=12, chest__rz=12, chest__ry=0, root__s=0.97)
        W = solved(ft)
        foot_at_ankle(ft, 'R', at_hip(ft, 'R', (-0.10, 0.80, 0.05 + 0.12 * hk), W), rz=-30, rx=-70, knee=(-0.2, 0.2, -1.0))
        hand(ft, 'R', (0.72, -2.45, 1.15), sock='grip', elbow=(-0.6, 0.5, 0.4))
        orient(ft, 'R', (0.6, -0.3, -0.7), (0.2, 0.8, 0.0), 0.7)
    hshape(ft, 'R', 'open', 0.8)
    look_at(ft, CATCH + np.array([0, 0, 1.0]), neck=0.5)
    face(ft, brows_angry=0.6, mouth_open=0.45, squint=0.3)
    c.key(T_FOLLOW, ft)
    # ---- the back leg swings through and lands: squaring up (squash)
    rc = P(ft)
    put(rc, hip__x=0.0, hip__y=-1.75, hip__z=-0.36, hip__rx=24, hip__ry=0, hip__rz=8, chest__rz=2, chest__ry=0, spine__ry=0, spine__rx=8, chest__rx=8, root__s=0.96)
    foot(rc, 'R', (-0.56, -2.02, 0.20), rz=-20, rx=-10, knee=(-0.35, -1, 0))
    hand(rc, 'R', (-0.40, -1.00, 2.55), rel=1, elbow=(-0.9, 0.6, -1.0))
    orient(rc, 'R', (0.3, -0.4, 0.8), (0.7, -0.5, 0.0), 0.5)
    hshape(rc, 'R', 'loose')
    hand(rc, 'L', (0.30, -0.98, 3.05), sock='mitt', rel=1, elbow=(1.0, 0.6, -0.8))
    orient(rc, 'L', (0.15, -0.2, 1.0), (0.05, -1.0, 0.1))
    look_at(rc, BATTER)
    face(rc, brows_angry=0.4, squint=0.3, smirk=0.2)
    c.key(T_LAND, rc)
    F = pose_finish()
    o = P(F)                                  # settles low (the last bit of the follow-through's momentum)
    put(o, hip__z=-0.42, hip__rx=27, root__s=0.98)
    c.key(1.62, o)
    o2 = P(F)                                 # pops back up a hair: alive, ready
    put(o2, hip__z=-0.33, root__s=1.01)
    c.key(1.82, o2)
    c.key(L, F, mode='stop')
    c.layers.append(lambda t: {k: v * smooth((t - 1.5) / 0.3) for k, v in PZ.breathing(1.0, 1, 0.8)(t - 1.5).items()} if t > 1.5 else {})   # one huff, back to FINISH at 2.0
    c.layers.append(PZ.blink_at([1.80]))
    c.sec_gain = 1.0
    c.markers = {'release': RELEASE_T, 'legLift': T_LIFT, 'handBreak': T_DRIVE, 'footStrike': T_STRIKE, 'finish': T_SETTLE}
    c.meta = {'from': 'SET', 'to': 'FINISH', 'style': style, 'ball': [['grip.R', 0.0], [None, RELEASE_T]]}
    return c


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


# ------------------------------------------------------------------------------------------- reactions & between pitches
BRIM_R = np.array([-0.43, -0.76, 4.45])        # right front edge of the cap brim (rest, reference build)


def walk_back(c, t0, t1, F, I, feet=None):
    """Steps from the FINISH spot back onto the rubber (IDLE spot) between t0 and t1: R, L, R, then the feet square
    up. Returns the keys (t, pose) to add; F/I give the start/end poses (body channels are lerped)."""
    out = []
    fL0, fR0 = PZ.get(F, 'footL'), PZ.get(F, 'footR')
    fL1, fR1 = PZ.get(I, 'footL'), PZ.get(I, 'footR')
    n = 4
    seq = ['R', 'L', 'R', 'L']
    posL, posR = fL0.copy(), fR0.copy()
    for i in range(n):
        u0, u1 = i / n, (i + 1) / n
        tm = t0 + (t1 - t0) * (u0 + u1) / 2
        te = t0 + (t1 - t0) * u1
        side = seq[i]
        tgt = (fL1 if side == 'L' else fR1) if i >= 2 else ((fL0 + (fL1 - fL0) * 0.55) if side == 'L' else (fR0 + (fR1 - fR0) * 0.45))
        cur = posL if side == 'L' else posR
        mid = (cur + tgt) / 2 + np.array([0, 0, 0.30])
        k = PZ.lerp_pose(F, I, (u0 + u1) / 2)
        foot(k, 'L', posL if side == 'R' else mid, rz=k['footL.rz'], rx=0 if side == 'R' else -20)
        foot(k, 'R', posR if side == 'L' else mid, rz=k['footR.rz'], rx=0 if side == 'L' else -20)
        put(k, hip__z=k['hip.z'] + 0.05)
        out.append((tm, k))
        if side == 'L':
            posL = tgt
        else:
            posR = tgt
        k2 = PZ.lerp_pose(F, I, u1)
        foot(k2, 'L', posL, rz=k2['footL.rz'])
        foot(k2, 'R', posR, rz=k2['footR.rz'])
        put(k2, hip__z=k2['hip.z'] - 0.04)
        out.append((te, k2))
    return out


def strut_home(A, I, t0, t1, chest_out=True):
    """From pose A (on the FINISH spot, facing the plate): turns his back (pivoting to his right), walks onto the
    rubber in three steps, turns back to face the plate and lands in IDLE. Returns [(t, pose)]."""
    out = []
    hy0, hy1 = A['hip.y'], I['hip.y']
    dur = t1 - t0
    # turn: 0 -> -180 over the first 30%, walk 40%, turn back over the last 30% (unwinding to IDLE's yaw)
    def stand(y, yaw, lift=None, swing=0.0, bob=0.0):
        k = PZ.lerp_pose(A, I, min(1.0, max(0.0, (y - hy0) / (hy1 - hy0))))
        put(k, hip__x=0.0, hip__y=y, hip__z=-0.06 + bob, hip__rz=yaw, hip__rx=(-3 if chest_out else 6), chest__rz=0.0,
            chest__rx=(-9 if chest_out else 10), root__s=1.0 + bob * 0.3)
        Rz = euler(0, 0, yaw)
        for sd, sx in (('L', 1), ('R', -1)):
            off = Rz @ np.array([0.40 * sx, -0.30, 0.0])
            pos = np.array([0.0, y, 0.11]) + off
            if lift == sd:
                pos = pos + Rz @ np.array([0.0, -swing, 0.0]) + np.array([0, 0, 0.28])
            foot(k, sd, pos, rz=yaw + 10 * sx, rx=(-15 if lift == sd else 0), knee=Rz @ np.array([0.2 * sx, -1, 0.2]))
        hand(k, 'L', (0.62, -0.05, 1.80), sock='mitt', rel=1, elbow=(1, 0.3, 0))
        hand(k, 'R', (-0.62, -0.05, 1.80), rel=1, elbow=(-1, 0.3, 0))
        return k
    seq = [(0.00, hy0, 0.0, None, 0.0, 0.0), (0.10, hy0, -60.0, 'L', 0.0, 0.04), (0.20, hy0 + 0.05, -150.0, 'R', 0.0, 0.0),
           (0.30, hy0 + 0.10, -180.0, None, 0.0, -0.02),
           (0.40, hy0 + 0.45, -180.0, 'L', 0.3, 0.05), (0.50, hy0 + 0.80, -180.0, None, 0.0, -0.03),
           (0.60, hy0 + 1.20, -180.0, 'R', 0.3, 0.05), (0.70, hy1, -180.0, None, 0.0, -0.03),
           (0.80, hy1, -110.0, 'L', 0.0, 0.03), (0.90, hy1, -20.0, 'R', 0.0, 0.0)]
    for u, y, yaw, lift, sw, bob in seq:
        k = stand(y, yaw, lift, sw, bob)
        if chest_out:
            look_at(k, BATTER if abs(yaw) < 100 else np.array([0, 30.0, 4.0]), tilt=8)
            face(k, smirk=1.0, squint=0.45, brows_up=0.3)
        out.append((t0 + dur * u, k))
    return out


def get_ball():
    """FINISH -> takes the catcher's throw back in the mitt (pocket at the 'catch' marker), squeezes it, slaps the
    pocket with the bare hand and backpedals onto the rubber -> IDLE."""
    L = 1.6
    c = Clip('p_get_ball', L)
    F, I = pose_finish(), pose_idle()
    c.key(0.0, F)
    a = P(F)                                  # sees it coming: rises, glove up and open toward the plate
    put(a, hip__z=-0.26, hip__rx=10, chest__rx=2)
    hand(a, 'L', (0.62, -2.60, 2.85), sock='mitt', rel=0, elbow=(1.0, 0.5, -0.7))
    orient(a, 'L', (0.2, -0.25, 1.0), (0.0, -1.0, 0.15))
    hshape(a, 'L', 'mitt_open', 1.0)
    look_at(a, CATCH + np.array([0, 0, 3.0]), tilt=0)
    face(a, brows_up=0.3, squint=0.2)
    c.key(0.20, a)
    k = P(a)                                  # CATCH (marker): the pocket at the catch point, a little give
    hand(k, 'L', (0.62, -2.52, 2.82), sock='mitt', rel=0, elbow=(1.0, 0.5, -0.7))
    look_at(k, np.array([0.6, -6.0, 2.9]), tilt=-6)
    c.key(0.40, k)
    g = P(k)                                  # the give and the squeeze
    hand(g, 'L', (0.58, -2.34, 2.70), sock='mitt', rel=0, elbow=(1.0, 0.5, -0.7))
    hshape(g, 'L', 'mitt_shut', 1.0)
    put(g, hip__z=-0.30, root__s=0.98)
    face(g, smirk=0.4, squint=0.3)
    c.key(0.50, g)
    sl = P(g)                                 # slaps the pocket with the bare hand
    put(sl, hip__z=-0.22, hip__rx=8, root__s=1.0)
    hand(sl, 'L', (0.25, -0.80, 2.45), sock='mitt', rel=1, elbow=(1.0, 0.6, -0.4))
    orient(sl, 'L', (-0.4, -0.5, 0.6), (-0.4, 0.2, 1.0))
    hand(sl, 'R', (0.12, -0.92, 2.60), rel=1, elbow=(-1.0, 0.4, -0.3))
    orient(sl, 'R', (0.5, -0.4, 0.3), (0.3, 0.2, -1.0))
    hshape(sl, 'R', 'flat')
    look_at(sl, BATTER, tilt=-6)
    face(sl, smirk=0.7, squint=0.4, brows_angry=0.2)
    c.key(0.62, sl)
    steps = walk_back(c, 0.66, 1.42, sl, I)
    for t, kk in steps:
        c.key(t, kk)
    st = P(I)
    put(st, hip__z=-0.10, root__s=0.98)
    c.key(1.48, st)
    c.key(L, I, mode='stop')
    c.markers = {'catch': 0.40}
    c.meta = {'from': 'FINISH', 'to': 'IDLE', 'ball': [[None, 0.0], ['mitt', 0.40]]}
    return c


def react_k():
    """Strikeout: stands tall, brushes the dirt off his shoulder, a smug look at the batter, struts back onto the
    rubber with his chest out -> IDLE."""
    L = 1.9
    c = Clip('p_react_k', L)
    F, I = pose_finish(), pose_idle()
    c.key(0.0, F)
    a = P(F)                                  # rises, chin up, chest out
    put(a, hip__z=-0.08, hip__rx=-4, spine__rx=-3, chest__rx=-10, root__s=1.04)
    hand(a, 'L', (0.62, -0.10, 1.95), sock='mitt', rel=1, elbow=(1.0, 0.3, 0.0))
    orient(a, 'L', (0.1, 0.2, -1.0), (-1.0, 0.0, 0.0))
    look_at(a, BATTER, tilt=8)
    face(a, smirk=1.0, squint=0.5, brows_up=0.3)
    c.key(0.22, a)
    for i, t in enumerate((0.36, 0.48, 0.60)):      # dusts off his left shoulder, twice
        b = P(a)
        dz = 0.12 if i % 2 == 0 else -0.05
        hand(b, 'R', J('upper_arm.L') + np.array([-0.10, -0.25, 0.25 + dz]), rel=1, elbow=(-0.6, -0.4, -1.0))
        orient(b, 'R', (1.0, -0.2, 0.3 + dz), (0.0, 0.2, -1.0))
        hshape(b, 'R', 'flat')
        put(b, chest__rz=8, head__rz=-6)
        look_at(b, BATTER, tilt=10, gaze=-4)
        face(b, smirk=1.0, squint=0.6, brows_up=0.25)
        c.key(t, b)
    e = P(a)                                  # the look: an eyebrow and a smirk at the batter
    put(e, chest__rz=-6)
    hand(e, 'R', (-0.66, 0.02, 1.84), rel=1, elbow=(-1, 0.25, 0.1))
    orient(e, 'R', (0.25, -0.15, -1.0), (1.0, 0.1, 0.0))
    hshape(e, 'R', 'fist')
    look_at(e, BATTER, tilt=10, gaze=-5)
    face(e, smirk=1.0, squint=0.35, brows_up=0.6)
    c.key(0.78, e)
    # turns his back on the batter and struts onto the rubber, then turns back with the smirk
    for t, kk in strut_home(e, I, 0.86, 1.62, chest_out=True):
        c.key(t, kk)
    c.key(L, I, mode='stop')
    c.layers.append(PZ.blink_at([0.70]))
    c.meta = {'from': 'FINISH', 'to': 'IDLE', 'ball': [[None, 0.0]]}
    return c


def react_walk():
    """Ball four: slumps, throws his head back, winds up and kicks the dirt, trudges back to the rubber -> IDLE."""
    L = 1.9
    c = Clip('p_react_walk', L)
    F, I = pose_finish(), pose_idle()
    c.key(0.0, F)
    a = P(F)                                  # slump, head back: "aw, c'mon!"
    put(a, hip__z=-0.20, hip__rx=4, chest__rx=-6, root__s=0.98)
    hand(a, 'L', (0.62, -0.25, 1.75), sock='mitt', rel=1, elbow=(1, 0.4, 0))
    hand(a, 'R', (-0.66, -0.20, 1.72), rel=1, elbow=(-1, 0.4, 0))
    hshape(a, 'R', 'claw')
    look_at(a, np.array([0.0, -20.0, 30.0]), tilt=-10)
    face(a, frown=0.9, brows_sad=0.6, mouth_open=0.5)
    put(a, jaw__rx=10)
    c.key(0.22, a)
    w = P(a)                                  # winds up the kick: right foot back, arms up
    foot(w, 'R', (-0.85, -1.55, 0.40), rz=-40, rx=-25)
    put(w, hip__y=-1.70, hip__z=-0.18, chest__rx=4, hip__rx=8, root__s=1.02)
    look_at(w, np.array([-0.5, -3.5, -0.8]), tilt=0)
    face(w, frown=1.0, brows_angry=1.0, squint=0.5)
    put(w, jaw__rx=0)
    c.key(0.40, w)
    k = P(w)                                  # KICK: swipes the dirt across in front of him
    foot(k, 'R', (0.15, -2.75, 0.24), rz=50, rx=-30, toe=10)
    put(k, hip__y=-1.86, hip__z=-0.22, hip__rx=-6, hip__rz=18, chest__rx=-10, chest__rz=-10, root__s=0.97)
    hand(k, 'R', (-0.80, 0.15, 2.30), rel=1, elbow=(-1, 0.3, 0))
    hand(k, 'L', (0.80, 0.15, 2.30), sock='mitt', rel=1, elbow=(1, 0.3, 0))
    face(k, frown=1.0, brows_angry=1.0, squint=0.8, mouth_open=0.3)
    c.key(0.52, k)
    k2 = P(k)
    foot(k2, 'R', (-0.45, -2.30, 0.11), rz=-14)
    put(k2, hip__y=-1.78, hip__z=-0.26, hip__rx=8, chest__rx=10, root__s=1.0)
    hand(k2, 'R', (-0.66, -0.20, 1.72), rel=1, elbow=(-1, 0.4, 0))
    hand(k2, 'L', (0.62, -0.25, 1.75), sock='mitt', rel=1, elbow=(1, 0.4, 0))
    look_at(k2, np.array([0.0, -4.0, -0.83]), tilt=-4)
    face(k2, frown=0.9, brows_sad=0.8)
    c.key(0.72, k2)
    for t, kk in strut_home(k2, I, 0.80, 1.62, chest_out=False):   # trudges back, head down, arms hanging limp
        put(kk, chest__rx=kk['chest.rx'] + 12, neck__rx=10, shL__ry=8, shR__ry=-8)
        W = solved(kk)
        hand(kk, 'R', at_shw(kk, 'R', (-0.10, 0.10, -1.38), W), elbow=(-0.3, 1, 0))
        hand(kk, 'L', at_shw(kk, 'L', (0.10, 0.10, -1.30), W), sock='mitt', elbow=(0.3, 1, 0))
        free(kk, 'L')
        hshape(kk, 'R', 'loose')
        face(kk, frown=0.8, brows_sad=0.8, blink=0.2)
        c.key(t, kk)
    c.key(L, I, mode='stop')
    c.meta = {'from': 'FINISH', 'to': 'IDLE', 'ball': [[None, 0.0]]}
    return c


def react_hit():
    """A base hit: flinches behind the glove, eyes shut, then snaps round to watch it go, a hand on his cap: wince."""
    L = 1.3
    c = Clip('p_react_hit', L)
    F = pose_finish()
    c.key(0.0, F)
    a = P(F)                                  # flinch: ducks, glove up in front of the face, eyes squeezed shut
    put(a, hip__z=-0.46, hip__rx=24, chest__rx=14, root__s=0.94, shL__ry=-14, shR__ry=14)
    hand(a, 'L', J('head') + np.array([0.15, -1.05, 0.70]), sock='mitt', relh=1, elbow=(1, 0.2, -1))
    orient(a, 'L', (0.0, 0.0, 1.0), (0.0, -1.0, 0.0))
    hand(a, 'R', J('head') + np.array([-0.30, -0.95, 0.55]), relh=1, elbow=(-1, 0.2, -1))
    orient(a, 'R', (0.2, 0.0, 1.0), (0.0, -1.0, 0.0), 0.7)
    hshape(a, 'R', 'open')
    face(a, blink=0.9, squint=1.0, frown=0.6, brows_sad=0.4)
    c.key(0.10, a)
    b = P(F)                                  # snaps round: watches it go over his left shoulder
    put(b, hip__z=-0.20, hip__rz=40, hip__rx=2, chest__rz=22, chest__rx=-6, root__s=1.03)
    foot(b, 'R', (-0.50, -1.95, 0.11), rz=20)
    foot(b, 'L', (0.60, -2.10, 0.11), rz=50)
    W = solved(b)
    hand(b, 'R', BRIM_R + np.array([-0.08, 0.28, -0.38]), rel=0, relh=1, elbow=(-1.0, 0.1, -0.2))
    orient(b, 'R', (0.5, -0.5, 0.2), (0.0, 0.0, -1.0), 0.4)
    hshape(b, 'R', 'claw')
    hand(b, 'L', (0.62, -0.25, 1.85), sock='mitt', rel=1, elbow=(1, 0.4, 0))
    look_at(b, np.array([40.0, -25.0, 26.0]), neck=0.5, tilt=6)
    face(b, frown=0.9, brows_sad=0.9, squint=0.4, mouth_open=0.3)
    c.key(0.36, b)
    b2 = P(b)
    put(b2, hip__z=-0.24, chest__rx=-2, root__s=1.0)
    look_at(b2, np.array([50.0, -15.0, 22.0]), neck=0.5, tilt=8)
    face(b2, frown=1.0, brows_sad=1.0, squint=0.5)
    c.key(0.75, b2)
    b3 = P(b2)
    put(b3, hip__z=-0.28, chest__rx=6, root__s=0.99)
    face(b3, frown=0.8, brows_sad=1.0, blink=0.3)
    c.key(L, b3, mode='stop')
    c.meta = {'from': 'FINISH', 'to': 'hold (watching the ball go, turned toward right field)', 'ball': [[None, 0.0]]}
    return c


def react_hr():
    """A homer: a flinch, the double take with the jaw dropping, turns to watch it sail away with a hand over his
    eyes, then the slump with his cap pulled down."""
    L = 2.4
    c = Clip('p_react_hr', L)
    F = pose_finish()
    c.key(0.0, F)
    a = P(F)                                  # flinch
    put(a, hip__z=-0.44, hip__rx=22, chest__rx=12, root__s=0.95)
    face(a, blink=0.8, squint=0.9, frown=0.4)
    c.key(0.08, a)
    b = P(F)                                  # double take: head whips up after it, jaw DROPS, up on his toes
    put(b, hip__z=-0.02, hip__rx=-6, chest__rx=-14, spine__rx=-4, root__s=1.06, hip__rz=8)
    foot(b, 'L', PZ.get(F, 'footL'), rz=F['footL.rz'], rx=20, toe=-12)
    foot(b, 'R', PZ.get(F, 'footR'), rz=F['footR.rz'], rx=20, toe=-12)
    hand(b, 'L', (0.75, -0.40, 2.35), sock='mitt', rel=1, elbow=(1, 0.2, -0.4))
    hand(b, 'R', (-0.75, -0.40, 2.35), rel=1, elbow=(-1, 0.2, -0.4))
    hshape(b, 'R', 'jazz')
    look_at(b, np.array([-6.0, -26.0, 24.0]), neck=0.5, tilt=4)
    face(b, mouth_open=1.0, brows_up=1.0)
    put(b, jaw__rx=22)
    c.key(0.26, b)
    b2 = P(b)
    put(b2, jaw__rx=26, root__s=1.04)
    look_at(b2, np.array([-8.0, -18.0, 30.0]), neck=0.5, tilt=6)
    c.key(0.44, b2)
    t = P(F)                                  # turns to watch it sail: hand shading his eyes
    put(t, hip__z=-0.10, hip__rx=-4, chest__rz=10, chest__rx=-8, root__s=1.02)
    foot(t, 'L', (0.42, -2.05, 0.11), rz=20)
    foot(t, 'R', (-0.42, -1.95, 0.11), rz=-20)
    turn_pose(t, 150, pivot=(0.0, F['hip.y'] + PZ.J('hips')[1]))
    W = solved(t)
    hand(t, 'R', J('head') + np.array([-0.18, -0.78, 0.86]), relh=1, rel=0, elbow=(-1, 0.2, -0.2))
    orient(t, 'R', (1.0, 0.0, 0.1), (0.0, 0.3, -1.0), 0.8)
    hshape(t, 'R', 'flat')
    hand(t, 'L', (0.60, -0.10, 1.90), sock='mitt', rel=1, elbow=(1, 0.4, 0))
    look_at(t, OUTFIELD, neck=0.5, tilt=0)
    face(t, mouth_open=0.9, brows_up=0.9)
    put(t, jaw__rx=24)
    c.key(0.95, t)
    t2 = P(t)
    look_at(t2, OUTFIELD * np.array([1.2, 1.3, 0.5]), neck=0.5)
    c.key(1.40, t2)
    s_ = P(F)                                 # the slump: turns back, shoulders down, cap brim yanked down
    put(s_, hip__z=-0.30, hip__rx=10, chest__rx=24, neck__rx=14, hip__rz=15, root__s=0.97, shL__ry=10, shR__ry=-10)
    hand(s_, 'R', BRIM_R + np.array([-0.02, 0.18, -0.28]), relh=1, rel=0, elbow=(-1.0, 0.1, -0.2))
    orient(s_, 'R', (0.3, -0.5, 0.3), (0.0, 0.0, -1.0), 0.4)
    hshape(s_, 'R', 'tip')
    hand(s_, 'L', (0.62, -0.10, 1.70), sock='mitt', rel=1, elbow=(1, 0.4, 0))
    put(s_, cap__rx=12)
    face(s_, frown=1.0, brows_sad=1.0, blink=0.4)
    c.key(1.95, s_)
    s2 = P(s_)
    put(s2, hip__z=-0.32, chest__rx=26, root__s=0.98)
    c.key(L, s2, mode='stop')
    c.meta = {'from': 'FINISH', 'to': 'slump (facing the plate)', 'ball': [[None, 0.0]]}
    return c


def taunt():
    """Between pitches, IDLE -> IDLE: wags a finger at the batter ("tsk, tsk"), tugs his cap brim, smirks."""
    L = 1.6
    c = Clip('p_taunt', L)
    I = pose_idle()
    c.key(0.0, I)
    base_ = P(I)
    put(base_, chest__rz=-8, hip__rz=2)
    look_at(base_, BATTER, tilt=-8, gaze=-3)
    face(base_, smirk=1.0, squint=0.45, brows_up=0.35)
    for i, (t, rz) in enumerate(((0.22, 0.0), (0.32, 28.0), (0.42, -26.0), (0.52, 28.0), (0.62, -22.0), (0.72, 0.0))):
        w = P(base_)
        hand(w, 'R', (-0.80, -0.95, 3.10), rel=1, elbow=(-1.0, 0.2, -0.8))
        orient(w, 'R', nrm(np.array([math.sin(math.radians(rz * 1.3)) * 1.0, -0.15, 1.0])), (0.1, -1.0, 0.0))
        hshape(w, 'R', 'point')
        put(w, head__ry=-rz * 0.12)
        c.key(t, w)
    k = P(base_)                              # tugs the cap brim, a little nod
    hand(k, 'R', BRIM_R + np.array([-0.04, 0.18, -0.28]), relh=1, rel=0, elbow=(-1.0, 0.1, -0.2))
    orient(k, 'R', (0.4, -0.5, 0.3), (0.0, 0.2, -1.0), 0.5)
    hshape(k, 'R', 'tip')
    put(k, cap__rx=6, head__rx=8)
    c.key(0.92, k)
    k2 = P(k)
    put(k2, cap__rx=-3, head__rx=-3)
    face(k2, smirk=1.0, squint=0.6, brows_up=0.1)
    c.key(1.08, k2)
    c.key(1.32, I)
    c.key(L, I, mode='stop')
    c.layers.append(PZ.blink_at([1.15]))
    c.meta = {'from': 'IDLE', 'to': 'IDLE', 'ball': [['mitt', 0.0]]}
    return c


def clips():
    return [idle(), set_clip()] + [windup(st) for st in STYLES] + [react_hr(), react_k(), react_walk(), react_hit(), get_ball(), taunt()]


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
    for r in baked:
        if r.name == 'p_get_ball':
            m = AB.socket_at(r, sk, 'mitt', r.clip.markers['catch'])
            side['clips'][r.name]['catch'] = {'t': r.clip.markers['catch'], 'mitt': gl(m)}


def report(side):
    for n, e in side['clips'].items():
        if 'release' in e:
            r = e['release']
            print('%-22s grip.R@1.15 %s  phys %s  k=%.3f  after scale offset %s  |v| %.1f ft/s' % (
                n, np.round(r['grip.R'], 3), np.round(r['physics'], 3), r['scaleToMatchHeight'], np.round(r['afterScale']['offset'], 3), r['speed']))

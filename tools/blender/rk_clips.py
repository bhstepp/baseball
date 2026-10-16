# rk_clips.py - Rocco's animation clips, keyed pose-to-pose (Blender model space: Z up, he faces -Y, his left /
# +X points at the pitcher, the plate centre is at (0, -PLATE_D)). Swing contact is exactly t = 0.25 s: bat_sweet is
# keyed onto the plate's centre line at the zone height of each clip.
import math
import numpy as np
import rk_anim as A
import rk_rig as RR
from rk_anim import Clip, euler

PLATE_D = 2.4
CONTACT = {'high': 3.3, 'mid': 2.5, 'low': 1.8}
T_CONTACT = 0.25
PITCHER = np.array([54.0, -2.4, 5.6])          # release point, seen from the batter's box
MITT = np.array([-4.2, -2.3, 2.4])               # catcher's mitt
UMP = np.array([-6.5, -1.4, 5.2])                # umpire's face
FLIGHT = np.array([40.0, -6.0, 22.0])            # where a well-hit ball is heading
D2R = math.pi / 180


# ------------------------------------------------------------------------------------------- pose helpers
def base():
    return A.rest_channels()


def P(src=None, **kw):
    c = dict(src) if src is not None else base()
    for k, v in kw.items():
        c[k.replace('__', '.')] = v
    return c


def put(c, **kw):
    for k, v in kw.items():
        c[k.replace('__', '.')] = v
    return c


def V(c, key, xyz):
    c[key + '.x'], c[key + '.y'], c[key + '.z'] = map(float, xyz)
    return c


def lerp_pose(a, b, t):
    return {k: (a[k] * (1 - t) + b.get(k, a[k]) * t) if isinstance(a[k], float) else a[k] for k in a}


def nrm(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def bat(c, pivot, d, palm=(1, 0, 0)):
    d = nrm(d)
    c['bat.x'], c['bat.y'], c['bat.z'] = map(float, pivot)
    c['bat.dx'], c['bat.dy'], c['bat.dz'] = map(float, d)
    c['bat.px'], c['bat.py'], c['bat.pz'] = map(float, palm)
    return c


def bat_contact(c, height, d, palm=(1, 0, 0)):
    d = nrm(d)
    C = np.array([0.0, -PLATE_D, height])
    return bat(c, C - d * RR.BAT_SWEET, d, palm)


def foot(c, side, ball, rz=0.0, rx=0.0, ry=0.0, toe=0.0):
    V(c, 'foot' + side, ball)
    c['foot%s.rz' % side], c['foot%s.rx' % side], c['foot%s.ry' % side] = rz, rx, ry
    c['toe%s.rx' % side] = toe
    return c


def hand(c, side, pos, rx=0.0, ry=0.0, rz=0.0, grip=0.0, rel=None):
    """Free hand target. rel=1: position (and the elbow pole) are given in the rest body frame and carried by the
    chest (use for anything that should move with the body); rel=0: world (model) space."""
    V(c, 'hand' + side, pos)
    c['hand%s.rx' % side], c['hand%s.ry' % side], c['hand%s.rz' % side] = rx, ry, rz
    c['grip' + side] = grip
    if rel is not None:
        c['hand%s.rel' % side] = float(rel)
    return c


def face(c, **kw):
    for k in A.SHAPE_KEYS:
        c['sk.' + k] = 0.0
    for k, v in kw.items():
        c['sk.' + k] = v
    return c


def body_R(c, upto='chest'):
    R = euler(c['hip.rx'], c['hip.ry'], c['hip.rz'])
    R = R @ euler(c['spine.rx'], c['spine.ry'], c['spine.rz'])
    R = R @ euler(c['chest.rx'], c['chest.ry'], c['chest.rz'])
    if upto == 'chest':
        return R
    return R @ euler(c['neck.rx'], c['neck.ry'], c['neck.rz'])


def head_pos(c):
    hipp = RR.jv('hips') + np.array([c['hip.x'], c['hip.y'], c['hip.z']])
    Rh = euler(c['hip.rx'], c['hip.ry'], c['hip.rz'])
    Rs = Rh @ euler(c['spine.rx'], c['spine.ry'], c['spine.rz'])
    Rc = Rs @ euler(c['chest.rx'], c['chest.ry'], c['chest.rz'])
    p = hipp + Rh @ (RR.jv('spine') - RR.jv('hips')) + Rs @ (RR.jv('chest') - RR.jv('spine')) + Rc @ (RR.jv('neck') - RR.jv('chest'))
    return p + Rc @ np.array([0, -0.25, 1.15])          # roughly between the eyes


def look_at(c, target, neck=0.38, tilt=0.0, gaze=0.0):
    """Aim the face at a point: yaw/pitch relative to the chest, split between neck and head. `gaze` moves the
    eyes part of the way (degrees of the remaining yaw handled by the eye bones)."""
    Rc = body_R(c)
    d = Rc.T @ (np.asarray(target, float) - head_pos(c))
    yaw = math.degrees(math.atan2(d[0], -d[1]))
    pitch = math.degrees(math.atan2(-d[2], math.hypot(d[0], d[1])))
    yaw_c = max(-112.0, min(112.0, yaw))
    put(c, neck__rz=yaw_c * neck, head__rz=yaw_c * (1 - neck), neck__rx=pitch * 0.35, head__rx=pitch * 0.65, head__ry=tilt)
    left = yaw - yaw_c
    c['eye.rz'] = max(-8.0, min(8.0, left * 0.5 + gaze))
    c['eye.rx'] = 0.0
    return c


def leg_check(c, tag=''):
    """Return the worst leg over-reach (ft) of a pose (positive = the ankle is out of reach)."""
    worst = -9
    hipp = RR.jv('hips') + np.array([c['hip.x'], c['hip.y'], c['hip.z']])
    Rh = euler(c['hip.rx'], c['hip.ry'], c['hip.rz'])
    for sd in ('L', 'R'):
        H = hipp + Rh @ (RR.jv('thigh.' + sd) - RR.jv('hips'))
        Rf = euler(0, 0, c['foot%s.rz' % sd]) @ euler(c['foot%s.rx' % sd], c['foot%s.ry' % sd], 0)
        ball = np.array([c['foot%s.x' % sd], c['foot%s.y' % sd], c['foot%s.z' % sd]])
        ank = ball + Rf @ (RR.jv('foot.' + sd) - RR.jv('toe.' + sd))
        worst = max(worst, np.linalg.norm(ank - H) - (RR.THIGH_LEN + RR.SHIN_LEN) * 0.995)
    return worst


# ------------------------------------------------------------------------------------------- key poses
def pose_neutral():
    c = base()
    hand(c, 'L', (0.62, 0.04, 1.66), rx=-10, rel=1)
    hand(c, 'R', (-0.62, 0.04, 1.66), rx=-10, rel=1)
    V(c, 'elbowL', (0.4, 1.0, 0))
    V(c, 'elbowR', (-0.4, 1.0, 0))
    put(c, hip__z=-0.03, tail__rx=10, tail__curl=6)
    c['bat.vis'] = 0.0
    c['gripR'] = 0.0
    face(c, smile=0.3)
    return c


STANCE_FEET = {'L': ((0.80, -0.30, 0.11), 14.0), 'R': ((-0.76, -0.33, 0.11), 6.0)}


def pose_stance():
    c = base()
    put(c, hip__x=-0.11, hip__y=0.04, hip__z=-0.19, hip__rx=13, hip__ry=-4, hip__rz=-14,
        spine__rx=5, spine__rz=-3, chest__rx=5, chest__rz=-10, chest__ry=-3)
    foot(c, 'L', *STANCE_FEET['L'][:1], rz=STANCE_FEET['L'][1])
    foot(c, 'R', *STANCE_FEET['R'][:1], rz=STANCE_FEET['R'][1])
    V(c, 'kneeL', (-0.15, -1, 0.05))
    V(c, 'kneeR', (0.25, -1, 0.05))
    bat(c, (-0.30, -0.04, 3.00), (-0.40, 0.44, 0.80), palm=(1.0, -0.25, 0.25))
    c['gripL'], c['gripR'] = 1.0, 1.0
    V(c, 'elbowL', (0.15, -0.35, -1.0))
    V(c, 'elbowR', (-0.85, 0.35, 0.45))
    put(c, tail__rx=18, tail__curl=8)
    look_at(c, PITCHER, tilt=-6)
    face(c, smile=0.45, squint=0.28, brows_angry=0.22)
    return c


def pose_set():
    c = pose_stance()
    put(c, hip__x=-0.08, hip__z=-0.22, hip__rz=-20, hip__rx=14, chest__rz=-12, chest__rx=7)
    foot(c, 'L', (1.00, -0.31, 0.11), rz=24)
    V(c, 'kneeL', (-0.05, -1, 0.0))
    bat(c, (-0.50, 0.06, 2.97), (-0.55, 0.40, 0.73), palm=(1.0, -0.3, 0.3))
    V(c, 'elbowR', (-0.9, 0.3, 0.3))
    look_at(c, np.array([12.0, -2.4, 4.4]), tilt=-4)
    face(c, brows_angry=0.6, squint=0.35, smile=0.1)
    return c


def pose_coil():
    c = pose_stance()
    put(c, hip__x=-0.22, hip__y=0.06, hip__z=-0.25, hip__rz=-40, hip__rx=15, hip__ry=-7,
        spine__rz=-6, chest__rz=-16, chest__rx=9, chest__ry=-8, tail__rx=38, tail__fluff=0.28, tail__curl=14)
    foot(c, 'L', (0.52, -0.22, 0.78), rz=6, rx=-28, toe=-12)
    V(c, 'kneeL', (-0.3, -1.0, 0.9))
    bat(c, (-0.64, 0.22, 3.10), (-0.62, 0.52, 0.58), palm=(1.0, -0.3, 0.3))
    V(c, 'elbowR', (-0.9, 0.5, 0.5))
    look_at(c, PITCHER, tilt=-8)
    face(c, brows_angry=1.0, squint=0.6, grin=0.55)
    return c


def pose_dizzy():
    c = pose_neutral()
    put(c, hip__z=-0.12, hip__ry=5, hip__rx=4, spine__rx=6, chest__rx=3, neck__rx=2, head__ry=-18, head__rx=-2,
        tail__rx=-45, tail__curl=-12)
    foot(c, 'L', (0.40, -0.30, 0.11), rz=-28)
    foot(c, 'R', (-0.40, -0.30, 0.11), rz=30)
    V(c, 'kneeL', (-0.7, -1, 0))
    V(c, 'kneeR', (0.7, -1, 0))
    bat(c, (0.55, -0.38, 1.40), (0.20, -0.45, -0.87), palm=(0.0, -0.3, 1.0))
    c['bat.vis'] = 1.0
    c['gripL'], c['gripR'] = 1.0, 0.0
    hand(c, 'R', (-0.58, 0.02, 1.55), rx=-5, rel=1)
    V(c, 'elbowL', (0.5, 0.8, 0))
    face(c, mouth_open=0.32, brows_sad=0.65, blink=0.32)
    return c


def follow_pose(height, settle=True):
    c = pose_stance()
    dz = {'high': 0.12, 'mid': 0.0, 'low': -0.12}[height]
    put(c, hip__x=0.16, hip__y=-0.02, hip__z=-0.15 + dz * 0.4, hip__rz=88, hip__rx=6, hip__ry=5,
        spine__rx=2, spine__rz=8, chest__rz=30, chest__rx=-2, chest__ry=7)
    foot(c, 'L', (1.00, -0.31, 0.11), rz=46)
    foot(c, 'R', (-0.56, -0.30, 0.14), rz=78, rx=58, toe=-8)
    V(c, 'kneeR', (0.6, -1, -0.1))
    V(c, 'kneeL', (0.4, -1, 0.1))
    bat(c, (0.30, 0.06, 3.16), (0.08, 0.76, 0.64), palm=(-1, 0.05, -0.35))
    V(c, 'elbowL', (0.7, 0.2, -1))
    V(c, 'elbowR', (-0.2, -0.6, -1))
    put(c, tail__rx=20, tail__rz=-25, tail__curl=10)
    look_at(c, FLIGHT, tilt=4)
    face(c, smile=0.8, brows_up=0.35, squint=0.15)
    return c


# ------------------------------------------------------------------------------------------- layers
def breathing(L, cycles=2, amp=1.0):
    w = 2 * math.pi * cycles / L

    def f(t):
        s = math.sin(w * t)
        return {'chest.s': 0.014 * s * amp, 'hip.z': 0.008 * s * amp, 'chest.rx': -1.2 * s * amp, 'head.rx': 0.8 * s * amp}
    return f


def blink_at(times, dur=0.13):
    def f(t):
        v = 0.0
        for t0 in times:
            u = (t - t0) / dur
            if 0 <= u <= 1:
                v = max(v, math.sin(u * math.pi) ** 0.7)
        return {'sk.blink': v}
    return f


# ------------------------------------------------------------------------------------------- clips
def clip_stance():
    L = 2.4
    c = Clip('stance', L, loop=True)
    S = pose_stance()
    c.key(0.0, S)
    # cocky bat waggle (two loops of the barrel), a little knee bounce, a glance down at the plate and back
    w1 = P(S)
    bat(w1, (-0.27, -0.02, 3.05), (-0.30, 0.46, 0.84), palm=(1.0, -0.25, 0.25))
    put(w1, hip__z=-0.20, tail__rz=10)
    c.key(0.3, w1)
    w2 = P(S)
    bat(w2, (-0.34, -0.08, 2.97), (-0.48, 0.36, 0.80), palm=(1.0, -0.25, 0.25))
    put(w2, hip__z=-0.18, tail__rz=-8)
    c.key(0.6, w2)
    w3 = P(w1)
    put(w3, tail__rz=12)
    c.key(0.9, w3)
    g = P(S)                                         # glance down at the plate, a cocky chin-up back
    bat(g, (-0.33, -0.06, 2.99), (-0.44, 0.40, 0.80), palm=(1.0, -0.25, 0.25))
    look_at(g, np.array([2.0, -2.6, 2.2]), tilt=-12)
    put(g, tail__rz=-6)
    face(g, smile=0.55, squint=0.2, brows_up=0.25)
    c.key(1.25, g)
    g2 = P(g)
    c.key(1.45, g2)
    back = P(S)
    look_at(back, PITCHER + np.array([0, 0, 3.0]), tilt=-10)
    face(back, smile=0.6, squint=0.4, brows_angry=0.3)
    put(back, tail__rz=10)
    c.key(1.7, back)
    w4 = P(S)
    bat(w4, (-0.26, -0.01, 3.04), (-0.32, 0.46, 0.83), palm=(1.0, -0.25, 0.25))
    c.key(2.05, w4)
    c.key(2.4, S)
    c.layers.append(breathing(L, 2))
    c.layers.append(blink_at([0.95, 1.72]))
    return c


def clip_stride():
    c = Clip('stride', 0.35)
    S, T = pose_stance(), pose_set()
    c.key(0.0, S)
    a = P(S)                                          # heel peels, weight rocks back, hands start loading
    foot(a, 'L', (0.82, -0.30, 0.17), rz=15, rx=18)
    put(a, hip__x=-0.13, hip__rz=-17, chest__rz=-11)
    bat(a, (-0.38, 0.0, 3.0), (-0.47, 0.42, 0.77), palm=(1.0, -0.3, 0.3))
    c.key(0.08, a)
    b = P(a)                                          # foot up and travelling toward the pitcher
    foot(b, 'L', (0.90, -0.30, 0.34), rz=19, rx=-6)
    V(b, 'kneeL', (0.1, -1, 0.4))
    put(b, hip__z=-0.205, hip__rz=-21, chest__rz=-12)
    bat(b, (-0.46, 0.04, 2.99), (-0.53, 0.41, 0.74), palm=(1.0, -0.3, 0.3))
    c.key(0.17, b)
    d = P(T)                                          # toe touches first
    foot(d, 'L', (1.00, -0.31, 0.13), rz=24, rx=10)
    c.key(0.27, d)
    c.key(0.35, T, mode='stop')
    return c


def clip_power_load():
    c = Clip('power_load', 0.35)
    S, K = pose_stance(), pose_coil()
    c.key(0.0, S)
    a = P(S)
    foot(a, 'L', (0.76, -0.28, 0.24), rz=12, rx=20)
    put(a, hip__x=-0.17, hip__rz=-24, chest__rz=-12, tail__rx=26)
    bat(a, (-0.46, 0.08, 3.04), (-0.5, 0.46, 0.73), palm=(1.0, -0.3, 0.3))
    face(a, brows_angry=0.8, squint=0.45, grin=0.3)
    c.key(0.12, a)
    o = P(K)                                          # overshoot past the coil
    put(o, hip__rz=-44, chest__rz=-18, tail__fluff=0.34, tail__rx=42)
    foot(o, 'L', (0.50, -0.21, 0.84), rz=6, rx=-30, toe=-12)
    bat(o, (-0.67, 0.25, 3.13), (-0.64, 0.53, 0.56), palm=(1.0, -0.3, 0.3))
    c.key(0.27, o)
    c.key(0.35, K, mode='stop')
    return c


def clip_coil_hold():
    L = 0.5
    c = Clip('coil_hold', L, loop=True)
    K = pose_coil()
    c.key(0.0, K)
    k2 = P(K)
    put(k2, hip__z=-0.255, chest__rz=-17, tail__fluff=0.32)
    c.key(0.25, k2)
    c.key(0.5, K)

    def tremble(t):
        a = math.sin(2 * math.pi * 5 * t / L)
        b = math.sin(2 * math.pi * 6 * t / L + 1.3)
        e = math.sin(2 * math.pi * 4 * t / L + 0.4)
        return {'hip.x': 0.007 * a, 'chest.rz': 1.0 * b, 'bat.x': 0.012 * b, 'bat.z': 0.01 * a, 'bat.dx': 0.015 * e,
                'head.rz': 0.9 * a, 'tail.rz': 5 * b, 'cap.z': 0.004 * abs(a), 'footL.z': 0.01 * e, 'sk.squint': 0.05 * b}
    c.layers.append(tremble)
    c.sec_gain = 0.4
    return c


SWING_D = {'high': (0.0, -1.0, 0.10), 'mid': (0.0, -1.0, -0.05), 'low': (0.05, -1.0, -0.36)}


def herm(ts, vs, t):
    """Monotone-ish cubic through (ts, vs) (Catmull-Rom tangents, clamped at extremes)."""
    ts = np.asarray(ts, float)
    vs = np.asarray(vs, float)
    if t <= ts[0]:
        return vs[0]
    if t >= ts[-1]:
        return vs[-1]
    i = int(np.searchsorted(ts, t, side='right') - 1)
    def tan(k):
        if k == 0 or k == len(ts) - 1:
            return 0.0 if k == 0 else (vs[k] - vs[k - 1]) / (ts[k] - ts[k - 1])
        a = (vs[k] - vs[k - 1]) / (ts[k] - ts[k - 1])
        b = (vs[k + 1] - vs[k]) / (ts[k + 1] - ts[k])
        return 0.0 if a * b <= 0 else 2 * a * b / (a + b)
    h = ts[i + 1] - ts[i]
    u = (t - ts[i]) / h
    m0, m1 = tan(i) * h, tan(i + 1) * h
    return (2 * u ** 3 - 3 * u ** 2 + 1) * vs[i] + (u ** 3 - 2 * u ** 2 + u) * m0 + (-2 * u ** 3 + 3 * u ** 2) * vs[i + 1] + (u ** 3 - u ** 2) * m1


def swing_bat_override(height, pivots, set_d, end_t=0.62, fade=(0.50, 0.62), miss=False):
    """Parametric barrel for the swing: heading eased in to exactly 270 deg (pointing at the plate) at t = 0.25 with
    accelerating spacing (peak speed at contact), exponential slow-down after; elevation drops into the slot, meets
    the contact tilt, then rises into the wrap. pivots: [(t, xyz)] for the hands' path (the 0.25 one is replaced by
    the exact contact pivot)."""
    H = CONTACT[height]
    dC = nrm(SWING_D[height])
    th0 = math.degrees(math.atan2(set_d[1], set_d[0])) % 360
    phi0 = math.degrees(math.asin(nrm(set_d)[2]))
    phiC = math.degrees(math.asin(dC[2]))
    p_ease = 2.3
    wc = (270.0 - th0) * p_ease / T_CONTACT          # deg/s at contact
    tau = 0.16
    C = np.array([0.0, -PLATE_D, H])
    pc = C - dC * RR.BAT_SWEET
    pts = [(t, np.asarray(p, float)) for t, p in pivots if abs(t - T_CONTACT) > 1e-6] + [(T_CONTACT, pc)]
    pts.sort(key=lambda a: a[0])
    pt_t = [a[0] for a in pts]
    pt_v = np.array([a[1] for a in pts])
    slot = {'high': 4.0, 'mid': 0.0, 'low': -8.0}[height]
    phis_t = [0.0, 0.08, 0.15, T_CONTACT, 0.32, 0.42, 0.52, end_t]
    phis_v = [phi0, phi0 - 12, slot + 10, phiC, phiC + 12, 30.0, 38.0, 38.0]

    def f(t):
        if t > fade[1]:
            return {}
        if t <= T_CONTACT:
            u = t / T_CONTACT
            th = th0 + (270.0 - th0) * u ** p_ease
        else:
            th = 270.0 + wc * tau * (1 - math.exp(-(t - T_CONTACT) / tau))
        ph = herm(phis_t, phis_v, t)
        if abs(t - T_CONTACT) < 1e-9:
            d = dC
        else:
            d = np.array([math.cos(math.radians(ph)) * math.cos(math.radians(th)), math.cos(math.radians(ph)) * math.sin(math.radians(th)), math.sin(math.radians(ph))])
        piv = np.array([herm(pt_t, pt_v[:, k], t) for k in range(3)])
        # top-hand palm faces the direction of travel (the sweep tangent), lifted toward 'up' while the bat is upright
        tang = np.array([-math.sin(math.radians(th)), math.cos(math.radians(th)), 0.0])
        up_w = max(0.0, (ph - 10) / 40)
        palm = nrm(tang * (1 - 0.5 * up_w) + np.array([1.0, -0.3, 0.3]) * up_w * 0.8 + np.array([0, 0, 0.25]))
        if t > T_CONTACT:                           # wrists roll over after contact: palm turns down
            r = min(1.0, (t - T_CONTACT) / 0.15)
            palm = nrm(palm * (1 - r) + np.array([0.0, 0.0, -1.0]) * r + tang * 0.3 * r)
        w = 1.0 if t <= fade[0] else 1.0 - (t - fade[0]) / (fade[1] - fade[0])
        w = w * w * (3 - 2 * w)
        out = {}
        for k, v in zip(('bat.x', 'bat.y', 'bat.z'), piv):
            out[k] = (float(v), w)
        for k, v in zip(('bat.dx', 'bat.dy', 'bat.dz'), d):
            out[k] = (float(v), w)
        for k, v in zip(('bat.px', 'bat.py', 'bat.pz'), palm):
            out[k] = (float(v), w)
        return out
    return f


def clip_swing(height):
    L = 1.0
    c = Clip('swing_' + height, L)
    S = pose_set()
    H = CONTACT[height]
    dz = H - 2.5
    lo = 1.0 if height == 'low' else 0.0
    hi = 1.0 if height == 'high' else 0.0
    c.key(0.0, S)
    # 0.06 launch: hips fire first, the front leg braces, hands start down, the barrel lags behind the head
    a = P(S)
    put(a, hip__rz=-4, hip__x=-0.02, hip__z=-0.23 - 0.03 * lo, chest__rz=-24, chest__rx=7 + 3 * lo)
    bat(a, (-0.48, 0.02, 2.90 + dz * 0.15), (-0.66, 0.42, 0.62), palm=(0.6, -0.4, 0.7))
    V(a, 'elbowR', (-0.6, 0.3, -0.8))
    foot(a, 'R', STANCE_FEET['R'][0], rz=10, rx=6)
    look_at(a, np.array([3.0, -2.4, H + 0.6]), tilt=-4)
    face(a, brows_angry=0.9, squint=0.5, smile=0.0)
    c.key(0.06, a)
    # 0.12 slot: hips open, back elbow tucks, hands come through close to the body, barrel flattens behind
    b = P(a)
    put(b, hip__rz=22, hip__x=0.05, hip__ry=1 - 4 * lo, chest__rz=-18, spine__ry=-3 * lo, spine__rx=5 + 6 * lo)
    bat(b, (-0.30, -0.30, 2.66 + dz * 0.45), (-0.92, 0.26, 0.26 + 0.1 * hi - 0.1 * lo), palm=(0.1, -0.6, 0.8))
    V(b, 'elbowR', (-0.3, 0.2, -1))
    V(b, 'elbowL', (0.4, -0.2, -1))
    foot(b, 'R', (-0.75, -0.33, 0.13), rz=22, rx=16)
    look_at(b, np.array([1.0, -2.4, H]), tilt=-2)
    c.key(0.12, b)
    # 0.17: the barrel whips round; hips nearly square to the plate
    d = P(b)
    put(d, hip__rz=40, hip__x=0.10, chest__rz=-12)
    bat(d, (-0.20, -0.48, 2.60 + dz * 0.75), (-0.74, -0.66, 0.06 + 0.06 * hi - 0.2 * lo), palm=(-0.1, -0.7, 0.7))
    foot(d, 'R', (-0.73, -0.33, 0.14), rz=34, rx=26)
    look_at(d, np.array([0.0, -2.4, H]))
    c.key(0.17, d, mode='lin')
    # 0.21 smear: arms stretch out toward the ball
    s = P(d)
    put(s, hip__rz=48, hip__x=0.13, chest__rz=-10)
    bat(s, (-0.09, -0.57, 2.58 + dz * 0.92), (-0.36, -0.93, 0.0 + 0.08 * hi - 0.3 * lo), palm=(0.3, -0.6, 0.6))
    foot(s, 'R', (-0.71, -0.33, 0.15), rz=42, rx=32)
    c.key(0.21, s, mode='lin')
    # 0.25 CONTACT: bat_sweet on the plate's centre line at the zone height
    k = P(s)
    put(k, hip__rz=54, hip__x=0.15, hip__z=-0.20 - 0.07 * lo + 0.04 * hi, hip__ry=2 - 6 * lo + 3 * hi,
        spine__rx=4 + 9 * lo, spine__ry=-4 * lo + 2 * hi, chest__rz=-12, chest__rx=4 + 5 * lo - 4 * hi, chest__ry=-3 * lo)
    bat_contact(k, H, SWING_D[height], palm=(1.0, 0.0, 0.25))
    foot(k, 'R', (-0.69, -0.32, 0.16), rz=50, rx=38)
    V(k, 'kneeR', (0.7, -1, -0.2))
    V(k, 'kneeL', (0.2, -1, 0.0))
    look_at(k, np.array([0.0, -2.4, H]), tilt=0)
    face(k, brows_angry=1.0, squint=0.65, grin=0.85)
    c.key(T_CONTACT, k, mode='lin')
    # 0.30: through the ball, wrists begin to roll
    f1 = P(k)
    put(f1, hip__rz=70, hip__x=0.17, chest__rz=8)
    bat(f1, (0.24, -0.58, 2.72 + dz * 0.65), (0.66, -0.68, 0.30), palm=(0.3, 0.2, -1.0))
    foot(f1, 'R', (-0.64, -0.31, 0.16), rz=64, rx=48)
    look_at(f1, np.array([6.0, -3.0, H + 1.0]))
    c.key(0.30, f1)
    # 0.36: barrel out toward the pitcher and rising
    f2 = P(f1)
    put(f2, hip__rz=80, chest__rz=24, hip__ry=4)
    bat(f2, (0.40, -0.36, 2.92), (0.94, -0.02, 0.34), palm=(-0.2, 0.4, -1.0))
    foot(f2, 'R', (-0.60, -0.30, 0.15), rz=74, rx=54)
    look_at(f2, np.array([14.0, -3.0, H + 4.0]))
    face(f2, brows_up=0.4, grin=0.6, squint=0.2)
    c.key(0.36, f2)
    # 0.45: wrap over the front shoulder
    F = follow_pose(height)
    f3 = P(F)
    put(f3, chest__rz=40, hip__rz=88)
    bat(f3, (0.38, -0.06, 3.14), (0.46, 0.60, 0.65), palm=(-0.9, 0.3, -0.4))
    c.key(0.45, f3)
    # 0.56: overshoot - the body over-rotates and teeters
    o = P(F)
    put(o, chest__rz=46, hip__rz=93, hip__ry=8, chest__ry=10)
    bat(o, (0.27, 0.12, 3.22), (-0.08, 0.80, 0.60), palm=(-1, 0.1, -0.3))
    face(o, smile=0.9, brows_up=0.5)
    c.key(0.56, o)
    # 0.72: settle, top hand lets go; 1.0 admire the ball
    st = P(F)
    st['gripR'] = 0.0
    hand(st, 'R', (-0.55, -0.20, 1.85), rx=-20, rel=1)
    V(st, 'elbowR', (-0.5, 0.6, -0.6))
    c.key(0.72, st)
    w = P(st)
    look_at(w, FLIGHT + np.array([0, 0, 6.0]), tilt=6)
    face(w, smile=1.0, brows_up=0.45, squint=0.25)
    c.key(1.0, w, mode='stop')
    # top hand still on the bat at 0.62 (in-between of overshoot and settle), lets go by 0.72
    mid = lerp_pose(o, st, 0.4)
    mid['gripR'] = 1.0
    c.key(0.62, mid)
    c.keys.sort(key=lambda k_: k_[0])
    piv = [(k_[0], (k_[1]['bat.x'], k_[1]['bat.y'], k_[1]['bat.z'])) for k_ in c.keys if k_[0] <= 0.63]
    set_d = (S['bat.dx'], S['bat.dy'], S['bat.dz'])
    c.overrides.append(swing_bat_override(height, piv, set_d))

    def smear(t):               # 0 at 0.17, peak at 0.21, exactly 0 again at contact
        u = (t - 0.17) / 0.08
        v = math.sin(math.pi * u) ** 2 if 0.0 < u < 1.0 else 0.0
        return {'smear': v, 'bat.len': 0.38 * v}
    c.layers.append(smear)
    c.sec_gain = 1.2
    return c


def clip_whiff():
    L = 1.4
    c = Clip('whiff', L)
    S = pose_set()
    c.key(0.0, S)
    a = P(S)
    put(a, hip__rz=-2, chest__rz=-24)
    bat(a, (-0.47, 0.0, 2.86), (-0.70, 0.44, 0.56), palm=(0.6, -0.4, 0.7))
    face(a, brows_angry=1.0, squint=0.6, grin=0.5)
    c.key(0.07, a)
    b = P(a)                                          # a mighty cut...
    put(b, hip__rz=40, hip__x=0.08, chest__rz=-8)
    bat(b, (-0.20, -0.46, 2.50), (-0.80, -0.58, -0.10), palm=(0.0, -0.7, 0.7))
    foot(b, 'R', (-0.74, -0.33, 0.14), rz=30, rx=22)
    c.key(0.17, b, mode='lin')
    k = P(b)                                          # ...at nothing (the barrel passes under the ball)
    put(k, hip__rz=66, hip__x=0.16, chest__rz=4, hip__z=-0.26)
    bat(k, (0.05, -0.62, 2.30), (0.20, -0.96, -0.20), palm=(1.0, 0.0, 0.3))
    foot(k, 'R', (-0.68, -0.32, 0.16), rz=52, rx=40)
    look_at(k, np.array([0.0, -2.4, 2.4]))
    face(k, mouth_open=0.7, brows_up=0.9, grin=0.0)
    c.key(0.25, k, mode='lin')
    # corkscrew: momentum spins him right round, legs twisting
    s1 = P(k)
    put(s1, hip__rz=170, hip__z=-0.30, hip__x=0.05, chest__rz=50, root__s=0.92, tail__rz=60)
    bat(s1, (0.45, 0.35, 2.55), (0.55, 0.80, 0.15), palm=(0, 0, -1))
    foot(s1, 'L', (0.78, -0.25, 0.11), rz=110)
    foot(s1, 'R', (0.10, -0.62, 0.40), rz=150, rx=20)
    c.key(0.42, s1)
    s2 = P(s1)
    put(s2, hip__rz=300, hip__z=-0.24, hip__x=0.10, chest__rz=40, root__s=1.04, tail__rz=40)
    bat(s2, (-0.35, 0.45, 2.45), (-0.70, 0.55, -0.40), palm=(0, 0, -1))
    foot(s2, 'L', (0.55, -0.15, 0.11), rz=230)
    foot(s2, 'R', (0.20, 0.20, 0.11), rz=280)
    V(s2, 'kneeL', (0.4, 1, 0))
    V(s2, 'kneeR', (-0.4, 0.4, 0))
    face(s2, mouth_open=0.5, brows_sad=0.5, blink=0.25)
    c.key(0.62, s2)
    D = pose_dizzy()
    d1 = P(D)                                         # overshoot the unwind, teeter
    put(d1, hip__rz=372, hip__ry=12, head__ry=-24, hip__x=0.08)
    foot(d1, 'L', (0.42, -0.28, 0.11), rz=332)
    foot(d1, 'R', (-0.38, -0.28, 0.11), rz=390)
    c.key(0.86, d1)
    d2 = P(D)
    put(d2, hip__rz=356, hip__ry=-4, head__ry=-8)
    foot(d2, 'L', (0.40, -0.30, 0.11), rz=332)
    foot(d2, 'R', (-0.40, -0.30, 0.11), rz=390)
    c.key(1.1, d2)
    d3 = P(D)
    put(d3, hip__rz=360)
    foot(d3, 'L', (0.40, -0.30, 0.11), rz=332)
    foot(d3, 'R', (-0.40, -0.30, 0.11), rz=390)
    c.key(1.4, d3, mode='stop')
    c.sec_gain = 1.3
    return c


def clip_dizzy():
    L = 1.6
    c = Clip('dizzy', L, loop=True)
    D = pose_dizzy()
    c.key(0.0, D)
    c.key(1.6, D)

    def wobble(t):
        a = 2 * math.pi * t / L
        return {'hip.x': 0.10 * math.sin(a), 'hip.y': 0.07 * math.cos(a), 'hip.ry': 9 * math.sin(a), 'hip.rx': 5 * math.cos(a),
                'chest.ry': -7 * math.sin(a + 0.6), 'head.ry': -16 * math.sin(a + 1.2), 'head.rx': 9 * math.cos(a + 1.2),
                'head.rz': 10 * math.sin(a + 2.0), 'chest.rz': 5 * math.sin(a + 0.3),
                'eyeL.rx': 13 * math.sin(2 * a), 'eyeL.rz': 8 * math.cos(2 * a),
                'eyeR.rx': -13 * math.sin(2 * a + 0.9), 'eyeR.rz': 8 * math.cos(2 * a + 0.9),
                'bat.x': 0.07 * math.sin(a + 0.5), 'bat.y': 0.04 * math.cos(a), 'tail.rz': 22 * math.sin(a + 1.2),
                'sk.mouth_open': 0.1 * math.sin(2 * a), 'sk.blink': 0.1 * math.sin(a), 'hip.z': 0.02 * math.cos(2 * a)}
    c.layers.append(wobble)
    return c


def clip_watch():
    L = 1.2
    c = Clip('watch', L, loop=True)
    F = follow_pose('mid')
    F['gripR'] = 0.0
    hand(F, 'R', (-0.55, -0.20, 1.85), rx=-20, rel=1)
    V(F, 'elbowR', (-0.5, 0.6, -0.6))
    look_at(F, FLIGHT + np.array([0, 0, 6.0]), tilt=6)
    face(F, smile=1.0, brows_up=0.45, squint=0.25)
    c.key(0.0, F)
    g = P(F)
    put(g, hip__x=0.19, chest__ry=11, hip__ry=7)
    look_at(g, FLIGHT + np.array([4, 0, 3.0]), tilt=10)
    face(g, smile=1.0, brows_up=0.6, squint=0.35)
    c.key(0.6, g)
    c.key(1.2, F)
    c.layers.append(breathing(L, 1, 0.8))
    return c


def clip_bat_flip():
    L = 1.3
    c = Clip('bat_flip', L)
    F = follow_pose('mid')
    F['gripR'] = 0.0
    hand(F, 'R', (-0.55, -0.20, 1.85), rx=-20, rel=1)
    V(F, 'elbowR', (-0.5, 0.6, -0.6))
    look_at(F, FLIGHT + np.array([0, 0, 6.0]), tilt=6)
    face(F, smile=1.0, brows_up=0.45, squint=0.25)
    c.key(0.0, F)
    a = P(F)                                          # wind: bat swings down in front of him
    bat(a, (0.62, -0.50, 2.20), (0.55, -0.35, -0.76), palm=(0, -1, 0))
    put(a, chest__rz=18, hip__rz=70)
    V(a, 'elbowL', (0.8, 0.3, -0.5))
    c.key(0.16, a)
    b = P(a)                                          # flick! the bat leaves the hand spinning
    b['gripL'] = 0.0
    hand(b, 'L', (0.95, -0.55, 3.20), rx=-60, rel=1)
    V(b, 'elbowL', (0.8, 0.4, -0.2))
    bat(b, (1.15, -0.95, 3.45), (0.40, 0.25, 0.88), palm=(0, -1, 0))
    put(b, chest__rz=8, chest__rx=-8, fingL=50, thumbL=30)
    c.key(0.28, b)
    path = [(0.42, (1.7, -1.1, 4.9), 0.0), (0.56, (2.3, -1.25, 5.8), 1.0), (0.70, (2.9, -1.4, 6.1), 2.0),
            (0.84, (3.5, -1.55, 5.7), 3.0), (0.98, (4.1, -1.7, 4.5), 4.0), (1.12, (4.6, -1.8, 2.6), 5.0), (1.3, (5.0, -1.9, 0.3), 5.6)]
    prev = b
    for t, p, turn in path:
        k = P(prev)
        ang = turn * math.pi / 2 + 1.2
        d = (0.35 * math.sin(ang), -0.25 * math.sin(ang), math.cos(ang))
        bat(k, p, d, palm=(0, -1, 0))
        prev = k
        if t == 0.56:                                 # chin up, chest out: the strut begins
            put(k, chest__rx=-14, hip__rz=40, chest__rz=-4, hip__z=-0.06, hip__x=0.02, hip__rx=-2, fingL=0, thumbL=0)
            hand(k, 'L', (0.54, 0.06, 2.02), rx=-40, rz=-20, rel=1)
            hand(k, 'R', (-0.54, 0.06, 2.02), rx=-40, rz=20, rel=1)
            V(k, 'elbowL', (0.9, 0.6, 0.0))
            V(k, 'elbowR', (-0.9, 0.6, 0.0))
            foot(k, 'R', (-0.50, -0.33, 0.11), rz=40)
            look_at(k, np.array([6.0, -12.0, 9.0]), tilt=8)
            face(k, smile=1.0, squint=0.5, brows_up=0.2)
        if t == 0.70:
            put(k, hip__z=-0.02, chest__ry=-6, hip__ry=4, head__ry=6)
        if t == 0.84:                                 # strut step
            foot(k, 'L', (0.70, -0.50, 0.36), rz=30, rx=-10)
            put(k, hip__z=0.02, hip__ry=-6, chest__ry=8, head__rx=-24, head__ry=-6)
        if t == 0.98:
            put(k, hip__z=-0.10, chest__ry=-4)
            foot(k, 'L', (0.66, -0.58, 0.11), rz=24)
        if t == 1.12:
            foot(k, 'R', (-0.40, -0.52, 0.30), rz=20, rx=-10)
            put(k, hip__z=-0.02, hip__ry=5, chest__ry=-8, head__rx=-18, head__ry=6)
        if t == 1.3:
            foot(k, 'R', (-0.36, -0.62, 0.11), rz=14)
            put(k, hip__z=-0.08, hip__ry=0, chest__ry=0)
        c.key(t, k)
    return c


def clip_run():
    """Cartoon sprint, two strides per loop: contact, down, passing, up for each leg; arms pump opposite; in place."""
    L = 0.5
    c = Clip('run', L, loop=True)
    b0 = pose_neutral()
    put(b0, hip__rx=26, spine__rx=6, chest__rx=8, neck__rx=-14, head__rx=-20, tail__rx=-26, tail__curl=-6)
    face(b0, grin=0.45, brows_angry=0.45, squint=0.15, mouth_open=0.12)
    # foot cycle (phase -> ball y, z, foot pitch): contact in front, under, push-off, kick, pass high, drive, reach
    cyc = [(0.0, -0.66, 0.14, -14), (0.125, -0.12, 0.11, 0), (0.25, 0.52, 0.14, 42), (0.375, 0.62, 0.80, 75),
           (0.5, 0.04, 0.84, 26), (0.625, -0.56, 0.66, -4), (0.75, -0.82, 0.34, -20), (0.875, -0.76, 0.18, -18)]
    def footcyc(ph):
        ph = ph % 1.0
        for i in range(len(cyc)):
            a = cyc[i]
            b = cyc[(i + 1) % len(cyc)]
            t1 = b[0] if b[0] > a[0] else 1.0
            if a[0] <= ph < t1:
                u = (ph - a[0]) / (t1 - a[0])
                u = u * u * (3 - 2 * u)
                return [a[k] + (b[k] - a[k]) * u for k in (1, 2, 3)]
        return list(cyc[0][1:])
    bob = {0.0: -0.05, 0.0625: -0.13, 0.125: -0.08, 0.1875: 0.02}
    n = 8
    for k in range(n + 1):
        ph = k / n
        q = P(b0)
        for side, sg, off in (('L', 1, 0.0), ('R', -1, 0.5)):
            y, z, rx = footcyc(ph + off)
            foot(q, side, (sg * 0.27, y, z), rx=rx, toe=-0.4 * max(rx, 0))
            V(q, 'knee' + side, (0.05 * sg, -1, 0.3))
            # arm opposite to this leg: forward (fist at the chin) when the other leg is forward
            v = 2 * math.pi * (ph + off + 0.5)
            fwd = 0.5 + 0.5 * math.cos(v)
            hand(q, side, (sg * (0.46 - 0.14 * fwd), 0.42 - 1.05 * fwd, 1.98 + 0.78 * fwd), rx=-40 - 35 * fwd, rel=1)
            V(q, 'elbow' + side, (0.35 * sg, 1.0, -0.6 + 0.5 * fwd))
        u = (ph % 0.5) / 0.5
        hz = -0.16 - 0.08 * math.sin(math.pi * min(u / 0.25, 1.0)) if u < 0.25 else -0.16 + 0.09 * math.sin(math.pi * (u - 0.25) / 0.75)
        put(q, hip__z=hz, hip__rz=10 * math.cos(2 * math.pi * ph), chest__rz=-16 * math.cos(2 * math.pi * ph),
            hip__ry=-3 * math.sin(2 * math.pi * ph), head__rz=4 * math.cos(2 * math.pi * ph))
        c.key(ph * L, q)
    c.tail_lag = 0.03

    def stream(t):
        a = 2 * math.pi * t / L
        return {'tail.rz': 12 * math.sin(a), 'tail.rx': 4 * math.sin(2 * a), 'earL.rx': -26, 'earR.rx': -26}
    c.layers.append(stream)
    c.sec_gain = 0.7
    return c


def clip_trot():
    """Home-run trot: chest out, chin up, right fist tipping the cap brim, jaunty bounce. In place."""
    L = 0.8
    c = Clip('trot', L, loop=True)
    b0 = pose_neutral()
    put(b0, chest__rx=-12, spine__rx=-5, neck__rx=-2, head__rx=-10, head__ry=-12, tail__rx=30, tail__curl=12,
        shR__ry=-22, shR__rx=-10)
    face(b0, smile=0.95, squint=0.45, brows_up=0.25)
    n = 8
    for k in range(n + 1):
        ph = k / n
        q = P(b0)
        u0 = 2 * math.pi * ph
        for side, sg, off in (('L', 1, 0.0), ('R', -1, 0.5)):
            u = 2 * math.pi * (ph + off)
            lift = max(0.0, math.sin(u))
            foot(q, side, (sg * 0.30, -0.30 - 0.48 * math.cos(u), 0.11 + 0.62 * lift ** 1.3), rx=-20 * lift + 14 * max(0.0, -math.sin(u)))
            V(q, 'knee' + side, (0.12 * sg, -1, 0.3))
        hand(q, 'R', (-0.46, -0.58, 4.28 + 0.03 * math.sin(2 * u0)), rx=-70, rz=25, rel=1)
        V(q, 'elbowR', (-1.0, 0.1, -0.2))
        hand(q, 'L', (0.60, 0.05 - 0.32 * math.cos(u0), 1.80 + 0.10 * max(0.0, -math.cos(u0))), rx=-20 * math.cos(u0) - 15, rel=1)
        V(q, 'elbowL', (0.5, 1.0, -0.2))
        put(q, hip__z=-0.10 + 0.12 * abs(math.sin(u0)), hip__rz=9 * math.cos(u0), chest__rz=-11 * math.cos(u0),
            cap__rx=8, cap__ry=-8, cap__z=0.02, hip__ry=3 * math.sin(u0))
        c.key(ph * L, q)
    c.sec_gain = 0.8
    return c


def clip_cheer():
    L = 1.2
    c = Clip('cheer', L)
    n = pose_neutral()
    face(n, smile=0.6)
    c.key(0.0, n)
    a = P(n)                                          # crouch: anticipation
    put(a, hip__z=-0.34, hip__rx=20, chest__rx=12, head__rx=10, root__s=0.92)
    hand(a, 'R', (-0.46, 0.30, 1.85), rx=-10, rel=1)
    hand(a, 'L', (0.46, 0.30, 1.85), rx=-10, rel=1)
    V(a, 'kneeL', (0.2, -1, 0))
    V(a, 'kneeR', (-0.2, -1, 0))
    face(a, grin=0.6, squint=0.6, brows_angry=0.3)
    c.key(0.18, a)
    t_ = P(a)                                         # launch: stretch
    put(t_, hip__z=0.25, hip__rx=-4, chest__rx=-10, head__rx=-14, root__s=1.10)
    foot(t_, 'L', (0.36, -0.30, 0.20), rx=35)
    foot(t_, 'R', (-0.36, -0.30, 0.20), rx=35)
    hand(t_, 'R', (-0.40, -0.30, 3.50), rx=-60, rel=1)
    V(t_, 'elbowR', (-1, 0.2, 0))
    c.key(0.30, t_)
    j = P(n)                                          # apex: fist punched to the sky, legs tucked
    put(j, hip__z=0.62, hip__rx=-6, chest__rx=-14, head__rx=-22, root__s=1.04, tail__rx=35)
    foot(j, 'L', (0.34, -0.12, 0.72), rx=-40)
    foot(j, 'R', (-0.34, 0.05, 0.78), rx=-30)
    V(j, 'kneeL', (0.2, -1, 0.4))
    V(j, 'kneeR', (-0.2, -1, 0.4))
    hand(j, 'R', (-0.36, -0.20, 4.45), rx=-80, rel=1)
    V(j, 'elbowR', (-1, 0.2, 0))
    hand(j, 'L', (0.58, -0.25, 2.30), rx=-50, rel=1)
    face(j, grin=1.0, brows_up=0.9, mouth_open=0.3)
    c.key(0.47, j)
    p2 = P(j)
    put(p2, hip__z=0.50)
    hand(p2, 'R', (-0.34, -0.28, 4.30), rx=-70, rel=1)
    c.key(0.58, p2)
    l = P(n)                                          # land: squash, the fist yanks down - "YES!"
    put(l, hip__z=-0.28, hip__rx=16, chest__rx=12, root__s=0.88)
    hand(l, 'R', (-0.42, -0.45, 2.40), rx=-70, rel=1)
    V(l, 'elbowR', (-1, 0.6, -0.2))
    face(l, grin=1.0, squint=0.55, brows_angry=0.2)
    c.key(0.72, l)
    r = P(n)
    put(r, hip__z=-0.02, root__s=1.02)
    hand(r, 'R', (-0.44, -0.42, 2.55), rx=-70, rel=1)
    face(r, smile=1.0, brows_up=0.4, squint=0.3)
    c.key(0.86, r)
    e = P(r)
    put(e, root__s=1.0, hip__z=-0.04)
    c.key(1.2, e, mode='stop')
    return c


def clip_take():
    L = 0.8
    c = Clip('take', L)
    T, S = pose_set(), pose_stance()
    c.key(0.0, T)
    a = P(T)                                          # watches the ball all the way into the mitt
    put(a, hip__x=-0.13, chest__rx=0)
    look_at(a, MITT, tilt=4)
    face(a, brows_up=0.35, squint=0.2)
    c.key(0.18, a)
    b = P(a)                                          # little lean back, a smug shrug
    put(b, chest__ry=-6, shL__ry=-10, shR__ry=10, hip__z=-0.17)
    look_at(b, MITT + np.array([0, 0, 1.0]), tilt=8)
    face(b, smile=0.6, brows_up=0.6, squint=0.3)
    bat(b, (-0.40, 0.0, 2.95), (-0.52, 0.42, 0.74), palm=(1.0, -0.3, 0.3))
    c.key(0.42, b)
    d = P(b)
    put(d, shL__ry=0, shR__ry=0)
    look_at(d, PITCHER, tilt=-6)
    c.key(0.6, d)
    c.key(0.8, S, mode='stop')
    return c


def clip_strike_react():
    L = 1.4
    c = Clip('strike_react', L)
    T, S = pose_set(), pose_stance()
    c.key(0.0, T)
    a = P(T)                                          # wind up: back foot lifts, fists clench, head snaps to the ump
    foot(a, 'R', (-0.66, -0.26, 0.62), rz=8, rx=-20)
    V(a, 'kneeR', (0.0, -1, 0.6))
    put(a, hip__x=0.05, hip__z=-0.12, chest__rx=-6, root__s=1.05)
    look_at(a, UMP, tilt=-6)
    face(a, frown=0.8, brows_angry=1.0, mouth_open=0.2)
    c.key(0.16, a)
    b = P(a)                                          # STOMP
    foot(b, 'R', (-0.74, -0.33, 0.11), rz=6)
    put(b, root__s=0.88, hip__z=-0.27, chest__rx=10)
    face(b, frown=1.0, brows_angry=1.0, mouth_open=0.55)
    c.key(0.26, b, mode='lin')
    g = P(b)                                          # glare, leaning in at the ump
    put(g, root__s=1.0, hip__z=-0.15, hip__x=-0.10, chest__rx=-4, chest__rz=-22)
    look_at(g, UMP, tilt=-8)
    face(g, frown=0.9, brows_angry=1.0, squint=0.5, mouth_open=0.25)
    c.key(0.45, g)
    g2 = P(g)
    c.key(0.78, g2)
    s = P(S)                                          # slump
    put(s, chest__rx=20, spine__rx=10, hip__z=-0.20, shL__ry=8, shR__ry=-8)
    look_at(s, np.array([1.5, -3.2, 1.6]), tilt=-8)
    face(s, frown=0.7, brows_sad=0.85, blink=0.35)
    bat(s, (-0.10, -0.40, 2.40), (-0.30, -0.10, 0.95), palm=(1.0, -0.2, 0.2))
    c.key(1.05, s)
    c.key(1.4, S, mode='stop')
    return c


def all_clips():
    return [clip_stance(), clip_stride(), clip_power_load(), clip_coil_hold(), clip_swing('high'), clip_swing('mid'),
            clip_swing('low'), clip_whiff(), clip_dizzy(), clip_watch(), clip_bat_flip(), clip_run(), clip_trot(),
            clip_cheer(), clip_take(), clip_strike_react()]

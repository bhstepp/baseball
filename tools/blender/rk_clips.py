# rk_clips.py - Rocco's animation clips as key poses (Blender space: Z up, he faces -Y, his left/+X is the pitcher).
# The plate centre is at (0, -PLATE_D, 0) in his space; swing contact (t = 0.25 s exactly) puts bat_sweet on the
# plate's centre line at the zone height of each clip.
import math
import numpy as np
import rk_anim as A
import rk_rig as RR
from rk_anim import Clip

PLATE_D = 2.4
CONTACT = {'high': 3.3, 'mid': 2.5, 'low': 1.8}
T_CONTACT = 0.25


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


def bat(c, pivot, d, palm=(1, 0, 0)):
    d = np.asarray(d, float)
    d = d / np.linalg.norm(d)
    c['bat.x'], c['bat.y'], c['bat.z'] = map(float, pivot)
    c['bat.dx'], c['bat.dy'], c['bat.dz'] = map(float, d)
    c['bat.px'], c['bat.py'], c['bat.pz'] = map(float, palm)
    return c


def bat_contact(c, height, d, palm=(1, 0, 0)):
    d = np.asarray(d, float)
    d = d / np.linalg.norm(d)
    C = np.array([0.0, -PLATE_D, height])
    return bat(c, C - d * RR.BAT_SWEET, d, palm)


def foot(c, side, ball, rz=0.0, rx=0.0, ry=0.0, toe=0.0):
    V(c, 'foot' + side, ball)
    c['foot%s.rz' % side], c['foot%s.rx' % side], c['foot%s.ry' % side] = rz, rx, ry
    c['toe%s.rx' % side] = toe
    return c


def hand(c, side, pos, rx=0.0, ry=0.0, rz=0.0, grip=0.0):
    V(c, 'hand' + side, pos)
    c['hand%s.rx' % side], c['hand%s.ry' % side], c['hand%s.rz' % side] = rx, ry, rz
    c['grip' + side] = grip
    return c


def face(c, **kw):
    for k in A.SHAPE_KEYS:
        c['sk.' + k] = 0.0
    for k, v in kw.items():
        c['sk.' + k] = v
    return c


# ------------------------------------------------------------------------------------------- key poses
def pose_neutral():
    c = base()
    hand(c, 'L', (0.62, 0.02, 1.55))
    hand(c, 'R', (-0.62, 0.02, 1.55))
    c['bat.vis'] = 0.0
    return c


def pose_stance():
    c = base()
    put(c, hip__x=-0.10, hip__y=0.04, hip__z=-0.16, hip__rx=10, hip__ry=-3, hip__rz=-12,
        spine__rx=5, chest__rx=7, chest__rz=-12, chest__ry=-3,
        neck__rz=26, neck__rx=-4, head__rz=44, head__rx=-8, head__ry=6)
    foot(c, 'L', (0.80, -0.30, 0.11), rz=16)
    foot(c, 'R', (-0.74, -0.34, 0.11), rz=4)
    V(c, 'kneeL', (0.5, -1, 0))
    V(c, 'kneeR', (-0.3, -1, 0))
    bat(c, (-0.38, -0.10, 3.02), (-0.40, 0.36, 0.84), palm=(0.9, -0.2, 0.3))
    c['gripL'], c['gripR'] = 1.0, 1.0
    V(c, 'elbowL', (0.3, 0.2, -1.0))
    V(c, 'elbowR', (-1.0, 0.6, -0.1))
    put(c, tail__rx=8, tail__curl=4)
    face(c, smile=0.35, squint=0.2, brows_angry=0.25)
    return c


def pose_set():
    c = pose_stance()
    put(c, hip__x=-0.07, hip__z=-0.2, hip__rz=-18, hip__rx=12, chest__rz=-12, chest__rx=8,
        neck__rz=30, head__rz=50)
    foot(c, 'L', (1.02, -0.32, 0.11), rz=22)
    bat(c, (-0.52, 0.02, 3.0), (-0.50, 0.46, 0.74), palm=(0.9, -0.2, 0.3))
    face(c, brows_angry=0.55, squint=0.3)
    return c


def pose_coil():
    c = pose_stance()
    put(c, hip__x=-0.16, hip__z=-0.24, hip__rz=-34, hip__rx=14, chest__rz=-22, chest__rx=10, chest__ry=-6,
        neck__rz=38, head__rz=58, head__rx=-2, tail__rx=30, tail__fluff=0.25, tail__curl=12)
    foot(c, 'L', (0.55, -0.22, 0.62), rz=10, rx=-25, toe=-10)
    V(c, 'kneeL', (0.0, -1.0, 0.6))
    bat(c, (-0.62, 0.18, 3.08), (-0.6, 0.5, 0.62), palm=(0.9, -0.2, 0.3))
    face(c, brows_angry=1.0, squint=0.55, grin=0.45)
    return c


def pose_dizzy():
    c = pose_neutral()
    put(c, hip__z=-0.08, hip__ry=4, spine__rx=8, chest__rx=6, neck__rx=10, head__ry=-14, head__rx=6,
        tail__rx=-40, tail__curl=-10)
    foot(c, 'L', (0.46, -0.30, 0.11), rz=30)
    foot(c, 'R', (-0.40, -0.30, 0.11), rz=-28)
    V(c, 'kneeL', (-0.6, -1, 0))
    V(c, 'kneeR', (0.6, -1, 0))
    # bat drooping from the left hand
    bat(c, (0.55, -0.35, 1.45), (0.25, -0.55, -0.8), palm=(0, -0.3, 1))
    c['gripL'], c['gripR'] = 1.0, 0.0
    hand(c, 'R', (-0.6, 0.05, 1.45), rz=10)
    c['bat.vis'] = 1.0
    face(c, mouth_open=0.35, brows_sad=0.6, blink=0.35)
    return c


def follow_pose(height):
    c = pose_stance()
    dz = {'high': 0.15, 'mid': 0.0, 'low': -0.12}[height]
    put(c, hip__x=0.16, hip__y=0.0, hip__z=-0.14 + dz * 0.3, hip__rz=78, hip__rx=6, hip__ry=4,
        spine__rx=2, chest__rz=32, chest__rx=-2, chest__ry=8, neck__rz=-10, head__rz=-36, head__rx=-12)
    foot(c, 'L', (1.02, -0.32, 0.11), rz=40)
    foot(c, 'R', (-0.62, -0.28, 0.16), rz=70, rx=55, toe=0)
    V(c, 'kneeR', (0.4, -1, -0.2))
    bat(c, (0.30, 0.10, 3.20), (-0.05, 0.75, 0.66), palm=(-1, 0.0, -0.3))
    V(c, 'elbowL', (0.6, 0.0, -1))
    V(c, 'elbowR', (-0.3, -0.5, -1))
    put(c, tail__rx=20, tail__rz=-30, tail__curl=10)
    face(c, smile=0.7, brows_up=0.3)
    return c


# ------------------------------------------------------------------------------------------- clips
def breathing(amp=1.0, period=None, L=2.4):
    n = max(1, round(L / (period or 1.2)))
    w = 2 * math.pi * n / L

    def f(t):
        s = math.sin(w * t)
        return {'chest.s': 0.012 * s * amp, 'hip.z': 0.006 * s * amp, 'chest.rx': -1.0 * s * amp}
    return f


def clip_stance():
    L = 2.4
    c = Clip('stance', L, loop=True)
    S = pose_stance()
    c.key(0.0, S)
    # cocky waggle: barrel circles, a glance at the pitcher (head settles), blink
    w1 = P(S)
    bat(w1, (-0.36, -0.08, 3.06), (-0.30, 0.42, 0.86), palm=(0.9, -0.2, 0.3))
    put(w1, head__rz=40, head__rx=-10, tail__rz=12)
    c.key(0.6, w1)
    w2 = P(S)
    bat(w2, (-0.42, -0.14, 2.98), (-0.48, 0.28, 0.83), palm=(0.9, -0.2, 0.3))
    put(w2, head__rz=50, head__rx=-4, tail__rz=-10)
    face(w2, smile=0.45, squint=0.35, brows_angry=0.15)
    c.key(1.2, w2)
    w3 = P(S)
    bat(w3, (-0.34, -0.06, 3.04), (-0.36, 0.44, 0.82), palm=(0.9, -0.2, 0.3))
    put(w3, tail__rz=8)
    c.key(1.8, w3)
    c.key(2.4, S)
    c.layers.append(breathing(1.0, 1.2, L))

    def blink(t):
        u = (t - 1.55) / 0.12
        return {'sk.blink': math.sin(u * math.pi) if 0 <= u <= 1 else 0.0}
    c.layers.append(blink)
    return c


def clip_stride():
    c = Clip('stride', 0.35)
    S, T = pose_stance(), pose_set()
    c.key(0.0, S)
    m = P(S)
    foot(m, 'L', (0.86, -0.28, 0.36), rz=18, rx=-12)
    put(m, hip__rz=-20, hip__z=-0.17, chest__rz=-14)
    bat(m, (-0.48, 0.0, 3.04), (-0.48, 0.44, 0.76), palm=(0.9, -0.2, 0.3))
    c.key(0.15, m)
    c.key(0.35, T, mode='stop')
    return c


def clip_power_load():
    c = Clip('power_load', 0.35)
    S, K = pose_stance(), pose_coil()
    c.key(0.0, S)
    m = P(K)
    put(m, hip__rz=-38, tail__fluff=0.3)
    c.key(0.26, m)
    c.key(0.35, K, mode='stop')
    return c


def clip_coil_hold():
    L = 0.5
    c = Clip('coil_hold', L, loop=True)
    K = pose_coil()
    c.key(0.0, K)
    k2 = P(K)
    put(k2, hip__z=-0.25, chest__rz=-23)
    c.key(0.25, k2)
    c.key(0.5, K)

    def tremble(t):
        a = math.sin(2 * math.pi * 5 * t / L)
        b = math.sin(2 * math.pi * 7 * t / L + 1.3)
        return {'hip.x': 0.006 * a, 'chest.rz': 0.8 * b, 'bat.x': 0.01 * b, 'bat.z': 0.008 * a, 'head.rz': 0.8 * a,
                'tail.rz': 4 * b, 'cap.z': 0.004 * abs(a)}
    c.layers.append(tremble)
    return c


def clip_swing(height):
    L = 1.0
    c = Clip('swing_' + height, L)
    S = pose_set()
    H = CONTACT[height]
    dz = H - 2.5
    c.key(0.0, S)
    # 0.07: hips fire, hands drop into the slot, barrel lags
    a = P(S)
    put(a, hip__rz=2, hip__x=0.0, hip__z=-0.22, chest__rz=-20, neck__rz=28, head__rz=40)
    bat(a, (-0.48, -0.06, 2.86 + dz * 0.2), (-0.78, 0.52, 0.34), palm=(0.4, -0.4, 0.8))
    V(a, 'elbowR', (-0.4, 0.6, -1.0))
    c.key(0.07, a)
    # 0.14: hips open, hands come through close to the body, barrel still behind
    b = P(a)
    put(b, hip__rz=28, hip__x=0.08, chest__rz=-14, neck__rz=12, head__rz=20, head__rx=4)
    bat(b, (-0.28, -0.34, 2.62 + dz * 0.5), (-0.93, 0.1, 0.12 + dz * 0.05), palm=(0.1, -0.6, 0.8))
    foot(b, 'R', (-0.72, -0.34, 0.11), rz=20, rx=15)
    c.key(0.14, b)
    # 0.20: smear - arms stretch, barrel whipping round
    s = P(b)
    put(s, hip__rz=44, hip__x=0.12, chest__rz=-12, neck__rz=-4, head__rz=0, head__rx=10)
    bat(s, (-0.16, -0.62, 2.55 + dz * 0.75), (-0.62, -0.78, -0.02 + dz * 0.08), palm=(-0.1, -0.7, 0.7))
    foot(s, 'R', (-0.70, -0.34, 0.12), rz=36, rx=25)
    c.key(0.20, s, mode='lin')
    # 0.25 CONTACT
    k = P(s)
    put(k, hip__rz=52, hip__x=0.15, chest__rz=-14, neck__rz=-12, head__rz=-24, head__rx=16, hip__ry=2 - dz * 6,
        spine__ry=-dz * 8, chest__ry=-dz * 4)
    dd = {'high': (0.0, -1.0, 0.10), 'mid': (0.0, -1.0, -0.06), 'low': (0.04, -1.0, -0.36)}[height]
    bat_contact(k, H, dd, palm=(1.0, 0.0, 0.25))
    foot(k, 'R', (-0.68, -0.32, 0.13), rz=48, rx=34)
    face(k, brows_angry=0.9, squint=0.5, grin=0.8)
    c.key(T_CONTACT, k, mode='lin')
    # 0.32: through the ball, wrists start rolling
    f1 = P(k)
    put(f1, hip__rz=66, chest__rz=4, neck__rz=-8, head__rz=-20)
    bat(f1, (0.28, -0.52, 2.68 + dz * 0.6), (0.82, -0.40, 0.30), palm=(0.2, 0.3, -1.0))
    foot(f1, 'R', (-0.64, -0.30, 0.15), rz=62, rx=46)
    c.key(0.32, f1)
    # 0.42: wrap over the front shoulder
    F = follow_pose(height)
    f2 = P(F)
    put(f2, chest__rz=40, hip__rz=82)
    bat(f2, (0.36, -0.02, 3.18), (0.25, 0.72, 0.65), palm=(-0.8, 0.3, -0.5))
    c.key(0.42, f2)
    # 0.55 overshoot, 0.72 settle, then watch
    o = P(F)
    put(o, chest__rz=38, hip__rz=86, head__rz=-30)
    bat(o, (0.30, 0.12, 3.24), (-0.10, 0.80, 0.60), palm=(-1, 0.1, -0.3))
    face(o, smile=0.8, brows_up=0.4)
    c.key(0.56, o)
    c.key(0.74, F)
    w = P(F)
    put(w, head__rz=-28, head__rx=-16)
    c.key(1.0, w, mode='stop')
    return c


def clip_whiff():
    L = 1.4
    c = Clip('whiff', L)
    S = pose_set()
    c.key(0.0, S)
    a = P(S)
    put(a, hip__rz=8, chest__rz=-18)
    bat(a, (-0.46, -0.06, 2.8), (-0.82, 0.48, 0.3), palm=(0.4, -0.4, 0.8))
    c.key(0.08, a)
    k = P(a)
    put(k, hip__rz=60, hip__x=0.15, chest__rz=0, head__rz=-10)
    bat(k, (0.0, -0.66, 2.3), (0.1, -1.0, -0.2), palm=(1, 0, 0.3))
    face(k, mouth_open=0.6, brows_up=0.8)
    c.key(0.25, k)
    # corkscrew: keep spinning
    s1 = P(k)
    put(s1, hip__rz=200, chest__rz=40, hip__z=-0.3, root__s=0.9, head__rz=10)
    bat(s1, (0.4, 0.4, 2.6), (0.6, 0.7, 0.2), palm=(0, 0, -1))
    foot(s1, 'R', (-0.2, -0.5, 0.3), rz=120, rx=20)
    foot(s1, 'L', (0.5, -0.1, 0.11), rz=150)
    c.key(0.5, s1)
    s2 = P(s1)
    put(s2, hip__rz=330, chest__rz=30, hip__z=-0.22, root__s=1.05)
    bat(s2, (-0.3, 0.5, 2.4), (-0.6, 0.6, -0.3), palm=(0, 0, -1))
    foot(s2, 'R', (-0.3, 0.1, 0.11), rz=300)
    foot(s2, 'L', (0.3, -0.4, 0.11), rz=330)
    face(s2, mouth_open=0.4, brows_sad=0.5, blink=0.3)
    c.key(0.78, s2)
    D = pose_dizzy()
    d1 = P(D)
    put(d1, hip__rz=375, hip__ry=10, head__ry=-20)
    c.key(1.05, d1)
    d2 = P(D)
    put(d2, hip__rz=360)
    c.key(1.4, d2, mode='stop')
    return c


def clip_dizzy():
    L = 1.6
    c = Clip('dizzy', L, loop=True)
    D = pose_dizzy()
    c.key(0.0, D)
    c.key(1.6, D)

    def wobble(t):
        a = 2 * math.pi * t / L
        return {'hip.x': 0.06 * math.sin(a), 'hip.y': 0.05 * math.cos(a), 'hip.ry': 6 * math.sin(a), 'hip.rx': 4 * math.cos(a),
                'head.ry': -10 * math.sin(a + 0.8), 'head.rx': 6 * math.cos(a + 0.8),
                'eye.rx': 0.0, 'eyeL.rx': 14 * math.sin(2 * a), 'eyeL.rz': 14 * math.cos(2 * a),
                'eyeR.rx': -14 * math.sin(2 * a), 'eyeR.rz': 14 * math.cos(2 * a + 0.5),
                'bat.x': 0.05 * math.sin(a + 0.5), 'bat.y': 0.03 * math.cos(a), 'tail.rz': 20 * math.sin(a + 1.2),
                'sk.mouth_open': 0.08 * math.sin(2 * a)}
    c.layers.append(wobble)
    return c


def clip_watch():
    L = 1.2
    c = Clip('watch', L, loop=True)
    F = follow_pose('mid')
    put(F, head__rz=-28, head__rx=-16)
    c.key(0.0, F)
    g = P(F)
    put(g, hip__x=0.2, chest__ry=12, head__rx=-22, head__rz=-24)
    face(g, smile=0.9, brows_up=0.5)
    c.key(0.6, g)
    c.key(1.2, F)
    return c


def clip_bat_flip():
    L = 1.3
    c = Clip('bat_flip', L)
    F = follow_pose('mid')
    put(F, head__rz=-28, head__rx=-16)
    c.key(0.0, F)
    # bring the bat down in front, flip it up and away end over end
    a = P(F)
    bat(a, (0.55, -0.55, 2.3), (0.6, -0.3, -0.75), palm=(0, -1, 0))
    put(a, gripR=0.0, chest__rz=10)
    hand(a, 'R', (-0.45, -0.2, 2.2))
    a['gripR'] = 0.0
    c.key(0.18, a)
    b = P(a)
    b['gripL'] = 0.0
    hand(b, 'L', (0.9, -0.6, 2.9), rz=-30)
    bat(b, (1.1, -0.8, 3.4), (0.5, 0.2, 0.84), palm=(0, -1, 0))
    put(b, fingL=40, chest__rz=4)
    c.key(0.3, b)
    spins = [(0.45, (1.8, -0.9, 5.2), (0.2, -0.3, -0.93)), (0.6, (2.6, -1.0, 6.2), (-0.3, 0.4, 0.86)),
             (0.75, (3.4, -1.1, 6.4), (0.4, -0.2, -0.9)), (0.9, (4.2, -1.2, 5.8), (-0.5, 0.3, 0.8)),
             (1.05, (5.0, -1.3, 4.4), (0.6, -0.3, -0.7)), (1.3, (6.0, -1.4, 2.0), (-0.6, 0.4, 0.7))]
    prev = b
    for t, p, d in spins:
        k = P(prev)
        bat(k, p, d, palm=(0, -1, 0))
        prev = k
        if t == 0.6:
            put(k, chest__rx=-12, head__rx=-24, chest__rz=-6, hip__rz=40)
            hand(k, 'L', (0.62, 0.02, 1.6), rz=-10)
            hand(k, 'R', (-0.62, 0.02, 1.6), rz=10)
            put(k, fingL=0)
            face(k, smile=1.0, squint=0.3, brows_up=0.2)
            foot(k, 'R', (-0.5, -0.3, 0.11), rz=40)
        if t == 0.9:
            put(k, hip__rz=30, hip__z=-0.05, chest__rx=-14)
        c.key(t, k)
    return c


def clip_run():
    L = 0.5
    c = Clip('run', L, loop=True)
    base_ = pose_neutral()
    put(base_, hip__rx=22, hip__z=-0.06, spine__rx=6, chest__rx=8, head__rx=-24, neck__rx=-6,
        tail__rx=-10, tail__curl=-6)
    face(base_, grin=0.4, brows_angry=0.4)
    keys = []
    for i, ph in enumerate([0.0, 0.25]):
        pass

    def legpose(c0, phase):
        # phase 0: left foot planted under the body, right foot kicked back high
        q = P(c0)
        s = math.sin(2 * math.pi * phase)
        co = math.cos(2 * math.pi * phase)
        for side, sg, off in (('L', 1, 0.0), ('R', -1, 0.5)):
            u = 2 * math.pi * (phase + off)
            fy = -0.34 - 0.75 * math.cos(u)
            fz = 0.11 + max(0.0, math.sin(u)) * 0.75
            foot(q, side, (sg * 0.3, fy, fz), rx=-35 * math.sin(u) if math.sin(u) > 0 else 10 * math.sin(u), toe=0)
            V(q, 'knee' + side, (0.1 * sg, -1, 0.2))
            hy = -0.05 + 0.55 * math.cos(u)
            hand(q, side, (sg * 0.55, hy, 2.0 + 0.25 * max(0, -math.cos(u))), rx=-40 * math.cos(u))
            V(q, 'elbow' + side, (0.3 * sg, 1, -0.4))
        put(q, hip__z=-0.06 + 0.1 * abs(math.sin(2 * math.pi * phase * 2)), hip__rz=8 * co, chest__rz=-12 * co)
        return q
    for k in range(5):
        ph = k / 4
        c.key(ph * L, legpose(base_, ph))
    c.tail_lag = 0.03

    def stream(t):
        a = 2 * math.pi * t / L
        return {'tail.rz': 10 * math.sin(a), 'ear' + 'L.rx': -20, 'earR.rx': -20, 'cap.rx': -3 * math.sin(2 * a)}
    c.layers.append(stream)
    return c


def clip_trot():
    L = 0.8
    c = Clip('trot', L, loop=True)
    b0 = pose_neutral()
    put(b0, chest__rx=-10, spine__rx=-4, head__rx=-16, head__rz=-10, tail__rx=25, tail__curl=10)
    face(b0, smile=0.9, squint=0.4, brows_up=0.3)
    # right hand tipping the cap brim
    for k in range(5):
        ph = k / 4
        q = P(b0)
        u = 2 * math.pi * ph
        for side, sg, off in (('L', 1, 0.0), ('R', -1, 0.5)):
            v = 2 * math.pi * (ph + off)
            foot(q, side, (sg * 0.3, -0.34 - 0.35 * math.cos(v), 0.11 + max(0, math.sin(v)) * 0.4), rx=-20 * max(0, math.sin(v)))
        hand(q, 'L', (0.6, -0.05 + 0.3 * math.cos(u), 1.65), rx=-25 * math.cos(u))
        hand(q, 'R', (-0.22, -0.72, 4.42), rx=-90, rz=30, ry=0)
        V(q, 'elbowR', (-1, 0, -0.3))
        put(q, hip__z=-0.04 + 0.06 * abs(math.sin(u)), hip__rz=6 * math.cos(u), cap__rx=-6)
        c.key(ph * L, q)
    return c


def clip_cheer():
    L = 1.2
    c = Clip('cheer', L)
    n = pose_neutral()
    face(n, smile=0.6)
    c.key(0.0, n)
    a = P(n)
    put(a, hip__z=-0.3, hip__rx=18, chest__rx=10, head__rx=8, root__s=0.92)
    hand(a, 'R', (-0.5, -0.2, 1.7), rx=-20)
    face(a, grin=0.6, squint=0.5)
    c.key(0.2, a)
    j = P(n)
    put(j, hip__z=0.55, hip__rx=-6, chest__rx=-12, head__rx=-20, root__s=1.08, tail__rx=30)
    foot(j, 'L', (0.33, -0.2, 0.6), rx=-30)
    foot(j, 'R', (-0.33, -0.2, 0.55), rx=-30)
    hand(j, 'R', (-0.45, -0.25, 4.0), rx=-80)
    V(j, 'elbowR', (-1, 0.2, 0))
    hand(j, 'L', (0.65, -0.1, 2.1), rx=-40)
    face(j, grin=1.0, brows_up=0.8)
    c.key(0.45, j)
    p2 = P(j)
    hand(p2, 'R', (-0.4, -0.35, 3.6), rx=-60)
    c.key(0.6, p2)
    l = P(n)
    put(l, hip__z=-0.22, hip__rx=12, root__s=0.9)
    face(l, grin=0.9, squint=0.4)
    hand(l, 'R', (-0.55, -0.35, 2.4), rx=-50)
    c.key(0.78, l)
    e = P(n)
    face(e, smile=1.0, brows_up=0.4)
    hand(e, 'R', (-0.5, -0.3, 2.6), rx=-60)
    c.key(1.2, e, mode='stop')
    return c


def clip_take():
    L = 0.8
    c = Clip('take', L)
    T, S = pose_set(), pose_stance()
    c.key(0.0, T)
    a = P(T)
    put(a, head__rz=10, neck__rz=-10, head__rx=6, hip__x=-0.12, chest__rx=0)
    face(a, brows_up=0.4)
    c.key(0.25, a)
    b = P(a)
    put(b, head__rz=-20, head__rx=10, neck__rz=-20, chest__ry=-6, shL__ry=-8, shR__ry=8)
    face(b, frown=0.4, brows_up=0.6)
    c.key(0.5, b)
    c.key(0.8, S, mode='stop')
    return c


def clip_strike_react():
    L = 1.4
    c = Clip('strike_react', L)
    T, S = pose_set(), pose_stance()
    c.key(0.0, T)
    a = P(T)
    foot(a, 'R', (-0.7, -0.3, 0.6), rx=-20)
    put(a, hip__z=-0.1, chest__rx=-6, head__rz=-60, neck__rz=-30, head__rx=-6)
    face(a, frown=0.8, brows_angry=1.0)
    c.key(0.25, a)
    b = P(a)
    foot(b, 'R', (-0.72, -0.32, 0.11))
    put(b, root__s=0.9, hip__z=-0.24)
    face(b, frown=1.0, brows_angry=1.0, mouth_open=0.4)
    c.key(0.36, b)
    g = P(b)
    put(g, root__s=1.0, hip__z=-0.14, head__rz=-80, neck__rz=-40)
    c.key(0.7, g)
    s = P(S)
    put(s, chest__rx=18, spine__rx=8, head__rx=16, hip__z=-0.18)
    face(s, frown=0.7, brows_sad=0.8, blink=0.3)
    c.key(1.05, s)
    c.key(1.4, S, mode='stop')
    return c


def all_clips():
    return [clip_stance(), clip_stride(), clip_power_load(), clip_coil_hold(), clip_swing('high'), clip_swing('mid'),
            clip_swing('low'), clip_whiff(), clip_dizzy(), clip_watch(), clip_bat_flip(), clip_run(), clip_trot(),
            clip_cheer(), clip_take(), clip_strike_react()]

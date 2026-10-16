# ak_pose.py - pose-authoring helpers for the shared libraries (the vocabulary of rk_clips, adapted): poses are
# channel dicts; helpers set hips/feet/hands/face, aim the head, turn a whole pose about a vertical axis, and give
# body-frame points (where the chest, head and sockets are for a pose) so hands can be placed relative to the body.
# Model space (Blender): Z up, the character faces -Y, his left is +X; authoring units = Rocco units (hips 1.70 ft).
import math
import numpy as np

from ak_math import euler, nrm, frame3, rot_axis, D2R
import ak_rig as AR

SK = None            # the reference skeleton (set by the build: ak_pose.setup(sk))


def setup(sk):
    global SK, REST
    SK = sk
    REST = AR.rest_channels(sk)


def J(name):
    """Rest joint position in authoring units."""
    return SK.J[name] / SK.U


def base():
    return dict(REST)


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


def get(c, key):
    return np.array([c[key + '.x'], c[key + '.y'], c[key + '.z']])


def lerp_pose(a, b, t):
    out = {}
    for k in a:
        va, vb = a[k], b.get(k, a[k])
        out[k] = va * (1 - t) + vb * t
    return out


# ------------------------------------------------------------------------------------------- body parts
def foot(c, side, ball, rz=0.0, rx=0.0, ry=0.0, toe=0.0, knee=None):
    """Ball of the foot (toe joint) at `ball`; rz turns the toes (0 = forward -Y), rx pitches the sole (heel up +)."""
    V(c, 'foot' + side, ball)
    c['foot%s.rz' % side], c['foot%s.rx' % side], c['foot%s.ry' % side] = rz, rx, ry
    c['toe%s.rx' % side] = toe
    if knee is not None:
        V(c, 'knee' + side, knee)
    return c


def hand(c, side, pos, rx=0.0, ry=0.0, rz=0.0, rel=0.0, relh=0.0, sock=None, elbow=None):
    """Free hand target (wrist, or a socket: sock='grip' | 'mitt'). rel=1: given in the rest body frame and carried
    by the chest; relh=1: carried by the head; default: model space (always explicit, never inherited from the pose
    it was copied from). rx/ry/rz: hand rotation relative to the forearm."""
    V(c, 'hand' + side, pos)
    c['hand%s.rx' % side], c['hand%s.ry' % side], c['hand%s.rz' % side] = rx, ry, rz
    c['hand%s.rel' % side] = float(rel)
    c['hand%s.relh' % side] = float(relh)
    if sock is not None:
        c['hand%s.sg' % side] = 1.0 if sock == 'grip' else 0.0
        if side == 'L':
            c['handL.sm'] = 1.0 if sock == 'mitt' else 0.0
    if elbow is not None:
        V(c, 'elbow' + side, elbow)
    return c


def orient(c, side, fingers, palm, w=1.0):
    """Absolute hand orientation: finger direction and palm normal (model space, or body frame if the hand is rel)."""
    f = nrm(fingers)
    p = np.asarray(palm, float)
    c['hand%s.fx' % side], c['hand%s.fy' % side], c['hand%s.fz' % side] = f
    c['hand%s.px' % side], c['hand%s.py' % side], c['hand%s.pz' % side] = p
    c['hand%s.abs' % side] = float(w)
    return c


def free(c, side):
    """Hand orientation back to forearm-relative."""
    c['hand%s.abs' % side] = 0.0
    return c


HAND_SHAPES = {
    'relaxed': dict(fing=0.15, thumb=0.1, spread=0.1, point=0.0),
    'open': dict(fing=-0.25, thumb=-0.6, spread=0.75, point=0.0),
    'jazz': dict(fing=-0.4, thumb=-0.9, spread=1.0, point=0.0),
    'knife': dict(fing=-0.2, thumb=0.35, spread=0.0, point=0.0),
    'fist': dict(fing=1.0, thumb=1.0, spread=0.0, point=0.0),
    'ball': dict(fing=0.30, thumb=0.30, spread=0.35, point=0.0),     # fingertips on a baseball at grip.* (it shows)
    'loose': dict(fing=0.42, thumb=0.15, spread=0.35, point=0.0),
    'point': dict(fing=1.0, thumb=0.85, spread=0.0, point=1.0),
    'claw': dict(fing=0.55, thumb=-0.3, spread=0.8, point=0.0),
    'tip': dict(fing=0.30, thumb=0.30, spread=0.0, point=0.0),       # fingers together on a cap brim
    'sign1': dict(fing=1.0, thumb=0.9, spread=0.0, point=1.0),       # catcher's sign: one finger down
    'flat': dict(fing=0.0, thumb=0.0, spread=0.0, point=0.0),
    'mitt_open': dict(fing=-0.45, thumb=-0.5, spread=0.0, point=0.0),
    'mitt_shut': dict(fing=0.55, thumb=0.6, spread=0.0, point=0.0),
}


def hshape(c, side, name, k=1.0):
    a, b = HAND_SHAPES['relaxed'], HAND_SHAPES[name]
    for ch in ('fing', 'thumb', 'spread', 'point'):
        c[ch + side] = a[ch] * (1 - k) + b[ch] * k
    return c


def face(c, **kw):
    for k in AR.SHAPE_KEYS:
        c['sk.' + k] = 0.0
    for k, v in kw.items():
        c['sk.' + k] = v
    return c


# ------------------------------------------------------------------------------------------- body frames
def hips_R(c):
    return euler(c['hip.rx'], c['hip.ry'], c['hip.rz'])


def body_R(c, upto='chest'):
    R = hips_R(c) @ euler(c['spine.rx'], c['spine.ry'], c['spine.rz'])
    R = R @ euler(c['chest.rx'], c['chest.ry'], c['chest.rz'])
    if upto == 'chest':
        return R
    R = R @ euler(c['neck.rx'], c['neck.ry'], c['neck.rz'])
    if upto == 'neck':
        return R
    return R @ euler(c['head.rx'], c['head.ry'], c['head.rz'])


def joint_pos(c, name):
    """Posed position (authoring units) of a trunk joint: hips, spine, chest, neck, head, shoulder/upper_arm."""
    hp = J('hips') + np.array([c['hip.x'], c['hip.y'], c['hip.z']])
    if name == 'hips':
        return hp
    Rh = hips_R(c)
    Rs = Rh @ euler(c['spine.rx'], c['spine.ry'], c['spine.rz'])
    sp = hp + Rh @ (J('spine') - J('hips'))
    if name == 'spine':
        return sp
    Rc = Rs @ euler(c['chest.rx'], c['chest.ry'], c['chest.rz'])
    ch = sp + Rs @ (J('chest') - J('spine'))
    if name == 'chest':
        return ch
    if name in ('neck', 'head'):
        nk = ch + Rc @ (J('neck') - J('chest'))
        if name == 'neck':
            return nk
        Rn = Rc @ euler(c['neck.rx'], c['neck.ry'], c['neck.rz'])
        return nk + Rn @ (J('head') - J('neck'))
    # anything carried by the chest (shoulders): rest offset from the chest, rotated
    return ch + Rc @ (J(name) - J('chest'))


def chest_point(c, p):
    """A point given in the rest body frame (authoring units), carried by the chest of pose c."""
    Rc = body_R(c)
    return joint_pos(c, 'chest') + Rc @ (np.asarray(p, float) - J('chest'))


def head_point(c, p):
    Rd = body_R(c, 'head')
    return joint_pos(c, 'head') + Rd @ (np.asarray(p, float) - J('head'))


def face_pos(c):
    """Roughly between the eyes."""
    return head_point(c, J('head') + np.array([0, -0.30, 0.95]))


def look_at(c, target, neck=0.38, tilt=0.0, gaze=0.0, eyes=True):
    """Aim the face at a point: yaw/pitch relative to the chest, split between neck and head; the eyes take what the
    head can't (up to 8 deg) plus `gaze`."""
    Rc = body_R(c)
    d = Rc.T @ (np.asarray(target, float) - face_pos(c))
    yaw = math.degrees(math.atan2(d[0], -d[1]))
    pitch = math.degrees(math.atan2(-d[2], math.hypot(d[0], d[1])))
    yaw_c = max(-100.0, min(100.0, yaw))
    pitch_c = max(-50.0, min(45.0, pitch))
    put(c, neck__rz=yaw_c * neck, head__rz=yaw_c * (1 - neck), neck__rx=pitch_c * 0.35, head__rx=pitch_c * 0.65, head__ry=tilt)
    if eyes:
        c['eye.rz'] = max(-10.0, min(10.0, (yaw - yaw_c) * 0.5 + gaze))
        c['eye.rx'] = max(-8.0, min(8.0, (pitch - pitch_c) * 0.4))
    return c


def turn_pose(c, deg, pivot=(0.0, 0.0)):
    """Rotate a whole pose about a vertical axis through pivot (x, y): body yaw, feet, world-space hand targets,
    hand orientations and poles (chest- or head-carried targets turn with the body anyway)."""
    Rz = euler(0, 0, deg)
    pv = np.array([pivot[0], pivot[1], 0.0])
    rp = lambda q: pv + Rz @ (np.asarray(q, float) - pv)
    h = rp(J('hips') + np.array([c['hip.x'], c['hip.y'], c['hip.z']]))
    c['hip.x'], c['hip.y'] = h[0] - J('hips')[0], h[1] - J('hips')[1]
    c['hip.rz'] += deg
    for sd in ('L', 'R'):
        V(c, 'foot' + sd, rp(get(c, 'foot' + sd)))
        c['foot%s.rz' % sd] += deg
        V(c, 'knee' + sd, Rz @ get(c, 'knee' + sd))
        if c['hand%s.rel' % sd] < 1e-4 and c['hand%s.relh' % sd] < 1e-4:
            V(c, 'hand' + sd, rp(get(c, 'hand' + sd)))
            V(c, 'elbow' + sd, Rz @ get(c, 'elbow' + sd))
            for k in ('f', 'p'):
                v = Rz @ np.array([c['hand%s.%sx' % (sd, k)], c['hand%s.%sy' % (sd, k)], c['hand%s.%sz' % (sd, k)]])
                c['hand%s.%sx' % (sd, k)], c['hand%s.%sy' % (sd, k)], c['hand%s.%sz' % (sd, k)] = v
    return c


def mirror_pose(c):
    """Left-right mirror of a pose (x -> -x): swaps sides, negates yaw/roll."""
    out = dict(c)
    neg_rot = ('ry', 'rz')
    for k, v in c.items():
        if k.endswith('.ry') or k.endswith('.rz'):
            out[k] = -v
    sw = lambda k: k.replace('L.', '#.').replace('R.', 'L.').replace('#.', 'R.')
    res = dict(out)
    for k, v in out.items():
        for a, b in (('handL', 'handR'), ('footL', 'footR'), ('kneeL', 'kneeR'), ('elbowL', 'elbowR'), ('shL', 'shR'),
                     ('earL', 'earR'), ('browL', 'browR'), ('eyeL', 'eyeR'), ('toeL', 'toeR')):
            if k.startswith(a + '.'):
                res[b + k[len(a):]] = v
            elif k.startswith(b + '.'):
                res[a + k[len(b):]] = v
        for a, b in (('fingL', 'fingR'), ('thumbL', 'thumbR'), ('spreadL', 'spreadR'), ('pointL', 'pointR')):
            if k == a:
                res[b] = v
            elif k == b:
                res[a] = v
    for k in list(res):
        if k.endswith('.x') and (k.startswith('hand') or k.startswith('foot') or k.startswith('knee') or k.startswith('elbow') or k == 'hip.x'):
            res[k] = -res[k]
        if k.endswith('.fx') or k.endswith('.px'):
            res[k] = -res[k]
    return res


# ------------------------------------------------------------------------------------------- layers
def breathing(L, cycles=2, amp=1.0):
    w = 2 * math.pi * cycles / L

    def f(t):
        s = math.sin(w * t)
        return {'hip.z': 0.008 * s * amp, 'chest.rx': -1.4 * s * amp, 'head.rx': 0.9 * s * amp, 'shL.ry': 0.8 * s * amp,
                'shR.ry': -0.8 * s * amp}
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


def pulse(t, t0, dur):
    u = (t - t0) / dur
    return math.sin(u * math.pi) if 0 <= u <= 1 else 0.0

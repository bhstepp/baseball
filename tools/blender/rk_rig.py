# rk_rig.py - Rocco's skeleton (the single source of truth for joint positions) and armature creation.
# Blender space: Z up, Rocco faces -Y, his left is +X. (glTF: Y up, faces +Z, his left is +X.)
# "Control" bones (root, hips, spine, chest, neck, head, jaw, eyes, brows, ears, cap, bat, bat_sweet, bat_tip) point
# straight up with roll 0, which the glTF exporter turns into identity rest rotations: in glTF their local axes are the
# model axes (+X his left, +Y up, +Z forward).
# Limb and tail bones point along the limb (Blender convention) so they can stretch along their length.
import math
import numpy as np
import bpy
from mathutils import Matrix, Vector

S2 = math.sqrt(0.5)

# ------------------------------------------------------------------------------------------- joints (feet)
J = {}
J['root'] = (0.0, 0.0, 0.0)
J['hips'] = (0.0, 0.04, 1.70)
J['spine'] = (0.0, 0.05, 1.98)
J['chest'] = (0.0, 0.05, 2.40)
J['neck'] = (0.0, 0.06, 2.98)
J['head'] = (0.0, 0.06, 3.30)
J['jaw'] = (0.0, -0.18, 3.82)          # jaw hinge (lower jaw rotates about its local X)
J['cap'] = (0.0, 0.04, 4.60)
# eyes: the visible white is a tall oval window cut from a sphere of radius EYE_R; the eye bone sits at the sphere
# centre so rotating it slides the pupil exactly over the white.
EYE_R, EYE_W, EYE_H = 0.40, 0.128, 0.195
EYE_FRONT = np.array([0.18, -0.575, 4.17])           # visible centre of the left eye
EYE_AXIS = np.array([0.13, -1.0, 0.02])              # forward, a touch outward


def eye_frame(s=1):
    front = EYE_FRONT * np.array([s, 1, 1])
    ax = EYE_AXIS * np.array([s, 1, 1])
    ax = ax / np.linalg.norm(ax)
    up = np.array([0, 0, 1.0])
    up = up - np.dot(up, ax) * ax
    up = up / np.linalg.norm(up)
    x = np.cross(up, ax)
    return front - ax * EYE_R, np.stack([x, up, ax], 1)


J['eye.L'] = tuple(eye_frame(1)[0])
J['brow.L'] = (0.215, -0.52, 4.43)
J['ear.L'] = (0.41, 0.04, 4.625)
J['tail.1'] = (0.0, 0.58, 1.60)
J['tail.2'] = (0.0, 0.92, 1.45)
J['tail.3'] = (0.0, 1.26, 1.53)
J['tail.4'] = (0.0, 1.48, 1.87)
J['tail.5'] = (0.0, 1.50, 2.29)
J['tail_tip'] = (0.0, 1.34, 2.69)
# left arm (A-pose, 45 deg down); right is mirrored
ARM_DIR = np.array([S2, 0.0, -S2])
J['shoulder.L'] = (0.12, 0.06, 2.86)
J['upper_arm.L'] = (0.42, 0.08, 2.84)
UPPER_LEN, FORE_LEN = 0.74, 0.72
J['forearm.L'] = tuple(np.array(J['upper_arm.L']) + ARM_DIR * UPPER_LEN)
J['hand.L'] = tuple(np.array(J['forearm.L']) + ARM_DIR * FORE_LEN)
J['hand_end.L'] = tuple(np.array(J['hand.L']) + ARM_DIR * 0.22)
# fist: tunnel (bat handle) axis along -Y (thumb/index side forward), palm normal medial-down
HAND_T = np.array([0.0, -1.0, 0.0])                 # pinky -> index direction
HAND_N = np.array([-S2, 0.0, -S2])                  # palm normal (left hand)
GRIP_C = np.array(J['hand.L']) + ARM_DIR * 0.17 + HAND_N * 0.075   # handle centre inside the fist
HANDLE_R = 0.048                                    # bat handle radius at the grip

# ---- open cartoon glove (left hand; the right mirrors it). Glove frame: origin = wrist (hand joint),
# t = HAND_T (pinky -> index), u = ARM_DIR (along the hand), v = -HAND_N (out of the back of the hand).
GLOVE_T, GLOVE_U, GLOVE_V = HAND_T, ARM_DIR, -HAND_N


def glove_pt(t, u, v, s=1):
    p = np.array(J['hand.L']) + GLOVE_T * t + GLOVE_U * u + GLOVE_V * v
    return p * np.array([s, 1, 1])


# fingers: name, t (across the hand), knuckle u, radius, proximal and distal lengths, rest splay (deg, + toward
# the index side), rest curl of the proximal / distal joint (deg, toward the palm)
FINGERS = [('index', 0.089, 0.240, 0.050, 0.100, 0.080, 5.0, 9.0, 12.0),
           ('middle', 0.0, 0.248, 0.052, 0.110, 0.086, 0.0, 10.0, 13.0),
           ('pinky', -0.088, 0.232, 0.047, 0.090, 0.070, -6.0, 12.0, 15.0)]
KNUCKLE_V = 0.012
THUMB = dict(base=(0.094, 0.055, -0.012), dir=(0.70, 0.60, -0.38), r=0.049, L1=0.100, L2=0.075, curl=10.0)


def _finger_chain_tuv(f):
    name, t, u, r, L1, L2, sp, c1, c2 = f
    sp, c1, c2 = math.radians(sp), math.radians(c1), math.radians(c2)
    K = np.array([t, u, KNUCKLE_V])
    d1 = np.array([math.sin(sp) * math.cos(c1), math.cos(sp) * math.cos(c1), -math.sin(c1)])
    d2 = np.array([math.sin(sp) * math.cos(c1 + c2), math.cos(sp) * math.cos(c1 + c2), -math.sin(c1 + c2)])
    M = K + d1 * L1
    T = M + d2 * L2
    return K, M, T


def _thumb_chain_tuv():
    B = np.array(THUMB['base'])
    d1 = np.array(THUMB['dir'], float)
    d1 /= np.linalg.norm(d1)
    # distal flexes toward the palm centre
    side = np.cross(d1, np.array([0, 0, -1.0]))
    side /= np.linalg.norm(side)
    a = math.radians(THUMB['curl'])
    d2 = d1 * math.cos(a) + np.cross(side, d1) * math.sin(a)
    M = B + d1 * THUMB['L1']
    T = M + d2 * THUMB['L2']
    return B, M, T


def _tuv_to_model(q):
    return glove_pt(q[0], q[1], q[2])


GLOVE_CHAINS = {}                                   # left-hand chains in model space: name -> [joint, joint, end]
for f in FINGERS:
    GLOVE_CHAINS[f[0]] = [_tuv_to_model(q) for q in _finger_chain_tuv(f)]
GLOVE_CHAINS['thumb'] = [_tuv_to_model(q) for q in _thumb_chain_tuv()]
J['fingers.L'] = tuple(glove_pt(0.0, 0.212, KNUCKLE_V))          # knuckle row: cups the palm, carries the fingers
for nm, (a, b, e) in GLOVE_CHAINS.items():
    J[nm + '.L'] = tuple(a)
    J[nm + '_2.L'] = tuple(b)
    J[nm + '_end.L'] = tuple(e)


def _circle_hits(K, r1, c, r2):
    """Intersections of circle (K, r1) and circle (c, r2) in 2D."""
    d = np.linalg.norm(c - K)
    a = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
    h = math.sqrt(max(r1 * r1 - a * a, 0.0))
    m = K + (c - K) * a / d
    perp = np.array([-(c - K)[1], (c - K)[0]]) / d
    return m + perp * h, m - perp * h


def _wrap(K, L1, L2, c, rm, rt, cw=True):
    """Two-segment chain from K wrapping round a circle centred c: middle joint at radius rm, end at rt;
    clockwise (cw) or counter-clockwise in the (u, v) plane."""
    ang = lambda P: math.atan2(P[1] - c[1], P[0] - c[0])
    a0 = ang(K)
    def pick(cands, a_ref):
        best, bd = None, 9
        for P in cands:
            da = (a_ref - ang(P)) % (2 * math.pi) if cw else (ang(P) - a_ref) % (2 * math.pi)
            if da < bd:
                best, bd = P, da
        return best
    M = pick(_circle_hits(K, L1, c, rm), a0)
    T = pick(_circle_hits(M, L2, c, rt), ang(M))
    return M, T


# grip: the bat handle lies across the palm through GRIP_C along HAND_T; fingers wrap its far side, the thumb
# comes round the near side and over the index fingertip. Left-hand targets in model space (joint, end).
GRIP_TARGETS = {}
_c = np.array([0.17, -0.075])                       # handle centre in (u, v)
for f in FINGERS:
    name, t, u, r, L1, L2 = f[:6]
    M, T = _wrap(np.array([u, KNUCKLE_V]), L1, L2, _c, HANDLE_R + r + 0.004, HANDLE_R + r * 0.92, cw=True)
    GRIP_TARGETS[name] = (glove_pt(t, M[0], M[1]), glove_pt(t, T[0], T[1]))
_B = np.array(THUMB['base'])
_tt = 0.104
_M, _T = _wrap(np.array([_B[1], _B[2]]), THUMB['L1'] * 0.98, THUMB['L2'], _c, HANDLE_R + THUMB['r'] + 0.006,
               HANDLE_R + THUMB['r'] + 0.004, cw=False)
GRIP_TARGETS['thumb'] = (glove_pt(_tt, _M[0], _M[1]), glove_pt(_tt + 0.006, _T[0], _T[1]))
# left leg
J['thigh.L'] = (0.28, 0.03, 1.60)
J['shin.L'] = (0.33, -0.02, 1.00)
J['foot.L'] = (0.35, 0.10, 0.36)
J['toe.L'] = (0.36, -0.34, 0.11)
J['toe_end.L'] = (0.36, -0.70, 0.11)
THIGH_LEN = float(np.linalg.norm(np.subtract(J['shin.L'], J['thigh.L'])))
SHIN_LEN = float(np.linalg.norm(np.subtract(J['foot.L'], J['shin.L'])))
# bat: the grip pivot sits between the two fists on the handle
BAT_KNOB, BAT_SWEET, BAT_TIP = -0.30, 1.80, 2.45   # along the bat axis from the grip pivot (ft)
GRIP_L, GRIP_R = -0.115, 0.105                       # hand centres along the bat axis (bottom = left hand)
# the bat's long axis at rest is -Y (forward, along the right fist's tunnel); glTF: +Z
J['bat'] = tuple(GRIP_C * np.array([-1, 1, 1]) + np.array([0, GRIP_R, 0]))
J['bat_sweet'] = tuple(np.array(J['bat']) + np.array([0, -BAT_SWEET, 0]))
J['bat_tip'] = tuple(np.array(J['bat']) + np.array([0, -BAT_TIP, 0]))

for k in list(J):
    if k.endswith('.L'):
        x, y, z = J[k]
        J[k[:-2] + '.R'] = (-x, y, z)

# The head is modelled in a "design space" and placed with one transform (lowered onto the shoulders and scaled
# up a touch about the top of the neck). JD keeps the design-space head joints; J holds the final ones.
HEAD_PIVOT = np.array([0.0, 0.06, 3.30])
HEAD_SCALE = 1.08
HEAD_OFFSET = np.array([0.0, 0.0, -0.145])
HEAD_JOINTS = ['head', 'jaw', 'cap', 'eye.L', 'eye.R', 'brow.L', 'brow.R', 'ear.L', 'ear.R']


def hx(p):
    return HEAD_PIVOT + HEAD_OFFSET + HEAD_SCALE * (np.asarray(p, float) - HEAD_PIVOT)


JD = {k: J[k] for k in HEAD_JOINTS}
for k in HEAD_JOINTS:
    J[k] = tuple(hx(J[k]))


def jv(name):
    return np.array(J[name], float)


def jd(name):
    """Design-space position of a head joint (what the head builders use)."""
    return np.array(JD[name] if name in JD else J[name], float)


# ------------------------------------------------------------------------------------------- bone table
# name, parent, head joint, tail (joint name | 'ID' for identity orientation), deform, roll-align vector
IDB = 0.12   # display length of identity bones
BONES = [
    ('root', None, 'root', 'ID', False),
    ('hips', 'root', 'hips', 'ID', True),
    ('spine', 'hips', 'spine', 'ID', True),
    ('chest', 'spine', 'chest', 'ID', True),
    ('neck', 'chest', 'neck', 'ID', True),
    ('head', 'neck', 'head', 'ID', True),
    ('jaw', 'head', 'jaw', 'ID', True),
    ('cap', 'head', 'cap', 'ID', True),
    ('tail.1', 'hips', 'tail.1', 'tail.2', True),
    ('tail.2', 'tail.1', 'tail.2', 'tail.3', True),
    ('tail.3', 'tail.2', 'tail.3', 'tail.4', True),
    ('tail.4', 'tail.3', 'tail.4', 'tail.5', True),
    ('tail.5', 'tail.4', 'tail.5', 'tail_tip', True),
    ('bat', 'root', 'bat', 'ID', True),
    ('bat_sweet', 'bat', 'bat_sweet', 'ID', False),
    ('bat_tip', 'bat', 'bat_tip', 'ID', False),
]
for s in ('L', 'R'):
    BONES += [
        ('eye.' + s, 'head', 'eye.' + s, 'ID', True),
        ('brow.' + s, 'head', 'brow.' + s, 'ID', True),
        ('ear.' + s, 'head', 'ear.' + s, 'ID', True),
        ('shoulder.' + s, 'chest', 'shoulder.' + s, 'upper_arm.' + s, True),
        ('upper_arm.' + s, 'shoulder.' + s, 'upper_arm.' + s, 'forearm.' + s, True),
        ('forearm.' + s, 'upper_arm.' + s, 'forearm.' + s, 'hand.' + s, True),
        ('hand.' + s, 'forearm.' + s, 'hand.' + s, 'hand_end.' + s, True),
        ('fingers.' + s, 'hand.' + s, 'fingers.' + s, 'FING', True),
        ('index.' + s, 'fingers.' + s, 'index.' + s, 'index_2.' + s, True),
        ('index_2.' + s, 'index.' + s, 'index_2.' + s, 'index_end.' + s, True),
        ('middle.' + s, 'fingers.' + s, 'middle.' + s, 'middle_2.' + s, True),
        ('middle_2.' + s, 'middle.' + s, 'middle_2.' + s, 'middle_end.' + s, True),
        ('pinky.' + s, 'fingers.' + s, 'pinky.' + s, 'pinky_2.' + s, True),
        ('pinky_2.' + s, 'pinky.' + s, 'pinky_2.' + s, 'pinky_end.' + s, True),
        ('thumb.' + s, 'hand.' + s, 'thumb.' + s, 'thumb_2.' + s, True),
        ('thumb_2.' + s, 'thumb.' + s, 'thumb_2.' + s, 'thumb_end.' + s, True),
        ('thigh.' + s, 'hips', 'thigh.' + s, 'shin.' + s, True),
        ('shin.' + s, 'thigh.' + s, 'shin.' + s, 'foot.' + s, True),
        ('foot.' + s, 'shin.' + s, 'foot.' + s, 'toe.' + s, True),
        ('toe.' + s, 'foot.' + s, 'toe.' + s, 'toe_end.' + s, True),
    ]
BONE_NAMES = [b[0] for b in BONES]
HAND_BONES = ('fingers', 'index', 'index_2', 'middle', 'middle_2', 'pinky', 'pinky_2', 'thumb', 'thumb_2')
FINGER_CHAINS = [('index', 'index_2'), ('middle', 'middle_2'), ('pinky', 'pinky_2'), ('thumb', 'thumb_2')]
PARENT = {b[0]: b[1] for b in BONES}
SIDE = {'L': 1.0, 'R': -1.0}


def bone_tail(b):
    name, parent, head, tail, deform = b
    h = jv(head)
    if tail == 'ID':
        return h + np.array([0, 0, IDB])     # points up, roll 0: glTF local axes = model axes (X left, Y up, Z front)
    sx = 1.0 if name.endswith('.L') else -1.0
    if tail == 'FING':
        d = ARM_DIR * np.array([sx, 1, 1])
        return h + d * 0.12
    if tail == 'THUMB':
        return h + HAND_T * 0.1
    return jv(tail)


def roll_hint(name):
    """Vector the bone's local Z should align with (limb bones)."""
    if name.startswith(('thigh', 'shin', 'foot', 'toe')):
        return Vector((0, -1, 0))        # Z forward, X = hinge axis
    if name.startswith(('upper_arm', 'forearm', 'hand', 'fingers', 'thumb', 'shoulder')):
        return Vector((0, 0, 1)) if name.startswith('shoulder') else Vector((0, 1, 0))   # elbows bend back
    if name.startswith('tail'):
        return Vector((0, 1, 0)) if False else Vector((0, 0, 1))
    return Vector((0, 0, 1))


def build_armature(name='rocco_rig'):
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for b in BONES:
        name, parent, head, tail, deform = b
        e = arm.edit_bones.new(name)
        e.head = Vector(jv(head))
        e.tail = Vector(bone_tail(b))
        if tail == 'ID':
            e.roll = 0.0
        elif name.startswith('tail'):
            y = (e.tail - e.head).normalized()
            e.align_roll(Vector((1, 0, 0)).cross(y))
        elif name.split('.')[0] in HAND_BONES:
            # finger bones: local Z = palm normal, so local X is the curl hinge (+X rotation curls toward the palm)
            sx = 1.0 if name.endswith('.L') else -1.0
            e.align_roll(Vector(tuple(HAND_N * np.array([sx, 1, 1]))))
        elif name.startswith(('foot', 'toe')):
            e.align_roll(Vector((0, 0, 1)))
        else:
            e.align_roll(roll_hint(name))
        e.use_deform = deform
        e.use_connect = False
        if parent:
            e.parent = eb[parent]
        e.inherit_scale = 'FULL'
        eb[name] = e
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in ob.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return ob


def rest_matrices(ob):
    """Armature-space rest matrices (4x4 numpy) for every bone."""
    return {b.name: np.array(b.matrix_local) for b in ob.data.bones}


# ------------------------------------------------------------------------------------------- weighting helpers
def seg_dist(P, a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    ab = b - a
    t = np.clip(((P - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1), t


def chain_weights(P, chain, blend=0.1):
    """Weights along a chain of joints. chain: [(bone, head_xyz, tail_xyz), ...] (consecutive segments).
    Each vertex gets its nearest segment; across joints it blends over +-blend (ft) of arc length."""
    n = len(P)
    segs = [(b, np.asarray(h, float), np.asarray(t, float)) for b, h, t in chain]
    lens = [np.linalg.norm(t - h) for _, h, t in segs]
    starts = np.concatenate([[0], np.cumsum(lens)[:-1]])
    D = np.stack([seg_dist(P, h, t)[0] for _, h, t in segs], 1)
    T = np.stack([seg_dist(P, h, t)[1] for _, h, t in segs], 1)
    k = np.argmin(D, 1)
    s = starts[k] + T[np.arange(n), k] * np.array(lens)[k]     # arc-length coordinate
    W = {}
    for i, (b, h, t) in enumerate(segs):
        lo = starts[i]
        hi = starts[i] + lens[i]
        w = np.ones(n)
        if i > 0:
            w *= np.clip((s - lo) / (2 * blend) + 0.5, 0, 1)
        if i < len(segs) - 1:
            w *= np.clip((hi - s) / (2 * blend) + 0.5, 0, 1)
        W[b] = w
    tot = sum(W.values())
    return {b: w / np.maximum(tot, 1e-9) for b, w in W.items()}, s


def normalize_weights(W, max_inf=4, min_w=0.01):
    names = list(W)
    if not names:
        return W
    M = np.stack([W[k] for k in names], 1)
    M[M < min_w] = 0
    if M.shape[1] > max_inf:
        idx = np.argsort(-M, 1)[:, max_inf:]
        np.put_along_axis(M, idx, 0, 1)
    s = M.sum(1, keepdims=True)
    M = np.where(s > 0, M / np.maximum(s, 1e-12), 0)
    return {k: M[:, i] for i, k in enumerate(names) if np.any(M[:, i] > 0)}

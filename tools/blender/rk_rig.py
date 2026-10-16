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
J['fingers.L'] = tuple(np.array(J['hand.L']) + ARM_DIR * 0.20 - HAND_N * 0.02)
J['thumb.L'] = tuple(np.array(J['hand.L']) + ARM_DIR * 0.07 + HAND_N * 0.06 + HAND_T * 0.07)
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
        ('thumb.' + s, 'hand.' + s, 'thumb.' + s, 'THUMB', True),
        ('thigh.' + s, 'hips', 'thigh.' + s, 'shin.' + s, True),
        ('shin.' + s, 'thigh.' + s, 'shin.' + s, 'foot.' + s, True),
        ('foot.' + s, 'shin.' + s, 'foot.' + s, 'toe.' + s, True),
        ('toe.' + s, 'foot.' + s, 'toe.' + s, 'toe_end.' + s, True),
    ]
BONE_NAMES = [b[0] for b in BONES]
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
        elif name.startswith(('foot', 'toe', 'thumb')):
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

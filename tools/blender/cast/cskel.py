# cskel.py - the cast skeleton: Rocco's bone names, hierarchy, rolls and rest orientations (rk_rig.BONES, minus his bat
# bones) with per-character bone LENGTHS and joint OFFSETS. Every bone keeps Rocco's rest direction, so clips authored
# on the reference build (= Rocco's proportions, hipHeight 1.70) transfer by rotation; the runtime only rescales
# root/hips translation by hipHeight / refHipHeight.
import numpy as np
import cast_common as CC  # noqa: F401  (sets up sys.path)
import rk_rig as RR

BAT_BONES = ('bat', 'bat_sweet', 'bat_tip')
CAST_BONES = [b for b in RR.BONES if b[0] not in BAT_BONES]
CAST_BONE_NAMES = [b[0] for b in CAST_BONES]
REF_HIP_HEIGHT = float(RR.J['hips'][2])           # 1.70 ft

HEAD_LOCAL = ['jaw', 'cap', 'eye.L', 'brow.L', 'ear.L']   # placed by the head module (relative to the head joint)
HAND_LOCAL = ['fingers.L', 'index.L', 'index_2.L', 'index_end.L', 'middle.L', 'middle_2.L', 'middle_end.L',
              'pinky.L', 'pinky_2.L', 'pinky_end.L', 'thumb.L', 'thumb_2.L', 'thumb_end.L', 'grip.L', 'mitt', 'hand_end.L']

DEFAULT_BUILD = dict(leg=1.0, foot=1.0, torso=1.0, neck=1.0, hipw=1.0, shoulderw=1.0, arm=1.0, hand=1.0, head=1.0,
                     tail=(1.0, 1.0, 1.0, 1.0, 1.0))


def _v(name):
    return np.array(RR.J[name], float)


def joints_for(build=None, head_joints=None):
    """Joint table (left side + mirrored right) for a build. head_joints: {name: offset from the head joint} from the
    species head module (else Rocco's, scaled by build['head'])."""
    b = dict(DEFAULT_BUILD)
    b.update(build or {})
    J = {'root': np.zeros(3)}
    # legs, bottom-up so the ball of the foot sits at its sole height
    H0, K0, A0, B0, T0 = (_v(n) for n in ('thigh.L', 'shin.L', 'foot.L', 'toe.L', 'toe_end.L'))
    segs = [(K0 - H0, b['leg']), (A0 - K0, b['leg']), (B0 - A0, b['foot']), (T0 - B0, b['foot'])]
    ball_z = B0[2] * b['foot']
    drop = sum(d * s for d, s in segs[:3])
    H = np.array([H0[0] * b['hipw'], H0[1], ball_z - drop[2]])
    J['thigh.L'] = H
    J['shin.L'] = H + segs[0][0] * segs[0][1]
    J['foot.L'] = J['shin.L'] + segs[1][0] * segs[1][1]
    J['toe.L'] = J['foot.L'] + segs[2][0] * segs[2][1]
    J['toe_end.L'] = J['toe.L'] + segs[3][0] * segs[3][1]
    # trunk
    hips0, spine0, chest0, neck0, head0 = (_v(n) for n in ('hips', 'spine', 'chest', 'neck', 'head'))
    off = hips0 - H0
    J['hips'] = H + np.array([off[0] * b['hipw'], off[1], off[2] * b['torso']])
    J['hips'][0] = 0.0
    J['spine'] = J['hips'] + (spine0 - hips0) * b['torso']
    J['chest'] = J['spine'] + (chest0 - spine0) * b['torso']
    J['neck'] = J['chest'] + (neck0 - chest0) * b['torso']
    J['head'] = J['neck'] + (head0 - neck0) * b['neck']
    # arms
    sh0, ua0 = _v('shoulder.L'), _v('upper_arm.L')
    o1 = sh0 - chest0
    J['shoulder.L'] = J['chest'] + np.array([o1[0] * b['shoulderw'], o1[1], o1[2] * b['torso']])
    J['upper_arm.L'] = J['shoulder.L'] + (ua0 - sh0) * np.array([b['shoulderw'], 1.0, 1.0])
    J['forearm.L'] = J['upper_arm.L'] + RR.ARM_DIR * RR.UPPER_LEN * b['arm']
    J['hand.L'] = J['forearm.L'] + RR.ARM_DIR * RR.FORE_LEN * b['arm']
    hand0 = _v('hand.L')
    for n in HAND_LOCAL:
        J[n] = J['hand.L'] + (_v(n) - hand0) * b['hand']
    # head-local joints
    for n in HEAD_LOCAL:
        if head_joints and n in head_joints:
            J[n] = J['head'] + np.asarray(head_joints[n], float)
        else:
            J[n] = J['head'] + (_v(n) - head0) * b['head']
    # tail: Rocco's directions, per-segment lengths
    tl = b['tail'] if hasattr(b['tail'], '__len__') else (b['tail'],) * 5
    t0 = [_v(n) for n in ('tail.1', 'tail.2', 'tail.3', 'tail.4', 'tail.5', 'tail_tip')]
    J['tail.1'] = J['hips'] + (t0[0] - hips0) * np.array([1.0, b['hipw'], b['torso']])
    for i in range(5):
        nxt = 'tail.%d' % (i + 2) if i < 4 else 'tail_tip'
        cur = 'tail.%d' % (i + 1)
        J[nxt] = J[cur] + (t0[i + 1] - t0[i]) * max(tl[i], 0.02)
    # mirror
    for k in list(J):
        if k.endswith('.L'):
            p = J[k]
            J[k[:-2] + '.R'] = np.array([-p[0], p[1], p[2]])
    return {k: np.asarray(v, float) for k, v in J.items()}


def reference_joints():
    """The reference build: exactly Rocco's joint positions (minus the bat)."""
    return {k: np.array(v, float) for k, v in RR.J.items() if k not in BAT_BONES}

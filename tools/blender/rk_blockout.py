# rk_blockout.py - v0 blockout parts: rough primitives with the final names, materials, weights and shape keys.
# Replaced part by part by the real model builders; kept so the pipeline always has something complete.
import numpy as np
import rk_geo as G
import rk_rig as RR
from rk_geo import Part, ellipsoid, sweep, lathe


def _seg_tube(a, b, ra, rb, mat, n=12, rings=6):
    a, b = np.asarray(a, float), np.asarray(b, float)
    P = [a + (b - a) * t for t in np.linspace(0, 1, rings)]
    R = [ra + (rb - ra) * t for t in np.linspace(0, 1, rings)]
    return sweep(P, R, n, mat)


def head_parts():
    H = RR.jv('head')
    C = np.array([0, 0.0, 4.12])
    parts = []
    skull = ellipsoid(C, (0.66, 0.58, 0.58), 20, 14, 'fur')
    muzzle = ellipsoid(C + [0, -0.62, -0.3], (0.34, 0.42, 0.26), 16, 10, 'fur_light')
    chin = ellipsoid(C + [0, -0.5, -0.5], (0.26, 0.28, 0.14), 12, 8, 'fur_light')
    nose = ellipsoid(C + [0, -1.02, -0.22], (0.12, 0.09, 0.09), 10, 6, 'nose')
    mask = ellipsoid(C + [0, -0.18, 0.08], (0.67, 0.44, 0.2), 20, 8, 'mask')
    mouth = ellipsoid(C + [0, -0.86, -0.42], (0.2, 0.08, 0.025), 12, 6, 'mouth')
    tongue = ellipsoid(C + [0, -0.8, -0.44], (0.1, 0.06, 0.012), 8, 4, 'tongue')
    teeth = ellipsoid(C + [0, -0.88, -0.405], (0.16, 0.05, 0.012), 8, 4, 'eye_white')
    neck = _seg_tube(RR.jv('neck') + [0, 0, -0.1], H + [0, 0, 0.35], 0.2, 0.22, 'fur', 10, 4)
    parts += [skull, muzzle, chin, nose, mask, neck]
    for s in (1, -1):
        e = ellipsoid(C + [s * 0.185, -0.5, 0.08], (0.13, 0.1, 0.19), 12, 8, 'eye_white')
        lid = ellipsoid(C + [s * 0.185, -0.5, 0.08], (0.14, 0.11, 0.2), 12, 8, 'mask')
        lid.V[:, 2] = np.maximum(lid.V[:, 2], C[2] + 0.08 + 0.15)   # a thin cap at the top of the eye
        brow = ellipsoid(C + [s * 0.21, -0.53, 0.35], (0.13, 0.05, 0.04), 10, 6, 'fur_light')
        ear = ellipsoid(C + [s * 0.43, 0.04, 0.6], (0.16, 0.07, 0.24), 12, 8, 'fur')
        earin = ellipsoid(C + [s * 0.43, -0.01, 0.58], (0.1, 0.04, 0.16), 10, 6, 'fur_light')
        tuft = ellipsoid(C + [s * 0.62, -0.05, -0.35], (0.24, 0.1, 0.09), 10, 6, 'fur_light',
                         R=G.rot_y(-s * 0.2) @ G.rot_z(s * 0.5))
        sd = 'L' if s > 0 else 'R'
        brow.rigid('brow.' + sd)
        ear.rigid('ear.' + sd)
        earin.rigid('ear.' + sd)
        e.rigid('head')
        lid.rigid('head')
        tuft.rigid('head')
        # shape keys on the lids / brows
        lid.sk['blink'] = np.zeros_like(lid.V)
        top = C[2] + 0.08
        lid.sk['blink'][:, 2] = -(lid.V[:, 2] - (top - 0.21)) * 0.95 + (lid.V[:, 2] - top) * 0
        lid.sk['squint'] = lid.sk['blink'] * 0.45
        for k, dz, rz in (('brows_up', 0.08, 0), ('brows_angry', -0.04, 0.35), ('brows_sad', 0.02, -0.35)):
            d = np.zeros_like(brow.V)
            d[:, 2] = dz + (brow.V[:, 0] - s * 0.21) * s * rz * (-1)
            brow.sk[k] = d
        parts += [e, lid, brow, ear, earin, tuft]
    for p in (skull, muzzle, nose, mask, neck):
        p.rigid('head')
    neck.W = {'neck': np.ones(neck.n)}
    for p in (chin, tongue):
        p.rigid('jaw')
    mouth.rigid('head')
    teeth.rigid('head')
    # mouth shapes
    mc = C + [0, -0.86, -0.42]
    dx = mouth.V[:, 0] - mc[0]
    dz = mouth.V[:, 2] - mc[2]
    mouth.sk['smile'] = np.stack([dx * 0.2, 0 * dx, (dx / 0.2) ** 2 * 0.06], 1)
    mouth.sk['frown'] = np.stack([dx * 0.0, 0 * dx, -(dx / 0.2) ** 2 * 0.06], 1)
    mouth.sk['mouth_open'] = np.stack([-dx * 0.3, 0 * dx, dz * 6.0], 1)
    mouth.sk['grin'] = np.stack([dx * 0.3, 0 * dx, dz * 3.0 + (dx / 0.2) ** 2 * 0.05], 1)
    teeth.sk['grin'] = np.zeros_like(teeth.V)
    teeth.sk['grin'][:, 1] = -0.03
    tongue.sk['mouth_open'] = np.zeros_like(tongue.V)
    tongue.sk['mouth_open'][:, 1] = -0.02
    chin.sk['mouth_open'] = np.zeros_like(chin.V)
    chin.sk['mouth_open'][:, 2] = -0.12
    muzzle.sk['cheeks_puff'] = (muzzle.V - (C + [0, -0.62, -0.3])) * 0.12
    parts += [mouth, tongue, teeth]
    return parts


def pupil_parts():
    C = np.array([0, 0.0, 4.12])
    out = []
    for s in (1, -1):
        sd = 'L' if s > 0 else 'R'
        p = ellipsoid(C + [s * 0.185, -0.6, 0.06], (0.065, 0.02, 0.1), 10, 6, 'pupil')
        hl = ellipsoid(C + [s * 0.185 + 0.025, -0.62, 0.11], (0.022, 0.01, 0.028), 8, 4, 'eye_white')
        p.rigid('eye.' + sd)
        hl.rigid('eye.' + sd)
        out += [p, hl]
    return out


def body_parts():
    parts = []
    torso = ellipsoid((0, 0.04, 2.35), (0.5, 0.44, 0.62), 18, 12, 'uniform')
    seat = ellipsoid((0, 0.08, 1.72), (0.58, 0.5, 0.42), 18, 10, 'uniform')
    belt = lathe([(0.5, -0.06), (0.53, -0.05), (0.53, 0.05), (0.5, 0.06)], 20, 'belt', t=(0, 0.05, 1.98))
    buckle = G.box((0, -0.5, 1.98), (0.14, 0.04, 0.11), 'lace')
    collar = lathe([(0.2, -0.03), (0.25, -0.02), (0.25, 0.03), (0.2, 0.04)], 16, 'team_a', t=(0, 0.06, 2.95))
    placket = G.box((0, -0.45, 2.45), (0.06, 0.03, 0.85), 'team_a', R=G.rot_x(0.12))
    torso.set_weights({'spine': np.clip((2.4 - torso.V[:, 2]) / 0.4, 0, 1), 'chest': np.clip(1 - (2.4 - torso.V[:, 2]) / 0.4, 0, 1)})
    seat.rigid('hips')
    belt.rigid('spine')
    buckle.rigid('spine')
    collar.rigid('chest')
    placket.rigid('chest')
    parts += [torso, seat, belt, buckle, collar, placket]
    # tail
    tp = [RR.jv(k) for k in ('tail.1', 'tail.2', 'tail.3', 'tail.4', 'tail.5', 'tail_tip')]
    path = []
    for i in range(len(tp) - 1):
        for t in np.linspace(0, 1, 4, endpoint=False):
            path.append(tp[i] + (tp[i + 1] - tp[i]) * t)
    path.append(tp[-1])
    u = np.linspace(0, 1, len(path))
    rad = 0.1 + 0.2 * np.sin(np.clip(u * 1.15, 0, 1) * np.pi) ** 0.8 + 0.02
    tail = sweep(path, rad, 12, 'fur')
    rings = np.repeat(np.arange(len(path)), 12)
    band = (np.floor(u * 6) % 2).astype(int)
    mats = []
    for f in tail.F:
        k = min(rings[min(f)] if min(f) < len(rings) else len(path) - 1, len(path) - 1)
        mats.append('mask' if band[k] else 'fur')
    tail.mat = mats
    chain = [('tail.%d' % i, tp[i - 1], tp[i]) for i in range(1, 6)]
    W, _ = RR.chain_weights(tail.V, chain, 0.15)
    tail.set_weights(W)
    parts.append(tail)
    for s in (1, -1):
        sd = 'L' if s > 0 else 'R'
        mir = np.array([s, 1, 1])
        # legs: knickers + socks
        hj, kn, an = RR.jv('thigh.' + sd), RR.jv('shin.' + sd), RR.jv('foot.' + sd)
        knick = sweep([hj + [0, 0, 0.1], hj, (hj + kn) / 2, kn + [0, 0, 0.02], kn + [0, 0, -0.12]],
                      [0.24, 0.27, 0.27, 0.27, 0.15], 14, 'uniform')
        cuff = sweep([kn + [0, 0, -0.08], kn + [0, 0, -0.16]], [0.165, 0.165], 14, 'team_a')
        sock = sweep([kn + [0, 0, -0.1], (kn + an) / 2 + [0, 0, 0.1], an + [0, 0, -0.02]], [0.13, 0.14, 0.11], 12, 'team_a')
        sock_w = sweep([an + [0, 0.02, 0.18], an + [0, 0, -0.04]], [0.115, 0.115], 12, 'sock')
        W, _ = RR.chain_weights(knick.V, [('thigh.' + sd, hj, kn), ('shin.' + sd, kn, an)], 0.12)
        knick.set_weights(W)
        cuff.rigid('shin.' + sd)
        sock.rigid('shin.' + sd)
        sock_w.rigid('shin.' + sd)
        # shoe
        toe = RR.jv('toe.' + sd)
        shoe = ellipsoid((an + toe) / 2 + [0, -0.1, -0.05], (0.24, 0.5, 0.2), 16, 10, 'shoe')
        shoe.V[:, 2] = np.maximum(shoe.V[:, 2], 0.07)
        sole = G.box((an[0], (an[1] + toe[1]) / 2 - 0.1, 0.04), (0.44, 1.0, 0.08), 'sole')
        lace = G.box(((an + toe) / 2)[0:1].tolist() + [toe[1] + 0.12, 0.27], (0.14, 0.12, 0.05), 'lace')
        lace.V[:, 0] += 0
        for p in (shoe, sole, lace):
            p.set_weights({'foot.' + sd: np.clip((p.V[:, 1] - toe[1]) / 0.2 + 0.5, 0, 1), 'toe.' + sd: 1 - np.clip((p.V[:, 1] - toe[1]) / 0.2 + 0.5, 0, 1)})
        parts += [knick, cuff, sock, sock_w, shoe, sole, lace]
        # arms
        sh, el, wr = RR.jv('upper_arm.' + sd), RR.jv('forearm.' + sd), RR.jv('hand.' + sd)
        sleeve = sweep([sh - (el - sh) * 0.25, sh + (el - sh) * 0.35], [0.22, 0.2], 14, 'uniform')
        sleeve_pipe = sweep([sh + (el - sh) * 0.33, sh + (el - sh) * 0.4], [0.205, 0.205], 14, 'team_a')
        arm = sweep([sh, (sh + el) / 2, el, (el + wr) / 2, wr], [0.12, 0.11, 0.1, 0.09, 0.075], 10, 'team_a')
        W, _ = RR.chain_weights(arm.V, [('upper_arm.' + sd, sh, el), ('forearm.' + sd, el, wr)], 0.15)
        arm.set_weights(W)
        sleeve.set_weights({'upper_arm.' + sd: np.full(sleeve.n, 0.7), 'chest': np.full(sleeve.n, 0.3)})
        sleeve_pipe.rigid('upper_arm.' + sd)
        # glove: fist around the handle
        gc = RR.GRIP_C * mir
        dirv = RR.ARM_DIR * mir
        n_ = RR.HAND_N * mir
        palm = ellipsoid(wr + dirv * 0.14, (0.11, 0.13, 0.13), 12, 8, 'glove', R=G.frame_from(dirv, n_) @ np.eye(3))
        fist = ellipsoid(gc, (0.1, 0.12, 0.1), 12, 8, 'glove', R=G.frame_from(RR.HAND_T, n_))
        cuffg = lathe([(0.09, 0), (0.13, 0.02), (0.14, 0.08), (0.11, 0.1)], 14, 'glove',
                      R=G.zframe(-dirv), t=wr)
        for p in (palm, fist):
            p.rigid('hand.' + sd)
        cuffg.rigid('hand.' + sd)
        fing = ellipsoid(gc + n_ * 0.06, (0.05, 0.11, 0.05), 8, 6, 'glove', R=G.frame_from(RR.HAND_T, n_))
        fing.rigid('fingers.' + sd)
        th = ellipsoid(RR.jv('thumb.' + sd), (0.045, 0.08, 0.045), 8, 6, 'glove', R=G.frame_from(RR.HAND_T, n_))
        th.rigid('thumb.' + sd)
        parts += [sleeve, sleeve_pipe, arm, palm, fist, cuffg, fing, th]
    # stirrup accent stripes (team_b) and cap
    cap = ellipsoid(RR.jv('cap') + [0, 0, -0.08], (0.68, 0.64, 0.36), 18, 10, 'team_a')
    cap.V[:, 2] = np.maximum(cap.V[:, 2], RR.jv('cap')[2] - 0.02)
    brim = G.box(RR.jv('cap') + [0, -0.72, -0.02], (0.8, 0.4, 0.04), 'team_a', R=G.rot_x(-0.12))
    button = ellipsoid(RR.jv('cap') + [0, 0, 0.28], (0.05, 0.05, 0.03), 8, 4, 'team_b')
    for p in (cap, brim, button):
        p.rigid('cap')
    parts += [cap, brim, button]
    return parts


def decal_parts():
    def chest(u, v):
        x = (u - 0.5) * 0.5
        z = 2.3 + (v - 0.5) * 0.42
        y = -0.5 + 0.35 * x * x
        return (x + 0.18, y - 0.01, z)

    def back(u, v):
        x = (0.5 - u) * 0.45
        z = 2.45 + (v - 0.5) * 0.45
        y = 0.52 - 0.3 * x * x
        return (x, y + 0.01, z)
    a = G.grid_patch(4, 4, chest, 'decal_chest')
    b = G.grid_patch(4, 4, back, 'decal_back')
    a.rigid('chest')
    b.rigid('chest')
    return [a, b]


def bat_part():
    piv = RR.jv('bat')
    prof = [(0.0, RR.BAT_KNOB - 0.04), (0.075, RR.BAT_KNOB - 0.035), (0.08, RR.BAT_KNOB), (0.05, RR.BAT_KNOB + 0.04),
            (0.045, 0.3), (0.06, 0.8), (0.11, 1.4), (0.125, 1.9), (0.125, RR.BAT_TIP - 0.08), (0.1, RR.BAT_TIP - 0.01), (0.0, RR.BAT_TIP)]
    bat = lathe(prof, 12, 'bat_wood', R=np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]]), t=piv)
    # tape on the handle
    along = -(bat.V[:, 1] - piv[1])
    for i, f in enumerate(bat.F):
        a = along[f].mean()
        if -0.2 < a < 0.25:
            bat.mat[i] = 'bat_tape'
    bat.rigid('bat')
    return bat

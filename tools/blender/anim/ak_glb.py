# ak_glb.py - write an animation library glb: the reference skeleton (bone nodes with the reference build's rest
# transforms, a skin, a tiny skinned mannequin as the preview mesh) and the baked clips as glTF animations.
# Channels: rotation for every bone that leaves its rest (three.js restores untouched bones), translation only on
# root/hips, scale only on root (squash). Keys are the 40 fps samples, reduced where linear (spherical for
# rotations) interpolation stays within 0.1 deg / 0.002 ft / 0.002, with marker times always kept.
import json
import math
import struct
import hashlib
import numpy as np

from ak_math import M4, nrm, quat_slerp
from ak_skel import C4

TOL = {'rotation': math.radians(0.1), 'translation': 0.002, 'scale': 0.002}


# ------------------------------------------------------------------------------------------- key reduction
def _slerp_many(qa, qb, u):
    d = float(np.dot(qa, qb))
    if d < 0:
        qb, d = -qb, -d
    if d > 0.9995:
        q = qa[None, :] + (qb - qa)[None, :] * u[:, None]
    else:
        th = math.acos(min(1.0, d))
        q = (np.sin((1 - u) * th)[:, None] * qa[None, :] + np.sin(u * th)[:, None] * qb[None, :]) / math.sin(th)
    return q / np.linalg.norm(q, axis=1, keepdims=True)


def reduce_keys(path, T, V, tol, forced=()):
    n = len(T)
    if n <= 2:
        return np.arange(n)
    keep = np.zeros(n, bool)
    keep[0] = keep[-1] = True
    for ft in forced:
        k = int(np.argmin(np.abs(T - ft)))
        if abs(T[k] - ft) < 1e-4:
            keep[k] = True
    ks = list(np.nonzero(keep)[0])
    stack = list(zip(ks[:-1], ks[1:]))
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        u = (T[a + 1:b] - T[a]) / (T[b] - T[a])
        if path == 'rotation':
            q = _slerp_many(V[a], V[b], u)
            d = np.abs(np.sum(q * V[a + 1:b], axis=1))
            e = 2 * np.arccos(np.clip(d, 0, 1))
        else:
            L = V[a][None, :] + (V[b] - V[a])[None, :] * u[:, None]
            e = np.max(np.abs(L - V[a + 1:b]), axis=1)
        i = int(np.argmax(e))
        if e[i] > tol:
            m = a + 1 + i
            keep[m] = True
            stack.append((a, m))
            stack.append((m, b))
    return np.nonzero(keep)[0]


# ------------------------------------------------------------------------------------------- mannequin
def mannequin(sk):
    """Boxes along the main bones, each weighted 100% to its bone (preview only)."""
    pieces = [('hips', 'spine', 0.42, 0.30), ('spine', 'chest', 0.40, 0.28), ('chest', 'neck', 0.46, 0.30),
              ('neck', 'head', 0.16, 0.16)]
    for s in ('L', 'R'):
        pieces += [('upper_arm.' + s, 'forearm.' + s, 0.13, 0.13), ('forearm.' + s, 'hand.' + s, 0.11, 0.11),
                   ('thigh.' + s, 'shin.' + s, 0.20, 0.20), ('shin.' + s, 'foot.' + s, 0.15, 0.15),
                   ('foot.' + s, 'toe.' + s, 0.18, 0.14)]
    P, N, J, F = [], [], [], []
    idx = {b: i for i, b in enumerate(sk.names)}

    def box(a, b, w, d, bone):
        pa, pb = sk.J[a], sk.J[b]
        y = nrm(pb - pa)
        x = nrm(np.cross(y, [0, 1.0, 0])) if abs(y[1]) < 0.9 else nrm(np.cross(y, [1.0, 0, 0]))
        z = np.cross(x, y)
        corners = []
        for t in (0.0, 1.0):
            for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                corners.append(pa + (pb - pa) * t + x * sx * w / 2 + z * sz * d / 2)
        quads = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        for qd in quads:
            vs = [corners[i] for i in qd]
            nn = nrm(np.cross(vs[1] - vs[0], vs[2] - vs[0]))
            base = len(P)
            for v in vs:
                P.append(v)
                N.append(nn)
                J.append(idx[bone])
            F.append((base, base + 2, base + 1))
            F.append((base, base + 3, base + 2))
    for a, b, w, d in pieces:
        box(a, b, w, d, a)
    hc = sk.J['head'] + np.array([0, -0.15, 0.85])
    r = 0.62
    box_c = [(hc + np.array([0, 0, -r]), hc + np.array([0, 0, r]))]
    for pa, pb in box_c:
        y = nrm(pb - pa)
        corners = []
        for t in (0.0, 1.0):
            for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                corners.append(pa + (pb - pa) * t + np.array([sx * r * 0.85, sz * r * 0.8, 0]))
        quads = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        for qd in quads:
            vs = [corners[i] for i in qd]
            nn = nrm(np.cross(vs[1] - vs[0], vs[2] - vs[0]))
            base = len(P)
            for v in vs:
                P.append(v)
                N.append(nn)
                J.append(idx['head'])
            F.append((base, base + 2, base + 1))
            F.append((base, base + 3, base + 2))
    P = np.array([C4[:3, :3] @ p for p in P], np.float32)          # glTF space
    N = np.array([C4[:3, :3] @ v for v in N], np.float32)
    # make faces wind counter-clockwise seen from outside
    F2 = []
    for a, b, c in F:
        n_ = np.cross(P[b] - P[a], P[c] - P[a])
        F2.append((a, b, c) if np.dot(n_, N[a]) > 0 else (a, c, b))
    return P, N, np.array(J), np.array(F2, np.uint16)


# ------------------------------------------------------------------------------------------- writer
def write_library(out_path, sk, baked_list, lib, forced=None, extras=None, preview=True):
    """baked_list: ak_bake.Baked results. forced: {clip: [times]} keys always kept (markers)."""
    forced = forced or {}
    names = sk.names
    nid = {b: i for i, b in enumerate(names)}
    nodes = []
    for b in names:
        L = sk.local[b]
        t = L[:3, 3]
        from ak_math import quat_from_mat
        q = quat_from_mat(L[:3, :3])
        nd = {'name': b}
        if np.linalg.norm(t) > 1e-9:
            nd['translation'] = [float(x) for x in t]
        if abs(q[0] - 1) > 1e-9:
            nd['rotation'] = [float(q[1]), float(q[2]), float(q[3]), float(q[0])]
        ch = [nid[c] for c in sk.children[b]]
        if ch:
            nd['children'] = ch
        nodes.append(nd)
    binb = bytearray()
    views, accs = [], []

    def align():
        while len(binb) % 4:
            binb.append(0)

    def view(data, target=None):
        align()
        off = len(binb)
        binb.extend(data)
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target:
            v['target'] = target
        views.append(v)
        return len(views) - 1

    def acc(arr, ctype, typ, target=None, minmax=False):
        arr = np.ascontiguousarray(arr)
        a = {'bufferView': view(arr.tobytes(), target), 'componentType': ctype, 'count': int(arr.shape[0]), 'type': typ}
        if minmax:
            a['min'] = [float(x) for x in np.min(arr.reshape(arr.shape[0], -1), 0)]
            a['max'] = [float(x) for x in np.max(arr.reshape(arr.shape[0], -1), 0)]
        accs.append(a)
        return len(accs) - 1

    rig = len(nodes)
    root_children = [nid['root']]
    meshes, skins = [], []
    world_g = {b: C4 @ sk.world[b] for b in names}
    ibm = np.array([np.linalg.inv(world_g[b]).T.reshape(-1) for b in names], np.float32)   # column-major
    skins.append({'name': 'anim_' + lib, 'joints': list(range(len(names))), 'inverseBindMatrices': acc(ibm, 5126, 'MAT4')})
    materials = []
    if preview:
        P, N, J, F = mannequin(sk)
        joints = np.zeros((len(J), 4), np.uint8)
        joints[:, 0] = J
        weights = np.zeros((len(J), 4), np.float32)
        weights[:, 0] = 1.0
        materials.append({'name': 'preview', 'pbrMetallicRoughness': {'baseColorFactor': [0.85, 0.8, 0.7, 1.0], 'metallicFactor': 0.0, 'roughnessFactor': 1.0}})
        prim = {'attributes': {'POSITION': acc(P, 5126, 'VEC3', 34962, True), 'NORMAL': acc(N, 5126, 'VEC3', 34962),
                               'JOINTS_0': acc(joints, 5121, 'VEC4', 34962), 'WEIGHTS_0': acc(weights, 5126, 'VEC4', 34962)},
                'indices': acc(F.reshape(-1), 5123, 'SCALAR', 34963), 'material': 0}
        meshes.append({'name': 'anim_' + lib + '_preview', 'primitives': [prim]})
        nodes.append({'name': 'anim_' + lib + '_preview', 'mesh': 0, 'skin': 0})
        root_children.append(len(nodes) - 1)
        rig = len(nodes)
    nodes.append({'name': 'anim_' + lib, 'children': root_children})
    # animations
    anim_bytes = bytearray()
    a_accs = []
    tcache = {}

    def a_acc(arr, typ, is_time=False):
        arr = np.ascontiguousarray(arr, dtype=np.float32)
        raw = arr.tobytes()
        if is_time:
            h = hashlib.sha1(raw).hexdigest()
            if h in tcache:
                return tcache[h]
        while len(anim_bytes) % 4:
            anim_bytes.append(0)
        off = len(anim_bytes)
        anim_bytes.extend(raw)
        a = {'componentType': 5126, 'count': int(arr.shape[0]), 'type': typ, 'byteOffset': off}
        if is_time:
            a['min'] = [float(arr.min())]
            a['max'] = [float(arr.max())]
        a_accs.append(a)
        k = len(a_accs) - 1
        if is_time:
            tcache[h] = k
        return k
    anims = []
    stats = {'channels': 0, 'keys': 0, 'samples': 0}
    for res in baked_list:
        T = res.times
        fz = forced.get(res.name, ())
        samplers, channels = [], []
        anchored = False
        for b in names:
            if b in ('grip.L', 'grip.R', 'mitt'):
                continue
            restL = sk.local[b]
            from ak_math import quat_from_mat
            qr = quat_from_mat(restL[:3, :3])
            qr = np.array([qr[1], qr[2], qr[3], qr[0]])
            tracks = []
            Qb = res.Q[b]
            d = np.abs(Qb @ qr)
            moved = np.max(2 * np.arccos(np.clip(d, 0, 1))) > TOL['rotation'] * 0.5
            if moved or (b == 'hips' and not anchored):
                tracks.append(('rotation', Qb))
                if b == 'hips':
                    anchored = True
            if b in ('root', 'hips'):
                if np.max(np.abs(res.T[b] - restL[:3, 3])) > TOL['translation'] * 0.5:
                    tracks.append(('translation', res.T[b]))
            if b == 'root' and np.max(np.abs(res.S[b] - 1)) > TOL['scale'] * 0.5:
                tracks.append(('scale', res.S[b]))
            for chp, V in tracks:
                idx = reduce_keys(chp, T, V, TOL[chp], fz)
                if b == 'hips' and chp == 'rotation':
                    idx = np.union1d(idx, [0, len(T) - 1])
                ti = a_acc(T[idx].reshape(-1, 1), 'SCALAR', True)
                vi = a_acc(V[idx], 'VEC4' if chp == 'rotation' else 'VEC3')
                samplers.append({'input': ti, 'output': vi, 'interpolation': 'LINEAR'})
                channels.append({'sampler': len(samplers) - 1, 'target': {'node': nid[b], 'path': chp}})
                stats['channels'] += 1
                stats['keys'] += len(idx)
                stats['samples'] += len(T)
        anims.append({'name': res.name, 'channels': channels, 'samplers': samplers})
    base = len(accs)
    av = view(bytes(anim_bytes))
    for a in a_accs:
        a['bufferView'] = av
        accs.append(a)
    for an in anims:
        for s in an['samplers']:
            s['input'] += base
            s['output'] += base
    js = {'asset': {'version': '2.0', 'generator': 'tools/blender/anim (Screwball Slugger animation libraries)'},
          'scene': 0, 'scenes': [{'name': 'anim_' + lib, 'nodes': [rig], 'extras': extras or {}}],
          'nodes': nodes, 'skins': skins, 'animations': anims, 'accessors': accs, 'bufferViews': views,
          'buffers': [{'byteLength': 0}]}
    if meshes:
        js['meshes'] = meshes
        js['materials'] = materials
    align()
    js['buffers'][0]['byteLength'] = len(binb)
    j = json.dumps(js, separators=(',', ':')).encode('utf8')
    while len(j) % 4:
        j += b' '
    b = bytes(binb)
    total = 12 + 8 + len(j) + 8 + len(b)
    tmp = out_path + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(j), 0x4E4F534A))
        f.write(j)
        f.write(struct.pack('<II', len(b), 0x004E4942))
        f.write(b)
    import os
    os.replace(tmp, out_path)
    stats['bytes'] = total
    return stats

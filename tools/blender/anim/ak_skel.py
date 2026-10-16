# ak_skel.py - the reference skeleton for the shared animation libraries, read from a character glb (Rocco's
# assets/rocco.glb as the stand-in, later the cast generator's reference body). Nothing here depends on how the body
# was built: bone names, parents and rest transforms come from the file (docs/CAST-CONTRACT.md "Skeleton").
#
# Spaces. glTF model space: Y up, the character faces +Z, his left is +X (what the game loads). Authoring ("model")
# space is Blender's, like rk_clips: Z up, he faces -Y, his left is +X:  v_gltf = C @ v_model.
# A bone's local matrix is the same in both conventions (the exporter only converts the root's parent space), so
# world_model(bone) = C^T @ world_gltf(bone) and local = inv(world(parent)) @ world(bone) in either.
import json
import struct
import numpy as np

from ak_math import M4, orthonormal, mat_from_quat, nrm

C = np.array([[1.0, 0, 0], [0, 0, 1.0], [0, -1.0, 0]])          # model (Blender) -> glTF
C4 = M4(C)
PROP_BONES = ('bat', 'bat_sweet', 'bat_tip')                     # Rocco's prop bones: not part of the cast skeleton
SOCKETS = ('grip.L', 'grip.R', 'mitt')
OPTIONAL = ('jaw', 'cap', 'brow.L', 'brow.R', 'ear.L', 'ear.R', 'tail.1', 'tail.2', 'tail.3', 'tail.4', 'tail.5')
REQUIRED = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'eye.L', 'eye.R']
for _s in ('L', 'R'):
    REQUIRED += [b + '.' + _s for b in ('shoulder', 'upper_arm', 'forearm', 'hand', 'fingers', 'index', 'index_2', 'middle',
                                         'middle_2', 'pinky', 'pinky_2', 'thumb', 'thumb_2', 'thigh', 'shin', 'foot', 'toe')]
ROCCO_HIP = 1.70        # Rocco's hips height (ft): the clips are authored in "Rocco units" and scaled by hipHeight / 1.70

# socket offsets in the hand's local frame when a file has no sockets yet (rk_rig: grip = wrist + 0.17 along the
# hand + 0.075 toward the palm; mitt pocket = 0.22 along, 0.17 out of the palm, 0.04 toward the index side)
SOCKET_FALLBACK = {'grip.L': ('hand.L', (-0.075, 0.17, 0.0)), 'grip.R': ('hand.R', (0.075, 0.17, 0.0)),
                   'mitt': ('hand.L', (-0.17, 0.22, -0.04))}


def read_glb(path):
    data = open(path, 'rb').read()
    magic, ver, length = struct.unpack('<III', data[:12])
    assert magic == 0x46546C67, 'not a glb: ' + path
    off, js, bin_ = 12, None, b''
    while off < length:
        clen, ctype = struct.unpack('<II', data[off:off + 8])
        chunk = data[off + 8:off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode('utf8'))
        elif ctype == 0x004E4942:
            bin_ = chunk
        off += 8 + clen
    return js, bin_


def node_local(n):
    T = np.array(n.get('translation', [0, 0, 0]), float)
    q = n.get('rotation', [0, 0, 0, 1])
    S = np.array(n.get('scale', [1, 1, 1]), float)
    R = mat_from_quat((q[3], q[0], q[1], q[2]))
    return M4(R, T, S)


class Skel:
    """Bones in parent-first order with rest matrices. local[n]: rest local (parent space), world[n]: rest world in
    model space (orthonormal rotation; Rocco's file stores scales within 1e-6 of 1). J[n]: rest joint positions."""

    def __init__(self, names, parent, local, src='', extras=None):
        self.names, self.parent, self.src, self.extras = names, parent, src, extras or {}
        self.local = {}
        for n in names:
            L = local[n].copy()
            L[:3, :3] = orthonormal(L[:3, :3])
            self.local[n] = L
        self.world = {}
        for n in names:
            p = parent[n]
            self.world[n] = (C4.T @ self.local[n]) if p is None else self.world[p] @ self.local[n]
        self.J = {n: self.world[n][:3, 3].copy() for n in names}
        self.children = {n: [m for m in names if parent[m] == n] for n in names}
        self.hip_h = float(self.J['hips'][2])
        self.U = self.hip_h / ROCCO_HIP

    def has(self, n):
        return n in self.parent

    def R(self, n):
        return self.world[n][:3, :3]

    # ---- derived measures (model space)
    def seg(self, a, b):
        return float(np.linalg.norm(self.J[b] - self.J[a]))

    def summary(self):
        J = self.J
        out = dict(hipHeight=round(self.hip_h, 4), U=round(self.U, 4), bones=len(self.names),
                   thigh=round(self.seg('thigh.L', 'shin.L'), 4), shin=round(self.seg('shin.L', 'foot.L'), 4),
                   upper_arm=round(self.seg('upper_arm.L', 'forearm.L'), 4), forearm=round(self.seg('forearm.L', 'hand.L'), 4),
                   shoulder=[round(float(v), 4) for v in J['upper_arm.L']], head=[round(float(v), 4) for v in J['head']])
        return out


def from_glb(path, keep_optional=None):
    """Skeleton from a character glb: the skin's joints (or every node under 'root'), minus prop bones, plus sockets
    (from the file when present, else rk_rig's offsets). keep_optional: another Skel whose optional bones (tail, ears,
    jaw, cap, brows) are grafted on when this file lacks them, so the clips still carry their channels."""
    js, _ = read_glb(path)
    nodes = js['nodes']
    name_of = [n.get('name', 'node%d' % i) for i, n in enumerate(nodes)]
    par = [None] * len(nodes)
    for i, n in enumerate(nodes):
        for c in n.get('children', []):
            par[c] = i
    try:
        ri = name_of.index('root')
    except ValueError:
        raise RuntimeError(path + ': no "root" node')
    names, parent, local = [], {}, {}

    def walk(i, p):
        nm = name_of[i]
        if nm in PROP_BONES or 'mesh' in nodes[i]:
            return
        names.append(nm)
        parent[nm] = p
        local[nm] = node_local(nodes[i])
        for c in nodes[i].get('children', []):
            walk(c, nm)
    walk(ri, None)
    extras = {}
    for sc in js.get('scenes', []):
        extras.update(sc.get('extras', {}) or {})
    sk = Skel(names, parent, local, src=path, extras=extras)
    miss = [b for b in REQUIRED if b not in sk.parent]
    if miss:
        raise RuntimeError(path + ': missing required bones ' + ', '.join(miss))
    add = {}
    if keep_optional is not None:
        for b in OPTIONAL:
            if not sk.has(b) and keep_optional.has(b) and (keep_optional.parent[b] in sk.parent or keep_optional.parent[b] in add):
                add[b] = (keep_optional.parent[b], keep_optional.local[b])
    for s, (hb, off) in SOCKET_FALLBACK.items():
        if not sk.has(s):
            Rh = sk.R(hb)
            # identity control bone: world rotation = model axes rotated like the root's rest (Blender bone up, roll 0)
            Rw = sk.R('root')
            Lr = np.linalg.inv(sk.world[hb]) @ M4(Rw, sk.J[hb] + Rh @ np.array(off))
            add[s] = (hb, Lr)
    if add:
        names = list(sk.names)
        parent = dict(sk.parent)
        local = dict(sk.local)
        for b, (p, L) in add.items():
            names.append(b)
            parent[b] = p
            local[b] = L
        # parent-first order
        order, seen = [], set()

        def visit(n):
            if n in seen:
                return
            if parent[n] is not None:
                visit(parent[n])
            seen.add(n)
            order.append(n)
        for n in names:
            visit(n)
        sk2 = Skel(order, parent, local, src=path, extras=extras)
        sk2.grafted = sorted(add)
        return sk2
    sk.grafted = []
    return sk


if __name__ == '__main__':
    import sys
    sk = from_glb(sys.argv[1] if len(sys.argv) > 1 else 'assets/rocco.glb')
    print(sk.summary())
    print('grafted', sk.grafted)
    np.set_printoptions(precision=4, suppress=True)
    for n in ('root', 'hips', 'chest', 'upper_arm.L', 'forearm.L', 'hand.L', 'hand.R', 'grip.L', 'grip.R', 'mitt', 'thigh.L', 'shin.L', 'foot.L', 'toe.L',
              'index.L', 'thumb.L', 'fingers.L', 'eye.L', 'cap', 'tail.1'):
        if sk.has(n):
            R = sk.R(n)
            print('%-12s head %s  X %s  Y %s  Z %s' % (n, sk.J[n], R[:, 0], R[:, 1], R[:, 2]))

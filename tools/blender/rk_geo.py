# rk_geo.py - geometry toolkit for the Rocco build (numpy-first; Blender only for heavy mesh ops).
# A Part is plain data: vertices, polygons, a material name per polygon, per-vertex bone weights, sharp edges,
# optional UVs and shape-key deltas. Parts are merged per Blender object at the end (see make_object).
import math
import numpy as np
import bpy
import bmesh

TAU = math.tau


# --------------------------------------------------------------------------------------------- small math
def v3(*a):
    if len(a) == 1:
        return np.asarray(a[0], float)
    return np.array(a, float)


def nrm(v):
    v = np.asarray(v, float)
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-12)


def smoothstep(e0, e1, x):
    t = np.clip((np.asarray(x, float) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def rot_axis(axis, a):
    axis = nrm(axis)
    x, y, z = axis
    c, s, C = math.cos(a), math.sin(a), 1 - math.cos(a)
    return np.array([[c + x * x * C, x * y * C - z * s, x * z * C + y * s],
                     [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
                     [z * x * C - y * s, z * y * C + x * s, c + z * z * C]])


def zframe(z):
    """Rotation whose third column is z (for lathes/sweeps built around local +z)."""
    z = nrm(z)
    a = np.array([1.0, 0, 0]) if abs(z[0]) < 0.9 else np.array([0, 1.0, 0])
    x = nrm(np.cross(a, z))
    y = np.cross(z, x)
    return np.stack([x, y, z], 1)


def frame_from(y_axis, up_hint):
    """Orthonormal 3x3 (columns x, y, z) with column y = y_axis and z as close as possible to up_hint."""
    y = nrm(y_axis)
    z = np.asarray(up_hint, float) - np.dot(up_hint, y) * y
    if np.linalg.norm(z) < 1e-6:
        z = np.cross(y, [1, 0, 0]) if abs(y[0]) < 0.9 else np.cross(y, [0, 1, 0])
    z = nrm(z)
    x = np.cross(y, z)
    return np.stack([x, y, z], 1)


# --------------------------------------------------------------------------------------------- Part
class Part:
    def __init__(self, V, F, mat, name='part'):
        self.V = np.asarray(V, float).reshape(-1, 3)
        self.F = [list(map(int, f)) for f in F]
        self.mat = list(mat) if isinstance(mat, (list, tuple)) else [mat] * len(self.F)
        assert len(self.mat) == len(self.F)
        self.W = {}          # bone -> (n,) weights
        self.sharp = set()   # (i, j) vertex pairs, i < j
        self.uv = None       # list per face of [(u, v), ...] matching the face's corners
        self.sk = {}         # shape key -> (n, 3) deltas
        self.name = name
        self.flat = False    # flat shading for the whole part

    @property
    def n(self):
        return len(self.V)

    def copy(self):
        p = Part(self.V.copy(), [list(f) for f in self.F], list(self.mat), self.name)
        p.W = {k: w.copy() for k, w in self.W.items()}
        p.sharp = set(self.sharp)
        p.uv = None if self.uv is None else [list(u) for u in self.uv]
        p.sk = {k: d.copy() for k, d in self.sk.items()}
        p.flat = self.flat
        return p

    def rigid(self, bone):
        self.W = {bone: np.ones(self.n)}
        return self

    def set_weights(self, W):
        self.W = {k: np.asarray(w, float) for k, w in W.items() if np.any(np.asarray(w) > 1e-4)}
        return self

    def transform(self, M3=None, t=None):
        if M3 is not None:
            self.V = self.V @ np.asarray(M3).T
            for k in self.sk:
                self.sk[k] = self.sk[k] @ np.asarray(M3).T
        if t is not None:
            self.V = self.V + np.asarray(t, float)
        return self

    def mirror_x(self):
        p = self.copy()
        p.V[:, 0] *= -1
        for k in p.sk:
            p.sk[k][:, 0] *= -1
        p.F = [f[::-1] for f in p.F]
        if p.uv is not None:
            p.uv = [u[::-1] for u in p.uv]
        W = {}
        for b, w in p.W.items():
            W[swap_lr(b)] = w
        p.W = W
        return p

    def mark_sharp_ring(self, idx):
        idx = list(idx)
        for a, b in zip(idx, idx[1:] + idx[:1]):
            self.sharp.add((min(a, b), max(a, b)))

    def tri_count(self):
        return sum(len(f) - 2 for f in self.F)


def swap_lr(name):
    if name.endswith('.L'):
        return name[:-2] + '.R'
    if name.endswith('.R'):
        return name[:-2] + '.L'
    return name


def merge(parts, name='merged'):
    Vs, F, M, uvs, has_uv = [], [], [], [], any(p.uv is not None for p in parts)
    W, sharp, sk = {}, set(), {}
    off = 0
    total = sum(p.n for p in parts)
    keys = sorted(set(k for p in parts for k in p.sk))
    for k in keys:
        sk[k] = np.zeros((total, 3))
    flat_faces = []
    for p in parts:
        Vs.append(p.V)
        F.extend([[i + off for i in f] for f in p.F])
        M.extend(p.mat)
        flat_faces.extend([p.flat] * len(p.F))
        for b, w in p.W.items():
            if b not in W:
                W[b] = np.zeros(total)
            W[b][off:off + p.n] += w
        for a, b in p.sharp:
            sharp.add((a + off, b + off))
        if has_uv:
            uvs.extend(p.uv if p.uv is not None else [[(0.0, 0.0)] * len(f) for f in p.F])
        for k, d in p.sk.items():
            sk[k][off:off + p.n] = d
        off += p.n
    out = Part(np.concatenate(Vs) if Vs else np.zeros((0, 3)), F, M, name)
    out.W, out.sharp, out.sk = W, sharp, sk
    out.uv = uvs if has_uv else None
    out.flat_faces = flat_faces
    return out


# --------------------------------------------------------------------------------------------- primitives
def grid_faces(nu, nv, wrap_u=True, offset=0):
    """Quads for an nv x nu vertex grid (rows along v). wrap_u closes each row into a ring."""
    F = []
    cols = nu if wrap_u else nu - 1
    for j in range(nv - 1):
        for i in range(cols):
            a = offset + j * nu + i
            b = offset + j * nu + (i + 1) % nu
            c = offset + (j + 1) * nu + (i + 1) % nu
            d = offset + (j + 1) * nu + i
            F.append([a, b, c, d])
    return F


def ellipsoid(center, radii, nu=16, nv=10, mat='fur', R=None, name='ell'):
    """UV ellipsoid (poles along local z), closed, outward."""
    prof = [(math.sin(math.pi * j / nv), -math.cos(math.pi * j / nv)) for j in range(nv + 1)]
    prof[0] = (0.0, -1.0)
    prof[-1] = (0.0, 1.0)
    p = lathe(prof, nu, mat, name=name)
    p.V = p.V * np.asarray(radii, float)
    if R is not None:
        p.V = p.V @ np.asarray(R).T
    p.V = p.V + np.asarray(center, float)
    return p


def lathe(profile, n=16, mat='fur', R=None, t=None, name='lathe', cap_ends=True):
    """Surface of revolution around local +z. profile: [(r, z), ...] bottom to top. r==0 at ends -> poles."""
    prof = [(float(r), float(z)) for r, z in profile]
    V, rings = [], []
    poles = []
    for k, (r, z) in enumerate(prof):
        if r <= 1e-6:
            poles.append((k, len(V)))
            V.append([0, 0, z])
            rings.append(None)
        else:
            rings.append(len(V))
            for i in range(n):
                a = TAU * i / n
                V.append([r * math.cos(a), r * math.sin(a), z])
    F = []
    for k in range(len(prof) - 1):
        a, b = rings[k], rings[k + 1]
        if a is not None and b is not None:
            for i in range(n):
                F.append([a + i, a + (i + 1) % n, b + (i + 1) % n, b + i])
        elif a is None and b is not None:
            p = [pi for kk, pi in poles if kk == k][0]
            for i in range(n):
                F.append([p, b + (i + 1) % n, b + i])
        elif a is not None and b is None:
            p = [pi for kk, pi in poles if kk == k + 1][0]
            for i in range(n):
                F.append([a + i, a + (i + 1) % n, p])
    if cap_ends:
        if rings[0] is not None:
            a = rings[0]
            F.append([a + i for i in range(n)][::-1])
        if rings[-1] is not None:
            a = rings[-1]
            F.append([a + i for i in range(n)])
    V = np.array(V, float)
    if R is not None:
        V = V @ np.asarray(R).T
    if t is not None:
        V = V + np.asarray(t, float)
    return Part(V, F, mat, name)


def sweep(path, radii, n=12, mat='fur', up=(0, 0, 1), name='sweep', caps=True, rx=None, ry=None,
          frames=None, profile=None):
    """Tube along a polyline. radii per path point (or rx/ry ellipse radii). Ends capped with a pole vertex
    pushed out by the end radius (rounded caps) when caps=True. Returns Part with .ring_index (path k -> first vertex)."""
    P = np.asarray(path, float)
    m = len(P)
    if rx is None:
        rx = np.broadcast_to(np.asarray(radii, float), (m,)).copy()
        ry = rx.copy()
    else:
        rx = np.broadcast_to(np.asarray(rx, float), (m,)).copy()
        ry = np.broadcast_to(np.asarray(ry, float), (m,)).copy()
    # parallel-transport frames
    T = np.zeros_like(P)
    T[1:-1] = P[2:] - P[:-2]
    T[0] = P[1] - P[0]
    T[-1] = P[-1] - P[-2]
    T = nrm(T)
    if frames is None:
        frames = []
        u = np.asarray(up, float)
        u = u - np.dot(u, T[0]) * T[0]
        if np.linalg.norm(u) < 1e-6:
            u = np.cross(T[0], [1, 0, 0])
        u = nrm(u)
        for k in range(m):
            if k > 0:
                # transport u from T[k-1] to T[k]
                ax = np.cross(T[k - 1], T[k])
                s = np.linalg.norm(ax)
                if s > 1e-9:
                    ang = math.atan2(s, np.dot(T[k - 1], T[k]))
                    u = rot_axis(ax, ang) @ u
                u = nrm(u - np.dot(u, T[k]) * T[k])
            frames.append((np.cross(T[k], u), u))   # (side, up)
    V = []
    ring_index = []
    for k in range(m):
        sd, uu = frames[k]
        ring_index.append(len(V))
        for i in range(n):
            a = TAU * i / n
            if profile is not None:
                pr = profile(k, a)
                V.append(P[k] + uu * pr[1] + sd * pr[0])
            else:
                V.append(P[k] + uu * math.cos(a) * ry[k] + sd * math.sin(a) * rx[k])
    F = grid_faces(n, m)
    if caps:
        c0 = len(V)
        V.append(P[0] - T[0] * min(rx[0], ry[0]) * 0.6)
        c1 = len(V)
        V.append(P[-1] + T[-1] * min(rx[-1], ry[-1]) * 0.6)
        for i in range(n):
            F.append([c0, (i + 1) % n, i])
            a = (m - 1) * n
            F.append([c1, a + i, a + (i + 1) % n])
    p = Part(np.array(V), F, mat, name)
    p.ring_index = ring_index
    p.path = P
    p.nside = n
    return p


def box(center, size, mat='fur', R=None, name='box'):
    hx, hy, hz = np.asarray(size, float) / 2
    V = np.array([[-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
                  [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]])
    F = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
    if R is not None:
        V = V @ np.asarray(R).T
    return Part(V + np.asarray(center, float), F, mat, name)


def grid_patch(nu, nv, fn, mat, name='patch'):
    """Open grid surface; fn(u, v) -> xyz for u, v in [0, 1]. UVs = (u, v)."""
    V, uv = [], []
    for j in range(nv + 1):
        for i in range(nu + 1):
            u, v = i / nu, j / nv
            V.append(fn(u, v))
    F, U = [], []
    for j in range(nv):
        for i in range(nu):
            a = j * (nu + 1) + i
            f = [a, a + 1, a + nu + 2, a + nu + 1]
            F.append(f)
            U.append([(i / nu, j / nv), ((i + 1) / nu, j / nv), ((i + 1) / nu, (j + 1) / nv), (i / nu, (j + 1) / nv)])
    p = Part(np.array(V), F, mat, name)
    p.uv = U
    return p


# --------------------------------------------------------------------------------------------- Blender bridge
def _ctx_obj(ob):
    return bpy.context.temp_override(active_object=ob, object=ob, selected_objects=[ob], selected_editable_objects=[ob])


def to_blender_mesh(V, F, name='tmp'):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, v)) for v in V], [], [tuple(f) for f in F])
    me.update()
    return me


def from_blender_mesh(me):
    V = np.zeros((len(me.vertices), 3))
    me.vertices.foreach_get('co', V.ravel())
    F = [list(p.vertices) for p in me.polygons]
    return V, F


def bl_temp_object(V, F, name='tmp'):
    me = to_blender_mesh(V, F, name)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    return ob


def bl_delete(ob):
    me = ob.data
    bpy.data.objects.remove(ob, do_unlink=True)
    if me is not None and me.users == 0:
        bpy.data.meshes.remove(me)


def bl_apply_modifiers(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    return from_blender_mesh(me) + (me,)


def clean_degenerate(V, F, dist=1e-6):
    me = to_blender_mesh(V, F, 'clean')
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bmesh.ops.dissolve_degenerate(bm, dist=dist, edges=bm.edges)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.to_mesh(me)
    bm.free()
    out = from_blender_mesh(me)
    bpy.data.meshes.remove(me)
    return out


def voxel_remesh(V, F, voxel):
    ob = bl_temp_object(V, F, 'vox')
    ob.data.remesh_voxel_size = voxel
    ob.data.remesh_voxel_adaptivity = 0.0
    with _ctx_obj(ob):
        bpy.ops.object.voxel_remesh()
    V2, F2 = from_blender_mesh(ob.data)
    bl_delete(ob)
    return V2, F2


def quadriflow(V, F, faces, seed=0, sharp=False):
    V, F = clean_degenerate(V, F)
    ob = bl_temp_object(V, F, 'qf')
    with _ctx_obj(ob):
        r = bpy.ops.object.quadriflow_remesh(target_faces=int(faces), use_mesh_symmetry=False, use_preserve_sharp=sharp,
                                             use_preserve_boundary=False, smooth_normals=False, seed=seed)
    if 'FINISHED' not in r:
        bl_delete(ob)
        raise RuntimeError('quadriflow failed')
    V2, F2 = from_blender_mesh(ob.data)
    bl_delete(ob)
    return V2, F2


def decimate(V, F, ratio=None, target_tris=None, sym=False):
    V, F = clean_degenerate(V, F)
    ob = bl_temp_object(V, F, 'dec')
    tris = sum(len(f) - 2 for f in F)
    md = ob.modifiers.new('dec', 'DECIMATE')
    md.ratio = ratio if ratio is not None else min(1.0, target_tris / max(1, tris))
    md.use_collapse_triangulate = True
    if sym:
        md.use_symmetry = True
        md.symmetry_axis = 'X'
    V2, F2, me = bl_apply_modifiers(ob)
    bpy.data.meshes.remove(me)
    bl_delete(ob)
    return V2, F2


def subdivide(V, F, levels=1, crease_edges=None):
    ob = bl_temp_object(V, F, 'sub')
    md = ob.modifiers.new('sub', 'SUBSURF')
    md.levels = levels
    md.render_levels = levels
    md.quality = 3
    md.uv_smooth = 'NONE'
    md.boundary_smooth = 'ALL'
    if crease_edges:
        me = ob.data
        attr = me.attributes.get('crease_edge') or me.attributes.new('crease_edge', 'FLOAT', 'EDGE')
        lookup = {}
        for e in me.edges:
            a, b = e.vertices
            lookup[(min(a, b), max(a, b))] = e.index
        vals = [0.0] * len(me.edges)
        for (a, b), c in crease_edges.items():
            k = lookup.get((min(a, b), max(a, b)))
            if k is not None:
                vals[k] = c
        attr.data.foreach_set('value', vals)
    V2, F2, me = bl_apply_modifiers(ob)
    bpy.data.meshes.remove(me)
    bl_delete(ob)
    return V2, F2


def skin_mesh(points, edges, radii, root=0, subsurf=2):
    """Skin modifier on an edge skeleton (+ subdivision). radii: list of (rx, ry)."""
    me = bpy.data.meshes.new('skin')
    me.from_pydata([tuple(map(float, p)) for p in points], [tuple(e) for e in edges], [])
    me.update()
    ob = bpy.data.objects.new('skin', me)
    bpy.context.scene.collection.objects.link(ob)
    sk = ob.modifiers.new('skin', 'SKIN')
    sk.use_smooth_shade = True
    sk.branch_smoothing = 0.6
    for i, d in enumerate(me.skin_vertices[0].data):
        d.radius = tuple(map(float, radii[i]))
        d.use_root = (i == root)
    if subsurf:
        ss = ob.modifiers.new('sub', 'SUBSURF')
        ss.levels = subsurf
    V2, F2, me2 = bl_apply_modifiers(ob)
    bpy.data.meshes.remove(me2)
    bl_delete(ob)
    return V2, F2


# --------------------------------------------------------------------------------------------- mesh queries
def vertex_normals(V, F):
    N = np.zeros_like(V)
    for f in F:
        if len(f) < 3:
            continue
        p = V[f]
        n = np.zeros(3)
        for i in range(len(f)):  # Newell
            a, b = p[i], p[(i + 1) % len(f)]
            n += np.array([(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])])
        N[f] += n
    return nrm(N)


def vertex_neighbors(n, F):
    nb = [set() for _ in range(n)]
    for f in F:
        for i in range(len(f)):
            a, b = f[i], f[(i + 1) % len(f)]
            nb[a].add(b)
            nb[b].add(a)
    return [np.array(sorted(s), int) for s in nb]


def laplacian_smooth_field(W, nb, iters=3, lam=0.5, fixed=None):
    """Diffuse per-vertex scalar arrays (dict of arrays) over the mesh graph."""
    for _ in range(iters):
        out = {}
        for k, w in W.items():
            avg = np.array([w[ix].mean() if len(ix) else w[i] for i, ix in enumerate(nb)])
            nw = w + lam * (avg - w)
            if fixed is not None:
                nw[fixed] = w[fixed]
            out[k] = nw
        W = out
    return W


def face_centroids(V, F):
    return np.array([V[f].mean(0) for f in F])


def tri_count(F):
    return sum(len(f) - 2 for f in F)

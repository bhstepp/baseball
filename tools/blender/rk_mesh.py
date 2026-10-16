# rk_mesh.py - mesh processing: SDF -> clean mesh, level-set material cuts, relaxation, symmetry helpers.
import math
import numpy as np
import bpy
import bmesh

import rk_geo as G
import rk_sdf as SD


def sdf_mesh(f, lo, hi, h, voxel=None, quads=None, tris=None, sym=False, project_iters=3, relax=0, seed=0, keep_frac=0.2):
    """Polygonise f, clean it with a voxel remesh, then QuadriFlow (quads=N) or collapse-decimate (tris=N)."""
    V, T = SD.mesh_sdf_tets(f, lo, hi, h)
    V, F = V, T.tolist()
    V, F = keep_islands(V, F, min_frac=keep_frac)
    if quads:
        # QuadriFlow is happiest with a moderate, clean triangle input
        V, F = G.decimate(V, F, target_tris=max(quads * 12, 20000))
        V, F = G.quadriflow(V, F, quads, seed=seed)
    elif tris:
        V, F = G.decimate(V, F, target_tris=tris, sym=sym)
    V = SD.project(f, V, iters=project_iters, max_step=h * 2)
    for _ in range(relax):
        V = relax_tangent(V, F, 0.5)
        V = SD.project(f, V, iters=2, max_step=h * 2)
    if sym:
        V = symmetrize(V, F)
    return V, F


def weld(V, F, eps=1e-7):
    """Merge coincident vertices (marching tets can emit duplicates at grid points with ~zero value)."""
    q = np.round(np.asarray(V) / eps).astype(np.int64)
    _, first, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
    inv = inv.ravel()
    F2 = []
    for f in F:
        g = [int(inv[i]) for i in f]
        if len(set(g)) == len(g):
            F2.append(g)
    return np.asarray(V)[first], F2


def islands(n, F):
    parent = np.arange(n)

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for f in F:
        r0 = find(f[0])
        for v in f[1:]:
            r = find(v)
            if r != r0:
                parent[r] = r0
    return np.array([find(i) for i in range(n)])


def keep_islands(V, F, min_frac=0.2):
    """Drop connected pieces smaller than min_frac of the largest (voxel-remesh debris)."""
    lab = islands(len(V), F)
    u, cnt = np.unique(lab, return_counts=True)
    keep = set(u[cnt >= cnt.max() * min_frac])
    F2 = [f for f in F if lab[f[0]] in keep]
    return remove_unused(np.asarray(V), F2)


def relax_tangent(V, F, lam=0.5, fixed=None):
    """One step of tangential Laplacian smoothing (evens out vertex spacing without shrinking much)."""
    nb = G.vertex_neighbors(len(V), F)
    N = G.vertex_normals(V, F)
    avg = np.array([V[ix].mean(0) if len(ix) else V[i] for i, ix in enumerate(nb)])
    d = avg - V
    d -= (d * N).sum(1, keepdims=True) * N
    out = V + lam * d
    if fixed is not None:
        out[fixed] = V[fixed]
    return out


def symmetrize(V, F, tol=None):
    """Make a nearly-symmetric mesh exactly symmetric about x = 0 by averaging mirrored vertex pairs (if found)."""
    from math import inf
    Vm = V.copy()
    Vm[:, 0] *= -1
    # nearest neighbour by sorting (small meshes): brute force in chunks
    out = V.copy()
    n = len(V)
    if n > 40000:
        return V
    d2 = ((V[:, None, :] - Vm[None, :, :]) ** 2).sum(-1) if n < 6000 else None
    if d2 is None:
        return V
    j = d2.argmin(1)
    ok = d2[np.arange(n), j] < (tol or 0.01) ** 2
    mid = (V + Vm[j]) / 2
    out[ok] = mid[ok]
    on_axis = np.abs(out[:, 0]) < 1e-4
    out[on_axis, 0] = 0.0
    return out


# --------------------------------------------------------------------------------------------- level-set cuts
def cut_by_field(V, F, phi, surf=None, snap=0.12):
    """Split the mesh along the zero level of the per-vertex scalar phi (array or callable on positions).
    New vertices are placed by linear interpolation along edges (then projected onto surf if given).
    Returns V, F (n-gons triangulated to tris/quads)."""
    V = np.asarray(V, float)
    ph = phi(V) if callable(phi) else np.asarray(phi, float).copy()
    bm = bmesh.new()
    for p in V:
        bm.verts.new(p)
    bm.verts.index_update()
    bm.verts.ensure_lookup_table()
    for f in F:
        try:
            bm.faces.new([bm.verts[i] for i in f])
        except ValueError:
            pass
    bm.verts.ensure_lookup_table()
    lay = bm.verts.layers.float.new('phi')
    # snap values close to zero (relative to the edge) to exactly zero to avoid slivers
    for v in bm.verts:
        v[lay] = float(ph[v.index])
    for e in bm.edges:
        a, b = e.verts
        pa, pb = a[lay], b[lay]
        if pa * pb < 0:
            t = pa / (pa - pb)
            if t < snap:
                a[lay] = 0.0
            elif t > 1 - snap:
                b[lay] = 0.0
    new_verts = []
    for e in list(bm.edges):
        a, b = e.verts
        pa, pb = a[lay], b[lay]
        if pa * pb < 0:
            t = pa / (pa - pb)
            ne, nv = bmesh.utils.edge_split(e, a, t)
            nv[lay] = 0.0
            new_verts.append(nv)
    for f in list(bm.faces):
        zs = [v for v in f.verts if v[lay] == 0.0]
        if len(zs) < 2:
            continue
        # split between zero verts that separate a positive and a negative run
        loop = list(f.verts)
        n = len(loop)
        signs = [0 if v[lay] == 0.0 else (1 if v[lay] > 0 else -1) for v in loop]
        if not (1 in signs and -1 in signs):
            continue
        zi = [i for i in range(n) if signs[i] == 0]
        if len(zi) == 2:
            i, j = zi
            if (j - i) % n in (1, n - 1):
                continue
            try:
                bmesh.utils.face_split(f, loop[i], loop[j])
            except Exception:
                pass
        else:
            # pick the pair whose split separates the signs
            done = False
            for ii in range(len(zi)):
                for jj in range(ii + 1, len(zi)):
                    i, j = zi[ii], zi[jj]
                    if (j - i) % n in (1, n - 1):
                        continue
                    s1 = [signs[k % n] for k in range(i + 1, j)]
                    s2 = [signs[k % n] for k in range(j + 1, i + n)]
                    if (1 in s1 and -1 not in s1 and -1 in s2 and 1 not in s2) or (-1 in s1 and 1 not in s1 and 1 in s2 and -1 not in s2):
                        try:
                            bmesh.utils.face_split(f, loop[i], loop[j])
                        except Exception:
                            pass
                        done = True
                        break
                if done:
                    break
    big = [f for f in bm.faces if len(f.verts) > 4]
    if big:
        bmesh.ops.triangulate(bm, faces=big, quad_method='BEAUTY', ngon_method='BEAUTY')
    bm.verts.index_update()
    bm.faces.index_update()
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    V2 = np.array([v.co[:] for v in bm.verts])
    F2 = [[v.index for v in f.verts] for f in bm.faces]
    if surf is not None and new_verts:
        idx = np.array([v.index for v in new_verts])
        V2[idx] = SD.project(surf, V2[idx], iters=2)
    bm.free()
    return V2, F2


def faces_by_region(V, F, regions, default):
    """regions: list of (material, fn(points)->signed (negative inside)) in priority order (first wins)."""
    C = G.face_centroids(V, F)
    mats = np.array([default] * len(F), dtype=object)
    done = np.zeros(len(F), bool)
    for mat, fn in regions:
        inside = (fn(C) < 0) & ~done
        mats[inside] = mat
        done |= inside
    return list(mats)


def remove_unused(V, F):
    used = sorted(set(i for f in F for i in f))
    remap = {o: n for n, o in enumerate(used)}
    return V[used], [[remap[i] for i in f] for f in F]


def split_long_tris(V, F):
    return V, F

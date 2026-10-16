# rk_sdf.py - signed-distance modelling in numpy: primitives, smooth booleans, surface nets meshing, projection.
# SDFs are plain callables f(P) -> distance for points P of shape (..., 3); negative inside.
import math
import numpy as np


def _p(P):
    return np.asarray(P, float)


# --------------------------------------------------------------------------------------------- primitives
def sphere(c, r):
    c = np.asarray(c, float)
    return lambda P: np.linalg.norm(_p(P) - c, axis=-1) - r


def ellipsoid(c, radii, R=None):
    """Approximate distance (IQ bound). R: 3x3 rotation of the ellipsoid axes (columns)."""
    c = np.asarray(c, float)
    r = np.asarray(radii, float)
    Rt = None if R is None else np.asarray(R, float)

    def f(P):
        q = _p(P) - c
        if Rt is not None:
            q = q @ Rt          # world -> local: q_local = R^T q  (row vectors: q @ R)
        k0 = np.linalg.norm(q / r, axis=-1)
        k1 = np.linalg.norm(q / (r * r), axis=-1)
        return np.where(k1 > 1e-9, k0 * (k0 - 1.0) / np.maximum(k1, 1e-9), -r.min())
    return f


def capsule(a, b, r):
    return round_cone(a, b, r, r)


def round_cone(a, b, ra, rb):
    """Exact SDF of a cone with spherical caps (IQ)."""
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    ba = b - a
    l2 = float(ba @ ba)
    rr = ra - rb
    a2 = l2 - rr * rr
    il2 = 1.0 / l2

    def f(P):
        pa = _p(P) - a
        y = pa @ ba
        z = y - l2
        xv = pa * l2 - y[..., None] * ba
        x2 = (xv * xv).sum(-1)
        y2 = y * y * l2
        z2 = z * z * l2
        k = np.sign(rr) * rr * rr * x2
        d1 = np.sqrt(x2 + z2) * il2 - rb
        d2 = np.sqrt(x2 + y2) * il2 - ra
        d3 = (np.sqrt(x2 * a2 * il2) + y * rr) * il2 - ra
        out = np.where(np.sign(z) * a2 * z2 > k, d1, np.where(np.sign(y) * a2 * y2 < k, d2, d3))
        return out
    return f


def tube(points, radii, k=0.0):
    """Variable-radius tube through points: union of round cones (smooth if k > 0)."""
    pts = [np.asarray(p, float) for p in points]
    rs = list(np.broadcast_to(np.asarray(radii, float), (len(pts),)))
    parts = [round_cone(pts[i], pts[i + 1], rs[i], rs[i + 1]) for i in range(len(pts) - 1)]
    return union(*parts) if k <= 0 else smooth_union(k, *parts)


def box(c, half, R=None, rnd=0.0):
    c = np.asarray(c, float)
    h = np.asarray(half, float) - rnd

    def f(P):
        q = _p(P) - c
        if R is not None:
            q = q @ np.asarray(R, float)
        q = np.abs(q) - h
        return np.linalg.norm(np.maximum(q, 0), axis=-1) + np.minimum(q.max(-1), 0) - rnd
    return f


def torus(c, R_, r, Rm=None):
    """Torus around local z."""
    c = np.asarray(c, float)

    def f(P):
        q = _p(P) - c
        if Rm is not None:
            q = q @ np.asarray(Rm, float)
        xy = np.sqrt(q[..., 0] ** 2 + q[..., 1] ** 2) - R_
        return np.sqrt(xy * xy + q[..., 2] ** 2) - r
    return f


def plane(n, d):
    n = np.asarray(n, float)
    n = n / np.linalg.norm(n)
    return lambda P: _p(P) @ n - d


def polyline_dist(P, pts):
    """Distance from points to a polyline, plus the parameter (segment index + t)."""
    P = _p(P)
    best = np.full(P.shape[:-1], np.inf)
    par = np.zeros(P.shape[:-1])
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        ab = b - a
        t = np.clip(((P - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
        d = np.linalg.norm(P - (a + t[..., None] * ab), axis=-1)
        m = d < best
        best = np.where(m, d, best)
        par = np.where(m, i + t, par)
    return best, par


def ptube(points, radii, closed=False, bbox_margin=None):
    """Tube around a dense polyline with radius interpolated along it (exact-ish, no cap blending)."""
    pts = [np.asarray(p, float) for p in points]
    if closed:
        pts = pts + [pts[0]]
    rs = np.broadcast_to(np.asarray(radii, float), (len(points),)).astype(float)
    if closed:
        rs = np.append(rs, rs[0])
    lo = np.min(pts, 0) - rs.max() - 0.05
    hi = np.max(pts, 0) + rs.max() + 0.05

    def f(P):
        P = _p(P)
        out = np.full(P.shape[:-1], 1.0)
        m = np.all((P >= lo) & (P <= hi), axis=-1)
        if not np.any(m):
            return out + np.linalg.norm(P - (lo + hi) / 2, axis=-1)
        Q = P[m]
        d, par = polyline_dist(Q, pts)
        i = np.clip(np.floor(par).astype(int), 0, len(rs) - 2)
        t = par - i
        r = rs[i] * (1 - t) + rs[i + 1] * t
        out[m] = d - r
        far = ~m
        out[far] = np.linalg.norm(P[far] - (lo + hi) / 2, axis=-1) - np.linalg.norm(hi - lo) / 2 + 0.2
        out[far] = np.maximum(out[far], 0.05)
        return out
    return f


# --------------------------------------------------------------------------------------------- operators
def union(*fs):
    def f(P):
        d = fs[0](P)
        for g in fs[1:]:
            d = np.minimum(d, g(P))
        return d
    return f


def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def smooth_union(k, *fs):
    def f(P):
        d = fs[0](P)
        for g in fs[1:]:
            d = smin(d, g(P), k)
        return d
    return f


def smooth_sub(k, a, b):
    """a minus b."""
    return lambda P: smax(a(P), -b(P), k)


def smooth_inter(k, a, b):
    return lambda P: smax(a(P), b(P), k)


def offset(f, d):
    return lambda P: f(P) - d


def scaled(f, s, center):
    """Non-uniform scale about center (distance approximately corrected by min scale)."""
    s = np.asarray(s, float)
    c = np.asarray(center, float)
    m = s.min()
    return lambda P: f((_p(P) - c) / s + c) * m


def warped(f, fn):
    """Domain warp: evaluate f at fn(P) (fn must be close to an isometry for a usable distance)."""
    return lambda P: f(fn(_p(P)))


# --------------------------------------------------------------------------------------------- meshing
def grid(lo, hi, h):
    xs = np.arange(lo[0], hi[0] + h, h)
    ys = np.arange(lo[1], hi[1] + h, h)
    zs = np.arange(lo[2], hi[2] + h, h)
    return np.stack(np.meshgrid(xs, ys, zs, indexing='ij'), -1).astype(np.float64), (xs[0], ys[0], zs[0])


def surface_nets(F, lo, h):
    """Naive surface nets on a sampled grid F (nx, ny, nz). Returns verts (n,3), quads (m,4) outward."""
    nx, ny, nz = F.shape
    c = np.stack([F[i:nx - 1 + i, j:ny - 1 + j, k:nz - 1 + k] for i in (0, 1) for j in (0, 1) for k in (0, 1)], -1)
    inside = c < 0
    cnt = inside.sum(-1)
    active = (cnt > 0) & (cnt < 8)
    idx = np.argwhere(active)
    corners = np.array([(i, j, k) for i in (0, 1) for j in (0, 1) for k in (0, 1)])
    edges = [(a, b) for a in range(8) for b in range(a + 1, 8) if np.abs(corners[a] - corners[b]).sum() == 1]
    cv = c[active]
    acc = np.zeros((len(idx), 3))
    num = np.zeros(len(idx))
    for a, b in edges:
        fa, fb = cv[:, a], cv[:, b]
        m = (fa < 0) != (fb < 0)
        tt = np.where(m, fa / np.where(m, fa - fb, 1), 0)
        pt = corners[a][None, :] + tt[:, None] * (corners[b] - corners[a])[None, :]
        acc += np.where(m[:, None], pt, 0)
        num += m
    V = (idx + acc / num[:, None]) * h + np.asarray(lo)
    vid = -np.ones(active.shape, dtype=np.int64)
    vid[active] = np.arange(len(idx))
    out = []
    for ax in range(3):
        o1, o2 = [d for d in range(3) if d != ax]
        sa = [slice(1, -1)] * 3
        sb = [slice(1, -1)] * 3
        sa[ax] = slice(0, -1)
        sb[ax] = slice(1, None)
        A = F[tuple(sa)]
        B = F[tuple(sb)]
        m = (A < 0) != (B < 0)
        e = np.argwhere(m)
        g = e.copy()
        g[:, o1] += 1
        g[:, o2] += 1

        def cell(d1, d2):
            ci = g.copy()
            ci[:, o1] -= d1
            ci[:, o2] -= d2
            return vid[ci[:, 0], ci[:, 1], ci[:, 2]]
        q = np.stack([cell(1, 1), cell(0, 1), cell(0, 0), cell(1, 0)], -1)
        flip = A[m] > 0
        if ax == 1:
            flip = ~flip
        q[flip] = q[flip][:, ::-1]
        out.append(q)
    Q = np.concatenate(out)
    Q = Q[(Q >= 0).all(1)]
    return V, Q


def marching_tets(F, lo, h):
    """Marching tetrahedra (Kuhn subdivision, consistent across cells): watertight, consistently oriented
    triangles. F: sampled grid (nx, ny, nz). Returns verts (n,3), tris (m,3) with outward normals."""
    F = np.where(np.abs(F) < 1e-6 * h, np.where(F < 0, -1e-6 * h, 1e-6 * h), F)
    nx, ny, nz = F.shape
    inside = F < 0
    c = np.stack([inside[i:nx - 1 + i, j:ny - 1 + j, k:nz - 1 + k] for i in (0, 1) for j in (0, 1) for k in (0, 1)], -1)
    cnt = c.sum(-1)
    act = np.argwhere((cnt > 0) & (cnt < 8))
    if len(act) == 0:
        return np.zeros((0, 3)), np.zeros((0, 3), int)
    lin = lambda ijk: (ijk[..., 0] * ny + ijk[..., 1]) * nz + ijk[..., 2]
    offs = np.array([(i, j, k) for i in (0, 1) for j in (0, 1) for k in (0, 1)])
    corner_ids = lin(act[:, None, :] + offs[None, :, :])            # (m, 8) global point ids
    Ff = F.ravel()
    tets = np.array([[0, 1, 3, 7], [0, 1, 5, 7], [0, 2, 3, 7], [0, 2, 6, 7], [0, 4, 5, 7], [0, 4, 6, 7]])
    T = corner_ids[:, tets].reshape(-1, 4)                          # (m*6, 4)
    vals = Ff[T]
    ins = vals < 0
    nin = ins.sum(1)
    edges_a, edges_b = [], []
    tri_edges = []      # list of (k,3,2) arrays of edge endpoints per triangle
    # one inside or three inside: single triangle around the lone vertex
    for n_lone, lone_inside in ((1, True), (3, False)):
        sel = np.nonzero(nin == n_lone)[0]
        if len(sel) == 0:
            continue
        Ts, Is = T[sel], ins[sel]
        lone_mask = Is if lone_inside else ~Is
        li = np.argmax(lone_mask, 1)
        lone = Ts[np.arange(len(sel)), li]
        others = np.array([Ts[r][~lone_mask[r]] for r in range(len(sel))]) if len(sel) < 0 else None
        order = np.argsort(lone_mask, axis=1, kind='stable')         # False first -> the three others
        oth = np.take_along_axis(Ts, order[:, :3], 1)
        e = np.stack([np.stack([lone, oth[:, k]], -1) for k in range(3)], 1)   # (k,3,2)
        tri_edges.append(e)
    sel = np.nonzero(nin == 2)[0]
    if len(sel):
        Ts, Is = T[sel], ins[sel]
        order = np.argsort(~Is, axis=1, kind='stable')               # inside first
        a, b = Ts[np.arange(len(sel)), order[:, 0]], Ts[np.arange(len(sel)), order[:, 1]]
        cc, d = Ts[np.arange(len(sel)), order[:, 2]], Ts[np.arange(len(sel)), order[:, 3]]
        q1 = np.stack([np.stack([a, cc], -1), np.stack([a, d], -1), np.stack([b, d], -1)], 1)
        q2 = np.stack([np.stack([a, cc], -1), np.stack([b, d], -1), np.stack([b, cc], -1)], 1)
        tri_edges.append(q1)
        tri_edges.append(q2)
    E = np.concatenate(tri_edges)                                    # (t,3,2)
    lo_ = np.minimum(E[..., 0], E[..., 1])
    hi_ = np.maximum(E[..., 0], E[..., 1])
    key = lo_.astype(np.int64) * (nx * ny * nz) + hi_
    uk, inv = np.unique(key.ravel(), return_inverse=True)
    pa = uk // (nx * ny * nz)
    pb = uk % (nx * ny * nz)
    def coords(p):
        k = p % nz
        j = (p // nz) % ny
        i = p // (ny * nz)
        return np.stack([i, j, k], -1) * h + np.asarray(lo)
    va, vb = Ff[pa], Ff[pb]
    t = va / (va - vb)
    V = coords(pa) + (coords(pb) - coords(pa)) * t[:, None]
    tri = inv.reshape(-1, 3)
    # orient: normal must point from the inside corner(s) toward the outside
    P = V[tri]
    n = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
    ea = E[:, 0, 0]
    eb = E[:, 0, 1]
    ca, cb = coords(ea), coords(eb)
    ina = Ff[ea] < 0
    out_dir = np.where(ina[:, None], cb - ca, ca - cb)
    flip = (n * out_dir).sum(1) < 0
    tri[flip] = tri[flip][:, ::-1]
    # drop degenerate triangles
    ok = (tri[:, 0] != tri[:, 1]) & (tri[:, 1] != tri[:, 2]) & (tri[:, 0] != tri[:, 2])
    return V, tri[ok]


def sample_grid(f, lo, hi, h, chunk=1_000_000, coarse=4):
    # jitter the lattice off round numbers so flat features never sit exactly on samples (degenerate slivers)
    lo = np.asarray(lo, float) - h * np.array([0.371, 0.293, 0.437])
    xs = np.arange(lo[0], hi[0] + h, h)
    ys = np.arange(lo[1], hi[1] + h, h)
    zs = np.arange(lo[2], hi[2] + h, h)
    nx, ny, nz = len(xs), len(ys), len(zs)
    c = coarse
    cx, cy, cz = xs[::c], ys[::c], zs[::c]
    CG = np.stack(np.meshgrid(cx, cy, cz, indexing='ij'), -1).reshape(-1, 3)
    CF = np.empty(len(CG))
    for i in range(0, len(CG), chunk):
        CF[i:i + chunk] = f(CG[i:i + chunk])
    CF = CF.reshape(len(cx), len(cy), len(cz))
    band = c * h * 1.8
    near = np.abs(CF) < band
    flag = near.copy()
    for ax in range(3):
        for sh in (-1, 1):
            flag |= np.roll(near, sh, axis=ax)
    F = np.repeat(np.repeat(np.repeat(np.sign(CF) * (band + h), c, 0), c, 1), c, 2)[:nx, :ny, :nz]
    M = np.repeat(np.repeat(np.repeat(flag, c, 0), c, 1), c, 2)[:nx, :ny, :nz]
    idx = np.nonzero(M)
    P = np.stack([xs[idx[0]], ys[idx[1]], zs[idx[2]]], -1)
    vals = np.empty(len(P))
    for i in range(0, len(P), chunk):
        vals[i:i + chunk] = f(P[i:i + chunk])
    F[idx] = vals
    return F, (xs[0], ys[0], zs[0])


def mesh_sdf_tets(f, lo, hi, h, coarse=4):
    F, lo0 = sample_grid(f, lo, hi, h, coarse=coarse)
    return marching_tets(F, lo0, h)


def mesh_sdf(f, lo, hi, h, chunk=1_000_000, coarse=4):
    """Sample f on a grid (narrow band: exact values only near the surface, found on a coarse grid) and
    polygonise with surface nets."""
    xs = np.arange(lo[0], hi[0] + h, h)
    ys = np.arange(lo[1], hi[1] + h, h)
    zs = np.arange(lo[2], hi[2] + h, h)
    nx, ny, nz = len(xs), len(ys), len(zs)
    c = coarse
    cx, cy, cz = xs[::c], ys[::c], zs[::c]
    CG = np.stack(np.meshgrid(cx, cy, cz, indexing='ij'), -1).reshape(-1, 3)
    CF = np.empty(len(CG))
    for i in range(0, len(CG), chunk):
        CF[i:i + chunk] = f(CG[i:i + chunk])
    CF = CF.reshape(len(cx), len(cy), len(cz))
    # coarse cells near the surface (corner |d| within a cell diagonal) - dilated by one cell
    band = c * h * 1.8
    near = np.abs(CF) < band
    flag = near.copy()
    for ax in range(3):
        for sh in (-1, 1):
            flag |= np.roll(near, sh, axis=ax)
    F = np.repeat(np.repeat(np.repeat(np.sign(CF) * (band + h), c, 0), c, 1), c, 2)[:nx, :ny, :nz]
    M = np.repeat(np.repeat(np.repeat(flag, c, 0), c, 1), c, 2)[:nx, :ny, :nz]
    idx = np.nonzero(M)
    P = np.stack([xs[idx[0]], ys[idx[1]], zs[idx[2]]], -1)
    vals = np.empty(len(P))
    for i in range(0, len(P), chunk):
        vals[i:i + chunk] = f(P[i:i + chunk])
    F[idx] = vals
    return surface_nets(F, (xs[0], ys[0], zs[0]), h)


def gradient(f, P, eps=1e-3):
    P = _p(P)
    g = np.zeros_like(P)
    for i in range(3):
        e = np.zeros(3)
        e[i] = eps
        g[:, i] = (f(P + e) - f(P - e)) / (2 * eps)
    return g


def project(f, P, iters=3, eps=1e-3, max_step=None):
    """Newton-project points onto the zero set of f."""
    P = _p(P).copy()
    for _ in range(iters):
        d = f(P)
        g = gradient(f, P, eps)
        gg = np.maximum((g * g).sum(-1), 1e-9)
        step = (d / gg)[:, None] * g
        if max_step is not None:
            n = np.linalg.norm(step, axis=1, keepdims=True)
            step = step * np.minimum(1.0, max_step / np.maximum(n, 1e-12))
        P -= step
    return P


def normals(f, P, eps=1e-3):
    g = gradient(f, P, eps)
    return g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-12)

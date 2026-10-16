# rk_head.py - Rocco's head: sculpted SDF head + face pieces, materials, weights and the 10 face shape keys.
# Blender space (Z up, faces -Y, +X = his left). All sizes in feet.
import math
import numpy as np

import rk_geo as G
import rk_sdf as SD
import rk_mesh as MS
import rk_rig as RR
from rk_geo import Part, nrm, rot_axis

HC = np.array([0.0, 0.06, 4.10])          # cranium centre


def hp(x, y, z):
    return HC + np.array([x, y, z], float)


# ------------------------------------------------------------------------------------------- eye geometry
EYE_R, EYE_W, EYE_H = RR.EYE_R, RR.EYE_W, RR.EYE_H   # sphere radius, window half width / half height


def eye_frame(s=1):
    """(pivot, R) for an eye: R columns = (x, up, forward axis); the pivot is the eye bone."""
    return RR.eye_frame(s)


def sph(piv, R, rad, az, el):
    """Point on the eye sphere: az (horizontal, rad), el (vertical, rad) from the eye axis."""
    d = R @ np.array([math.sin(az) * math.cos(el), math.sin(el), math.cos(az) * math.cos(el)])
    return piv + d * rad


def window_angles():
    return math.asin(EYE_W / EYE_R), math.asin(EYE_H / EYE_R)


# ------------------------------------------------------------------------------------------- mouth geometry
MOUTH_Z0 = 3.700          # slit centre height at the middle
MOUTH_W = 0.30            # half width (corners)
MOUTH_CURVE = 0.62        # z rises by MOUTH_CURVE * x^2 toward the corners (a natural smirk line)
MOUTH_HALF = 0.03         # half gap of the carved slit (closed to LIP_GAP in the basis)
LIP_GAP = 0.02
JAW_HINGE = RR.jd('jaw')


def mouth_z(x):
    return MOUTH_Z0 + MOUTH_CURVE * x * x


def slit_sdf():
    """Thin slab under the snout, rounded at the corners; deep enough to make a cavity."""
    def f(P):
        P = np.asarray(P, float)
        x, y, z = P[..., 0], P[..., 1], P[..., 2]
        dz = np.abs(z - mouth_z(x)) - MOUTH_HALF
        # lateral extent narrows toward the back so the cavity is a rounded pocket
        w = MOUTH_W * np.clip(1.0 - np.maximum(y + 0.55, 0) / 0.3, 0.35, 1.0)
        dx = np.abs(x) - w
        dy = y + 0.30 - 0.0          # back wall at y = -0.30
        dyf = -(y + 1.3)             # open to the front
        q = np.stack([dz, dx, dy, dyf], -1)
        outside = np.linalg.norm(np.maximum(q[..., :3], 0), axis=-1)
        inside = np.minimum(np.max(q[..., :3], axis=-1), 0)
        return np.maximum(outside + inside, dyf) - 0.0
    return f


# ------------------------------------------------------------------------------------------- the head SDF
# cheek tufts: (root, tip, root radius, tip radius, flatness) for the left side
TUFTS = (((0.50, -0.12, -0.42), (0.98, 0.16, -0.66), 0.16, 0.012, 0.55),
         ((0.55, -0.04, -0.28), (0.98, 0.26, -0.36), 0.14, 0.010, 0.55),
         ((0.52, 0.06, -0.50), (0.80, 0.30, -0.70), 0.11, 0.010, 0.55))


def cranium_sdf():
    return SD.ellipsoid(hp(0, 0.02, 0.04), (0.62, 0.56, 0.62))


def head_sdf():
    cran = SD.ellipsoid(hp(0, 0.02, 0.04), (0.62, 0.56, 0.62))
    face = SD.ellipsoid(hp(0, -0.25, 0.07), (0.50, 0.36, 0.28))          # brings the eye area forward
    jowls = SD.union(SD.ellipsoid(hp(0.30, -0.15, -0.40), (0.41, 0.40, 0.37)),
                     SD.ellipsoid(hp(-0.30, -0.15, -0.40), (0.41, 0.40, 0.37)))
    snout = SD.scaled(SD.round_cone(hp(0, -0.40, -0.25), hp(0, -0.79, -0.21), 0.27, 0.175), (1.0, 1.0, 0.9), hp(0, -0.6, -0.23))
    chin = SD.ellipsoid(hp(0, -0.46, -0.555), (0.26, 0.31, 0.16))
    neck = SD.capsule(hp(0, 0.06, -0.48), hp(0, 0.04, -1.22), 0.235)
    nape = SD.ellipsoid(hp(0, 0.24, -0.42), (0.36, 0.34, 0.30))
    tufts = []
    for s in (1, -1):
        for a, b, ra, rb, th in TUFTS:
            A = hp(a[0] * s, a[1], a[2])
            B = hp(b[0] * s, b[1], b[2])
            cone = SD.round_cone(A, B, ra, rb)
            ax = nrm(B - A)
            n_ = nrm(np.cross(np.array([0, 0, 1.0]), ax))          # flatten across the tuft: a blade standing up
            def flat(P, cone=cone, A=A, n_=n_, th=th):
                P = np.asarray(P, float)
                dn = (P - A) @ n_
                return cone(P + dn[..., None] * n_ * (1.0 / th - 1.0)) * th
            tufts.append(flat)
    # eye socket rims: oval tubes around each eye window, on the eye sphere
    rims = []
    for s in (1, -1):
        piv, R = eye_frame(s)
        pts = []
        for i in range(40):
            t = 2 * math.pi * i / 40
            pts.append(sph(piv, R, EYE_R - 0.006, math.asin((EYE_W + 0.03) / EYE_R) * math.cos(t), math.asin((EYE_H + 0.03) / EYE_R) * math.sin(t)))
        rims.append(SD.ptube(pts, 0.042, closed=True))
    base = SD.smooth_union(0.16, cran, face)
    base = SD.smooth_union(0.17, base, jowls)
    base = SD.smooth_union(0.12, base, snout)
    base = SD.smooth_union(0.10, base, chin)
    base = SD.smooth_union(0.14, base, neck)
    base = SD.smooth_union(0.14, base, nape)
    tuf = SD.union(*tufts)
    base = SD.smooth_union(0.06, base, tuf)
    rim = SD.union(*rims)
    base = SD.smooth_union(0.03, base, rim)
    socks = []
    for s in (1, -1):
        piv, R = eye_frame(s)
        socks.append(SD.ellipsoid(sph(piv, R, EYE_R - 0.03, 0, 0), (EYE_W + 0.01, EYE_H + 0.01, 0.07), R=R))
    base = SD.smooth_sub(0.012, base, SD.union(*socks))
    head = SD.smooth_sub(0.024, base, slit_sdf())
    return head


# ------------------------------------------------------------------------------------------- material regions
def cyl(P):
    """(arc-length around the head axis from the front, z)."""
    P = np.asarray(P, float)
    th = np.arctan2(P[..., 0], -(P[..., 1] - HC[1]))
    return th * 0.62, P[..., 2]


def mask_region(P):
    """Negative inside the bandit mask (domino band across the eyes, tapering back to points)."""
    s, z = cyl(P)
    P = np.asarray(P, float)
    ez = RR.EYE_FRONT[2]
    d1 = np.sqrt(((s - 0.16) / 0.215) ** 2 + ((z - ez) / 0.245) ** 2) - 1.0
    d2 = np.sqrt(((s + 0.16) / 0.215) ** 2 + ((z - ez) / 0.245) ** 2) - 1.0
    lobes = np.minimum(d1, d2) * 0.22
    a = np.abs(s)
    zc = ez - 0.03 - 0.09 * np.clip((a - 0.25) / 0.45, 0, 1) ** 1.3
    half = 0.14 * np.clip(1.0 - (a - 0.25) / 0.50, 0, 1) ** 0.9 + 0.004
    band = np.abs(z - zc) - half
    band = np.maximum(band, a - 0.76)
    m = SD.smin(lobes, band, 0.05)
    br = np.sqrt((s / 0.085) ** 2 + ((z - (ez - 0.17)) / 0.08) ** 2) - 1.0
    m = SD.smin(m, br * 0.08, 0.04)
    m = np.maximum(m, (P[..., 1] - HC[1]) - 0.22)
    return m


def cream_region(P):
    """Negative inside the light-fur areas: the whole lower face (muzzle, lips, chin, lower jowls), throat and
    cheek tufts, bounded above by a smooth line under the mask."""
    P = np.asarray(P, float)
    s_, z = cyl(P)
    a = np.abs(s_)
    ez = RR.EYE_FRONT[2]
    # boundary height: just under the mask at the front, sweeping down toward the tufts at the sides
    top = (ez - 0.25) - 0.20 * np.clip((a - 0.12) / 0.55, 0, 1) ** 1.4
    d = z - top
    front = (P[..., 1] - HC[1]) - 0.05 - 0.25 * np.clip((a - 0.4) / 0.4, 0, 1)
    c = np.maximum(d, front)
    c = np.maximum(c, 3.40 - z)                                   # the neck below the jaw stays grey
    tuftz = []
    for sgn in (1, -1):
        for a_, b_, ra, rb, th in TUFTS:
            A = hp(a_[0] * sgn, a_[1], a_[2])
            B = hp(b_[0] * sgn, b_[1], b_[2])
            tuftz.append(SD.round_cone(A + (B - A) * 0.18, B, ra * 1.1, 0.06)(P))
    t = np.minimum.reduce(tuftz)
    snout_top = SD.ellipsoid(hp(0, -0.72, -0.18), (0.24, 0.30, 0.16))(P)
    return np.minimum(np.minimum(c, t), snout_top)


# ------------------------------------------------------------------------------------------- pieces
def sphere_shell_patch(piv, R, r_out, thick, az0, az1, el0, el1, nu=10, nv=6, mat='mask', round_edge='bottom'):
    """Closed shell on a sphere between azimuths/elevations (radians). Returns Part + the (u,v) params per vertex."""
    V, F, UV = [], [], []
    def grid(rad, flip):
        base = len(V)
        for j in range(nv + 1):
            for i in range(nu + 1):
                u, v = i / nu, j / nv
                az = az0 + (az1 - az0) * u
                el = el0 + (el1 - el0) * v
                V.append(sph(piv, R, rad, az, el))
                UV.append((u, v, 1.0 if rad > r_out - 1e-9 else 0.0))
        for j in range(nv):
            for i in range(nu):
                a = base + j * (nu + 1) + i
                f = [a, a + 1, a + nu + 2, a + nu + 1]
                F.append(f[::-1] if flip else f)
        return base
    b_out = grid(r_out, False)
    b_in = grid(r_out - thick, True)
    # stitch borders
    def idx(base, i, j):
        return base + j * (nu + 1) + i
    border = [(i, 0) for i in range(nu)] + [(nu, j) for j in range(nv)] + [(i, nv) for i in range(nu, 0, -1)] + [(0, j) for j in range(nv, 0, -1)]
    for k in range(len(border)):
        i0, j0 = border[k]
        i1, j1 = border[(k + 1) % len(border)]
        F.append([idx(b_out, i0, j0), idx(b_in, i0, j0), idx(b_in, i1, j1), idx(b_out, i1, j1)])
    p = Part(np.array(V), F, mat, 'shell')
    p.params = np.array(UV)
    # orientation check: outward = away from pivot for outer grid
    return p


def fix_orientation(p, inside_point):
    """Flip faces of a closed part if its signed volume is negative."""
    V = p.V
    vol = 0.0
    for f in p.F:
        a = V[f[0]]
        for k in range(1, len(f) - 1):
            vol += np.dot(a, np.cross(V[f[k]], V[f[k + 1]]))
    if vol < 0:
        p.F = [f[::-1] for f in p.F]
    return p


def eye_parts(s):
    """Eye white lens (head mesh), upper and lower lids with blink/squint shape keys, and the pupil (separate)."""
    sd = 'L' if s > 0 else 'R'
    piv, R = eye_frame(s)
    aw, ah = window_angles()
    # eye white: sphere cap inside an oval cylinder, closed at the back
    def white_sdf(P):
        P = np.asarray(P, float)
        q = (P - piv) @ R                     # local (x, up, axis)
        sphd = np.linalg.norm(q, axis=-1) - EYE_R
        ov = np.sqrt((q[..., 0] / (EYE_W + 0.03)) ** 2 + (q[..., 1] / (EYE_H + 0.03)) ** 2) - 1.0
        ov = ov * min(EYE_W, EYE_H)
        back = (EYE_R - 0.12) - q[..., 2]
        return SD.smax(SD.smax(sphd, ov, 0.01), back, 0.01)
    cen = piv + R[:, 2] * (EYE_R - 0.06)
    V, F = MS.sdf_mesh(white_sdf, cen - 0.3, cen + 0.3, 0.008, tris=110)
    white = Part(V, F, 'eye_white', 'eye_white_' + sd)
    white.rigid('head')
    # lids: dark shells just outside the eye sphere whose rows span the oval window at their height (so a closed
    # lid fills exactly the eye opening and tucks under the socket rim). Shape keys move the lid edge.
    out = [white]
    mw, me = math.radians(5), math.radians(6)

    def az_half(el):
        k = np.clip(1.0 - (el / (ah + me)) ** 2, 0.06, 1.0)
        return (aw + mw) * np.sqrt(k)

    def lid_positions(par, el_from, el_to, r_out, thick):
        Vn = []
        for (u, v, outer) in par:
            el = el_from + (el_to - el_from) * v
            az = (2 * u - 1) * az_half(el)
            Vn.append(sph(piv, R, r_out if outer > 0.5 else r_out - thick, az, el))
        return np.array(Vn)
    top = ah + me
    rest_edge = ah - math.radians(2.5)
    closed_edge = -ah - math.radians(3)
    up = sphere_shell_patch(piv, R, EYE_R + 0.026, 0.018, -aw, aw, top, rest_edge, nu=8, nv=4, mat='fur')
    par = up.params
    base_pos = lid_positions(par, top, rest_edge, EYE_R + 0.026, 0.018)
    up.V = base_pos
    up = fix_orientation(up, piv)
    up.sk['blink'] = lid_positions(par, top, closed_edge, EYE_R + 0.034, 0.018) - base_pos
    up.sk['squint'] = lid_positions(par, top, rest_edge - math.radians(17), EYE_R + 0.027, 0.018) - base_pos
    up.rigid('head')
    out.append(up)
    bot = -ah - me
    lrest = -ah + math.radians(2)
    lo_ = sphere_shell_patch(piv, R, EYE_R + 0.024, 0.016, -aw, aw, bot, lrest, nu=8, nv=2, mat='fur')
    parl = lo_.params
    lb = lid_positions(parl, bot, lrest, EYE_R + 0.024, 0.016)
    lo_.V = lb
    lo_ = fix_orientation(lo_, piv)
    lo_.sk['squint'] = lid_positions(parl, bot, lrest + math.radians(16), EYE_R + 0.026, 0.016) - lb
    lo_.sk['blink'] = lid_positions(parl, bot, lrest + math.radians(7), EYE_R + 0.025, 0.016) - lb
    lo_.rigid('head')
    out.append(lo_)
    # pupil: tall oval lens on the sphere + highlight
    pa, pe = math.radians(9.0), math.radians(13.5)
    paz, pel = -math.radians(1.5) * s * 0 - math.radians(1.0) * s, -math.radians(2.0)
    def pupil_sdf(P, rad=EYE_R + 0.007, aa=pa, ee=pe, caz=paz, cel=pel, th=0.02):
        P = np.asarray(P, float)
        q = (P - piv) @ R
        r = np.linalg.norm(q, axis=-1)
        az = np.arctan2(q[..., 0], q[..., 2])
        el = np.arcsin(np.clip(q[..., 1] / np.maximum(r, 1e-9), -1, 1))
        ov = (np.sqrt(((az - caz) / aa) ** 2 + ((el - cel) / ee) ** 2) - 1.0) * min(aa, ee) * EYE_R
        shell = np.abs(r - (rad - th / 2)) - th / 2
        return SD.smax(ov, shell, 0.004)
    c = sph(piv, R, EYE_R, paz, pel)
    V, F = MS.sdf_mesh(pupil_sdf, c - 0.16, c + 0.16, 0.0055, tris=90)
    pupil = Part(V, F, 'pupil', 'pupil_' + sd)
    pupil.rigid('eye.' + sd)
    hl_az, hl_el = paz + math.radians(3.6) * s * 0 + math.radians(3.4), pel + math.radians(5.5)
    hsdf = lambda P: pupil_sdf(P, EYE_R + 0.016, math.radians(2.5), math.radians(3.2), hl_az, hl_el, 0.014)
    c2 = sph(piv, R, EYE_R, hl_az, hl_el)
    V, F = MS.sdf_mesh(hsdf, c2 - 0.08, c2 + 0.08, 0.004, tris=40)
    hl = Part(V, F, 'eye_white', 'hl_' + sd)
    hl.rigid('eye.' + sd)
    return out, [pupil, hl]


def nose_part():
    f = SD.smooth_union(0.03, SD.ellipsoid(hp(0, -0.985, -0.185), (0.13, 0.095, 0.09)),
                        SD.ellipsoid(hp(0, -0.94, -0.15), (0.095, 0.07, 0.06)))
    c = hp(0, -0.97, -0.18)
    V, F = MS.sdf_mesh(f, c - 0.2, c + 0.2, 0.008, tris=90)
    p = Part(V, F, 'nose', 'nose')
    p.rigid('head')
    return p


def brow_part(s, head_f):
    sd = 'L' if s > 0 else 'R'
    # crescent hugging the forehead above the mask: thick inner end, pointed outer end
    pts, rad = [], []
    n = 9
    for i in range(n):
        u = i / (n - 1)
        x = (0.06 + 0.31 * u) * s
        z = 4.44 + 0.07 * math.sin(u * math.pi * 0.85) - 0.012 * u
        pts.append([x, -0.2, z])
        rad.append(0.052 * (1 - u) ** 0.65 + 0.009)
    pts = np.array(pts)
    # place on the surface (march forward to the head surface), then lift slightly
    for k in range(len(pts)):
        p = pts[k].copy()
        p[1] = -1.2
        for _ in range(60):
            d = head_f(p[None])[0]
            if d < 0.002:
                break
            p[1] += max(d, 0.003)
        pts[k] = p
    nrmv = SD.normals(head_f, pts)
    path = pts + nrmv * 0.012
    f = SD.ptube(list(path), rad)
    flat = lambda P: f(P)
    lo, hi = path.min(0) - 0.1, path.max(0) + 0.1
    V, F = MS.sdf_mesh(flat, lo, hi, 0.006, tris=90)
    # flatten against the head: squash along the local normal
    p = Part(V, F, 'fur_light', 'brow_' + sd)
    p.rigid('brow.' + sd)
    p.anchor = path
    return p


def ear_part(s):
    sd = 'L' if s > 0 else 'R'
    base = RR.jd('ear.' + sd)
    # ear frame: up (tilted outward), facing forward-outward
    upv = nrm(np.array([0.42 * s, 0.05, 1.0]))
    fwd = nrm(np.array([0.30 * s, -1.0, 0.0]))
    fwd = nrm(fwd - np.dot(fwd, upv) * upv)
    side = np.cross(upv, fwd)
    R = np.stack([side, upv, fwd], 1)        # local (x across, y up, z front)
    H, Wd, T = 0.42, 0.18, 0.045

    def tri2d(x, y):
        # rounded triangle: base at y=0 width Wd, apex at y=H
        k = (H - np.clip(y, 0, H)) / H
        half = Wd * (k ** 0.62) * (1.0 + 0.25 * np.sin(np.clip(k, 0, 1) * math.pi))
        dx = np.abs(x) - half
        dy = np.maximum(-y, y - H * 0.93)
        return np.maximum(dx * 0.9, dy) - 0.025 * (1 - k) ** 2

    def ear_sdf(P):
        q = (np.asarray(P, float) - base) @ R
        x, y, z = q[..., 0], q[..., 1], q[..., 2]
        cup = 0.10 * (x / Wd) ** 2           # cupped: edges forward
        zz = z - cup
        d2 = tri2d(x, y) - 0.035
        dz = np.abs(zz) - T
        out = np.maximum(d2, dz)
        # bowl in the front face
        inner = np.maximum(tri2d(x * 1.25, (y - 0.06) * 1.18) - 0.012, -(zz - T * 0.25))
        return SD.smax(out, -inner, 0.015)
    lo = base - 0.6
    hi = base + 0.6
    V, F = MS.sdf_mesh(ear_sdf, lo, hi, 0.0075, tris=200)
    p = Part(V, F, 'fur', 'ear_' + sd)
    q = (p.V - base) @ R
    # materials: cream inner bowl, dark rim
    def inner_region(P):
        qq = (np.asarray(P, float) - base) @ R
        x, y, z = qq[..., 0], qq[..., 1], qq[..., 2]
        cup = 0.10 * (x / Wd) ** 2
        return np.maximum(tri2d(x * 1.25, (y - 0.06) * 1.18) + 0.004, -(z - cup))
    def rim_region(P):
        qq = (np.asarray(P, float) - base) @ R
        x, y = qq[..., 0], qq[..., 1]
        return -(tri2d(x, y) + 0.018)        # negative where close to the outline
    p.V, p.F = MS.cut_by_field(p.V, p.F, inner_region, surf=ear_sdf)
    p.V, p.F = MS.cut_by_field(p.V, p.F, rim_region, surf=ear_sdf)
    p.mat = MS.faces_by_region(p.V, p.F, [('fur_light', inner_region), ('mask', rim_region)], 'fur')
    q = (p.V - base) @ R
    w = np.clip((q[:, 1] + 0.02) / 0.12, 0, 1)
    p.set_weights({'ear.' + sd: w, 'head': 1 - w})
    return p


def teeth_tongue():
    parts = []
    # teeth: two white rows following the mouth curve, recessed; grin / mouth_open bring them forward
    def teeth_sdf(P, zoff, h):
        P = np.asarray(P, float)
        x, y, z = P[..., 0], P[..., 1], P[..., 2]
        yc = -0.84 + 0.30 * (x / (MOUTH_W - 0.04)) ** 2 + 0.10
        zc = mouth_z(x) + zoff
        d = np.stack([np.abs(y - yc) - 0.022, np.abs(z - zc) - h, np.abs(x) - (MOUTH_W - 0.05)], -1)
        return np.linalg.norm(np.maximum(d, 0), axis=-1) + np.minimum(d.max(-1), 0) - 0.008
    c = np.array([0, -0.74, MOUTH_Z0])
    for name, zoff, h, bone in (('teeth_up', 0.040, 0.024, 'head'), ('teeth_lo', -0.040, 0.022, 'jaw')):
        V, F = MS.sdf_mesh(lambda P, zo=zoff, hh=h: teeth_sdf(P, zo, hh), c - [0.4, 0.35, 0.15], c + [0.4, 0.35, 0.15], 0.0085, tris=80)
        p = Part(V, F, 'eye_white', name)
        p.rigid(bone)
        p.jaw = 1.0 if bone == 'jaw' else 0.0
        parts.append(p)
    tg = SD.ellipsoid(np.array([0, -0.50, MOUTH_Z0 - 0.04]), (0.14, 0.16, 0.035))
    c = np.array([0, -0.50, MOUTH_Z0 - 0.04])
    V, F = MS.sdf_mesh(tg, c - 0.3, c + 0.3, 0.01, tris=60)
    p = Part(V, F, 'tongue', 'tongue')
    p.rigid('jaw')
    p.jaw = 1.0
    parts.append(p)
    return parts


# ------------------------------------------------------------------------------------------- shape key fields
def jaw_weight(P):
    """1 for the lower jaw (below the mouth slit, front of the head), 0 above / behind."""
    P = np.asarray(P, float)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    below = G.smoothstep(0.004, -0.010, z - mouth_z(np.clip(x, -MOUTH_W, MOUTH_W)))
    front = G.smoothstep(-0.10, -0.42, y)                     # fades out behind the mouth
    side = G.smoothstep(MOUTH_W + 0.16, MOUTH_W - 0.02, np.abs(x))
    low = G.smoothstep(3.30, 3.42, z)                         # not the neck
    return below * front * side * low


def rot_about(P, axis_pt, axis, ang):
    """Rotate points about an axis by per-point angles."""
    axis = nrm(axis)
    out = np.empty_like(P)
    for i in range(len(P)):
        Rm = rot_axis(axis, ang[i])
        out[i] = axis_pt + Rm @ (P[i] - axis_pt)
    return out


def mouth_keys(V, head_f, is_skin=True):
    """Shape-key deltas for the mouth area of the head skin (and teeth/tongue when not skin)."""
    x, y, z = V[:, 0], V[:, 1], V[:, 2]
    wj = jaw_weight(V)
    ks = {}
    zc = mouth_z(np.clip(x, -MOUTH_W, MOUTH_W))
    near = G.smoothstep(0.16, 0.0, np.abs(z - zc)) * G.smoothstep(-0.25, -0.5, y)
    corner = G.smoothstep(MOUTH_W - 0.17, MOUTH_W + 0.02, np.abs(x)) * G.smoothstep(MOUTH_W + 0.2, MOUTH_W + 0.02, np.abs(x))
    above = G.smoothstep(-0.004, 0.012, z - zc)
    belowm = 1 - above
    lipband_up = above * G.smoothstep(0.10, 0.0, z - zc) * G.smoothstep(-0.3, -0.55, y)
    lipband_lo = belowm * G.smoothstep(0.10, 0.0, zc - z) * G.smoothstep(-0.3, -0.55, y)
    sgn = np.sign(x)
    # mouth_open: the jaw drops (rotation about the hinge), corners pull in to an O, upper lip lifts a little
    ang = np.radians(24) * wj
    Pj = rot_about(V, JAW_HINGE, (1, 0, 0), ang)
    d = Pj - V
    d[:, 0] += -sgn * 0.05 * corner * near
    d[:, 2] += 0.02 * lipband_up * G.smoothstep(MOUTH_W, 0.0, np.abs(x))
    ks['mouth_open'] = d
    # grin: lips peel back wide showing teeth, corners up and out
    d = np.zeros_like(V)
    d[:, 2] += 0.05 * lipband_up * G.smoothstep(MOUTH_W + 0.05, 0.05, np.abs(x)) - 0.042 * lipband_lo * G.smoothstep(MOUTH_W + 0.05, 0.05, np.abs(x))
    d[:, 1] += 0.012 * (lipband_up + lipband_lo)
    d[:, 2] += 0.07 * corner * near
    d[:, 0] += sgn * 0.035 * corner * near
    d[:, 1] += 0.03 * corner * near
    ks['grin'] = d
    # smile: corners up and back, cheeks lift
    d = np.zeros_like(V)
    d[:, 2] += 0.10 * corner * near + 0.05 * (x / MOUTH_W) ** 2 * near * G.smoothstep(MOUTH_W + 0.1, 0.0, np.abs(x))
    d[:, 1] += 0.04 * corner * near
    d[:, 0] += sgn * 0.025 * corner * near
    ch = np.exp(-(((np.abs(x) - 0.36) / 0.16) ** 2 + ((z - 3.82) / 0.12) ** 2 + ((y + 0.42) / 0.2) ** 2))
    d[:, 2] += 0.025 * ch
    ks['smile'] = d
    # frown: corners down, the lower lip pouts up a touch
    d = np.zeros_like(V)
    d[:, 2] += -0.11 * corner * near - 0.05 * (x / MOUTH_W) ** 2 * near * G.smoothstep(MOUTH_W + 0.1, 0.0, np.abs(x))
    d[:, 2] += 0.02 * lipband_lo * G.smoothstep(MOUTH_W, 0.0, np.abs(x))
    d[:, 0] += -sgn * 0.02 * corner * near
    ks['frown'] = d
    # cheeks_puff: sides of the muzzle inflate along the normal
    N = SD.normals(head_f, V)
    pw = np.exp(-(((np.abs(x) - 0.38) / 0.2) ** 2 + ((z - 3.72) / 0.15) ** 2 + ((y + 0.48) / 0.22) ** 2))
    d = N * (0.12 * pw)[:, None]
    d[:, 0] += -sgn * 0.025 * corner * near
    ks['cheeks_puff'] = d
    return ks


def eye_area_keys(V):
    """Skin around the eyes: squint lifts the cheeks a little."""
    ks = {}
    d = np.zeros_like(V)
    for s in (1, -1):
        piv, R = eye_frame(s)
        c = sph(piv, R, EYE_R, 0, -math.asin(EYE_H / EYE_R))
        w = np.exp(-((np.linalg.norm(V - c, axis=1) / 0.13) ** 2))
        d[:, 2] += 0.03 * w
    ks['squint'] = d
    return ks


def brow_keys(p, s, head_f):
    """Brow shape keys: rigid-ish moves conformed back onto the forehead."""
    V = p.V
    sd = s
    cx = np.array([0.20 * s, 0, 4.45])
    u = np.clip((np.abs(V[:, 0]) - 0.07) / 0.30, 0, 1)            # 0 inner -> 1 outer
    d0 = head_f(V)
    def conform(Vn):
        dn = head_f(Vn)
        N = SD.normals(head_f, Vn)
        return Vn - N * (dn - d0)[:, None]
    ks = {}
    up = V.copy()
    up[:, 2] += 0.075 + 0.02 * np.sin(u * math.pi)
    ks['brows_up'] = conform(up) - V
    an = V.copy()
    an[:, 2] += -0.07 * (1 - u) + 0.035 * u
    an[:, 0] += -s * 0.025 * (1 - u)
    ks['brows_angry'] = conform(an) - V
    sa = V.copy()
    sa[:, 2] += 0.07 * (1 - u) - 0.04 * u
    ks['brows_sad'] = conform(sa) - V
    return ks


# ------------------------------------------------------------------------------------------- build
def build(quality=1.0):
    head_f = head_sdf()
    lo = np.array([-1.08, -1.2, 2.6])
    hi = np.array([1.08, 0.75, 4.85])
    V, F = MS.sdf_mesh(head_f, lo, hi, 0.0105, tris=int(2680 * quality), sym=False)
    # crisp colour boundaries
    slit = slit_sdf()
    def mouth_region(P):
        return slit(P) - 0.012
    V, F = MS.cut_by_field(V, F, mask_region, surf=head_f)
    V, F = MS.cut_by_field(V, F, cream_region, surf=head_f)
    mats = MS.faces_by_region(V, F, [('mouth', mouth_region), ('mask', mask_region), ('fur_light', cream_region)], 'fur')
    skin = Part(V, F, mats, 'head_skin')
    # close the slit to a thin line in the basis: pull the slit walls toward the centre line
    x, y, z = V[:, 0], V[:, 1], V[:, 2]
    zc = mouth_z(np.clip(x, -MOUTH_W, MOUTH_W))
    lip_front = -0.86 + 0.30 * (np.clip(np.abs(x), 0, MOUTH_W) / MOUTH_W) ** 2 * 0.9
    inslit = G.smoothstep(MOUTH_HALF + 0.03, MOUTH_HALF - 0.004, np.abs(z - zc)) * G.smoothstep(MOUTH_W + 0.08, MOUTH_W - 0.06, np.abs(x)) * G.smoothstep(lip_front + 0.13, lip_front + 0.06, y)
    close = (MOUTH_HALF - LIP_GAP) * inslit
    skin.V[:, 2] -= np.sign(z - zc) * np.minimum(close, np.maximum(np.abs(z - zc) - LIP_GAP * 0.5, 0))
    # weights
    zz = skin.V[:, 2]
    wn = G.smoothstep(3.42, 3.12, zz)              # neck
    wj = jaw_weight(skin.V) * (1 - wn)
    skin.set_weights({'neck': wn, 'jaw': wj, 'head': np.clip(1 - wn - wj, 0, 1)})
    # shape keys on the skin
    ks = mouth_keys(skin.V, head_f)
    for k, d in eye_area_keys(skin.V).items():
        ks[k] = ks.get(k, 0) + d
    skin.sk = ks
    parts = [skin]
    pupils = []
    for s in (1, -1):
        e, pp = eye_parts(s)
        parts += e
        pupils += pp
        b = brow_part(s, head_f)
        b.sk = brow_keys(b, s, head_f)
        parts.append(b)
        parts.append(ear_part(s))
    parts.append(nose_part())
    for p in teeth_tongue():
        if p.jaw > 0:
            Pj = rot_about(p.V, JAW_HINGE, (1, 0, 0), np.full(p.n, np.radians(24)))
            p.sk['mouth_open'] = Pj - p.V + np.array([0, -0.03, 0])
            p.sk['grin'] = np.tile([0, -0.04, -0.006], (p.n, 1))
        else:
            p.sk['mouth_open'] = np.tile([0, -0.035, 0.004], (p.n, 1))
            p.sk['grin'] = np.tile([0, -0.045, 0.006], (p.n, 1))
        parts.append(p)
    return parts, pupils, head_f

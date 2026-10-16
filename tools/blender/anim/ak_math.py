# ak_math.py - small rotation toolkit for the shared animation libraries (pure numpy: no Blender needed).
# Conventions follow rk_anim (Rocco's clip framework): euler(rx, ry, rz) in degrees = Rz @ Ry @ Rx, 4x4 matrices with
# column vectors, quaternions stored (w, x, y, z) inside this package and written (x, y, z, w) to glTF.
import math
import numpy as np

D2R = math.pi / 180.0
S2 = math.sqrt(0.5)


def nrm(v):
    v = np.asarray(v, float)
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-12)


def rot_axis(axis, a):
    x, y, z = nrm(axis)
    c, s, C = math.cos(a), math.sin(a), 1 - math.cos(a)
    return np.array([[c + x * x * C, x * y * C - z * s, x * z * C + y * s],
                     [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
                     [z * x * C - y * s, z * y * C + x * s, c + z * z * C]])


def euler(rx=0.0, ry=0.0, rz=0.0):
    """XYZ euler in degrees (X first, then Y, then Z, in the parent frame): R = Rz @ Ry @ Rx."""
    return rot_axis((0, 0, 1), rz * D2R) @ rot_axis((0, 1, 0), ry * D2R) @ rot_axis((1, 0, 0), rx * D2R)


def M4(R=None, t=None, s=None):
    M = np.eye(4)
    if R is not None:
        M[:3, :3] = R
    if s is not None:
        M[:3, :3] = M[:3, :3] @ np.diag(s)
    if t is not None:
        M[:3, 3] = t
    return M


def frame3(a, b):
    """Right-handed frame from two (not necessarily orthogonal) directions: columns [a, b_perp, a x b_perp]."""
    a = nrm(a)
    b = np.asarray(b, float) - np.dot(b, a) * a
    if np.linalg.norm(b) < 1e-8:
        b = np.cross(a, [0, 0, 1]) if abs(a[2]) < 0.9 else np.cross(a, [1, 0, 0])
    b = nrm(b)
    return np.stack([a, b, np.cross(a, b)], 1)


def rot_between(a, b):
    a, b = nrm(a), nrm(b)
    ax = np.cross(a, b)
    sn = np.linalg.norm(ax)
    if sn < 1e-9:
        if np.dot(a, b) > 0:
            return np.eye(3)
        p = np.cross(a, [1, 0, 0]) if abs(a[0]) < 0.9 else np.cross(a, [0, 1, 0])
        return rot_axis(p, math.pi)
    return rot_axis(ax / sn, math.atan2(sn, float(np.dot(a, b))))


def orthonormal(R):
    U, _, Vt = np.linalg.svd(R)
    Q = U @ Vt
    if np.linalg.det(Q) < 0:
        U[:, -1] *= -1
        Q = U @ Vt
    return Q


# ------------------------------------------------------------------------------------------- quaternions (w, x, y, z)
def quat_from_mat(R):
    R = np.asarray(R, float)
    tr = R[0, 0] + R[1, 1] + R[2, 2]
    if tr > 0:
        s = math.sqrt(tr + 1.0) * 2
        q = [0.25 * s, (R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s]
    elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        s = math.sqrt(1.0 + R[0, 0] - R[1, 1] - R[2, 2]) * 2
        q = [(R[2, 1] - R[1, 2]) / s, 0.25 * s, (R[0, 1] + R[1, 0]) / s, (R[0, 2] + R[2, 0]) / s]
    elif R[1, 1] > R[2, 2]:
        s = math.sqrt(1.0 + R[1, 1] - R[0, 0] - R[2, 2]) * 2
        q = [(R[0, 2] - R[2, 0]) / s, (R[0, 1] + R[1, 0]) / s, 0.25 * s, (R[1, 2] + R[2, 1]) / s]
    else:
        s = math.sqrt(1.0 + R[2, 2] - R[0, 0] - R[1, 1]) * 2
        q = [(R[1, 0] - R[0, 1]) / s, (R[0, 2] + R[2, 0]) / s, (R[1, 2] + R[2, 1]) / s, 0.25 * s]
    q = np.array(q)
    return q / np.linalg.norm(q)


def mat_from_quat(q):
    w, x, y, z = nrm(q)
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def quat_slerp(qa, qb, t):
    qa, qb = nrm(qa), nrm(qb)
    d = float(np.dot(qa, qb))
    if d < 0:
        qb, d = -qb, -d
    if d > 0.9995:
        return nrm(qa + (qb - qa) * t)
    th = math.acos(min(1.0, d))
    return (math.sin((1 - t) * th) * qa + math.sin(t * th) * qb) / math.sin(th)


def slerp_mat(Ra, Rb, t):
    if t <= 0:
        return Ra
    if t >= 1:
        return Rb
    return mat_from_quat(quat_slerp(quat_from_mat(Ra), quat_from_mat(Rb), t))


def rot_vec(Ra, Rb):
    """Small rotation vector taking Ra to Rb, expressed in Ra's frame (radians)."""
    q = quat_from_mat(Ra.T @ Rb)
    if q[0] < 0:
        q = -q
    s = np.linalg.norm(q[1:])
    if s < 1e-12:
        return np.zeros(3)
    ang = 2 * math.atan2(s, q[0])
    return q[1:] / s * ang


def angle_between_rots(Ra, Rb):
    q = quat_from_mat(Ra.T @ Rb)
    return 2 * math.acos(min(1.0, abs(q[0])))


def decompose(M):
    """4x4 -> translation, rotation (orthonormal), scale (per column)."""
    t = M[:3, 3].copy()
    A = M[:3, :3]
    s = np.linalg.norm(A, axis=0)
    R = A / np.maximum(s, 1e-12)
    if np.linalg.det(R) < 0:
        s[0] = -s[0]
        R[:, 0] = -R[:, 0]
    return t, orthonormal(R), s


def smooth(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def smoothstep(e0, e1, x):
    return smooth((x - e0) / (e1 - e0))


def lerp(a, b, t):
    return a + (b - a) * t

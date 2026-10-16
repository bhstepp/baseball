# ak_lib.py - helpers shared by the clip libraries: targets relative to the posed joints (always in reach), feet
# placed by the ankle, simple stepping.
import numpy as np

import ak_pose as PZ
import ak_rig as AR
from ak_pose import foot, J
from ak_math import euler

_solver = {}


def solver():
    sk = PZ.SK
    if id(sk) not in _solver:
        _solver.clear()
        _solver[id(sk)] = AR.Solver(sk)
    return _solver[id(sk)]


def solved(c):
    return solver().solve(c)


def where(c, bone, W=None):
    """Solved world position (authoring units) of a bone for pose c."""
    W = W or solved(c)
    return W[bone][:3, 3] / PZ.SK.U


def crot(c, W=None):
    """Rotation of the chest relative to its rest (model space) for pose c."""
    W = W or solved(c)
    return W['chest'][:3, :3] @ PZ.SK.R('chest').T


def at_sh(c, side, off, W=None):
    """Point offset from the posed shoulder (upper_arm joint) by `off` in the chest's frame (x his left, y back,
    z up)."""
    W = W or solved(c)
    return W['upper_arm.' + side][:3, 3] / PZ.SK.U + crot(c, W) @ np.asarray(off, float)


def at_shw(c, side, off, W=None):
    """Point offset from the posed shoulder by `off` in world (model) axes."""
    W = W or solved(c)
    return W['upper_arm.' + side][:3, 3] / PZ.SK.U + np.asarray(off, float)


def at_hip(c, side, off, W=None):
    """Point offset from the posed hip joint (thigh head) by `off` in the pelvis frame."""
    W = W or solved(c)
    Rh = W['hips'][:3, :3] @ PZ.SK.R('hips').T
    return W['thigh.' + side][:3, 3] / PZ.SK.U + Rh @ np.asarray(off, float)


def foot_at_ankle(c, side, ankle, rz=0.0, rx=0.0, ry=0.0, toe=0.0, knee=None):
    Rf = euler(0, 0, rz) @ euler(rx, ry, 0)
    ball = np.asarray(ankle, float) - Rf @ (J('foot.' + side) - J('toe.' + side))
    return foot(c, side, ball, rz, rx, ry, toe, knee)


def socket_world(c, name, W=None):
    W = W or solved(c)
    return W[name][:3, 3] / PZ.SK.U


def lerp_keys(a, b, t):
    return PZ.lerp_pose(a, b, t)


def to_rest_frame(c, p_world, W=None):
    """Inverse of the chest carry: the rest-body-frame point that, carried by pose c's chest, lands on p_world
    (so a hand target given with rel=1 rides with the body from there)."""
    W = W or solved(c)
    Rc = crot(c, W)
    return PZ.J('chest') + Rc.T @ (np.asarray(p_world, float) - W['chest'][:3, 3] / PZ.SK.U)

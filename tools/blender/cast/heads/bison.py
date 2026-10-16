# bison.py - an American bison: a huge broad head with a wide pale muzzle (nostrils), small deep-set eyes under
# bushy grizzled brows, short thick horns curving out and up from the sides (pale, dark tips), small ears tucked
# under them, a shaggy dark mop framing the face - the cap sits on top of it, a forelock spills over the brow - a
# long shaggy beard with grey streaks, and the hump: a mound of shaggy fur rising out of the collar over the
# shoulders and upper back (hung on the body frame from the head module, weighted to the chest).
# optional shaggy fur tufts at the wrists (the kit's cgear.shag cuffs; off by default: budget). Head options: horn (size), mop (size), beard (length),
# hump (size), grizzle (grey streak amount), lid, shag.
import math
import numpy as np
from heads import fam_mammal as M
from heads import _park6 as P6
import hkit as K
import rk_sdf as SD
import rk_geo as G
import rk_mesh as MS
from rk_geo import Part

FAMILY = 'mammal'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'mammal',
    'tail': 'tufted',
    'build': 'stout',
    'build_over': {'neck': 0.62},
    'colors': {'horn': '#DCCFB4', 'hoof': '#2A221E', 'nose': '#2A1E1A', 'accessory_a': '#A39A92'},
    'body_over': {'tail_tip_mat': 'fur_dark', 'tail_len': 0.75},
}
CAP_C = np.array([0.0, 0.10, 4.17])
CAP_R = np.array([0.74, 0.64, 0.62])


def params(ctx):
    o = ctx.opts
    P = dict(
        cran=dict(c=(0.0, 0.10, 4.10), r=(0.70, 0.60, 0.56)),
        face=dict(c=(0.0, -0.18, 4.10), r=(0.58, 0.38, 0.32), k=0.16),
        jowl=dict(c=(0.32, -0.16, 3.70), r=(0.43, 0.40, 0.36), k=0.17),
        snout=dict(a=(0.0, -0.28, 3.86), b=(0.0, -0.66, 3.76), ra=0.34, rb=0.29, sx=1.25, sz=0.9, k=0.12),
        muzzle=dict(c=(0.0, -0.77, 3.72), r=(0.37, 0.22, 0.24), k=0.09),
        chin=dict(c=(0.0, -0.52, 3.50), r=(0.28, 0.30, 0.15), k=0.10),
        neck=dict(a=(0.0, 0.12, 3.62), b=(0.0, 0.10, 3.00), r=0.27, k=0.14),
        extra=[(0.08, SD.capsule((-0.30, -0.44, 4.36), (0.30, -0.44, 4.36), 0.10))],          # heavy brow ridge
        eye=dict(x=0.25, z=4.16, axis=(0.18, -1.0, 0.03), W=0.108, H=0.150, lid_drop=o.get('lid', 9.0), pupil=(10.0, 14.0)),
        mouth=dict(z0=3.58, W=0.35, curve=0.42, depth=0.62, jaw_back=0.72, key_scale=dict(frown=0.6)),
        nose=dict(kind='nostrils'),
        ear=dict(kind='cow', base=(0.60, 0.12, 4.12), up=(1.0, 0.15, -0.35), fwd=(0.1, -1.0, 0.3), H=0.26, W=0.11,
                 T=0.035, cup=0.06, shape='leaf', mat='fur_dark', inner='fur_light', slot=False, tris=110),
        brow=dict(z=4.36, x0=0.06, x1=0.40, arch=0.025, thick=0.085, mat='accessory_a', tilt=0.035),
        cap=dict(cranium=SD.ellipsoid(CAP_C, CAP_R), cran_c=tuple(CAP_C), cran_r=tuple(CAP_R)),
        regions=[],
        skin_tris=2350,
    )
    M.nostril_pad(P, pad_mat='fur_light', sep=0.27, r=(0.05, 0.065, 0.036), pad=(0.38, 0.24, 0.26))
    return P


def lumps(rng, centers, r, jitter=0.25):
    return [SD.sphere(np.asarray(c, float), r * (1 + rng.uniform(-jitter, jitter))) for c in centers]


def mop(ctx, head, geo, size=1.0):
    """The shaggy bonnet: lumps on a ring under the cap band (forelock in front, over the ears, round the back) and
    down the cheeks as side whiskers; the dome above the band stays inside the cap's cranium."""
    rng = np.random.default_rng(int(ctx.spec.get('seed', 3)) & 0xFFFF)
    terms = []
    for i in range(18):                              # ring under the band
        a = 2 * math.pi * i / 18
        d = np.array([math.sin(a), -math.cos(a), 0.0])
        front = max(-d[1], 0.0)
        z = 4.50 + 0.10 * front - 0.06 * max(d[1], 0)
        q = K.march_to(geo.f, CAP_C * [1, 1, 0] + [0, 0, z] + d * 1.5, -d)
        terms.append(SD.sphere(q + d * 0.05, (0.15 + 0.05 * front) * size * (1 + rng.uniform(-0.15, 0.15))))
    for s in (1, -1):                                # side whiskers down the jowls, behind the eyes
        for k in range(4):
            q = np.array([s * (0.62 - 0.03 * k), 0.02 - 0.03 * k, 4.30 - 0.17 * k])
            q = K.march_to(geo.f, q + [s * 0.8, 0, 0], (-s, 0, 0))
            terms.append(SD.sphere(q + [s * 0.04, 0.0, 0.0], 0.14 * size * (1 - 0.12 * k) * (1 + rng.uniform(-0.12, 0.12))))
    # the forelock: a fringe of locks hanging over the brow ridge
    for k in range(5):
        x = (k - 2) * 0.13
        q = K.march_to(geo.f, np.array([x, -1.4, 4.52 - 0.02 * abs(k - 2)]), (0, 1, 0))
        terms.append(SD.ellipsoid(q + [0, -0.02, -0.03], (0.10, 0.08, 0.13 + 0.03 * (k % 2))))
    dome = SD.ellipsoid(CAP_C + [0, 0, -0.04], CAP_R * 0.97)
    f = SD.smooth_union(0.05, SD.union(*terms), dome)
    g = SD.smooth_sub(0.02, f, SD.ellipsoid((0.0, -0.66, 4.05), (0.46, 0.30, 0.34)))      # keep the eyes / face clear
    p = K.blob(g, CAP_C + [0, -0.05, -0.15], 1.05, 820, 'fur_dark', 'mop', h=0.011)
    head.parts.append(p)
    return p


def beard(ctx, head, geo, length=0.6, grizzle=0.3):
    """A long shaggy beard from the chin and throat: hanging lumps, a few grey streaks (accessory_a)."""
    rng = np.random.default_rng(int(ctx.spec.get('seed', 5)) & 0xFFFF ^ 0x55)
    m = geo.mouth
    top = K.march_to(geo.f, np.array([0, -1.8, m.z0 - 0.16]), (0, 1, 0)) + np.array([0, 0.10, 0])
    terms, grey = [], []
    for k in range(9):
        t = k / 8
        x = (rng.uniform(-1, 1)) * 0.16 * (1 - 0.6 * t)
        c = top + np.array([x, 0.06 * t + 0.10, -length * t])
        r = 0.15 * (1 - 0.55 * t) + 0.03
        (grey if rng.random() < grizzle else terms).append(SD.ellipsoid(c, (r * 1.05, r * 0.85, r * 1.25)))
    f = SD.smooth_union(0.04, *(terms + grey))
    p = K.blob(f, top + [0, 0.1, -length * 0.5], length + 0.35, 400, 'fur_dark', 'beard', h=0.009)
    if grey:
        gf = SD.union(*grey)
        p.mat = ['accessory_a' if gf(p.V[fc].mean(0)[None])[0] < 0.0 else 'fur_dark' for fc in p.F]
    w = G.smoothstep(top[2] + 0.02, top[2] - 0.14, p.V[:, 2])
    p.set_weights({'jaw': w * 0.7, 'head': 1 - w * 0.7})
    head.parts.append(p)
    return p


def horns(ctx, head, geo, size=1.0):
    ctrl = [(0.52, 0.02, 4.38), (0.76, -0.01, 4.42), (0.91, -0.05, 4.60), (0.86, -0.10, 4.82)]
    root = np.asarray(ctrl[0])
    ctrl = [root + (np.asarray(c) - root) * size for c in ctrl]
    parts = M.horn_pair(ctx, head, geo, ctrl, 0.125 * size ** 0.5, 0.03, mat='horn', n=8)
    for p in parts:                                  # dark tips
        s = 1 if p.V[:, 0].mean() > 0 else -1
        tip = np.asarray(ctrl[-1]) * np.array([s, 1, 1])
        d = np.linalg.norm(p.V - tip, axis=1)
        p.mat = ['hoof' if d[fc].mean() < 0.22 * size else 'horn' for fc in p.F]
    return parts


def hump(ctx, head, size=1.0, grizzle=0.25):
    """The shoulder hump: shaggy lumps rising out of the back of the collar over the upper back (world space on the
    body frame, weighted chest / neck)."""
    fr = P6.Frame(ctx.spec)
    rng = np.random.default_rng(int(ctx.spec.get('seed', 9)) & 0xFFFF ^ 0x99)
    neck, chest = fr.j('neck'), fr.j('chest')
    ts, ws = fr.S['ts'], fr.S['ws']
    zc = neck[2] + 0.12 * ts
    # the back surface of the jersey just under the collar
    q = np.array([0.0, 2.0, neck[2] - 0.05])
    for _ in range(300):
        v = fr.f(q[None])[0]
        if v < 0.01:
            break
        q[1] -= max(v, 0.005)
    yb = q[1]
    num_top = fr.j('chest')[2] + 0.18 * ts + 0.25            # the back number patch must stay clear
    terms = [SD.ellipsoid((0.0, yb - 0.10, zc), (0.40 * ws * size, 0.34 * size, 0.34 * size))]
    grey = []
    for i in range(16):
        a = rng.uniform(-1, 1)
        b = rng.uniform(-0.6, 1)
        c = np.array([a * 0.36 * ws * size, yb - 0.02 + 0.16 * size * (1 - a * a) ** 0.5, zc + b * 0.28 * size])
        (grey if rng.random() < grizzle else terms).append(SD.sphere(c, 0.13 * size * (1 + rng.uniform(-0.25, 0.25))))
    for s in (1, -1):                                # spilling onto the shoulders behind the collar
        terms.append(SD.ellipsoid((s * 0.32 * ws, yb - 0.24, zc - 0.10), (0.20, 0.20, 0.17)))
    f = SD.smooth_union(0.05, *(terms + grey))
    f = SD.smooth_sub(0.05, f, SD.capsule(neck + [0, 0, -0.3], neck + [0, 0, 0.8], 0.30 * fr.bp.get('neck_r', 1.0)))
    f = SD.smooth_inter(0.06, f, lambda P: num_top - np.asarray(P)[..., 2])
    c = np.array([0.0, yb - 0.1, zc + 0.05])
    V, F = MS.sdf_mesh(f, c - 1.2, c + 1.2, K.hq(0.013), tris=K.tq(500, 100))
    p = Part(V, F, 'fur_dark', 'hump')
    K.orient_outward(p)
    if grey:
        gf = SD.union(*grey)
        p.mat = ['accessory_a' if gf(p.V[fc].mean(0)[None])[0] < -0.01 else 'fur_dark' for fc in p.F]
    wn = G.smoothstep(zc + 0.05, zc + 0.40, p.V[:, 2])
    p.set_weights({'chest': 1 - 0.35 * wn, 'neck': 0.35 * wn})
    head.parts.append(fr.to_design(p))
    return p


def wrist_shag(ctx, head):
    """Shaggy forelegs: the kit's fur tufts at the sleeve-less wrists (cgear.shag's cuffs; the collar ruff is left out:
    the hump and the beard already cover the collar)."""
    try:
        import cgear as GR
        fr = P6.Frame(ctx.spec)
        parts = GR.shag(fr.J, fr.f, mat='fur_dark', lod=K.LOD, rng=np.random.default_rng(int(ctx.spec.get('seed', 1)) & 0xFFFF),
                        bp=fr.bp)
    except (AttributeError, TypeError):          # an older kit without the shag gear
        return []
    out = [fr.to_design(p) for p in parts if p.name.startswith('shag_cuff')]
    head.parts += out
    return out


def features(ctx, head, geo):
    o = ctx.opts
    horns(ctx, head, geo, size=o.get('horn', 1.0))
    mop(ctx, head, geo, size=o.get('mop', 1.0))
    beard(ctx, head, geo, length=o.get('beard', 0.6), grizzle=o.get('grizzle', 0.3))
    if o.get('hump', 1.0):
        hump(ctx, head, size=o.get('hump', 1.0), grizzle=o.get('grizzle', 0.3) * 0.8)
    if o.get('shag', False):
        wrist_shag(ctx, head)


def build(ctx):
    ctx.acc['freckles'] = 0
    if ctx.acc.get('hair') == 'beard':          # the shaggy beard replaces the pitcher look's goatee
        ctx.acc['hair'] = None
    return M.build(ctx, params(ctx), features)

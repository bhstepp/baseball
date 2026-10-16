# lizard.py - desert lizards. The default is a Gila-style lizard: a broad flat wedge head, eyes high on brow bumps with
# slit pupils, a wide smiling mouth, beaded skin with dark blotches (seeded), a pale throat.
# chameleon=True is Dez 'The Mirage' Montoya (the park-5 boss): conical turret eyes with small pupils, a tall casque
# rising out of the back of the cap, a pale lateral stripe along the jaw, shades worn low on the snout so the eyes
# peek over them, a soul patch, a cocky toothy grin and a spiral coil at the end of the tail (built here from the
# kit's own body joints, like gull.py's epaulettes; the spec repeats the build in head['coil'] for the head cache).
# Head options (spec.head): blotches (number), crest (a soft crest of spikes), chameleon, specs (round glasses).
import math
import numpy as np
import hkit as K
import rk_sdf as SD
import rk_geo as G
import rk_mesh as MS
from rk_geo import Part, nrm
from heads import fam_reptile as R
from heads import fam_mammal as M

FAMILY = 'reptile'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'reptile',
    'tail': 'lizard',
    'build': 'lanky',
    'colors': {'skin': '#E8B4A0'},
    'body_over': {'hand_mat': 'fur', 'tail_mat': 'fur', 'tail_tip_mat': 'fur_dark'},
}
TURRET_AXIS = (0.62, -1.0, 0.10)


def turret_line(s=1):
    ax = nrm(np.array(TURRET_AXIS, float))
    c0 = np.array([0.24, -0.20, 4.16])
    c1 = c0 + ax * 0.30
    return c0 * np.array([s, 1, 1]), c1 * np.array([s, 1, 1]), ax * np.array([s, 1, 1])


def params(ctx):
    o = ctx.opts
    cham = bool(o.get('chameleon'))
    rng = np.random.default_rng(int(ctx.spec.get('seed', 9)) & 0xFFFFFFFF)
    P = dict(
        cran=dict(c=(0.0, 0.08, 4.06), r=(0.62, 0.60, 0.47)),
        snout=dict(a=(0.0, -0.26, 3.94), b=(0.0, -0.86, 3.86), ra=0.38, rb=0.25, sx=1.2, sz=0.62, k=0.12),
        eye=dict(x=0.27, z=4.20, axis=(0.40, -1.0, 0.12), R=0.38, W=0.13, H=0.17, out=0.03, rim=0.05, lid='fur',
                 pupil=(3.6, 12.5), lid_drop=4.0, ring='mask'),
        skin_mat='fur',
        regions=[],
    )
    if cham:
        c0, c1, ax = turret_line(1)
        turrets = SD.union(SD.round_cone(c0, c1, 0.235, 0.16), SD.round_cone(*turret_line(-1)[:2], 0.235, 0.16))
        P['extra'] = [(0.06, turrets)]
        P['brow_bumps'] = 0.0
        P['eye'] = dict(x=float(c1[0] + ax[0] * 0.16), z=float(c1[2] + ax[2] * 0.16), axis=TURRET_AXIS, R=0.36, W=0.105,
                        H=0.125, out=0.02, rim=0.04, lid='fur', pupil=(6.5, 7.5), lid_drop=6.0, ring='fur_dark')
        P['mouth'] = dict(z0=3.76, W=0.44, curve=0.20, depth=0.62, jaw_back=0.80, jaw_open=34.0, teeth='rows', tongue=True)
        P['brow'] = dict(z=4.335, x0=0.07, x1=0.40, arch=0.04, thick=0.065, mat='mask', tilt=0.06)
        P['cap'] = dict(lift=0.04, brim=1.0, cranium=None)
        # turret rings and the pale lateral stripe
        def rings(geo):
            def f(Q):
                Q = np.asarray(Q, float)
                d = 1e3
                for s in (1, -1):
                    a0, a1, aa = turret_line(s)
                    rel = Q - a0
                    h = rel @ aa
                    rp = np.linalg.norm(rel - h[..., None] * aa, axis=-1)
                    ring = np.maximum(np.abs(np.mod(h + 0.02, 0.085) - 0.0425) - 0.010, 0.10 - h)
                    d = np.minimum(d, np.maximum(ring, rp - 0.30))
                return d
            return f

        def stripe(geo):
            def f(Q):
                Q = np.asarray(Q, float)
                x, y, z = Q[..., 0], Q[..., 1], Q[..., 2]
                zc = 3.86 + 0.10 * np.clip((y + 0.6) / 0.9, 0, 1)
                return np.maximum(np.abs(z - zc) - 0.035, np.maximum(-0.6 - y, np.maximum(0.25 - np.abs(x), y - 0.35)))
            return f
        # (turret rings / a lateral stripe tessellate too coarsely to read: a few soft blotches instead)
        P['regions'] = [('fur_dark', M.region_spots(rng, n=5, zone=((-0.55, 0.55), (-0.2, 0.6), (3.85, 4.4)), size=(0.06, 0.09)))]
    else:
        n = int(o.get('blotches', 7))
        P['regions'] = [('fur_dark', M.region_spots(rng, n=n, zone=((-0.6, 0.6), (-0.7, 0.6), (3.95, 4.55)), size=(0.07, 0.12)))]
    return P


def casque(ctx, head, geo, mat='fur'):
    """The chameleon's helmet: a thin raised fin from the crown back over the nape, rising through the cap."""
    c = np.array([0.0, 0.40, 4.56])
    Rm = G.frame_from((0, 1.0, 0.35), (0, 0, 1))
    g = SD.smooth_union(0.05, SD.ellipsoid(c, (0.08, 0.46, 0.24), R=Rm),
                        SD.ellipsoid(c + np.array([0, 0.16, -0.24]), (0.10, 0.32, 0.18), R=Rm))
    g = SD.smooth_sub(0.04, g, SD.ellipsoid(np.array([0.0, -0.4, 4.3]), (0.6, 0.45, 0.42)))
    p = K.sdf_part(g, c - 0.8, c + 0.8, K.hq(0.008), K.tq(380, 60), mat, 'casque')
    edge = lambda Q: -(SD.ellipsoid(c + np.array([0, 0.0, -0.035]), (0.2, 0.43, 0.215), R=Rm)(Q))
    K.orient_outward(p)
    w = G.smoothstep(3.85, 3.60, p.V[:, 2])
    p.set_weights({'head': 1 - w, 'neck': w})
    head.parts.append(p)
    for y, z in ((0.22, 4.72), (0.42, 4.70), (0.62, 4.58)):
        geo.slots.append((np.array([0.0, y, z - 0.2]), nrm(np.array([0, 0.25, 1.0])), 0.11))
    return p


def low_shades(head, geo, mat='accessory_b', rim_mat='accessory_a'):
    """Shades riding low on the snout, just under the turret eyes (the eyes peek over the top of the lenses)."""
    terms = []
    rims = []
    lens_c = []
    for s in (1, -1):
        c = K.march_to(geo.f, np.array([s * 0.22, -1.7, 4.07]), (0, 1, 0)) + np.array([0, -0.07, 0])
        Rm = G.frame_from(nrm(np.array([s * 0.30, -1.0, 0.05])), (0, 0, 1))
        terms.append(SD.ellipsoid(c, (0.125, 0.03, 0.105), R=Rm))
        rims.append(SD.torus(c, 0.122, 0.018, Rm=np.stack([Rm[:, 0], Rm[:, 2], Rm[:, 1]], 1)))
        lens_c.append(c)
    a, b = lens_c
    mid = (a + b) / 2 + np.array([0, -0.06, 0.01])
    terms.append(SD.ptube(list(K.curve_pts([a, mid, b], 4)), 0.022))
    for s, c in zip((1, -1), lens_c):
        back = K.march_to(geo.f, c + np.array([s * 0.9, 0.35, 0.0]), (-s, 0, 0)) + np.array([s * 0.03, 0, 0])
        terms.append(SD.ptube(list(K.curve_pts([c + np.array([s * 0.12, 0.0, 0.02]), back], 3)), 0.016))
    g = SD.union(*terms)
    p = K.blob(g, mid, 0.9, 320, mat, 'shades', h=0.006)
    q = K.blob(SD.union(*rims), mid, 0.6, 200, rim_mat, 'shade_rims', h=0.005)
    head.parts += [p, q]
    return p


def tail_coil(ctx, head, mat='fur'):
    """A spiral coil at the tail tip, curling under (chameleon). Built in body space from the kit's joints (cskel,
    cbody.torso_sdf, ctail.seat_root, as cbuild does), weighted to tail.5, handed back in head design space."""
    import cskel as SK
    import cbody as CB
    import ctail as CT
    b = dict(SK.DEFAULT_BUILD)
    b.update(ctx.spec.get('build') or {})
    bp = ctx.spec.get('body') or {}
    tail = ctx.spec.get('tail') or 'lizard'
    b['tail'] = tuple(np.array(CT.LENGTHS.get(tail, CT.LENGTHS['none'])) * bp.get('tail_len', 1.0))
    J = SK.joints_for(b, None)
    f = CB.torso_sdf(J, bp)
    CT.seat_root(J, f)
    k = bp.get('tail_size', 1.0)
    t5, tip = np.asarray(J['tail.5'], float), np.asarray(J['tail_tip'], float)
    d0 = nrm(tip - t5)
    # spiral in the sagittal plane, starting along the tail direction and curling down and back toward the body
    up = np.array([0.0, 0.0, 1.0])
    side = nrm(np.cross(d0, np.array([1.0, 0, 0])))      # in-plane normal (toward the curl centre)
    if side[2] > 0:
        side = -side
    pts, rad = [], []
    turns, n = 1.6, 40
    r0 = 0.20 * k
    centre = tip - d0 * 0.06 + side * r0
    a0 = math.atan2(np.dot(tip - centre, side), np.dot(tip - centre, d0))
    for i in range(n):
        t = i / (n - 1)
        r = r0 * (1 - 0.72 * t)
        a = a0 - t * turns * 2 * math.pi * (-1)
        p = centre + (d0 * math.cos(a) + side * math.sin(a)) * r
        pts.append(p)
        rad.append((0.042 * (1 - t) + 0.013) * k)
    # lead-in from the tail tip region
    g = SD.ptube(pts, rad)
    lo, hi = np.min(pts, 0) - 0.15, np.max(pts, 0) + 0.15
    V, F = MS.sdf_mesh(g, lo, hi, K.hq(0.007), tris=K.tq(420, 60))
    p = Part(V, F, mat, 'coil')
    K.orient_outward(p)
    p.rigid('tail.5')
    Kh = 1.08 * b.get('head', 1.0)
    p.V = K.HEAD_PIVOT + (p.V - np.asarray(J['head'], float)) / Kh
    head.parts.append(p)
    return p


def soul_patch(ctx, head, geo, mat='fur_dark'):
    M.goatee(ctx, head, geo, length=0.20, width=0.07, mat=mat)


def features(ctx, head, geo):
    o = ctx.opts
    if o.get('chameleon'):
        casque(ctx, head, geo)
        if ctx.acc.get('shades'):
            ctx.acc['shades'] = 0
            low_shades(head, geo)
        if ctx.acc.get('hair') == 'beard':
            ctx.acc['hair'] = None
            soul_patch(ctx, head, geo)
        if o.get('coil'):
            tail_coil(ctx, head)
    elif o.get('crest'):
        R.crest(ctx, head, geo, n=6, h=0.14, mat='fur_dark', z0=4.22, z1=3.30)
    if o.get('specs'):
        K.round_glasses(head, geo.eyes, mat='accessory_b')


def build(ctx):
    return R.build(ctx, params(ctx), features)

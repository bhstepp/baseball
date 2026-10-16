# badger.py - American badger: a broad, flat-topped wedge of a head on a thick neck, a long tapering snout with a
# big dark nose, small round white-rimmed ears set low on the sides, the badge: a white stripe from the nose over the
# crown, black bars from the snout over each eye to the ears, white cheeks and jowls, white brows on the black bars.
# Head options (spec.head): snout (length factor), smudge (a dirt smudge on one cheek, seeded side: 'Smudge'),
# jowls (fullness), goofy (Bobby Lobbs: a rounder, chubbier face, a bigger bulb nose, buck teeth and rosy cheeks).
import numpy as np
import hkit as K
import rk_sdf as SD
import rk_geo as G
from heads import fam_mammal as M

FAMILY = 'mammal'
# species registry entry (read by cspecs without importing this module: keep it a plain literal)
SPECIES = {
    'family': 'mammal',
    'tail': 'stub',
    'build': 'stocky',
    'colors': {'nose': '#1E1A22', 'skin': '#E8A0A0'},
    'body_over': {'hand_mat': 'fur_dark', 'tail_len': 0.8},
}
PRESETS = {'p_bpbob': dict(goofy=True)}       # Batting Practice Bob looks like himself whichever spec file lists him


def params(ctx):
    o = dict(PRESETS.get(ctx.spec.get('id'), {}))
    o.update(ctx.opts)
    goofy = bool(o.get('goofy'))
    sn = o.get('snout', 1.0) * (0.92 if goofy else 1.0)
    jw = o.get('jowls', 1.0) * (1.12 if goofy else 1.0)
    tip = -0.84 - 0.14 * (sn - 1)
    P = dict(
        cran=dict(c=(0.0, 0.10, 4.10), r=(0.66, 0.58, 0.54)),
        face=dict(c=(0.0, -0.16, 4.10), r=(0.52, 0.38, 0.28), k=0.16),
        jowl=dict(c=(0.36, -0.08, 3.72), r=(0.44 * jw, 0.42, 0.36 * jw), k=0.20),
        snout=dict(a=(0.0, -0.30, 3.92), b=(0.0, tip, 3.86), ra=0.30, rb=0.15, sx=1.05, sz=0.85, k=0.13),
        chin=dict(c=(0.0, -0.46, 3.58), r=(0.22, 0.30, 0.12), k=0.10),
        neck=dict(a=(0.0, 0.12, 3.62), b=(0.0, 0.10, 3.00), r=0.235, k=0.15),
        nape=dict(c=(0.0, 0.26, 3.74), r=(0.40, 0.34, 0.28), k=0.15),
        eye=dict(x=0.215, z=4.15, axis=(0.16, -1.0, 0.03), W=0.13, H=0.185, lid=('fur_dark', 'fur_dark'), ring='fur_dark'),
        mouth=dict(z0=3.68, W=0.29 if not goofy else 0.33, curve=0.55, depth=0.62, jaw_back=0.74),
        nose=dict(kind='big', z=3.93, r=(0.14, 0.10, 0.10)),
        ear=dict(kind='round', base=(0.58, 0.14, 4.30), up=(1.0, 0.15, 0.55), fwd=(0.35, -1.0, 0.0), H=0.20, W=0.15,
                 T=0.035, cup=0.06, shape='round', mat='fur_dark', inner='fur_light', rim='fur_light', slot=False, tris=140),
        brow=dict(z=4.42, x0=0.07, x1=0.36, arch=0.07, thick=0.055, mat='fur_light'),
        regions=[],
    )
    if goofy:
        P['nose'] = dict(kind='bulb', z=3.92, r=(0.16, 0.12, 0.12))
        P['cran'] = dict(c=(0.0, 0.10, 4.12), r=(0.66, 0.58, 0.57))

    # the badge: white centre stripe (nose -> crown -> nape), black bars over the eyes, white cheeks below
    def stripe(geo):
        def f(Q):
            Q = np.asarray(Q, float)
            x, y, z = Q[..., 0], Q[..., 1], Q[..., 2]
            w = 0.075 + 0.05 * np.clip((y + 0.2) / 0.8, 0, 1) + 0.02 * np.clip((-0.5 - y) / 0.3, 0, 1)
            return np.maximum(np.abs(x) - w, 3.98 - z + 0.25 * np.clip(-0.75 - y, 0, 1))
        return f

    def bars(geo):
        def f(Q):
            Q = np.asarray(Q, float)
            x, y, z = Q[..., 0], Q[..., 1], Q[..., 2]
            ax = np.abs(x)
            # a band running from beside the nose bridge up over the eye and back to the ear
            zc = 4.12 + 0.20 * np.clip((y + 0.75) / 0.9, 0, 1) - 0.06 * np.clip((ax - 0.35) / 0.3, 0, 1)
            half = 0.20 + 0.04 * np.clip((y + 0.4) / 0.6, 0, 1)
            return np.maximum(np.abs(z - zc) - half, np.maximum(0.05 - ax, y - 0.45))
        return f
    P['regions'] = [('fur_light', stripe), ('fur_dark', bars),
                    ('fur_light', M.region_lower_face(top_dz=-0.16, side_drop=0.10, back=0.10))]
    if o.get('smudge'):
        rng = np.random.default_rng(int(ctx.spec.get('seed', 3)) & 0xFFFFFFFF)
        side = 1 if rng.random() < 0.5 else -1
        P['regions'] = [('mask', M.region_ellipsoid((side * 0.40, -0.40, 3.80), (0.13, 0.25, 0.08)))] + P['regions']
    if goofy:
        P['regions'] = [('skin', M.region_ellipsoid((s * 0.40, -0.40, 3.86), (0.11, 0.25, 0.08))) for s in (1, -1)] + P['regions']
    return P


def buck_teeth(ctx, head, geo, mat='teeth'):
    """Two big front teeth under the upper lip (rigid to the head; the lower lip drops away from them)."""
    m = geo.mouth
    out = []
    for s in (1, -1):
        top = K.march_to(geo.f, np.array([s * 0.045, -1.7, m.z0 + 0.02]), (0, 1, 0)) + np.array([0, 0.035, 0])
        g = SD.box(top + np.array([0, 0, -0.07]), (0.042, 0.02, 0.07), rnd=0.018)
        out.append(K.blob(g, top, 0.2, 40, mat, 'tooth'))
    head.parts += out
    return out


def features(ctx, head, geo):
    o = dict(PRESETS.get(ctx.spec.get('id'), {}))
    o.update(ctx.opts)
    M.whiskers(ctx, head, geo, n=2, length=0.30, mat='fur_dark', droop=0.05)
    if o.get('goofy') and K.LOD == 0:
        buck_teeth(ctx, head, geo)


def build(ctx):
    return M.build(ctx, params(ctx), features)

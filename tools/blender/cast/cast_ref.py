# cast_ref.py - the cast's REFERENCE BODY for authoring the shared animation libraries.
#   <bpy python> tools/blender/cast/cast_ref.py [--out assets/src/ref_body.glb]
#   from python:  import cast_ref; rig, objs, info = cast_ref.reference_body()
# Skeleton: the cast skeleton (cskel.CAST_BONES = Rocco's bones minus the bat, plus sockets grip.L / grip.R / mitt) at
# exactly Rocco's joint positions, so rk_rig / rk_anim helpers (joint table RR.J, IK solver) apply unchanged.
# hipHeight = 1.70 ft (hips joint), height = 5.0 ft. Preview mesh: provisional (Rocco's body with a fielding mitt on
# the left hand instead of his batting glove); it will become the generator's neutral build without changing the
# skeleton or this API.
import os
import sys
import time
import argparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cast_common as CC
import numpy as np
import rk_geo as G
import rk_rig as RR
import rk_anim as A
import cskel as SK
import cgear as GR

REF_INFO = dict(id='ref', species='raccoon', role='ref', height=5.0, hipHeight=SK.REF_HIP_HEIGHT, lod=0, hand='R')


def _rocco_parts():
    """Rocco's model parts (cached by rocco.py's key if a cache exists, else built)."""
    import pickle
    import hashlib
    here = CC.BLENDER_DIR
    src = ''.join(open(os.path.join(here, f)).read() for f in sorted(os.listdir(here))
                  if f.endswith('.py') and f not in ('rocco.py', 'rk_clips.py', 'rk_anim.py', 'rk_glb.py', 'rk_blockout.py'))
    key = hashlib.sha1(src.encode()).hexdigest()[:16]
    cache_dir = os.environ.get('ROCCO_CACHE', '')
    cache = os.path.join(cache_dir, 'rocco_model_%s.pkl' % key) if cache_dir else None
    if cache and os.path.exists(cache):
        return pickle.load(open(cache, 'rb'))
    import rk_model as MD

    class _Args:
        verbose = False
    parts = MD.build_all(_Args())
    if cache:
        os.makedirs(cache_dir, exist_ok=True)
        pickle.dump(parts, open(cache, 'wb'))
    return parts


def _drop_left_glove(body):
    """Remove Rocco's left batting glove (and its strap) from the merged body part."""
    W0 = RR.jv('hand.L')
    U = RR.GLOVE_U
    keep = []
    for i, (f, m) in enumerate(zip(body.F, body.mat)):
        c = body.V[f].mean(0)
        if c[0] < 0.5:
            keep.append(i)
            continue
        u = (c - W0) @ U
        r = np.linalg.norm((c - W0) - U * u)
        if m == 'glove' and u > -0.2:
            continue
        if m == 'team_a' and -0.01 < u < 0.08 and r > 0.085:
            continue
        keep.append(i)
    F = [body.F[i] for i in keep]
    mats = [body.mat[i] for i in keep]
    used = sorted({v for f in F for v in f})
    remap = {v: j for j, v in enumerate(used)}
    p = G.Part(body.V[used], [[remap[v] for v in f] for f in F], mats, body.name)
    p.W = {b: w[used] for b, w in body.W.items()}
    p.sk = {k: d[used] for k, d in body.sk.items()} if body.sk else {}
    return p


def reference_body(with_mesh=True, name='ref'):
    """Build the reference body into the current Blender scene. Returns (rig, objects, info)."""
    mats = CC.make_materials()
    J = SK.reference_joints()
    rig = CC.build_armature(J, SK.CAST_BONES, name + '_rig')
    objs = {}
    if with_mesh:
        head, pupils, body, decals, bat = _rocco_parts()
        body = _drop_left_glove(body)
        mitt = GR.mitt_part(J)
        body = G.merge([body, mitt], 'body')
        objs['body'] = CC.make_object(body, name + '_body', mats, rig, SK.CAST_BONE_NAMES)
        objs['head'] = CC.make_object(head, name + '_head', mats, rig, SK.CAST_BONE_NAMES, A.SHAPE_KEYS)
        objs['pupils'] = CC.make_object(pupils, name + '_pupils', mats, rig, SK.CAST_BONE_NAMES)
        objs['decals'] = CC.make_object(decals, name + '_decals', mats, rig, SK.CAST_BONE_NAMES, uv=True)
    info = dict(REF_INFO)
    info['bones'] = list(SK.CAST_BONE_NAMES)
    info['joints'] = {k: [round(float(x), 5) for x in v] for k, v in J.items()}
    return rig, objs, info


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(CC.ASSET_SRC, 'ref_body.glb'))
    args = ap.parse_args(argv)
    t0 = time.time()
    CC.reset_scene(A.FPS)
    rig, objs, info = reference_body()
    tris = {k: CC.tri_count(o) for k, o in objs.items()}
    extras = {k: info[k] for k in ('id', 'species', 'role', 'height', 'hipHeight', 'lod', 'hand')}
    CC.export_glb(args.out, extras)
    js, size = CC.read_glb_json(args.out)
    print('reference body: %s  %.1f KB  tris %s = %d  bones %d  hipHeight %.2f  (%.1fs)' % (
        args.out, size / 1024, tris, sum(tris.values()), len(js['skins'][0]['joints']), info['hipHeight'], time.time() - t0))


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

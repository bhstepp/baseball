# rocco.py - builds Rocco the raccoon (model, rig, face shapes, animation clips) and exports the raw assets/src/rocco.glb
# (tools/pack-assets.js packs it into the shipped assets/rocco.glb).
#   <blender-python> tools/blender/rocco.py [--out assets/src/rocco.glb] [--blockout] [--quick] [--clips a,b]
# Deterministic: same inputs -> same file. Writes to a temp file and renames it into place.
# Blender space: Z up, Rocco faces -Y, his left is +X; glTF (exported): Y up, faces +Z, his left is +X.
import os
import sys
import time
import math
import json
import struct
import argparse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np
import bpy
import bmesh

import rk_geo as G
import rk_rig as RR
import rk_anim as A
import rk_clips as CL

# --------------------------------------------------------------------------------------------- materials
MATERIALS = [
    ('fur', '#9A97A6'), ('fur_light', '#F2EDE3'), ('mask', '#2E2A38'), ('nose', '#1B1420'), ('eye_white', '#FFFFFF'),
    ('pupil', '#1B1420'), ('mouth', '#5A1F2A'), ('tongue', '#E0605A'), ('uniform', '#FFF6E6'), ('team_a', '#2E5AAC'),
    ('team_b', '#D9483B'), ('belt', '#3B2F2A'), ('sock', '#FFFFFF'), ('shoe', '#1E1A22'), ('sole', '#4A3F3A'),
    ('lace', '#FFFFFF'), ('glove', '#FFFFFF'), ('bat_wood', '#D9A066'), ('bat_tape', '#2E5AAC'),
    ('decal_chest', '#2E5AAC'), ('decal_back', '#2E5AAC'),
]
MAT_NAMES = [m[0] for m in MATERIALS]


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def make_materials():
    mats = {}
    for name, hexc in MATERIALS:
        m = bpy.data.materials.new(name)
        r, g, b = (int(hexc[i:i + 2], 16) / 255.0 for i in (1, 3, 5))
        m.diffuse_color = (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        if bsdf is not None:
            bsdf.inputs['Base Color'].default_value = m.diffuse_color
            bsdf.inputs['Metallic'].default_value = 0.0
            bsdf.inputs['Roughness'].default_value = 1.0
        mats[name] = m
    return mats


# --------------------------------------------------------------------------------------------- objects
def make_object(part, name, mats, rig, uv=False):
    me = G.to_blender_mesh(part.V, part.F, name)
    used = [m for m in MAT_NAMES if m in set(part.mat)]
    for m in used:
        me.materials.append(mats[m])
    idx = np.array([used.index(m) for m in part.mat], dtype=np.int32)
    me.polygons.foreach_set('material_index', idx)
    flat = getattr(part, 'flat_faces', [False] * len(part.F))
    me.polygons.foreach_set('use_smooth', [not f for f in flat])
    if part.sharp:
        ev = np.zeros(len(me.edges) * 2, dtype=np.int64)
        me.edges.foreach_get('vertices', ev)
        ev = ev.reshape(-1, 2)
        lookup = {(min(a, b), max(a, b)): i for i, (a, b) in enumerate(ev.tolist())}
        sharp = np.zeros(len(me.edges), dtype=bool)
        for e in part.sharp:
            k = lookup.get(e)
            if k is not None:
                sharp[k] = True
        attr = me.attributes.get('sharp_edge') or me.attributes.new('sharp_edge', 'BOOLEAN', 'EDGE')
        attr.data.foreach_set('value', sharp)
    if uv and part.uv is not None:
        ul = me.uv_layers.new(name='UVMap')
        flat_uv = []
        for f, u in zip(part.F, part.uv):
            for x in u:
                flat_uv.extend(x)
        ul.data.foreach_set('uv', flat_uv)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    # weights
    W = RR.normalize_weights(part.W)
    for b in RR.BONE_NAMES:
        ob.vertex_groups.new(name=b)
    gi = {vg.name: vg.index for vg in ob.vertex_groups}
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    dl = bm.verts.layers.deform.verify()
    for b, w in W.items():
        k = gi[b]
        for i in np.nonzero(w > 0)[0]:
            bm.verts[int(i)][dl][k] = float(w[i])
    bm.to_mesh(me)
    bm.free()
    # remove empty groups (keeps the exported joint list identical anyway)
    used_groups = set(W.keys())
    for vg in list(ob.vertex_groups):
        if vg.name not in used_groups:
            ob.vertex_groups.remove(vg)
    if part.sk:
        ob.shape_key_add(name='Basis', from_mix=False)
        for k in A.SHAPE_KEYS:
            if k in part.sk:
                kb = ob.shape_key_add(name=k, from_mix=False)
                kb.data.foreach_set('co', (part.V + part.sk[k]).ravel())
        ob.data.shape_keys.use_relative = True
    ob.parent = rig
    md = ob.modifiers.new('Armature', 'ARMATURE')
    md.object = rig
    return ob


# --------------------------------------------------------------------------------------------- export / inspect
def export_glb(out):
    tmp = out + '.tmp.glb'
    if os.path.exists(tmp):
        os.remove(tmp)
    bpy.ops.export_scene.gltf(
        filepath=tmp, export_format='GLB', use_selection=False, export_apply=False,
        export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
        export_vertex_color='NONE', export_cameras=False, export_lights=False, export_extras=False, export_yup=True,
        export_image_format='NONE',
        export_animations=True, export_animation_mode='ACTIONS', export_merge_animation='ACTION', export_frame_range=False,
        export_frame_step=1, export_force_sampling=True, export_optimize_animation_size=True, export_optimize_animation_keep_anim_armature=False,
        export_anim_single_armature=True, export_reset_pose_bones=True, export_rest_position_armature=True,
        export_def_bones=False, export_leaf_bone=False, export_skins=True, export_influence_nb=4,
        export_all_influences=False, export_morph=True, export_morph_normal=False, export_morph_animation=True,
        export_try_sparse_sk=True, export_nla_strips=True)
    import rk_glb
    tmp2 = out + '.tmp2.glb'
    forced = {n: (0.25,) for n in ('swing_high', 'swing_mid', 'swing_low')}
    rk_glb.optimize_file(tmp, tmp2, forced)
    os.remove(tmp)
    os.replace(tmp2, out)


def read_glb_json(path):
    data = open(path, 'rb').read()
    ln = struct.unpack('<I', data[12:16])[0]
    return json.loads(data[20:20 + ln]), len(data)


def to_gltf(p):
    return np.array([p[0], p[2], -p[1]])


# --------------------------------------------------------------------------------------------- main
def build(args):
    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = A.FPS
    sc.render.fps_base = 1.0
    mats = make_materials()
    rig = RR.build_armature('rocco_rig')

    if args.blockout:
        import rk_blockout as BO
        head = G.merge(BO.head_parts(), 'rocco_head')
        pupils = G.merge(BO.pupil_parts(), 'rocco_pupils')
        body = G.merge(BO.body_parts(), 'rocco_body')
        decals = G.merge(BO.decal_parts(), 'rocco_decals')
        bat = BO.bat_part()
    else:
        import rk_model as MD
        import pickle
        import hashlib
        src = ''.join(open(os.path.join(HERE, f)).read() for f in sorted(os.listdir(HERE))
                      if f.endswith('.py') and f not in ('rocco.py', 'rk_clips.py', 'rk_anim.py', 'rk_glb.py', 'rk_blockout.py'))
        key = hashlib.sha1(src.encode()).hexdigest()[:16]
        cache = os.path.join(args.cache, 'rocco_model_%s.pkl' % key) if args.cache else None
        if cache and os.path.exists(cache):
            head, pupils, body, decals, bat = pickle.load(open(cache, 'rb'))
            print('model loaded from cache', cache)
        else:
            head, pupils, body, decals, bat = MD.build_all(args)
            if cache:
                os.makedirs(args.cache, exist_ok=True)
                pickle.dump((head, pupils, body, decals, bat), open(cache, 'wb'))
    objs = {}
    objs['rocco_body'] = make_object(body, 'rocco_body', mats, rig)
    objs['rocco_head'] = make_object(head, 'rocco_head', mats, rig)
    objs['rocco_pupils'] = make_object(pupils, 'rocco_pupils', mats, rig)
    objs['rocco_decals'] = make_object(decals, 'rocco_decals', mats, rig, uv=True)
    objs['rocco_bat'] = make_object(bat, 'rocco_bat', mats, rig)
    tris = {k: G.tri_count([list(p.vertices) for p in o.data.polygons]) for k, o in objs.items()}
    print('triangles', tris, 'total', sum(tris.values()))
    print('model built in %.1fs' % (time.time() - t0))

    solver = A.Solver(rig)
    clips = CL.all_clips()
    if args.clips:
        keep = set(args.clips.split(','))
        clips = [c for c in clips + CL.debug_clips() if c.name in keep]
    if args.clips == 'none':
        clips = []
    report = {}
    for clip in clips:
        n0 = len(solver.warn)
        res = A.bake_clip(solver, rig, objs['rocco_head'], clip)
        solver.warn[n0:] = [clip.name + ': ' + w for w in solver.warn[n0:]]
        if clip.name.startswith('swing_'):
            j = int(round(CL.T_CONTACT * A.FPS))
            Wd = res['worlds'][j]
            sweet = Wd['bat_sweet'][:3, 3]
            tip = Wd['bat_tip'][:3, 3]
            report[clip.name] = dict(t=res['times'][j], sweet_blender=sweet.round(4).tolist(), sweet_gltf=to_gltf(sweet).round(4).tolist(),
                                     tip_gltf=to_gltf(tip).round(4).tolist())
    if solver.warn:
        print('IK warnings (%d):' % len(solver.warn))
        for w in solver.warn[:40]:
            print('   ', w)
    for k, v in report.items():
        print('contact', k, v)
    print('baked %d clips in %.1fs' % (len(clips), time.time() - t0))
    # rest pose for export
    for pb in rig.pose.bones:
        pb.matrix_basis.identity()
    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    export_glb(out)
    js, size = read_glb_json(out)
    print('exported %s: %.1f KB, %d nodes, %d animations, %d meshes, %d materials' % (
        out, size / 1024, len(js.get('nodes', [])), len(js.get('animations', [])), len(js.get('meshes', [])), len(js.get('materials', []))))
    print('animations:', [a['name'] for a in js.get('animations', [])])
    print('materials:', sorted(m['name'] for m in js.get('materials', [])))
    print('done in %.1fs' % (time.time() - t0))


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(HERE, '..', '..', 'assets', 'src', 'rocco.glb'))
    ap.add_argument('--blockout', action='store_true')
    ap.add_argument('--quick', action='store_true')
    ap.add_argument('--clips', default='')
    ap.add_argument('--verbose', action='store_true')
    ap.add_argument('--cache', default='', help='directory for a model cache (speeds up animation iteration)')
    build(ap.parse_args(argv))

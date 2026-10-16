# cast_common.py - shared plumbing for the cast generator: paths, the contract's material table, a skeleton-agnostic
# armature builder, skinned mesh objects and glb export with scene extras. Rocco's own build (tools/blender/rocco.py)
# does not use this module; the cast reuses his toolkit (rk_geo, rk_sdf, rk_mesh, rk_rig) read-only.
import os
import sys
import json
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
BLENDER_DIR = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(BLENDER_DIR))
for _p in (BLENDER_DIR, HERE):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import numpy as np
import bpy
import bmesh
from mathutils import Vector

import rk_geo as G
import rk_rig as RR

ASSET_SRC = os.path.join(ROOT, 'assets', 'src')

# The contract's material names (docs/CAST-CONTRACT.md) with neutral defaults; a character overrides the colours it
# needs (fur, beak, horn ...). The runtime recolours team_a / team_b / cap / cap_brim / decal_* by team.
MATERIALS = [
    ('fur', '#9A97A6'), ('fur_light', '#F2EDE3'), ('fur_dark', '#4A4256'), ('mask', '#2E2A38'), ('nose', '#1B1420'),
    ('skin', '#E8B4A0'), ('eye_white', '#FFFFFF'), ('pupil', '#1B1420'), ('mouth', '#5A1F2A'), ('tongue', '#E0605A'),
    ('teeth', '#FFFFFF'), ('beak', '#F2B632'), ('horn', '#EADFC4'), ('hoof', '#3A2E2A'), ('shell', '#8DAA5E'),
    ('feather', '#F6F1E6'), ('feather_accent', '#D9483B'), ('uniform', '#FFF6E6'), ('team_a', '#2E5AAC'),
    ('team_b', '#D9483B'), ('belt', '#3B2F2A'), ('sock', '#FFFFFF'), ('shoe', '#1E1A22'), ('sole', '#4A3F3A'),
    ('lace', '#FFFFFF'), ('glove', '#FFFFFF'), ('mitt', '#B8692E'), ('mitt_lace', '#6E3A1C'), ('cap', '#2E5AAC'),
    ('cap_brim', '#2E5AAC'), ('decal_chest', '#2E5AAC'), ('decal_back', '#2E5AAC'), ('accessory_a', '#F59AB8'),
    ('accessory_b', '#2E2A38'),
]
MAT_NAMES = [m[0] for m in MATERIALS]


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def make_materials(colors=None):
    colors = dict(colors or {})
    mats = {}
    for name, hexc in MATERIALS:
        m = bpy.data.materials.new(name)
        r, g, b = hex_rgb(colors.get(name, hexc))
        m.diffuse_color = (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        if bsdf is not None:
            bsdf.inputs['Base Color'].default_value = m.diffuse_color
            bsdf.inputs['Metallic'].default_value = 0.0
            bsdf.inputs['Roughness'].default_value = 1.0
        mats[name] = m
    return mats


def reset_scene(fps=40):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = fps
    sc.render.fps_base = 1.0
    return sc


# ------------------------------------------------------------------------------------------- armature
def bone_tail(J, b):
    """Tail of bone b for a joint table J: same conventions as rk_rig.bone_tail (directions never change)."""
    name, parent, head, tail, deform = b
    h = np.asarray(J[head], float)
    if tail == 'ID':
        return h + np.array([0, 0, RR.IDB])
    sx = 1.0 if name.endswith('.L') else -1.0
    if tail == 'FING':
        return h + RR.ARM_DIR * np.array([sx, 1, 1]) * 0.12
    if tail == 'THUMB':
        return h + RR.HAND_T * 0.1
    return np.asarray(J[tail], float)


def build_armature(J, bones, name='rig'):
    """rk_rig.build_armature for any joint table and bone list (same roll conventions -> same rest orientations)."""
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for b in bones:
        bname, parent, head, tail, deform = b
        e = arm.edit_bones.new(bname)
        e.head = Vector(tuple(np.asarray(J[head], float)))
        e.tail = Vector(tuple(bone_tail(J, b)))
        if tail == 'ID':
            e.roll = 0.0
        elif bname.startswith('tail'):
            y = (e.tail - e.head).normalized()
            e.align_roll(Vector((1, 0, 0)).cross(y))
        elif bname.split('.')[0] in RR.HAND_BONES:
            sx = 1.0 if bname.endswith('.L') else -1.0
            e.align_roll(Vector(tuple(RR.HAND_N * np.array([sx, 1, 1]))))
        elif bname.startswith(('foot', 'toe')):
            e.align_roll(Vector((0, 0, 1)))
        else:
            e.align_roll(RR.roll_hint(bname))
        e.use_deform = deform
        e.use_connect = False
        if parent:
            e.parent = eb[parent]
        e.inherit_scale = 'FULL'
        eb[bname] = e
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in ob.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return ob


# ------------------------------------------------------------------------------------------- objects
def make_object(part, name, mats, rig, bone_names, shape_keys=(), uv=False):
    me = G.to_blender_mesh(part.V, part.F, name)
    used = [m for m in MAT_NAMES if m in set(part.mat)]
    missing = sorted(set(part.mat) - set(MAT_NAMES))
    if missing:
        raise ValueError('unknown materials %s on %s' % (missing, name))
    for m in used:
        me.materials.append(mats[m])
    idx = np.array([used.index(m) for m in part.mat], dtype=np.int32)
    me.polygons.foreach_set('material_index', idx)
    flat = getattr(part, 'flat_faces', None) or [False] * len(part.F)
    me.polygons.foreach_set('use_smooth', [not f for f in flat])
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
    W = RR.normalize_weights(part.W)
    bad = sorted(set(W) - set(bone_names))
    if bad:
        raise ValueError('weights for unknown bones %s on %s' % (bad, name))
    for b in bone_names:
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
    for vg in list(ob.vertex_groups):
        if vg.name not in W:
            ob.vertex_groups.remove(vg)
    if part.sk:
        ob.shape_key_add(name='Basis', from_mix=False)
        for k in shape_keys:
            if k in part.sk:
                kb = ob.shape_key_add(name=k, from_mix=False)
                kb.data.foreach_set('co', (part.V + part.sk[k]).ravel())
        ob.data.shape_keys.use_relative = True
    ob.parent = rig
    md = ob.modifiers.new('Armature', 'ARMATURE')
    md.object = rig
    return ob


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ------------------------------------------------------------------------------------------- export
def export_glb(out, extras, animations=False):
    """Write a glb (temp file + rename) with the character's scene extras."""
    sc = bpy.context.scene
    for k, v in extras.items():
        sc[k] = v
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    tmp = out + '.tmp.glb'
    if os.path.exists(tmp):
        os.remove(tmp)
    bpy.ops.export_scene.gltf(
        filepath=tmp, export_format='GLB', use_selection=False, export_apply=False,
        export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
        export_vertex_color='NONE', export_cameras=False, export_lights=False, export_extras=True, export_yup=True,
        export_image_format='NONE', export_animations=animations, export_skins=True, export_influence_nb=4,
        export_all_influences=False, export_morph=True, export_morph_normal=False, export_morph_animation=animations,
        export_try_sparse_sk=True, export_def_bones=False, export_leaf_bone=False, export_rest_position_armature=True,
        export_reset_pose_bones=True)
    _strip_object_extras(tmp)
    os.replace(tmp, out)


def _strip_object_extras(path):
    """Keep only the scene extras (Blender also writes custom props of objects / meshes)."""
    data = open(path, 'rb').read()
    ln = struct.unpack('<I', data[12:16])[0]
    js = json.loads(data[20:20 + ln])
    changed = False
    for key in ('nodes', 'meshes', 'materials'):
        for o in js.get(key, []):
            if 'extras' in o and key != 'meshes':
                del o['extras']
                changed = True
    if not changed:
        return
    body = json.dumps(js, separators=(',', ':')).encode()
    body += b' ' * ((4 - len(body) % 4) % 4)
    rest = data[20 + ln:]
    total = 12 + 8 + len(body) + len(rest)
    out = struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(body), 0x4E4F534A) + body + rest
    open(path, 'wb').write(out)


def read_glb_json(path):
    data = open(path, 'rb').read()
    ln = struct.unpack('<I', data[12:16])[0]
    return json.loads(data[20:20 + ln]), len(data)

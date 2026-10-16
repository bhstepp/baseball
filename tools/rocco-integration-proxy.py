# rocco-integration-proxy.py — a crude stand-in for assets/rocco.glb that follows the asset contract in
# docs/PILOT-ROCCO.md (bone names, material names, shape keys, clip names, contact frame at t = 0.25 s). It exists so
# the integration (src/36-rocco.js) can be built and regression-tested without the real model. It is NOT the
# character: rigid primitive pieces, rough key poses. Never write it to assets/.
#   <bpy python> tools/rocco-integration-proxy.py --out /path/to/proxy.glb
import bpy, bmesh, math, sys, os
from mathutils import Vector, Matrix, Quaternion, Euler

out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else '/tmp/rocco-proxy.glb'
if os.path.abspath(out).replace('\\', '/').endswith('assets/rocco.glb'):
    raise SystemExit('refusing to overwrite the real asset')
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 24
FPS = 24

COLORS = {'fur': '#9A97A6', 'fur_light': '#F2EDE3', 'mask': '#2E2A38', 'nose': '#1B1420', 'eye_white': '#FFFFFF', 'pupil': '#1B1420',
          'mouth': '#5A1F2A', 'tongue': '#E0605A', 'uniform': '#FFF6E6', 'team_a': '#2E5AAC', 'team_b': '#D9483B', 'belt': '#3B2F2A',
          'sock': '#FFFFFF', 'shoe': '#1E1A22', 'sole': '#4A3F3A', 'lace': '#FFFFFF', 'glove': '#FFFFFF', 'bat_wood': '#D9A066',
          'bat_tape': '#2E5AAC', 'decal_chest': '#2E5AAC', 'decal_back': '#2E5AAC'}
def srgb2lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
MATS = {}
for name, hx in COLORS.items():
    m = bpy.data.materials.new(name)
    r, g, b = (int(hx[i:i + 2], 16) / 255 for i in (1, 3, 5))
    m.diffuse_color = (srgb2lin(r), srgb2lin(g), srgb2lin(b), 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    if bsdf: bsdf.inputs['Base Color'].default_value = m.diffuse_color
    MATS[name] = m

# ---------------------------------------------------------------- armature (Blender: Z up, facing -Y, his left = +X)
arm = bpy.data.armatures.new('rocco_rig')
rig = bpy.data.objects.new('rocco', arm)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
B = {}
def bone(name, h, t, parent=None):
    eb = arm.edit_bones.new(name); eb.head = Vector(h); eb.tail = Vector(t)
    if parent: eb.parent = B[parent]
    eb.use_connect = False; B[name] = eb; return eb
bone('root', (0, 0, 0), (0, 0, 0.4))
bone('hips', (0, 0, 1.75), (0, 0, 2.1), 'root')
bone('spine', (0, 0, 2.1), (0, 0, 2.5), 'hips')
bone('chest', (0, 0, 2.5), (0, 0, 3.05), 'spine')
bone('neck', (0, 0, 3.05), (0, 0, 3.3), 'chest')
bone('head', (0, 0, 3.3), (0, 0, 4.4), 'neck')
bone('jaw', (0, -0.35, 3.62), (0, -0.7, 3.55), 'head')
for s, sx in (('L', 1), ('R', -1)):
    bone('ear.' + s, (0.45 * sx, 0.05, 4.55), (0.62 * sx, 0.05, 4.95), 'head')
    bone('eye.' + s, (0.22 * sx, -0.55, 4.02), (0.22 * sx, -0.8, 4.02), 'head')
    bone('brow.' + s, (0.22 * sx, -0.6, 4.28), (0.22 * sx, -0.8, 4.28), 'head')
    bone('shoulder.' + s, (0.12 * sx, 0, 3.0), (0.38 * sx, 0, 3.0), 'chest')
    bone('upper_arm.' + s, (0.38 * sx, 0, 3.0), (0.3 * sx, -0.35, 2.68), 'shoulder.' + s)
    bone('forearm.' + s, (0.3 * sx, -0.35, 2.68), (0.08 * sx, -0.55, 2.45), 'upper_arm.' + s)
    bone('hand.' + s, (0.08 * sx, -0.55, 2.45), (0.02 * sx, -0.66, 2.45), 'forearm.' + s)
    bone('thigh.' + s, (0.3 * sx, 0, 1.75), (0.34 * sx, 0, 0.95), 'hips')
    bone('shin.' + s, (0.34 * sx, 0, 0.95), (0.34 * sx, 0, 0.32), 'thigh.' + s)
    bone('foot.' + s, (0.34 * sx, 0, 0.32), (0.34 * sx, -0.42, 0.12), 'shin.' + s)
    bone('toe.' + s, (0.34 * sx, -0.42, 0.12), (0.34 * sx, -0.72, 0.12), 'foot.' + s)
prev = 'hips'
for i in range(1, 6):
    y0 = 0.45 + (i - 1) * 0.32; z0 = 1.7 + math.sin(i * 0.7) * 0.35
    bone('tail.%d' % i, (0, y0, z0), (0, y0 + 0.32, 1.7 + math.sin((i + 1) * 0.7) * 0.35), prev); prev = 'tail.%d' % i
bone('bat', (0, -0.62, 2.45), (0, -1.6, 2.45), 'hand.R')
bone('bat_sweet', (0, -2.85, 2.45), (0, -3.0, 2.45), 'bat')
bone('bat_tip', (0, -3.45, 2.45), (0, -3.6, 2.45), 'bat')
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------- rigid-skinned pieces
def piece(bm_list, kind, mat, bone_name, loc, size, rot=None, seg=(14, 8)):
    bm_list.append((kind, mat, bone_name, loc, size, rot, seg))
def build_mesh(name, parts, keys=None):
    me = bpy.data.meshes.new(name); ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
    bm = bmesh.new(); mat_names = []; groups = {}
    for kind, mat, bname, loc, size, rot, seg in parts:
        before = set(bm.verts)
        if kind == 'sph': bmesh.ops.create_uvsphere(bm, u_segments=seg[0], v_segments=seg[1], radius=1.0)
        elif kind == 'cyl': bmesh.ops.create_cone(bm, cap_ends=True, segments=seg[0], radius1=1.0, radius2=1.0, depth=1.0)
        elif kind == 'cone': bmesh.ops.create_cone(bm, cap_ends=True, segments=seg[0], radius1=1.0, radius2=0.05, depth=1.0)
        new = [v for v in bm.verts if v not in before]
        M = Matrix.Translation(Vector(loc)) @ (Euler(rot).to_matrix().to_4x4() if rot else Matrix()) @ Matrix.Diagonal(Vector(size + (1,)) if len(size) == 3 else Vector((size[0], size[0], size[0], 1)))
        bmesh.ops.transform(bm, matrix=M, verts=new)
        if mat not in mat_names: mat_names.append(mat)
        mi = mat_names.index(mat)
        for f in {f for v in new for f in v.link_faces}: f.material_index = mi; f.smooth = True
        groups.setdefault(bname, []).extend(new)
    bm.verts.index_update()
    gidx = {b: [v.index for v in vs] for b, vs in groups.items()}
    bm.to_mesh(me); bm.free()
    for m in mat_names: me.materials.append(MATS[m])
    for b, idx in gidx.items():
        vg = ob.vertex_groups.new(name=b); vg.add(idx, 1.0, 'REPLACE')
    ob.parent = rig
    mod = ob.modifiers.new('Armature', 'ARMATURE'); mod.object = rig
    return ob

P = []
piece(P, 'sph', 'uniform', 'hips', (0, 0, 1.95), (0.62, 0.56, 0.5))
piece(P, 'cyl', 'belt', 'hips', (0, 0, 2.18), (0.6, 0.54, 0.12), seg=(18, 1))
piece(P, 'sph', 'uniform', 'chest', (0, 0, 2.72), (0.5, 0.42, 0.5))
piece(P, 'cyl', 'team_a', 'chest', (0, -0.36, 2.72), (0.04, 0.04, 0.8), seg=(6, 1))
piece(P, 'sph', 'fur', 'neck', (0, 0, 3.15), (0.2, 0.2, 0.2))
piece(P, 'sph', 'team_b', 'chest', (0, 0, 3.12), (0.3, 0.28, 0.08))
for s, sx in (('L', 1), ('R', -1)):
    piece(P, 'sph', 'team_a', 'shoulder.' + s, (0.36 * sx, 0, 2.98), (0.16, 0.16, 0.16))
    piece(P, 'cyl', 'fur', 'upper_arm.' + s, (0.34 * sx, -0.18, 2.84), (0.08, 0.08, 0.5), rot=(0.9, 0, 0))
    piece(P, 'cyl', 'fur', 'forearm.' + s, (0.19 * sx, -0.45, 2.56), (0.07, 0.07, 0.4), rot=(0.9, 0, 0.6 * sx))
    piece(P, 'sph', 'glove', 'hand.' + s, (0.05 * sx, -0.6, 2.45), (0.13, 0.13, 0.13))
    piece(P, 'sph', 'uniform', 'thigh.' + s, (0.32 * sx, 0, 1.35), (0.26, 0.26, 0.42))
    piece(P, 'cyl', 'sock', 'shin.' + s, (0.34 * sx, 0, 0.62), (0.11, 0.11, 0.6))
    piece(P, 'cyl', 'team_a', 'shin.' + s, (0.34 * sx, 0, 0.75), (0.12, 0.12, 0.3))
    piece(P, 'sph', 'shoe', 'foot.' + s, (0.34 * sx, -0.25, 0.17), (0.2, 0.42, 0.16))
    piece(P, 'sph', 'sole', 'foot.' + s, (0.34 * sx, -0.25, 0.05), (0.21, 0.43, 0.05))
    piece(P, 'sph', 'lace', 'foot.' + s, (0.34 * sx, -0.4, 0.28), (0.08, 0.12, 0.04))
    piece(P, 'sph', 'shoe', 'toe.' + s, (0.34 * sx, -0.6, 0.15), (0.18, 0.16, 0.13))
    piece(P, 'sph', 'pupil', 'eye.' + s, (0.22 * sx, -0.72, 4.0), (0.07, 0.04, 0.11))
    piece(P, 'cone', 'fur', 'ear.' + s, (0.52 * sx, 0.05, 4.72), (0.18, 0.08, 0.4), rot=(0, -0.35 * sx, 0), seg=(8, 1))
for i in range(1, 6):
    y = 0.45 + (i - 0.5) * 0.32; z = 1.7 + math.sin((i + 0.5) * 0.7) * 0.35
    piece(P, 'sph', 'fur' if i % 2 else 'mask', 'tail.%d' % i, (0, y, z), (0.24 - i * 0.02, 0.2, 0.24 - i * 0.02))
piece(P, 'sph', 'team_a', 'head', (0, 0.0, 4.45), (0.8, 0.78, 0.5), seg=(16, 8))
piece(P, 'cyl', 'team_a', 'head', (0, -0.72, 4.42), (0.4, 0.3, 0.04), seg=(14, 1))
piece(P, 'sph', 'decal_chest', 'chest', (0.18, -0.43, 2.8), (0.12, 0.02, 0.14))
piece(P, 'sph', 'decal_back', 'chest', (0, 0.43, 2.8), (0.14, 0.02, 0.16))
body = build_mesh('rocco_body', P)

H = []
piece(H, 'sph', 'fur', 'head', (0, 0, 4.0), (0.78, 0.7, 0.66), seg=(18, 12))
piece(H, 'sph', 'fur_light', 'head', (0, -0.58, 3.72), (0.34, 0.3, 0.26))
piece(H, 'sph', 'nose', 'head', (0, -0.88, 3.8), (0.09, 0.06, 0.07))
piece(H, 'sph', 'mask', 'head', (0, -0.42, 4.04), (0.66, 0.32, 0.2))
for s, sx in (('L', 1), ('R', -1)):
    piece(H, 'sph', 'eye_white', 'head', (0.22 * sx, -0.62, 4.02), (0.14, 0.08, 0.2))
    piece(H, 'sph', 'fur_light', 'head', (0.24 * sx, -0.6, 4.3), (0.13, 0.04, 0.035))
piece(H, 'sph', 'mouth', 'jaw', (0, -0.72, 3.55), (0.24, 0.06, 0.05))
head = build_mesh('rocco_head', H)
# shape keys (crude: move vertex subsets)
head.shape_key_add(name='Basis')
co = [v.co.copy() for v in head.data.vertices]
mi = [None] * len(co)
for poly in head.data.polygons:
    for vi in poly.vertices: mi[vi] = head.data.materials[poly.material_index].name
def key(name, fn):
    sk = head.shape_key_add(name=name, from_mix=False)
    for i, c in enumerate(co):
        d = fn(i, c)
        if d is not None: sk.data[i].co = c + Vector(d)
def eyes(i, c): return (0, 0, (4.02 - c.z) * 0.85) if mi[i] == 'eye_white' else None
def brows(i, c): return mi[i] == 'fur_light' and c.z > 4.2
def mouthv(i, c): return mi[i] == 'mouth'
key('blink', eyes)
key('smile', lambda i, c: (0, 0, abs(c.x) * 0.25) if mouthv(i, c) else None)
key('grin', lambda i, c: (c.x * 0.3, -0.02, abs(c.x) * 0.3) if mouthv(i, c) else None)
key('frown', lambda i, c: (0, 0, -abs(c.x) * 0.25) if mouthv(i, c) else None)
key('mouth_open', lambda i, c: (0, 0, (c.z - 3.55) * 3.0) if mouthv(i, c) else None)
key('brows_up', lambda i, c: (0, 0, 0.08) if brows(i, c) else None)
key('brows_angry', lambda i, c: (0, 0, -0.05 - (abs(c.x) - 0.24) * 0.6) if brows(i, c) else None)
key('brows_sad', lambda i, c: (0, 0, -0.02 + (abs(c.x) - 0.24) * 0.6) if brows(i, c) else None)
key('squint', lambda i, c: (0, 0, (4.02 - c.z) * 0.4) if mi[i] == 'eye_white' else None)
key('cheeks_puff', lambda i, c: (c.x * 0.08, 0, 0) if mi[i] == 'fur_light' and c.z < 3.9 else None)

BT = []
piece(BT, 'cyl', 'bat_wood', 'bat', (0, -2.1, 2.45), (0.1, 0.1, 2.9), rot=(math.pi / 2, 0, 0), seg=(12, 1))
piece(BT, 'sph', 'bat_wood', 'bat', (0, -3.0, 2.45), (0.17, 0.6, 0.17))
piece(BT, 'cyl', 'bat_tape', 'bat', (0, -0.95, 2.45), (0.11, 0.11, 0.6), rot=(math.pi / 2, 0, 0), seg=(12, 1))
piece(BT, 'sph', 'bat_tape', 'bat', (0, -0.62, 2.45), (0.13, 0.05, 0.13))
bat = build_mesh('rocco_bat', BT)

# ---------------------------------------------------------------- clips
bpy.context.view_layer.objects.active = rig
pb = rig.pose.bones
for b in pb: b.rotation_mode = 'QUATERNION'
def wq(bname, axis, deg):  # rotation about an armature-space axis -> bone-local quaternion
    R = rig.data.bones[bname].matrix_local.to_quaternion()
    return R.inverted() @ Quaternion(Vector(axis), math.radians(deg)) @ R
def wl(bname, v):  # armature-space offset -> bone-local location
    R = rig.data.bones[bname].matrix_local.to_3x3().inverted()
    return R @ Vector(v)
Z, X, Y = (0, 0, 1), (1, 0, 0), (0, 1, 0)
def pose(**kw):  # name -> list of ('r', axis, deg) / ('t', vec)
    return kw
STANCE = {'chest': [('r', Z, -80)], 'bat': [('r', X, -70)], 'hips': [('r', Z, -15)], 'head': [('r', Z, 75)], 'thigh.L': [('r', Y, 12)], 'thigh.R': [('r', Y, -12)]}
SET = {'chest': [('r', Z, -95)], 'bat': [('r', X, -60)], 'hips': [('r', Z, -20)], 'head': [('r', Z, 85)], 'thigh.L': [('r', Y, 18)], 'thigh.R': [('r', Y, -12)]}
COIL = {'chest': [('r', Z, -120)], 'bat': [('r', X, -50)], 'hips': [('r', Z, -35)], 'head': [('r', Z, 105)], 'thigh.L': [('r', X, -50)], 'shin.L': [('r', X, 60)]}
def contact(h):
    return {'chest': [('r', Z, 0), ('r', X, -h * 0.5)], 'bat': [('r', X, -h)], 'hips': [('r', Z, 20)], 'head': [('r', Z, 30)], 'thigh.L': [('r', Y, 18)], 'thigh.R': [('r', Y, -18)],
            'root': [('t', (0, 0, -0.25 if h < 0 else 0))]}
FOLLOW = {'chest': [('r', Z, 150)], 'bat': [('r', X, -65)], 'hips': [('r', Z, 60)], 'head': [('r', Z, 20)], 'foot.R': [('r', X, 40)]}
DIZZY = {'chest': [('r', Z, 30), ('r', Y, 12)], 'bat': [('r', X, 70)], 'head': [('r', Y, -20)], 'root': [('r', Z, 360)]}
RUN_A = {'chest': [('r', X, 25)], 'thigh.L': [('r', X, 50)], 'thigh.R': [('r', X, -40)], 'shoulder.L': [('r', X, -50)], 'shoulder.R': [('r', X, 50)], 'tail.1': [('r', X, -30)]}
RUN_B = {'chest': [('r', X, 25)], 'thigh.L': [('r', X, -40)], 'thigh.R': [('r', X, 50)], 'shoulder.L': [('r', X, 50)], 'shoulder.R': [('r', X, -50)], 'tail.1': [('r', X, -30)]}
TROT_A = {'chest': [('r', X, -8)], 'thigh.L': [('r', X, 25)], 'thigh.R': [('r', X, -20)], 'shoulder.R': [('r', Y, -120)]}
TROT_B = {'chest': [('r', X, -8)], 'thigh.L': [('r', X, -20)], 'thigh.R': [('r', X, 25)], 'shoulder.R': [('r', Y, -120)]}
CHEER = {'root': [('t', (0, 0, 1.0))], 'shoulder.L': [('r', Y, 140)], 'chest': [('r', X, -10)], 'bat': [('r', X, 80)]}
SLUMP = {'chest': [('r', X, 30)], 'head': [('r', X, 25)], 'bat': [('r', X, 80)], 'root': [('t', (0, 0, -0.1))]}
CLIPS = {
    'stance': (2.4, True, [(0, STANCE), (1.2, dict(STANCE, chest=[('r', Z, -84), ('r', X, 4)], bat=[('r', X, -78)])), (2.4, STANCE)]),
    'stride': (0.35, False, [(0, STANCE), (0.15, dict(SET, **{'thigh.L': [('r', X, -35)]})), (0.35, SET)]),
    'power_load': (0.35, False, [(0, STANCE), (0.35, COIL)]),
    'coil_hold': (0.5, True, [(0, COIL), (0.25, dict(COIL, chest=[('r', Z, -123)])), (0.5, COIL)]),
    'swing_high': (1.0, False, [(0, SET), (0.18, contact(25)), (0.25, contact(18)), (0.5, FOLLOW), (1.0, FOLLOW)]),
    'swing_mid': (1.0, False, [(0, SET), (0.18, contact(5)), (0.25, contact(0)), (0.5, FOLLOW), (1.0, FOLLOW)]),
    'swing_low': (1.0, False, [(0, SET), (0.18, contact(-20)), (0.25, contact(-28)), (0.5, FOLLOW), (1.0, FOLLOW)]),
    'whiff': (1.4, False, [(0, SET), (0.25, contact(0)), (0.5, FOLLOW), (1.0, dict(DIZZY, root=[('r', Z, 300)])), (1.4, DIZZY)]),
    'dizzy': (1.6, True, [(0, DIZZY), (0.8, dict(DIZZY, chest=[('r', Z, 30), ('r', Y, -12)], head=[('r', Y, 20)])), (1.6, DIZZY)]),
    'watch': (1.2, True, [(0, FOLLOW), (0.6, dict(FOLLOW, chest=[('r', Z, 140), ('r', X, -8)])), (1.2, FOLLOW)]),
    'bat_flip': (1.3, False, [(0, FOLLOW), (0.25, dict(FOLLOW, bat=[('r', X, -120)])), (0.6, dict(FOLLOW, bat=[('r', X, 300)])), (1.3, dict(FOLLOW, bat=[('r', X, 300)], chest=[('r', Z, 60)]))]),
    'run': (0.5, True, [(0, RUN_A), (0.25, RUN_B), (0.5, RUN_A)]),
    'trot': (0.8, True, [(0, TROT_A), (0.4, TROT_B), (0.8, TROT_A)]),
    'cheer': (1.2, False, [(0, {}), (0.3, CHEER), (0.6, {}), (1.2, {})]),
    'take': (0.8, False, [(0, SET), (0.3, dict(SET, chest=[('r', Z, -95), ('r', X, -10)])), (0.8, STANCE)]),
    'strike_react': (1.4, False, [(0, STANCE), (0.2, dict(STANCE, **{'thigh.L': [('r', X, -40)]})), (0.4, STANCE), (0.9, SLUMP), (1.4, STANCE)]),
}
# bat_flip: the bat flies away (location on the bat bone)
BATFLY = {0.25: (0, 0, 0), 0.6: (0, 2.5, -1.5), 0.9: (0, 4.0, -3.5), 1.3: (0, 4.5, -5.5)}

rig.animation_data_create()
for name, (length, loop, keys) in CLIPS.items():
    act = bpy.data.actions.new(name)
    rig.animation_data.action = act
    for t, ps in keys:
        f = round(t * FPS)
        for b in pb:
            b.rotation_quaternion = Quaternion(); b.location = Vector()
        for bname, ops in ps.items():
            q = Quaternion(); loc = Vector()
            for op in ops:
                if op[0] == 'r': q = wq(bname, op[1], op[2]) @ q
                else: loc = loc + wl(bname, op[1])
            pb[bname].rotation_quaternion = q; pb[bname].location = loc
        if name == 'bat_flip' and t in BATFLY:
            pb['bat'].location = wl('bat', BATFLY[t])
        for b in pb:
            b.keyframe_insert('rotation_quaternion', frame=f); b.keyframe_insert('location', frame=f)
    act.use_fake_user = True
    tr = rig.animation_data.nla_tracks.new(); tr.name = name
    tr.strips.new(name, 0, act); tr.mute = True
    rig.animation_data.action = None
for b in pb: b.rotation_quaternion = Quaternion(); b.location = Vector()

tmp = out + '.tmp.glb'
bpy.ops.export_scene.gltf(filepath=tmp, export_format='GLB', export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
                          export_skins=True, export_morph=True, export_morph_normal=True, export_yup=True, export_apply=False, export_def_bones=False)
os.replace(tmp, out)
print('wrote', out)

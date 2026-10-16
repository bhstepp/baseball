# cbuild.py - THE CAST GENERATOR: character spec (cspecs) -> head (species module, hkit) + body (cbody, ctail, cgear)
# on the shared skeleton (cskel) -> skinned meshes with face shape keys -> LOD0 / LOD1 glb with the contract's extras.
#   <bpy python> tools/blender/cast/cbuild.py p_ox c1-04 ...      build these characters (LODs: cspecs.default_lods)
#   <bpy python> tools/blender/cast/cbuild.py --park 1             a park's characters (--park 0 = extras: umpire,
#                                                                  Rocco's teammates, derby pitchers)
#   <bpy python> tools/blender/cast/cbuild.py --list               every character (park, species, role, LODs, status)
#   options: --lod 0,1 (override)  --no-cache  --out-dir assets/src  --report file.json
# Parallel-safe: several cbuild.py processes (different agents) may run at once - caches live per character and
# every file is written to a process-unique temp name, then renamed into place.
# Output: assets/src/char_<id>.glb (LOD0), assets/src/char_<id>_lod1.glb (LOD1); tools/pack-assets.js packs them.
# Build cache: dist/cast-cache/ (head and body cached separately, keyed by the spec section they use and the source
# of the modules they run; colours are applied at export, so recolouring never rebuilds geometry).
import os
import sys
import time
import json
import pickle
import hashlib
import argparse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cast_common as CC
import numpy as np
import rk_geo as G
import hkit as K
import cskel as SK
import cbody as CB
import cgear as GR
import ctail as CT
import cspecs as CS
import heads as HD

CACHE = os.path.join(CC.ROOT, 'dist', 'cast-cache')
LOD1_QUALITY = 0.24
BUDGET = {0: 18000, 1: 3500}
BOSS_BUDGET = 22000
FPS = 40
HEAD_LOCAL = ('jaw', 'cap', 'eye.L', 'brow.L', 'ear.L')


# ------------------------------------------------------------------------------------------- cache
def _src_hash(names):
    h = hashlib.sha1()
    for n in names:
        for path in sorted(_expand(n)):
            h.update(path.encode())
            h.update(open(path, 'rb').read())
    return h.hexdigest()[:16]


def _expand(n):
    if n.endswith('/'):
        d = os.path.join(HERE, n)
        return [os.path.join(d, f) for f in os.listdir(d) if f.endswith('.py')]
    p = os.path.join(HERE, n)
    return [p if os.path.exists(p) else os.path.join(CC.BLENDER_DIR, n)]


RK = ['rk_geo.py', 'rk_sdf.py', 'rk_mesh.py', 'rk_rig.py']
HEAD_KIT = RK + ['rk_head.py', 'rk_body.py', 'hkit.py', 'heads/__init__.py', 'cast_common.py']


def head_src(spec):
    """Sources a head depends on: the kit, every family module and the species' own module (another agent editing
    a different species never invalidates this cache)."""
    fams = sorted('heads/' + f for f in os.listdir(os.path.join(HERE, 'heads')) if f.startswith('fam_') and f.endswith('.py'))
    return HEAD_KIT + fams + ['heads/%s.py' % spec['species']]
BODY_SRC = RK + ['rk_body.py', 'rk_parts.py', 'cbody.py', 'cgear.py', 'ctail.py', 'cskel.py', 'cast_common.py']
HEAD_KEYS = ('species', 'family', 'seed', 'face', 'head', 'accessories', 'cap_back', 'cap_mats', 'cap_letter', 'boss', 'role')
BODY_KEYS = ('build', 'body', 'tail', 'hands', 'gear', 'seed', 'role', 'species')


def cached(kind, spec, lod, keys, srcs, fn, use_cache=True, extra=None):
    sub = {k: spec.get(k) for k in keys}
    sub['_lod'] = lod
    sub['_extra'] = extra
    key = hashlib.sha1((json.dumps(sub, sort_keys=True, default=str) + _src_hash(srcs)).encode()).hexdigest()[:20]
    d = os.path.join(CACHE, spec['id'])
    path = os.path.join(d, '%s_lod%d_%s.pkl' % (kind, lod, key))
    if use_cache and os.path.exists(path):
        try:
            return pickle.load(open(path, 'rb')), True
        except Exception:              # noqa: BLE001 - a stale / truncated cache entry: rebuild it
            pass
    res = fn()
    os.makedirs(d, exist_ok=True)
    tmp = '%s.%d.tmp' % (path, os.getpid())
    with open(tmp, 'wb') as fh:
        pickle.dump(res, fh)
    os.replace(tmp, path)
    return res, False


# ------------------------------------------------------------------------------------------- head
HeadResult = CC.HeadResult


def build_head(spec, lod):
    K.QUALITY, K.LOD = (1.0, 0) if lod == 0 else (LOD1_QUALITY, 1)
    try:
        ctx = K.Ctx(spec)
        return HeadResult(HD.build(ctx))
    finally:
        K.QUALITY, K.LOD = 1.0, 0


def place_head(parts, J, Kh):
    """Design space -> character: world = J['head'] + Kh * (p - HEAD_PIVOT)."""
    out = []
    for p in parts:
        q = p.copy()
        q.V = np.asarray(J['head'], float) + Kh * (q.V - K.HEAD_PIVOT)
        q.sk = {k: d * Kh for k, d in q.sk.items()}
        out.append(q)
    return out


# ------------------------------------------------------------------------------------------- body
BodyResult = CC.BodyResult


def build_body(spec, J, lod, head_world=None):
    bp = dict(spec['body'])
    f = CB.torso_sdf(J, bp)
    J = dict(J)
    CT.seat_root(J, f)
    parts, decals, f = CB.build_body(J, bp, tuple(spec['hands']), lod=lod, f=f)
    tail = spec.get('tail') or 'none'
    tm = bp.get('tail_mat', 'feather' if spec.get('family') == 'bird' else 'fur')
    parts += CT.tail_parts(J, tail, mat=tm, tip_mat=bp.get('tail_tip_mat'), lod=lod, size=bp.get('tail_size', 1.0),
                           rng=np.random.default_rng(spec['seed'] & 0xFFFFFFFF))
    gear = spec.get('gear') or []
    if 'catcher' in gear:
        parts.append(GR.chest_protector(J, f, mat='team_b', trim='accessory_b', lod=lod))
        parts += GR.shin_guards(J, mat='team_b', trim='accessory_b', lod=lod)
    if 'umpire' in gear:
        parts.append(GR.chest_protector(J, f, mat='accessory_b', trim='accessory_b', lod=lod, ump=True))
        parts.append(GR.bow_tie(J, mat='accessory_b', lod=lod))
        parts.append(GR.ball_bag(J, f, mat='accessory_b', lod=lod))
    if 'shell' in gear:
        parts.append(GR.shell_part(J, f, kind=bp.get('shell_kind', 'tortoise'), lod=lod))
    if 'keys' in gear:
        parts += GR.key_ring(J, f, mat=bp.get('keys_mat', 'accessory_b'), lod=lod)
    if bp.get('decals') is False:
        decals = []
    return BodyResult(parts, decals, {k: J[k] for k in CT.CHAIN})


# ------------------------------------------------------------------------------------------- LOD1 reduction
def decimate_part(p, ratio, min_tris=10):
    """Collapse-decimate a part without shape keys; materials and weights follow the nearest original face / vertex."""
    from mathutils.kdtree import KDTree
    n0 = p.tri_count()
    if ratio >= 0.98 or n0 <= min_tris * 2:
        return p
    ratio = max(ratio, min_tris / max(n0, 1))
    V2, F2 = G.decimate(p.V, p.F, ratio=ratio)
    if len(F2) < 4:
        return p
    C0 = np.array([p.V[f].mean(0) for f in p.F])
    kd = KDTree(len(C0))
    for i, c in enumerate(C0):
        kd.insert(tuple(c), i)
    kd.balance()
    mats = [p.mat[kd.find(tuple(np.asarray(V2)[f].mean(0)))[1]] for f in F2]
    kv = KDTree(len(p.V))
    for i, v in enumerate(p.V):
        kv.insert(tuple(v), i)
    kv.balance()
    idx = np.array([kv.find(tuple(v))[1] for v in V2])
    q = G.Part(V2, F2, mats, p.name)
    q.W = {b: w[idx] for b, w in p.W.items()}
    return q


LOD1_DROP = ('lathe', 'sweep', 'freckle', 'whisker', 'bar')      # spikes, laces, freckles, whiskers, mask bars (some)


def lod1_reduce(fixed, parts, budget):
    """Decimate the unkeyed parts so fixed + parts fit the LOD1 budget."""
    parts = [p for p in parts if not (p.name in LOD1_DROP and 'lace' in set(p.mat)) and p.name not in ('lathe', 'freckle')]
    nf = sum(p.tri_count() for p in fixed)
    for _ in range(6):
        cur = sum(p.tri_count() for p in parts)
        avail = budget * 0.97 - nf
        if cur <= avail:
            break
        big = [p for p in parts if p.tri_count() > 40]
        small = cur - sum(p.tri_count() for p in big)
        r = max((avail - small) / max(sum(p.tri_count() for p in big), 1), 0.05)
        parts = [decimate_part(p, r) if p in big else p for p in parts]
    return parts


def lod0_fit(fixed, parts, budget):
    """LOD0 over budget (gear-heavy characters): decimate the heaviest unkeyed pieces (cleats, hands, gear - never
    the jersey) just enough to fit."""
    nf = sum(p.tri_count() for p in fixed)
    for _ in range(4):
        cur = sum(p.tri_count() for p in parts)
        over = nf + cur - budget * 0.995
        if over <= 0:
            break
        heavy = [p for p in parts if p.tri_count() > 250 and p.name not in ('torso', 'crown', 'brim')]
        hv = sum(p.tri_count() for p in heavy)
        if hv <= 0:
            break
        r = max((hv - over) / hv, 0.4)
        parts = [decimate_part(p, r) if p in heavy else p for p in parts]
    return parts


# ------------------------------------------------------------------------------------------- assemble + export
def assemble(spec, lod, use_cache=True, log=print):
    t0 = time.time()
    head, hit_h = cached('head', spec, lod, HEAD_KEYS, head_src(spec), lambda: build_head(spec, lod), use_cache)
    t1 = time.time()
    build = dict(SK.DEFAULT_BUILD)
    build.update(spec['build'])
    tail = spec.get('tail') or 'none'
    build['tail'] = tuple(np.array(CT.LENGTHS.get(tail, CT.LENGTHS['none'])) * spec['body'].get('tail_len', 1.0))
    Kh = 1.08 * build.get('head', 1.0)
    hj = {n: Kh * (head.joints[n] - K.HEAD_PIVOT) for n in HEAD_LOCAL if n in head.joints}
    J = SK.joints_for(build, hj)
    body, hit_b = cached('body', spec, lod, BODY_KEYS, BODY_SRC, lambda: build_body(spec, J, lod), use_cache)
    J.update(body.tail)
    t2 = time.time()
    hparts = place_head(head.parts, J, Kh)
    pupils = place_head(head.pupils, J, Kh)
    letter = place_head([head.cap_letter], J, Kh) if head.cap_letter is not None else []
    keyed = [p for p in hparts if p.sk]
    unkeyed = [p for p in hparts if not p.sk]
    body_parts = list(body.parts) + unkeyed
    if 'catcher' in (spec.get('gear') or []):
        face_front = J['head'][1] + Kh * (head.face_y - K.HEAD_PIVOT[1])
        body_parts += GR.catcher_mask(None, J, face_front, Kh, lod=lod)
    nd = sum(p.tri_count() for p in list(body.decals) + letter)
    if lod > 0:
        body_parts = lod1_reduce(keyed + pupils, body_parts, BUDGET[1] - nd)
    else:
        budget = (BOSS_BUDGET if spec.get('boss') else BUDGET[0]) - nd
        body_parts = lod0_fit(keyed + pupils, body_parts, budget)
    log('  %s lod%d: head %s (%.1fs), body %s (%.1fs)' % (spec['id'], lod, 'cached' if hit_h else 'built', t1 - t0,
                                                       'cached' if hit_b else 'built', t2 - t1))
    return dict(J=J, head=keyed, body=body_parts, pupils=pupils, decals=list(body.decals) + letter, Kh=Kh, keys=head.keys)


def export_character(spec, lod, out, use_cache=True, log=print):
    A = assemble(spec, lod, use_cache, log)
    J = A['J']
    CC.reset_scene(FPS)
    mats = CC.make_materials(spec['colors'])
    rig = CC.build_armature(J, SK.CAST_BONES, spec['id'] + '_rig')
    names = SK.CAST_BONE_NAMES
    objs = {}
    pre = 'char_%s_' % spec['id']
    objs['body'] = CC.make_object(G.merge(A['body'], 'body'), pre + 'body', mats, rig, names)
    objs['head'] = CC.make_object(G.merge(A['head'], 'head'), pre + 'head', mats, rig, names, K.SHAPE_KEYS)
    objs['pupils'] = CC.make_object(G.merge(A['pupils'], 'pupils'), pre + 'pupils', mats, rig, names)
    if A['decals']:
        objs['decals'] = CC.make_object(G.merge(A['decals'], 'decals'), pre + 'decals', mats, rig, names, uv=True)
    tris = {k: CC.tri_count(o) for k, o in objs.items()}
    allv = np.concatenate([p.V for k in ('head', 'body', 'pupils') for p in A[k]])
    height = float(allv[:, 2].max())
    extras = dict(id=spec['id'], species=spec['species'], role=spec['role'], height=round(height, 3),
                  hipHeight=round(float(J['hips'][2]), 4), lod=lod, hand='R', number=int(spec.get('number') or 0),
                  name=spec.get('name', ''))
    CC.export_glb(out, extras)
    js, size = CC.read_glb_json(out)
    total = sum(tris.values())
    budget = BUDGET[lod] if not (lod == 0 and spec.get('boss')) else BOSS_BUDGET
    log('  -> %s  %.1f KB  tris %d %s%s  height %.2f hip %.2f' % (os.path.relpath(out, CC.ROOT), size / 1024, total,
                                                                  tris, '' if total <= budget else '  OVER BUDGET %d' % budget,
                                                                  height, J['hips'][2]))
    return dict(id=spec['id'], lod=lod, out=out, size=size, tris=total, parts=tris, height=height,
                hipHeight=float(J['hips'][2]), budget=budget)


def out_path(out_dir, cid, lod):
    return os.path.join(out_dir, 'char_%s%s.glb' % (cid, '' if lod == 0 else '_lod1'))


def write_report(path, rows):
    """Merge rows into a JSON report under an exclusive lock (parallel builds share one report file)."""
    import fcntl
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path + '.lock', 'w') as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        old = json.load(open(path)) if os.path.exists(path) else {}
        for r in rows:
            old['%s_lod%d' % (r['id'], r['lod'])] = {k: v for k, v in r.items() if k != 'out'}
        tmp = '%s.%d.tmp' % (path, os.getpid())
        json.dump(old, open(tmp, 'w'), indent=1, sort_keys=True)
        os.replace(tmp, path)
        fcntl.flock(lk, fcntl.LOCK_UN)


def list_characters(out_dir):
    import specs as SP
    S = CS.specs()
    print('%-14s %4s %-10s %-9s %-6s %-8s %s' % ('id', 'park', 'species', 'role', 'lods', 'family', 'files'))
    for cid in sorted(S, key=lambda k: (S[k].get('park', 0), k)):
        s = S[cid]
        lods = CS.default_lods(s)
        have = ['lod%d' % l for l in lods if os.path.exists(out_path(out_dir, cid, l))]
        print('%-14s %4s %-10s %-9s %-6s %-8s %s' % (cid, s.get('park'), s['species'], s['role'], ','.join(map(str, lods)),
                                                     s.get('family'), ' '.join(have) or '-'))
    for cid, sp in sorted(SP.PENDING.items()):
        print('%-14s pending: no heads/%s.py yet' % (cid, sp))
    for m, e in sorted(SP.ERRORS.items()):
        print('specs/%s.py FAILED: %s' % (m, e))


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument('ids', nargs='*')
    ap.add_argument('--park', type=int, action='append', default=[])
    ap.add_argument('--lod', default='')
    ap.add_argument('--no-cache', action='store_true')
    ap.add_argument('--out-dir', default=CC.ASSET_SRC)
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--report', default='')
    args = ap.parse_args(argv)
    if args.list:
        list_characters(args.out_dir)
        return
    ids = list(args.ids)
    for park in args.park:
        ids += [i for i in CS.park_ids(park) if i not in ids]
    if not ids:
        ap.error('no characters (give ids or --park N; --list shows them)')
    rep = []
    t0 = time.time()
    failed = []
    for cid in ids:
        spec = CS.get(cid)
        lods = [int(x) for x in args.lod.split(',')] if args.lod else list(CS.default_lods(spec))
        for lod in lods:
            try:
                rep.append(export_character(spec, lod, out_path(args.out_dir, cid, lod), not args.no_cache))
            except Exception as e:      # noqa: BLE001 - report, keep building the others
                import traceback
                traceback.print_exc()
                failed.append('%s lod%d: %s' % (cid, lod, e))
    print('built %d files in %.1fs' % (len(rep), time.time() - t0))
    if args.report and rep:
        write_report(args.report, rep)
    if failed:
        print('FAILED:\n  ' + '\n  '.join(failed))
        sys.exit(1)


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])

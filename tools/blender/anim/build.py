#!/usr/bin/env python3
# build.py - builds a shared animation library (docs/CAST-CONTRACT.md "Animation libraries"):
#   python3 tools/blender/anim/build.py pitcher|catcher|umpire|fielder [--ref assets/src/ref_body.glb]
#           [--clips a,b] [--out-glb path] [--out-json path] [--quiet]
# Writes assets/src/anim_<lib>.glb (reference skeleton + tiny preview mannequin + clips, 40 fps) and the sidecar
# assets/anim_<lib>.json (lengths, loops, markers, socket positions at the markers, face curves). Pure numpy (no
# Blender needed), deterministic; files are written to a temp name and renamed. A --clips subset goes to the scratch
# outputs given with --out-glb/--out-json (default: qa/anim/partial_<lib>.*) so the shipped library stays whole.
import os
import sys
import json
import time
import argparse
import importlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, HERE)

import numpy as np
import ak_skel
import ak_rig as AR
import ak_bake as AB
import ak_glb as AG
import ak_pose as PZ

LIBS = {'pitcher': 'lib_pitcher', 'catcher': 'lib_catcher', 'umpire': 'lib_umpire', 'fielder': 'lib_fielder'}


def rnd(v, n=4):
    if isinstance(v, dict):
        return {k: rnd(x, n) for k, x in v.items()}
    if isinstance(v, (list, tuple, np.ndarray)):
        return [rnd(x, n) for x in v]
    if isinstance(v, (float, np.floating)):
        return round(float(v), n)
    return v


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument('lib', choices=sorted(LIBS))
    ap.add_argument('--ref', default=os.path.join(ROOT, 'assets', 'src', 'ref_body.glb'))
    ap.add_argument('--clips', default='')
    ap.add_argument('--out-glb', default='')
    ap.add_argument('--out-json', default='')
    ap.add_argument('--quiet', action='store_true')
    a = ap.parse_args(argv)
    t0 = time.time()
    sk = ak_skel.from_glb(a.ref)
    PZ.setup(sk)
    mod = importlib.import_module(LIBS[a.lib])
    clips = mod.clips()
    if a.clips:
        keep = set(a.clips.split(','))
        clips = [c for c in clips if c.name in keep]
        if not clips:
            raise SystemExit('no clips match ' + a.clips)
    partial = bool(a.clips)
    out_glb = a.out_glb or (os.path.join(ROOT, 'qa', 'anim', 'partial_%s.glb' % a.lib) if partial else os.path.join(ROOT, 'assets', 'src', 'anim_%s.glb' % a.lib))
    out_json = a.out_json or (os.path.join(ROOT, 'qa', 'anim', 'partial_%s.json' % a.lib) if partial else os.path.join(ROOT, 'assets', 'anim_%s.json' % a.lib))
    solver = AR.Solver(sk)
    baked, problems = [], []
    for c in clips:
        r = AB.bake(c, sk, solver)
        baked.append(r)
        if r.warnings:
            worst = {}
            for tag, t, over in r.warnings:
                if over > worst.get(tag, (0, 0))[1]:
                    worst[tag] = (t, over)
            problems.append('%s: out of reach %s' % (c.name, ', '.join('%s %.3f ft @%.3f' % (k, v[1], v[0]) for k, v in sorted(worst.items()))))
        if r.violations:
            problems.append('%s: RULE VIOLATION (translation/scale off root/hips): %s' % (c.name, r.violations[:4]))
    side = {
        'lib': a.lib, 'version': 1, 'fps': AB.FPS,
        'refHipHeight': round(sk.hip_h, 4),
        'reference': os.path.relpath(a.ref, ROOT),
        'axes': 'glTF model space of the character: +X his left, +Y up, +Z forward (he faces +Z); feet; positions are '
                'relative to the root (on the ground between the feet at rest) for the reference build',
        'retarget': 'scale root/hips translation by hipHeight / refHipHeight; rotations apply as they are',
        'clips': {},
        'face': {},
    }
    for c, r in zip(clips, baked):
        e = {'length': round(c.length, 4), 'loop': c.loop, 'frames': c.frames()}
        if c.markers:
            e['markers'] = {k: round(v, 4) for k, v in c.markers.items()}
        e.update(c.meta)
        side['clips'][c.name] = e
        ft = AB.face_tracks(r)
        if ft:
            side['face'][c.name] = ft
    if hasattr(mod, 'sidecar'):
        mod.sidecar(side, baked, sk)
    forced = {c.name: [v for v in c.markers.values()] for c in clips}
    extras = {'lib': a.lib, 'refHipHeight': round(sk.hip_h, 4), 'fps': AB.FPS}
    os.makedirs(os.path.dirname(out_glb), exist_ok=True)
    st = AG.write_library(out_glb, sk, baked, a.lib, forced, extras)
    side['file'] = {'glb': os.path.relpath(out_glb, ROOT), 'bytes': st['bytes'], 'channels': st['channels'], 'keys': st['keys']}
    tmp = out_json + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(rnd(side), f, indent=1)
        f.write('\n')
    os.replace(tmp, out_json)
    for p in problems:
        print('!!', p)
    if not a.quiet and hasattr(mod, 'report'):
        mod.report(side)
    print('%s: %d clips, %d channels, %d keys (of %d samples), %.1f KB -> %s, %s  (%.1fs)' % (
        a.lib, len(clips), st['channels'], st['keys'], st['samples'], st['bytes'] / 1024, os.path.relpath(out_glb, ROOT),
        os.path.relpath(out_json, ROOT), time.time() - t0))


if __name__ == '__main__':
    main(sys.argv[1:])

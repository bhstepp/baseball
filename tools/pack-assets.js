#!/usr/bin/env node
// Asset packer: compresses character models with gltfpack (meshopt, docs/CAST-PLAN.md "Asset pipeline") and checks
// that nothing the game relies on was lost: bone names, material names, shape keys, clip names and timing, the swing
// contact frame (bat_sweet at t = 0.25 s), decal uvs, posed geometry.
//
//   node tools/pack-assets.js [name ...] [--adopt] [--force] [--no-verify] [--gltfpack=<cmd>]
//
// Layout
//   assets/src/<name>.glb   raw export from Blender (the source)       -> assets/<name>.glb (packed, shipped)
//   assets/<name>.glb raw, no assets/src/<name>.glb (a model exported in place, e.g. while the modeler iterates):
//                           packed into dist/packed/<name>.glb instead (build output; tools/build.js ships it in place
//                           of the raw file while the raw file is unchanged). --adopt moves the raw file to assets/src/
//                           first and packs into assets/ (the final layout).
//   tools/pack-assets.json  optional per-asset options, e.g. { "rocco": { "lod1": 0.3 } } also makes <name>.lod1.glb, a
//                           simplified level of detail (same rig and materials, no clips: the actor plays LOD0's clips)
// gltfpack: a local install (npm i gltfpack@0.24.0 in tools/ or the repo) or `npx -y gltfpack@0.24.0` (needs the npm
// registry once). Flags: -cc meshopt, -kn/-km/-ke keep names/materials/extras, -kv keep decal uvs (no texture uses
// them in the file), -vtf float uvs, -af 0 keep the exporter's keyframes exactly.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), cp = require('child_process'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..'), ASSETS = path.join(ROOT, 'assets'), SRC = path.join(ASSETS, 'src'), CACHE = path.join(ROOT, 'dist', 'packed');
const args = process.argv.slice(2), flag = f => args.includes(f), opt = k => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const ONLY = args.filter(a => !a.startsWith('--'));
const FLAGS = ['-cc', '-kn', '-km', '-ke', '-kv', '-vtf', '-af', '0'];
const VERSION = 'gltfpack@0.24.0';
const sha = b => crypto.createHash('sha1').update(b).digest('hex');
const kb = n => (n / 1024).toFixed(1) + ' KB';

// ---------------------------------------------------------------- glb container
function readGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546C67) throw new Error('not a glb');
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4), body = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4E4F534A) json = JSON.parse(body.toString('utf8').replace(/\0+$/, '').trim()); else if (type === 0x004E4942) bin = body;
    off += 8 + len;
  }
  return { json, bin };
}
function writeGlb(json, bin) {
  let js = Buffer.from(JSON.stringify(json), 'utf8'); const jp = (4 - js.length % 4) % 4; js = Buffer.concat([js, Buffer.alloc(jp, 0x20)]);
  const parts = [Buffer.alloc(12), Buffer.alloc(8), js];
  if (bin) { const bp = (4 - bin.length % 4) % 4; parts.push(Buffer.alloc(8), bin, Buffer.alloc(bp)); }
  const out = Buffer.concat(parts);
  out.writeUInt32LE(0x46546C67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(js.length, 12); out.writeUInt32LE(0x4E4F534A, 16);
  if (bin) { const o = 20 + js.length; out.writeUInt32LE(bin.length + (4 - bin.length % 4) % 4, o); out.writeUInt32LE(0x004E4942, o + 4); }
  return out;
}
const isPacked = buf => { try { const u = readGlb(buf).json.extensionsUsed || []; return u.includes('EXT_meshopt_compression') || u.includes('KHR_meshopt_compression'); } catch (e) { return false; } };

// ---------------------------------------------------------------- gltfpack
function gltfpack(input, output, extra) {
  const cmd = opt('gltfpack');
  const local = [path.join(__dirname, 'node_modules', '.bin', 'gltfpack'), path.join(ROOT, 'node_modules', '.bin', 'gltfpack')].find(f => fs.existsSync(f));
  const argv = ['-i', input, '-o', output].concat(FLAGS, extra || []);
  const r = cmd ? cp.spawnSync(cmd, argv, { encoding: 'utf8', shell: true })
    : local ? cp.spawnSync(local, argv, { encoding: 'utf8' })
      : cp.spawnSync('npx', ['-y', VERSION].concat(argv), { encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(output)) throw new Error('gltfpack failed: ' + ((r.stderr || '') + (r.stdout || '') || r.error || r.status));
  return (r.stdout || '') + (r.stderr || '');
}

// ---------------------------------------------------------------- three.js in node, for the checks
let THREE = null;
function three() {
  if (THREE) return THREE;
  global.self = global.self || global; global.window = global.window || global;
  THREE = require(path.join(ROOT, 'src', 'vendor', 'three.min.js'));
  new Function('THREE', fs.readFileSync(path.join(ROOT, 'src', 'vendor', 'three-addons.js'), 'utf8'))(THREE);
  return THREE;
}
function parse(buf) {
  const T = three(), ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return T.MeshoptDecoder.ready.then(() => new Promise((res, rej) => { const L = new T.GLTFLoader(); L.setMeshoptDecoder(T.MeshoptDecoder); L.parse(ab, '', res, rej); }));
}
const nameOf = o => (o.userData && o.userData.name) || o.name;
function rig(g) {
  const T = three(), bones = {}, meshes = [], acts = {};
  g.scene.traverse(o => { if (o.isBone) bones[nameOf(o)] = o; if (o.isMesh) meshes.push(o); });
  const mixer = new T.AnimationMixer(g.scene);
  g.animations.forEach(c => { const a = mixer.clipAction(c); a.play(); a.setEffectiveWeight(0); acts[c.name] = a; });
  return { g, bones, meshes, acts, mixer, clips: g.animations };
}
function pose(r, clip, t) {
  for (const n in r.acts) { const a = r.acts[n]; if (n === clip) { a.enabled = true; a.setEffectiveWeight(1); a.time = t; } else { a.enabled = false; a.setEffectiveWeight(0); } }
  r.mixer.update(0); r.g.scene.updateMatrixWorld(true);
}
function boxes(r, faces) {
  const T = three(), v = new T.Vector3(), o = {};
  r.meshes.forEach(m => {
    if (faces && m.morphTargetInfluences) for (const k in faces) { const i = m.morphTargetDictionary[k]; if (i != null) m.morphTargetInfluences[i] = faces[k]; }
    const P = m.geometry.attributes.position, b = o[m.material.name] || (o[m.material.name] = new T.Box3());
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      if (m.morphTargetInfluences && m.geometry.morphAttributes.position) { // morphs (relative, glTF) before skinning
        const MA = m.geometry.morphAttributes.position;
        for (let j = 0; j < MA.length; j++) { const w = m.morphTargetInfluences[j]; if (w) { v.x += MA[j].getX(i) * w; v.y += MA[j].getY(i) * w; v.z += MA[j].getZ(i) * w; } }
      }
      if (m.isSkinnedMesh) m.boneTransform(i, v);
      v.applyMatrix4(m.matrixWorld); b.expandByPoint(v);
    }
    if (faces && m.morphTargetInfluences) m.morphTargetInfluences.fill(0);
  });
  return o;
}
const uvRange = m => { const U = m && m.geometry.attributes.uv; if (!U) return null; const a = [1e9, 1e9, -1e9, -1e9]; for (let i = 0; i < U.count; i++) { a[0] = Math.min(a[0], U.getX(i)); a[1] = Math.min(a[1], U.getY(i)); a[2] = Math.max(a[2], U.getX(i)); a[3] = Math.max(a[3], U.getY(i)); } return a; };

// compares the packed model with its source; returns { ok, problems[], stats }
async function verify(rawBuf, outBuf, o) {
  const A = rig(await parse(rawBuf)), B = rig(await parse(outBuf)), T = three(), P = [], st = {};
  const bn = Object.keys(A.bones).sort(), bn2 = Object.keys(B.bones).sort();
  if (bn.join() !== bn2.join()) P.push('bone names differ: ' + bn.filter(b => !B.bones[b]).concat(bn2.filter(b => !A.bones[b])).join(', '));
  const mats = r => [...new Set(r.meshes.map(m => m.material.name))].sort().join();
  if (mats(A) !== mats(B)) P.push('material names differ: ' + mats(A) + ' vs ' + mats(B));
  const morphs = r => [...new Set([].concat(...r.meshes.filter(m => m.morphTargetDictionary).map(m => Object.keys(m.morphTargetDictionary))))].sort().join();
  if (morphs(A) !== morphs(B)) P.push('shape keys differ: ' + morphs(A) + ' vs ' + morphs(B));
  const tris = r => r.meshes.reduce((s, m) => s + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, 0);
  st.tris = tris(B); st.rawTris = tris(A); st.bones = bn2.length; st.materials = mats(B).split(',').length;
  if (o.lod) { // a level of detail: same rig and materials, fewer triangles, no clips
    st.ratio = +(st.tris / st.rawTris).toFixed(3);
    return { ok: !P.length, problems: P, stats: st };
  }
  const clips = r => r.clips.map(c => c.name + ':' + c.duration.toFixed(4)).sort().join(' ');
  if (clips(A) !== clips(B)) P.push('clips differ: ' + clips(A) + ' vs ' + clips(B));
  st.clips = B.clips.length;
  // poses at every source keyframe of every clip
  const pa = new T.Vector3(), pb = new T.Vector3();
  let worst = { e: 0 };
  for (const c of A.clips) {
    if (!B.acts[c.name]) continue;
    const times = new Set(); c.tracks.forEach(tr => tr.times.forEach(x => times.add(+x.toFixed(5))));
    for (const t of times) {
      pose(A, c.name, t); pose(B, c.name, t);
      for (const b of bn) { if (!B.bones[b]) continue; pa.setFromMatrixPosition(A.bones[b].matrixWorld); pb.setFromMatrixPosition(B.bones[b].matrixWorld); const e = pa.distanceTo(pb); if (e > worst.e) worst = { e, c: c.name, t, b }; }
    }
  }
  st.maxBoneErr = +worst.e.toFixed(5);
  if (worst.e > 0.01) P.push(`bone ${worst.b} moved ${worst.e.toFixed(4)} ft in ${worst.c} at ${worst.t}s`);
  // the contract's contact frame
  if (A.bones.bat_sweet && B.bones.bat_sweet) {
    st.contact = {};
    for (const c of ['swing_high', 'swing_mid', 'swing_low']) {
      if (!A.acts[c] || !B.acts[c]) continue;
      pose(A, c, 0.25); pose(B, c, 0.25);
      pa.setFromMatrixPosition(A.bones.bat_sweet.matrixWorld); pb.setFromMatrixPosition(B.bones.bat_sweet.matrixWorld);
      st.contact[c] = pb.toArray().map(x => +x.toFixed(4));
      if (pa.distanceTo(pb) > 0.005) P.push(`${c} contact point moved ${pa.distanceTo(pb).toFixed(4)} ft`);
    }
  }
  // posed geometry per material (vertex quantization), shape keys included
  let wb = { e: 0 };
  const shots = [['stance', 0, null], ['stance', 0, { blink: 1, grin: 1, brows_angry: 1, mouth_open: 1 }]];
  for (const c of A.clips) shots.push([c.name, c.duration * 0.5, null]);
  for (const [c, t, f] of shots) {
    if (!A.acts[c] || !B.acts[c]) continue;
    pose(A, c, t); pose(B, c, t);
    const ba = boxes(A, f), bb = boxes(B, f);
    for (const k in ba) { if (!bb[k]) continue; const e = Math.max(ba[k].min.distanceTo(bb[k].min), ba[k].max.distanceTo(bb[k].max)); if (e > wb.e) wb = { e, k, c, t: +t.toFixed(3) }; }
  }
  st.maxGeomErr = +wb.e.toFixed(5);
  if (wb.e > 0.01) P.push(`material ${wb.k} moved ${wb.e.toFixed(4)} ft in ${wb.c}`);
  // uvs (decals take a canvas texture at runtime)
  A.meshes.forEach(m => {
    if (!m.geometry.attributes.uv) return;
    const n = B.meshes.find(x => x.material.name === m.material.name && x.geometry.attributes.uv), ra = uvRange(m), rb = uvRange(n);
    if (!rb) P.push('uvs lost on ' + m.material.name);
    else if (ra.some((x, i) => Math.abs(x - rb[i]) > 2e-3)) P.push('uvs changed on ' + m.material.name + ': ' + ra.map(x => x.toFixed(3)) + ' vs ' + rb.map(x => x.toFixed(3)));
  });
  return { ok: !P.length, problems: P, stats: st };
}

// ---------------------------------------------------------------- jobs
function jobs() {
  const names = new Set();
  if (fs.existsSync(SRC)) fs.readdirSync(SRC).filter(f => /\.glb$/.test(f)).forEach(f => names.add(f.replace(/\.glb$/, '')));
  if (fs.existsSync(ASSETS)) fs.readdirSync(ASSETS).filter(f => /\.glb$/.test(f) && !/\.lod\d\.glb$/.test(f)).forEach(f => names.add(f.replace(/\.glb$/, '')));
  const cf = path.join(__dirname, 'pack-assets.json'), cfg = fs.existsSync(cf) ? JSON.parse(fs.readFileSync(cf, 'utf8')) : {};
  const out = [];
  [...names].sort().filter(n => !ONLY.length || ONLY.includes(n)).forEach(n => {
    let src = path.join(SRC, n + '.glb'), dir = ASSETS;
    if (!fs.existsSync(src)) {
      const inPlace = path.join(ASSETS, n + '.glb');
      if (!fs.existsSync(inPlace) || isPacked(fs.readFileSync(inPlace))) return;   // already packed, no source: nothing to do
      if (flag('--adopt')) { fs.mkdirSync(SRC, { recursive: true }); fs.copyFileSync(inPlace, src); console.log(`${n}: adopted assets/${n}.glb as assets/src/${n}.glb`); }
      else { src = inPlace; dir = CACHE; }
    }
    out.push({ name: n, src, dir, cfg: cfg[n] || {} });
  });
  return out;
}

async function packOne(j) {
  const raw = fs.readFileSync(j.src), rawSha = sha(raw);
  fs.mkdirSync(j.dir, { recursive: true });
  const target = path.join(j.dir, j.name + '.glb'), metaFile = path.join(j.dir === CACHE ? CACHE : SRC, j.name + '.pack.json');
  const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : null;
  const want = { source: rawSha, flags: FLAGS.join(' '), tool: VERSION, lod1: j.cfg.lod1 || null };
  const fresh = meta && fs.existsSync(target) && ['source', 'flags', 'tool', 'lod1'].every(k => JSON.stringify(meta[k]) === JSON.stringify(want[k])) && meta.output === sha(fs.readFileSync(target));
  if (fresh && !flag('--force')) { console.log(`${j.name}: up to date (${path.relative(ROOT, target)})`); return meta; }
  const tmp = target + '.tmp.glb';
  gltfpack(j.src, tmp);
  const out = fs.readFileSync(tmp);
  let check = { ok: true, problems: [], stats: {} };
  if (!flag('--no-verify')) check = await verify(raw, out, {});
  if (!check.ok) { fs.unlinkSync(tmp); throw new Error(j.name + ': packed model fails the checks:\n  ' + check.problems.join('\n  ')); }
  fs.renameSync(tmp, target);
  const res = Object.assign({}, want, { output: sha(out), bytes: out.length, gzip: zlib.gzipSync(out, { level: 9 }).length, rawBytes: raw.length, rawGzip: zlib.gzipSync(raw, { level: 9 }).length, stats: check.stats, at: new Date().toISOString() });
  // optional level of detail: simplified copy, clips stripped (the actor plays LOD0's)
  if (j.cfg.lod1) {
    const g = readGlb(raw); delete g.json.animations;
    const lin = target.replace(/\.glb$/, '.lod1.src.tmp.glb'), lout = path.join(j.dir, j.name + '.lod1.glb'), ltmp = lout + '.tmp.glb';
    fs.writeFileSync(lin, writeGlb(g.json, g.bin));
    try { gltfpack(lin, ltmp, ['-si', String(j.cfg.lod1)].concat(j.cfg.lod1Aggressive ? ['-sa'] : [])); } finally { fs.unlinkSync(lin); }
    const lb = fs.readFileSync(ltmp), lc = flag('--no-verify') ? { ok: true, problems: [], stats: {} } : await verify(raw, lb, { lod: true });
    if (!lc.ok) { fs.unlinkSync(ltmp); throw new Error(j.name + '.lod1 fails the checks:\n  ' + lc.problems.join('\n  ')); }
    fs.renameSync(ltmp, lout);
    res.lod1Out = { output: sha(lb), bytes: lb.length, gzip: zlib.gzipSync(lb, { level: 9 }).length, stats: lc.stats };
  }
  fs.mkdirSync(path.dirname(metaFile), { recursive: true });
  fs.writeFileSync(metaFile, JSON.stringify(res, null, 1) + '\n');
  const s = res.stats || {};
  console.log(`${j.name}: ${kb(res.rawBytes)} -> ${kb(res.bytes)} (gzip ${kb(res.rawGzip)} -> ${kb(res.gzip)}), ${s.tris} tris, ${s.bones} bones, ${s.clips} clips, ` +
    `max bone err ${s.maxBoneErr} ft, max geometry err ${s.maxGeomErr} ft${s.contact ? ', contact ' + JSON.stringify(s.contact) : ''} -> ${path.relative(ROOT, target)}` +
    (res.lod1Out ? `\n${j.name}.lod1: ${res.lod1Out.stats.tris} tris (${res.lod1Out.stats.ratio}), ${kb(res.lod1Out.bytes)} (gzip ${kb(res.lod1Out.gzip)})` : ''));
  return res;
}

if (require.main === module) (async () => {
  const list = jobs();
  if (!list.length) { console.log('pack-assets: nothing to pack'); return; }
  let failed = 0;
  for (const j of list) { try { await packOne(j); } catch (e) { failed++; console.error(String(e.message || e)); } }
  if (failed) process.exit(1);
})();
module.exports = { readGlb, writeGlb, isPacked };

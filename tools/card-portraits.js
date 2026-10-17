#!/usr/bin/env node
// Card portraits: renders every trading card player (BB.Meta.CARDS) and every pitcher (BB.Content.PITCHERS) from
// their 3D model through tools/cast-viewer.html (toon + ink outlines, team colours and decals, an idle pose from the
// shared clip libraries), head and shoulders on a transparent background, into sprite sheets that 38-cards.js draws
// in the card window and the briefing portrait:
//   assets/portraits_<sheet>.webp   one sheet per team (its 12 cards and its pitchers), plus 'x' for the derby pitchers
//   assets/portraits.json           { cell, sheets: { name: file }, map: { id: [sheet, col, row] } }
// Models: the shipped assets/char_<id>.glb (LOD0, else _lod1). Cards with no player in the game (P cards cN-01..03
// and the DH cN-12) are built portrait-only by the cast generator (tools/blender/cast/specs/cards.py, never shipped):
//   python3 tools/blender/cast/cbuild.py --park -2 --out-dir <dir>     (or list the ids)
//   node tools/card-portraits.js --extra <dir>                          (default dist/card-models)
//   node tools/card-portraits.js --only c1-01,p_ox --out qa/portraits   (preview a few, no index written to assets/)
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const EXTRA = path.resolve(opt('extra', path.join(ROOT, 'dist', 'card-models')));
const OUT = path.resolve(opt('out', path.join(ROOT, 'assets')));
const ONLY = (opt('only', '') || '').split(',').filter(Boolean);
const CELL = 320, COLS = 4, QUALITY = 0.86;
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--allow-file-access-from-files'];
const DATA = ['00-const.js', '20-content.js', '38-cards.js', '50-save.js', '55-meta.js'];

function modelFile(id) {
  for (const f of [path.join(ROOT, 'assets', `char_${id}.glb`), path.join(ROOT, 'assets', `char_${id}_lod1.glb`), path.join(EXTRA, `char_${id}.glb`)])
    if (fs.existsSync(f)) return f;
  return null;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await pw.chromium.launch({ args: GL_ARGS });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('file://' + path.join(ROOT, 'tools', 'cast-viewer.html'));
  for (const f of DATA) await page.addScriptTag({ path: path.join(ROOT, 'src', f) });
  // who to render, with the game's team colours (36-crew.js colorsOf: the team's ink-set slot, the other primary)
  const jobs = await page.evaluate(() => {
    const TEAMS = BB.Meta.TEAMS, out = [];
    const colors = (team) => {
      if (!team) return { team_a: '#2E5AAC', team_b: '#D9483B', cap: '#2E5AAC', cap_brim: '#2E5AAC', letter: 'B', letterColor: '#2E5AAC' };
      const sc = BB.CardArt.scheme(team.inkset || 'classic'), slot = team.colorSlot || 'a';
      let a = sc[slot] || sc.a; const b = sc[slot === 'a' ? 'b' : 'a'];
      const c = new THREE.Color(a);
      if (0.299 * c.r + 0.587 * c.g + 0.114 * c.b > 0.82) a = '#' + c.multiplyScalar(0.8).getHexString();
      return { team_a: a, team_b: b, cap: a, cap_brim: a, letter: team.short.charAt(0), letterColor: a };
    };
    BB.Meta.CARDS.forEach((c) => out.push({ id: c.id, sheet: String(c.teamIdx + 1), team: colors(TEAMS[c.teamIdx]),
      clip: c.pos === 'P' ? 'p_idle' : c.pos === 'C' ? 'c_stand' : 'f_idle', mirror: false, boss: false,
      hide: c.pos === 'C' ? ['accessory_a', 'accessory_b'] : [] }));   // the catcher's mask off for the photo
    BB.Content.PITCHERS.forEach((p) => {
      const ti = TEAMS.findIndex((t) => t.mascot === p.team);
      out.push({ id: p.id, sheet: ti >= 0 ? String(ti + 1) : 'x', team: colors(TEAMS[ti]), clip: 'p_idle', mirror: p.hand === 'L', boss: !!p.boss });
    });
    return out;
  });
  for (const lib of ['pitcher', 'catcher', 'fielder']) {
    const side = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', `anim_${lib}.json`), 'utf8'));
    const b64 = fs.readFileSync(path.join(ROOT, 'assets', `anim_${lib}.glb`)).toString('base64');
    await page.evaluate(async ([n, b, r]) => {
      const bin = atob(b), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return await window.cast.loadLib(n, u.buffer, r);
    }, [lib, b64, side.refHipHeight || 1.7]);
  }

  const todo = jobs.filter((j) => !ONLY.length || ONLY.includes(j.id));
  const missing = [], sheets = {};
  for (const j of todo) {
    const f = modelFile(j.id);
    if (!f) { missing.push(j.id); continue; }
    const b64 = fs.readFileSync(f).toString('base64');
    await page.evaluate(async ([k, b, t]) => {
      const bin = atob(b), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      await window.cast.load(k, u.buffer, t);
    }, [j.id, b64, j.team]);
    // pose once to find the face, then frame head and shoulders round it (cartoon heads: about half the bust)
    const actor = { id: j.id, clip: j.clip, t: 0, mirror: j.mirror, hide: j.hide || [], sk: j.boss ? { brows_angry: 0.55, smirk: 0.5 } : { smile: 0.25, smirk: 0.35 } };
    await page.evaluate(([a]) => window.cast.sheet({ cols: 1, cellW: 8, cellH: 8, studio: false, cells: [{ actors: [a] }] }), [actor]);
    const fr = await page.evaluate((id) => {
      const L = window.cast.bone(id, 'eye.L'), R = window.cast.bone(id, 'eye.R'), H = window.cast.bone(id, 'hips') || [0, 0, 1.7];
      return { eye: L && R ? L.map((v, i) => (v + R[i]) / 2) : window.cast.bone(id, 'head'), hips: H };
    }, j.id);
    const s = fr.eye[2] - fr.hips[2];
    const bot = fr.hips[2] + 0.42 * s, top = fr.eye[2] + 0.7 * s, half = (top - bot) / 2;
    const fov = 18, dist = half / Math.tan(fov / 2 * Math.PI / 180);
    const az = (j.mirror ? 1 : -1) * 24 * Math.PI / 180, el = 5 * Math.PI / 180;
    // characters face -y (toward the camera at az 0); a quarter turn shows the cap's side and the team letter
    const look = [fr.eye[0] * 0.6, fr.eye[1] * 0.6, (top + bot) / 2];
    const cam = [look[0] + Math.sin(az) * Math.cos(el) * dist, look[1] - Math.cos(az) * Math.cos(el) * dist, look[2] + Math.sin(el) * dist];
    (sheets[j.sheet] = sheets[j.sheet] || []).push({ id: j.id, cell: { view: { cam, look, fov }, actors: [actor] } });
    console.log(j.id, path.relative(ROOT, f));
  }

  const index = { cell: CELL, sheets: {}, map: {} };
  for (const name of Object.keys(sheets).sort()) {
    const list = sheets[name];
    const url = await page.evaluate(([cells, cw, cols, q]) => {
      window.cast.sheet({ cols, cellW: cw, cellH: cw, studio: false, transparent: true, cells });
      return document.getElementById('c').toDataURL('image/webp', q);
    }, [list.map((l) => l.cell), CELL, COLS, QUALITY]);
    const file = `portraits_${name}.webp`, buf = Buffer.from(url.split(',')[1], 'base64');
    fs.writeFileSync(path.join(OUT, file), buf);
    index.sheets[name] = file;
    list.forEach((l, i) => { index.map[l.id] = [name, i % COLS, Math.floor(i / COLS)]; });
    console.log(`wrote ${path.relative(ROOT, path.join(OUT, file))} ${list.length} portraits ${(buf.length / 1024).toFixed(1)} KB`);
  }
  if (!ONLY.length) fs.writeFileSync(path.join(OUT, 'portraits.json'), JSON.stringify(index) + '\n');
  if (missing.length) console.log('no model (2D card art stays): ' + missing.join(' '));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

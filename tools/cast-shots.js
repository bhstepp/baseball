#!/usr/bin/env node
// Cast QA sheets: renders the cast generator's characters (assets/src/char_<id>.glb, raw; packed files load too)
// through tools/cast-viewer.html (toon + outlines, team colours, the shared clip libraries retargeted per character).
//   node tools/cast-shots.js --park 1                 every sheet for park 1 (turnarounds, faces, lineups, game views)
//   node tools/cast-shots.js p_ox c1-04 --only turn,face
//   node tools/cast-shots.js --dir <glb dir> --out <dir>
// Sheets (qa/cast/, gitignored): turn-<id>.png, face-<id>.png, lod-<id>.png, lineup-*.png, game-bat-*.png,
// game-field.png, plus info.json (per-character triangles, materials, morphs, extras).
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const DIR = path.resolve(opt('dir', path.join(ROOT, 'assets', 'src')));
const OUT = path.resolve(opt('out', path.join(ROOT, 'qa', 'cast')));
const ONLY = (opt('only', '') || '').split(',').filter(Boolean);
const PARK = +opt('park', 0);
const LINEUP = (opt('lineup', '') || '').split(',').filter(Boolean);       // ad-hoc lineup of LOD0 files, e.g. --lineup p_ox,c1-04
const skipNext = new Set(['--dir', '--out', '--only', '--park', '--lineup']);
const IDS = args.filter((a, i) => !a.startsWith('--') && !skipNext.has(args[i - 1]));
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--allow-file-access-from-files'];
const PI = Math.PI;
const SHAPES = ['blink', 'smile', 'grin', 'frown', 'mouth_open', 'brows_up', 'brows_angry', 'brows_sad', 'squint', 'cheeks_puff', 'smirk'];
const PARK1 = {
  pitchers: ['p_hank', 'p_dottie', 'p_clem', 'p_ox'],
  catcher: 'c1-04', ump: 'ump',
  fielders: { '1B': 'c1-05', '2B': 'c1-06', SS: 'c1-07', '3B': 'c1-08', LF: 'c1-09', CF: 'c1-10', RF: 'c1-11' },
  mates: ['mate_otter', 'mate_fox', 'mate_beaver'],
  team: { team_a: '#2E5AAC', team_b: '#D9483B', cap: '#2E5AAC', cap_brim: '#2E5AAC', letter: 'H', letterColor: '#2E5AAC' },
};
const FIELD_POS = { C: [0, -4], '1B': [66, 86], '2B': [34, 142], SS: [-34, 142], '3B': [-64, 86], LF: [-150, 252], CF: [0, 312], RF: [150, 252] };
const ROCCO_TEAM = { team_a: '#2E5AAC', team_b: '#D9483B', cap: '#2E5AAC', cap_brim: '#2E5AAC', letter: 'R', letterColor: '#2E5AAC' };
const want = (name) => !ONLY.length || ONLY.some((w) => name.startsWith(w));
const faceYaw = (x, y) => Math.atan2(-x, y);          // yaw that turns a character at (x, y) to face home plate

function file(id, lod) { return path.join(DIR, `char_${id}${lod ? '_lod1' : ''}.glb`); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await pw.chromium.launch({ args: GL_ARGS });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('file://' + path.join(ROOT, 'tools', 'cast-viewer.html'));
  const load = async (key, f, team) => {
    if (!fs.existsSync(f)) return null;
    const b64 = fs.readFileSync(f).toString('base64');
    const info = await page.evaluate(async ([k, b, t]) => {
      const bin = atob(b), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return await window.cast.load(k, u.buffer, t);
    }, [key, b64, team || null]);
    info.size = fs.statSync(f).size;
    return info;
  };
  // the shared clip libraries (if the animation agent has built them) and Rocco for scale
  for (const lib of ['pitcher', 'catcher', 'umpire', 'fielder']) {
    const f = path.join(ROOT, 'assets', 'src', `anim_${lib}.glb`);
    if (!fs.existsSync(f)) continue;
    const side = path.join(ROOT, 'assets', `anim_${lib}.json`);
    const refHip = fs.existsSync(side) ? (JSON.parse(fs.readFileSync(side, 'utf8')).refHipHeight || 1.7) : 1.7;
    const b64 = fs.readFileSync(f).toString('base64');
    const clips = await page.evaluate(async ([n, b, r]) => {
      const bin = atob(b), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return await window.cast.loadLib(n, u.buffer, r);
    }, [lib, b64, refHip]);
    console.log('library', lib, clips.map((c) => c[0]).join(' '));
  }
  const rocco = await load('rocco', path.join(ROOT, 'assets', 'src', 'rocco.glb'), ROCCO_TEAM);

  let ids = IDS.slice().concat(LINEUP.map((k) => k.split('@')[0]));
  if (PARK === 1) ids = ids.concat(PARK1.pitchers, [PARK1.catcher, PARK1.ump], Object.values(PARK1.fielders), PARK1.mates);
  ids = [...new Set(ids)];
  const info = {};
  for (const id of ids) {
    const team = id === 'ump' ? null : id.startsWith('mate_') ? ROCCO_TEAM : PARK1.team;
    const i0 = await load(id, file(id, 0), team), i1 = await load(id + '@1', file(id, 1), team);
    info[id] = { lod0: i0, lod1: i1 };
    console.log(id, i0 ? `LOD0 ${i0.tris} tris ${(i0.size / 1024).toFixed(1)} KB` : '', i1 ? `LOD1 ${i1.tris} tris ${(i1.size / 1024).toFixed(1)} KB` : '');
  }
  const shot = async (name, spec) => {
    if (!want(name)) return;
    await page.evaluate((s) => window.cast.sheet(s), spec);
    const el = await page.$('#wrap');
    await el.screenshot({ path: path.join(OUT, name + '.png') });
    console.log('wrote', path.join(OUT, name + '.png'));
  };
  const H = (id) => { const x = info[id.split('@')[0]]; const e = (x.lod0 || x.lod1).extras; return e.height || 5; };

  // ---- per character: turnaround, face sheet, LOD comparison
  for (const id of ids) {
    const lod0 = !!info[id].lod0, key = lod0 ? id : id + '@1';
    if (!info[id].lod0 && !info[id].lod1) continue;
    const h = H(id), tgt = [0, 0, h * 0.5];
    const views = [['front', 0, 5], ['q34', 35, 8], ['side', 90, 4], ['back', 180, 8], ['r34', -35, 8]];
    await shot('turn-' + id, { cols: 5, cellW: 300, cellH: 460, cells: views.map(([l, az, el]) => ({ label: `${id} ${l}`, view: { az, el, dist: h * 3.3, target: tgt, fov: 26 }, actors: [{ id: key }] })) });
    if (lod0) {
      const fv = (az, el) => ({ az, el, dist: 6.4, fov: 24, targetActor: { id, bone: 'eyes', off: [0, 0, 0.12] } });
      const cells = [{ label: 'neutral' }].concat(SHAPES.map((k) => ({ label: k, sk: { [k]: 1 } })));
      await shot('face-' + id, { cols: 12, cellW: 220, cellH: 240, cells: cells.map((c) => ({ label: c.label, view: fv(0, 4), actors: [{ id, sk: c.sk }] })).concat(cells.map((c) => ({ label: c.label + ' r34', view: fv(-38, 8), actors: [{ id, sk: c.sk }] }))) });
    }
    if (info[id].lod0 && info[id].lod1) {
      const pair = (dist, el, az) => [{ id, x: -1.6 }, { id: id + '@1', x: 1.6 }].map((a) => a);
      await shot('lod-' + id, { cols: 3, cellW: 420, cellH: 420, cells: [
        { label: 'LOD0 | LOD1', view: { az: 20, el: 8, dist: h * 3.6, target: [0, 0, h * 0.5], fov: 26 }, actors: pair() },
        { label: 'heads', view: { az: 20, el: 6, dist: h * 1.7, target: [0, 0, h * 0.8], fov: 26 }, actors: pair() },
        { label: 'far (60 ft)', view: { az: 20, el: 6, dist: 60, target: [0, 0, h * 0.5], fov: 26 }, actors: pair() },
      ] });
    }
  }

  // ---- lineups (same scale, front view on a long lens, names below)
  const lineup = async (name, keys, label) => {
    keys = keys.filter((k) => k === 'rocco' ? rocco : info[k.split('@')[0]] && info[k.split('@')[0]][k.includes('@') ? 'lod1' : 'lod0']);
    if (!keys.length) return;
    const step = 3.4, w = (keys.length - 1) * step;
    const actors = keys.map((k, i) => ({ id: k, x: -w / 2 + i * step, name: k.replace('@1', '') }));
    const cw = Math.max(900, keys.length * 175), ch = 600, dist = 150;
    // fit the row: horizontal half-angle covers the row + a margin, vertical fov follows the cell aspect
    const hh = Math.atan((w / 2 + 2.4) / dist), vfov = 2 * Math.atan(Math.tan(hh) / (cw / ch)) * 180 / Math.PI;
    await shot(name, { cols: 1, cellW: cw, cellH: ch, cells: [{ label, view: { az: 0, el: 2, dist, target: [0, 0, 3.0], fov: Math.max(vfov, 2.9) }, actors }] });
  };
  if (LINEUP.length) {
    await lineup('lineup-adhoc', ['rocco'].concat(LINEUP), 'lineup');
    const keys = LINEUP.filter((k) => info[k.split('@')[0]]);
    const step = 3.1, w = (keys.length - 1) * step;
    await shot('lineup-adhoc-34', { cols: 1, cellW: Math.max(900, keys.length * 190), cellH: 620, cells: [{ label: 'q34', view: { az: 30, el: 6, dist: 120, target: [0, 0, 3.0], fov: 3.6 * Math.max(1, keys.length / 4.2) }, actors: keys.map((k, i) => ({ id: k, x: -w / 2 + i * step, yaw: 0 })) }] });
  }
  if (PARK === 1 || (IDS.length && !LINEUP.length)) {
    const has = (k) => info[k] && info[k].lod0;
    await lineup('lineup-park1-close', ['rocco'].concat(PARK1.pitchers, [PARK1.catcher, PARK1.ump]).filter((k) => k === 'rocco' || has(k)), 'Park 1 close-up cast (LOD0): Rocco for scale, the Hayseeds pitchers, catcher, umpire');
    await lineup('lineup-park1-team', ['rocco'].concat(PARK1.pitchers.map((k) => k + '@1'), [PARK1.catcher + '@1'], Object.values(PARK1.fielders).map((k) => k + '@1')),
      'Haybale Junction Hayseeds (LOD1): pitchers, catcher, 1B 2B SS 3B LF CF RF');
    await lineup('lineup-runners', ['rocco'].concat(PARK1.mates.map((k) => k + '@1'), ['ump@1']), "Rocco's teammates (LOD1) and the umpire (LOD1)");
    // ---- the bat camera (390 x 844): each pitcher on the mound, the catcher and umpire behind the plate, Rocco at bat
    // behind the plate as the game stages it (35-scene.js CATCHER / UMP spots): the catcher a step back, the umpire
    // over his first-base-side shoulder
    const cat = has(PARK1.catcher) ? [{ id: PARK1.catcher, x: 0.6, y: -4.3, yaw: PI, clip: 'c_crouch', t: 0 }] : [];
    const ump = has(PARK1.ump) ? [{ id: PARK1.ump, x: 2.1, y: -5.6, yaw: PI, clip: 'u_stance', t: 0 }] : [];
    const hero = rocco ? [{ id: 'rocco', x: -2.35, y: 0.9, yaw: PI / 2, clip: 'stance', t: 0 }] : [];
    const cells = PARK1.pitchers.filter(has).map((p) => ({ label: p, field: true, view: { game: 'bat' }, actors: [{ id: p, x: 0, y: 60.5, z: 0.83, clip: 'p_idle', t: 0, scale: 1.08 }].concat(cat, ump, hero) }));
    if (cells.length) {
      cells.push({ label: 'p_ox: set', field: true, view: { game: 'bat' }, actors: [{ id: 'p_ox', x: 0, y: 60.5, z: 0.83, clip: 'p_set', t: 0.7, scale: 1.08 }].concat(cat, ump, hero) });
      await shot('game-bat', { cols: cells.length, cellW: 390, cellH: 844, cells });
      // pitcher close-ups as the bat camera frames them (crop round the mound)
      await shot('game-bat-pitchers', { cols: 4, cellW: 360, cellH: 420, cells: PARK1.pitchers.filter(has).map((p) => ({ label: p + ' from the plate', field: true, view: { cam: [-0.6, -28, 9.6], look: [0, 60.5, 3.6], fov: 7.5 }, actors: [{ id: p, x: 0, y: 60.5, z: 0.83, clip: 'p_windup_classic', t: 0.54, scale: 1.08 }] })) });
      if (has(PARK1.catcher) || has(PARK1.ump)) {
        await shot('game-plate', { cols: 3, cellW: 420, cellH: 420, cells: [
          { label: 'catcher + umpire (bat camera side)', field: true, view: { cam: [-0.6, -24, 7.5], look: [0.4, -4, 2.0], fov: 22 }, actors: cat.concat(ump) },
          { label: 'from the mound', field: true, view: { cam: [0, 45, 6], look: [0.4, -4.5, 2.0], fov: 14 }, actors: cat.concat(ump) },
          { label: 'side', field: true, view: { cam: [14, -5, 4], look: [0.6, -4.8, 2.0], fov: 26 }, actors: cat.concat(ump) },
        ] });
      }
    }
    // ---- the field: LOD1 fielders at their spots facing the plate
    const fa = [];
    for (const pos in PARK1.fielders) {
      const id = PARK1.fielders[pos]; if (!info[id] || !info[id].lod1) continue;
      const [x, y] = FIELD_POS[pos];
      fa.push({ id: id + '@1', x, y, yaw: faceYaw(x, y), clip: 'f_ready', t: 0 });
    }
    if (info[PARK1.catcher] && info[PARK1.catcher].lod1) fa.push({ id: PARK1.catcher + '@1', x: 0.25, y: -3.9, yaw: PI, clip: 'c_crouch', t: 0 });
    PARK1.pitchers.slice(3).forEach((p) => { if (info[p] && info[p].lod1) fa.push({ id: p + '@1', x: 0, y: 60.5, z: 0.83, yaw: 0, clip: 'p_idle', t: 0 }); });
    if (fa.length) {
      await shot('game-field', { cols: 2, cellW: 700, cellH: 520, cells: [
        { label: 'field view (LOD1 fielders)', field: true, view: { cam: [0, -70, 75], look: [0, 150, 0], fov: 46 }, actors: fa },
        { label: 'infield from behind the plate', field: true, view: { cam: [0, -40, 22], look: [0, 100, 0], fov: 36 }, actors: fa },
        { label: 'middle infield (2B, SS) from the mound', field: true, view: { cam: [0, 66, 9], look: [0, 142, 3], fov: 34 }, actors: fa },
        { label: 'outfield (LF, CF, RF) from second base', field: true, view: { cam: [0, 150, 14], look: [0, 290, 3], fov: 48 }, actors: fa },
      ] });
    }
  }
  fs.writeFileSync(path.join(OUT, 'info.json'), JSON.stringify(info, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

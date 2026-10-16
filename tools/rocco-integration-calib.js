#!/usr/bin/env node
// Bat-camera calibration for the Rocco pilot (integration agent).
// 1. Loads tools/render-harness.html, poses the bat scene through every state Rocco goes through (stance, windup,
//    stride, power load, swings high/mid/low, follow-through, whiff, dizzy, take, called K) and collects posed
//    world-space points of the model Rocco (CPU skinning), the procedural Rocco, the catcher and the pitcher.
// 2. Projects them through the bat camera BB.Render uses (layoutBat) at 320x568, 390x844 and 430x932 and reports
//    screen extents: Rocco incl. cleats, zone box, pitcher, catcher, the HUD band.
//   node tools/rocco-integration-calib.js [--glb=<file>] [--json=<out>]     (needs Chromium via playwright)
let pw; try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const ARG = k => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--allow-file-access-from-files'];
const STATES = [
  'scene=bat&state=idle&time=3.3', 'scene=bat&state=idle&time=4.1', 'scene=bat&state=idle&time=5.0', 'scene=bat&state=windup&w=0.7',
  'scene=bat&state=stride&pt=0.3&pz=2.5', 'scene=bat&state=loading&l=1', 'scene=bat&state=loading&l=0.5',
  'scene=bat&state=swing&st=0.035&pz=2.5', 'scene=bat&state=contact&st=0.07&pz=3.3', 'scene=bat&state=contact&st=0.07&pz=2.5', 'scene=bat&state=contact&st=0.07&pz=1.7',
  'scene=bat&state=contact&st=0.12&pz=2.5', 'scene=bat&state=contact&st=0.22&pz=2.5', 'scene=bat&state=whiff&st=0.2', 'scene=bat&state=whiff&st=0.45',
  'scene=bat&state=whiff&st=0.8', 'scene=bat&state=whiff&st=1.6', 'scene=bat&state=mitt&dt=0.4&strike=0', 'scene=bat&state=called&dt=1.0&strike=1&stamp=K&kind=bad',
  'scene=bat&state=called&dt=1.5&strike=1&stamp=K&kind=bad',
];
const SIZES = [[320, 568], [390, 844], [430, 932]];

(async () => {
  const browser = await pw.chromium.launch({ args: GL_ARGS });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const extra = (ARG('glb') ? '&glb=' + encodeURIComponent(path.resolve(ARG('glb'))) : '') + (ARG('q') ? '&' + ARG('q') : '');
  await page.goto('file://' + path.join(ROOT, 'tools', 'render-harness.html') + '?scene=bat&state=idle' + extra);
  await page.waitForFunction(() => window.__done === true, null, { timeout: 60000 });
  const data = await page.evaluate((STATES) => {
    const S = BB.Render._S, T = THREE, out = { model: [], proc: [], catcher: [], pitcher: [], glb: !!(BB.Rocco && BB.Rocco.ready()) };
    const v = new T.Vector3(), inv = new T.Matrix4();
    function meshPts(root, step, rel) {
      const pts = [];
      root.updateMatrixWorld(true);
      if (rel) inv.copy(root.matrixWorld).invert();
      root.traverse(o => {
        if (!o.isMesh || !o.visible || (o.userData && o.userData.isOutline) || o.material === BB.Toon.OUTLINE || (o.material && o.material.transparent)) return;
        let p = o.parent, vis = true; while (p) { if (!p.visible) vis = false; p = p.parent; }
        if (!vis) return;
        const P = o.geometry.attributes.position;
        for (let i = 0; i < P.count; i += step) {
          v.fromBufferAttribute(P, i);
          if (o.isSkinnedMesh) o.boneTransform(i, v);
          v.applyMatrix4(o.matrixWorld);
          if (rel) v.applyMatrix4(inv);
          pts.push([+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)]);
        }
      });
      return pts;
    }
    STATES.forEach(q => {
      window.setup('?' + q);
      if (out.glb) out.model.push({ q, pts: meshPts(BB.Rocco.root(), 3) });
      out.catcher.push({ q, pts: meshPts(S.catcher.root, 4, true), at: S.catcher.root.position.toArray(), size: S.catcher.o.size });
      out.pitcher.push({ q, pts: meshPts(S.pitcher.root, 6, true), at: S.pitcher.root.position.toArray(), size: S.pitcher.o.size });
    });
    // the procedural Rocco on the same states (BB.Render falls back to it when the model is missing)
    if (out.glb) { BB.Rocco.R.status = 'off'; S.hero = null; }
    STATES.forEach(q => { window.setup('?' + q); out.proc.push({ q, pts: meshPts(S.rocco.root, 3) }); });
    out.hero = S.hero; out.info = BB.Rocco && BB.Rocco.info ? BB.Rocco.info() : null;
    return out;
  }, STATES);
  await browser.close();
  if (errors.length) console.log('page errors:', errors);
  const file = ARG('json') || path.join(ROOT, 'qa', 'pilot', 'calib-points.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
  console.log('points:', file, 'model states', data.model.length, 'glb', data.glb);
  if (data.info) console.log('model:', JSON.stringify({ contact: data.info.contact, restHeight: data.info.restHeight, warnings: data.info.warnings }));
})().catch(e => { console.error(e); process.exit(1); });

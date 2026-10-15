#!/usr/bin/env node
// Renders the app icons with the real 3D cast (BB.Cast via tools/render-harness.html): Rocco the raccoon's head in
// his cap, grinning on a mustard sunburst. Full-bleed opaque square (iOS rounds the corners itself).
//   node tools/make-icons.js   -> icons/icon-180.png, icon-192.png, icon-512.png
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');

(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
  const page = await (await browser.newContext({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + path.join(ROOT, 'tools', 'render-harness.html') + '?scene=title');
  await page.waitForFunction(() => window.__done === true, null, { timeout: 60000 });
  fs.mkdirSync(path.join(ROOT, 'icons'), { recursive: true });
  for (const size of [180, 192, 512]) {
    const url = await page.evaluate((N) => {
      const T = THREE, S = 2; // supersample
      const W = N * S;
      // ---- background: sunburst
      const out = document.createElement('canvas'); out.width = W; out.height = W;
      const x = out.getContext('2d');
      x.fillStyle = '#F2B632'; x.fillRect(0, 0, W, W);
      const cx = W / 2, cy = W * 0.56, rays = 18;
      for (let i = 0; i < rays; i++) {
        const a0 = i / rays * Math.PI * 2, a1 = (i + 0.5) / rays * Math.PI * 2;
        x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, W * 1.2, a0, a1); x.closePath();
        x.fillStyle = '#FFC94D'; x.fill();
      }
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, W * 0.42);
      g.addColorStop(0, 'rgba(255,244,220,0.95)'); g.addColorStop(0.55, 'rgba(255,244,220,0.55)'); g.addColorStop(1, 'rgba(255,244,220,0)');
      x.fillStyle = g; x.fillRect(0, 0, W, W);
      // ---- Rocco's head, rendered in 3D
      const cv = document.createElement('canvas'); cv.width = W; cv.height = W;
      const r = new T.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true });
      r.setPixelRatio(1); r.setSize(W, W, false); r.setClearColor(0x000000, 0);
      BB.Toon.OU.uRes.value.set(W / 3.2, W / 3.2);
      const sc = new T.Scene();
      sc.add(new T.AmbientLight(0xffffff, 0.55));
      const dl = new T.DirectionalLight(0xfff0d8, 0.6); dl.position.set(-0.5, -1, 0.9); sc.add(dl);
      const a = '#2B6CB0';
      const ch = BB.Cast.make({ species: 'raccoon', size: 1, shirt: '#FFF9EE', pants: '#FFF9EE', trim: a, cap: a, brim: '#22558C', socks: a, letter: 'R', numColor: a, numEdge: '#1B1420', capPatch: '#FFF9EE' });
      BB.Cast.apply(ch, { hy: 0.32, hx: -0.06, hz: 0.06, smile: 1.4, brow: -0.2, browY: 0.5, lx: -0.25, ly: 0.15, mouth: 0.9 });
      ch.root.rotation.z = 0;
      sc.add(ch.root);
      ch.root.updateMatrixWorld(true);
      const hp = new T.Vector3(); ch.headC.getWorldPosition(hp);
      const cam = new T.PerspectiveCamera(26, 1, 0.5, 100); cam.up.set(0, 0, 1);
      cam.position.set(hp.x + 1.2, hp.y - 6.0, hp.z + 0.6); cam.lookAt(hp.x + 0.04, hp.y, hp.z - 0.12);
      r.render(sc, cam);
      x.drawImage(cv, 0, 0);
      r.dispose();
      // ---- ink frame + scale down
      const o = document.createElement('canvas'); o.width = N; o.height = N;
      const ox = o.getContext('2d'); ox.imageSmoothingQuality = 'high';
      ox.drawImage(out, 0, 0, N, N);
      return o.toDataURL('image/png');
    }, size);
    fs.writeFileSync(path.join(ROOT, 'icons', `icon-${size}.png`), Buffer.from(url.split(',')[1], 'base64'));
    console.log('wrote icons/icon-' + size + '.png');
  }
  await browser.close();
  if (errors.length) { console.error(errors); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });

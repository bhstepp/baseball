#!/usr/bin/env node
// Renders the app icons with the real riso engine (BB.Riso via tools/render-harness.html):
// a halftone baseball moon on a dusk sky, pink seams knocked slightly off register, "HH" stamped in the corner.
// Full-bleed square, no transparency (iOS rounds the corners itself).
//   node tools/make-icons.js   -> icons/icon-180.png, icon-192.png, icon-512.png
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');

(async () => {
  const browser = await pw.chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + path.join(ROOT, 'tools', 'render-harness.html') + '?scene=title');
  await page.waitForFunction(() => window.__done === true, null, { timeout: 15000 });
  fs.mkdirSync(path.join(ROOT, 'icons'), { recursive: true });
  for (const size of [180, 192, 512]) {
    const url = await page.evaluate((N) => {
      const R = BB.Riso, U = BB.U, TAU = Math.PI * 2;
      const P = R.press({ w: N, h: N, dpr: 1, margin: 0, inks: 'classic', cell: Math.max(3, N / 64) });
      const u = N / 100, A1 = { a: 1 }, B1 = { b: 1 }, C1 = { c: 1 }, PAPER = {};
      P.reset(); P.clear(); P.scale(u, u);
      // dusk sky: stepped bands + rays
      [0.8, 0.66, 0.52, 0.4].forEach((t, i) => P.fill(R.rect(-2, -2 + i * 26, 104, 28), { a: t, b: i === 3 ? 0.18 : 0 }));
      P.fill(R.rays(44, 44, 120, 18, 0.1, 0.5), { a: 0.25 }, { over: true });
      // halo + the ball
      P.fill(R.circle(44, 44, 40), { c: 0.28 }, { over: true });
      const ball = R.circle(44, 44, 33);
      P.fill(ball, PAPER);
      P.save(); P.clip(ball);
      P.fill(R.circle(55, 55, 34), { c: 0.45 }, { over: true });
      P.fill(R.circle(60, 61, 30), { c: 0.65, b: 0.12 }, { over: true });
      const seams = new Path2D(), st = new Path2D();
      [-1, 1].forEach(sd => {
        const pts = [];
        for (let i = 0; i <= 24; i++) { const a = -1.15 + 2.3 * i / 24, px = sd * (33 * 1.22 - Math.cos(a) * 33 * 0.6), py = Math.sin(a) * 33 * 0.95; const r = -0.45; pts.push([44 + px * Math.cos(r) - py * Math.sin(r), 44 + px * Math.sin(r) + py * Math.cos(r)]); }
        pts.forEach((p, k) => k ? seams.lineTo(p[0], p[1]) : seams.moveTo(p[0], p[1]));
        for (let i = 1; i < pts.length - 1; i += 2) {
          const dx = pts[i + 1][0] - pts[i - 1][0], dy = pts[i + 1][1] - pts[i - 1][1], dl = Math.hypot(dx, dy), nx = -dy / dl, ny = dx / dl, L = 2.6;
          st.moveTo(pts[i][0] - nx * L - dx / dl * 1.6, pts[i][1] - ny * L - dy / dl * 1.6); st.lineTo(pts[i][0], pts[i][1]); st.lineTo(pts[i][0] + nx * L - dx / dl * 1.6, pts[i][1] + ny * L - dy / dl * 1.6);
        }
      });
      P.stroke(seams, B1, 2.4, { over: true });
      P.stroke(st, B1, 1.8, { over: true });
      P.restore();
      P.stroke(ball, A1, 1.6, { over: true });
      // "HH" stamp, double-hit
      P.save(); P.translate(70, 86); P.rotate(-0.08);
      P.fill(R.rrect(-27, -17, 54, 26, 3), { c: 1 });
      P.stroke(R.rrect(-27, -17, 54, 26, 3), A1, 1.8, { over: true });
      P.text('HH', 1.6, 6.6, R.font(24), A1, { align: 'center', over: true });
      P.text('HH', 0, 5, R.font(24), B1, { align: 'center', over: true });
      P.restore();
      const c = document.createElement('canvas'); c.width = N; c.height = N;
      const x = c.getContext('2d');
      const k = N / 100;
      P.composite(x, { a: { x: 0, y: 0 }, b: { x: 1.3 * k, y: -0.9 * k }, c: { x: -1 * k, y: 1.1 * k } }, { grain: 0.8 });
      // guarantee opaque edges (misregistration can leave a bare strip; fill it with paper underneath)
      const o = document.createElement('canvas'); o.width = N; o.height = N;
      const ox = o.getContext('2d'); ox.fillStyle = BB.INKS.paper; ox.fillRect(0, 0, N, N); ox.drawImage(c, 0, 0);
      return o.toDataURL('image/png');
    }, size);
    fs.writeFileSync(path.join(ROOT, 'icons', `icon-${size}.png`), Buffer.from(url.split(',')[1], 'base64'));
    console.log('wrote icons/icon-' + size + '.png');
  }
  await browser.close();
  if (errors.length) { console.error(errors); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });

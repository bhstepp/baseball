#!/usr/bin/env node
// Build: concatenates src/ into one page.
//   index.html          GitHub Pages / installable build (manifest + service worker registration)
//   sw.js               service worker (cache version = hash of index.html; pre-caches the asset files)
//   dist/halftone.html  plain standalone document without the service worker; what the tests load (every asset
//                       inlined, so it works from file://)
//   dist/site/          the whole site as deployed (index.html, sw.js, manifest, icons, assets/*.glb); the Pages
//                       workflow publishes this folder
// Assets (docs/CAST-PLAN.md, "Asset pipeline"): character models in assets/*.glb, packed by tools/pack-assets.js.
//   Boot assets (BOOT: Rocco, needed on the title screen) are inlined as base64 in window.BB_ASSETS.
//   Every other model ships as a file, listed in window.BB_ASSET_FILES = { name: { url, bytes } } and fetched by
//   BB.Assets when a game needs it; sw.js pre-caches them in the background after the first launch.
//   A model exported in place (raw assets/<name>.glb while the modeler iterates) ships packed from
//   dist/packed/<name>.glb when tools/pack-assets.js has packed that exact file, raw otherwise (with a warning).
// usage: node tools/build.js
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const ORDER = ['00-const.js', '10-pitch.js', '15-bat.js', '20-content.js', '25-rules.js', '30-assets.js', '31-toon.js', '32-cast.js', '33-park.js', '34-anim.js', '35-scene.js',
  '36-actors.js', '36-rocco.js', '37-ink.js', '38-cards.js', '40-audio.js', '50-save.js', '55-meta.js', '56-ui.js', '60-main.js'];
const BOOT = ['rocco'];
const S = f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
const have = f => fs.existsSync(path.join(ROOT, 'src', f));
const sha = b => crypto.createHash('sha1').update(b).digest('hex');

const missing = ORDER.filter(f => !have(f));
if (missing.length) console.warn('build: skipping missing modules: ' + missing.join(', '));
const js = ORDER.filter(have).map(f => `// ===================== MODULE: ${f} =====================\n` + S(f)).join('\n');
const head = have('shell.head.html') ? S('shell.head.html') : '<style>html,body{margin:0;background:#FFF4DC}</style>';
const body = have('shell.body.html') ? S('shell.body.html') : '<canvas id="game"></canvas><div id="ui"></div>';
// Vendored libraries go in their own script tag, ahead of the game bundle (three.js r149, MIT: src/vendor/three.LICENSE).
const VENDOR = ['vendor/three.min.js', 'vendor/three-addons.js'].filter(have).map(f => `<script>\n${S(f)}\n</script>\n`).join('');

// ---------------------------------------------------------------- assets
const ASSET_DIR = path.join(ROOT, 'assets'), PACKED = path.join(ROOT, 'dist', 'packed');
const isPacked = buf => { try { const len = buf.readUInt32LE(12), json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')); return (json.extensionsUsed || []).some(e => /meshopt_compression/.test(e)); } catch (e) { return false; } };
const assets = [];   // { name, file, buf, packed, boot }
if (fs.existsSync(ASSET_DIR)) fs.readdirSync(ASSET_DIR).filter(f => /\.glb$/.test(f)).sort().forEach(f => {
  const name = f.replace(/\.glb$/, '');
  if (/\.lod\d$/.test(name)) return;                     // levels of detail follow their model below
  let file = path.join(ASSET_DIR, f), buf = fs.readFileSync(file), lods = [];
  const meta = path.join(PACKED, name + '.pack.json');
  if (!isPacked(buf) && fs.existsSync(meta)) {          // exported in place: use the packed copy of this exact file
    const m = JSON.parse(fs.readFileSync(meta, 'utf8')), pf = path.join(PACKED, name + '.glb');
    if (m.source === sha(buf) && fs.existsSync(pf)) { file = pf; buf = fs.readFileSync(pf); if (m.lod1Out && fs.existsSync(path.join(PACKED, name + '.lod1.glb'))) lods.push(path.join(PACKED, name + '.lod1.glb')); }
  }
  if (!lods.length && path.dirname(file) === ASSET_DIR) fs.readdirSync(ASSET_DIR).filter(g => g.startsWith(name + '.lod') && /\.glb$/.test(g)).forEach(g => lods.push(path.join(ASSET_DIR, g)));
  if (!isPacked(buf)) console.warn(`build: assets/${f} is not compressed (${(buf.length / 1024).toFixed(0)} KB): run node tools/pack-assets.js`);
  assets.push({ name, file, buf, boot: BOOT.includes(name) });
  lods.forEach(lf => { const lb = fs.readFileSync(lf); assets.push({ name: path.basename(lf).replace(/\.glb$/, ''), file: lf, buf: lb, boot: false }); });
});
const b64 = a => a.buf.toString('base64');
const inlineOf = list => `<script>\nwindow.BB_ASSETS = {${list.map(a => `\n  ${JSON.stringify(a.name)}: "${b64(a)}"`).join(',')}\n};\n</script>\n`;
const files = assets.filter(a => !a.boot);
const FILEMAP = {}; files.forEach(a => { FILEMAP[a.name] = { url: 'assets/' + a.name + '.glb?v=' + sha(a.buf).slice(0, 10), bytes: a.buf.length }; });
const fileList = `<script>\nwindow.BB_ASSET_FILES = ${JSON.stringify(FILEMAP)};\n</script>\n`;
// the site: boot assets inline, the rest as files; the standalone test page: everything inline
const siteAssets = inlineOf(assets.filter(a => a.boot)) + fileList;
const testAssets = inlineOf(assets);

function page(assetTags) {
  const script = `${VENDOR}${assetTags}<script>\n"use strict";\n${js}\n</script>\n`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Slugger">
<meta name="theme-color" content="#FFF4DC">
<title>Screwball Slugger</title>
${head}
</head>
<body>
${body}
${script}</body>
</html>
`;
}
const full = page(testAssets);
const headLinks = `<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/icon-180.png">
<link rel="icon" type="image/png" href="icons/icon-192.png">
`;
// the service worker; once it controls the page, ask it to pre-cache the asset files in the background
const register = `<script>
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && window.top === window.self) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').catch(function () {});
    navigator.serviceWorker.ready.then(function (r) { if (r.active) r.active.postMessage({ type: 'precache-assets' }); }).catch(function () {});
  });
}
</script>
`;
const sitePage = page(siteAssets);
const iHead = sitePage.indexOf('</head>'), iBody = sitePage.lastIndexOf('</body>');
const site = sitePage.slice(0, iHead) + headLinks + sitePage.slice(iHead, iBody) + register + sitePage.slice(iBody);
const version = crypto.createHash('sha1').update(site).update(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'))).digest('hex').slice(0, 10);
const sw = fs.readFileSync(path.join(__dirname, 'sw.template.js'), 'utf8').replace('__VERSION__', version)
  .replace('__ASSETS__', JSON.stringify(files.map(a => FILEMAP[a.name].url)));

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', 'halftone.html'), full);
fs.writeFileSync(path.join(ROOT, 'index.html'), site);
fs.writeFileSync(path.join(ROOT, 'sw.js'), sw);
// dist/site: the deployable folder
const SITE = path.join(ROOT, 'dist', 'site');
fs.rmSync(SITE, { recursive: true, force: true });
fs.mkdirSync(path.join(SITE, 'assets'), { recursive: true });
fs.writeFileSync(path.join(SITE, 'index.html'), site);
fs.writeFileSync(path.join(SITE, 'sw.js'), sw);
fs.copyFileSync(path.join(ROOT, 'manifest.webmanifest'), path.join(SITE, 'manifest.webmanifest'));
if (fs.existsSync(path.join(ROOT, 'icons'))) { fs.mkdirSync(path.join(SITE, 'icons'), { recursive: true }); fs.readdirSync(path.join(ROOT, 'icons')).filter(f => /\.png$/.test(f)).forEach(f => fs.copyFileSync(path.join(ROOT, 'icons', f), path.join(SITE, 'icons', f))); }
files.forEach(a => fs.writeFileSync(path.join(SITE, 'assets', a.name + '.glb'), a.buf));

const kb = n => (n / 1024).toFixed(1) + ' KB';
const inl = assets.filter(a => a.boot), inlB64 = inl.reduce((s, a) => s + Math.ceil(a.buf.length / 3) * 4, 0);
console.log(`build: index.html ${(Buffer.byteLength(site) / 1024).toFixed(1)} KiB, sw ${version}, ${ORDER.length - missing.length}/${ORDER.length} modules, assets: ${assets.map(a => a.name).join(' ') || 'none'}`);
if (assets.length) console.log(`build: inline ${inl.map(a => `${a.name} ${kb(a.buf.length)}${isPacked(a.buf) ? '' : ' (raw)'}`).join(', ') || 'none'} = ${kb(inlB64)} base64 in the page; files ${files.map(a => `${a.name} ${kb(a.buf.length)}`).join(', ') || 'none'} -> dist/site/assets/`);

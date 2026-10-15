#!/usr/bin/env node
// Build: concatenates src/ into one self-contained page.
//   index.html  GitHub Pages / installable build (manifest + service worker registration)
//   sw.js       service worker (cache version = hash of index.html)
//   dist/halftone.html  plain standalone document without the service worker; what the tests load
// usage: node tools/build.js
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const ORDER = ['00-const.js', '10-pitch.js', '15-bat.js', '20-content.js', '25-rules.js', '30-riso.js', '35-scene.js',
  '38-cards.js', '40-audio.js', '50-save.js', '55-meta.js', '56-ui.js', '60-main.js'];
const S = f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
const have = f => fs.existsSync(path.join(ROOT, 'src', f));

const missing = ORDER.filter(f => !have(f));
if (missing.length) console.warn('build: skipping missing modules: ' + missing.join(', '));
const js = ORDER.filter(have).map(f => `// ===================== MODULE: ${f} =====================\n` + S(f)).join('\n');
const head = have('shell.head.html') ? S('shell.head.html') : '<style>html,body{margin:0;background:#F4EEE1}</style>';
const body = have('shell.body.html') ? S('shell.body.html') : '<canvas id="game"></canvas><div id="ui"></div>';
const script = `<script>\n"use strict";\n${js}\n</script>\n`;

const full = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Hardball">
<meta name="theme-color" content="#F4EEE1">
<title>Halftone Hardball</title>
${head}
</head>
<body>
${body}
${script}</body>
</html>
`;
const headLinks = `<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/icon-180.png">
<link rel="icon" type="image/png" href="icons/icon-192.png">
`;
const register = `<script>
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && window.top === window.self) {
  window.addEventListener('load', function () { navigator.serviceWorker.register('./sw.js').catch(function () {}); });
}
</script>
`;
const iHead = full.indexOf('</head>'), iBody = full.lastIndexOf('</body>');
const site = full.slice(0, iHead) + headLinks + full.slice(iHead, iBody) + register + full.slice(iBody);
const version = crypto.createHash('sha1').update(site).update(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'))).digest('hex').slice(0, 10);
const sw = fs.readFileSync(path.join(__dirname, 'sw.template.js'), 'utf8').replace('__VERSION__', version);

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', 'halftone.html'), full);
fs.writeFileSync(path.join(ROOT, 'index.html'), site);
fs.writeFileSync(path.join(ROOT, 'sw.js'), sw);
console.log(`build: index.html ${(Buffer.byteLength(site) / 1024).toFixed(1)} KiB, sw ${version}, ${ORDER.length - missing.length}/${ORDER.length} modules`);

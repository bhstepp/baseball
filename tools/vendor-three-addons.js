#!/usr/bin/env node
// Turns the three.js r149 ES-module addons we need into one classic script that attaches to the global THREE:
//   THREE.GLTFLoader, THREE.SkeletonUtils
// usage: node tools/vendor-three-addons.js <path to an unpacked three@0.149.0 npm package>
// Output: src/vendor/three-addons.js (committed; the build inlines it after three.min.js).
const fs = require('fs'), path = require('path');
const PKG = process.argv[2];
if (!PKG) { console.error('usage: node tools/vendor-three-addons.js <three package dir>'); process.exit(1); }
const read = p => fs.readFileSync(path.join(PKG, 'examples/jsm', p), 'utf8');

function fromThree(src) { // import { A, B } from 'three';  ->  const { A, B } = THREE;
  return src.replace(/import\s*\{([^}]*)\}\s*from\s*'three';/g, (m, names) => `const {${names}} = THREE;`);
}

// toTrianglesDrawMode is the only thing GLTFLoader needs from BufferGeometryUtils
const bgu = read('utils/BufferGeometryUtils.js');
const start = bgu.indexOf('function toTrianglesDrawMode(');
if (start < 0) throw new Error('toTrianglesDrawMode not found');
let depth = 0, end = -1;
for (let i = bgu.indexOf('{', start); i < bgu.length; i++) {
  if (bgu[i] === '{') depth++;
  else if (bgu[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
const toTri = bgu.slice(start, end); // GLTFLoader already imports the draw-mode constants it uses

let gltf = read('loaders/GLTFLoader.js');
gltf = fromThree(gltf).replace(/import\s*\{\s*toTrianglesDrawMode\s*\}\s*from\s*'..\/utils\/BufferGeometryUtils.js';/, toTri)
  .replace(/export\s*\{\s*GLTFLoader\s*\};?/, 'THREE.GLTFLoader = GLTFLoader;');

let sk = read('utils/SkeletonUtils.js');
sk = fromThree(sk).replace(/export\s*\{([^}]*)\};?/, (m, names) =>
  'THREE.SkeletonUtils = {' + names.split(',').map(s => s.trim()).filter(Boolean).map(n => `${n}: ${n}`).join(', ') + '};');

if (/^\s*(import|export)\b/m.test(gltf + sk)) throw new Error('leftover import/export');
const out = `/* three.js r149 addons (MIT, see three.LICENSE): GLTFLoader and SkeletonUtils, converted to a classic script
   by tools/vendor-three-addons.js. Do not edit by hand. */
(function () {
${gltf}
})();
(function () {
${sk}
})();
`;
fs.writeFileSync(path.join(__dirname, '..', 'src', 'vendor', 'three-addons.js'), out);
console.log('wrote src/vendor/three-addons.js', (out.length / 1024).toFixed(1) + ' KiB');

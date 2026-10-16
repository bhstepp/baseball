#!/usr/bin/env node
// Cast data export: runs the game's own content scripts (constants, pitchers, card generation, card-art species and
// seeded face parameters) in a Node sandbox and writes the facts the Blender cast generator needs to
// tools/blender/cast/data/cards.json, so the 3D players match their album cards (palette, accessories, numbers).
//   node tools/cast-data.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..'), SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'tools', 'blender', 'cast', 'data', 'cards.json');

class Path2DStub { constructor() {} ellipse() {} moveTo() {} lineTo() {} closePath() {} arc() {} rect() {} quadraticCurveTo() {} bezierCurveTo() {} addPath() {} }
const ctx = { console, Math, Date, JSON, Path2D: Path2DStub, document: { createElement: () => ({ getContext: () => ({}) }), fonts: null } };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
function load(file, patch) {
  let code = fs.readFileSync(path.join(SRC, file), 'utf8');
  if (patch) code = patch(code);
  vm.runInContext(code, ctx, { filename: file });
}
load('00-const.js');
ctx.BB.Save = { get: () => ({ cards: {}, misprints: {} }), commit: () => {} };
ctx.BB.FONTS = { display: 'x', body: 'y' };
load('20-content.js');
// expose the card art's private face() (seeded portrait parameters) without touching the source file
load('38-cards.js', (c) => c.replace('BB.CardArt = {', 'BB.CardArt = { face: face, '));
load('55-meta.js');
const BB = ctx.BB, U = BB.U, CA = BB.CardArt;

function faceFor(species, seed) {
  const f = CA.face(species, seed);
  return { pal: [f.main, f.sec, f.ac], eyes: f.eyes, brow: f.brow, mouth: f.mouth, cap: f.cap, blush: f.blush, acc: f.acc, tilt: f.tilt };
}
const out = { generated: 'tools/cast-data.js', teams: [], cards: [], pitchers: [], species: {}, inksets: {} };
BB.Meta.TEAMS.forEach((t) => out.teams.push({ idx: t.idx, id: t.id, name: t.name, short: t.short, inkset: t.inkset, mascot: t.mascot, town: t.town }));
BB.INKSETS.forEach((s) => { out.inksets[s.id] = s; });
BB.Meta.CARDS.forEach((c) => {
  out.cards.push({ id: c.id, no: c.no, name: c.name, nick: c.nick, pos: c.pos, number: c.number, seed: c.seed, species: c.species,
    rarity: c.rarity, teamIdx: c.teamIdx, team: c.team, flavor: c.flavor, face: faceFor(c.species, c.seed) });
});
BB.Content.PITCHERS.forEach((p) => {
  const sp = CA.speciesFor(p), seed = U.hashStr(p.id || p.name || 'p');
  const f = faceFor(sp, seed);
  out.pitchers.push({ id: p.id, name: p.name, nick: p.nick, hand: p.hand, team: p.team, boss: p.boss, look: p.look, bio: p.bio,
    species: sp, seed: seed, face: f });
});
Object.keys(CA.SPECIES).forEach((k) => { out.species[k] = CA.SPECIES[k]; });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('wrote', OUT, out.cards.length, 'cards', out.pitchers.length, 'pitchers', Object.keys(out.species).length, 'species');

// node test/learn_digits.js <dossier> : apprend les modèles de chiffres des compteurs à partir des
// captures annotées (test/truth.json) et les écrit dans recognize.js (entre les marqueurs).
'use strict';
const fs = require('fs');
const path = require('path');
const { readPng } = require('./png.js');
const R = require('../recognize.js');
const truth = require('./truth.json').images;

const samples = {};
const add = (d, v) => (samples[d] = samples[d] || []).push(v);
for (const [name, want] of Object.entries(truth)) {
  const got = R.recognize(readPng(path.join(process.argv[2] || path.join(__dirname, 'images'), name)));
  if (got.level !== want.level) { console.log(name, 'niveau non reconnu, ignorée'); continue; }
  const counters = want.counters || {};
  for (const g of got.goals) {
    if (g.done || !g.glyphs) continue;
    const slash = g.glyphs.indexOf('/');
    const have = String(counters[g.color] ?? 0);
    const need = String(want.goals[g.color]);
    const before = g.glyphs.slice(0, slash), after = g.glyphs.slice(slash + 1);
    if (before.length === have.length) before.forEach((v, i) => add(have[i], v));
    if (after.length === need.length) after.forEach((v, i) => add(need[i], v));
  }
}
const templates = Object.keys(samples).sort().map((d) => {
  const list = samples[d];
  const mean = list[0].map((_, i) => +(list.reduce((s, v) => s + v[i], 0) / list.length).toFixed(3));
  console.log(`chiffre ${d} : ${list.length} exemples`);
  return [d, mean];
});
const file = path.join(__dirname, '..', 'recognize.js');
const src = fs.readFileSync(file, 'utf8');
const begin = '  // <digits>', end = '  // </digits>';
const block = `${begin}\n  let DIGITS = ${JSON.stringify(templates)};\n${end}`;
const i = src.indexOf(begin), j = src.indexOf(end);
if (i < 0 || j < 0) throw new Error('marqueurs <digits> absents de recognize.js');
fs.writeFileSync(file, src.slice(0, i) + block + src.slice(j + end.length));
console.log('modèles écrits dans recognize.js :', templates.map(([d]) => d).join(' '));

// node test/run.js <dossier des captures> : compare la reconnaissance à test/truth.json
'use strict';
const path = require('path');
const { readPng } = require('./png.js');
const { recognize } = require('../recognize.js');
const truth = require('./truth.json').images;

const dir = process.argv[2] || path.join(__dirname, 'images');
let cells = 0, cellsOk = 0, pieces = 0, piecesOk = 0, imagesOk = 0, goals = 0, goalsGood = 0;
for (const [name, want] of Object.entries(truth)) {
  const t0 = Date.now();
  const got = recognize(readPng(path.join(dir, name)));
  const ms = Date.now() - t0;
  if (got.error) { console.log(name, 'ERREUR', got.error); continue; }
  const bad = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    cells++;
    if (got.grid[r][c] === want.grid[r][c]) cellsOk++;
    else bad.push(`(${c},${7 - r}) ${want.grid[r][c]}→${got.grid[r][c]}`);
  }
  const badPieces = [];
  want.pieces.forEach((wp, i) => {
    pieces++;
    const gp = got.pieces[i];
    if (JSON.stringify(gp) === JSON.stringify(wp)) piecesOk++;
    else badPieces.push(`pièce ${i + 1}: attendu ${JSON.stringify(wp)} lu ${JSON.stringify(gp)}`);
  });
  // niveau et compteurs (absent de truth = 0 ; objectif terminé = quantité demandée)
  const wantCounters = {};
  for (const [c, n] of Object.entries(want.goals)) {
    const have = (want.counters || {})[c] ?? 0;
    wantCounters[c] = have >= n ? n : have;
  }
  const goalsOk = got.level === want.level && JSON.stringify(got.counters) === JSON.stringify(
    Object.fromEntries(Object.keys(got.need || {}).map((c) => [c, wantCounters[c]])));
  goals += 1; if (goalsOk) goalsGood++;
  else badPieces.push(`objectifs : attendu niveau ${want.level} ${JSON.stringify(wantCounters)} lu ${got.level} ${JSON.stringify(got.counters)}`);
  if (!bad.length && !badPieces.length) imagesOk++;
  const b = got.board;
  console.log(`${name} ${ms} ms  plateau x=${b.x} y=${b.y} case=${b.cell.toFixed(1)} (w=${b.w} h=${b.h})  ` +
              `${bad.length ? 'cases fausses: ' + bad.join(' ') : 'grille OK'}`);
  for (const line of badPieces) console.log('   ', line);
}
console.log(`\nCases : ${cellsOk}/${cells} · pièces : ${piecesOk}/${pieces} · niveau et compteurs : ${goalsGood}/${goals} · captures parfaites : ${imagesOk}/${Object.keys(truth).length}`);

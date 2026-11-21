// node test/robust.js <dossier> : mêmes captures, redimensionnées et bruitées (autres écrans,
// compression), pour estimer la tenue de la reconnaissance hors des images de réglage.
'use strict';
const path = require('path');
const { readPng } = require('./png.js');
const { recognize } = require('../recognize.js');
const truth = require('./truth.json').images;

function resize(img, k) {
  const W = Math.round(img.width * k), H = Math.round(img.height * k);
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = Math.min(img.width - 1.001, x / k), sy = Math.min(img.height - 1.001, y / k);
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    for (let c = 0; c < 4; c++) {
      const at = (xx, yy) => img.data[(yy * img.width + xx) * 4 + c];
      out[(y * W + x) * 4 + c] = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
                                 (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
    }
  }
  return { width: W, height: H, data: out };
}

function noisy(img, amp, seed) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const data = new Uint8ClampedArray(img.data);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) data[i + c] += Math.round((rnd() * 2 - 1) * amp);
  }
  return { width: img.width, height: img.height, data };
}

const variants = [['×0,7', 0.7, 0], ['×1,6', 1.6, 0], ['×2,2', 2.2, 0], ['bruit ±8', 1, 8], ['×0,8 + bruit ±6', 0.8, 6]];
for (const [label, k, amp] of variants) {
  let ok = 0, cells = 0, cellsOk = 0, pieces = 0, piecesOk = 0, ms = 0;
  for (const [name, want] of Object.entries(truth)) {
    let img = readPng(path.join(process.argv[2] || path.join(__dirname, 'images'), name));
    if (k !== 1) img = resize(img, k);
    if (amp) img = noisy(img, amp, 7);
    const t0 = Date.now();
    const got = recognize(img);
    ms += Date.now() - t0;
    if (got.error) continue;
    let good = true;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      cells++;
      if (got.grid[r][c] === want.grid[r][c]) cellsOk++; else good = false;
    }
    want.pieces.forEach((wp, i) => {
      pieces++;
      if (JSON.stringify(got.pieces[i]) === JSON.stringify(wp)) piecesOk++; else good = false;
    });
    const wc = Object.fromEntries(Object.keys(want.goals).map((c) => [c, (want.counters || {})[c] ?? 0]));
    if (got.level !== want.level || JSON.stringify(got.counters) !== JSON.stringify(
      Object.fromEntries(Object.keys(got.need || {}).map((c) => [c, wc[c]])))) good = false;
    if (good) ok++;
  }
  const n = Object.keys(truth).length;
  console.log(`${label.padEnd(16)} captures parfaites ${ok}/${n} · cases ${cellsOk}/${n * 64} · pièces ${piecesOk}/${n * 3} · ${Math.round(ms / n)} ms/capture`);
}

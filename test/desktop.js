// Desktop layouts synthesized from the annotated full screenshot.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { readPng } = require('./png');
const { recognize } = require('../recognize');
const source = readPng(path.join(__dirname, 'images/desktop.png'));
const want = require('./truth.json').images['desktop.png'];
const layouts = [
  ['half screen', 2560, 1440, 0.5, 0, 200],
  ['small offset window', 2560, 1440, 0.4, 1400, 700],
  ['two monitors', 5120, 1440, 1, 2560, 0],
  ['two 4K monitors', 7680, 2160, 1, 4900, 500],
  ['stacked monitors', 2560, 2880, 0.75, 300, 1600],
  ['portrait desktop fallback', 1440, 2560, 0.5, 50, 1700],
];
for (const [label, width, height, scale, ox, oy] of layouts) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([35, 40, 48, 255], i);
  // A brown square must not be accepted as a board without goals/piece slots.
  for (let y = 20; y < 300; y++) for (let x = 20; x < 300; x++) {
    data.set([89, 74, 70, 255], (y * width + x) * 4);
  }
  for (let y = 0; y < Math.floor(source.height * scale); y++) {
    for (let x = 0; x < Math.floor(source.width * scale); x++) {
      const from = (Math.floor(y / scale) * source.width + Math.floor(x / scale)) * 4;
      data.set(source.data.subarray(from, from + 4), ((oy + y) * width + ox + x) * 4);
    }
  }
  const start = performance.now();
  const got = recognize({ width, height, data });
  assert.equal(got.error, undefined, label);
  assert.deepEqual(got.grid, want.grid, label + ' grid');
  assert.deepEqual(got.pieces, want.pieces, label + ' pieces');
  assert.equal(got.level, want.level, label + ' level');
  assert.deepEqual(got.counters, want.counters, label + ' counters');
  assert.ok(Math.abs(got.board.x - (ox + 987 * scale)) < 6, label + ' x');
  assert.ok(Math.abs(got.board.y - (oy + 366 * scale)) < 6, label + ' y');
  console.log(`${label}: OK, ${Math.round(performance.now() - start)} ms`);
}
const blank = { width: 1600, height: 900, data: new Uint8ClampedArray(1600 * 900 * 4) };
assert.equal(recognize(blank).error, 'board_not_found');
console.log('No game: rejected');

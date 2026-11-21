// node test/horizontal-piece.js <private screenshot path>
// The user-provided desktop image stays outside the public repository.
'use strict';
const assert = require('node:assert/strict');
const { readPng } = require('./png');
const { recognize } = require('../recognize');
assert.ok(process.argv[2], 'Provide the screenshot path');
const got = recognize(readPng(process.argv[2]));
assert.equal(got.error, undefined);
assert.deepEqual(got.grid, ['........', '..B#BB#B', '..#BBBB#', '........',
  '.....###', '#.....##', '##..###B', '....###.']);
assert.deepEqual(got.pieces, [['#B.', '.B#'], ['##B#'], ['.##', 'BB.']]);
assert.equal(got.level, 10200);
assert.deepEqual(got.counters, { B: 7, C: 5, D: 5 });
console.log('Horizontal piece screenshot: 64 cells, 3 pieces and counters OK');

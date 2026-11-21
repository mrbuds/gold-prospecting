// Gold Prospecting (Last War pre-season 5): read the board and the pieces from a screenshot.
// Pure JavaScript, no dependency: works in the browser (ImageData from a <canvas>) and in Node.
// recognize({width, height, data}) -> {board, grid, pieces, goals, debug}
//   grid   : 8 strings, top row first; '.' empty, '#' plain block, A blue, B orange, C green, D pink
//   pieces : 3 slots left to right, null when empty; each = strings, top row first
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.S5Recognize = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Reference colours measured on screenshots (RGB).
  const PROTOS = {
    '.': [[89, 74, 70], [92, 76, 72], [84, 70, 66]],          // empty board cell
    '#': [[240, 176, 110], [246, 182, 115], [231, 170, 109]],  // plain block (and gems of a finished goal)
    'A': [[96, 180, 240], [80, 165, 235]],                     // blue gem tile
    'B': [[253, 224, 150], [246, 210, 125]],                   // orange gem tile (pale yellow)
    'C': [[142, 207, 142], [151, 223, 160]],                   // green gem tile
    'D': [[238, 179, 210], [244, 179, 224]],                   // pink gem tile
  };

  function dist2(a, b) {
    const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
    return dr * dr + dg * dg + db * db;
  }

  function classify(rgb) {
    let best = null, bd = Infinity;
    for (const k in PROTOS) for (const p of PROTOS[k]) {
      const d = dist2(rgb, p);
      if (d < bd) { bd = d; best = k; }
    }
    return [best, bd];
  }

  function makeAccess(img) {
    const { width: W, height: H, data } = img;
    return {
      W, H,
      px(x, y) { const o = ((y | 0) * W + (x | 0)) * 4; return [data[o], data[o + 1], data[o + 2]]; },
    };
  }

  // Dark brown of the board's empty cells and grid lines (not the grey frame, not the orange page).
  function isBoardDark([r, g, b]) {
    const lum = (r + g + b) / 3;
    return lum > 45 && lum < 112 && r - b >= 13 && r - b <= 40 && r - g >= 5 && r - g <= 26;
  }

  // Panel brown of the 3 piece slots under the board.
  function isPanel([r, g, b]) {
    return r >= 140 && r <= 190 && g >= 90 && g <= 130 && b >= 50 && b <= 90 && r - g >= 40 && r - g <= 75;
  }

  // Runs of indexes where values >= threshold; gaps up to maxGap are bridged (thin lines).
  function runs(values, threshold, minLen, maxGap = 0) {
    const raw = [];
    let start = -1;
    for (let i = 0; i <= values.length; i++) {
      const on = i < values.length && values[i] >= threshold;
      if (on && start < 0) start = i;
      if (!on && start >= 0) { raw.push([start, i - 1]); start = -1; }
    }
    const merged = [];
    for (const r of raw) {
      const last = merged[merged.length - 1];
      if (last && r[0] - last[1] - 1 <= maxGap) last[1] = r[1];
      else merged.push(r.slice());
    }
    return merged.filter(([a, b]) => b - a + 1 >= minLen);
  }

  function findBoard(a) {
    const { W, H } = a;
    const rows = new Array(H).fill(0);
    for (let y = 0; y < H; y++) {
      let n = 0;
      for (let x = 0; x < W; x += 2) if (isBoardDark(a.px(x, y))) n++;
      rows[y] = n * 2 / W;
    }
    // the board is the tallest band of rows with dark brown
    const band = runs(rows, 0.06, H * 0.15, Math.round(H * 0.015)).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0];
    if (!band) return null;
    const [y0, y1] = band;
    const cols = new Array(W).fill(0);
    for (let x = 0; x < W; x++) {
      let n = 0;
      for (let y = y0; y <= y1; y += 2) if (isBoardDark(a.px(x, y))) n++;
      cols[x] = n * 2 / (y1 - y0 + 1);
    }
    const crun = runs(cols, 0.06, W * 0.3, Math.round(W * 0.015)).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0];
    if (!crun) return null;
    const [x0, x1] = crun;
    // the grid is square: trust the larger extent (a side full of tiles can shrink the other one)
    const size = Math.max(x1 - x0 + 1, y1 - y0 + 1);
    const rough = { x: x0, y: y0, size, cell: size / 8, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    return refineGrid(a, rough);
  }

  // Fit of the grid: 7 inner lines darker than the cell centres on both sides, at a regular
  // step p, searched over the whole rough area (its edges can include the frame).
  function refineGrid(a, b) {
    const lum = (rgb) => rgb[0] + rgb[1] + rgb[2];
    function profile(horizontal) {
      const from = horizontal ? b.y : b.x, to = from + (horizontal ? b.h : b.w);
      const lo = horizontal ? b.x : b.y, hi = lo + (horizontal ? b.w : b.h);
      const prof = new Float64Array(Math.ceil(hi + 2));
      for (let i = Math.max(0, Math.floor(lo - 2)); i < hi + 2 && i < (horizontal ? a.W : a.H); i++) {
        let sum = 0, n = 0;
        for (let t = from; t < to; t += 2) { sum += lum(horizontal ? a.px(i, t) : a.px(t, i)); n++; }
        prof[i] = sum / Math.max(1, n);
      }
      return { prof, lo, hi };
    }
    function axis(horizontal) {
      const { prof, lo, hi } = profile(horizontal);
      const ext = hi - lo;
      const at = (x) => { const i = Math.round(x); return i >= 0 && i < prof.length ? prof[i] : 765; };
      let best = null;
      for (let p = ext / 8 * 0.6; p <= ext / 8 * 1.04; p += 0.25) {
        for (let o = lo - p * 0.5; o + 8 * p <= hi + p * 0.5; o += 0.5) {
          let score = 0;
          for (let k = 1; k <= 7; k++) {
            const line = o + k * p;
            const dip = Math.min(at(line - 1), at(line), at(line + 1));
            score += (at(line - p / 2) + at(line + p / 2)) / 2 - dip;
          }
          if (!best || score > best.score) best = { score, o, p };
        }
      }
      // A shift by whole cells matches the lines almost as well: anchor the 8x8 window on the
      // board's dark brown (empty cells and grid), the frame and the page around it are not.
      const from = horizontal ? b.y : b.x, to = from + (horizontal ? b.h : b.w);
      const mask = (i) => {
        let n = 0, t = 0;
        for (let j = from; j < to; j += 3) { t++; if (isBoardDark(horizontal ? a.px(i, j) : a.px(j, i))) n++; }
        return n / Math.max(1, t);
      };
      const cache = new Map();
      const inside = (o) => {
        let sum = 0;
        for (let i = Math.round(o); i < Math.round(o + 8 * best.p); i += 2) {
          if (!cache.has(i)) cache.set(i, i < 0 || i >= (horizontal ? a.W : a.H) ? 0 : mask(i));
          sum += cache.get(i) > 0.03 ? 1 : 0;
        }
        return sum;
      };
      let pick = best.o, pickScore = -1;
      for (let k = -3; k <= 3; k++) {
        const o = best.o + k * best.p;
        const v = inside(o);
        if (v > pickScore) { pickScore = v; pick = o; }
      }
      return { score: best.score, o: pick, p: best.p };
    }
    const bx = axis(true), by = axis(false);
    const cell = (bx.p + by.p) / 2;
    return { x: bx.o, y: by.o, size: cell * 8, cell, w: b.w, h: b.h, fit: [bx.p, by.p] };
  }

  // Majority colour class of a square sample inside a cell, ignoring its border and icon centre.
  function readCell(a, cx, cy, half) {
    const votes = {};
    const step = Math.max(1, Math.floor(half / 4));
    for (let dy = -half; dy <= half; dy += step) {
      for (let dx = -half; dx <= half; dx += step) {
        const [k, d] = classify(a.px(cx + dx, cy + dy));
        if (d > 60 * 60) continue; // icon, outline, anti-aliasing: no vote
        votes[k] = (votes[k] || 0) + 1;
      }
    }
    let best = '.', bn = 0;
    for (const k in votes) if (votes[k] > bn) { bn = votes[k]; best = k; }
    return best;
  }

  // Small piece cell: a gem tile colour can only come from a gem tile, so 20 % of the votes
  // are enough to win over the plain block colour (borders, lighter parts of the icon).
  function readPieceCell(a, cx, cy, half) {
    const votes = {};
    let total = 0;
    const step = Math.max(1, half / 6);
    for (let dy = -half; dy <= half; dy += step) {
      for (let dx = -half; dx <= half; dx += step) {
        const [k, d] = classify(a.px(cx + dx, cy + dy));
        if (d > 60 * 60 || k === '.') continue;
        votes[k] = (votes[k] || 0) + 1;
        total++;
      }
    }
    let gem = null, gn = 0;
    for (const k of 'ABCD') if ((votes[k] || 0) > gn) { gn = votes[k]; gem = k; }
    return gem && gn >= total * 0.2 ? gem : '#';
  }

  function readGrid(a, board) {
    const grid = [];
    for (let r = 0; r < 8; r++) {
      let line = '';
      for (let c = 0; c < 8; c++) {
        const cx = board.x + (c + 0.5) * board.cell, cy = board.y + (r + 0.5) * board.cell;
        // top band of the tile, above its gem icon: tile base colour
        line += readCell(a, cx, cy - board.cell * 0.3, Math.max(1, board.cell * 0.09));
      }
      grid.push(line);
    }
    return grid;
  }

  function findPanels(a, board) {
    const top = Math.round(board.y + board.size + board.cell * 0.4);
    const bottom = Math.min(a.H - 1, Math.round(board.y + board.size + board.cell * 4.5));
    const cols = new Array(a.W).fill(0);
    for (let x = 0; x < a.W; x++) {
      let n = 0;
      for (let y = top; y <= bottom; y += 2) if (isPanel(a.px(x, y))) n++;
      cols[x] = n * 2 / Math.max(1, bottom - top);
    }
    // a tall piece can hide the slot brown over its columns: bridge two parts when the gap
    // still shows some slot brown (above/below the piece); the page between slots shows none
    const parts = runs(cols, 0.15, 2);
    const joined = [];
    for (const r of parts) {
      const last = joined[joined.length - 1];
      let bridge = false;
      if (last && r[0] - last[1] <= board.cell * 1.6 && r[1] - last[0] + 1 <= board.cell * 3) {
        bridge = true;
        for (let x = last[1] + 1; x < r[0]; x++) if (cols[x] < 0.02) { bridge = false; break; }
      }
      if (bridge) last[1] = r[1]; else joined.push(r.slice());
    }
    const panels = joined.filter(([x0, x1]) => x1 - x0 + 1 >= board.cell * 1.2)
      .sort((p, q) => (q[1] - q[0]) - (p[1] - p[0])).slice(0, 3).sort((p, q) => p[0] - q[0]);
    return panels.map(([x0, x1]) => {
      const rows = [];
      for (let y = top; y <= bottom; y++) {
        let n = 0;
        for (let x = x0; x <= x1; x += 2) if (isPanel(a.px(x, y))) n++;
        rows.push(n * 2 / (x1 - x0 + 1));
      }
      const r = runs(rows, 0.2, board.cell).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0] || [0, rows.length - 1];
      return { x0, x1, y0: top + r[0], y1: top + r[1] };
    });
  }

  function isTile(rgb) {
    const [k, d] = classify(rgb);
    // White/grey mouse pointers are not tiles, even when close to pale pink.
    return k !== '.' && d < 70 * 70 && Math.max(...rgb) - Math.min(...rgb) > 40;
  }

  function readPieces(a, board, panels) {
    const scale = 38 / 74 * 0.9; // BlockSizeSmall / BlockSizeLarge, S5 reset scale (game code)
    const out = [];
    for (const p of panels) {
      // tile pixels inside the panel (the panel brown itself is not a tile colour)
      let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, count = 0;
      const columns = new Map(), lines = new Map();
      const m = Math.max(2, Math.round(board.cell * 0.15));
      for (let y = p.y0 + m; y <= p.y1 - m; y++) {
        for (let x = p.x0 + m; x <= p.x1 - m; x++) {
          const rgb = a.px(x, y);
          if (isPanel(rgb) || !isTile(rgb)) continue;
          count++;
          columns.set(x, (columns.get(x) || 0) + 1);
          lines.set(y, (lines.get(y) || 0) + 1);
        }
      }
      if (count < board.cell * board.cell * scale * scale * 0.5) { out.push(null); continue; }
      // Ignore sparse coloured fringes around the mouse pointer or compression
      // noise: a real tile occupies a substantial part of each row/column.
      const minPixels = Math.max(2, board.cell * scale * 0.25);
      for (const [x, n] of columns) if (n >= minPixels) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
      for (const [y, n] of lines) if (n >= minPixels) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      if (maxX < minX || maxY < minY) { out.push(null); continue; }
      const w = maxX - minX + 1, h = maxY - minY + 1;
      // piece cell size: the game scale, refined so the bounding box is a whole number of cells
      let s = board.cell * scale, bestErr = Infinity;
      for (let k = 0.85; k <= 1.15; k += 0.01) {
        const t = board.cell * scale * k;
        const nw = Math.max(1, Math.round(w / t)), nh = Math.max(1, Math.round(h / t));
        const err = Math.abs(w - nw * t) + Math.abs(h - nh * t);
        if (err < bestErr) { bestErr = err; s = t; }
      }
      const cw = Math.min(5, Math.max(1, Math.round(w / s))), ch = Math.min(5, Math.max(1, Math.round(h / s)));
      const sx = w / cw, sy = h / ch;
      const rows = [];
      for (let r = 0; r < ch; r++) {
        let line = '';
        for (let c = 0; c < cw; c++) {
          const cx = minX + (c + 0.5) * sx, cy = minY + (r + 0.5) * sy;
          let tile = 0, total = 0;
          for (let dy = -sy * 0.25; dy <= sy * 0.25; dy += Math.max(1, sy / 8)) {
            for (let dx = -sx * 0.25; dx <= sx * 0.25; dx += Math.max(1, sx / 8)) {
              total++;
              if (!isPanel(a.px(cx + dx, cy + dy))) tile++;  // inside a slot, not slot brown = piece
            }
          }
          line += tile / total < 0.4 ? '.' : readPieceCell(a, cx, cy, sx * 0.38);
        }
        rows.push(line);
      }
      out.push(rows);
    }
    while (out.length < 3) out.push(null);
    return out;
  }

  // --- goals (3 frames above the board: gem icon, then "have/need" or a check mark) --------

  // The 5 levels (tables season_s1_block_game 10200-10204): goal colour -> quantity.
  const LEVELS = {
    10200: { B: 10, C: 5, D: 5 }, 10201: { A: 5, B: 5, C: 10 }, 10202: { A: 5, C: 5, D: 10 },
    10203: { A: 10, B: 5, C: 5 }, 10204: { A: 10, C: 5, D: 5 },
  };
  const FAMILY = { 10200: 501, 10201: 502, 10202: 503, 10203: 502, 10204: 503 };

  function isWhite([r, g, b]) { return r > 215 && g > 215 && b > 215; }

  // Gem icon colour of a goal frame, from its most saturated pixels.
  function iconColor(a, x0, x1, y0, y1) {
    const votes = { A: 0, B: 0, C: 0, D: 0 };
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        const [r, g, b] = a.px(x, y);
        const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
        if (hi - lo < 90 || isPanel([r, g, b])) continue;
        if (b > r && b >= g) votes.A++;
        else if (g > r && g > b) votes.C++;
        else if (r > g && b > g + 20) votes.D++;
        else if (r > b && g > b + 60 && g > 120) votes.B++;
      }
    }
    return votes;
  }

  // Glyphs of the white "have/need" text: column runs of white pixels.
  function glyphs(a, x0, x1, y0, y1) {
    const cols = [];
    for (let x = x0; x < x1; x++) {
      let n = 0;
      for (let y = y0; y < y1; y++) if (isWhite(a.px(x, y))) n++;
      cols.push(n);
    }
    const out = [];
    for (const [c0, c1] of runs(cols, 1, 1)) {
      let top = Infinity, bottom = -1;
      for (let x = x0 + c0; x <= x0 + c1; x++) {
        for (let y = y0; y < y1; y++) if (isWhite(a.px(x, y))) { if (y < top) top = y; if (y > bottom) bottom = y; }
      }
      out.push({ x0: x0 + c0, x1: x0 + c1, y0: top, y1: bottom });
    }
    // On small screens a digit and the slash touch: a glyph much wider than a digit is cut at
    // its least white column (twice at most), then each part gets its own height.
    const split = [];
    const bounds = (g) => {
      let top = Infinity, bottom = -1;
      for (let x = g.x0; x <= g.x1; x++) {
        for (let y = y0; y < y1; y++) if (isWhite(a.px(x, y))) { if (y < top) top = y; if (y > bottom) bottom = y; }
      }
      return { x0: g.x0, x1: g.x1, y0: top, y1: bottom };
    };
    const cut = (g, depth) => {
      const w = g.x1 - g.x0 + 1, h = g.y1 - g.y0 + 1;
      if (depth > 2 || w <= h * 0.95) { split.push(g); return; }
      let best = -1, bn = Infinity;
      for (let x = Math.round(g.x0 + w * 0.3); x <= Math.round(g.x0 + w * 0.7); x++) {
        let n = 0;
        for (let y = g.y0; y <= g.y1; y++) if (isWhite(a.px(x, y))) n++;
        if (n < bn) { bn = n; best = x; }
      }
      cut(bounds({ x0: g.x0, x1: best - 1 }), depth + 1);
      cut(bounds({ x0: best + 1, x1: g.x1 }), depth + 1);
    };
    for (const g of out) cut(g, 0);
    return split.filter((g) => g.y1 >= g.y0);
  }

  // 5x7 occupancy grid of a glyph (white pixels), plus its aspect ratio.
  function glyphVector(a, g) {
    const w = g.x1 - g.x0 + 1, h = g.y1 - g.y0 + 1, v = [];
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        let n = 0, t = 0;
        for (let y = g.y0 + r * h / 7; y < g.y0 + (r + 1) * h / 7; y += 1) {
          for (let x = g.x0 + c * w / 5; x < g.x0 + (c + 1) * w / 5; x += 1) { t++; if (isWhite(a.px(x, y))) n++; }
        }
        v.push(t ? n / t : 0);
      }
    }
    v.push(w / h);
    return v;
  }

  // A slash leans: its white pixels move left from top to bottom.
  function isSlash(a, g) {
    const centre = (y) => {
      let s = 0, n = 0;
      for (let x = g.x0; x <= g.x1; x++) if (isWhite(a.px(x, y))) { s += x; n++; }
      return n ? s / n : null;
    };
    const h = g.y1 - g.y0, w = g.x1 - g.x0 + 1;
    // a slash is a thin stroke: no row of it is white over most of its width (digits have bars)
    for (let y = g.y0; y <= g.y1; y++) {
      let n = 0;
      for (let x = g.x0; x <= g.x1; x++) if (isWhite(a.px(x, y))) n++;
      if (n > w * 0.6 && w > 3) return false;
    }
    const top = centre(Math.round(g.y0 + h * 0.15)), bottom = centre(Math.round(g.y0 + h * 0.85));
    return top !== null && bottom !== null && top - bottom > (g.x1 - g.x0) * 0.35;
  }

  // Digit templates learnt from annotated screenshots (test/learn_digits.js rewrites this block).
  // <digits>
  let DIGITS = [["0",[0.632,0.931,0.937,0.969,0.672,0.918,0.928,0.422,0.844,0.946,0.985,0.799,0.04,0.684,0.998,1,0.779,0.024,0.656,1,0.993,0.787,0.032,0.672,1,0.949,0.913,0.4,0.832,0.963,0.675,0.996,1,1,0.697,0.802]],["1",[0.485,0.629,0.833,1,0.985,0.814,0.898,1,1,1,0.152,0.375,0.909,1,1,0,0.121,0.758,1,1,0,0.091,0.727,1,1,0,0.091,0.727,1,1,0,0.091,0.716,1,0.989,0.464]],["2",[0.667,1,1,0.963,0.63,0.333,0.333,0.444,1,1,0,0,0.111,1,1,0.111,0.444,0.778,1,0.741,0.889,1,0.667,0.222,0,1,1,0.556,0.333,0.333,1,1,1,1,1,0.75]],["3",[0.833,1,1,0.944,0.556,0.278,0.333,0.556,1,0.944,0,0,0.278,1,0.889,0.111,0.556,0.833,1,0.444,0,0.222,0.444,1,0.889,0.333,0.333,0.444,1,1,0.944,1,1,1,0.667,0.719]],["4",[0,0.111,1,0.556,0,0,0.444,1,0.111,0,0.111,0.778,0.778,0,0,0.444,1,0.444,0.444,0.222,0.889,1,0.778,1,0.889,0.667,0.667,0.778,1,0.889,0,0,0.111,1,0.556,0.875]],["5",[0.964,0.981,0.925,0.894,0.542,0.98,0.812,0.411,0.38,0.208,0.986,0.838,0.465,0.358,0.112,0.827,0.856,0.91,0.959,0.65,0.031,0.037,0.16,0.944,0.978,0.317,0.324,0.391,0.951,0.912,0.954,1,1,0.937,0.529,0.747]],["7",[0.889,1,1,1,1,0.481,0.556,0.63,1,1,0,0,0.111,1,0.778,0,0.037,0.519,1,0.556,0,0.185,0.852,0.778,0.111,0,0.519,1,0.444,0,0.111,0.778,1,0.222,0,0.75]]];
  // </digits>

  // Holes of a glyph (dark areas enclosed by white): count and vertical centre of each,
  // used for the digits absent from the learning screenshots (6, 8, 9).
  function holes(a, g) {
    const w = g.x1 - g.x0 + 3, h = g.y1 - g.y0 + 3;
    const white = new Uint8Array(w * h), seen = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const px = g.x0 - 1 + x, py = g.y0 - 1 + y;
      white[y * w + x] = px >= 0 && py >= 0 && px < a.W && py < a.H && isWhite(a.px(px, py)) ? 1 : 0;
    }
    const fill = (start) => {
      const stack = [start], cells = [];
      seen[start] = 1;
      while (stack.length) {
        const i = stack.pop();
        cells.push(i);
        const x = i % w, y = (i / w) | 0;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (!seen[j] && !white[j]) { seen[j] = 1; stack.push(j); }
        }
      }
      return cells;
    };
    fill(0);  // outside of the glyph (the padding border is never white)
    const out = [];
    for (let i = 0; i < w * h; i++) {
      if (seen[i] || white[i]) continue;
      const cells = fill(i);
      if (cells.length < w * h * 0.01) continue;
      const cy = cells.reduce((s, c) => s + ((c / w) | 0), 0) / cells.length / h;
      out.push(cy);
    }
    return out;
  }

  function readDigit(vec) {
    let best = null, bd = Infinity;
    for (const [digit, tpl] of DIGITS) {
      let d = 0;
      for (let i = 0; i < tpl.length; i++) d += (vec[i] - tpl[i]) ** 2 * (i === tpl.length - 1 ? 4 : 1);
      if (d < bd) { bd = d; best = digit; }
    }
    return { digit: best, distance: bd };
  }

  function readGoals(a, board) {
    const top = Math.max(0, Math.round(board.y - 3 * board.cell)), bottom = Math.round(board.y - 0.1 * board.cell);
    const cols = [];
    for (let x = 0; x < a.W; x++) {
      let n = 0, t = 0;
      for (let y = top; y < bottom; y += 2) { t++; if (isPanel(a.px(x, y))) n++; }
      cols.push(n / t);
    }
    const frames = runs(cols, 0.12, board.cell * 0.8, 3).filter(([x0, x1]) => x1 - x0 < board.cell * 2.6);
    // frames are evenly spaced and centred on the board: rebuild the ones a check mark hides
    const centre = board.x + board.size / 2;
    const width = frames.length ? Math.max(...frames.map(([x0, x1]) => x1 - x0)) : board.cell * 1.6;
    let pitch = board.cell * 2.37;
    if (frames.length >= 2) {
      const span = frames[frames.length - 1][0] - frames[0][0];
      pitch = span / Math.max(1, Math.round(span / pitch));
    }
    const slots = [-1, 0, 1].map((k) => {
      const mid = centre + k * pitch;
      const found = frames.find(([x0, x1]) => Math.abs((x0 + x1) / 2 - mid) < pitch / 3);
      return found ? { x0: found[0], x1: found[1], found: true }
        : { x0: Math.round(mid - width / 2), x1: Math.round(mid + width / 2), found: false };
    });
    return slots.map((f) => {
      // text = white glyphs in the lower part of the frame (and just below it)
      const textTop = Math.round(board.y - board.cell * 1.6), textBottom = Math.round(board.y - board.cell * 0.6);
      const gl = glyphs(a, f.x0, f.x1 + 1, textTop, Math.min(a.H, textBottom))
        .filter((g) => g.y1 - g.y0 >= board.cell * 0.18);
      const votes = iconColor(a, f.x0, f.x1, top, textTop + Math.round(board.cell * 0.3));
      const color = Object.keys(votes).sort((p, q) => votes[q] - votes[p])[0];
      const slash = gl.findIndex((g) => isSlash(a, g));
      const goal = { color, votes, done: slash < 0, x0: f.x0, x1: f.x1, found: f.found };
      if (slash >= 0) {
        const value = (list) => {
          if (!list.length || !DIGITS.length) return null;
          let txt = '';
          for (const g of list) {
            let digit = readDigit(glyphVector(a, g)).digit;
            const hs = holes(a, g);
            // digits never seen in the learning screenshots: decide by their holes
            if (hs.length >= 2) digit = '8';
            else if (hs.length === 1 && !'046'.includes(digit) && !'9'.includes(digit)) digit = hs[0] > 0.55 ? '6' : '9';
            txt += digit;
          }
          return Number(txt);
        };
        goal.have = value(gl.slice(0, slash));
        goal.need = gl.length - slash - 1 >= 2 ? 10 : 5;  // "/10" or "/5": no need to read it
        goal.glyphs = gl.map((g, i) => (i === slash ? '/' : glyphVector(a, g)));
      }
      return goal;
    });
  }

  // Level from the goals still open (colour, /5 or /10); a finished goal shows a check mark
  // over its gem, so its colour is the level's remaining one (its icon only breaks ties).
  function resolveLevel(goals) {
    const open = goals.filter((g) => !g.done);
    const doneGoals = goals.filter((g) => g.done);
    let candidates = Object.entries(LEVELS).filter(([, need]) =>
      open.every((g) => need[g.color] === g.need) && new Set(open.map((g) => g.color)).size === open.length);
    if (candidates.length > 1 && doneGoals.length) {
      const fits = candidates.filter(([, need]) => {
        const rest = Object.keys(need).filter((c) => !open.some((g) => g.color === c));
        return doneGoals.every((g) => rest.includes(g.color));
      });
      if (fits.length) candidates = fits;
    }
    // Still several: harmless when they share the piece family and every unfinished goal
    // (e.g. 10201/10203 once only orange remains); otherwise the player must choose.
    let ambiguous = false;
    if (candidates.length > 1) {
      const fam = new Set(candidates.map(([id]) => FAMILY[id]));
      if (fam.size === 1) { ambiguous = true; candidates = [candidates[0]]; }
    }
    if (candidates.length !== 1) return { level: null, candidates: candidates.map(([id]) => Number(id)) };
    const [id, need] = candidates[0];
    const rest = Object.keys(need).filter((c) => !open.some((g) => g.color === c));
    doneGoals.forEach((g, i) => { if (!rest.includes(g.color)) g.color = rest[i]; });
    const counters = {};
    for (const c of Object.keys(need)) {
      const g = goals.find((x) => x.color === c);
      counters[c] = !g || g.done ? need[c] : (g.have ?? null);
    }
    return { level: Number(id), need, counters, ambiguous };
  }

  function recognizeArea(a) {
    const board = findBoard(a);
    if (!board) return { error: 'board_not_found' };
    const grid = readGrid(a, board);
    const panels = findPanels(a, board);
    const pieces = panels.length === 3 ? readPieces(a, board, panels) : [null, null, null];
    const goals = readGoals(a, board);
    const { level, need, counters, candidates, ambiguous } = resolveLevel(goals);
    return { board, grid, pieces, goals, level, need, counters, ambiguous, debug: { panels, candidates } };
  }

  function recognize(img) {
    const a = makeAccess(img);
    const validBoard = (result, width, height) => {
      if (result.error || result.debug.panels.length !== 3) return false;
      const b = result.board;
      return Math.abs(b.fit[0] - b.fit[1]) <= b.cell * 0.08 &&
        b.x >= 0 && b.y >= 0 && b.x + b.size <= width && b.y + b.size <= height;
    };
    let portrait;
    if (a.W <= a.H) {
      portrait = recognizeArea(a);
      if (validBoard(portrait, a.W, a.H) && portrait.level) return portrait;
    }
    // Locate connected brown board regions on a small colour mask. This scan
    // depends on neither window position nor its size relative to the desktop.
    const scale = Math.max(1, Math.ceil(Math.max(a.W, a.H) / 1280));
    const w = Math.ceil(a.W / scale), h = Math.ceil(a.H / scale);
    const mask = new Uint8Array(w * h), joined = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (isBoardDark(a.px(x * scale, y * scale))) mask[y * w + x] = 1;
    }
    // Join thin grid lines and small compression gaps, without scaling the
    // image used later to read tiles and counter digits.
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      joined[i] = mask[i] || mask[i - 1] || mask[i + 1] || mask[i - w] || mask[i + w];
    }
    const queue = new Int32Array(w * h), regions = [];
    for (let i = 0; i < joined.length; i++) {
      if (!joined[i]) continue;
      let head = 0, tail = 1, x0 = w, y0 = h, x1 = 0, y1 = 0;
      queue[0] = i; joined[i] = 0;
      while (head < tail) {
        const p = queue[head++], x = p % w, y = Math.floor(p / w);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        for (const n of [x > 0 ? p - 1 : -1, x + 1 < w ? p + 1 : -1, p - w, p + w]) {
          if (n >= 0 && n < joined.length && joined[n]) { joined[n] = 0; queue[tail++] = n; }
        }
      }
      const rw = x1 - x0 + 1, rh = y1 - y0 + 1;
      if (rw >= 24 && rh >= 24 && rw / rh > 0.65 && rw / rh < 1.5 && tail > rw * rh * 0.12) {
        regions.push({ x: x0 * scale, y: y0 * scale, size: Math.max(rw, rh) * scale, area: tail });
      }
    }
    for (const region of regions.sort((p, q) => q.area - p.area).slice(0, 12)) {
      const ox = Math.max(0, Math.floor(region.x - region.size * 0.18));
      const oy = Math.max(0, Math.floor(region.y - region.size * 0.5));
      const width = Math.min(a.W - ox, Math.ceil(region.size * 1.36));
      const height = Math.min(a.H - oy, Math.ceil(region.size * 2.1));
      const result = recognizeArea({ W: width, H: height, px: (x, y) => a.px(x + ox, y + oy) });
      if (!validBoard(result, width, height) || !result.level) continue;
      const b = result.board;
      b.x += ox; b.y += oy;
      for (const p of [...result.debug.panels, ...result.goals]) { p.x0 += ox; p.x1 += ox; }
      for (const p of result.debug.panels) { p.y0 += oy; p.y1 += oy; }
      return result;
    }
    return portrait && validBoard(portrait, a.W, a.H) ? portrait : { error: 'board_not_found' };
  }

  function setDigits(templates) { DIGITS = templates; }

  return {
    recognize, classify, PROTOS, LEVELS, setDigits,
    _internal: { findBoard, makeAccess, runs, isBoardDark, readGoals, glyphVector, glyphs, isSlash },
  };
}));

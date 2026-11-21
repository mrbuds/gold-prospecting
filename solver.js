// Gold Prospecting (Last War pre-season 5) solver.
// Board: cell i = y*8 + x (y = 0 at the bottom), stored as two uint32: lo = cells 0..31
// (rows 0-3), hi = cells 32..63 (rows 4-7). Pure JS, usable in a Web Worker or in Node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.S5Solver = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // --- bit helpers ---------------------------------------------------------------------
  function pc32(v) {
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }
  const bitOf = (x, y) => { const i = y * 8 + x; return i < 32 ? [(1 << i) >>> 0, 0] : [0, (1 << (i - 32)) >>> 0]; };
  const ROW = [], COL = [];
  for (let y = 0; y < 8; y++) ROW.push(y < 4 ? [(0xff << (8 * y)) >>> 0, 0] : [0, (0xff << (8 * (y - 4))) >>> 0]);
  for (let x = 0; x < 8; x++) COL.push([(0x01010101 << x) >>> 0, (0x01010101 << x) >>> 0]);
  const LINES = ROW.concat(COL);  // 0-7 rows, 8-15 columns

  // Deterministic random numbers (mulberry32) for the solver's fixed samples.
  function rng(seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return { next, int: (n) => Math.floor(next() * n), pick: (list) => list[Math.floor(next() * list.length)] };
  }
  function shuffle(list, r) {
    for (let i = list.length - 1; i > 0; i--) { const j = r.int(i + 1); [list[i], list[j]] = [list[j], list[i]]; }
    return list;
  }

  // --- rules, states, pieces -------------------------------------------------------------
  // rules = {types: [itemid...] sorted, need: [n...]}
  // state = {lo, hi, g: Uint32-like array [lo0, hi0, lo1, hi1, ...], have: [h...]}
  function stateKey(s) { return s.lo + ',' + s.hi + ',' + s.g.join(',') + ',' + s.have.join(','); }
  function isWin(rules, have) { for (let t = 0; t < rules.need.length; t++) if (have[t] < rules.need[t]) return false; return true; }

  // piece = {slot, cfgid, cells: [[x, y, itemid|null]...]}
  const placementCache = new WeakMap();
  function placements(piece, rules) {
    let byTypes = placementCache.get(piece);
    const key = rules.types.join(',');
    if (byTypes && byTypes[key]) return byTypes[key];
    const T = rules.types.length;
    let w = 0, h = 0;
    for (const [x, y] of piece.cells) { if (x + 1 > w) w = x + 1; if (y + 1 > h) h = y + 1; }
    const out = [];
    for (let y0 = 0; y0 <= 8 - h; y0++) {
      for (let x0 = 0; x0 <= 8 - w; x0++) {
        let lo = 0, hi = 0;
        const g = new Array(2 * T).fill(0);
        const lines = new Set();
        for (const [x, y, item] of piece.cells) {
          const [bl, bh] = bitOf(x0 + x, y0 + y);
          lo = (lo | bl) >>> 0; hi = (hi | bh) >>> 0;
          const t = item == null ? -1 : rules.types.indexOf(String(item));
          if (t >= 0) { g[2 * t] = (g[2 * t] | bl) >>> 0; g[2 * t + 1] = (g[2 * t + 1] | bh) >>> 0; }
          lines.add(y0 + y); lines.add(8 + x0 + x);
        }
        out.push({ x: x0, y: y0, lo, hi, g, lines: [...lines].sort((a, b) => a - b) });
      }
    }
    if (!byTypes) { byTypes = {}; placementCache.set(piece, byTypes); }
    byTypes[key] = out;
    return out;
  }
  const fits = (s, pl) => !(s.lo & pl.lo) && !(s.hi & pl.hi);

  // Place a (legal) piece, then clear every full row and column at once.
  function apply(rules, s, pl) {
    const olo = (s.lo | pl.lo) >>> 0, ohi = (s.hi | pl.hi) >>> 0;
    let clo = 0, chi = 0, lines = 0;
    for (const li of pl.lines) {
      const L = LINES[li];
      if ((olo & L[0]) >>> 0 === L[0] && (ohi & L[1]) >>> 0 === L[1]) { clo = (clo | L[0]) >>> 0; chi = (chi | L[1]) >>> 0; lines++; }
    }
    const T = rules.need.length;
    const g = new Array(2 * T);
    for (let i = 0; i < 2 * T; i++) g[i] = (s.g[i] | pl.g[i]) >>> 0;
    if (!lines) return { state: { lo: olo, hi: ohi, g, have: s.have }, lines: 0, gained: null, win: false };
    const have = s.have.slice(), gained = new Array(T).fill(0);
    for (let t = 0; t < T; t++) {
      const c = pc32(g[2 * t] & clo) + pc32(g[2 * t + 1] & chi);
      const add = Math.min(c, Math.max(0, rules.need[t] - have[t]));
      have[t] += add; gained[t] = add;
      g[2 * t] = (g[2 * t] & ~clo) >>> 0; g[2 * t + 1] = (g[2 * t + 1] & ~chi) >>> 0;
    }
    return { state: { lo: (olo & ~clo) >>> 0, hi: (ohi & ~chi) >>> 0, g, have }, lines, gained, win: isWin(rules, have) };
  }

  function canPlaceAny(s, pieces, rules) {
    for (const p of pieces) for (const pl of placements(p, rules)) if (fits(s, pl)) return true;
    return false;
  }

  // A gem of a goal already met arrives under a goal still open (observed in game).
  function substitute(piece, rules, have, r) {
    const done = new Set(), open = [];
    rules.types.forEach((t, i) => (have[i] >= rules.need[i] ? done.add(t) : open.push(t)));
    if (!done.size || !open.length) return piece;
    return { slot: piece.slot, cfgid: piece.cfgid,
      cells: piece.cells.map(([x, y, v]) => [x, y, v != null && done.has(String(v)) ? r.pick(open) : v]) };
  }

  // --- gem supply: exact expected number of pieces before enough gems arrived ------------
  function SupplyModel(vectors, substitution) {
    const merged = new Map();
    for (const v of vectors) merged.set(v.join(','), (merged.get(v.join(',')) || 0) + 1 / vectors.length);
    const base = [...merged].map(([k, q]) => [k.split(',').map(Number), q]);
    const dists = new Map(), memo = new Map();
    function dist(done) {
      const key = done.join('');
      if (dists.has(key)) return dists.get(key);
      const openIdx = done.map((d, i) => (d ? -1 : i)).filter((i) => i >= 0);
      let d = base;
      if (done.some(Boolean) && openIdx.length) {
        const m = new Map();
        for (const [g, q] of base) {
          let moved = 0;
          const b = g.map((v, i) => { if (done[i]) { moved += v; return 0; } return v; });
          const k = openIdx.length;
          const rec = (left, v, p) => {
            if (!left) { const key2 = v.join(','); m.set(key2, (m.get(key2) || 0) + p); return; }
            for (const i of openIdx) { const v2 = v.slice(); v2[i]++; rec(left - 1, v2, p / k); }
          };
          rec(moved, b, q);
        }
        d = [...m].map(([key2, q]) => [key2.split(',').map(Number), q]);
      }
      dists.set(key, d);
      return d;
    }
    function expect(def, done) {
      if (!def.some((x) => x > 0)) return 0;
      const key = def.join(',') + '|' + done.join('');
      if (memo.has(key)) return memo.get(key);
      let acc = 1, stay = 0;
      for (const [g, q] of dist(done)) {
        const nd = def.map((a, i) => Math.max(0, a - g[i]));
        if (nd.every((v, i) => v === def[i])) stay += q;
        else acc += q * expect(nd, done);
      }
      const v = stay >= 1 ? Infinity : acc / (1 - stay);
      memo.set(key, v);
      return v;
    }
    return {
      substitution,
      expected(deficit, done) {
        return expect(deficit.map((x) => Math.max(0, x | 0)), substitution && done ? done.map(Boolean) : deficit.map(() => false));
      },
    };
  }

  // --- evaluation of an end-of-batch board ----------------------------------------------
  function isolatedEmpty(s) {
    let n = 0;
    const occ = (x, y) => (y < 4 ? (s.lo >>> (y * 8 + x)) & 1 : (s.hi >>> ((y - 4) * 8 + x)) & 1);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      if (occ(x, y)) continue;
      if ((x > 0 && !occ(x - 1, y)) || (x < 7 && !occ(x + 1, y)) || (y > 0 && !occ(x, y - 1)) || (y < 7 && !occ(x, y + 1))) continue;
      n++;
    }
    return n;
  }

  function Evaluator(rules, supply, templatePieces, w) {
    this.rules = rules; this.supply = supply; this.w = w; this.templates = templatePieces;
    this.cache = new Map(); this.riskCache = new Map(); this.w1Cache = new Map(); this.laCache = new Map();
    const r = rng(12345);
    const shapes = templatePieces.map((p) => placements(p, rules).map((pl) => pl));
    this.riskBatches = [];
    for (let i = 0; i < w.risk_samples; i++) this.riskBatches.push([r.pick(shapes), r.pick(shapes), r.pick(shapes)]);
  }

  Evaluator.prototype.done = function (s) { return s.have.map((h, i) => h >= this.rules.need[i]); };

  Evaluator.prototype.clearingCosts = function (s) {
    const rowEmpty = [], colEmpty = [];
    const elo = ~s.lo >>> 0, ehi = ~s.hi >>> 0;
    for (let y = 0; y < 8; y++) rowEmpty.push(y < 4 ? pc32((elo >>> (8 * y)) & 0xff) : pc32((ehi >>> (8 * (y - 4))) & 0xff));
    for (let x = 0; x < 8; x++) colEmpty.push(pc32(elo & COL[x][0]) + pc32(ehi & COL[x][1]));
    let total = 0, worst = 0;
    const deficit = [];
    for (let t = 0; t < this.rules.need.length; t++) {
      const rest = this.rules.need[t] - s.have[t];
      if (rest <= 0) { deficit.push(0); continue; }
      const costs = [];
      for (let half = 0; half < 2; half++) {
        let v = s.g[2 * t + half];
        while (v) {
          const low = v & -v, b = 31 - Math.clz32(low), i = b + 32 * half;
          costs.push(Math.min(rowEmpty[i >> 3], colEmpty[i & 7]));
          v = (v ^ low) >>> 0;
        }
      }
      costs.sort((a, b) => a - b);
      const used = costs.slice(0, rest);
      deficit.push(rest - used.length);
      for (const c of used) total += c;
      if (used.length && used[used.length - 1] > worst) worst = used[used.length - 1];
    }
    return { deficit, total, worst };
  };

  Evaluator.prototype.cheap = function (s) {
    const k = stateKey(s);
    if (this.cache.has(k)) return this.cache.get(k);
    const { deficit, total, worst } = this.clearingCosts(s);
    const w = this.w;
    const crowd = Math.max(0, pc32(s.lo) + pc32(s.hi) - w.crowd_from);
    const v = this.supply.expected(deficit, this.done(s)) + w.w_sum * total + w.w_max * worst +
      w.w_holes * isolatedEmpty(s) + w.w_crowd * crowd * crowd;
    this.cache.set(k, v);
    return v;
  };

  function feasible(lo, hi, batch) {
    if (!batch.length) return true;
    for (let i = 0; i < batch.length; i++) {
      const rest = batch.slice(0, i).concat(batch.slice(i + 1));
      for (const pl of batch[i]) {
        if ((lo & pl.lo) || (hi & pl.hi)) continue;
        const olo = (lo | pl.lo) >>> 0, ohi = (hi | pl.hi) >>> 0;
        let clo = 0, chi = 0;
        for (const li of pl.lines) {
          const L = LINES[li];
          if ((olo & L[0]) >>> 0 === L[0] && (ohi & L[1]) >>> 0 === L[1]) { clo |= L[0]; chi |= L[1]; }
        }
        if (feasible((olo & ~clo) >>> 0, (ohi & ~chi) >>> 0, rest)) return true;
      }
      if (batch.length === 1) return false;
    }
    return false;
  }

  // P(the next batch cannot be placed entirely), on fixed sampled batches.
  Evaluator.prototype.risk = function (s) {
    const k = s.lo + ',' + s.hi;
    if (this.riskCache.has(k)) return this.riskCache.get(k);
    let bad = 0;
    for (const b of this.riskBatches) if (!feasible(s.lo, s.hi, b)) bad++;
    const v = bad / this.riskBatches.length;
    this.riskCache.set(k, v);
    return v;
  };

  // Template pieces with their gems shuffled again (variants), built once.
  Evaluator.prototype.variants = function (seed, count) {
    const r = rng(seed), out = [];
    for (const tp of this.templates) {
      for (let k = 0; k < count; k++) {
        const items = shuffle(tp.cells.map((c) => c[2]), r);
        out.push({ slot: 0, cfgid: tp.cfgid, cells: tp.cells.map(([x, y], i) => [x, y, items[i]]) });
      }
    }
    return out;
  };

  // P(one of the 3 pieces of the next batch wins as soon as it is placed).
  Evaluator.prototype.pWin1 = function (s) {
    const k = stateKey(s);
    if (this.w1Cache.has(k)) return this.w1Cache.get(k);
    if (!this.w1Pieces) this.w1Pieces = this.variants(4242, Math.max(1, this.w.win1_variants));
    const r = rng(99);
    let wins = 0;
    for (let p of this.w1Pieces) {
      if (this.supply.substitution) p = substitute(p, this.rules, s.have, r);
      for (const pl of placements(p, this.rules)) if (fits(s, pl) && apply(this.rules, s, pl).win) { wins++; break; }
    }
    const q = wins / this.w1Pieces.length, v = 1 - (1 - q) ** 3;
    this.w1Cache.set(k, v);
    return v;
  };

  // Two batches ahead: expected cost of the next batch over sampled batches.
  Evaluator.prototype.lookahead = function (s) {
    const k = stateKey(s);
    if (this.laCache.has(k)) return this.laCache.get(k);
    if (!this.inner) {
      this.inner = Object.create(Evaluator.prototype);
      Object.assign(this.inner, this, { w: Object.assign({}, this.w, { la_T: 0, stage2_k: 8 }) });
      this.inner.inner = null;
      const r = rng(777);
      this.laBatches = [];
      for (let i = 0; i < this.w.la_samples; i++) {
        const batch = [];
        for (let slot = 0; slot < 3; slot++) {
          const tp = r.pick(this.templates), items = shuffle(tp.cells.map((c) => c[2]), r);
          batch.push({ slot, cfgid: tp.cfgid, cells: tp.cells.map(([x, y], j) => [x, y, items[j]]) });
        }
        this.laBatches.push(batch);
      }
    }
    let total = 0;
    this.laBatches.forEach((batch, j) => {
      if (this.supply.substitution) { const r = rng(j + 1); batch = batch.map((p) => substitute(p, this.rules, s.have, r)); }
      const p = planBatch(this.rules, s, batch, this.inner);
      total += p.dead ? this.w.la_dead : p.value;
    });
    const v = total / this.laBatches.length;
    this.laCache.set(k, v);
    return v;
  };

  // --- search of one batch ------------------------------------------------------------------
  function signature(piece, rules) {
    return piece.cells.map(([x, y, v]) => x + ':' + y + ':' + (v != null && rules.types.includes(String(v)) ? v : '')).sort().join(';');
  }

  // Best sequence for the visible pieces: all orders and positions, deduplicated states,
  // dead ends removed; shortest win if any, otherwise the best end state by evaluation.
  function planBatch(rules, state, pieces, ev, maxFrontier = 60000) {
    const t0 = Date.now();
    const sigs = pieces.map((p) => signature(p, rules));
    const canon = sigs.map((s) => sigs.indexOf(s));
    const n = pieces.length;
    let frontier = new Map([[canon.slice().sort().join(',') + '|' + stateKey(state), { s: state, path: [], rem: canon.slice().sort() }]]);
    let bestWin = null, ends = null, nodes = 0;
    for (let depth = 1; depth <= n; depth++) {
      const next = new Map();
      for (const { s, path, rem } of frontier.values()) {
        const tried = new Set();
        for (let i = 0; i < n; i++) {
          const c = canon[i];
          if (!rem.includes(c) || tried.has(c) || path.some((m) => m.i === i)) continue;
          tried.add(c);
          const rest = rem.slice(); rest.splice(rest.indexOf(c), 1);
          for (const pl of placements(pieces[i], rules)) {
            if (!fits(s, pl)) continue;
            nodes++;
            const out = apply(rules, s, pl);
            const step = { i, pl, out };
            if (out.win) { if (!bestWin) bestWin = path.concat([step]); continue; }
            const key = rest.join(',') + '|' + stateKey(out.state);
            if (!next.has(key)) next.set(key, { s: out.state, path: path.concat([step]), rem: rest });
          }
        }
      }
      if (bestWin) break;
      if (depth === n) { ends = next; break; }
      if (next.size > maxFrontier) {
        frontier = new Map([...next].sort((a, b) => ev.cheap(a[1].s) - ev.cheap(b[1].s)).slice(0, maxFrontier));
      } else frontier = next;
    }
    const stats = { nodes, ms: 0 };
    const moves = (path) => path.map(({ i, pl, out }) => ({ slot: pieces[i].slot, cfgid: pieces[i].cfgid, x: pl.x, y: pl.y,
      lines: out.lines, gained: out.gained, win: out.win }));
    if (bestWin) {
      stats.ms = Date.now() - t0;
      return { moves: moves(bestWin), win: true, dead: false, value: bestWin.length, end: bestWin[bestWin.length - 1].out.state, stats };
    }
    if (!ends || !ends.size) { stats.ms = Date.now() - t0; return { moves: [], win: false, dead: true, value: Infinity, end: null, stats }; }
    const scored = [...ends.values()].map(({ s, path }) => ({ c: ev.cheap(s), s, path })).sort((a, b) => a.c - b.c);
    stats.endStates = scored.length;
    const w = ev.w;
    const startDeficit = w.la_T > 0 ? ev.clearingCosts(state).deficit : null;
    const nearEnd = w.la_T > 0 && ev.supply.expected(startDeficit, ev.done(state)) <= w.la_T + n;
    const pool = scored.slice(0, Math.max(1, nearEnd && w.w_win1 > 0 ? Math.max(w.stage2_k, w.win1_k) : w.stage2_k));
    const score = ({ c, s }) => {
      if (!(nearEnd && w.w_win1 > 0)) return c + w.w_risk * ev.risk(s);
      const p1 = ev.pWin1(s);
      return p1 + (1 - p1) * (c + w.w_risk * ev.risk(s) + w.w_win1);
    };
    const ranked = pool.map((e) => ({ v: score(e), s: e.s, path: e.path })).sort((a, b) => a.v - b.v);
    let best = ranked[0];
    if (nearEnd) {
      best = null;
      for (const e of ranked.slice(0, w.la_k)) {
        const v = ev.lookahead(e.s);
        if (!best || v < best.v) best = { v, s: e.s, path: e.path };
      }
      stats.lookahead = Math.min(w.la_k, ranked.length);
    }
    stats.ms = Date.now() - t0;
    return { moves: moves(best.path), win: false, dead: false, value: n + best.v, end: best.s, stats };
  }

  // --- levels and the public entry point ------------------------------------------------------
  const LETTER = { A: '640070', B: '640071', C: '640072', D: '640073' };

  function levelSetup(data, levelId) {
    const lv = data.levels.find((l) => l.id === levelId);
    if (!lv) throw new Error('niveau inconnu ' + levelId);
    const types = Object.keys(lv.targets).sort();
    const rules = { types, need: types.map((t) => lv.targets[t]) };
    const templates = data.piece_groups[lv.piece_group];
    const r = rng(0);
    // template pieces (gems on random cells; only shapes and gem counts matter here)
    const tpl = templates.map((t) => {
      const items = [];
      for (const [item, k] of Object.entries(t.gems)) for (let i = 0; i < k; i++) items.push(item);
      const pos = shuffle(t.cells.map((_, i) => i), r).slice(0, items.length);
      const cells = t.cells.map(([x, y]) => [x, y, null]);
      pos.forEach((p, i) => { cells[p][2] = items[i]; });
      return { slot: 0, cfgid: t.cfgid, cells };
    });
    const supply = SupplyModel(templates.map((t) => types.map((x) => t.gems[x] || 0)), !!data.weights.subst);
    return { lv, rules, tpl, supply, templates };
  }

  const setups = new Map();

  // Board (8 strings, top row first; '.', '#', A-D), pieces (strings, top row first, or null)
  // and counters {A: have...} -> advised placements for the pieces in hand.
  function solve(data, input) {
    const { level } = input;
    if (!setups.has(level)) {
      const su = levelSetup(data, level);
      su.ev = new Evaluator(su.rules, su.supply, su.tpl, data.weights);
      setups.set(level, su);
    }
    const su = setups.get(level);
    const { state, hand } = prepare(su.rules, input);
    if (su.ev.cache.size > 300000) { su.ev.cache.clear(); su.ev.riskCache.clear(); su.ev.w1Cache.clear(); su.ev.laCache.clear(); }
    if (!hand.length) return { moves: [], waiting: true };
    return planBatch(su.rules, state, hand, su.ev);
  }

  // Page format (grid strings, piece strings, counters by letter) -> engine state and hand.
  function prepare(rules, { grid, pieces, counters }) {
    const T = rules.types.length;
    let lo = 0, hi = 0;
    const g = new Array(2 * T).fill(0);
    grid.forEach((line, r) => {
      const y = 7 - r;
      for (let x = 0; x < 8; x++) {
        const ch = line[x];
        if (ch === '.') continue;
        const [bl, bh] = bitOf(x, y);
        lo = (lo | bl) >>> 0; hi = (hi | bh) >>> 0;
        const t = ch === '#' ? -1 : rules.types.indexOf(LETTER[ch]);
        if (t >= 0) { g[2 * t] = (g[2 * t] | bl) >>> 0; g[2 * t + 1] = (g[2 * t + 1] | bh) >>> 0; }
      }
    });
    const have = rules.types.map((t) => {
      const letter = Object.keys(LETTER).find((k) => LETTER[k] === t);
      return Math.min(rules.need[rules.types.indexOf(t)], (counters || {})[letter] || 0);
    });
    const state = { lo, hi, g, have };
    const hand = [];
    (pieces || []).forEach((rows, slot) => {
      if (!rows) return;
      const cells = [];
      rows.forEach((line, r) => {
        const y = rows.length - 1 - r;
        for (let x = 0; x < line.length; x++) {
          const ch = line[x];
          if (ch === '.') continue;
          cells.push([x, y, ch === '#' ? null : LETTER[ch]]);
        }
      });
      const mx = Math.min(...cells.map((c) => c[0])), my = Math.min(...cells.map((c) => c[1]));
      hand.push({ slot, cfgid: null, cells: cells.map(([x, y, v]) => [x - mx, y - my, v]) });
    });
    return { state, hand };
  }

  return { solve, prepare, planBatch, apply, placements, SupplyModel, Evaluator, levelSetup, substitute, canPlaceAny, rng, LETTER, stateKey, _pc32: pc32, _bitOf: bitOf };
}));

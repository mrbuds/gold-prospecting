// node test/sim.js [parties par niveau] : parties simulées avec le solveur JS complet
// (modèle « subst » : modèles uniformes, gemmes au hasard, remplacement des objectifs atteints).
// Référence (mêmes règles, autres tirages) : 14,9 coups en moyenne, 0,3 % d'échecs.
'use strict';
const D = require('../data.js');
const S = require('../solver.js');

const games = Number(process.argv[2] || 40);
let totalMoves = 0, wins = 0, played = 0, batchMs = 0, batches = 0;
for (const lv of D.levels) {
  const su = S.levelSetup(D, lv.id);
  const ev = new S.Evaluator(su.rules, su.supply, su.tpl, D.weights);
  const moves = [];
  for (let gidx = 0; gidx < games; gidx++) {
    const r = S.rng(1000 + gidx * 7 + lv.id);
    // initial board
    let st = { lo: 0, hi: 0, g: new Array(2 * su.rules.types.length).fill(0), have: su.rules.types.map(() => 0) };
    for (const c of lv.initial_layout) {
      const [bl, bh] = S._bitOf(c.x, c.y);
      st.lo = (st.lo | bl) >>> 0; st.hi = (st.hi | bh) >>> 0;
      const t = c.item ? su.rules.types.indexOf(c.item) : -1;
      if (t >= 0) { st.g[2 * t] = (st.g[2 * t] | bl) >>> 0; st.g[2 * t + 1] = (st.g[2 * t + 1] | bh) >>> 0; }
    }
    let n = 0, won = false;
    while (n < 120 && !won) {
      const hand = [0, 1, 2].map((slot) => {
        const t = r.pick(su.templates);
        const items = [];
        for (const [item, k] of Object.entries(t.gems)) for (let i = 0; i < k; i++) items.push(item);
        const order = t.cells.map((_, i) => i);
        for (let i = order.length - 1; i > 0; i--) { const j = r.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
        const cells = t.cells.map(([x, y]) => [x, y, null]);
        items.forEach((it, i) => { cells[order[i]][2] = it; });
        return S.substitute({ slot, cfgid: t.cfgid, cells }, su.rules, st.have, r);
      });
      if (!S.canPlaceAny(st, hand, su.rules)) break;
      const t0 = Date.now();
      const plan = S.planBatch(su.rules, st, hand, ev);
      batchMs += Date.now() - t0; batches++;
      if (plan.dead) break;
      for (const m of plan.moves) {
        const p = hand.find((h) => h.slot === m.slot);
        const pl = S.placements(p, su.rules).find((q) => q.x === m.x && q.y === m.y);
        const o = S.apply(su.rules, st, pl);
        st = o.state; n++;
        if (o.win) { won = true; break; }
      }
    }
    played++;
    if (won) { wins++; totalMoves += n; moves.push(n); }
  }
  moves.sort((a, b) => a - b);
  console.log(`${lv.id} : ${moves.length}/${games} gagnées · moyenne ${(moves.reduce((s, v) => s + v, 0) / moves.length).toFixed(2)} · médiane ${moves[moves.length >> 1]} · meilleure ${moves[0]}`);
}
console.log(`Total : ${wins}/${played} gagnées (${(100 * wins / played).toFixed(1)} %) · moyenne ${(totalMoves / wins).toFixed(2)} coups · ${Math.round(batchMs / batches)} ms par lot en moyenne`);

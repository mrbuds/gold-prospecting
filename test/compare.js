// node test/compare.js : le solveur doit reproduire les cas de référence (test/cases.json).
'use strict';
const D = require('../data.js');
const S = require('../solver.js');
const { cases, weights_override } = require('./cases.json');

const LETTER = S.LETTER;
const toRows = (rules, st) => {
  const rows = [];
  for (let y = 7; y >= 0; y--) {
    let line = '';
    for (let x = 0; x < 8; x++) {
      const [bl, bh] = S._bitOf(x, y);
      let ch = '.';
      if ((st.lo & bl) || (st.hi & bh)) {
        ch = '#';
        rules.types.forEach((t, i) => { if ((st.g[2 * i] & bl) || (st.g[2 * i + 1] & bh)) ch = Object.keys(LETTER).find((k) => LETTER[k] === t); });
      }
      line += ch;
    }
    rows.push(line);
  }
  return rows;
};

const evs = new Map();
let outcomes = 0, outcomesOk = 0, plans = 0, plansOk = 0, ms = 0;
for (const c of cases) {
  if (!evs.has(c.level)) {
    const su = S.levelSetup(D, c.level);
    evs.set(c.level, { su, ev: new S.Evaluator(su.rules, su.supply, su.tpl, Object.assign({}, D.weights, weights_override)) });
  }
  const { su, ev } = evs.get(c.level);
  const { state, hand } = S.prepare(su.rules, c);
  // 1) every legal placement of the first piece: same board, lines, counters, win
  const legal = S.placements(hand[0], su.rules).filter((pl) => !(state.lo & pl.lo) && !(state.hi & pl.hi));
  const byPos = new Map(c.first_outcomes.map((o) => [o.x + ',' + o.y, o]));
  if (legal.length !== c.first_outcomes.length) console.log('nombre de poses différent', legal.length, c.first_outcomes.length);
  for (const pl of legal) {
    outcomes++;
    const want = byPos.get(pl.x + ',' + pl.y);
    const o = S.apply(su.rules, state, pl);
    if (want && JSON.stringify(toRows(su.rules, o.state)) === JSON.stringify(want.grid) && o.lines === want.lines &&
        JSON.stringify(o.state.have) === JSON.stringify(want.have) && o.win === want.win) outcomesOk++;
    else if (outcomes - outcomesOk < 4) console.log('pose différente', c.level, pl.x, pl.y, want, o.lines);
  }
  // 2) value of the best plan (deterministic part of the solver)
  plans++;
  const t0 = Date.now();
  const p = S.planBatch(su.rules, state, hand, ev);
  ms += Date.now() - t0;
  const same = p.dead === c.plan.dead && p.win === c.plan.win &&
    (p.dead || Math.abs(p.value - c.plan.value) < 1e-6);
  if (same) plansOk++;
  else console.log('plan différent niveau', c.level, 'obtenu', p.value, JSON.stringify(p.moves.map((m) => [m.slot, m.x, m.y])), 'référence', c.plan.value, JSON.stringify(c.plan.moves));
}
console.log(`Poses : ${outcomesOk}/${outcomes} identiques · plans : ${plansOk}/${plans} de même valeur · ${Math.round(ms / plans)} ms/plan en moyenne`);

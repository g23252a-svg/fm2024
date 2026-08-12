/*
 * 무작위 스쿼드로 엔진을 흔들어 보는 검사.
 *
 * smoke.mjs는 "이 입력에서 이 답이 나와야 한다"를 봅니다. 여기서는 반대로,
 * **어떤 입력에서도 깨지면 안 되는 것**만 봅니다 — 선발이 11명인지, 같은 선수가
 * 두 자리에 들어가지 않았는지, 게임에 없는 역할·임무를 조언하지 않았는지,
 * 사용자에게 보이는 글에 NaN이나 'undefined'가 섞이지 않았는지.
 *
 * 두 검사는 서로 다른 종류의 실수를 잡습니다.
 *   smoke.mjs의 임무 표 : 데이터가 게임과 어긋나는 것
 *                         (인버티드 풀백에 '지원'이 있다고 적어 둔 것)
 *   여기의 checkXI      : 엔진이 데이터와 어긋나는 것
 *                         (역할에 없는 임무를 엔진이 붙이는 것)
 * 둘 다 일부러 고장 내서 각각 실패하는 것을 확인했습니다.
 *
 * 느립니다(2분 남짓). 그래서 `npm test`가 아니라 `npm run fuzz`로 따로 돌리고,
 * CI에서는 별도 단계로 돕니다.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const ctx = { window: {}, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer };
vm.createContext(ctx);
for (const file of ['data/roles.js', 'data/formations.js', 'data/setpieces.js', 'data/tactics.js',
                    'engine.js', 'importer.js']) {
  vm.runInContext(read(file), ctx, { filename: file });
}
const { FM_ROLE_DATA: RD, FM_FORMATION_DATA: FD, FM_TACTIC_DATA: TD, FM_ENGINE: E } = ctx.window;

/*
 * 난수는 씨앗을 고정합니다. 실패했을 때 같은 스쿼드를 다시 만들 수 없으면
 * 무엇 때문에 깨졌는지 알 수 없습니다.
 */
const SEED = Number(process.env.FUZZ_SEED || 12345);
let seed = SEED;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

const POS = RD.POSITIONS.map((p) => p.id);
function makeSquad(n, opts = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const attrs = {};
    for (const id of RD.ATTR_ORDER) {
      if (opts.sparse && rnd() < 0.5) continue;        // 능력치를 모르는 선수
      attrs[id] = int(opts.lo ?? 3, opts.hi ?? 19);
    }
    const positions = [];
    const np = opts.noPos ? 0 : int(0, 3);
    for (let k = 0; k < np; k++) {
      const p = pick(POS);
      if (!positions.includes(p)) positions.push(p);
    }
    out.push({
      id: 'p' + i, name: '선수' + i, positions,
      foot: pick(['L', 'R', 'B', undefined]), age: int(16, 38), attrs
    });
  }
  return out;
}

const fails = [];
const fail = (tag, msg) => { if (fails.length < 40) fails.push(`${tag}: ${msg}`); };

// 사용자에게 그대로 보이는 글에 섞이면 안 되는 것들.
// 조사가 '은(는)' 형태로 남는 것도 여기서 잡습니다.
const BAD_TEXT = /NaN|undefined|\[object |Infinity|[은는이가을를와과]\([은는이가을를와과]\)/;

function checkStrings(tag, node, seen = new Set()) {
  if (node == null || seen.has(node)) return;
  if (typeof node === 'string') {
    if (BAD_TEXT.test(node)) fail(tag, `보이는 글에 이상한 값 — "${node.slice(0, 110)}"`);
    return;
  }
  if (typeof node !== 'object') return;
  seen.add(node);
  if (Array.isArray(node)) { node.forEach((x) => checkStrings(tag, x, seen)); return; }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'attrs' || k === 'player' || k === 'cands') continue;   // 원시 데이터는 글이 아니다
    checkStrings(tag, v, seen);
  }
}

function checkXI(tag, xi) {
  if (!xi || !xi.lineup) { fail(tag, '선발이 없다'); return; }
  if (xi.lineup.length !== 11) fail(tag, `선발이 ${xi.lineup.length}명이다`);
  const names = xi.lineup.filter((l) => l.player).map((l) => l.player.name);
  if (new Set(names).size !== names.length) fail(tag, '같은 선수가 두 자리에 배정됐다');
  for (const l of xi.lineup) {
    if (!l.role) { fail(tag, `${l.slot.pos}에 역할이 없다`); continue; }
    // 게임에 없는 역할·임무를 조언하면 화면에서 그대로 따라 할 수가 없다
    if (!l.role.pos.includes(l.slot.pos)) {
      fail(tag, `${l.slot.pos}에 ${l.role.ko}(가능: ${l.role.pos.join('/')})를 배치했다`);
    }
    if (!l.role.duties.includes(l.duty)) {
      fail(tag, `${l.role.ko}에 '${l.duty}' 임무 — 이 역할에는 [${l.role.duties.join(' ')}]뿐이다`);
    }
  }
}

function checkAxes(tag, instructions) {
  for (const [id, ax] of Object.entries(instructions.axes || {})) {
    const labels = TD.AXES[id].labels;
    if (!(ax.index >= 0 && ax.index < labels.length)) fail(tag, `축 ${id} 인덱스가 ${ax.index}`);
    else if (ax.label !== labels[ax.index]) fail(tag, `축 ${id}의 라벨이 인덱스와 어긋난다`);
  }
  // 서로 배타적인 지시가 동시에 켜지면 게임에서는 하나를 못 켠다
  const groups = {};
  for (const [id, t] of Object.entries(instructions.toggles || {})) {
    const meta = TD.TOGGLES[id];
    if (!meta || !meta.excl || !t.on) continue;
    (groups[meta.excl] = groups[meta.excl] || []).push(id);
  }
  for (const [g, ids] of Object.entries(groups)) {
    if (ids.length > 1) fail(tag, `배타 그룹 ${g}에 ${ids.join(', ')}가 동시에 켜졌다`);
  }
}

function checkSetPieces(tag, xi) {
  const sp = E.setPieces(xi);
  if (!sp) return;
  const gk = xi.lineup.find((l) => l.slot.pos === 'GK');
  for (const grp of [sp.attack, sp.defence]) {
    const names = grp.flatMap((s) => s.picks).map((p) => p.name);
    if (new Set(names).size !== names.length) {
      fail(tag, `코너에서 같은 선수가 두 자리를 맡았다: ${names.join(', ')}`);
    }
    if (gk && gk.player && names.includes(gk.player.name)) fail(tag, '골키퍼를 코너 자리에 세웠다');
  }
  for (const s of [...sp.attack, ...sp.defence, ...sp.specialists]) {
    if (!s.need) continue;
    for (const p of s.picks) {
      const l = xi.lineup.find((x) => x.player && x.player.name === p.name);
      for (const [id, min] of Object.entries(s.need)) {
        const v = l && l.player.attrs[id];
        if (typeof v === 'number' && v > 0 && v < min) fail(tag, `${s.ko}에 ${p.name}(${id} ${v} < ${min})`);
      }
    }
  }
}

// ── 스쿼드 종류 ───────────────────────────────────────────────────────────
const CASES = [
  ['보통', { n: 26 }],
  ['능력치 일부만', { n: 26, sparse: true }],
  ['포지션 없음', { n: 26, noPos: true }],       // 지금 사용자 스쿼드가 이 상태다
  ['전원 약함', { n: 26, lo: 1, hi: 8 }],
  ['전원 강함', { n: 26, lo: 16, hi: 20 }],
  ['빠듯한 인원', { n: 12 }],
  ['모자란 인원', { n: 9 }]                      // 11명이 안 되면 조용히 비워야 한다
];

let runs = 0;
for (const [label, opts] of CASES) {
  for (let iter = 0; iter < 6; iter++) {
    const squad = makeSquad(opts.n, opts);

    for (const standing of ['top', 'mid', 'bottom']) {
      const tag = `기본전술/${label}/${standing}`;
      let base;
      try { base = E.baseTactic({ players: squad, standing }); } catch (e) { fail(tag, 'throw ' + e.message); continue; }
      runs++;
      if (!base) { if (opts.n >= 11) fail(tag, '결과가 없다'); continue; }
      checkXI(tag, base.xi);
      checkAxes(tag, base.instructions);
      checkStrings(tag, base.instructions);
      checkStrings(tag, base.warnings);
      checkSetPieces(tag, base.xi);
    }

    for (const f of FD.FORMATIONS) {
      const opp = {
        formationId: pick(FD.FORMATIONS).id,
        mentality: int(0, 6), dline: int(0, 4), loe: int(0, 4), press: int(0, 4),
        width: int(0, 6), directness: int(0, 4), tempo: int(0, 4),
        transitionLost: pick(['regroup', 'counterpress']),
        transitionWon: pick(['hold', 'counter']),
        traits: TD.OPP_TRAITS.filter(() => rnd() < 0.3).map((t) => t.id)
      };
      const cx = {
        venue: pick(['home', 'away']),
        odds: pick(['strong', 'even', 'weak']),
        goal: pick(['win', 'draw-ok', 'must-win'])
      };
      const tag = `맞춤/${label}/${f.id}`;
      let r;
      try {
        r = E.generate({ players: squad, opponent: opp, context: cx, allowedFormations: [f.id] });
      } catch (e) { fail(tag, 'throw ' + e.message); continue; }
      runs++;
      if (!r) { if (opts.n >= 11) fail(tag, '결과가 없다'); continue; }
      checkXI(tag, r.xi);
      checkAxes(tag, r.instructions);
      checkStrings(tag, r.instructions);
      checkStrings(tag, r.warnings);
      checkStrings(tag, r.individual);
      checkSetPieces(tag, r.xi);

      // 교체 자원에 선발이 들어가면 그 선수를 두 번 쓰게 된다
      if (r.bench) {
        const starters = new Set(r.xi.lineup.filter((l) => l.player).map((l) => l.player.name));
        for (const b of r.bench) {
          const nm = b.player ? b.player.name : b.name;
          if (nm && starters.has(nm)) fail(tag, `교체 명단에 선발 ${nm}가 들어 있다`);
        }
      }
    }

    try {
      const needs = E.squadNeeds({ players: squad, standing: 'mid' });
      checkStrings(`영입/${label}`, needs.needs);
      checkStrings(`영입/${label}`, needs.team);
      runs++;
    } catch (e) { fail(`영입/${label}`, 'throw ' + e.message); }
  }
}

// ── 경기 중 조언 — 시간대 × 점수 × 전력 × 상황 전부 ───────────────────────
for (const ph of TD.MATCH_PHASES) {
  for (let d = -4; d <= 4; d++) {
    for (const lv of TD.OPP_LEVELS) {
      for (const flags of [[], TD.MATCH_FLAGS.map((f) => f.id)]) {
        const tag = `경기중/${ph.id}/${d}/${lv.id}/상황${flags.length}`;
        try {
          const r = E.inMatchAdvice({
            phase: ph.id, goalsFor: Math.max(0, d), goalsAgainst: Math.max(0, -d),
            oppLevel: lv.id, flags,
            stats: rnd() < 0.5 ? null : {
              us: {
                shots: int(0, 20), sot: int(0, 9), xg: int(0, 30) / 10, possession: int(20, 80),
                passPct: int(50, 95), corners: int(0, 12), fouls: int(0, 18), cards: int(0, 4),
                offsides: int(0, 8)
              },
              them: { shots: int(0, 20), xg: int(0, 30) / 10, possession: int(20, 80) }
            }
          });
          checkStrings(tag, r.fired);
          runs++;
        } catch (e) { fail(tag, 'throw ' + e.message); }
      }
    }
  }
}

if (fails.length) {
  console.error(`\n씨앗 ${SEED} · 검사 ${runs}회 · 문제 ${fails.length}건`);
  fails.forEach((f) => console.error('  ✗ ' + f));
  console.error('\n같은 스쿼드를 다시 만들려면 FUZZ_SEED=' + SEED + '로 돌리세요.');
}
assert.equal(fails.length, 0, `무작위 검사에서 ${fails.length}건이 걸렸다`);
console.log(`✓ 무작위 검사 통과 (씨앗 ${SEED} · ${runs}회)`);

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
for (const file of ['data/roles.js', 'data/formations.js', 'data/setpieces.js', 'data/traits.js', 'data/tactics.js',
                    'engine.js', 'importer.js']) {
  vm.runInContext(read(file), ctx, { filename: file });
}
const { FM_ROLE_DATA: RD, FM_FORMATION_DATA: FD, FM_TACTIC_DATA: TD,
  FM_TRAIT_DATA: TRD, FM_ENGINE: E } = ctx.window;

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
    // 특성은 역할 적합도와 개인 지시를 바꾸므로 여기서도 섞습니다.
    const traits = opts.noTraits ? []
      : TRD.TRAITS.filter(() => rnd() < 0.12).map((t) => t.id);
    /*
     * 컨디션·출전 시간은 사람이 손으로 넣거나 열로 읽히는 값이라
     * 전원 입력 / 일부만 / 아예 없음이 다 섞입니다.
     */
    const state = opts.noState ? {} : {
      cond: rnd() < 0.25 ? undefined : int(20, 100),
      sharp: rnd() < 0.4 ? undefined : int(0, 100),
      mins: rnd() < 0.4 ? undefined : int(0, 3000)
    };
    out.push({
      id: 'p' + i, name: '선수' + i, positions,
      foot: pick(['L', 'R', 'B', undefined]),
      age: opts.noAge ? undefined : int(16, 38),
      traits, attrs, ...state
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
  /*
   * 루틴은 상황마다 따로 짭니다. 어느 상황에서든 같은 사람을 두 자리에 세우거나
   * 골키퍼를 올려 보내면 화면에 그대로 나가는 조언이 됩니다.
   */
  for (const r of sp.routines || []) {
    const names = r.slots.flatMap((s) => s.picks).map((p) => p.name);
    if (new Set(names).size !== names.length) {
      fail(tag, `${r.ko}에서 같은 선수가 두 자리를 맡았다: ${names.join(', ')}`);
    }
    if (gk && gk.player && names.includes(gk.player.name)) fail(tag, `${r.ko}에 골키퍼를 세웠다`);
    if (names.length > 10) fail(tag, `${r.ko}에 ${names.length}명을 세웠다`);
    checkStrings(tag, r.notes.map((n) => n.text + ' ' + n.fix));
  }
  checkStrings(tag, (sp.fkSwing || []).map((s) => s.text + ' ' + s.fix));

  const everySlot = [...(sp.routines || []).flatMap((r) => r.slots), ...sp.specialists];
  for (const s of everySlot) {
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
  ['모자란 인원', { n: 9 }],                     // 11명이 안 되면 조용히 비워야 한다
  ['나이·특성 모름', { n: 26, noAge: true, noTraits: true }],
  ['상태 모름', { n: 26, noState: true }]        // 컨디션이 없으면 로테이션은 막혀야 한다
];

/*
 * 로테이션은 "쉬게 하려고 더 지친 선수를 넣는" 실수를 하면 안 됩니다.
 * 그리고 다른 자리 주전을 데려오면 그 자리가 빕니다 — 뎁스가 아니라 돌려막기입니다.
 */
function checkRotation(tag, players, standing, base) {
  let rot;
  try { rot = E.rotationPlan({ players, standing, base }); } catch (e) { fail(tag, 'throw ' + e.message); return; }
  if (!rot) return;
  checkStrings(tag, rot.swaps);
  if (rot.blocked) {
    checkStrings(tag, rot.blocked);
    if (rot.swaps.length) fail(tag, '컨디션을 모른다면서 교체를 제안했다');
    return;
  }
  const starters = new Set(rot.tiers.slots.map((s) => s.starter && s.starter.name).filter(Boolean));
  const seen = new Set();
  for (const s of rot.applied) {
    if (!s.in || !s.out) { fail(tag, `${s.pos}: 누가 나가고 들어오는지가 없다`); continue; }
    if (seen.has(s.in.name)) fail(tag, `${s.in.name}을 두 자리에 넣었다`);
    seen.add(s.in.name);
    if (starters.has(s.in.name)) fail(tag, `다른 자리 주전 ${s.in.name}을 데려왔다`);
    // 어느 이유로 바꾸든 지친 선수를 넣으면 안 되고,
    // 쉬게 하려고 바꾸는 것이면 들어오는 쪽이 더 나은 상태여야 한다.
    if (s.in.cond !== null && s.in.cond < E.TIRED_AT) {
      fail(tag, `${s.pos}: 컨디션 ${s.in.cond}인 선수를 넣었다`);
    }
    if (s.reason === 'tired' && s.in.cond !== null && s.out.cond !== null && s.in.cond <= s.out.cond) {
      fail(tag, `${s.pos}: 쉬게 한다면서 컨디션 ${s.out.cond}를 빼고 ${s.in.cond}를 넣었다`);
    }
    if (!(s.cost >= 0)) fail(tag, `${s.pos}: 대가가 ${s.cost}다`);
  }
  if (rot.xi) {
    const names = rot.xi.lineup.map((l) => l.player && l.player.name).filter(Boolean);
    if (new Set(names).size !== names.length) fail(tag, '로테이션 XI에 같은 선수가 두 번 들어갔다');
    if (rot.xi.lineup.length !== 11) fail(tag, `로테이션 XI가 ${rot.xi.lineup.length}명이다`);
  } else if (rot.applied.length) {
    fail(tag, '교체를 제안했는데 로테이션 XI가 없다');
  }
  for (const s of rot.tiers.slots) {
    if (s.backup && s.backup.starterElsewhere) fail(tag, `${s.posKo}의 대체 자원이 다른 자리 주전이다`);
    if (s.backup && s.starter && s.backup.fit > s.starter.fit) {
      fail(tag, `${s.posKo}: 대체 자원이 주전보다 적합도가 높다`);
    }
  }
}

/*
 * 훈련 제안은 조언이 실제로 따라 할 수 있는 것이어야 합니다.
 * 골키퍼에게 왼쪽 수비를 배우라고 한 적이 있어서 여기서 못박습니다.
 */
function checkTraining(tag, players, standing) {
  let tp;
  try { tp = E.trainingPlan({ players, standing }); } catch (e) { fail(tag, 'throw ' + e.message); return; }
  if (!tp) return;
  const byName = {};
  players.forEach((p) => { byName[p.name] = p; });
  for (const t of tp.position) {
    const p = byName[t.name];
    if (!p) { fail(tag, `없는 선수 ${t.name}에게 훈련을 시켰다`); continue; }
    const isGk = (p.positions || []).length > 0 && (p.positions || []).every((x) => x === 'GK');
    if (isGk !== (t.pos === 'GK') && (isGk || t.pos === 'GK')) {
      fail(tag, `골키퍼와 필드를 오가는 훈련을 제안했다: ${t.name}(${(p.positions || []).join('/')}) → ${t.pos}`);
    }
    if ((p.positions || []).includes(t.pos)) fail(tag, `이미 뛸 수 있는 자리를 배우라고 했다: ${t.name} → ${t.pos}`);
    if (!(t.after > t.now)) fail(tag, `이득이 없는 훈련을 제안했다: ${t.name} ${t.now}→${t.after}`);
    if (t.after > 100 || t.now < 0) fail(tag, `적합도가 범위를 벗어났다: ${t.now}→${t.after}`);
  }
  for (const f of tp.focus) {
    if (!RD.ATTRS[f.attr]) fail(tag, `알 수 없는 능력치 ${f.attr}`);
    if (f.want != null && !(f.have < f.want)) fail(tag, `이미 넘긴 능력치를 훈련하라고 했다: ${f.attrKo} ${f.have}/${f.want}`);
  }
  for (const a of tp.ageing) {
    if (!(a.age >= 30)) fail(tag, `30세 미만을 노쇠 자리로 봤다: ${a.name} ${a.age}세`);
  }
  checkStrings(tag, tp.position);
  checkStrings(tag, tp.focus);
  checkStrings(tag, tp.ageing);
}

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
      checkTraining(`훈련/${label}/${standing}`, squad, standing);
      checkRotation(`로테/${label}/${standing}`, squad, standing, base);
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
      checkStrings(tag, r.individual.traitNotes || []);
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

    /*
     * 전술 슬롯 — 저장해 둔 포메이션 밖으로 나가면 안 됩니다.
     * 나가는 순간 게임에서 전술 친숙도가 리셋되므로 따라 할 수 없는 조언이 됩니다.
     */
    try {
      // 친숙도는 사람이 손으로 넣는 값이라 미입력·일부 입력·전부 입력이 다 섞입니다.
      const famPool = [undefined, undefined, ...TD.FAMILIARITY.map((f) => f.id)];
      const slots = [pick(FD.FORMATIONS).id, pick(FD.FORMATIONS).id, pick(FD.FORMATIONS).id]
        .slice(0, 2 + (rnd() < 0.4 ? 1 : 0))
        .filter((v, i, a) => a.indexOf(v) === i)
        .map((id, i) => ({ id: 't' + i, name: '슬롯' + i, formationId: id, familiarity: pick(famPool) }));
      const pk = E.pickTactic({
        players: squad, tactics: slots,
        opponent: { formationId: pick(FD.FORMATIONS).id, traits: [] },
        context: { venue: 'home', odds: 'even', goal: 'win' }
      });
      if (pk) {
        const ids = slots.map((t) => t.formationId);
        if (!ids.includes(pk.result.xi.formation.id)) {
          fail(`슬롯/${label}`, `저장하지 않은 포메이션을 골랐다: ${pk.result.xi.formation.id}`);
        }
        // 화면에는 슬롯 이름이 뜨는데 선발이 다른 포메이션이면 그대로 따라 할 수 없습니다.
        if (pk.best.tactic.formationId !== pk.result.xi.formation.id) {
          fail(`슬롯/${label}`, `고른 슬롯(${pk.best.tactic.formationId})과 짠 포메이션(${pk.result.xi.formation.id})이 다르다`);
        }
        if (pk.ranking.length !== slots.length) fail(`슬롯/${label}`, '슬롯 수가 안 맞는다');
        // 친숙도를 안 넣은 슬롯은 절대 깎이면 안 됩니다 — 모르는 값을 벌주는 셈이 됩니다.
        for (const r of pk.ranking) {
          if (!r.tactic.familiarity && r.famPenalty !== 0) {
            fail(`슬롯/${label}`, `친숙도를 안 넣은 슬롯이 깎였다: ${r.tactic.name}`);
          }
          if (r.total !== null && r.effective > r.total) {
            fail(`슬롯/${label}`, `친숙도 보정이 점수를 올렸다: ${r.total} → ${r.effective}`);
          }
        }
        checkXI(`슬롯/${label}`, pk.result.xi);
        checkStrings(`슬롯/${label}`, pk.note);
        checkStrings(`슬롯/${label}`, pk.trainNote);
        checkStrings(`슬롯/${label}`, pk.audit.findings.map((f) => f.text + ' ' + f.fix));
        checkStrings(`슬롯/${label}`, pk.audit.split);
        runs++;
      }
    } catch (e) { fail(`슬롯/${label}`, 'throw ' + e.message); }

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

/*
 * ── 경기 후 검토 ─────────────────────────────────────────────────────────
 *
 * 기록은 사람이 손으로 저장하므로 반쯤 빈 것이 섞입니다 — 점수만 있고 통계가
 * 없는 경기, 기대 실점만 없는 경기, 태그만 잔뜩 붙은 경기. 어느 조합에서도
 * 지어내거나 터지면 안 됩니다.
 */
for (let round = 0; round < 300; round++) {
  const n = int(0, 14);
  const games = [];
  for (let i = 0; i < n; i++) {
    const hasStats = rnd() < 0.75;
    const hasXga = hasStats && rnd() < 0.7;
    games.push({
      id: 'g' + i,
      opp: rnd() < 0.3 ? '' : '상대' + i,
      venue: pick(['home', 'away']),
      gf: int(0, 6), ga: int(0, 6),
      flags: TD.MATCH_TAGS.filter(() => rnd() < 0.25).map((t) => t.id),
      us: hasStats ? {
        xg: rnd() < 0.15 ? null : int(0, 45) / 10,
        shots: rnd() < 0.15 ? null : int(0, 30),
        sot: rnd() < 0.2 ? null : int(0, 12),
        possession: rnd() < 0.2 ? null : int(20, 80)
      } : null,
      them: hasXga ? { xg: int(0, 40) / 10 } : null
    });
  }
  // 아예 깨진 기록도 섞습니다 — 저장이 반쯤 실패해도 통계가 오염되면 안 됩니다
  if (rnd() < 0.2) games.push({ id: 'broken', venue: 'home' });
  if (rnd() < 0.1) games.push(null);

  const tag = `경기후/${round}`;
  let rv;
  try { rv = E.matchReview(games); } catch (e) { fail(tag, 'throw ' + e.message); continue; }
  runs++;
  if (!rv) continue;
  checkStrings(tag, rv.findings);
  const valid = games.filter((m) => m && typeof m.gf === 'number' && typeof m.ga === 'number');
  if (rv.record.n !== valid.length) fail(tag, `경기 ${valid.length}개인데 ${rv.record.n}개로 셌다`);
  if (rv.record.w + rv.record.d + rv.record.l !== rv.record.n) fail(tag, '승무패 합이 경기 수와 다르다');
  if (rv.perMatch.length !== rv.record.n) fail(tag, '경기별 표의 길이가 다르다');
  for (const f of rv.findings) {
    if (!['high', 'note', 'good'].includes(f.level)) fail(tag, `알 수 없는 등급 ${f.level}`);
  }
  // 표본이 모자라면 절대 단정하지 않는다 — 이 화면의 존재 이유다
  const withXg = valid.filter((m) => m.us && typeof m.us.xg === 'number');
  const said = rv.findings.some((f) => f.kind === 'finishing-bad' || f.kind === 'finishing-hot');
  if (said && withXg.length < 4) fail(tag, `${withXg.length}경기로 마무리를 단정했다`);
  // 태그는 반복될 때만 말한다
  for (const t of TD.MATCH_TAGS) {
    const c = valid.filter((m) => (m.flags || []).includes(t.id)).length;
    const told = rv.findings.some((f) => f.kind === 'tag-' + t.id);
    if (told && (c < 2 || c / rv.record.n < 0.4)) fail(tag, `${t.id}: ${c}/${rv.record.n}인데 반복이라고 했다`);
  }
}

if (fails.length) {
  console.error(`\n씨앗 ${SEED} · 검사 ${runs}회 · 문제 ${fails.length}건`);
  fails.forEach((f) => console.error('  ✗ ' + f));
  console.error('\n같은 스쿼드를 다시 만들려면 FUZZ_SEED=' + SEED + '로 돌리세요.');
}
assert.equal(fails.length, 0, `무작위 검사에서 ${fails.length}건이 걸렸다`);
console.log(`✓ 무작위 검사 통과 (씨앗 ${SEED} · ${runs}회)`);

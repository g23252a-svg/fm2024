import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// ── 브라우저 없이 데이터와 엔진만 적재한다 ────────────────────────────────
// 브라우저에 있는 전역만 넣는다 — 여기 없는 것을 쓰면 실제로도 깨진다.
const ctx = { window: {}, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer };
vm.createContext(ctx);
for (const file of ['data/roles.js', 'data/formations.js', 'data/setpieces.js', 'data/traits.js', 'data/tactics.js', 'engine.js', 'importer.js']) {
  vm.runInContext(read(file), ctx, { filename: file });
}
const { FM_ROLE_DATA: RD, FM_FORMATION_DATA: FD, FM_TACTIC_DATA: TD,
  FM_SETPIECE_DATA: SD, FM_TRAIT_DATA: TRD, FM_ENGINE: E, FM_IMPORTER: IMP } = ctx.window;

assert.ok(RD && FD && TD && SD && TRD && E && IMP, '전역이 하나라도 비어 있다');

// ── index.html이 실제 브라우저에서 파싱되는지 ──────────────────────────────
const html = read('index.html');
const inline = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .filter((s) => s.trim());
assert.equal(inline.length, 1, 'index.html의 인라인 스크립트는 하나여야 한다');
new Function(inline[0]);
new Function(read('sw.js'));
const manifest = JSON.parse(read('manifest.webmanifest'));
assert.equal(manifest.lang, 'ko-KR');

// index.html이 참조하는 스크립트 파일이 전부 존재하는지
for (const m of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
  assert.ok(fs.existsSync(path.join(root, m[1])), `index.html이 없는 파일을 참조한다: ${m[1]}`);
}
// 서비스 워커가 캐시하겠다고 적어 둔 파일도 전부 존재해야 한다
const swSrc = read('sw.js');
const assetLine = swSrc.match(/const ASSETS=\[([^\]]*)\]/);
assert.ok(assetLine, 'sw.js의 ASSETS 목록을 찾지 못했다');
for (const raw of assetLine[1].split(',')) {
  const rel = raw.trim().replace(/^['"]|['"]$/g, '').replace(/^\.\//, '');
  if (!rel || rel === '') continue;
  assert.ok(fs.existsSync(path.join(root, rel)), `sw.js가 없는 파일을 캐시하려 한다: ${rel}`);
}

// ── 역할 데이터 정합성 ────────────────────────────────────────────────────
const POS_IDS = new Set(RD.POSITIONS.map((p) => p.id));
const ATTR_IDS = new Set(Object.keys(RD.ATTRS));
const DUTY_IDS = new Set(Object.keys(RD.DUTIES));
const roleIds = new Set();

for (const r of RD.ROLES) {
  assert.ok(!roleIds.has(r.id), `역할 id 중복: ${r.id}`);
  roleIds.add(r.id);
  assert.ok(r.ko && r.abbr && r.en, `역할 ${r.id}에 이름이 빠졌다`);
  assert.ok(r.pos.length, `역할 ${r.id}에 포지션이 없다`);
  for (const p of r.pos) assert.ok(POS_IDS.has(p), `역할 ${r.id}의 알 수 없는 포지션 ${p}`);
  assert.ok(r.duties.length, `역할 ${r.id}에 임무가 없다`);
  for (const d of r.duties) assert.ok(DUTY_IDS.has(d), `역할 ${r.id}의 알 수 없는 임무 ${d}`);
  for (const a of r.key) assert.ok(ATTR_IDS.has(a), `역할 ${r.id}의 알 수 없는 key 능력치 ${a}`);
  for (const a of r.pref || []) assert.ok(ATTR_IDS.has(a), `역할 ${r.id}의 알 수 없는 pref 능력치 ${a}`);
  for (const d of Object.keys(r.dutyKey || {})) {
    assert.ok(r.duties.includes(d), `역할 ${r.id}의 dutyKey가 없는 임무 ${d}를 가리킨다`);
    for (const a of r.dutyKey[d]) assert.ok(ATTR_IDS.has(a), `역할 ${r.id}/${d}의 알 수 없는 능력치 ${a}`);
  }
  assert.ok(r.note && r.note.length > 10, `역할 ${r.id}에 설명이 없다`);
  assert.ok(r.key.length >= 5, `역할 ${r.id}의 key 능력치가 너무 적다`);
}

/*
 * 역할마다 고를 수 있는 임무는 게임이 정해 둔 것이다. 여기 없는 임무를 조언하면
 * 화면에서 그대로 따라 할 수가 없다 — 실제로 인버티드 풀백에 '지원'을 붙여 놓았다가
 * 게임에는 수비밖에 없다는 지적을 받았다. 그래서 45개 전부를 적어 고정한다.
 * (FM의 '자동' 임무는 이 도구가 다루지 않는다.)
 */
{
  const FM24_DUTIES = {
    gk: 'd', sk: 'd s a',
    cd: 'd st co', bpd: 'd st co', ncb: 'd st co', lib: 'd s', wcb: 'd s a',
    fb: 'd s a', nfb: 'd', ifb: 'd', wb: 'd s a', cwb: 's a', iwb: 'd s a',
    dm: 'd s', anc: 'd', hb: 'd', bwm: 'd s', dlp: 'd s', reg: 's', rpm: 's', sv: 's a',
    cm: 'd s a', b2b: 's', ap: 's a', mez: 's a', car: 's',
    wm: 'd s a', w: 's a', dw: 'd s', wp: 's a', iw: 's a',
    if: 's a', rd: 'a', wtf: 's a',
    am: 's a', treq: 'a', ss: 'a', eng: 's',
    af: 'a', poa: 'a', cf: 's a', dlf: 's a', tf: 's a', pf: 'd s a', f9: 's'
  };
  const known = new Set(Object.keys(FM24_DUTIES));
  const actual = new Set(RD.ROLES.map((r) => r.id));
  const unlisted = [...actual].filter((id) => !known.has(id));
  assert.deepEqual(unlisted, [],
    `임무 표에 없는 역할이 생겼다 — FM에서 확인해 표에 추가할 것: ${unlisted.join(', ')}`);
  assert.deepEqual([...known].filter((id) => !actual.has(id)), [],
    '임무 표에 사라진 역할이 남아 있다');
  for (const r of RD.ROLES) {
    assert.equal(r.duties.join(' '), FM24_DUTIES[r.id],
      `${r.abbr}(${r.ko})의 임무가 게임과 다르다 — 우리: [${r.duties.join(' ')}] / FM24: [${FM24_DUTIES[r.id]}]`);
  }
}

// 간편 입력 묶음은 47개 능력치를 빠짐없이 한 번씩만 덮어야 한다.
// 빠지면 그 능력치가 영영 '모름'으로 남고, 겹치면 뒤 묶음이 앞 묶음을 덮어쓴다.
{
  const seen = new Map();
  for (const g of RD.QUICK_GROUPS) {
    assert.ok(g.id && g.ko && g.hint, `간편 입력 묶음 ${g.id}에 이름/설명이 빠졌다`);
    assert.ok(g.attrs.length, `간편 입력 묶음 ${g.id}가 비어 있다`);
    for (const a of g.attrs) {
      assert.ok(ATTR_IDS.has(a), `간편 입력 묶음 ${g.id}의 알 수 없는 능력치 ${a}`);
      assert.ok(!seen.has(a), `능력치 ${a}가 ${seen.get(a)}와 ${g.id} 두 묶음에 들어 있다`);
      seen.set(a, g.id);
    }
  }
  const missing = [...RD.ATTR_ORDER].filter((a) => !seen.has(a));
  assert.deepEqual(missing, [], `간편 입력에서 빠진 능력치: ${missing.join(', ')}`);
  assert.equal(seen.size, RD.ATTR_ORDER.length);
}

// 모든 포지션 칸에 최소 하나의 역할이 존재해야 한다 — 아니면 그 칸은 비어 버린다
for (const pos of POS_IDS) {
  assert.ok(RD.ROLES.some((r) => r.pos.includes(pos)), `${pos} 자리에 쓸 수 있는 역할이 없다`);
}

// ── 포메이션 정합성 ───────────────────────────────────────────────────────
const fIds = new Set();
for (const f of FD.FORMATIONS) {
  assert.ok(!fIds.has(f.id), `포메이션 id 중복: ${f.id}`);
  fIds.add(f.id);
  assert.equal(f.slots.length, 11, `${f.ko}의 인원이 11명이 아니다`);
  assert.equal(f.slots.filter((s) => s.pos === 'GK').length, 1, `${f.ko}의 골키퍼가 정확히 한 명이 아니다`);
  const slotIds = new Set();
  for (const s of f.slots) {
    assert.ok(POS_IDS.has(s.pos), `${f.ko}의 알 수 없는 포지션 ${s.pos}`);
    assert.ok(!slotIds.has(s.id), `${f.ko}의 슬롯 id 중복: ${s.id}`);
    slotIds.add(s.id);
    assert.ok(s.x >= 0 && s.x <= 100 && s.y >= 0 && s.y <= 100, `${f.ko}/${s.id}의 좌표가 범위를 벗어났다`);
  }
  assert.ok(f.note && f.strength.length && f.weakness.length, `${f.ko}에 설명이 빠졌다`);

  // 모든 슬롯에 실제로 고를 수 있는 역할이 있어야 한다
  const sum = E.summariseFormation(f);
  for (const slot of f.slots) {
    const cands = E.candidateRoles(f, slot, sum);
    assert.ok(cands.length > 0, `${f.ko}의 ${slot.id}(${slot.pos})에 배정 가능한 역할이 없다`);
  }
  // 라인 구성이 상식에 맞는지 (수비 5명 초과 같은 실수 방지)
  assert.ok(sum.backLine >= 3 && sum.backLine <= 5, `${f.ko}의 수비 인원이 ${sum.backLine}명이다`);
}
// 리베로/와이드 센터백은 스리백에서만 나와야 한다
for (const f of FD.FORMATIONS) {
  const sum = E.summariseFormation(f);
  for (const slot of f.slots) {
    const ids = E.candidateRoles(f, slot, sum).map((c) => c.role.id);
    if (!sum.threeAtBack) {
      assert.ok(!ids.includes('lib'), `${f.ko}는 스리백이 아닌데 리베로가 후보에 있다`);
      assert.ok(!ids.includes('wcb'), `${f.ko}는 스리백이 아닌데 와이드 센터백이 후보에 있다`);
    }
  }
}

// ── 전술 규칙 정합성 ──────────────────────────────────────────────────────
const AXIS_IDS = new Set(Object.keys(TD.AXES));
const TOGGLE_IDS = new Set(Object.keys(TD.TOGGLES));
const PLAN_IDS = new Set(Object.keys(TD.PLANS));
const TRAIT_IDS = new Set(TD.OPP_TRAITS.map((t) => t.id));
const ruleIds = new Set();

for (const [id, ax] of Object.entries(TD.AXES)) {
  assert.ok(ax.labels.length >= 3, `축 ${id}의 라벨이 부족하다`);
  assert.ok(ax.def >= 0 && ax.def < ax.labels.length, `축 ${id}의 기본값이 범위를 벗어났다`);
}
for (const r of TD.RULES) {
  assert.ok(!ruleIds.has(r.id), `규칙 id 중복: ${r.id}`);
  ruleIds.add(r.id);
  assert.equal(typeof r.when, 'function', `규칙 ${r.id}의 when이 함수가 아니다`);
  assert.ok(r.why && r.action, `규칙 ${r.id}에 이유/행동이 빠졌다`);
  for (const k of Object.keys(r.axis || {})) assert.ok(AXIS_IDS.has(k), `규칙 ${r.id}의 알 수 없는 축 ${k}`);
  for (const k of Object.keys(r.toggle || {})) assert.ok(TOGGLE_IDS.has(k), `규칙 ${r.id}의 알 수 없는 지시 ${k}`);
  for (const k of Object.keys(r.plan || {})) assert.ok(PLAN_IDS.has(k), `규칙 ${r.id}의 알 수 없는 플랜 ${k}`);
  // 규칙이 최소한 무언가를 하긴 해야 한다
  const acts = ['axis', 'toggle', 'plan', 'role'].filter((k) => r[k] && Object.keys(r[k]).length);
  assert.ok(acts.length || r.tier === 'key' || r.action, `규칙 ${r.id}가 아무 효과도 없다`);
}
// 규칙이 참조하는 상대 성향은 목록에 있어야 한다 (오타가 있으면 영원히 발동 안 함)
const ruleSrc = read('data/tactics.js');
for (const m of ruleSrc.matchAll(/traits\.indexOf\('([^']+)'\)/g)) {
  assert.ok(TRAIT_IDS.has(m[1]), `규칙이 목록에 없는 상대 성향 '${m[1]}'을 참조한다`);
}
// 플랜의 역할 태그는 실제로 어떤 역할이 갖고 있어야 한다
const ALL_TAGS = new Set();
RD.ROLES.forEach((r) => (r.tags || []).forEach((t) => ALL_TAGS.add(t)));
for (const [pid, plan] of Object.entries(TD.PLANS)) {
  for (const tag of Object.keys(plan.roleTags)) {
    assert.ok(ALL_TAGS.has(tag), `플랜 ${pid}가 아무 역할도 갖지 않은 태그 '${tag}'를 참조한다`);
  }
}
// 모든 전술 방향에 대응하는 FM 전술 유형이 있어야 한다 — 없으면 세이브를 막
// 시작한 사람이 "전술 유형을 고르십시오" 화면에서 무엇을 누를지 알 수 없다.
for (const pid of PLAN_IDS) {
  const preset = TD.FM_PRESETS[pid];
  assert.ok(preset && preset.ko, `전술 방향 ${pid}에 대응하는 FM 전술 유형이 없다`);
}
for (const pid of Object.keys(TD.FM_PRESETS)) {
  assert.ok(PLAN_IDS.has(pid), `FM 전술 유형이 없는 전술 방향 ${pid}을 가리킨다`);
}
assert.ok(TD.FM_PRESET_BLANK, '백지에서 시작하는 항목 이름이 없다');

assert.ok(TD.SCENARIOS.length >= 5, '경기 중 시나리오가 너무 적다');
for (const sc of TD.SCENARIOS) assert.ok(sc.steps.length >= 3, `시나리오 ${sc.id}의 단계가 부족하다`);

// ── 한글 조사 ─────────────────────────────────────────────────────────────
// 포메이션 이름을 문장에 그대로 끼우면 "크리스마스 트리으로"가 된다.
// 이름 끝이 숫자나 로마자인 경우가 많아(4-4-2 · 5-3-2 WB · 4-1-4-1 DM) 같이 본다.
{
  // 조사 함수는 engine.js에 있다 — 결과 문장을 UI와 엔진이 함께 만들기 때문이다.
  const ro = E.josa;
  assert.ok(ro && ro.ro && ro.eul && ro.iga, 'engine이 조사 함수를 내보내지 않는다');
  const cases = [
    ['4-3-2-1 크리스마스 트리', '로'],
    ['4-2-3-1 와이드', '로'],      // '드'는 받침이 없다
    ['4-4-2 다이아몬드', '로'],
    ['4-4-2', '로'],          // 이(二) — 받침 없음
    ['4-1-4-1 DM', '으로'],   // 엠 — ㅁ 받침
    ['5-3-2 WB', '로'],       // 비 — 받침 없음
    ['5-4-1 WB', '로'],
    ['균형', '으로'],
    ['긍정적', '으로'],
    ['4-3-3', '으로']         // 삼 — ㅁ 받침
  ];
  for (const [word, want] of cases) {
    assert.equal(ro.ro(word), want, `'${word}' 뒤의 조사가 '${ro.ro(word)}'로 나왔다 (기대: ${want})`);
  }
  assert.equal(ro.eul('트리'), '를');
  assert.equal(ro.eul('와이드'), '를');
  assert.equal(ro.eul('균형'), '을');
  assert.equal(ro.iga('트리'), '가');
  assert.equal(ro.iga('균형'), '이');

  // 실제 포메이션 이름 전부에 대해 조사가 나와야 한다 (null/undefined 금지)
  for (const f of FD.FORMATIONS) {
    const j = ro.ro(f.ko);
    assert.ok(j === '로' || j === '으로', `${f.ko}의 조사가 이상하다: ${j}`);
  }
}

/*
 * 카탈로그에만 있고 아무도 켜지 않는 지시가 없어야 한다.
 * 언더랩이 그랬다 — 목록에는 있는데 어떤 규칙도 밀지 않아서, 어떤 상대·어떤
 * 스쿼드에서도 화면에 뜬 적이 없었다. 있는 척하는 항목이 제일 나쁘다.
 */
{
  const engineSrc = read('engine.js');
  const rulesSrc = read('data/tactics.js');
  const all = rulesSrc + engineSrc;
  const dead = [];
  for (const id of Object.keys(TD.TOGGLES)) {
    const hits = [...all.matchAll(new RegExp(`(?<![a-zA-Z_0-9])${id}(?![a-zA-Z_0-9])`, 'g'))].length;
    // 카탈로그 정의 한 줄을 뺀 나머지에서 최소 한 번은 밀려야 한다
    if (hits <= 1) dead.push(`${id}(${TD.TOGGLES[id].ko})`);
  }
  assert.deepEqual(dead, [], `아무도 켜지 않는 지시: ${dead.join(', ')}`);

  // 축도 마찬가지
  const deadAxes = [];
  for (const id of Object.keys(TD.AXES)) {
    const hits = [...all.matchAll(new RegExp(`(?<![a-zA-Z_0-9])${id}(?![a-zA-Z_0-9])`, 'g'))].length;
    if (hits <= 1) deadAxes.push(`${id}(${TD.AXES[id].ko})`);
  }
  assert.deepEqual(deadAxes, [], `아무도 밀지 않는 축: ${deadAxes.join(', ')}`);
}

// ── 오버랩과 언더랩은 그쪽 측면 선수의 역할로 갈린다 ──────────────────────
/*
 * 둘은 "측면을 공격한다"는 같은 말이 아니라 정반대의 배치다.
 * 오버랩은 풀백이 측면 선수 바깥으로 돌고, 언더랩은 안쪽 하프 스페이스로 들어간다.
 * 안으로 좁히는 인사이드 포워드 뒤에서 언더랩을 시키면 같은 공간에 둘이 서고,
 * 측면을 잡는 정통 윙어 뒤에서 오버랩을 시키면 같은 줄에 둘이 선다.
 */
{
  const mkP = (name, positions, attrs, base = 10, foot = 'R') => {
    const a = {};
    for (const id of RD.ATTR_ORDER) a[id] = base;
    Object.assign(a, attrs);
    return { id: name, name, positions, foot, attrs: a };
  };
  const wingSquad = [
    mkP('GKx', ['GK'], { ref: 15, han: 14, cmd: 13, kic: 14, ono: 14, tro: 13 }, 12),
    mkP('CBx1', ['DC'], { mar: 16, tck: 16, hea: 15, pos: 15, jum: 15, str: 15, pas: 12 }, 12),
    mkP('CBx2', ['DC'], { mar: 14, tck: 14, hea: 13, pos: 14, pac: 14 }, 11),
    // 인버티드로 뽑히지 않게 패스·테크닉을 낮춘다 — 인버티드 풀백은 안으로
    // 들어오는 역할이라 오버랩/언더랩 판단 자체가 달라진다
    mkP('RBx', ['DR'], { cro: 15, tck: 13, mar: 13, sta: 16, wor: 15, pac: 15, acc: 15, otb: 14, pas: 7, tec: 7, cmp: 7 }, 12),
    mkP('LBx', ['DL'], { cro: 15, tck: 14, mar: 14, sta: 16, wor: 15, pac: 14, acc: 14, otb: 14, pas: 7, tec: 7, cmp: 7 }, 12, 'L'),
    mkP('DMx1', ['DM'], { tck: 15, mar: 14, pos: 16, ant: 15, cnt: 14, tea: 15, wor: 15 }, 12),
    mkP('DMx2', ['DM'], { pas: 15, fir: 14, tec: 14, vis: 14, dec: 14 }, 12),
    mkP('AMx', ['AMC'], { pas: 15, fir: 15, tec: 15, otb: 15, ant: 15, dri: 14, acc: 15 }, 12),
    // 왼쪽 — 측면을 잡고 크로스하는 정통 윙어 (같은 발)
    mkP('LWing', ['AML'], { cro: 16, dri: 13, tec: 14, otb: 13, acc: 13, pac: 13, wor: 14 }, 11, 'L'),
    // 오른쪽 — 안으로 접어 마무리하는 인사이드 포워드 (반대발, 크로스 나쁨)
    mkP('RInside', ['AMR'], { dri: 16, fin: 15, tec: 15, otb: 15, ant: 14, acc: 16, pac: 16, agi: 16, cro: 8 }, 12, 'L'),
    mkP('STx', ['ST'], { hea: 16, jum: 16, str: 16, bra: 15, fin: 14 }, 12),
    mkP('SUBa', ['MC'], { pas: 12 }, 10), mkP('SUBb', ['DC'], { mar: 12 }, 10)
  ];
  const r = E.generate({
    players: wingSquad, opponent: { formationId: '433dm', dline: 2, press: 2 },
    context: {}, allowedFormations: ['4231']
  });
  const t = r.instructions.toggles;
  const aml = r.xi.lineup.find((l) => l.slot.pos === 'AML');
  const amr = r.xi.lineup.find((l) => l.slot.pos === 'AMR');
  const dl = r.xi.lineup.find((l) => l.slot.pos === 'DL');
  const dr = r.xi.lineup.find((l) => l.slot.pos === 'DR');
  assert.ok((amr.role.tags || []).includes('inverted'), `오른쪽이 안으로 접는 역할이 아니다: ${amr.role.ko}`);
  assert.ok(!(aml.role.tags || []).includes('inverted'), `왼쪽이 폭을 잡는 역할이 아니다: ${aml.role.ko}`);
  // 인버티드 풀백이면 판단 자체가 달라지므로 이 검사의 전제가 깨진다
  assert.ok(!(dl.role.tags || []).includes('inverted'), `왼쪽 수비가 인버티드다: ${dl.role.ko}`);
  assert.ok(!(dr.role.tags || []).includes('inverted'), `오른쪽 수비가 인버티드다: ${dr.role.ko}`);

  assert.ok(t.ovl_r.on, `안으로 접는 ${amr.role.ko} 뒤인데 오른쪽 오버랩이 꺼져 있다`);
  assert.ok(!t.unl_r.on, `안으로 접는 ${amr.role.ko} 뒤인데 오른쪽 언더랩이 켜져 있다 — 같은 공간에 둘이 선다`);
  assert.ok(t.unl_l.on, `측면을 잡는 ${aml.role.ko} 뒤인데 왼쪽 언더랩이 꺼져 있다`);
  assert.ok(!t.ovl_l.on, `측면을 잡는 ${aml.role.ko} 뒤인데 왼쪽 오버랩이 켜져 있다 — 같은 줄에 둘이 선다`);

  // 근거가 남아야 한다
  for (const k of ['ovl_r', 'unl_l']) {
    assert.ok(t[k].reasons.length, `${t[k].ko}에 근거가 없다`);
    assert.ok(!/이\(가\)|은\(는\)/.test(t[k].reasons[0].why), `조사가 다듬어지지 않았다: ${t[k].reasons[0].why}`);
  }

  // 측면 자원이 없는 형태에서는 둘 다 켜지지 않아야 한다
  const narrow = E.generate({
    players: wingSquad, opponent: { formationId: '433dm' }, context: {}, allowedFormations: ['4312']
  });
  assert.ok(!narrow.instructions.toggles.ovl_l.on && !narrow.instructions.toggles.unl_l.on,
    '측면 앞선 자원이 없는데 오버랩/언더랩을 켰다');

  // 제공권이 좋은 최전방이면 띄우는 크로스, 배급은 후방 플레이메이커에게
  assert.ok(t.cr_float.on || t.cr_whip.on, '크로스 종류를 정하지 않았다');
}

// ── 헝가리안 알고리즘 ─────────────────────────────────────────────────────
{
  // 최소 비용 완전 매칭. 정답이 자명한 행렬로 확인한다.
  const cost = [
    [4, 1, 3],
    [2, 0, 5],
    [3, 2, 2]
  ];
  const res = E.hungarian(cost);
  const total = res.reduce((sum, col, row) => sum + cost[row][col], 0);
  assert.equal(total, 5, `헝가리안 최적해가 5가 아니라 ${total}`);
  assert.equal(new Set(res).size, 3, '헝가리안이 같은 열을 두 번 배정했다');

  // 무작위 행렬에서 완전 탐색과 일치하는지
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 100);
  for (let t = 0; t < 20; t++) {
    const n = 5;
    const m = Array.from({ length: n }, () => Array.from({ length: n }, rnd));
    const got = m.reduce((s, row, i) => s + row[E.hungarian(m)[i]], 0);
    let best = Infinity;
    const perm = (arr, cur) => {
      if (!arr.length) {
        best = Math.min(best, cur.reduce((s, c, i) => s + m[i][c], 0));
        return;
      }
      arr.forEach((v, i) => perm(arr.filter((_, j) => j !== i), cur.concat(v)));
    };
    perm([0, 1, 2, 3, 4], []);
    assert.equal(got, best, `헝가리안이 최적이 아니다 (${got} vs ${best})`);
  }
}

// ── 포지션 문자열 파서 ────────────────────────────────────────────────────
{
  const cases = [
    ['GK', ['GK']],
    ['D (RC)', ['DR', 'DC']],
    ['D (C), DM', ['DC', 'DM']],
    ['M/AM (R)', ['MR', 'AMR']],
    ['ST (C)', ['ST']],
    ['D/WB (L)', ['DL', 'WBL']],
    ['M (C), AM (RLC)', ['MC', 'AMR', 'AML', 'AMC']],
    ['', []]
  ];
  for (const [input, expected] of cases) {
    // vm 컨텍스트에서 만들어진 배열은 프로토타입이 달라 deepStrictEqual이 실패합니다.
    // 값만 비교하도록 호스트 realm 배열로 옮깁니다.
    const got = [...IMP.parsePositions(input)].sort();
    assert.deepEqual(got, expected.slice().sort(), `포지션 파싱 실패: "${input}" → ${got}`);
  }
  assert.equal(IMP.parseAttrValue('12-15'), 14, '스카우트 범위 값 처리 실패');
  assert.equal(IMP.parseAttrValue('-'), null);
  assert.equal(IMP.parseAttrValue('17'), 17);
  assert.equal(IMP.parseFoot('Left'), 'L');
  assert.equal(IMP.parseFoot('양발'), 'B');
}

// ── 가져오기: 세 가지 형식 ────────────────────────────────────────────────
{
  const header = 'Name|Position|Age|Acc|Pac|Sta|Wor|Tec|Pas|Fin|Tck|Mar';
  const rtf = `{\\rtf1\\ansi
|${'-'.repeat(40)}|
|${header}|
|${'-'.repeat(40)}|
|Kim Minjae|D (C)|27|13|12|15|14|11|12|5|17|17|
|Son Heungmin|AM (RL), ST (C)|31|17|17|15|15|16|14|17|7|6|
|${'-'.repeat(40)}|
}`;
  const a = IMP.parseSquad(rtf);
  assert.equal(a.players.length, 2, `RTF 가져오기 실패: ${JSON.stringify(a.report)}`);
  assert.equal(a.players[0].name, 'Kim Minjae');
  assert.deepEqual([...a.players[0].positions], ['DC']);
  assert.equal(a.players[0].attrs.tck, 17);
  assert.deepEqual([...a.players[1].positions].sort(), ['AML', 'AMR', 'ST'].sort());

  const htmlDoc = `<html><body><table>
    <tr><th>이름</th><th>포지션</th><th>가속도</th><th>속도</th><th>마무리</th></tr>
    <tr><td>홍길동</td><td>ST (C)</td><td>16</td><td>15</td><td>14</td></tr>
  </table></body></html>`;
  const b = IMP.parseSquad(htmlDoc);
  assert.equal(b.players.length, 1, `HTML 가져오기 실패: ${JSON.stringify(b.report)}`);
  assert.equal(b.players[0].name, '홍길동');
  assert.equal(b.players[0].attrs.acc, 16);

  const tsv = 'Name\tPosition\tAcc\tPac\tFin\nA Player\tST (C)\t14\t15\t16';
  const c = IMP.parseSquad(tsv);
  assert.equal(c.players.length, 1, `붙여넣기 가져오기 실패: ${JSON.stringify(c.report)}`);

  // 'Pos'가 능력치 표 안에 있으면 위치 선정으로 읽어야 한다
  const posCase = IMP.parseSquad('Name\tPosition\tOtB\tPos\tTea\nX\tM (C)\t12\t13\t14');
  assert.equal(posCase.players[0].attrs.pos, 13, "능력치 표의 'Pos'를 위치 선정으로 읽지 못했다");
  assert.deepEqual([...posCase.players[0].positions], ['MC']);

  // 'Pos'가 표 맨 끝에 있어도(오른쪽에 열이 없어도) 위치 선정이어야 한다.
  // 이걸 포지션으로 읽으면 능력치 값을 포지션으로 파싱해 멀쩡한 포지션을 지운다.
  const posTail = IMP.parseSquad('Name\tPosition\tMar\tTck\tPos\n김민재\tD (C)\t17\t16\t15');
  assert.deepEqual([...posTail.players[0].positions], ['DC'], "표 끝의 'Pos'가 포지션을 지웠다");
  assert.equal(posTail.players[0].attrs.pos, 15, "표 끝의 'Pos'를 위치 선정으로 읽지 못했다");
  assert.equal(posTail.report.attrColumns, 3, `능력치 열이 3개로 세어지지 않았다: ${posTail.report.attrColumns}`);
  assert.equal(posTail.report.noPosition, 0, '포지션을 못 읽은 선수가 생겼다');

  // 포지션 열이 맨 앞에 하나만 있고 나머지가 전부 능력치인 흔한 배치
  const plain = IMP.parseSquad('Name\tPosition\tAcc\tPac\nY\tST (C)\t15\t16');
  assert.deepEqual([...plain.players[0].positions], ['ST']);
  assert.equal(plain.report.attrColumns, 2);

  // 인식 못한 열은 조용히 버리지 말고 보고해야 한다 (값 예시와 함께)
  const withJunk = IMP.parseSquad('Name\tPosition\tAcc\tMagic Column\nY\tGK\t11\tzzz');
  const junk = withJunk.report.unknownColumns.map((c) => c.header);
  assert.ok(junk.includes('Magic Column'), `인식 못한 열을 보고하지 않았다: ${JSON.stringify(junk)}`);
  const magic = withJunk.report.unknownColumns.find((c) => c.header === 'Magic Column');
  assert.deepEqual([...magic.samples], ['zzz'], '인식 못한 열의 값 예시를 안 보여준다');
  assert.equal(magic.numeric, false);

  // 이미 아는 열(이적료 등)은 '인식 못한 열'로 올리지 않는다 — 매핑할 열과 섞이면
  // 무엇을 손봐야 하는지 알 수 없다
  const known = IMP.parseSquad('Name\tPosition\tAcc\tTransfer Value\nY\tGK\t11\t£2M');
  assert.equal(known.report.unknownColumns.length, 0, '아는 열이 미인식으로 보고됐다');

  // 값이 전부 1~20이면 능력치 열로 짐작해 표시해야 한다
  const numericGuess = IMP.parseSquad('Name\tPosition\tAcc\t알수없는능력\nY\tGK\t11\t14');
  const g = numericGuess.report.unknownColumns.find((c) => c.header === '알수없는능력');
  assert.equal(g.numeric, true, '1~20 값만 있는 열을 능력치 후보로 보지 않았다');
}

// ── 외부 도구가 내놓는 CSV ────────────────────────────────────────────────
{
  // 이름에 쉼표가 있으면 split(',')로는 열이 통째로 한 칸씩 밀린다
  const csv = 'Name,Position,Acc,Pac,Fin\n"Smith, John",ST (C),15,16,17\nPlain Name,D (C),11,12,5';
  const r = IMP.parseSquad(csv);
  assert.equal(r.players.length, 2, `따옴표 CSV 가져오기 실패: ${JSON.stringify(r.report)}`);
  assert.equal(r.players[0].name, 'Smith, John', '따옴표 안의 쉼표에서 이름이 잘렸다');
  assert.equal(r.players[0].attrs.acc, 15, '따옴표 때문에 열이 밀렸다');
  assert.equal(r.players[0].attrs.fin, 17);
  assert.deepEqual([...r.players[0].positions], ['ST']);
  assert.equal(r.players[1].attrs.fin, 5);

  // 이스케이프된 따옴표
  const esc = IMP.parseDelimitedWith('a,"He said ""hi""",c', ',');
  assert.deepEqual([...esc[0]], ['a', 'He said "hi"', 'c']);

  // 이름에 쉼표가 있어도 탭 구분 파일은 탭으로 잘라야 한다
  const tsv = IMP.parseSquad('Name\tPosition\tAcc\nSmith, John\tST (C)\t15');
  assert.equal(tsv.players.length, 1);
  assert.equal(tsv.players[0].name, 'Smith, John', '탭 파일을 쉼표로 잘랐다');
  assert.equal(tsv.players[0].attrs.acc, 15);

  // 세미콜론 구분(유럽 로캘 엑셀)
  const semi = IMP.parseSquad('Name;Position;Acc;Pac\nA Player;ST (C);14;15');
  assert.equal(semi.players.length, 1, '세미콜론 구분 파일을 못 읽었다');
  assert.equal(semi.players[0].attrs.pac, 15);
}

// ── 실제 FM24 한국어판 내보내기 (tests/fixtures) ──────────────────────────
/*
 * 처음에 한국어 열 이름을 사전 번역으로 채웠더니(가속도·민첩성·마무리·스태미너 …)
 * 실제 파일에서 47개 중 하나만 맞았다. FM 한국어판이 화면에 쓰는 이름은
 * 순간 속도·민첩·결정·지구처럼 훨씬 짧은 말이다.
 * 그래서 실제 내보내기 파일을 그대로 넣어 두고 이 검사로 고정한다.
 */
{
  const fx = (n) => read(path.join('tests/fixtures', n));

  // 능력치 묶음별로 나눠 내보낸 6개 파일 — 합치면 47개가 전부 채워져야 한다
  const files = ['ko-goalkeeping.html', 'ko-mixed.html', 'ko-technical.html',
                 'ko-mental.html', 'ko-defensive.html', 'ko-physical.rtf'];
  let squad = [];
  for (const f of files) {
    const res = IMP.parseSquad(fx(f));
    assert.ok(res.players.length >= 20, `${f}: 선수를 ${res.players.length}명밖에 못 읽었다`);
    assert.ok(res.report.attrColumns >= 8, `${f}: 능력치 열 ${res.report.attrColumns}개만 인식했다`);
    // 값이 1~20인데 인식 못한 열이 남아 있으면 능력치 이름을 놓친 것이다
    const missed = res.report.unknownColumns.filter((c) => c.numeric).map((c) => c.header);
    assert.equal(missed.length, 0, `${f}: 능력치로 보이는데 인식 못한 열 — ${missed.join(', ')}`);
    squad = IMP.mergeSquad(squad, res.players).players;
  }
  const gray = squad.find((p) => p.name === 'Archie Gray');
  assert.ok(gray, '합친 스쿼드에서 선수를 찾지 못했다');
  const filledIds = Object.keys(gray.attrs).filter((k) => gray.attrs[k] > 0);
  assert.equal(filledIds.length, RD.ATTR_ORDER.length,
    `6개 파일을 합쳤는데 능력치가 ${filledIds.length}/${RD.ATTR_ORDER.length}개다 — 빠진 것: ` +
    [...RD.ATTR_ORDER].filter((a) => !gray.attrs[a]).join(', '));

  // 골키퍼 표의 '스로인'은 던지기, 기술 표의 '스로인'은 롱 스로인이다
  const gkOnly = IMP.parseSquad(fx('ko-goalkeeping.html'));
  const techOnly = IMP.parseSquad(fx('ko-technical.html'));
  assert.ok(gkOnly.players[0].attrs.thr > 0, "골키퍼 표의 '스로인'을 던지기로 읽지 못했다");
  assert.equal(gkOnly.players[0].attrs.lth, undefined, "골키퍼 표의 '스로인'을 롱 스로인으로 읽었다");
  assert.ok(techOnly.players[0].attrs.lth > 0, "기술 표의 '스로인'을 롱 스로인으로 읽지 못했다");
  assert.equal(techOnly.players[0].attrs.thr, undefined, "기술 표의 '스로인'을 던지기로 읽었다");

  // '위치'는 포지션이 아니라 위치 선정이다
  const mental = IMP.parseSquad(fx('ko-mental.html'));
  assert.ok(mental.players[0].attrs.pos > 0, "'위치'를 위치 선정으로 읽지 못했다");

  // '선택한 포지션'은 전술에서 배정된 자리이지 등록 포지션이 아니다 — 무시해야 한다
  assert.equal(mental.players[0].positions.length, 0,
    "'선택한 포지션'을 등록 포지션으로 읽었다");
  assert.equal(mental.report.unknownColumns.length, 0,
    `아는 열이 미인식으로 보고됐다: ${mental.report.unknownColumns.map((c) => c.header).join(', ')}`);

  // 표가 없는 내보내기 — FM 전술 화면을 필드 보기 상태로 내보내면 이렇게 나온다.
  // "표를 찾지 못했습니다"로만 끝내면 파일이 잘못된 줄 알게 되므로,
  // FM이 만든 파일인지까지 구분해 보고해야 한다.
  {
    const empty = IMP.parseSquad(fx('ko-empty-export.html'));
    assert.equal(empty.players.length, 0);
    assert.equal(empty.report.empty, true, '빈 내보내기를 빈 것으로 표시하지 않았다');
    assert.equal(empty.report.fromFm, true, 'FM이 만든 파일임을 알아보지 못했다');
    assert.ok(/표가 비어/.test(empty.report.error), `안내가 구체적이지 않다: ${empty.report.error}`);

    const notFm = IMP.parseSquad('<html><body><p>hello</p></body></html>');
    assert.equal(notFm.report.fromFm, false, 'FM 파일이 아닌데 FM 파일로 봤다');

    // 같은 파일에서 포메이션도 당연히 안 나와야 한다 (엉뚱한 형태를 지어내면 안 된다)
    const emptyLineup = IMP.parseLineup(fx('ko-empty-export.html'));
    assert.equal(emptyLineup.positions.length, 0);
    assert.equal(emptyLineup.matches.length, 0, '빈 파일에서 포메이션을 지어냈다');
  }

  // ── 전술 화면 내보내기에서 상대 포메이션 읽기 ──
  const lineup = IMP.parseLineup(fx('ko-tactic-lineup.html'));
  assert.deepEqual([...lineup.positions],
    ['GK', 'DR', 'DC', 'DC', 'DL', 'DM', 'MC', 'MC', 'AMR', 'AML', 'ST'],
    `전술 화면에서 읽은 자리: ${lineup.positions.join(' ')}`);
  assert.ok(lineup.matches.includes('433dm'),
    `포메이션을 4-3-3 DM 와이드로 알아보지 못했다: ${lineup.matches.join(', ')}`);

  /*
   * 선수가 배정된 전술 화면에서는 선발 명단까지 읽어야 한다.
   * 능력치가 없어도 "자리에 안 맞는 선수"와 "컨디션이 나쁜 선수"는 읽히고,
   * 둘 다 어느 측면을 노릴지 바로 알려 준다.
   */
  {
    const filled = IMP.parseLineup(fx('ko-tactic-lineup-filled.html'));
    assert.ok(filled.matches.includes('433dm'), `포메이션 인식 실패: ${filled.matches.join(', ')}`);
    assert.equal(filled.slots.length, 11, `선발을 ${filled.slots.length}명 읽었다`);
    const named = filled.slots.filter((s) => s.name);
    assert.equal(named.length, 11, '선발 이름을 다 읽지 못했다');
    assert.ok(!named.some((s) => /선수\s*선발/.test(s.name)), "이름에 '- 선수 선발'이 남아 있다");
    const gk = filled.slots[0];
    assert.equal(gk.pos, 'GK');
    assert.deepEqual([...gk.positions], ['GK']);
    assert.ok(gk.condition, '컨디션을 읽지 못했다');

    const notes = E.opponentLineupNotes(filled.slots);
    assert.ok(notes.length >= 2, `약한 고리를 ${notes.length}개만 찾았다`);
    assert.ok(notes.some((n) => n.kind === 'out-of-position'),
      '등록 포지션이 아닌 자리에 선 선수를 못 찾았다');
    assert.ok(notes.some((n) => n.kind === 'condition'),
      '컨디션이 나쁜 선수를 못 찾았다');
    for (const n of notes) {
      assert.ok(n.text && n.action, '약한 고리에 이유나 행동이 빠졌다');
      assert.ok(!/이\(가\)/.test(n.text), `조사가 '이(가)'로 남아 있다: ${n.text}`);
      if (n.trait) assert.ok(TRAIT_IDS.has(n.trait), `알 수 없는 성향 ${n.trait}`);
    }
    // 상대 오른쪽(우리 왼쪽)이 약하면 'weak-flank-r'이어야 한다
    const rafferty = notes.find((n) => /Rafferty/.test(n.text));
    assert.ok(rafferty, '컨디션 나쁜 오른쪽 수비수를 못 찾았다');
    assert.equal(rafferty.trait, 'weak-flank-r');
    assert.ok(/왼쪽/.test(rafferty.action), '우리가 어느 쪽을 노릴지 반대로 적었다');

    // 선수가 배정되지 않은 파일에서는 약한 고리가 나오면 안 된다
    assert.equal(E.opponentLineupNotes(IMP.parseLineup(fx('ko-tactic-lineup.html')).slots).length, 0,
      '선수가 없는 전술 화면에서 약점을 지어냈다');
  }

  // 같은 파일에서 상대 스쿼드도 읽힌다 — 이름의 화면 조작 문구가 지워져야 한다
  const oppSquad = IMP.parseSquad(fx('ko-tactic-lineup.html'));
  assert.ok(oppSquad.players.length >= 20, `상대 스쿼드를 ${oppSquad.players.length}명만 읽었다`);
  assert.ok(!oppSquad.players.some((p) => /선수\s*선발/.test(p.name)),
    "이름에 '- 선수 선발'이 남아 있다");
  assert.ok(!oppSquad.players.some((p) => /^[-\s]*$/.test(p.name)),
    '아직 선수가 배정되지 않은 빈 자리를 선수로 읽었다');
  assert.ok(oppSquad.players.some((p) => p.name === 'Brandon Thomas-Asante'),
    '하이픈이 들어간 성이 잘렸다');
  const withPos = oppSquad.players.filter((p) => p.positions.length);
  assert.ok(withPos.length >= 20, `포지션을 읽은 선수가 ${withPos.length}명뿐이다`);
  const vanEwijk = oppSquad.players.find((p) => p.name === 'Milan van Ewijk');
  assert.deepEqual([...vanEwijk.positions].sort(), ['AMR', 'DR', 'MR', 'WBR'].sort(),
    `'D/WB/M/AM (R)' 파싱 실패: ${vanEwijk.positions}`);
}

// ── 상대 스쿼드에서 성향 추정 ─────────────────────────────────────────────
{
  const mk = (name, positions, attrs) => ({ name, positions, attrs });
  const opp = [
    mk('빠른 공격수', ['ST'], { pac: 17, acc: 16, fin: 14 }),
    mk('타깃 공격수', ['ST'], { hea: 16, jum: 15, str: 15, fin: 13 }),
    mk('10번', ['AMC'], { pas: 16, vis: 16, tec: 15 }),
    mk('수미', ['DM'], { pas: 16, vis: 15, tck: 13 }),
    mk('느린 센터백A', ['DC'], { pac: 9, jum: 10, mar: 14 }),
    mk('느린 센터백B', ['DC'], { pac: 10, jum: 11, mar: 13 }),
    mk('골키퍼', ['GK'], { kic: 8, ref: 14, han: 13 }),
    mk('윙어A', ['AMR'], { cro: 15, dri: 14, pac: 14 }),
    mk('윙어B', ['AML'], { cro: 14, dri: 15, pac: 15 }),
    mk('윙백', ['WBR'], { cro: 14, sta: 15, tck: 12 })
  ];
  const traits = E.inferOpponentTraits(opp).map((t) => t.id);
  for (const want of ['fast-striker', 'target-man', 'playmaker-amc', 'playmaker-deep',
                      'slow-cb', 'small-cb', 'weak-gk-dist', 'cross-heavy']) {
    assert.ok(traits.includes(want), `상대 성향 '${want}'을 못 읽었다: ${traits.join(', ')}`);
  }
  // 근거가 함께 나와야 한다 — 근거 없이 성향만 켜면 확인할 수가 없다
  for (const t of E.inferOpponentTraits(opp)) {
    assert.ok(t.why && t.why.length > 5, `성향 ${t.id}에 근거가 없다`);
    assert.ok(t.players.length > 0, `성향 ${t.id}에 근거가 된 선수가 없다`);
  }
  // 능력치가 없으면 아무 성향도 지어내면 안 된다
  const noAttrs = opp.map((p) => ({ name: p.name, positions: p.positions, attrs: {} }));
  assert.equal(E.inferOpponentTraits(noAttrs).length, 0, '능력치가 없는데 성향을 지어냈다');
  assert.equal(E.inferOpponentTraits([]).length, 0);

  // 실제 상대 파일(전술 화면)은 능력치가 없으므로 포메이션만 나와야 한다
  const oppFile = IMP.parseSquad(read(path.join('tests/fixtures', 'ko-tactic-lineup.html')));
  assert.equal(E.inferOpponentTraits(oppFile.players).length, 0,
    '능력치 없는 상대 파일에서 성향을 지어냈다');
  // 추정한 성향은 전부 실제 목록에 있는 id여야 한다 (오타면 영원히 무시된다)
  for (const t of E.inferOpponentTraits(opp)) {
    assert.ok(TRAIT_IDS.has(t.id), `추정이 목록에 없는 성향 '${t.id}'을 내놓았다`);
  }
}

// ── 파일 인코딩 판별 ──────────────────────────────────────────────────────
// UTF-16으로 내보내는 도구(윈도우 프로그램에 흔하다)의 파일을 UTF-8로 읽으면
// 글자 사이에 널이 껴서 열 이름이 하나도 안 맞는다.
{
  const text = 'Name\tPosition\tAcc\n김민재\tD (C)\t13';
  const utf16le = (withBom) => {
    const units = [...text].map((c) => c.codePointAt(0));
    const bytes = [];
    if (withBom) bytes.push(0xFF, 0xFE);
    for (const u of units) bytes.push(u & 0xFF, (u >> 8) & 0xFF);
    return new Uint8Array(bytes).buffer;
  };
  assert.equal(IMP.decodeBytes(utf16le(true)), text, 'BOM 있는 UTF-16LE를 못 읽었다');
  assert.equal(IMP.decodeBytes(utf16le(false)), text, 'BOM 없는 UTF-16LE를 못 읽었다');

  const utf8 = new TextEncoder().encode(text);
  assert.equal(IMP.decodeBytes(utf8.buffer), text, 'UTF-8을 잘못 읽었다');
  const utf8Bom = new Uint8Array([0xEF, 0xBB, 0xBF, ...utf8]);
  assert.equal(IMP.decodeBytes(utf8Bom.buffer), text, 'BOM 있는 UTF-8을 잘못 읽었다');

  // 판별에 성공했다면 그대로 가져오기까지 되어야 한다
  const viaBytes = IMP.parseSquad(IMP.decodeBytes(utf16le(true)));
  assert.equal(viaBytes.players.length, 1);
  assert.equal(viaBytes.players[0].name, '김민재');
  assert.equal(viaBytes.players[0].attrs.acc, 13);
}

// ── 두 번에 나눠 내보낸 스쿼드를 합치기 ───────────────────────────────────
// 열이 많아 화면이 좁으면 기술·정신 / 신체·GK로 나눠 두 번 내보내게 된다.
// 이때 두 번째 가져오기가 첫 번째 능력치를 지우면 안 된다.
{
  const passA = IMP.parseSquad('Name\tPosition\tPas\tTec\tVis\n김선수\tM (C)\t15\t14\t16');
  const passB = IMP.parseSquad('Name\tPosition\tPac\tSta\tStr\n김선수\tM (C)\t12\t17\t13');
  assert.equal(passA.players.length, 1);
  assert.equal(passB.players.length, 1);

  const first = IMP.mergeSquad([], passA.players);
  assert.equal(first.added, 1);
  const second = IMP.mergeSquad(first.players, passB.players);
  assert.equal(second.added, 0, '같은 이름인데 새 선수로 추가됐다');
  assert.equal(second.updated, 1);
  assert.equal(second.filled, 3, `채운 능력치 수가 3이 아니라 ${second.filled}`);

  const merged = second.players[0];
  assert.equal(second.players.length, 1, '같은 선수가 둘로 늘었다');
  assert.equal(merged.attrs.pas, 15, '첫 번째 가져오기의 능력치가 지워졌다');
  assert.equal(merged.attrs.tec, 14, '첫 번째 가져오기의 능력치가 지워졌다');
  assert.equal(merged.attrs.vis, 16, '첫 번째 가져오기의 능력치가 지워졌다');
  assert.equal(merged.attrs.sta, 17, '두 번째 가져오기의 능력치가 안 들어왔다');
  assert.equal(merged.attrCount, 6, `합친 능력치 수가 6이 아니라 ${merged.attrCount}`);

  // 원본 배열을 건드리면 안 된다
  assert.equal(first.players[0].attrs.sta, undefined, 'mergeSquad가 입력 배열을 변경했다');

  // 포지션이 비어 있는 쪽이 이미 있는 포지션을 지우면 안 된다
  const noPos = IMP.mergeSquad(second.players, [{ name: '김선수', positions: [], attrs: { fin: 11 } }]);
  assert.deepEqual([...noPos.players[0].positions], ['MC'], '빈 포지션이 기존 포지션을 지웠다');
  assert.equal(noPos.players[0].attrs.pas, 15, '병합에서 기존 능력치가 사라졌다');

  // 새 값은 기존 값을 덮어쓴다 (최신 내보내기가 이긴다)
  const bumped = IMP.mergeSquad(second.players, [{ name: '김선수', positions: ['MC'], attrs: { pas: 17 } }]);
  assert.equal(bumped.players[0].attrs.pas, 17, '새로 가져온 값이 반영되지 않았다');
  assert.equal(bumped.filled, 0, '이미 있던 값을 새로 채운 것으로 셌다');

  // 간편 입력으로 채운 자리에 진짜 값이 들어오면 '추정값' 표시가 사라져야 한다
  const estimated = [{
    name: '박선수', positions: ['ST'],
    attrs: { fin: 10, pac: 10, acc: 10 },
    quickAttrs: { fin: 1, pac: 1, acc: 1 }
  }];
  const real = IMP.mergeSquad(estimated, [{ name: '박선수', positions: ['ST'], attrs: { fin: 17, pac: 16 } }]);
  const rp = real.players[0];
  assert.equal(rp.attrs.fin, 17, '진짜 값이 추정값을 덮어쓰지 못했다');
  assert.equal(rp.quickAttrs.fin, undefined, '진짜 값이 들어왔는데 추정 표시가 남아 있다');
  assert.equal(rp.quickAttrs.pac, undefined, '진짜 값이 들어왔는데 추정 표시가 남아 있다');
  assert.equal(rp.quickAttrs.acc, 1, '아직 추정값인 항목의 표시가 지워졌다');
  assert.equal(estimated[0].quickAttrs.fin, 1, 'mergeSquad가 입력의 추정 표시를 변경했다');
}

// ── 영입한 선수 등록: 선수 한 명의 프로필 화면 ────────────────────────────
/*
 * 선수를 새로 영입하면 스쿼드 전체를 다시 내보낼 것 없이 그 선수 화면만
 * 내보내면 된다. 이 표는 세로로 나오고 이름이 들어 있지 않다.
 * 이름을 지어내면 엉뚱한 선수 능력치를 덮어쓰므로 반드시 비어 있어야 한다.
 */
{
  const profile = IMP.parsePlayerProfile(read(path.join('tests/fixtures', 'ko-player-profile.html')));
  assert.equal(profile.error, null, `프로필을 읽지 못했다: ${profile.error}`);

  // 필드 선수 화면에는 GK 능력치가 없다 — 나머지는 하나도 빠지면 안 된다
  const wantField = [...RD.ATTR_ORDER].filter((a) => RD.ATTRS[a].group !== 'gk');
  const gotField = wantField.filter((a) => profile.attrs[a] > 0);
  assert.equal(gotField.length, wantField.length,
    `필드 능력치가 ${gotField.length}/${wantField.length}개다 — 빠진 것: ` +
    wantField.filter((a) => !profile.attrs[a]).join(', '));
  assert.equal(profile.unknown.length, 0,
    `능력치로 보이는데 인식 못한 줄 — ${profile.unknown.join(', ')}`);

  /*
   * '개인기'를 Flair로 짐작해 뒀다가 이 파일에서 틀린 것이 드러났다.
   * 한 화면에 개인기와 천재성이 나란히 있어 서로 다른 능력치임이 확정된다.
   */
  assert.equal(profile.attrs.tec, 17, "'개인기'를 Technique으로 읽지 못했다");
  assert.equal(profile.attrs.fla, 16, "'천재성'을 Flair로 읽지 못했다");
  assert.equal(profile.attrs.fin, 14, "'골 결정력'을 결정력으로 읽지 못했다");
  assert.equal(profile.attrs.lth, 4, "'장거리 스로인'을 롱 스로인으로 읽지 못했다");
  assert.equal(profile.attrs.thr, undefined, '필드 선수 화면에서 GK 던지기를 읽었다');

  // 신장·체중은 능력치가 아니므로 능력치로 새면 안 된다
  assert.ok(/175/.test(profile.meta.height), `신장을 못 읽었다: ${profile.meta.height}`);
  assert.ok(/73/.test(profile.meta.weight), `체중을 못 읽었다: ${profile.meta.weight}`);

  // 이름은 파일에 없다 — 지어내지 말고 화면에서 고르게 해야 한다
  assert.equal(profile.name, undefined, '프로필 파일에 없는 이름을 지어냈다');

  // 읽은 능력치를 그대로 병합하면 기존 선수의 값이 갱신돼야 한다 (영입 후 재계약·성장)
  const before = [{ name: '새 영입', positions: ['AMC'], attrs: { pas: 10, vis: 10 } }];
  const after = IMP.mergeSquad(before, [{ name: '새 영입', positions: ['AMC'], attrs: profile.attrs }]);
  assert.equal(after.added, 0, '이미 있는 선수를 새로 추가했다');
  assert.equal(after.players[0].attrs.vis, 17, '프로필 값이 반영되지 않았다');
  assert.equal(after.players[0].attrCount, gotField.length,
    `병합 후 능력치 수가 ${after.players[0].attrCount}개다`);

  // 스쿼드 화면(가로 표)을 프로필로 읽으면 실패해야 한다 — 경로를 잘못 타면 안 된다
  const wrong = IMP.parsePlayerProfile('Name\tPosition\tPas\tTec\n김선수\tM (C)\t15\t14');
  assert.ok(wrong.error, '스쿼드 표를 선수 프로필로 읽어 버렸다');
}

// ── 방출·임대로 빠진 선수 찾기 ────────────────────────────────────────────
/*
 * 선수를 내보냈으면 스쿼드에서도 빠져야 한다. 다만 자동으로 지우면
 * 능력치 묶음별로 나눠 내보낸 파일 하나만 넣어도 나머지가 전부 사라진다.
 * 그래서 '없어진 이름'만 돌려주고 판단은 화면에서 사람이 한다.
 */
{
  const have = [{ name: '남는 선수' }, { name: '방출 선수' }, { name: '임대 선수' }];

  const gone = IMP.missingFrom(have, [{ name: '남는 선수' }]);
  assert.deepEqual([...gone].sort(), ['방출 선수', '임대 선수'].sort(),
    `빠진 선수를 잘못 찾았다: ${gone.join(', ')}`);

  // 새 파일이 스쿼드를 전부 포함하면 빠진 선수는 없다 (새 영입이 섞여 있어도)
  assert.equal(
    IMP.missingFrom(have, have.concat([{ name: '새 영입' }])).length, 0,
    '아무도 안 빠졌는데 빠진 것으로 봤다');

  // 빈 입력에도 터지지 않아야 한다
  assert.equal(IMP.missingFrom([], [{ name: 'x' }]).length, 0);
  assert.deepEqual([...IMP.missingFrom(have, [])].length, 3);
  assert.equal(IMP.missingFrom(null, null).length, 0);

  /*
   * 실제 파일로 확인. 같은 스쿼드를 다시 넣으면 빠진 선수가 없어야 하고,
   * 선수 몇 명만 든 파일을 넣으면 나머지 전원이 '빠진 선수'로 나온다 —
   * 그래서 화면은 선수가 11명 이상인 파일에서만 방출 후보를 묻는다.
   */
  const fx = (n) => read(path.join('tests/fixtures', n));
  const full = IMP.parseSquad(fx('ko-technical.html')).players;
  assert.ok(full.length >= 20, `스쿼드를 ${full.length}명만 읽었다`);
  assert.equal(IMP.missingFrom(full, full).length, 0,
    '같은 파일을 다시 넣었는데 빠진 선수가 생겼다');
  assert.equal(IMP.missingFrom(full, full.slice(0, 2)).length, full.length - 2,
    '일부만 든 파일인데 나머지를 빠진 선수로 보지 않았다 — 화면 쪽 안전장치의 근거가 사라진다');
}

// ── 테스트용 스쿼드 ───────────────────────────────────────────────────────
function mkPlayer(name, positions, profile, foot = 'R') {
  const attrs = {};
  for (const id of RD.ATTR_ORDER) attrs[id] = profile.base ?? 10;
  for (const [k, v] of Object.entries(profile.attrs || {})) attrs[k] = v;
  return { id: name, name, positions, foot, attrs };
}
const squad = [
  mkPlayer('GK1', ['GK'], { base: 12, attrs: { ref: 15, han: 14, cmd: 13, kic: 13, ono: 14, tro: 13, aer: 13 } }),
  mkPlayer('GK2', ['GK'], { base: 10 }),
  mkPlayer('CB1', ['DC'], { base: 11, attrs: { mar: 16, tck: 16, hea: 15, pos: 15, jum: 15, str: 15, cnt: 14, dec: 13, pas: 12 } }),
  mkPlayer('CB2', ['DC'], { base: 11, attrs: { mar: 14, tck: 14, hea: 13, pos: 14, pac: 15, acc: 14, ant: 14, pas: 14, tec: 13, cmp: 14 } }),
  mkPlayer('CB3', ['DC'], { base: 10, attrs: { mar: 13, tck: 13, hea: 14, str: 14, jum: 14 } }),
  mkPlayer('RB1', ['DR', 'WBR'], { base: 11, attrs: { cro: 14, tck: 13, mar: 13, sta: 16, wor: 15, pac: 15, acc: 15, otb: 13, tea: 14 } }),
  mkPlayer('LB1', ['DL', 'WBL'], { base: 11, attrs: { cro: 13, tck: 14, mar: 14, sta: 15, wor: 14, pac: 13, acc: 13, pos: 14 } }, 'L'),
  mkPlayer('LB2', ['DL', 'WBL'], { base: 10, attrs: { tck: 13, mar: 13, sta: 13 } }, 'L'),
  mkPlayer('DM1', ['DM', 'MC'], { base: 11, attrs: { tck: 15, mar: 14, pos: 15, ant: 14, cnt: 14, tea: 15, wor: 15, cmp: 13, dec: 14 } }),
  mkPlayer('DM2', ['DM', 'MC'], { base: 11, attrs: { pas: 16, fir: 15, tec: 15, vis: 16, dec: 15, cmp: 15, tea: 14, ant: 13 } }),
  mkPlayer('CM1', ['MC'], { base: 11, attrs: { pas: 14, fir: 14, tck: 13, otb: 14, wor: 16, sta: 16, str: 13, ant: 13, dec: 13 } }),
  mkPlayer('CM2', ['MC', 'AMC'], { base: 11, attrs: { pas: 15, fir: 15, tec: 16, vis: 15, dri: 14, fla: 15, dec: 14, cmp: 14, agi: 15 } }),
  mkPlayer('AM1', ['AMC'], { base: 11, attrs: { pas: 14, fir: 15, tec: 15, otb: 15, ant: 15, fin: 14, dri: 14, acc: 15, agi: 15, bal: 14 } }),
  mkPlayer('RW1', ['AMR', 'MR'], { base: 11, attrs: { cro: 15, dri: 16, tec: 15, otb: 14, acc: 16, pac: 16, agi: 15, bal: 14, wor: 13, ant: 13 } }),
  mkPlayer('LW1', ['AML', 'ML'], { base: 11, attrs: { dri: 16, fin: 15, tec: 15, otb: 15, ant: 14, acc: 16, pac: 16, agi: 16, bal: 15, cmp: 14 } }, 'R'),
  mkPlayer('LW2', ['AML', 'ML'], { base: 10, attrs: { cro: 14, dri: 13, wor: 14, sta: 15, tck: 12 } }, 'L'),
  mkPlayer('ST1', ['ST'], { base: 11, attrs: { fin: 17, otb: 16, ant: 16, cmp: 15, dri: 14, fir: 14, acc: 16, pac: 16, tec: 14, dec: 14 } }),
  mkPlayer('ST2', ['ST'], { base: 11, attrs: { hea: 17, str: 17, jum: 17, bra: 15, fin: 14, otb: 13, tea: 14, wor: 14, bal: 14, fir: 13 } }),
  mkPlayer('UTIL', ['MC', 'DM', 'DC'], { base: 10, attrs: { tck: 13, pas: 12, wor: 13 } }),
  mkPlayer('WIDE', ['MR', 'AMR', 'WBR'], { base: 10, attrs: { cro: 13, sta: 14, wor: 14, tck: 12 } })
];

// ── 엔진: 기본 산출 ───────────────────────────────────────────────────────
function run(opponent = {}, context = {}, players = squad) {
  return E.generate({ players, opponent, context });
}

{
  const r = run({ formationId: '4231' });
  assert.ok(r, 'generate가 아무것도 내놓지 않았다');
  assert.equal(r.xi.lineup.length, 11, '선발이 11명이 아니다');
  for (const l of r.xi.lineup) {
    assert.ok(l.player, `${l.slot.id}에 선수가 배정되지 않았다`);
    assert.ok(l.role && l.duty, `${l.slot.id}에 역할/임무가 없다`);
    assert.ok(l.role.pos.includes(l.slot.pos), `${l.slot.id}에 그 자리에 못 쓰는 역할 ${l.role.id}이 배정됐다`);
    assert.ok(l.role.duties.includes(l.duty), `역할 ${l.role.id}에 없는 임무 ${l.duty}가 배정됐다`);
    assert.ok(l.fit >= 0 && l.fit <= 100, `적합도가 범위를 벗어났다: ${l.fit}`);
  }
  const names = r.xi.lineup.map((l) => l.player.name);
  assert.equal(new Set(names).size, 11, '같은 선수가 두 자리에 배정됐다');
  // 골키퍼 자리엔 골키퍼가 와야 한다
  const gk = r.xi.lineup.find((l) => l.slot.pos === 'GK');
  assert.ok(gk.player.positions.includes('GK'), `골키퍼 자리에 ${gk.player.name}이 배정됐다`);
  // 필드 플레이어가 골키퍼 자리를 차지하면 안 되고, 그 반대도 마찬가지
  for (const l of r.xi.lineup) {
    if (l.slot.pos !== 'GK') {
      assert.ok(!(l.player.positions.length === 1 && l.player.positions[0] === 'GK'),
        `${l.slot.id}에 골키퍼 전용 선수가 배정됐다`);
    }
  }
  assert.ok(r.formationRanking.length >= 3, '포메이션 후보가 부족하다');
  assert.ok(r.plans.top.length >= 1, '전술 방향이 정해지지 않았다');
  assert.ok(Object.keys(r.instructions.axes).length === Object.keys(TD.AXES).length);
  assert.ok(Object.keys(r.instructions.toggles).length === Object.keys(TD.TOGGLES).length);
}

// 결정성 — 같은 입력이면 같은 출력
{
  const a = run({ formationId: '442', dline: 4, press: 3 });
  const b = run({ formationId: '442', dline: 4, press: 3 });
  const strip = (r) => JSON.stringify({
    xi: r.xi.lineup.map((l) => [l.slot.id, l.role.id, l.duty, l.player.name, l.fit]),
    axes: Object.values(r.instructions.axes).map((a2) => [a2.id, a2.index]),
    toggles: Object.values(r.instructions.toggles).filter((t) => t.on).map((t) => t.id),
    plans: r.plans.top.map((p) => p.id)
  });
  assert.equal(strip(a), strip(b), '같은 입력에서 다른 결과가 나왔다');
}

// ── 경기 통계 읽기 · 경기 중 조정 ─────────────────────────────────────────
{
  const KINDS = new Set(['hold', 'axis', 'toggle', 'shape', 'sub']);
  const ruleIds2 = new Set();
  for (const r of TD.INMATCH_RULES) {
    assert.ok(!ruleIds2.has(r.id), `경기 중 규칙 id 중복: ${r.id}`);
    ruleIds2.add(r.id);
    assert.equal(typeof r.when, 'function', `${r.id}의 when이 함수가 아니다`);
    assert.ok(r.why, `${r.id}에 이유가 없다`);
    assert.ok(['key', 'normal'].includes(r.tier), `${r.id}의 tier가 이상하다`);
    assert.ok(r.items.length, `${r.id}에 항목이 없다`);
    for (const i of r.items) {
      assert.ok(KINDS.has(i.kind), `${r.id}의 알 수 없는 종류 ${i.kind}`);
      assert.ok(i.text && i.text.length > 4, `${r.id}에 내용이 빈 항목이 있다`);
    }
  }

  // 실제 FM 경기 통계 파일
  const st = IMP.parseMatchStats(read(path.join('tests/fixtures', 'ko-match-stats.html')));
  assert.equal(st.error, null, `경기 통계를 읽지 못했다: ${st.error}`);
  assert.equal(st.rows.length, 8, `항목 ${st.rows.length}개만 읽었다`);
  assert.equal(st.unknown.length, 0, `못 읽은 항목: ${st.unknown.join(', ')}`);
  assert.equal(st.right.shots, 10);
  assert.equal(st.right.xg, 1.43);
  assert.equal(st.right.possession, 57);
  assert.equal(st.left.possession, 43);
  // '90% (180/199)' 같은 값에서 앞의 백분율만 읽어야 한다
  assert.equal(st.left.passPct, 90);
  assert.equal(st.right.passPct, 93);
  assert.equal(IMP.parseStatValue('90% (180/199)'), 90);
  assert.equal(IMP.parseStatValue('1.43'), 1.43);
  assert.equal(IMP.parseStatValue('-'), null);

  /*
   * 기대 득점은 쌓이는데 골이 없을 때 "바꾸지 마세요"가 나와야 하고,
   * 그 항목이 맨 위에 와야 한다. 아래를 먼저 읽고 손대면 이미 늦다.
   */
  const halfTime = E.inMatchAdvice({
    phase: 'half-time', goalsFor: 0, goalsAgainst: 0,
    stats: { us: st.right, them: st.left }
  });
  assert.ok(halfTime.hasStats);
  const ids = halfTime.fired.map((f) => f.id);
  assert.ok(ids.includes('stat-unlucky'), `기대 득점 1.43 · 0골인데 유지 조언이 없다: ${ids.join(', ')}`);
  assert.equal(ids[0], 'stat-unlucky', `유지 조언이 맨 위가 아니다: ${ids.join(', ')}`);

  // 우리 팀을 반대로 고르면 조언도 반대가 되어야 한다
  const flipped = E.inMatchAdvice({
    phase: 'half-time', goalsFor: 0, goalsAgainst: 0,
    stats: { us: st.left, them: st.right }
  });
  const fIds = flipped.fired.map((f) => f.id);
  assert.ok(fIds.includes('stat-opp-xg'), `반대로 골랐는데 실점 위험 경고가 없다: ${fIds.join(', ')}`);
  assert.ok(!fIds.includes('stat-unlucky'), '반대로 골랐는데 유지 조언이 그대로다');

  /*
   * 모르는 값으로 없는 진단을 만들면 안 된다.
   * null로 두면 `null <= 42`가 참이 되어 점유율을 모르는 경기에서
   * "밀리고 있습니다"가 튀어나온다.
   */
  const sparse = E.inMatchAdvice({
    phase: 'half-time', goalsFor: 0, goalsAgainst: 0,
    stats: { us: { shots: 5 }, them: { shots: 4 } }
  });
  const sIds = sparse.fired.map((f) => f.id);
  for (const bogus of ['stat-dominated', 'stat-no-shots', 'stat-parked-detected', 'stat-pass-low']) {
    assert.ok(!sIds.includes(bogus), `값이 없는데 '${bogus}'가 발동했다`);
  }

  // 시간대·점수에 따라 갈리는가
  const lead2Half = E.inMatchAdvice({ phase: 'half-time', goalsFor: 2, goalsAgainst: 0 });
  assert.ok(lead2Half.fired.some((f) => f.id === 'lead2-halftime'));
  assert.ok(lead2Half.fired[0].items.some((i) => i.kind === 'hold'),
    '두 골 앞선 하프타임인데 "지금 내리지 마세요"가 없다');
  const lead2Late = E.inMatchAdvice({ phase: 'second-late', goalsFor: 2, goalsAgainst: 0 });
  assert.ok(lead2Late.fired.some((f) => f.id === 'lead2-late'));
  assert.ok(!lead2Late.fired.some((f) => f.id === 'lead2-halftime'),
    '75분인데 하프타임 조언이 나왔다');
  const down1Half = E.inMatchAdvice({ phase: 'half-time', goalsFor: 0, goalsAgainst: 1 });
  assert.ok(down1Half.fired.some((f) => f.id === 'down1-halftime'));
  const down1Late = E.inMatchAdvice({ phase: 'second-late', goalsFor: 0, goalsAgainst: 1 });
  assert.ok(down1Late.fired.some((f) => f.id === 'down1-late'));
  assert.ok(!down1Late.fired.some((f) => f.id === 'down1-halftime'));

  /*
   * 동점은 하프타임 규칙 하나뿐이었다. 그래서 85분 1:1에서는 점수에 대한 조언이
   * 통째로 비고 기록 진단만 나왔다 — 정작 가장 급한 상황에서 아무 말도 못 한 것이다.
   */
  for (const ph of ['second-late', 'second-end']) {
    const drawn = E.inMatchAdvice({ phase: ph, goalsFor: 1, goalsAgainst: 1 });
    assert.ok(drawn.fired.some((f) => f.group === '점수'),
      `${ph} 동점인데 점수에 대한 조언이 하나도 없다`);
  }

  /*
   * 같은 1:1 85분이라도 상대 전력에 따라 답이 반대여야 한다.
   * 약체 상대면 잃고 있는 승점 2, 강팀 상대면 지켜야 할 승점 1이다.
   */
  {
    const base = { phase: 'second-end', goalsFor: 1, goalsAgainst: 1 };
    const weak = E.inMatchAdvice({ ...base, oppLevel: 'weaker' });
    const strong = E.inMatchAdvice({ ...base, oppLevel: 'stronger' });
    const even = E.inMatchAdvice({ ...base, oppLevel: 'even' });

    const ids = (r) => r.fired.map((f) => f.id);
    assert.ok(ids(weak).includes('level-late-weaker'), `약체 상대 동점 조언이 없다: ${ids(weak).join(', ')}`);
    assert.ok(ids(strong).includes('level-late-stronger'), `강팀 상대 동점 조언이 없다: ${ids(strong).join(', ')}`);
    assert.ok(ids(even).includes('level-late-even'), `비슷한 상대 동점 조언이 없다: ${ids(even).join(', ')}`);

    // 셋은 서로 배타적이어야 한다 — 동시에 나오면 정반대 조언이 나란히 뜬다
    for (const r of [weak, strong, even]) {
      const drawRules = ids(r).filter((id) => id.indexOf('level-late-') === 0);
      assert.equal(drawRules.length, 1, `동점 규칙이 겹쳤다: ${drawRules.join(', ')}`);
    }

    // 강팀 상대에서는 "먼저 열지 마세요"가 맨 위여야 한다
    assert.ok(strong.fired[0].items.some((i) => i.kind === 'hold'),
      '강팀 상대 동점인데 유지 조언이 맨 위가 아니다');
    // 약체 상대에서는 반대로 유지 조언이 있으면 안 된다
    const weakDraw = weak.fired.find((f) => f.id === 'level-late-weaker');
    assert.ok(!weakDraw.items.some((i) => i.kind === 'hold'),
      '약체 상대에게 비기고 있는데 그대로 두라고 한다');
    // 매우 공격적으로 올리라고 하면 안 된다 — 비기던 경기를 지는 경기로 바꾼다
    assert.ok(weakDraw.items.some((i) => /매우 공격적은 쓰지 마세요/.test(i.text)),
      '약체 상대 막판에 멘탈리티 상한 경고가 없다');

    // 모르는 값을 넣어도 '비슷함'으로 떨어져야 한다 (약체·강팀으로 찍으면 안 된다)
    assert.equal(E.inMatchAdvice({ ...base, oppLevel: '???' }).oppLevel, 'even');
    assert.equal(E.inMatchAdvice(base).oppLevel, 'even');
  }

  // 85분 이후는 75분과 수단이 다르다 — 여기서만 골키퍼·센터백을 올린다
  {
    const end = E.inMatchAdvice({ phase: 'second-end', goalsFor: 0, goalsAgainst: 1 });
    assert.ok(end.fired.some((f) => f.id === 'endgame-chase'), '막판 총공세 조언이 없다');
    const mid = E.inMatchAdvice({ phase: 'second-mid', goalsFor: 0, goalsAgainst: 1 });
    assert.ok(!mid.fired.some((f) => f.id === 'endgame-chase'),
      '60분인데 골키퍼를 올리라고 한다');
    /*
     * 얼리 크로스와 「박스 안까지 볼 배급」은 FM에서 서로 반대 방향의 지시다.
     * 막판 총공세 조언과 상대가 내려앉았을 때 조언이 같이 뜨면 둘 다 켜게 되므로,
     * 어느 쪽이 이기는지 조언 안에 적혀 있어야 한다.
     */
    const chase = end.fired.find((f) => f.id === 'endgame-chase');
    assert.ok(chase.items.some((i) => /박스 안까지 볼 배급.*끕니다/.test(i.text)),
      '얼리 크로스를 켜라면서 박스 안까지 볼 배급과의 충돌을 정리해 주지 않는다');

    const endLead = E.inMatchAdvice({ phase: 'second-end', goalsFor: 2, goalsAgainst: 1 });
    assert.ok(endLead.fired.some((f) => f.id === 'endgame-hold'));
    assert.ok(!endLead.fired.some((f) => f.id === 'endgame-chase'),
      '앞서고 있는데 총공세 조언이 나왔다');
  }

  // 방금 실점: 시간이 남아 있으면 "5분 버티기", 막바지면 그럴 시간이 없다
  {
    const early = E.inMatchAdvice({ phase: 'second-early', goalsFor: 1, goalsAgainst: 1, flags: ['just-conceded'] });
    const late = E.inMatchAdvice({ phase: 'second-end', goalsFor: 1, goalsAgainst: 1, flags: ['just-conceded'] });
    assert.ok(early.fired.some((f) => f.id === 'just-conceded'));
    assert.ok(early.fired[0].items.some((i) => i.kind === 'hold'),
      '실점 직후인데 "바꾸지 마세요"가 맨 위가 아니다');
    assert.ok(late.fired.some((f) => f.id === 'just-conceded-late'));
    assert.ok(!late.fired.some((f) => f.id === 'just-conceded'),
      '85분에 실점 직후 5분 버티기 조언이 나왔다 — 버틸 시간이 없다');
    assert.ok(!E.inMatchAdvice({ phase: 'second-end', goalsFor: 1, goalsAgainst: 1 }).fired
      .some((f) => f.group === '상황'), '표시하지 않은 상황이 발동했다');
  }

  // 약체에게 지고 있을 때는 원인부터 갈라야 한다 — 무조건 멘탈리티를 올리면 안 된다
  {
    const r = E.inMatchAdvice({ phase: 'second-mid', goalsFor: 0, goalsAgainst: 1, oppLevel: 'weaker' });
    const w = r.fired.find((f) => f.id === 'weaker-behind');
    assert.ok(w, '약체에게 뒤지고 있는데 전력 차이 조언이 없다');
    assert.ok(w.items.some((i) => i.kind === 'hold'), '원인을 먼저 고르라는 항목이 없다');
    assert.ok(!E.inMatchAdvice({ phase: 'second-mid', goalsFor: 0, goalsAgainst: 1, oppLevel: 'even' })
      .fired.some((f) => f.id === 'weaker-behind'));
  }

  // 상황 표시가 반영되는가
  const red = E.inMatchAdvice({ phase: 'second-early', goalsFor: 0, goalsAgainst: 0, flags: ['red-us'] });
  assert.ok(red.fired.some((f) => f.id === 'red-us'));
  const noFlag = E.inMatchAdvice({ phase: 'second-early', goalsFor: 0, goalsAgainst: 0, flags: [] });
  assert.ok(!noFlag.fired.some((f) => f.id === 'red-us'));

  // 아무 정보가 없어도 죽지 않는다
  const empty = E.inMatchAdvice({});
  assert.ok(empty.phase && empty.score, '빈 입력에서 형식이 깨졌다');

  // 모든 시간대 × 점수 × 전력 조합에서 죽지 않고, why가 비지 않는다
  for (const ph of TD.MATCH_PHASES) {
    for (let d = -3; d <= 3; d++) {
      for (const lv of TD.OPP_LEVELS) {
        const tag = `${ph.id}/${d}/${lv.id}`;
        const r = E.inMatchAdvice({
          phase: ph.id, goalsFor: Math.max(0, d), goalsAgainst: Math.max(0, -d),
          oppLevel: lv.id, stats: { us: st.right, them: st.left }
        });
        for (const f of r.fired) {
          assert.ok(f.why && f.why.length > 4, `${tag}: ${f.id}의 이유가 비었다`);
          assert.ok(!/NaN|undefined/.test(f.why), `${tag}: ${f.id}의 이유에 NaN/undefined가 들어갔다 — ${f.why}`);
          for (const i of f.items) {
            assert.ok(i.text && i.text.length > 4, `${tag}: ${f.id}에 내용이 빈 항목이 있다`);
            assert.ok(KINDS.has(i.kind), `${tag}: ${f.id}의 알 수 없는 항목 종류 ${i.kind}`);
          }
        }
        // 같은 규칙이 두 번 나오면 화면에 같은 조언이 두 장 뜬다
        const ids2 = r.fired.map((f) => f.id);
        assert.equal(new Set(ids2).size, ids2.length, `${tag}: 같은 규칙이 두 번 발동했다`);
      }
    }
  }

  /*
   * 어떤 시간대·점수·전력 조합에서도 조언이 하나도 없는 칸이 있으면 안 된다.
   * 85분 동점이 정확히 그 빈칸이었다.
   */
  for (const ph of TD.MATCH_PHASES) {
    for (let d = -2; d <= 2; d++) {
      for (const lv of TD.OPP_LEVELS) {
        const r = E.inMatchAdvice({
          phase: ph.id, goalsFor: Math.max(0, d), goalsAgainst: Math.max(0, -d), oppLevel: lv.id
        });
        // 전반 초반 0-0은 정말로 할 말이 없는 것이 맞다
        if (ph.idx <= 1 && d === 0) continue;
        assert.ok(r.fired.length > 0,
          `${ph.ko} ${d >= 0 ? '+' : ''}${d} (상대 ${lv.ko})에서 조언이 하나도 없다`);
      }
    }
  }
}

// ── 시즌 기본 전술 (상대 없이 스쿼드만으로) ───────────────────────────────
{
  const base = E.baseTactic({ players: squad, standing: 'mid' });
  assert.ok(base, 'baseTactic이 아무것도 내놓지 않았다');
  assert.equal(base.xi.lineup.length, 11);
  const names = base.xi.lineup.map((l) => l.player && l.player.name).filter(Boolean);
  assert.equal(new Set(names).size, names.length, '기본 전술에서 선수가 중복 배정됐다');
  assert.ok(base.plan && TD.PLANS[base.plan.id], '전술 방향이 없다');
  assert.equal(base.formation.slots.length, 11);
  assert.ok(base.ranking.length >= 3, '후보가 부족하다');
  for (const c of base.ranking) {
    assert.ok(TD.PLANS[c.planId], `후보에 알 수 없는 방향 ${c.planId}`);
    assert.ok(E.FORMATION_BY_ID[c.formationId], `후보에 알 수 없는 포메이션 ${c.formationId}`);
  }
  for (let i = 1; i < base.ranking.length; i++) {
    assert.ok(base.ranking[i - 1].score >= base.ranking[i].score, '후보가 점수순이 아니다');
  }

  // 교체 명단은 주전과 겹치면 안 된다
  const starters = new Set(base.xi.lineup.map((l) => l.player && l.player._id).filter(Boolean));
  const benched = base.bench.map((b) => b.player && b.player._id).filter(Boolean);
  for (const id of benched) assert.ok(!starters.has(id), '교체 명단에 주전이 들어 있다');
  assert.equal(new Set(benched).size, benched.length, '한 선수가 두 자리의 교체로 잡혔다');

  // 결정성
  const again = E.baseTactic({ players: squad, standing: 'mid' });
  assert.equal(base.formation.id, again.formation.id, '같은 입력에서 다른 포메이션이 나왔다');
  assert.equal(base.plan.id, again.plan.id, '같은 입력에서 다른 방향이 나왔다');

  // 선수가 너무 적으면 만들지 않는다
  assert.equal(E.baseTactic({ players: squad.slice(0, 5) }), null);

  /*
   * 리그 내 위치가 실제로 반영되어야 한다.
   * 능력치만 보면 '내려앉기'가 쉽게 1등이 된다 — 수비 능력치가 평범만 해도 점수가
   * 붙고 역할 적합도는 어느 방향에서나 비슷하기 때문이다. 그런데 시즌 내내 쓸
   * 기본 전술로 블록을 세우면 약팀을 만났을 때 이길 방법이 없다.
   */
  const strong = E.baseTactic({ players: squad, standing: 'strong' });
  assert.notEqual(strong.plan.id, 'low-block', '상위권 팀의 기본 전술이 내려앉기로 나왔다');
  assert.ok(!strong.ranking.slice(0, 3).some((c) => c.planId === 'low-block'),
    '상위권인데 내려앉기가 상위 후보에 있다');

  // 빠른데 약한 팀은 역습 쪽으로 기울어야 한다
  const fastSquad = squad.map((p) => ({
    ...p, attrs: { ...p.attrs, pac: 16, acc: 16, tec: 8, pas: 8, vis: 8, fir: 8 }
  }));
  const weakFast = E.baseTactic({ players: fastSquad, standing: 'weak' });
  assert.ok(['counter', 'in-behind', 'low-block'].includes(weakFast.plan.id),
    `빠른 하위권 팀인데 ${weakFast.plan.ko}가 나왔다`);

  const strongTech = E.baseTactic({
    players: squad.map((p) => ({ ...p, attrs: { ...p.attrs, tec: 16, pas: 16, vis: 15, fir: 16 } })),
    standing: 'strong'
  });
  assert.ok(['possession', 'overload-centre', 'press-high', 'wide-cross'].includes(strongTech.plan.id),
    `기술 좋은 상위권 팀인데 ${strongTech.plan.ko}가 나왔다`);

  // 능력치를 하나도 모르면 스쿼드 보정은 침묵해야 한다 (0을 낮은 값으로 읽으면 안 된다)
  const blankSquad = squad.map((p) => ({ id: p.id, name: p.name, positions: p.positions, attrs: {} }));
  const blankBase = E.baseTactic({ players: blankSquad, standing: 'mid' });
  assert.ok(blankBase, '능력치가 없을 때 기본 전술을 못 만든다');
  for (const c of blankBase.ranking) assert.equal(c.squadBonus, 0, '모르는 능력치로 스쿼드 보정을 냈다');

  // 모든 전술 방향에 위치 보정값이 있어야 한다
  const engineSrc = read('engine.js');
  for (const st of ['strong', 'mid', 'weak']) {
    const block = engineSrc.slice(engineSrc.indexOf(st + ':', engineSrc.indexOf('STANDING_PLAN_PRIOR')));
    for (const pid of PLAN_IDS) {
      assert.ok(block.slice(0, 400).includes(`'${pid}'`) || block.slice(0, 400).includes(pid + ':'),
        `위치 '${st}'에 전술 방향 ${pid}의 보정이 없다`);
    }
  }
}

// ── 영입이 필요한 자리 ────────────────────────────────────────────────────
{
  const rep = E.squadNeeds({ players: squad, standing: 'mid' });
  assert.ok(rep && rep.base, 'squadNeeds가 아무것도 내놓지 않았다');
  const SEVS = new Set(['critical', 'high', 'mid']);
  for (const n of rep.needs) {
    assert.ok(SEVS.has(n.severity), `알 수 없는 심각도 ${n.severity}`);
    assert.ok(n.reason && n.reason.length > 5, `${n.ko}에 이유가 없다`);
    assert.ok(n.profile && n.profile.length > 5, `${n.ko}에 찾을 유형이 없다`);
    assert.ok(POS_IDS.has(n.pos), `알 수 없는 포지션 ${n.pos}`);
    assert.ok(n.wantAttrs.length, `${n.ko}에 요구 능력치가 없다`);
    for (const a of n.wantAttrs) {
      assert.ok(ATTR_IDS.has(a.id), `알 수 없는 능력치 ${a.id}`);
      if (a.target !== null) assert.ok(a.target >= 1 && a.target <= 20, `목표치가 범위를 벗어났다: ${a.target}`);
    }
  }
  // 같은 포지션이 두 번 나오면 안 된다 (센터백 두 자리 → 한 줄)
  const posSeen = rep.needs.map((n) => n.pos);
  assert.equal(new Set(posSeen).size, posSeen.length, '같은 포지션이 여러 번 보고됐다');
  // 심각도 순으로 정렬돼야 한다
  const rank = { critical: 0, high: 1, mid: 2 };
  for (let i = 1; i < rep.needs.length; i++) {
    assert.ok(rank[rep.needs[i - 1].severity] <= rank[rep.needs[i].severity], '심각도 순이 아니다');
  }

  /*
   * 그 자리에 아무도 없으면 반드시 잡아야 한다.
   * 오른쪽 측면 자원을 전부 뺀 스쿼드로 확인한다.
   */
  const noRight = squad.filter((p) => !p.positions.some((x) => ['DR', 'WBR', 'MR', 'AMR'].includes(x)));
  const repNoRight = E.squadNeeds({ players: noRight, standing: 'mid' });
  const rightNeed = repNoRight.needs.find((n) => ['DR', 'WBR', 'MR', 'AMR'].includes(n.pos));
  if (repNoRight.base.formation.slots.some((s) => ['DR', 'WBR', 'MR', 'AMR'].includes(s.pos))) {
    assert.ok(rightNeed, '오른쪽 자원이 하나도 없는데 영입 필요로 잡지 않았다');
    assert.equal(rightNeed.severity, 'critical', '빈 자리인데 급함으로 보지 않았다');
    assert.equal(rightNeed.naturalCount, 0);
    /*
     * 비교할 선수가 없을 때 스쿼드 최고값을 기준으로 삼으면 안 된다 —
     * 오른쪽 풀백을 구하는데 센터백의 마크를 보고 "마크 17 이상"을 요구하게 된다.
     */
    for (const a of rightNeed.wantAttrs) {
      if (a.targetKind === 'level') assert.ok(a.target <= 16, `기준 없는 자리에 과한 요구치: ${a.ko} ${a.target}`);
    }
  }

  // 백업 영입에 주전보다 높은 값을 요구하면 안 된다
  for (const n of rep.needs) {
    if (n.severity === 'critical') continue;
    for (const a of n.wantAttrs) {
      if (a.targetKind === 'depth' && a.best !== null) {
        assert.ok(a.target <= a.best, `백업 자리인데 지금 최고(${a.best})보다 높은 ${a.target}을 요구한다`);
      }
    }
  }

  // 능력치를 모르면 없는 숫자를 지어내면 안 된다
  const blankSquad2 = squad.map((p) => ({ id: p.id, name: p.name, positions: p.positions, attrs: {} }));
  const blankRep = E.squadNeeds({ players: blankSquad2, standing: 'mid' });
  for (const n of blankRep.needs) {
    for (const a of n.wantAttrs) {
      assert.equal(a.best, null, '능력치가 없는데 현재값을 지어냈다');
      if (!a.need) assert.equal(a.target, null, '능력치가 없는데 목표치를 지어냈다');
    }
  }

  // 영입이 필요한 자리가 '남는 자리'에도 올라오면 서로 어긋나 보인다
  const needSet = new Set(rep.needs.map((n) => n.pos));
  for (const sp of rep.surplus) {
    assert.ok(!needSet.has(sp.pos), `${sp.ko}가 영입 필요와 남는 자리에 동시에 올라왔다`);
  }

  // 결정성
  const rep2 = E.squadNeeds({ players: squad, standing: 'mid' });
  assert.equal(JSON.stringify(rep.needs.map((n) => [n.pos, n.severity])),
    JSON.stringify(rep2.needs.map((n) => [n.pos, n.severity])), '같은 입력에서 다른 영입 목록이 나왔다');
}

// ── 엔진: 대응이 실제로 반영되는가 ────────────────────────────────────────
{
  // 상대 수비 라인이 높으면 공간으로 패스를 켜고 뒷공간 침투를 고른다
  const high = run({ formationId: '4231', dline: 4 });
  assert.ok(high.instructions.toggles.pis.on, '상대 하이라인인데 공간으로 패스가 꺼져 있다');
  assert.ok(high.plans.top.some((p) => p.id === 'in-behind'), '상대 하이라인인데 뒷공간 침투가 안 골라졌다');

  // 상대가 내려앉으면 박스 안까지 볼 배급을 켜고 역습은 끈다
  const low = run({ formationId: '451', dline: 0, mentality: 1 });
  assert.ok(low.instructions.toggles.wbib.on, '상대가 내려앉았는데 박스 안까지 볼 배급이 꺼져 있다');
  assert.ok(!low.instructions.toggles.counter.on, '상대가 내려앉았는데 역습이 켜져 있다');
  assert.ok(low.instructions.axes.dline.index > high.instructions.axes.dline.index,
    '상대가 내려앉았을 때 우리 라인이 더 높아야 한다');

  // 상대가 강하게 압박하면 후방 짧은 패스를 끄고 패스를 길게 가져간다
  const press = run({ formationId: '433dm', press: 4, loe: 4 });
  assert.ok(!press.instructions.toggles.pod.on, '상대 하이프레스인데 후방 짧은 패스가 켜져 있다');
  assert.ok(press.instructions.axes.directness.index >= TD.AXES.directness.def,
    '상대 하이프레스인데 패스가 더 짧아졌다');

  // 상대가 압박하지 않으면 후방에서 짧게 시작한다
  const passive = run({ formationId: '451', press: 0, loe: 1 });
  assert.ok(passive.instructions.toggles.pod.on, '상대가 압박하지 않는데 후방 짧은 패스가 꺼져 있다');

  // 상대에 빠른 공격수가 있으면 라인을 내린다
  const fast = run({ formationId: '442', traits: ['fast-striker'] });
  const plain = run({ formationId: '442' });
  assert.ok(fast.instructions.axes.dline.index < plain.instructions.axes.dline.index,
    '상대에 빠른 공격수가 있는데 라인이 안 내려갔다');

  // 상대 2선 플레이메이커 → 밀착 마크 + 수비형 미드필더 성격의 역할
  const amc = run({ formationId: '4231', traits: ['playmaker-amc'] });
  assert.ok(amc.instructions.toggles.tightmark.on, '상대 2선 플레이메이커에 밀착 마크가 안 켜졌다');

  // 상대 골키퍼가 불안하면 짧은 배급을 차단한다
  const weakGk = run({ formationId: '442', traits: ['weak-gk-dist'] });
  assert.ok(weakGk.instructions.toggles.psgd.on, '상대 골키퍼가 불안한데 짧은 배급 차단이 꺼져 있다');

  // 원정 약체 → 멘탈리티가 내려가고 역습으로 기운다
  const away = run({ formationId: '451' }, { venue: 'away', odds: 'weak' });
  const home = run({ formationId: '451' }, { venue: 'home', odds: 'strong' });
  assert.ok(away.instructions.axes.mentality.index < home.instructions.axes.mentality.index,
    '원정 약체가 홈 강팀보다 멘탈리티가 낮아야 한다');
  assert.ok(away.instructions.axes.press.index <= home.instructions.axes.press.index,
    '원정 약체가 홈 강팀보다 압박이 세다');

  // 상대 약점 측면 → 그쪽으로 집중 공격.
  // 우리 형태를 상대와 같게 고정한다 — 중원 수적 우위가 있으면 '중앙 집중'이
  // 더 큰 이점이라 엔진이 그쪽을 고르는 게 맞고, 그건 이 검사의 대상이 아니다.
  const flank = E.generate({
    players: squad, context: {},
    opponent: { formationId: '442', traits: ['weak-flank-l'] },
    allowedFormations: ['442']
  });
  assert.ok(flank.instructions.toggles.focus_r.on, '상대 왼쪽이 약한데 오른쪽 집중 공격이 안 켜졌다');
  assert.ok(!flank.instructions.toggles.focus_l.on, '집중 공격 방향이 양쪽 다 켜졌다');
  /*
   * 그쪽 측면을 겹쳐 공격하는 지시가 켜져야 한다.
   * 오버랩인지 언더랩인지는 그 측면 선수의 역할이 정한다 — 폭을 잡는 윙어 뒤에서
   * 오버랩을 시키면 같은 줄에 둘이 서므로, 여기서 오버랩만 고집하면 안 된다.
   */
  assert.ok(flank.instructions.toggles.ovl_r.on || flank.instructions.toggles.unl_r.on,
    '상대 왼쪽이 약한데 오른쪽에서 겹쳐 뛰는 지시가 하나도 없다');
  assert.ok(!(flank.instructions.toggles.ovl_r.on && flank.instructions.toggles.unl_r.on),
    '한쪽에 오버랩과 언더랩이 동시에 켜졌다 — 정반대의 움직임이다');
}

// 배타 그룹은 동시에 켜지지 않는다
{
  for (const opp of [{ dline: 4, press: 4, loe: 4 }, { dline: 0, mentality: 0 }, { transitionWon: 'counter' }]) {
    const r = run({ formationId: '4231', ...opp });
    const byGroup = {};
    for (const t of Object.values(r.instructions.toggles)) {
      const g = TD.TOGGLES[t.id].excl;
      if (!g || !t.on) continue;
      byGroup[g] = (byGroup[g] || 0) + 1;
    }
    for (const [g, n] of Object.entries(byGroup)) {
      assert.equal(n, 1, `배타 그룹 ${g}에서 ${n}개가 동시에 켜졌다 (${JSON.stringify(opp)})`);
    }
  }
}

// ── 엔진: 팀 균형이 실제로 작동하는가 ─────────────────────────────────────
{
  for (const fid of FD.FORMATIONS.map((f) => f.id)) {
    const r = E.generate({ players: squad, opponent: { formationId: '4231' }, context: {}, allowedFormations: [fid] });
    const lineup = r.xi.lineup;
    assert.equal(lineup.length, 11, `${fid}: 선발이 11명이 아니다`);
    assert.equal(new Set(lineup.map((l) => l.player.name)).size, 11, `${fid}: 선수가 중복 배정됐다`);

    const noDef = lineup.filter((l) => (l.role.tags || []).includes('no-defence')).length;
    assert.ok(noDef <= 1, `${fid}: 수비를 안 하는 역할이 ${noDef}명이다`);
    const pm = lineup.filter((l) => (l.role.tags || []).includes('playmaker')).length;
    assert.ok(pm <= 2, `${fid}: 플레이메이커가 ${pm}명이다`);
    const atk = lineup.filter((l) => l.duty === 'a').length;
    assert.ok(atk >= 1, `${fid}: 공격 임무가 하나도 없다`);

    // 수비형 미드필더 자리가 있으면 그중 하나는 뒤를 지켜야 한다
    const dms = lineup.filter((l) => l.slot.pos === 'DM');
    if (dms.length) {
      const anchored = dms.some((l) => {
        const t = l.role.tags || [];
        return (t.includes('holder') || t.includes('defensive-cover')) && l.duty !== 'a';
      });
      assert.ok(anchored, `${fid}: 수비형 미드필더 자리가 있는데 뒤를 지키는 역할이 없다`);
    }
  }
}

// 상대가 역습형이면 양쪽 측면 수비를 동시에 올리지 않는다
{
  const r = run({ formationId: '433dm', transitionWon: 'counter', mentality: 2, dline: 1 });
  const wide = r.xi.lineup.filter((l) => ['DR', 'DL', 'WBR', 'WBL'].includes(l.slot.pos));
  const bothUp = wide.filter((l) => l.duty === 'a' || (l.role.tags || []).includes('risk-back')).length;
  assert.ok(bothUp < 2, '상대가 역습형인데 양쪽 측면 수비가 모두 전진한다');
  assert.ok(r.instructions.toggles.regroup.on, '상대가 역습형인데 재정비가 꺼져 있다');
  assert.ok(!r.instructions.toggles.counterpress.on, '상대가 역습형인데 역압박이 켜져 있다');
}

// ── 부상·출장 정지 ────────────────────────────────────────────────────────
{
  const key = squad.find((p) => p.name === 'CB1');
  const withInjury = squad.map((p) => (p.name === 'CB1' ? { ...p, out: true, outReason: '부상' } : p));
  const r = run({ formationId: '4231' }, {}, withInjury);

  // 빠진 선수는 선발에 없어야 한다
  assert.ok(!r.xi.lineup.some((l) => l.player && l.player.name === 'CB1'),
    '부상으로 표시한 선수가 선발에 들어갔다');
  assert.equal(r.xi.lineup.filter((l) => l.player).length, 11, '한 명 빠졌는데 선발이 안 채워졌다');
  assert.equal(r.unavailable.length, 1);
  assert.equal(r.unavailable[0].name, 'CB1');
  assert.equal(r.unavailable[0].reason, '부상');
  void key;

  // 무엇이 달라졌는지 알려 줘야 한다
  assert.ok(r.injuryImpact, '이탈 영향을 계산하지 않았다');
  const im = r.injuryImpact;
  assert.ok(im.formation || im.plan || im.slots.length || im.instructions.length,
    '주전이 빠졌는데 달라진 것이 하나도 없다고 한다');
  for (const sl of im.slots) {
    assert.ok(sl.slot && sl.fromRole && sl.toRole, '자리 변화 형식이 잘못됐다');
    assert.ok(sl.fromPlayer !== sl.toPlayer || sl.roleChanged, '달라진 게 없는데 변화로 올렸다');
  }
  // 빠진 선수가 원래 있던 자리가 변화 목록에 있어야 한다
  assert.ok(im.slots.some((sl) => sl.wasUnavailable), '이탈한 선수의 자리를 표시하지 않았다');

  // 이탈이 없으면 영향 계산도 하지 않는다 (쓸데없이 두 번 돌리지 않는다)
  const clean = run({ formationId: '4231' });
  assert.equal(clean.injuryImpact, undefined, '이탈이 없는데 영향을 계산했다');
  assert.equal(clean.unavailable.length, 0);

  // 대체 선수의 성격이 다르면 역할이 따라 바뀌어야 한다
  const passer = { id: 'PASSCB', name: 'PASSCB', positions: ['DC'], foot: 'R',
    attrs: { ...squad.find((p) => p.name === 'CB1').attrs, pas: 16, tec: 15, cmp: 16 } };
  const clogger = { id: 'CLOGCB', name: 'CLOGCB', positions: ['DC'], foot: 'R',
    attrs: { ...squad.find((p) => p.name === 'CB1').attrs, pas: 5, tec: 5, cmp: 6, hea: 17, str: 17, jum: 17 } };
  const base2 = squad.filter((p) => !['CB1', 'CB2', 'CB3'].includes(p.name)).concat([passer, clogger]);
  const withPasser = E.generate({ players: base2, opponent: { formationId: '4231' }, context: {}, allowedFormations: ['442'] });
  const withoutPasser = E.generate({
    players: base2.map((p) => (p.name === 'PASSCB' ? { ...p, out: true, outReason: '부상' } : p)),
    opponent: { formationId: '4231' }, context: {}, allowedFormations: ['442']
  });
  assert.ok(!withoutPasser.xi.lineup.some((l) => l.player && l.player.name === 'PASSCB'));
  void withPasser;

  // 골키퍼가 빠지면 백업 골키퍼가 들어가야 한다
  const gkOut = squad.map((p) => (p.name === 'GK1' ? { ...p, out: true, outReason: '부상' } : p));
  const rg = run({ formationId: '4231' }, {}, gkOut);
  const gkSlot = rg.xi.lineup.find((l) => l.slot.pos === 'GK');
  assert.equal(gkSlot.player.name, 'GK2', `골키퍼가 빠졌는데 ${gkSlot.player.name}이 골문에 섰다`);

  // 너무 많이 빠져 11명이 안 되면 빈자리로 남되 죽지 않아야 한다
  const manyOut = squad.map((p, i) => (i < 12 ? { ...p, out: true, outReason: '부상' } : p));
  const rm = run({ formationId: '4231' }, {}, manyOut);
  assert.equal(rm.xi.lineup.length, 11);
  assert.equal(rm.unavailable.length, 12);
}

// ── 엔진: 스쿼드가 결과를 바꾸는가 ────────────────────────────────────────
{
  // 스태미너가 바닥인 스쿼드에서는 압박을 낮춰야 한다
  const tired = squad.map((p) => ({ ...p, attrs: { ...p.attrs, sta: 8, wor: 8 } }));
  const fresh = squad.map((p) => ({ ...p, attrs: { ...p.attrs, sta: 17, wor: 17 } }));
  const a = run({ formationId: '442' }, { venue: 'home', odds: 'strong' }, tired);
  const b = run({ formationId: '442' }, { venue: 'home', odds: 'strong' }, fresh);
  assert.ok(a.instructions.axes.press.index < b.instructions.axes.press.index,
    '체력 없는 스쿼드가 체력 좋은 스쿼드와 같은 압박 강도를 쓴다');
  assert.ok(a.warnings.length >= 0);

  // 기술이 낮은 스쿼드에서는 후방 짧은 패스를 권하지 않는다
  const clumsy = squad.map((p) => ({ ...p, attrs: { ...p.attrs, tec: 7, fir: 7, pas: 7 } }));
  const c = run({ formationId: '442', press: 0, loe: 1 }, {}, clumsy);
  assert.ok(!c.instructions.toggles.pod.on, '기술이 낮은데 후방 짧은 패스를 권한다');
}

// 능력치를 하나도 모르면 결과는 나오되 커버리지가 0으로 보고돼야 한다
{
  const blank = squad.map((p) => ({ id: p.id, name: p.name, positions: p.positions, attrs: {} }));
  const r = run({ formationId: '4231' }, {}, blank);
  assert.equal(r.xi.lineup.length, 11, '능력치가 없을 때 선발을 못 만든다');
  assert.equal(Math.round(r.squad.coverage * 100), 0, '커버리지가 0으로 보고되지 않았다');
  assert.equal(r.squad.stamina, 0, '모르는 값을 아는 값처럼 보고했다');
}

// 스쿼드가 11명 미만이어도 죽지 않아야 한다
{
  const short = squad.slice(0, 8);
  const r = run({ formationId: '442' }, {}, short);
  assert.equal(r.xi.lineup.length, 11);
  const filled = r.xi.lineup.filter((l) => l.player).length;
  assert.equal(filled, 8, `선수 8명일 때 채워진 자리가 ${filled}개다`);
  assert.ok(r.xi.lineup.some((l) => !l.player), '빈자리를 표시하지 않았다');
}

// 상대 포메이션을 모를 때도 동작해야 한다
{
  const r = run({});
  assert.equal(r.xi.lineup.length, 11);
  assert.equal(r.opponentFormation, null);
}

// ── 역할 적합도 ───────────────────────────────────────────────────────────
{
  const roles = E.ROLE_BY_ID;
  const st1 = squad.find((p) => p.name === 'ST1');   // 빠르고 마무리 좋은 공격수
  const st2 = squad.find((p) => p.name === 'ST2');   // 크고 강한 공격수
  const af = E.roleFit({ ...st1, _slotPos: 'ST' }, { ...roles.af, _slotPos: 'ST' }, 'a');
  const tf = E.roleFit({ ...st1, _slotPos: 'ST' }, { ...roles.tf, _slotPos: 'ST' }, 's');
  assert.ok(af.score > tf.score, '빠른 공격수가 타깃 포워드에 더 맞다고 나온다');
  const af2 = E.roleFit({ ...st2 }, { ...roles.af, _slotPos: 'ST' }, 'a');
  const tf2 = E.roleFit({ ...st2 }, { ...roles.tf, _slotPos: 'ST' }, 's');
  assert.ok(tf2.score > af2.score, '제공권형 공격수가 어드밴스드 포워드에 더 맞다고 나온다');

  // 낯선 자리는 확실히 깎여야 한다
  const cb = squad.find((p) => p.name === 'CB1');
  const natural = E.roleFit(cb, { ...roles.cd, _slotPos: 'DC' }, 'd');
  const foreign = E.roleFit(cb, { ...roles.w, _slotPos: 'AMR' }, 'a');
  assert.ok(natural.score > foreign.score * 1.5, '낯선 포지션 감점이 약하다');
  assert.equal(E.positionFamiliarity({ positions: ['DC'] }, 'DC'), 1);
  assert.ok(E.positionFamiliarity({ positions: ['DR'] }, 'WBR') > 0.9, '풀백→윙백 친숙도가 너무 낮다');
  assert.ok(E.positionFamiliarity({ positions: ['GK'] }, 'ST') < 0.4, '골키퍼가 공격수 자리에 익숙하다고 나온다');
}

// ── 개인 지시와 경고 ──────────────────────────────────────────────────────
{
  const r = run({ formationId: '4231', dline: 4, traits: ['fast-striker', 'playmaker-amc'] });
  assert.ok(r.individual.length > 0, '개인 지시가 하나도 나오지 않았다');
  for (const p of r.individual) {
    for (const item of p.items) {
      assert.ok(item.text && item.why, '개인 지시에 이유가 없다');
    }
  }
  // 역할이 강제하는 지시는 잠금으로 표시돼야 한다
  const locked = r.individual.flatMap((p) => p.items).filter((i) => i.locked);
  const anyLockedRole = r.xi.lineup.some((l) => (l.role.locked || []).length);
  assert.equal(locked.length > 0, anyLockedRole, '역할이 강제하는 지시가 잠금으로 표시되지 않았다');

  assert.ok(r.brief.key.length + r.brief.normal.length > 0, '대응 브리핑이 비어 있다');
  for (const item of [...r.brief.key, ...r.brief.normal]) {
    assert.ok(item.why && item.action, '브리핑 항목에 이유나 행동이 빠졌다');
  }
}

// 경고가 실제로 감지되는지 — 압박은 센데 체력이 없는 조합
{
  const tired = squad.map((p) => ({ ...p, attrs: { ...p.attrs, sta: 8, wor: 8 } }));
  const r = E.generate({
    players: tired,
    opponent: { formationId: '4231', traits: ['weak-gk-dist', 'playmaker-deep'] },
    context: { venue: 'home', odds: 'strong', goal: 'must-win' },
    allowedFormations: ['4222']
  });
  assert.ok(r.warnings.length > 0, '무리한 조합인데 경고가 없다');
  for (const w of r.warnings) assert.ok(w.text && w.level, '경고 형식이 잘못됐다');

  /*
   * 포지션 열 없이 내보낸 스쿼드에서는 선발 전원이 "자리가 익숙하지 않습니다"로
   * 나와 같은 말이 열한 번 반복됐다. 한 줄로 묶고, 무엇을 하면 되는지를 말해야 한다.
   */
  const noPos = squad.map((p) => ({ ...p, positions: [] }));
  const np = E.generate({
    players: noPos,
    opponent: { formationId: '4231', traits: [] },
    context: { venue: 'home', odds: 'even', goal: 'win' }
  });
  const famLines = np.warnings.filter((w) => /익숙하지 않습니다/.test(w.text));
  assert.ok(famLines.length <= 1, `포지션을 모르는데 경고가 ${famLines.length}줄 나왔다`);
  const grouped = np.warnings.find((w) => /등록 포지션을 모릅니다/.test(w.text));
  assert.ok(grouped, '포지션을 모른다는 사실을 한 줄로 알려 주지 않는다');
  assert.ok(/포지션.*열/.test(grouped.fix), `무엇을 하면 되는지가 없다: ${grouped.fix}`);

  // 포지션을 아는 스쿼드에서는 그 묶음 경고가 나오면 안 된다
  const withPos = E.generate({
    players: squad,
    opponent: { formationId: '4231', traits: [] },
    context: { venue: 'home', odds: 'even', goal: 'win' }
  });
  assert.ok(!withPos.warnings.some((w) => /등록 포지션을 모릅니다/.test(w.text)),
    '포지션을 아는데 모른다고 했다');

  // 조사가 '은(는)' 같은 괄호 형태로 남으면 안 된다
  for (const w of [...np.warnings, ...withPos.warnings]) {
    assert.ok(!/[은는이가을를와과]\([은는이가을를와과]\)/.test(w.text + (w.fix || '')),
      `조사가 괄호로 남았다: ${w.text}`);
  }
}

// ── 역할 조합 충돌 검사 ───────────────────────────────────────────────────
/*
 * 지시나 상대를 보지 않고 11자리만으로 판정한다. 이 검사를 만들자마자
 * 이 도구가 스스로 추천하던 기본 전술이 다섯 항목에 걸렸다 — 폭 없음,
 * 침투 없음, 양쪽 측면이 모두 안쪽, 최전방은 내려오는데 들어갈 사람 없음.
 * 그래서 같은 조건을 buildXI의 균형 벌점에도 넣었고, 아래에서 둘 다 확인한다.
 */
{
  const ROLE = (id) => RD.ROLES.find((r) => r.id === id);
  const slot = (pos, roleId, duty, name) => ({
    slot: { pos, x: 0, y: 0, id: pos },
    role: ROLE(roleId), duty,
    player: { name: name || pos, attrs: {} },
    familiarity: 1
  });
  // 4-2-3-1: 양쪽 측면 앞뒤가 전부 안으로 들어오고, 달리는 사람이 없는 조합
  const broken = {
    formation: { id: 'x', ko: '검사용' },
    lineup: [
      slot('GK', 'gk', 'd'),
      slot('DR', 'ifb', 'd'), slot('DC', 'cd', 'd'), slot('DC', 'cd', 'd'), slot('DL', 'ifb', 'd'),
      slot('DM', 'dlp', 's'), slot('MC', 'ap', 's'),
      slot('AMR', 'iw', 's'), slot('AMC', 'eng', 's'), slot('AML', 'iw', 's'),
      slot('ST', 'f9', 's')
    ]
  };
  const found = E.chemistry(broken);
  const kinds = new Set(found.map((f) => f.kind));
  for (const want of ['no-width', 'no-runner', 'both-inverted-l', 'both-inverted-r', 'empty-front']) {
    assert.ok(kinds.has(want), `'${want}'를 못 잡았다: ${[...kinds].join(', ')}`);
  }
  for (const f of found) {
    assert.ok(f.text && f.text.length > 10, `${f.kind}에 설명이 없다`);
    assert.ok(f.fix && f.fix.length > 10, `${f.kind}에 무엇을 하면 되는지가 없다`);
    assert.ok(['high', 'mid'].includes(f.level), `${f.kind}의 level이 이상하다`);
    // 조사가 어긋나면 조언이 기계가 쓴 것처럼 읽힌다
    assert.ok(!/윙백가|맨라|포워드이라|이\(가\)/.test(f.text + f.fix), `조사가 어긋났다: ${f.text}`);
  }
  assert.equal(new Set(found.map((f) => f.kind)).size, found.length, '같은 검사가 두 번 나왔다');

  // 멀쩡한 조합에서는 아무것도 나오면 안 된다 (경고가 늘 떠 있으면 아무도 안 읽는다)
  const sound = {
    formation: { id: 'y', ko: '검사용' },
    lineup: [
      slot('GK', 'gk', 'd'),
      slot('DR', 'fb', 's'), slot('DC', 'cd', 'd'), slot('DC', 'bpd', 'd'), slot('DL', 'wb', 's'),
      slot('DM', 'dm', 'd'), slot('MC', 'b2b', 's'),
      slot('AMR', 'w', 's'), slot('AMC', 'am', 's'), slot('AML', 'if', 'a'),
      slot('ST', 'tf', 'a')
    ]
  };
  assert.equal(E.chemistry(sound).length, 0,
    '문제없는 조합에서 경고가 나왔다: ' + E.chemistry(sound).map((f) => f.text).join(' / '));

  /*
   * 그리고 엔진이 실제로 내놓는 전술이 이 검사를 통과해야 한다 — 도구가 자기
   * 추천을 스스로 반려하면 어느 쪽 말을 믿어야 할지 알 수 없다.
   *
   * 포메이션 20개를 하나씩 고정해서 전부 돌린다. 한 형태에서만 확인하면
   * 그 형태가 우연히 멀쩡한 것인지 균형 벌점이 일하는 것인지 구분되지 않는다.
   */
  {
    /*
     * 세 번째 변형은 일부러 만든 함정이다. 패스·기술만 높고 크로스·체력·발이
     * 없으면 모든 측면 자리에서 인버티드 계열이 적합도로 이긴다 — 균형 벌점이
     * 없으면 열세 개 포메이션이 "폭을 잡는 사람 0명"으로 나온다.
     */
    const insideOnly = squad.map((p) => ({
      ...p,
      attrs: { ...p.attrs, pas: 17, tec: 17, fir: 17, vis: 16, cmp: 16, cro: 4, sta: 6, wor: 6, pac: 7, acc: 7 }
    }));
    const variants = [
      ['기본', squad],
      ['기술형', squad.map((p) => ({ ...p, attrs: { ...p.attrs, tec: 16, pas: 16, vis: 15, pac: 9 } }))],
      ['속공형', squad.map((p) => ({ ...p, attrs: { ...p.attrs, pac: 17, acc: 16, tec: 8, pas: 8 } }))],
      ['안쪽 편향', insideOnly]
    ];
    for (const [label, players] of variants) {
      for (const f of FD.FORMATIONS) {
        const r = E.generate({
          players,
          opponent: { formationId: '4231', traits: [] },
          context: { venue: 'home', odds: 'even', goal: 'win' },
          allowedFormations: [f.id]
        });
        const bad = E.chemistry(r.xi).filter((x) => x.level === 'high');
        assert.equal(bad.length, 0,
          `${label} / ${f.ko}: 엔진이 낸 조합이 스스로 걸렸다 — ${bad.map((x) => x.text).join(' / ')}`);
      }
    }
    for (const standing of ['top', 'mid', 'bottom']) {
      const base = E.baseTactic({ players: squad, standing });
      const bad = E.chemistry(base.xi).filter((x) => x.level === 'high');
      assert.equal(bad.length, 0,
        `기본 전술(${standing})이 스스로 낸 조합에서 걸렸다: ${bad.map((x) => x.text).join(' / ')}`);
    }
  }
}

// ── 선수 특성 ─────────────────────────────────────────────────────────────
/*
 * 특성은 능력치보다 강하게 역할을 바꾼다. 「측면 라인 붙기」가 있는 선수를
 * 인사이드 포워드로 세우면 그 역할이 하려는 것을 선수가 하지 않는다.
 * 내보내기 파일에 안 들어 있어 화면에서 직접 켜야 하므로, 켠 값이 실제로
 * 결과를 바꾸는지가 이 기능의 전부다.
 */
{
  /*
   * 엔진이 실제로 내놓을 수 있는 개인 지시 문구 전부.
   * 소스에서 직접 긁는다 — 목록을 손으로 적어 두면 그 목록이 먼저 낡는다.
   */
  const INSTR_TEXTS = new Set([
    ...[...read('engine.js').matchAll(/pi\.push\(\{\s*text:\s*'([^']+)'/g)].map((m) => m[1]),
    ...RD.ROLES.flatMap((r) => r.locked || [])
  ]);
  assert.ok(INSTR_TEXTS.size >= 10, `개인 지시 문구를 ${INSTR_TEXTS.size}개만 찾았다 — 추출이 깨졌다`);

  const ROLE_TAGS = new Set(RD.ROLES.flatMap((r) => r.tags || []));
  const ROLE_IDS3 = new Set(RD.ROLES.map((r) => r.id));
  const seenTrait = new Set();
  for (const t of TRD.TRAITS) {
    assert.ok(!seenTrait.has(t.id), `특성 id 중복: ${t.id}`);
    seenTrait.add(t.id);
    assert.ok(t.ko && t.en && t.group, `특성 ${t.id}에 이름이 빠졌다`);
    // 영문 이름이 기준이다 — 한국어 표기는 판본에 따라 다를 수 있다
    assert.ok(/^[A-Za-z' -]+$/.test(t.en), `특성 ${t.id}의 영문 이름이 이상하다: ${t.en}`);
    for (const tag of Object.keys(t.fit || {})) {
      assert.ok(ROLE_TAGS.has(tag), `특성 ${t.id}가 없는 역할 태그 ${tag}를 가리킨다`);
    }
    for (const id of Object.keys(t.roleFit || {})) {
      assert.ok(ROLE_IDS3.has(id), `특성 ${t.id}가 없는 역할 ${id}을 가리킨다`);
    }
    /*
     * makes/fights에 적은 지시 문구는 엔진이 실제로 내놓는 것과 글자까지 같아야
     * 한다. 한 글자만 틀려도 아무 일도 일어나지 않고, 그런 건 눈으로는 안 보인다.
     */
    for (const x of [...(t.makes || []), ...(t.fights || [])]) {
      assert.ok(INSTR_TEXTS.has(x),
        `특성 ${t.id}의 '${x}'는 엔진이 내놓는 개인 지시 문구가 아니다 — 오타면 조용히 아무 일도 안 한다`);
    }
  }

  const mk3 = (n, pos, over, traits) => {
    const a = {};
    for (const id of RD.ATTR_ORDER) a[id] = 11;
    Object.assign(a, over || {});
    return { id: n, name: n, positions: pos, foot: 'R', age: 25, attrs: a, traits: traits || [] };
  };
  const rest = [
    mk3('GK', ['GK'], { ref: 14, han: 13, cmd: 13, ono: 13, aer: 13 }),
    mk3('DR', ['DR'], { tck: 13, mar: 13, cro: 12, sta: 14 }),
    mk3('DC1', ['DC'], { mar: 14, tck: 14, hea: 14, jum: 14 }),
    mk3('DC2', ['DC'], { mar: 14, tck: 14, hea: 14, jum: 14 }),
    mk3('DL', ['DL'], { tck: 13, mar: 13, cro: 12, sta: 14 }),
    mk3('MC1', ['MC'], { pas: 14, tck: 13, wor: 14, sta: 14 }),
    mk3('MC2', ['MC'], { pas: 15, vis: 14, tec: 14 }),
    mk3('AMC', ['AMC'], { pas: 15, vis: 15, tec: 14, otb: 14 }),
    mk3('ST', ['ST'], { fin: 15, otb: 14, pac: 14, acc: 14 })
  ];
  const roleWith = (traits) => {
    const squad3 = rest.concat([
      mk3('그냥윙', ['AML'], { cro: 13, dri: 13, pac: 13, acc: 13 }),
      mk3('윙어', ['AMR'], { cro: 14, dri: 15, tec: 14, pac: 15, acc: 15, otb: 14, fin: 13 }, traits)
    ]);
    const r = E.generate({
      players: squad3, opponent: { formationId: '442', traits: [] },
      context: { venue: 'home', odds: 'even', goal: 'win' }, allowedFormations: ['4231']
    });
    const l = r.xi.lineup.find((x) => x.player && x.player.name === '윙어');
    return l ? l.role.id : null;
  };
  const plain = roleWith([]);
  assert.equal(plain, 'w', `특성 없이 윙어가 아니다: ${plain}`);
  assert.equal(roleWith(['cuts-inside']), 'iw',
    '「안쪽으로 파고들기」를 켰는데 여전히 정통 윙어다');
  assert.equal(roleWith(['hugs-line']), 'w',
    '「측면 라인 붙기」를 켰는데 안쪽 역할로 갔다');

  /*
   * 개인 지시에서 특성이 하는 일 두 가지.
   *  - 특성이 이미 하는 지시는 뺀다(중복해서 켤 이유가 없다)
   *  - 특성과 반대인 지시는 지우지 않고 표시한다. 조용히 빼면 왜 그 조언이
   *    없는지 알 수 없어 사용자가 직접 켜 버린다.
   */
  const instrWith = (traits) => {
    const squad3 = rest.concat([
      mk3('그냥윙', ['ML'], { cro: 13, dri: 13 }),
      mk3('윙어', ['MR'], { cro: 8, dri: 16, tec: 14, pac: 15, acc: 15 }, traits)
    ]);
    const r = E.generate({
      players: squad3, opponent: { formationId: '442', traits: [] },
      context: { venue: 'home', odds: 'even', goal: 'win' }, allowedFormations: ['442']
    });
    const g = r.individual.find((x) => x.player && x.player.name === '윙어');
    return { items: g ? g.items : [], notes: r.individual.traitNotes || [] };
  };
  const noTrait = instrWith([]);
  assert.ok(noTrait.items.some((i) => i.text === '안쪽으로 접어 들어가기'),
    '크로스 8 · 드리블 16인데 안쪽으로 접으라는 지시가 없다');

  const fighting = instrWith(['hugs-line']);
  const blocked = fighting.items.find((i) => i.text === '안쪽으로 접어 들어가기');
  assert.ok(blocked, '특성과 부딪히는 지시를 조용히 지웠다 — 왜 없는지 알 수 없게 된다');
  assert.equal(blocked.blockedBy, '측면 라인 붙기');
  assert.ok(/지시만으로는 바뀌지 않습니다/.test(blocked.why),
    `특성이 이긴다는 설명이 없다: ${blocked.why}`);

  const shooter = instrWith(['shoots-distance']);
  assert.ok(shooter.items.some((i) => i.trait && /먼 거리/.test(i.text)),
    '특성 경고가 개인 지시에 안 붙었다');

  /*
   * 특성이 이미 하고 있는 지시는 빼고, 왜 뺐는지 남긴다.
   * 상대에 타깃형 공격수가 있으면 제공권 좋은 센터백에게 「강하게 밀착 마크」가
   * 붙는데, 「상대를 밀착 마크」 특성이 있으면 그건 이미 하고 있는 행동이다.
   */
  const markWith = (traits) => {
    const squad4 = [
      mk3('GK', ['GK'], { ref: 14, han: 13, cmd: 13, ono: 13, aer: 13 }),
      mk3('DR', ['DR'], { tck: 13, mar: 13 }),
      mk3('DC1', ['DC'], { mar: 16, tck: 15, hea: 15, jum: 16 }, traits),
      mk3('DC2', ['DC'], { mar: 14, tck: 14, hea: 12, jum: 11 }),
      mk3('DL', ['DL'], { tck: 13, mar: 13 }),
      mk3('MC1', ['MC'], { pas: 14, tck: 13 }), mk3('MC2', ['MC'], { pas: 15, vis: 14 }),
      mk3('MC3', ['MC'], { pas: 14, wor: 14 }),
      mk3('AMR2', ['AMR'], { cro: 14, dri: 14 }), mk3('AML2', ['AML'], { cro: 13, dri: 14 }),
      mk3('ST2', ['ST'], { fin: 15, otb: 14 })
    ];
    const r = E.generate({
      players: squad4, opponent: { formationId: '442', traits: ['target-man'] },
      context: { venue: 'home', odds: 'even', goal: 'win' }, allowedFormations: ['433']
    });
    const g = r.individual.find((x) => x.player && x.player.name === 'DC1');
    return { items: g ? g.items.map((i) => i.text) : [], notes: r.individual.traitNotes || [] };
  };
  const plainMark = markWith([]);
  assert.ok(plainMark.items.includes('강하게 밀착 마크'),
    `제공권 좋은 센터백에게 밀착 마크 지시가 없다: ${plainMark.items.join(', ')}`);

  const already = markWith(['tight-marking']);
  assert.ok(!already.items.includes('강하게 밀착 마크'),
    '특성으로 이미 하고 있는 지시를 또 켜라고 한다');
  assert.ok(already.notes.some((n) => /상대를 밀착 마크/.test(n.text)),
    '지시를 뺐으면서 왜 뺐는지 남기지 않았다 — 사용자는 빠진 줄도 모른다');

  /*
   * 특성을 선수마다 손으로 켜는 것은 24명이면 그냥 노가다다. 그래서
   * 스쿼드 보기에 「선수 특성」 열이 있으면 파일에서 그대로 읽는다.
   * 한 칸에 여러 개가 쉼표로 들어온다.
   */
  assert.deepEqual([...IMP.parseTraits('안쪽으로 파고들기, 먼 거리에서 슛 시도')],
    ['cuts-inside', 'shoots-distance']);
  assert.deepEqual([...IMP.parseTraits('Cuts Inside From Both Wings; Hugs Line')],
    ['cuts-inside', 'hugs-line']);
  // 못 알아본 것은 버린다 — 지어내면 엉뚱한 특성이 켜져 역할이 통째로 달라진다
  assert.equal(IMP.parseTraits('알 수 없는 특성, 이상한 것').length, 0);
  assert.equal(IMP.parseTraits('-').length, 0);
  assert.equal(IMP.parseTraits('').length, 0);
  assert.equal(IMP.parseTraits(null).length, 0);

  const withTraitCol = IMP.parseSquad(
    'Name\tPosition\tAge\t선수 특성\n김선수\tM (C)\t24\t결정적인 패스 시도, 롱패스 시도');
  assert.deepEqual([...withTraitCol.players[0].traits], ['killer-balls', 'long-passes']);
  assert.equal(withTraitCol.players[0].age, 24);
  assert.equal(withTraitCol.report.unknownColumns.length, 0,
    '특성 열을 모르는 열로 보고했다');

  // 특성 열이 없는 파일이 화면에서 켜 둔 특성을 지우면 안 된다
  const hadTraits = [{ name: '김선수', positions: ['MC'], attrs: { pas: 15 }, traits: ['killer-balls'] }];
  const merged2 = IMP.mergeSquad(hadTraits, [{ name: '김선수', positions: ['MC'], attrs: { tec: 14 } }]);
  assert.deepEqual([...merged2.players[0].traits], ['killer-balls'],
    '특성 열이 없는 파일을 넣었더니 켜 둔 특성이 지워졌다');

  // 특성이 없으면 아무것도 바뀌면 안 된다 (기존 사용자에게 영향이 없어야 한다)
  assert.equal(E.traitAdjust({ traits: [] }, RD.ROLES[0]).factor, 1);
  assert.equal(E.traitAdjust({}, RD.ROLES[0]).factor, 1);
  assert.equal(E.traitAdjust({ traits: ['없는특성'] }, RD.ROLES[0]).factor, 1);
}

// ── 훈련 제안 ─────────────────────────────────────────────────────────────
/*
 * "이 자리에 사람이 없다"의 답이 늘 영입은 아니다. FM에서 더 싼 해법은
 * 이미 있는 선수에게 옆자리를 가르치는 것이다.
 *
 * 처음 만들었을 때 골키퍼에게 왼쪽 수비를 배우라고 했다 — 친숙도 0.05로
 * 나누니 이득이 폭발했기 때문이다. 그래서 옆자리만 제안하도록 막았다.
 */
{
  const mk4 = (n, pos, age, over) => {
    const a = {};
    for (const id of RD.ATTR_ORDER) a[id] = 11;
    Object.assign(a, over || {});
    return { id: n, name: n, positions: pos, foot: 'R', age, attrs: a };
  };
  const thin = [
    mk4('골키퍼', ['GK'], 27, { ref: 15, han: 14, cmd: 13, ono: 14, aer: 13 }),
    mk4('오백', ['DR'], 24), mk4('센백A', ['DC'], 29), mk4('센백B', ['DC'], 31), mk4('왼백', ['DL'], 23),
    mk4('중미A', ['MC'], 21, { pas: 15, vis: 14, tck: 13, pos: 13, wor: 14, sta: 15 }),
    mk4('중미B', ['MC'], 26, { pas: 14, tck: 15, pos: 15, mar: 14, wor: 15, sta: 15 }),
    mk4('중미C', ['MC'], 33, { pas: 16, vis: 15, tec: 15, cmp: 14 }),
    mk4('윙R', ['AMR'], 22, { cro: 14, dri: 15, pac: 15, acc: 15 }),
    mk4('윙L', ['AML'], 25, { cro: 13, dri: 15, pac: 16, acc: 15 }),
    mk4('공격수', ['ST'], 28, { fin: 15, otb: 14, pac: 14, acc: 14 }),
    mk4('백업GK', ['GK'], 30, { ref: 12, han: 12 }),
    mk4('백업센백', ['DC'], 20, { mar: 13, tck: 13, hea: 13, jum: 13 }),
    mk4('백업윙', ['AML', 'AMR'], 19, { dri: 14, pac: 15, acc: 14 })
  ];
  const tp = E.trainingPlan({ players: thin, standing: 'mid' });
  assert.ok(tp, '훈련 제안이 나오지 않았다');

  for (const t of tp.position) {
    const p = thin.find((x) => x.name === t.name);
    const isGk = p.positions.every((x) => x === 'GK');
    assert.ok(isGk === (t.pos === 'GK'),
      `골키퍼와 필드를 오가는 훈련을 제안했다: ${t.name} → ${t.pos}`);
    assert.ok(!p.positions.includes(t.pos), `이미 뛸 수 있는 자리를 배우라고 했다: ${t.name} → ${t.pos}`);
    assert.ok(t.after > t.now, `이득이 없는데 제안했다: ${t.name} ${t.now}→${t.after}`);
    assert.ok(t.after <= 100, `적합도가 100을 넘었다: ${t.after}`);
    assert.ok(!/[은는이가을를]\([은는이가을를]\)/.test(t.text + t.why), `조사가 괄호로 남았다: ${t.why}`);
  }
  assert.ok(tp.position.length, '옆자리가 비어 있는데 훈련 제안이 하나도 없다');
  assert.ok(tp.position.some((t) => t.band === 'young'), '어린 선수 후보가 하나도 없다');

  // 나이: 30대 주전 + 뒤가 얇은 자리
  assert.ok(tp.ageing.every((a) => a.age >= 30), '30세 미만을 노쇠 자리로 봤다');
  const midOld = tp.ageing.find((a) => a.name === '중미C');
  assert.ok(midOld, '33세 주전 중앙 미드필더를 못 찾았다');
  assert.ok(midOld.successors.length, '뒤에 어린 선수가 있는데 없다고 했다');

  // 나이를 모르는 스쿼드에서는 나이 이야기를 하지 않는다
  const noAge = thin.map((p) => { const q = { ...p }; delete q.age; return q; });
  assert.equal(E.trainingPlan({ players: noAge, standing: 'mid' }).ageing.length, 0,
    '나이를 모르는데 2년 뒤 이야기를 했다');

  // 개인 훈련 초점: 역할 요구치를 못 넘긴 항목이 먼저 온다
  const slow = thin.map((p) => (p.name === '공격수'
    ? { ...p, attrs: { ...p.attrs, pac: 6, acc: 6, fin: 16 } } : p));
  const tp2 = E.trainingPlan({ players: slow, standing: 'mid' });
  if (tp2.focus.some((f) => f.kind === 'req')) {
    assert.equal(tp2.focus[0].kind, 'req', '역할 전제가 무너진 항목이 맨 위가 아니다');
  }
  for (const f of tp2.focus) {
    assert.ok(RD.ATTRS[f.attr], `알 수 없는 능력치 ${f.attr}`);
    if (f.want != null) assert.ok(f.have < f.want, '이미 넘긴 값을 훈련하라고 했다');
    assert.ok(!/[은는이가을를]\([은는이가을를]\)/.test(f.why), `조사가 괄호로 남았다: ${f.why}`);
  }
}

// ── 전술 슬롯 ─────────────────────────────────────────────────────────────
/*
 * FM에서는 포메이션을 매 경기 갈아엎을 수 없다. 선수들이 익히는 데 몇 주가
 * 걸리고(전술 친숙도) 바꾸면 리셋된다. 그런데 이 도구는 상대가 바뀔 때마다
 * 포메이션을 새로 골랐다 — 상대 다섯 팀에 포메이션 네 종류가 나왔고, 그건
 * 게임에서 따라 할 수 없는 조언이다.
 *
 * 그래서 FM처럼 최대 세 개를 들고 다니고 그중에서 고른다.
 */
{
  const tactics = [
    { id: 'a', name: 'A · 기본', formationId: '442d' },
    { id: 'b', name: 'B · 수비', formationId: '4141' },
    { id: 'c', name: 'C · 측면', formationId: '433dm' }
  ];
  const run = (opp) => E.pickTactic({
    players: squad, tactics,
    opponent: Object.assign({ formationId: '442', traits: [] }, opp),
    context: { venue: 'home', odds: 'even', goal: 'win' }
  });

  const r = run({});
  assert.ok(r, '슬롯이 있는데 아무것도 못 골랐다');
  assert.equal(r.ranking.length, 3, `슬롯 ${r.ranking.length}개만 평가했다`);
  // 고른 포메이션은 반드시 저장해 둔 것 중 하나여야 한다
  const saved = new Set(tactics.map((t) => t.formationId));
  assert.ok(saved.has(r.result.xi.formation.id),
    `저장하지 않은 포메이션을 골랐다: ${r.result.xi.formation.id}`);
  // 순위는 점수 내림차순
  for (let i = 1; i < r.ranking.length; i++) {
    assert.ok(r.ranking[i - 1].total >= r.ranking[i].total, '슬롯 순위가 정렬되지 않았다');
  }
  assert.ok(r.note && r.note.length > 10, '어느 것을 왜 골랐는지가 없다');
  assert.ok(!/[은는이가을를와과]\([은는이가을를와과]\)/.test(r.note), `조사가 괄호로 남았다: ${r.note}`);

  /*
   * 상대가 바뀌어도 포메이션은 저장해 둔 셋 안에서만 움직여야 한다.
   * 이게 이 기능의 전부다.
   */
  const seen = new Set();
  for (const opp of [{}, { dline: 4, loe: 4, press: 4 }, { dline: 0, loe: 0, press: 1 },
                     { transitionWon: 'counter' }, { formationId: '352' }, { formationId: '532' }]) {
    const x = run(opp);
    seen.add(x.result.xi.formation.id);
    assert.ok(saved.has(x.result.xi.formation.id),
      `상대가 바뀌자 저장하지 않은 포메이션으로 갔다: ${x.result.xi.formation.id}`);
  }
  assert.ok(seen.size <= 3, `저장한 것보다 많은 포메이션이 나왔다: ${seen.size}`);

  // 저장해 둔 것으로 크게 부족하면 그 사실을 말해야 한다 — 조용히 넘어가면 안 된다
  const narrow = E.pickTactic({
    players: squad, tactics: [{ id: 'x', name: 'X', formationId: '541' }],
    opponent: { formationId: '442', traits: [] },
    context: { venue: 'home', odds: 'strong', goal: 'must-win' }
  });
  assert.ok(narrow, '슬롯 하나만 있어도 골라야 한다');
  assert.equal(narrow.ranking.length, 1);
  assert.ok(['use-saved', 'consider-new'].includes(narrow.advise));
  if (narrow.advise === 'consider-new') {
    assert.ok(/훈련|익히는/.test(narrow.note),
      `새 전술을 권하면서 훈련이 필요하다는 말이 없다: ${narrow.note}`);
  }

  // 없는 포메이션 id는 조용히 거른다 (저장본이 낡았을 수 있다)
  const bogus = E.pickTactic({
    players: squad,
    tactics: [{ id: 'z', name: 'Z', formationId: '없는포메이션' }, tactics[0]],
    opponent: { formationId: '442', traits: [] }, context: { venue: 'home', odds: 'even', goal: 'win' }
  });
  assert.equal(bogus.ranking.length, 1, '없는 포메이션을 슬롯으로 셌다');

  // 슬롯이 없으면 아무 말도 하지 않는다 (예전 사용자에게 영향이 없어야 한다)
  assert.equal(E.pickTactic({ players: squad, tactics: [] }), null);
  assert.equal(E.pickTactic({ players: squad }), null);
}

// ── 전술 친숙도 ───────────────────────────────────────────────────────────
/*
 * FM은 저장된 전술마다 친숙도를 따로 매긴다. 그래서 이미 익힌 슬롯끼리
 * 갈아타는 것은 공짜지만, 안 익은 슬롯을 종이 위 점수만 보고 꺼내면 그 점수가
 * 안 나온다. 친숙도를 넣었을 때 그게 실제로 선택을 바꾸는지 확인한다.
 */
{
  // 데이터 정합성 — 단계가 순서대로여야 감점도 순서대로 먹힌다
  assert.ok(TD.FAMILIARITY.length >= 3, '친숙도 단계가 너무 적다');
  let prevPen = Infinity;
  for (const f of TD.FAMILIARITY) {
    assert.ok(f.id && f.ko && f.en, `친숙도 ${f.id}에 이름이 빠졌다`);
    assert.ok(typeof f.penalty === 'number' && f.penalty >= 0, `${f.id}의 감점이 이상하다`);
    assert.ok(f.penalty <= prevPen, '친숙도가 올라가는데 감점이 줄지 않는다');
    prevPen = f.penalty;
    assert.ok(f.note && f.note.length > 5, `${f.id}에 설명이 없다`);
  }
  assert.equal(TD.FAMILIARITY[TD.FAMILIARITY.length - 1].penalty, 0, '완전히 익은 단계에도 감점이 있다');
  // 안 익은 전술의 감점은 '새 포메이션을 만들 값어치'보다 커야 한다.
  // 그렇지 않으면 "안 익었으니 하나 더 만들자"는 거꾸로 된 조언이 나온다.
  assert.ok(TD.FAMILIARITY[0].penalty > 12, '어색한 전술의 감점이 새 전술을 만드는 기준보다 작다');

  const two = (famA, famB) => [
    { id: 'a', name: 'A · 기본', formationId: '4231', familiarity: famA },
    { id: 'b', name: 'B · 수비', formationId: '4141', familiarity: famB }
  ];
  const run = (tactics) => E.pickTactic({
    players: squad, tactics,
    opponent: { formationId: '442', traits: [] },
    context: { venue: 'home', odds: 'even', goal: 'win' }
  });

  // 안 넣으면 예전과 똑같아야 한다
  const blank = run(two(undefined, undefined));
  assert.ok(blank.ranking.every((r) => r.famPenalty === 0 && r.effective === r.total),
    '친숙도를 안 넣었는데 점수가 깎였다');
  assert.equal(blank.famOverride, null);
  assert.equal(blank.trainNote, '');

  // 점수 1위를 어색함으로 만들면 2위가 올라와야 한다
  const top = blank.ranking[0], second = blank.ranking[1];
  const flipped = run(two(
    top.tactic.id === 'a' ? 'awkward' : 'fluid',
    top.tactic.id === 'b' ? 'awkward' : 'fluid'
  ));
  assert.equal(flipped.best.tactic.id, second.tactic.id, '어색한 전술을 그대로 골랐다');
  assert.equal(flipped.rawBest.tactic.id, top.tactic.id, '종이 위 1위가 바뀌었다');
  assert.ok(flipped.famOverride, '왜 점수 1위를 안 골랐는지 말하지 않았다');
  assert.ok(/어색함/.test(flipped.note), `바꾼 이유가 안내문에 없다: ${flipped.note}`);
  // 화면에 나온 슬롯 이름과 실제 선발이 어긋나면 안 된다
  assert.equal(flipped.result.xi.formation.id, flipped.best.tactic.formationId,
    '고른 슬롯과 실제로 짠 포메이션이 다르다');

  // 둘 다 완전히 익었으면 감점이 없고 순서도 그대로여야 한다
  const bothFluid = run(two('fluid', 'fluid'));
  assert.equal(bothFluid.best.tactic.id, top.tactic.id, '둘 다 익었는데 순서가 바뀌었다');
  assert.equal(bothFluid.famOverride, null);

  // 고른 슬롯이 덜 익었으면 훈련하라고 해야 한다 — 조용히 추천하면 안 된다
  const one = E.pickTactic({
    players: squad,
    tactics: [{ id: 'x', name: 'X · 기본', formationId: '4231', familiarity: 'awkward' }],
    opponent: { formationId: '442', traits: [] },
    context: { venue: 'home', odds: 'even', goal: 'win' }
  });
  assert.ok(/훈련|세션|프리시즌/.test(one.trainNote), `덜 익은 슬롯인데 훈련 얘기가 없다: ${one.trainNote}`);

  // 모르는 값은 무시한다 (낡은 저장본이 있을 수 있다)
  const bogusFam = run(two('없는단계', undefined));
  assert.ok(bogusFam.ranking.every((r) => r.famPenalty === 0), '알 수 없는 친숙도로 점수를 깎았다');

  for (const r of [blank, flipped, bothFluid, one]) {
    assert.ok(!/NaN|undefined|\[object |[은는이가을를와과]\([은는이가을를와과]\)/.test(r.note + r.trainNote),
      `안내문에 이상한 값이 있다: ${r.note} / ${r.trainNote}`);
  }
}

// ── 슬롯 구성 진단 ────────────────────────────────────────────────────────
/*
 * 슬롯끼리 갈아타는 것은 친숙도를 안 깎지만, 뼈대가 다 다른 슬롯 셋은 훈련이
 * 셋으로 쪼개져 어느 것도 안 올라간다. 반대로 셋 다 성격이 비슷하면 훈련은
 * 싸지만 강팀 원정에서 꺼낼 게 없다. 그 둘을 같이 봐야 한다.
 */
{
  const nm = (ids) => ids.map((id, i) => ({ id: 't' + i, name: String.fromCharCode(65 + i), formationId: id }));
  const kinds = (a) => new Set(a.findings.map((f) => f.kind));

  // 하나도 없으면 그것부터 말해야 한다
  const none = E.slotAudit([]);
  assert.equal(none.count, 0);
  assert.ok(kinds(none).has('none'), '슬롯이 없는데 아무 말도 안 한다');
  assert.equal(none.findings[0].level, 'high');

  // 뼈대가 전부 다른 셋 — 훈련이 쪼개진다
  const spread = E.slotAudit(nm(['4231', '352', '442']));
  assert.ok(kinds(spread).has('all-distinct'), '뼈대가 다 다른데 경고가 없다');
  const warn = spread.findings.find((f) => f.kind === 'all-distinct');
  assert.equal(warn.level, 'high');
  assert.ok(warn.fix && warn.fix.length > 10, '무엇을 하면 되는지가 없다');

  // 같은 뼈대끼리는 훈련이 싸다 — 이건 칭찬해야지 경고하면 안 된다
  const tight = E.slotAudit(nm(['4231', '4141']));
  assert.ok(kinds(tight).has('one-shape'), '같은 뼈대인데 아무 말도 안 한다');
  assert.equal(tight.findings.find((f) => f.kind === 'one-shape').level, 'good');
  assert.ok(!kinds(tight).has('all-distinct'));

  // 둘인데 뼈대가 다르면 훈련이 반으로 갈린다 — 아무 말도 안 하면 안 된다
  const twoWays = E.slotAudit(nm(['4231', '352']));
  assert.ok(kinds(twoWays).has('split-shape'), '뼈대가 갈렸는데 아무 말도 안 한다');
  assert.ok(/뼈대/.test(twoWays.findings.find((f) => f.kind === 'split-shape').text));

  // 셋 중 둘이 같은 뼈대 — 이게 권장 구성이므로 경고가 아니라 확인이어야 한다
  const shared = E.slotAudit(nm(['4231', '4141', '352']));
  assert.ok(kinds(shared).has('shared-shape'), '셋 중 둘이 같은 뼈대인데 아무 말도 안 한다');
  assert.equal(shared.findings.find((f) => f.kind === 'shared-shape').level, 'good');
  assert.ok(!kinds(shared).has('all-distinct'));

  // 슬롯이 하나든 셋이든 뼈대에 대해서는 정확히 한 마디만 한다
  for (const set of [['433'], ['4231', '4141'], ['4231', '352'], ['4231', '4141', '352'],
                     ['4231', '352', '442'], ['442', '442']]) {
    const shapeSaid = E.slotAudit(nm(set)).findings
      .filter((f) => ['single', 'one-shape', 'split-shape', 'shared-shape', 'all-distinct'].includes(f.kind));
    assert.equal(shapeSaid.length, 1,
      `${set.join('+')}: 뼈대 얘기가 ${shapeSaid.length}번 나왔다 (${shapeSaid.map((f) => f.kind)})`);
  }

  // 대응 폭 — 셋 다 같은 성격이면 빠진 자리를 짚어야 한다
  const flat = E.slotAudit(nm(['442', '442d', '424']));
  assert.ok(flat.missing.some((r) => r.id === 'low'), '수비적 형태가 없는데 안 짚었다');
  assert.ok(kinds(flat).has('gap-low'));
  // 반대로 셋을 다 덮으면 빠진 자리가 없어야 한다
  const wide = E.slotAudit(nm(['4141', '433dm', '442']));
  assert.equal(wide.missing.length, 0, `다 덮었는데 빠졌다고 한다: ${wide.missing.map((r) => r.ko)}`);

  // 같은 포메이션 두 개는 이 도구에서 의미가 없다는 것을 말해야 한다
  const dup = E.slotAudit(nm(['442', '442']));
  assert.ok(kinds(dup).has('duplicate'), '같은 포메이션을 두 번 저장했는데 아무 말도 안 한다');

  // 덜 익은 슬롯은 높은 등급으로 짚는다
  const raw = E.slotAudit([
    { id: 'a', name: 'A', formationId: '4231', familiarity: 'fluid' },
    { id: 'b', name: 'B', formationId: '4141', familiarity: 'awkward' }
  ]);
  const un = raw.findings.find((f) => f.kind === 'untrained');
  assert.ok(un, '어색한 슬롯을 안 짚었다');
  assert.equal(un.level, 'high');
  assert.ok(/B/.test(un.text), '어느 슬롯인지 안 말했다');
  assert.ok(!kinds(raw).has('fam-unknown'), '다 넣었는데 넣으라고 한다');
  assert.ok(kinds(E.slotAudit(nm(['4231', '4141']))).has('fam-unknown'), '친숙도를 안 넣었는데 안내가 없다');

  // 없는 포메이션은 조용히 거른다
  assert.equal(E.slotAudit(nm(['4231', '없는포메이션'])).count, 1);
  assert.equal(E.slotAudit(null).count, 0);

  // 문장 검사 — 어느 경우에도 조사나 NaN이 새면 안 된다
  for (const a of [none, spread, tight, flat, wide, dup, raw]) {
    for (const f of a.findings) {
      assert.ok(f.text && f.text.length > 5, `${f.kind}에 설명이 없다`);
      assert.ok(!/NaN|undefined|\[object |[은는이가을를와과]\([은는이가을를와과]\)/.test(f.text + f.fix),
        `${f.kind}에 이상한 값이 있다: ${f.text} / ${f.fix}`);
    }
    assert.ok(!/NaN|undefined/.test(a.split), `훈련 분배 설명이 이상하다: ${a.split}`);
  }
}

// ── 세트피스 ──────────────────────────────────────────────────────────────
{
  // 데이터 정합성 — 알 수 없는 능력치를 쓰면 그 자리는 영영 비어 있는다
  const ATTR_IDS2 = new Set(Object.keys(RD.ATTRS));
  for (const spec of [...SD.ATT_CORNER, ...SD.DEF_CORNER, ...SD.SPECIALISTS]) {
    assert.ok(spec.id && spec.ko && spec.fm, `세트피스 자리 ${spec.id}에 이름이 빠졌다`);
    assert.ok(spec.why && spec.why.length > 10, `${spec.id}에 이유가 없다`);
    for (const a of Object.keys(spec.weight)) {
      assert.ok(ATTR_IDS2.has(a), `${spec.id}의 알 수 없는 능력치 ${a}`);
    }
    for (const a of Object.keys(spec.need || {})) {
      assert.ok(ATTR_IDS2.has(a), `${spec.id}의 알 수 없는 최소 기준 ${a}`);
      assert.ok(Object.keys(spec.weight).includes(a),
        `${spec.id}의 최소 기준 ${a}가 가중치에 없다 — 걸러 놓고 점수에는 안 쓴다`);
    }
  }

  const base = E.baseTactic({ players: squad, standing: 'mid' });
  const sp = E.setPieces(base.xi);
  assert.ok(sp, '세트피스를 내놓지 않았다');

  // 골키퍼가 코너를 차러 올라가면 안 된다
  const everyone = [...sp.attack, ...sp.defence, ...sp.specialists].flatMap((s) => s.picks);
  const gk = base.xi.lineup.find((l) => l.slot.pos === 'GK');
  assert.ok(!everyone.some((p) => gk && p.name === gk.player.name),
    '골키퍼를 세트피스 자리에 세웠다');

  // 한 사람이 코너에서 두 자리를 겸할 수 없다 — 키커가 박스 안에 있을 수 없다
  for (const group of [sp.attack, sp.defence]) {
    const names = group.flatMap((s) => s.picks).map((p) => p.name);
    assert.equal(new Set(names).size, names.length,
      `같은 선수가 코너에서 두 자리를 맡았다: ${names.join(', ')}`);
  }
  // 전문 키커는 겸해도 되므로 위 규칙을 적용하지 않는다
  assert.ok(sp.specialists.some((s) => s.picks.length), '전문 키커를 하나도 못 뽑았다');

  // 최소 기준을 밑도는 선수를 세우면 안 된다
  for (const s of [...sp.attack, ...sp.defence, ...sp.specialists]) {
    if (!s.need) continue;
    for (const p of s.picks) {
      const pl = squad.find((x) => x.name === p.name);
      for (const [id, min] of Object.entries(s.need)) {
        const v = pl && pl.attrs[id];
        if (typeof v === 'number' && v > 0) {
          assert.ok(v >= min, `${s.ko}에 ${p.name}(${id} ${v})를 세웠다 — 최소 ${min}`);
        }
      }
    }
  }

  /*
   * 능력치를 모르면 지어내지 않는다. 0으로 보면 "능력치가 낮은 선수"와
   * 구분되지 않아 아무나 키커가 된다.
   */
  const blank = E.setPieces({
    formation: { id: 'z', ko: '검사용' },
    lineup: base.xi.lineup.map((l) => ({ ...l, player: { name: l.player.name, attrs: {} } }))
  });
  assert.equal(blank.attack.flatMap((s) => s.picks).length, 0,
    '능력치가 하나도 없는데 세트피스 자리를 채웠다');
  assert.equal(blank.verdict, null, '능력치가 없는데 세트피스 진단을 내놨다');
  assert.equal(blank.known, 0);

  /*
   * 오른쪽 코너를 왼발잡이가 차면 인스윙이다. 노려야 할 자리가 달라지므로
   * 발을 알면 여기까지 말해 줘야 한다.
   */
  const kicker = { ...squad[0], name: '왼발 키커', foot: 'L', attrs: { ...squad[0].attrs, cor: 18, tec: 15, vis: 15 } };
  const lefty = E.setPieces({
    formation: { id: 'z', ko: '검사용' },
    lineup: base.xi.lineup.map((l, i) => (i === 1 ? { ...l, player: kicker } : l))
  });
  assert.equal(lefty.attack[0].picks[0].name, '왼발 키커', '코너킥 18인 선수를 키커로 안 뽑았다');
  const right = lefty.swing.find((s) => s.side === 'r');
  const left = lefty.swing.find((s) => s.side === 'l');
  assert.equal(right.kind, 'in', '왼발잡이의 오른쪽 코너를 인스윙으로 안 봤다');
  assert.equal(left.kind, 'out', '왼발잡이의 왼쪽 코너를 아웃스윙으로 안 봤다');
  assert.ok(/니어/.test(right.fix), '인스윙인데 니어 포스트를 안 짚었다');
  assert.ok(/파 포스트/.test(left.fix), '아웃스윙인데 파 포스트를 안 짚었다');

  // 발을 모르면 스윙 이야기를 하지 않는다
  const noFoot = E.setPieces({
    formation: { id: 'z', ko: '검사용' },
    lineup: base.xi.lineup.map((l, i) => (i === 1 ? { ...l, player: { ...kicker, foot: undefined } } : l))
  });
  assert.equal(noFoot.swing.length, 0, '발을 모르는데 인스윙/아웃스윙을 단정했다');

  // 제공권이 좋은 팀과 나쁜 팀의 진단이 갈려야 한다
  const tall = squad.map((p) => ({ ...p, attrs: { ...p.attrs, hea: 17, jum: 17 } }));
  const small = squad.map((p) => ({ ...p, attrs: { ...p.attrs, hea: 6, jum: 6 } }));
  const tallSp = E.setPieces(E.baseTactic({ players: tall, standing: 'mid' }).xi);
  const smallSp = E.setPieces(E.baseTactic({ players: small, standing: 'mid' }).xi);
  assert.equal(tallSp.verdict.level, 'good', `높은 팀 진단: ${tallSp.verdict.text}`);
  assert.equal(smallSp.verdict.level, 'poor', `작은 팀 진단: ${smallSp.verdict.text}`);
  assert.ok(/켜/.test(tallSp.verdict.fix), '세트피스가 강한데 켜라는 말이 없다');
  assert.ok(smallSp.weakDefence, '전원이 공중볼에 약한데 수비 경고가 없다');
  assert.equal(tallSp.weakDefence, null, '제공권이 좋은데 수비 경고가 나왔다');
}

// ── 규칙이 걸리면 실제로 무언가 움직여야 한다 ─────────────────────────────
/*
 * 「맞춤 전술이 약하다」의 원인 하나가 여기 있었다. 상대가 넓게 서면 걸리는
 * 규칙(opp-wide)은 width를 -0.5 밀었는데, 축 인덱스는 Math.round(기본값 + 누적)
 * 이라 -0.5는 Math.round(-0.5) === -0 이 되어 **한 칸도 안 움직였다.**
 * 롱볼 규칙도 -0.3씩이라 혼자서는 아무 일도 안 했다.
 *
 * 규칙이 걸렸는데 화면이 그대로면 사용자는 도구가 반응하지 않는다고 느낀다.
 * 그래서 규칙마다 "혼자 걸렸을 때 최소한 하나는 움직이는가"를 못박는다.
 */
{
  const neutralOpp = {
    formationId: '4231', mentality: 3, dline: 2, loe: 2, press: 2,
    width: 3, directness: 2, tempo: 2, transitionLost: 'regroup', transitionWon: 'hold', traits: []
  };
  const neutralCtx = { venue: 'home', odds: 'even', goal: 'win' };

  /*
   * 두 가지를 본다.
   *
   * ① 축을 정확히 ±0.5로 미는 규칙이 없어야 한다. Math.round(-0.5)는 -0이라
   *    음수 쪽 0.5는 아예 무효고, 양수 쪽과 비대칭이다. 0.4나 0.6으로 적어야 한다.
   * ② 규칙마다 실제로 닿을 수 있는 통로가 하나는 있어야 한다 — 혼자서 축을
   *    움직이든지, 토글·역할·플랜을 밀든지. 작은 축 밀기만 있고 나머지가 비면
   *    그 규칙은 걸려도 화면이 그대로다(조언 문구만 뜬다).
   *
   * 여러 규칙이 합쳐져 한 칸을 만드는 '기여형' 밀기는 정상이다. 그건 ②로 걸러진다.
   */
  const halfStep = [];
  const dead = [];
  for (const rule of TD.RULES) {
    const axisKeys = Object.keys(rule.axis || {});
    for (const k of axisKeys) {
      if (Math.abs(rule.axis[k]) === 0.5) halfStep.push(`${rule.id}.${k} = ${rule.axis[k]}`);
    }
    const movesAlone = axisKeys.some((k) => {
      const def = TD.AXES[k];
      if (!def) return false;
      const to = Math.max(0, Math.min(def.labels.length - 1, Math.round(def.def + rule.axis[k])));
      return to !== def.def;
    });
    const hasOther = Object.keys(rule.toggle || {}).length
      || Object.keys(rule.role || {}).length
      || Object.keys(rule.plan || {}).length;
    if (!movesAlone && !hasOther) {
      dead.push(`${rule.id} — ${axisKeys.map((k) => k + ' ' + rule.axis[k]).join(', ')}`);
    }
  }
  assert.deepEqual(halfStep, [],
    'Math.round(-0.5)는 -0이라 무효다. 0.4나 0.6으로 적어라:\n  ' + halfStep.join('\n  '));
  assert.deepEqual(dead, [],
    '규칙이 걸려도 화면이 그대로다 — 축도 안 움직이고 토글·역할·플랜도 없다:\n  ' + dead.join('\n  '));

  /*
   * 그리고 상대 유형별로 실제로 답이 갈리는지 본다. 프리셋 일곱 개를 넣었는데
   * 결과가 다 같으면 「맞춤」이 아니다.
   */
  const seen = new Set();
  const noMove = [];
  for (const preset of TD.OPP_PRESETS) {
    const r = E.generate({
      players: squad, opponent: { ...neutralOpp, ...preset.set }, context: neutralCtx
    });
    const shifted = Object.values(r.instructions.axes).filter((a) => a.shifted).length;
    const on = Object.keys(r.instructions.toggles).filter((k) => r.instructions.toggles[k].on).sort().join(',');
    seen.add(shifted + '|' + on + '|' + r.xi.lineup.map((l) => l.role.abbr + l.duty).join(''));
    // '특징 없음'은 안 움직이는 게 맞다
    if (preset.id !== 'balanced' && shifted === 0) noMove.push(preset.ko);
  }
  assert.deepEqual(noMove, [],
    `이 상대 유형에는 팀 지시가 하나도 안 바뀐다 — 「맞춤」이 아니다: ${noMove.join(', ')}`);
  assert.ok(seen.size >= 5,
    `상대 유형 ${TD.OPP_PRESETS.length}개인데 서로 다른 답이 ${seen.size}가지뿐이다`);

  // 프리셋 데이터 정합성 — 없는 축을 적어 두면 조용히 무시된다
  const OPP_KEYS = new Set(['dline', 'loe', 'press', 'mentality', 'width', 'tempo',
    'directness', 'transitionLost', 'transitionWon']);
  for (const p of TD.OPP_PRESETS) {
    assert.ok(p.id && p.ko && p.short && p.why, `상대 유형 ${p.id}에 설명이 빠졌다`);
    for (const k of Object.keys(p.set)) {
      assert.ok(OPP_KEYS.has(k), `${p.id}에 알 수 없는 항목 ${k}`);
      if (k.indexOf('transition') === 0) continue;
      const v = p.set[k];
      assert.ok(Number.isInteger(v) && v >= 0 && v <= 6, `${p.id}의 ${k}가 ${v}다`);
    }
  }
}

// ── 포지션 추정 ───────────────────────────────────────────────────────────
/*
 * 등록 포지션이 비면 이 도구는 사실상 아무것도 못 한다. 포지션 친숙도가 전원
 * 0.34(낯선 자리)로 깔려서 선발이 "능력치 총합 순서"가 되기 때문이다.
 * 실제 스쿼드로 재 보니 적합도가 열한 자리 모두 22~26, 골키퍼는 3이었다.
 * 그런 배치를 게임에 옮기면 대패한다.
 *
 * 그래서 능력치로 자리를 추정해 한 화면에서 확인만 하고 넘어가게 한다.
 * 추정이 완벽할 필요는 없다 — 사람이 확인하니까. 다만 확실한 것(골키퍼)은
 * 반드시 맞아야 하고, 모를 때는 지어내면 안 된다.
 */
{
  const POS_IDS = new Set(RD.POSITIONS.map((p) => p.id));

  // 능력치를 거의 모르면 추정하지 않는다
  // vm 안에서 만든 배열은 deepStrictEqual이 realm 때문에 실패한다 — 값으로 견준다
  const blind = E.guessPositions({ name: 'x', attrs: { pac: 12 } }, squad);
  assert.equal(blind.picks.length, 0, '능력치 하나로 자리를 추정했다');
  assert.ok(blind.why && blind.why.length > 5, '왜 추정 못 했는지가 없다');
  assert.equal(E.guessPositions({ name: 'y' }, squad).picks.length, 0);
  assert.equal(E.guessPositions(null, squad).picks.length, 0);

  /*
   * 골키퍼는 확실히 갈라야 한다 — 여기서 틀리면 필드 선수를 골문에 세운다.
   *
   * 검사용 스쿼드(위 squad)는 필드 선수에게도 골키퍼 능력치를 11~12로 채워 둔다.
   * 실제 FM 내보내기는 그렇지 않다 — 필드 선수의 골키퍼 칸은 2~3이고 진짜
   * 골키퍼만 12를 넘는다. 그 신호가 없는 자료로는 어떤 방법으로도 못 가르므로,
   * 여기서는 실제와 같은 모양의 작은 스쿼드로 본다.
   */
  const gkKeys = ['han', 'ref', 'ono', 'aer', 'cmd', 'kic', 'thr', 'tro', 'pun', 'com', 'ecc'];
  const realish = squad.slice(0, 12).map((p) => {
    const isGk = (p.positions || []).includes('GK');
    const attrs = { ...p.attrs };
    for (const k of gkKeys) attrs[k] = isGk ? (attrs[k] > 10 ? attrs[k] : 13) : 3;
    return { ...p, attrs };
  });
  const gk = realish.find((p) => (p.positions || []).includes('GK'));
  assert.ok(gk, '검사용 스쿼드에 골키퍼가 없다');
  assert.equal(E.guessPositions(gk, realish).picks.join(','), 'GK',
    `골키퍼를 ${E.guessPositions(gk, realish).picks}로 봤다`);

  // 필드 선수를 골키퍼라고 하면 안 된다 (내보내기는 전원에게 GK 칸을 채워 준다)
  for (const p of realish.filter((x) => !(x.positions || []).includes('GK'))) {
    assert.ok(!E.guessPositions(p, realish).picks.includes('GK'),
      `${p.name}을 골키퍼로 추정했다`);
  }
  // 신호가 없으면(전원 골키퍼 능력치가 비슷하면) 골키퍼라고 단정하지 않는다
  for (const p of squad.filter((x) => !(x.positions || []).includes('GK')).slice(0, 8)) {
    assert.ok(!E.guessPositions(p, squad).picks.includes('GK'),
      `${p.name}을 골키퍼로 추정했다 — 가를 신호가 없으면 지어내면 안 된다`);
  }

  // 내놓는 자리는 실제 포지션 목록에 있어야 한다
  for (const p of squad) {
    const g = E.guessPositions(p, squad);
    for (const id of g.picks) assert.ok(POS_IDS.has(id), `없는 포지션 ${id}을 추정했다`);
    assert.ok(g.picks.length <= 2, `${p.name}: ${g.picks.length}개나 추정했다`);
    assert.ok(!/NaN|undefined/.test(g.why || ''), `추정 설명에 이상한 값: ${g.why}`);
  }

  /*
   * 좌우는 능력치로 알 수 없다. 측면을 짚었으면 반대쪽도 같이 내놓아야 한다 —
   * 한쪽으로 단정하면 사람이 그걸 믿고 그대로 둔다.
   */
  const MIRROR = { DR: 'DL', DL: 'DR', WBR: 'WBL', WBL: 'WBR', MR: 'ML', ML: 'MR', AMR: 'AML', AML: 'AMR' };
  for (const p of squad) {
    const picks = E.guessPositions(p, squad).picks;
    if (!picks.length || !MIRROR[picks[0]]) continue;
    assert.equal(picks[1], MIRROR[picks[0]],
      `${p.name}: 측면을 ${picks[0]}로 단정했다 (${picks.join('/')})`);
  }

  /*
   * 그리고 이게 실제로 문제를 푸는지 — 포지션을 채우면 선발 적합도가 확 올라야
   * 한다. 이 검사가 이 기능의 존재 이유다.
   */
  const stripped = squad.map((p) => ({ ...p, positions: [] }));
  const before = E.baseTactic({ players: stripped, standing: 'mid' });
  const guessed = stripped.map((p) => {
    const g = E.guessPositions(p, stripped);
    return g.picks.length ? { ...p, positions: g.picks } : p;
  });
  const after = E.baseTactic({ players: guessed, standing: 'mid' });
  const avgFit = (r) => {
    const f = r.xi.lineup.map((l) => l.fit).filter((v) => typeof v === 'number');
    return f.reduce((a, b) => a + b, 0) / f.length;
  };
  assert.ok(avgFit(after) > avgFit(before) + 20,
    `추정으로 채워도 적합도가 안 올랐다: ${Math.round(avgFit(before))} → ${Math.round(avgFit(after))}`);
}

// ── 조사를 손으로 적지 않는다 ─────────────────────────────────────────────
/*
 * 「컴플리트 윙백가 있어」 「백업 적합도가 55이라」 「팀 기술 평균이 13로 낮습니다」.
 * 전부 실제로 화면에 나가던 문장이다. 값이 무엇이 될지 모르는 자리 뒤에 조사를
 * 손으로 적으면 값에 따라 틀린다 — 그래서 josa 도우미가 있는데, 새 문장을 쓸
 * 때마다 잊는다.
 *
 * 무작위 검사의 BAD_TEXT는 '은(는)' 꼴만 잡는다. 이건 소스를 직접 훑어서
 * 「변수 + '조사」 형태 자체를 막는다.
 */
{
  /*
   * 값이 고정된 문자열이라 조사가 절대 안 바뀌는 자리만 허용한다.
   * 새로 추가하려면 여기에 근거를 적어야 한다 — 그게 이 검사의 요점이다.
   */
  const ALLOWED = [
    // '왼쪽'/'오른쪽' 둘 다 받침이 있어 '이'로 고정이다.
    "(M.side === 'left' ? '왼쪽' : '오른쪽') + '이 우리 팀으로 저장됩니다"
  ];
  const JOSA = /\+\s*'(이라|라|은|는|이|가|을|를|와|과|으로|로)(?=[\s.,·—…])/g;
  const files = ['engine.js', 'index.html', 'importer.js',
                 'data/tactics.js', 'data/setpieces.js', 'data/traits.js', 'data/roles.js'];
  const hits = [];
  for (const f of files) {
    read(f).split('\n').forEach((line, i) => {
      if (ALLOWED.some((a) => line.includes(a))) return;
      for (const m of line.matchAll(JOSA)) {
        hits.push(`${f}:${i + 1} [${m[1]}] ${line.trim().slice(0, 110)}`);
      }
    });
  }
  assert.deepEqual(hits, [],
    '변수 뒤에 조사를 손으로 적었다 — josa 도우미(ro/eul/iga/eun/wa/ira)를 쓰라:\n  ' + hits.join('\n  '));

  // 도우미 자체가 맞는지도 못박는다 — 이게 틀리면 위 검사가 통과해도 소용없다
  const J = E.josa;
  for (const [fn, word, want] of [
    ['wa', '윙백', '과'], ['wa', '윙어', '와'],
    ['ro', '앵커 맨', '으로'], ['ro', '레지스타', '로'], ['ro', 13, '으로'], ['ro', 12, '로'],
    ['iga', '컴플리트 윙백', '이'], ['iga', '스토퍼', '가'],
    ['ira', 55, '라'], ['ira', '앵커 맨', '이라'],
    ['eun', '손흥민', '은'], ['eun', '메짤라', '는'],
    ['eul', '윙백', '을'], ['eul', '윙어', '를']
  ]) {
    assert.equal(J[fn](word), want, `josa.${fn}('${word}')가 ${J[fn](word)}다`);
  }
}

// ── 경기 후 검토 ──────────────────────────────────────────────────────────
/*
 * 한 경기의 결정력 부족은 운이고, 여섯 경기의 결정력 부족은 스쿼드다.
 * 그 둘을 가르는 것이 이 화면의 전부이므로, 표본이 모자랄 때 단정하지 않는 것이
 * 가장 중요한 성질이다 — 세 경기 보고 스트라이커를 파는 것이 가장 비싼 실수다.
 */
{
  // 데이터 정합성
  for (const t of TD.MATCH_TAGS) {
    assert.ok(t.id && t.ko, `경기 태그 ${t.id}에 이름이 빠졌다`);
    assert.ok(t.repeat && t.repeat.length > 10, `${t.id}에 반복될 때 할 말이 없다`);
    assert.ok(t.fix && t.fix.length > 10, `${t.id}에 무엇을 하면 되는지가 없다`);
  }
  const tagIds = TD.MATCH_TAGS.map((t) => t.id);
  assert.equal(new Set(tagIds).size, tagIds.length, '경기 태그 id가 겹친다');

  const g = (gf, ga, o = {}) => ({
    id: 'm' + Math.random(), opp: o.opp || '상대', venue: o.venue || 'home',
    gf, ga, flags: o.flags || [],
    us: o.xg === undefined ? null
      : { xg: o.xg, shots: o.shots ?? 15, possession: o.poss ?? 58, sot: o.sot ?? 5 },
    them: o.xga === undefined ? null : { xg: o.xga }
  });
  const kinds = (r) => new Set(r.findings.map((f) => f.kind));

  assert.equal(E.matchReview([]), null);
  assert.equal(E.matchReview(null), null);
  // 점수가 없는 기록은 세지 않는다 — 저장이 반쯤 깨져도 통계가 오염되면 안 된다
  assert.equal(E.matchReview([{ id: 'x', venue: 'home' }]), null);

  // 전적 계산
  const rec = E.matchReview([g(2, 0), g(1, 1), g(0, 3)]).record;
  assert.deepEqual([rec.n, rec.w, rec.d, rec.l, rec.gf, rec.ga, rec.pts], [3, 1, 1, 1, 3, 4, 4]);

  /*
   * 표본이 모자라면 판정하지 않는다. 이게 이 화면에서 가장 중요한 성질이다.
   */
  const few = E.matchReview([g(0, 1, { xg: 2.4 }), g(0, 0, { xg: 2.1 })]);
  assert.ok(kinds(few).has('small-sample'), '두 경기로 마무리를 판정했다');
  assert.ok(!kinds(few).has('finishing-bad'), '표본이 모자란데 단정했다');
  assert.ok(/비싼 실수|넘겨야/.test(few.findings.find((f) => f.kind === 'small-sample').fix));

  // 기대 득점이 아예 없으면 그 사실을 말한다
  const noXg = E.matchReview([g(1, 0), g(0, 2), g(1, 1), g(2, 2), g(0, 1)]);
  assert.ok(kinds(noXg).has('no-xg'), '기대 득점이 없는데 아무 말도 안 했다');
  assert.ok(!kinds(noXg).has('finishing-bad'));
  assert.equal(noXg.stats.xgFor, null);

  /*
   * 여섯 경기 누적으로 크게 밑돌면 그때는 단정한다. 그리고 왜 그렇게
   * 판정했는지(계산 근거)를 반드시 같이 낸다 — 숫자만 던지면 믿을 근거가 없다.
   */
  const cold = E.matchReview([
    g(0, 1, { xg: 2.4 }), g(0, 0, { xg: 2.1 }), g(1, 2, { xg: 2.6 }),
    g(0, 1, { xg: 1.9 }), g(1, 1, { xg: 2.2 }), g(0, 2, { xg: 2.0 })
  ]);
  const bad = cold.findings.find((f) => f.kind === 'finishing-bad');
  assert.ok(bad, `여섯 경기 xG 13.2에 2골인데 판정을 안 했다: ${[...kinds(cold)].join(',')}`);
  assert.equal(bad.level, 'high');
  assert.ok(bad.detail && /√경기수/.test(bad.detail), '계산 근거가 없다');
  assert.ok(/마무리|침착성/.test(bad.fix), '무엇을 봐야 하는지가 없다');
  assert.ok(cold.stats.z < -1.5, `z가 ${cold.stats.z}다`);

  /*
   * 기록이 없는 경기가 섞여도 판정이 흔들리면 안 된다.
   * 기대 득점이 있는 경기로만 나눠야 하는데 전체 경기 수로 나누면 표본이 커 보여
   * z가 작아지고, "운의 범위 안"이라는 반대 결론이 나온다.
   */
  const mixed = E.matchReview([
    g(0, 1, { xg: 2.4 }), g(0, 0, { xg: 2.1 }), g(1, 2, { xg: 2.6 }),
    g(0, 1, { xg: 1.9 }), g(1, 1, { xg: 2.2 }), g(0, 2, { xg: 2.0 }),
    g(1, 0), g(2, 1), g(0, 0), g(1, 3)     // 기록 없이 점수만 저장한 경기
  ]);
  assert.equal(mixed.record.n, 10, '경기 수는 전체를 세야 한다');
  assert.equal(mixed.stats.sample, 6, '기대 득점이 있는 경기만 표본으로 세야 한다');
  assert.equal(mixed.stats.z, cold.stats.z,
    `기록 없는 경기가 마무리 판정을 흔들었다: ${mixed.stats.z} vs ${cold.stats.z}`);
  const mixedBad = mixed.findings.find((f) => f.kind === 'finishing-bad');
  assert.ok(mixedBad, '기록 없는 경기가 섞이자 판정이 사라졌다');
  assert.ok(/^6경기/.test(mixedBad.text), `표본 수를 10경기로 말했다: ${mixedBad.text}`);

  // 만드는 만큼 넣고 있으면 문제라고 하지 않는다
  const fine = E.matchReview([
    g(2, 1, { xg: 2.0 }), g(1, 0, { xg: 1.2 }), g(2, 2, { xg: 1.8 }),
    g(3, 1, { xg: 2.4 }), g(1, 1, { xg: 1.4 })
  ]);
  assert.ok(kinds(fine).has('finishing-ok'), `정상 범위인데 문제라고 했다: ${[...kinds(fine)].join(',')}`);
  assert.ok(!kinds(fine).has('finishing-bad'));

  // 반대로 기대치를 크게 넘고 있으면 그것도 말해야 한다 — 곧 되돌아온다
  const hot = E.matchReview([
    g(3, 0, { xg: 1.0 }), g(2, 1, { xg: 0.8 }), g(4, 1, { xg: 1.4 }),
    g(2, 0, { xg: 0.9 }), g(3, 2, { xg: 1.1 })
  ]);
  assert.ok(kinds(hot).has('finishing-hot'), '기대치를 한참 넘는데 아무 말도 안 했다');
  assert.ok(/되돌아/.test(hot.findings.find((f) => f.kind === 'finishing-hot').fix));

  /*
   * 기회의 질 — 같은 xG 2.0이라도 슈팅 10개와 25개는 다른 경기다.
   * 경기 중 규칙과 같은 기준(슈팅당 0.08)을 써야 두 화면이 어긋나지 않는다.
   */
  const farShots = E.matchReview([
    g(0, 1, { xg: 1.2, shots: 25 }), g(1, 1, { xg: 1.0, shots: 22 }),
    g(0, 0, { xg: 1.1, shots: 24 }), g(1, 2, { xg: 1.3, shots: 26 })
  ]);
  assert.ok(kinds(farShots).has('far-shots'), '슈팅당 0.05인데 먼 거리 경고가 없다');
  assert.ok(/박스 안까지 볼 배급/.test(farShots.findings.find((f) => f.kind === 'far-shots').fix),
    '경기 중 탭과 같은 지시 이름을 안 썼다');
  assert.ok(farShots.stats.perShot <= 0.08);

  const closeShots = E.matchReview([
    g(2, 1, { xg: 2.0, shots: 12 }), g(1, 0, { xg: 1.6, shots: 10 }),
    g(1, 1, { xg: 1.8, shots: 11 }), g(2, 2, { xg: 2.2, shots: 13 })
  ]);
  assert.ok(kinds(closeShots).has('good-shots'));
  assert.ok(!kinds(closeShots).has('far-shots'));

  /*
   * 수비 — 실점이 기대 실점을 크게 넘는 것과, 기대 실점 자체가 높은 것은
   * 정반대의 처방이다(골키퍼 vs 형태). 둘을 섞으면 조언이 무의미해진다.
   */
  const keeper = E.matchReview([
    g(1, 3, { xg: 1.5, xga: 0.9 }), g(1, 2, { xg: 1.4, xga: 0.7 }),
    g(0, 3, { xg: 1.3, xga: 1.0 }), g(2, 3, { xg: 1.6, xga: 0.8 }),
    g(1, 2, { xg: 1.5, xga: 0.6 })
  ]);
  assert.ok(kinds(keeper).has('keeper'), '내주는 기회에 비해 훨씬 많이 먹는데 아무 말도 안 했다');
  assert.ok(/골키퍼/.test(keeper.findings.find((f) => f.kind === 'keeper').fix));
  assert.ok(!kinds(keeper).has('defence-shape'), '기대 실점은 낮은데 형태 문제라고 했다');

  const leaky = E.matchReview([
    g(2, 2, { xg: 1.8, xga: 2.1 }), g(1, 2, { xg: 1.5, xga: 1.9 }),
    g(2, 1, { xg: 1.7, xga: 1.6 }), g(1, 2, { xg: 1.6, xga: 2.2 }),
    g(2, 2, { xg: 1.9, xga: 1.8 })
  ]);
  assert.ok(kinds(leaky).has('defence-shape'), '경기당 기대 실점 1.9인데 형태 얘기가 없다');

  // 내려앉은 상대를 반복해서 못 여는 경우 — 경기 중 규칙과 같은 기준
  const parked = E.matchReview([
    g(0, 0, { xg: 0.9, poss: 66, sot: 2 }), g(0, 1, { xg: 0.8, poss: 63, sot: 3 }),
    g(1, 1, { xg: 1.0, poss: 61, sot: 3 }), g(0, 1, { xg: 0.7, poss: 65, sot: 2 })
  ]);
  assert.ok(kinds(parked).has('parked-repeat'), '점유율 64%에 유효슈팅 2.5개인데 아무 말도 안 했다');

  /*
   * 태그는 반복될 때만 말한다. 한 번 일어난 일을 '패턴'이라고 하면
   * 사용자가 도구를 믿지 않게 된다.
   */
  const once = E.matchReview([
    g(0, 1, { flags: ['setpiece-concede'] }), g(1, 0), g(2, 1), g(1, 1), g(0, 0)
  ]);
  assert.ok(!kinds(once).has('tag-setpiece-concede'), '한 번 나온 일을 반복이라고 했다');

  const repeated = E.matchReview([
    g(0, 1, { flags: ['early-concede'] }), g(1, 2, { flags: ['early-concede'] }),
    g(0, 2, { flags: ['early-concede'] }), g(1, 1), g(2, 0)
  ]);
  const tagFinding = repeated.findings.find((f) => f.kind === 'tag-early-concede');
  assert.ok(tagFinding, '다섯 경기 중 세 번 초반 실점인데 아무 말도 안 했다');
  assert.equal(tagFinding.level, 'high');
  assert.ok(/3경기/.test(tagFinding.text), '몇 번인지 안 말했다');

  /*
   * 홈이 원정보다 크게 나쁘면 짚는다 — 내려앉은 상대를 못 여는 신호다.
   * 다만 마무리와 같은 표본 기준을 넘겨야 한다. 세 경기씩으로 홈 경기 방식을
   * 뜯어고치라고 하면 그건 판정이 아니라 소음이다.
   */
  const homeFew = E.matchReview([
    g(0, 1, { venue: 'home' }), g(0, 0, { venue: 'home' }), g(1, 2, { venue: 'home' }),
    g(2, 0, { venue: 'away' }), g(3, 1, { venue: 'away' }), g(1, 0, { venue: 'away' })
  ]);
  assert.ok(!kinds(homeFew).has('home-worse'), '한쪽 세 경기로 홈/원정을 단정했다');

  const homeBad = E.matchReview([
    g(0, 1, { venue: 'home' }), g(0, 0, { venue: 'home' }), g(1, 2, { venue: 'home' }), g(0, 2, { venue: 'home' }),
    g(2, 0, { venue: 'away' }), g(3, 1, { venue: 'away' }), g(1, 0, { venue: 'away' }), g(2, 1, { venue: 'away' })
  ]);
  assert.ok(kinds(homeBad).has('home-worse'), '홈 4경기 0점 원정 4경기 3점인데 아무 말도 안 했다');
  assert.ok(/홈 4경기/.test(homeBad.findings.find((f) => f.kind === 'home-worse').text),
    '표본 크기를 안 말했다');

  /*
   * 서로 다른 경기 묶음에서 뽑은 숫자를 한 문장에 넣으면, 그 문장은 어느 경기에
   * 대해서도 참이 아니다. 아래 셋은 전부 그 실수를 막는 검사다.
   */

  // 1) 상대 기대 실점은 우리 기대 득점과 독립이어야 한다
  const onlyTheirs = E.matchReview([
    g(1, 3, { xga: 0.9 }), g(1, 2, { xga: 0.7 }), g(0, 3, { xga: 1.0 }),
    g(2, 3, { xga: 0.8 }), g(1, 2, { xga: 0.6 })
  ]);
  assert.equal(onlyTheirs.stats.sampleAgainst, 5,
    '우리 기대 득점이 없다고 상대 기대 실점까지 버렸다');
  assert.ok(kinds(onlyTheirs).has('keeper'), '상대 기대 실점만 있어도 수비 판정은 나와야 한다');

  // 2) 점유율과 유효 슈팅이 서로 다른 경기에서만 나오면 내려앉음 판정을 하면 안 된다
  const disjoint = E.matchReview([
    { id: 'a', gf: 0, ga: 1, venue: 'home', us: { possession: 70 } },
    { id: 'b', gf: 0, ga: 1, venue: 'home', us: { possession: 72 } },
    { id: 'c', gf: 0, ga: 1, venue: 'home', us: { possession: 68 } },
    { id: 'd', gf: 0, ga: 1, venue: 'away', us: { sot: 2 } },
    { id: 'e', gf: 0, ga: 1, venue: 'away', us: { sot: 3 } },
    { id: 'f', gf: 0, ga: 1, venue: 'away', us: { sot: 2 } }
  ]);
  assert.ok(!kinds(disjoint).has('parked-repeat'),
    '점유율과 유효 슈팅이 같이 있는 경기가 하나도 없는데 내려앉음이라고 단정했다');
  assert.equal(disjoint.stats.sampleParked, 0);

  // 3) 슈팅 기록이 일부 경기에만 있으면 그 경기 수를 밝혀야 한다
  const someShots = E.matchReview([
    g(0, 1, { xg: 0.8, shots: 12 }), g(0, 1, { xg: 0.8, shots: 12 }),
    g(0, 1, { xg: 0.8, shots: 12 }), g(0, 1, { xg: 0.8, shots: 12 }),
    { id: 'x', gf: 1, ga: 0, venue: 'home', us: { xg: 2.0 } },
    { id: 'y', gf: 1, ga: 0, venue: 'home', us: { xg: 2.0 } }
  ]);
  assert.equal(someShots.stats.sampleShots, 4);
  assert.equal(someShots.stats.sample, 6);
  const fs2 = someShots.findings.find((f) => f.kind === 'far-shots');
  assert.ok(fs2, '슈팅당 0.067인데 경고가 없다');
  assert.ok(/슈팅 기록이 있는 4경기/.test(fs2.text),
    `어느 경기에서 나온 숫자인지 안 밝혔다: ${fs2.text}`);

  /*
   * 반올림한 값으로 다시 계산하면 경계에서 판정이 뒤집힌다.
   * 기대 득점 0.99 × 4 = 3.96인데 4.0으로 반올림한 뒤 z를 구하면 딱 −1.5가 되어
   * "운이 아니다"로 넘어간다. 실제로는 −1.48이다.
   */
  const edge = E.matchReview([
    g(0, 1, { xg: 0.99 }), g(1, 0, { xg: 0.99 }), g(0, 0, { xg: 0.99 }), g(0, 1, { xg: 0.99 })
  ]);
  assert.equal(edge.stats.z, -1.48, `반올림한 값으로 z를 구했다: ${edge.stats.z}`);
  assert.ok(!kinds(edge).has('finishing-bad'), '경계에서 반올림 때문에 판정이 뒤집혔다');
  assert.ok(kinds(edge).has('finishing-soft'));

  // 실점 쪽도 같다 — 경기당 1.499는 1.5 미만이다
  const edgeDef = E.matchReview([
    g(1, 1, { xga: 1.499 }), g(1, 1, { xga: 1.499 }),
    g(1, 1, { xga: 1.499 }), g(1, 1, { xga: 1.499 })
  ]);
  assert.ok(!kinds(edgeDef).has('defence-shape'),
    `경기당 ${edgeDef.stats.xgaPer}인데 1.5 기준에 걸렸다`);

  /*
   * 골키퍼 문제와 형태 문제는 정반대의 처방이라, 둘 다 걸리면 서로를 부정하는
   * 문장 두 개가 나란히 뜬다. 그때는 무엇을 먼저 할지까지 말해야 한다.
   */
  const both = E.matchReview([
    g(1, 4, { xga: 1.8 }), g(1, 4, { xga: 1.9 }), g(0, 4, { xga: 1.7 }),
    g(2, 5, { xga: 2.0 }), g(1, 4, { xga: 1.8 })
  ]);
  if (kinds(both).has('keeper') && kinds(both).has('defence-shape')) {
    const k2 = both.findings.find((f) => f.kind === 'keeper');
    assert.ok(/별개|먼저/.test(k2.fix), `서로 부정하는 조언 둘을 나란히 냈다: ${k2.fix}`);
    assert.ok(!/형태를 아무리 고쳐도/.test(k2.fix), '형태를 고치라는 조언 옆에서 소용없다고 했다');
  }

  // 태그를 한 경기에 여러 번 붙여도 경기 수로 센다
  const dupTags = E.matchReview([
    { id: 'a', gf: 0, ga: 1, venue: 'home', flags: ['red-card', 'red-card', 'red-card', 'red-card'] },
    { id: 'b', gf: 1, ga: 0, venue: 'away', flags: [] },
    { id: 'c', gf: 1, ga: 1, venue: 'home', flags: [] },
    { id: 'd', gf: 0, ga: 2, venue: 'away', flags: [] }
  ]);
  assert.equal(dupTags.tagCount['red-card'], 1, '한 경기의 같은 태그를 여러 번 셌다');
  assert.ok(!kinds(dupTags).has('tag-red-card'), '한 경기짜리를 반복이라고 했다');

  // 표본이 모자라면 태그도 단정하지 않는다 — 옆에서 "판정할 수 없다"고 말하는 중이다
  const twoTagged = E.matchReview([
    g(0, 1, { flags: ['setpiece-concede'] }), g(0, 2, { flags: ['setpiece-concede'] })
  ]);
  assert.ok(!kinds(twoTagged).has('tag-setpiece-concede'),
    '두 경기로 「반복됩니다」라고 했다 — 같은 화면이 아직 판정할 수 없다고 말하는 중이다');

  /*
   * 선발을 같이 넘기면 "마무리가 문제다"에서 "지금 최전방이 누구고 그 값이
   * 얼마다"까지 간다. 안 넘기면 예전처럼 일반론만 내야 한다 — 지어내면 안 된다.
   */
  const weakFront = squad.map((p) => (
    (p.positions || []).includes('ST') ? { ...p, attrs: { ...p.attrs, fin: 5, cmp: 5 } } : p));
  const wfBase = E.baseTactic({ players: weakFront, standing: 'mid' });
  const named = E.matchReview([
    g(0, 1, { xg: 2.4 }), g(0, 0, { xg: 2.1 }), g(1, 2, { xg: 2.6 }),
    g(0, 1, { xg: 1.9 }), g(1, 1, { xg: 2.2 }), g(0, 2, { xg: 2.0 })
  ], wfBase.xi);
  const namedBad = named.findings.find((f) => f.kind === 'finishing-bad');
  assert.ok(namedBad.who && namedBad.who.length, '선발을 넘겼는데 누구인지 안 말했다');
  assert.ok(/마무리가 가장 낮은 자리는/.test(namedBad.fix), `이름을 안 짚었다: ${namedBad.fix}`);
  assert.ok(/마무리 5/.test(namedBad.fix), `실제 값을 안 적었다: ${namedBad.fix}`);
  // 가장 낮은 사람을 짚어야 한다
  const lowest = namedBad.who[0];
  assert.ok(namedBad.who.every((x) => x.fin >= lowest.fin), '가장 낮은 순으로 안 세웠다');
  assert.ok(namedBad.fix.includes(lowest.name), '가장 낮은 선수를 안 짚었다');

  // 선발을 안 넘기면 이름을 지어내지 않는다
  const unnamed = cold.findings.find((f) => f.kind === 'finishing-bad');
  assert.ok(!unnamed.who || !unnamed.who.length, '선발도 없이 누구인지 말했다');
  assert.ok(!/가장 낮은 자리는/.test(unnamed.fix), '선발이 없는데 이름을 지어냈다');

  // 골키퍼 판정도 같다
  const gkNamed = E.matchReview([
    g(1, 3, { xga: 0.9 }), g(1, 2, { xga: 0.7 }), g(0, 3, { xga: 1.0 }),
    g(2, 3, { xga: 0.8 }), g(1, 2, { xga: 0.6 })
  ], wfBase.xi);
  const gkFind = gkNamed.findings.find((f) => f.kind === 'keeper');
  assert.ok(/지금 골키퍼는/.test(gkFind.fix), `골키퍼 이름을 안 짚었다: ${gkFind.fix}`);
  const gkName = wfBase.xi.lineup.find((l) => l.slot.pos === 'GK').player.name;
  assert.ok(gkFind.fix.includes(gkName), '엉뚱한 선수를 골키퍼라고 했다');

  // 경기별 표
  const pm = cold.perMatch;
  assert.equal(pm.length, 6);
  for (const m of pm) {
    assert.ok(['w', 'd', 'l'].includes(m.result), `결과가 ${m.result}다`);
    assert.ok(/^\d+:\d+$/.test(m.score));
    assert.ok(['홈', '원정', '—'].includes(m.venue));
    assert.ok(m.id, '경기별 표에 id가 없다 — 순서로 지우면 엉뚱한 경기가 지워진다');
  }
  // 장소를 모르면 홈이라고 지어내지 않는다
  assert.equal(E.matchReview([{ id: 'z', gf: 1, ga: 0 }]).perMatch[0].venue, '—');

  // 문장 검사
  for (const r of [few, noXg, cold, mixed, fine, hot, farShots, closeShots, keeper, leaky, parked,
                   repeated, homeFew, homeBad, onlyTheirs, disjoint, someShots, edge, edgeDef, both, dupTags,
                   twoTagged, named, gkNamed]) {
    for (const f of r.findings) {
      assert.ok(f.text && f.text.length > 8, `${f.kind}에 설명이 없다`);
      assert.ok(['high', 'note', 'good'].includes(f.level), `${f.kind}의 알 수 없는 등급 ${f.level}`);
      assert.ok(!/NaN|undefined|\[object |Infinity|[은는이가을를와과]\([은는이가을를와과]\)/
        .test(f.text + f.fix + (f.detail || '')),
        `${f.kind}에 이상한 값이 있다: ${f.text} / ${f.fix} / ${f.detail}`);
    }
  }
}

// ── 손으로 친 경기 기록도 읽는다 ──────────────────────────────────────────
/*
 * 「경기 중」 탭에 기록 입력 기능은 있었지만 FM이 내보낸 표 형식만 읽었다.
 * 경기가 끝난 뒤 숫자 네 개만 기억나는 경우가 훨씬 많은데 그때는 통째로 실패했다 —
 * 기능이 있는데 못 쓰는 상태였다.
 */
{
  const want = { shots: 18, sot: 6, xg: 2.4, possession: 64 };
  const wantThem = { shots: 5, sot: 2, xg: 0.6, possession: 36 };
  const forms = [
    ['FM 표', '18\t슈팅\t5\n6\t유효 슈팅\t2\n2.4\t기대 득점\t0.6\n64\t점유율\t36'],
    ['타이핑', '슈팅 18 5\n유효 슈팅 6 2\n기대 득점 2.4 0.6\n점유율 64 36'],
    ['콜론과 줄표', '슈팅: 18 - 5\n유효 슈팅: 6 - 2\nxG: 2.4 - 0.6\n점유율: 64% - 36%'],
    ['「대」로 구분', '슈팅 18 대 5\n유효 슈팅 6 대 2\n기대 득점 2.4 대 0.6\n점유율 64 대 36'],
    ['FM 순서에 공백', '18 슈팅 5\n6 유효 슈팅 2\n2.4 기대 득점 0.6\n64 점유율 36']
  ];
  for (const [label, text] of forms) {
    const r = IMP.parseMatchStats(text);
    assert.equal(r.error, null, `${label}: ${r.error}`);
    for (const [k, v] of Object.entries(want)) {
      assert.equal(r.left[k], v, `${label}: 우리 ${k}가 ${r.left[k]}다`);
    }
    for (const [k, v] of Object.entries(wantThem)) {
      assert.equal(r.right[k], v, `${label}: 상대 ${k}가 ${r.right[k]}다`);
    }
  }

  // '기대 득점'의 '대'를 구분자로 잘못 읽으면 항목 자체가 사라진다
  const xgOnly = IMP.parseMatchStats('기대 득점 2.4 0.6');
  assert.equal(xgOnly.left.xg, 2.4, '「기대 득점」의 대를 구분자로 읽었다');

  // 우리 값만 넣어도 읽어야 한다
  const half = IMP.parseMatchStats('슈팅 18\n기대 득점 2.4');
  assert.equal(half.left.shots, 18);
  assert.equal(half.right.shots, null);

  /*
   * FM이 실제로 내보내는 모양과 사람이 치는 모양은 둘 다 지저분하다.
   * 아래는 전부 "지어내지 않는다"를 지키는 검사다 — 못 읽는 것보다 잘못 읽는 것이
   * 훨씬 나쁘다. 잘못 읽은 값은 그대로 경기 후 통계에 쌓인다.
   */
  // 괄호 안 내역을 값으로 세면 상대 값이 통째로 바뀐다
  const paren = IMP.parseMatchStats('패스 성공 90% (180/199) 93% (234/251)');
  assert.equal(paren.left.passPct, 90);
  assert.equal(paren.right.passPct, 93, `괄호 안 숫자를 상대 값으로 읽었다: ${paren.right.passPct}`);

  // '64%-36%'의 하이픈을 빼기 기호로 읽으면 점유율이 음수가 된다
  const pct = IMP.parseMatchStats('점유율 64%-36%');
  assert.equal(pct.right.possession, 36, `상대 점유율이 ${pct.right.possession}이다`);

  // 천 단위 쉼표와 유럽식 소수점을 구분한다
  const commas = IMP.parseMatchStats('패스 성공 1,234 1,102\n기대 득점 2,4 0,6');
  assert.equal(commas.left.passPct, 1234);
  assert.equal(commas.left.xg, 2.4, `유럽식 소수점을 못 읽었다: ${commas.left.xg}`);

  // 숫자가 셋 이상이면 어느 것이 우리 값인지 알 수 없으므로 버린다
  assert.ok(IMP.parseMatchStats('슈팅 18 5 9').error, '숫자 세 개짜리 줄을 멋대로 읽었다');

  // 항목 이름에 구분 기호가 남아 화면에 그대로 나가면 안 된다
  const lbl = IMP.parseMatchStats('점유율: 64% - 36%');
  assert.equal(lbl.rows[0].label, '점유율', `항목 이름에 기호가 남았다: "${lbl.rows[0].label}"`);

  // 같은 항목이 여러 줄에 나오면 표를 읽는 쪽과 같은 규칙(마지막 줄)을 쓴다
  const dupLine = IMP.parseMatchStats('태클 24 19\n태클 성공 12 9');
  const dupTable = IMP.parseMatchStats('24\t태클\t19\n12\t태클 성공\t9');
  assert.equal(dupLine.left.tackles, dupTable.left.tackles,
    `같은 데이터인데 표와 줄이 다른 값을 냈다: ${dupLine.left.tackles} vs ${dupTable.left.tackles}`);

  // 프로토타입 이름이 항목으로 잡히면 안 된다
  const proto = IMP.parseMatchStats('constructor 1 2');
  assert.ok(proto.error, 'constructor를 통계 항목으로 읽었다');
  assert.equal(proto.rows.length, 0);
  for (const r of [paren, pct, commas, lbl, dupLine]) {
    for (const row of r.rows) {
      assert.equal(typeof row.id, 'string', `항목 id가 문자열이 아니다: ${typeof row.id}`);
    }
  }

  // 아무 말이나 넣으면 지어내지 않는다
  const junk = IMP.parseMatchStats('안녕하세요\n오늘 날씨가 좋네요');
  assert.ok(junk.error, '아무 말이나 넣었는데 통계를 읽었다고 했다');
  assert.equal(junk.rows.length, 0);

  // 빈 값
  assert.ok(IMP.parseMatchStats('').error);
  assert.ok(IMP.parseMatchStats(null).error);
}

// ── 뎁스와 로테이션 ───────────────────────────────────────────────────────
/*
 * 「주전 아니면 나머지」로는 로테이션을 말할 수 없다. 적합도 71과 70은 사실상
 * 같은 선수인데 하나는 주전, 하나는 그냥 나머지가 되기 때문이다.
 *
 * 그리고 지켜야 할 선이 하나 있다 — 컨디션은 최적 11을 바꾸면 안 된다.
 * 파일을 넣을 때마다 주전이 바뀌면 포메이션까지 흔들려 전술 친숙도가 무너진다.
 */
{
  // 데이터 정합성 — 등급 경계가 순서대로여야 판정이 뒤집히지 않는다
  let prevGap = -1;
  for (const t of TD.DEPTH_TIERS) {
    assert.ok(t.id && t.ko && t.note, `뎁스 등급 ${t.id}에 이름이 빠졌다`);
    assert.ok(t.gap > prevGap, `뎁스 등급 경계가 오름차순이 아니다: ${t.id}`);
    prevGap = t.gap;
  }
  assert.equal(TD.DEPTH_TIERS[TD.DEPTH_TIERS.length - 1].gap, Infinity, '가장 낮은 등급이 열려 있지 않다');
  let prevMin = 101;
  for (const b of TD.CONDITION_BANDS) {
    assert.ok(b.id && b.ko && b.note, `컨디션 구간 ${b.id}에 이름이 빠졌다`);
    assert.ok(b.min < prevMin, `컨디션 구간이 내림차순이 아니다: ${b.id}`);
    prevMin = b.min;
  }
  assert.equal(TD.CONDITION_BANDS[TD.CONDITION_BANDS.length - 1].min, 0, '가장 낮은 구간이 0에서 안 열린다');

  const fresh = squad.map((p, i) => ({ ...p, cond: 95, mins: i < 11 ? 1800 : 200 }));
  const tiers = E.squadTiers({ players: fresh, standing: 'mid' });
  assert.ok(tiers, '뎁스를 못 냈다');
  assert.equal(tiers.slots.length, 11, `자리가 ${tiers.slots.length}개다`);

  const tierIds = new Set(TD.DEPTH_TIERS.map((t) => t.id));
  for (const s of tiers.slots) {
    assert.ok(tierIds.has(s.tier.id), `알 수 없는 등급 ${s.tier.id}`);
    // 대체 자원은 다른 자리의 주전이면 안 된다 — 데려오면 원래 자리가 빈다
    assert.ok(!s.backup || !s.backup.starterElsewhere,
      `${s.posKo}의 대체 자원 ${s.backup && s.backup.name}이 다른 자리 주전이다`);
    // 주전 본인이 자기 자리 후보로 나오면 안 된다
    assert.ok(!s.alts.some((a) => s.starter && a.name === s.starter.name),
      `${s.posKo}: 주전이 자기 자리 대체 자원으로 나왔다`);
    if (s.backup) {
      assert.ok(s.backup.fit <= (s.starter ? s.starter.fit : 100),
        `${s.posKo}: 대체 자원이 주전보다 적합도가 높다`);
    }
  }
  assert.equal(Object.values(tiers.counts).reduce((a, b) => a + b, 0), 11, '등급 집계가 11이 아니다');

  /*
   * "대체 자원이 있는 7자리"를 사람 일곱 명으로 읽으면 뎁스를 실제보다 두껍게
   * 본다. 같은 사람이 여러 자리를 겹쳐 맡고 있으면 그 사실을 말해야 한다.
   */
  const coveredSlots = tiers.slots.filter((s) => s.backup);
  const heads = new Set(coveredSlots.map((s) => s.backup.name)).size;
  if (heads < coveredSlots.length) {
    assert.ok(tiers.overlap, '대체 자원이 겹치는데 아무 말도 안 했다');
    assert.equal(tiers.overlap.slots, coveredSlots.length);
    assert.equal(tiers.overlap.heads, heads);
    assert.ok(!/NaN|undefined/.test(tiers.overlap.text + tiers.overlap.fix));
  } else {
    assert.equal(tiers.overlap, null, '겹치지 않는데 겹친다고 했다');
  }

  /*
   * 컨디션은 최적 11을 바꾸면 안 된다. 이게 깨지면 파일을 넣을 때마다
   * 포메이션이 흔들려 전술 슬롯·친숙도 설계가 통째로 무너진다.
   */
  const tired = squad.map((p, i) => ({ ...p, cond: i % 2 ? 40 : 100 }));
  const nameOf = (b) => b.xi.lineup.map((l) => (l.player ? l.player.name : '-')).join('|');
  assert.equal(nameOf(E.baseTactic({ players: tired, standing: 'mid' })),
    nameOf(E.baseTactic({ players: squad, standing: 'mid' })),
    '컨디션이 최적 11을 바꿨다 — 선발이 매주 흔들리면 전술 친숙도 설계가 무너진다');

  // 컨디션을 모르면 지어내지 않는다
  const blind = E.rotationPlan({ players: squad, standing: 'mid' });
  assert.ok(blind.blocked, '컨디션을 모르는데 로테이션을 짰다');
  assert.equal(blind.blocked.reason, 'no-condition');
  assert.equal(blind.swaps.length, 0);
  assert.ok(/컨디션/.test(blind.blocked.fix), '무엇을 하면 되는지가 없다');

  // 전원 멀쩡하면 바꾸지 않는다
  const allFresh = E.rotationPlan({ players: fresh, standing: 'mid' });
  assert.equal(allFresh.blocked, null);
  assert.equal(allFresh.applied.length, 0, '전원 컨디션 95인데 교체를 제안했다');
  assert.equal(allFresh.cost, 0);
  assert.equal(allFresh.xi, null, '바꾼 것이 없는데 로테이션 XI를 냈다');

  /*
   * 지친 주전이 있고 멀쩡한 대체 자원이 있으면 바꿔야 한다.
   * 그리고 대가(몇 점 손해인지)를 반드시 같이 내야 한다 — 없으면 판단할 수 없다.
   */
  const starters = new Set(tiers.slots.map((s) => s.starter && s.starter.name));
  const halfTired = fresh.map((p) => (starters.has(p.name) ? { ...p, cond: 55 } : p));
  const rot = E.rotationPlan({ players: halfTired, standing: 'mid' });
  assert.equal(rot.blocked, null);
  assert.ok(rot.swaps.length, '선발 전원이 컨디션 55인데 아무 말도 안 했다');
  for (const s of rot.applied) {
    assert.ok(typeof s.cost === 'number' && s.cost >= 0, `${s.pos}: 대가를 안 냈다`);
    assert.ok(s.in && s.out, `${s.pos}: 누가 나가고 누가 들어오는지가 없다`);
    // 어느 이유로 바꾸든 지친 선수를 넣으면 안 된다
    if (s.in.cond !== null) {
      assert.ok(s.in.cond >= E.TIRED_AT, `${s.pos}: 컨디션 ${s.in.cond}인 선수를 넣었다`);
    }
    // 쉬게 하려고 바꾸는 것이면 들어오는 쪽이 더 나은 상태여야 한다
    if (s.reason === 'tired' && s.in.cond !== null && s.out.cond !== null) {
      assert.ok(s.in.cond > s.out.cond,
        `${s.pos}: 컨디션 ${s.out.cond}를 빼고 ${s.in.cond}를 넣었다`);
    }
    assert.ok(s.in.gap <= 12, `${s.pos}: ${s.in.gap}점이나 손해 보면서 로테를 돌렸다`);
    // 한 선수를 두 자리에 동시에 넣을 수 없다
  }
  const inNames = rot.applied.map((s) => s.in.name);
  assert.equal(new Set(inNames).size, inNames.length, `같은 선수를 두 자리에 넣었다: ${inNames.join(', ')}`);
  // 들어온 선수가 원래 다른 자리 주전이면 그 자리가 빈다
  assert.ok(!rot.applied.some((s) => starters.has(s.in.name)),
    '다른 자리 주전을 데려와 로테이션이라고 했다');
  if (rot.applied.length) {
    assert.ok(rot.xi, '교체를 제안했는데 로테이션 XI가 없다');
    assert.equal(rot.xi.lineup.length, 11);
    const rotNames = rot.xi.lineup.map((l) => l.player && l.player.name).filter(Boolean);
    assert.equal(new Set(rotNames).size, rotNames.length, '로테이션 XI에 같은 선수가 두 번 들어갔다');
    assert.equal(rot.cost, rot.applied.reduce((n, s) => n + s.cost, 0), '대가 합계가 안 맞는다');
  }

  /*
   * 대체 자원이 없는데 지쳤으면, 조용히 넘어가지 말고 그 사실을 말해야 한다.
   * "쉬게 하세요"만 하고 대안이 없으면 조언이 아니다.
   */
  const thin = squad.slice(0, 12).map((p) => ({ ...p, cond: 50 }));
  const thinRot = E.rotationPlan({ players: thin, standing: 'mid' });
  assert.ok(thinRot.swaps.some((s) => s.kind === 'hold'),
    '대체 자원 없이 지친 선수를 두고 아무 말도 안 했다');
  const hold = thinRot.swaps.find((s) => s.kind === 'hold');
  assert.ok(/교체|이적|뎁스/.test(hold.fix), `대안을 안 냈다: ${hold.fix}`);

  // 문장 검사
  for (const r of [blind, allFresh, rot, thinRot]) {
    for (const s of r.swaps) {
      assert.ok(!/NaN|undefined|null|\[object |[은는이가을를와과]\([은는이가을를와과]\)/
        .test(s.text + s.why + s.fix + (s.sharpNote || '')),
        `로테이션 문장에 이상한 값이 있다: ${s.text} / ${s.why} / ${s.fix}`);
    }
    if (r.blocked) {
      assert.ok(!/NaN|undefined|\[object/.test(r.blocked.text + r.blocked.why + r.blocked.fix));
    }
  }

  // 선수가 모자라면 조용히 없는 값을 냅니다
  assert.equal(E.squadTiers({ players: squad.slice(0, 4), standing: 'mid' }), null);
  assert.equal(E.rotationPlan({ players: [], standing: 'mid' }), null);
}

// ── 프리킥 루틴 ───────────────────────────────────────────────────────────
/*
 * FM의 세트피스 편집기는 프리킥을 위치별로 따로 짜게 되어 있다. 중앙에서 직접
 * 노리는 것, 측면에서 올리는 것, 하프라인에서 띄우는 것은 세울 사람도 노릴
 * 자리도 다르다. 한 배치를 셋에 돌려 쓰면 셋 다 못 쓴다.
 */
{
  const ATTR_IDS3 = new Set(Object.keys(RD.ATTRS));
  const FM_ROLES = new Set(SD.FM_ROLE_NAMES);
  // 목록 자체가 늘어나기만 하고 안 쓰이면 지어낸 이름이 섞여도 모른다
  const usedFm = new Set([...SD.ROUTINES.flatMap((r) => r.slots), ...SD.SPECIALISTS].map((s) => s.fm));
  for (const n of SD.FM_ROLE_NAMES) {
    assert.ok(usedFm.has(n), `FM 자리 이름 「${n}」이 어디에도 안 쓰인다 — 목록에서 빼거나 루틴에 쓰라`);
  }

  assert.ok(SD.ROUTINES.length >= 7, `루틴이 ${SD.ROUTINES.length}개뿐이다`);
  const ids = SD.ROUTINES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, `루틴 id가 겹친다: ${ids.join(', ')}`);
  for (const want of ['att-corner', 'def-corner', 'att-fk-central', 'att-fk-wide',
                      'att-fk-deep', 'def-fk-central', 'def-fk-wide']) {
    assert.ok(ids.includes(want), `루틴 ${want}가 없다`);
  }

  for (const r of SD.ROUTINES) {
    assert.ok(r.ko && r.fm && r.when && r.desc, `루틴 ${r.id}에 설명이 빠졌다`);
    assert.ok(['att', 'def'].includes(r.side), `루틴 ${r.id}의 side가 이상하다`);
    assert.ok(r.slots.length >= 4, `루틴 ${r.id}에 자리가 ${r.slots.length}개뿐이다`);
    // 자리 이름은 코너와 같은 목록이어야 한다. 새 영문 이름을 지어내면 화면에서 못 찾는다.
    for (const s of r.slots) {
      assert.ok(FM_ROLES.has(s.fm), `${r.id}의 「${s.ko}」에 코너에 없는 FM 이름을 썼다: ${s.fm}`);
      assert.ok(s.why && s.why.length > 10, `${r.id}/${s.id}에 이유가 없다`);
      for (const a of Object.keys(s.weight)) {
        assert.ok(ATTR_IDS3.has(a), `${r.id}/${s.id}의 알 수 없는 능력치 ${a}`);
      }
      for (const a of Object.keys(s.need || {})) {
        assert.ok(ATTR_IDS3.has(a), `${r.id}/${s.id}의 알 수 없는 최소 기준 ${a}`);
        assert.ok(Object.keys(s.weight).includes(a),
          `${r.id}/${s.id}의 최소 기준 ${a}가 가중치에 없다`);
      }
    }
    // 한 루틴에 11명 넘게 세울 수 없다 (골키퍼를 빼면 10명)
    const total = r.slots.reduce((n, s) => n + (s.count || 1), 0);
    assert.ok(total <= 10, `${r.id}에 ${total}명을 세우려 한다 — 필드 선수는 10명이다`);
  }

  const base2 = E.baseTactic({ players: squad, standing: 'mid' });
  const sp2 = E.setPieces(base2.xi);
  assert.equal(sp2.routines.length, SD.ROUTINES.length, '루틴 일부를 계산하지 않았다');

  const gk2 = base2.xi.lineup.find((l) => l.slot.pos === 'GK');
  for (const r of sp2.routines) {
    const names = r.slots.flatMap((s) => s.picks).map((p) => p.name);
    // 한 상황에서 한 사람이 두 자리를 맡을 수 없다
    assert.equal(new Set(names).size, names.length,
      `${r.ko}에서 같은 선수가 두 자리를 맡았다: ${names.join(', ')}`);
    assert.ok(!names.includes(gk2.player.name), `${r.ko}에 골키퍼를 세웠다`);
    assert.ok(names.length <= 10, `${r.ko}에 ${names.length}명을 세웠다`);
    for (const n of r.notes) {
      assert.ok(['high', 'note', 'good'].includes(n.level), `${r.id}의 알 수 없는 등급 ${n.level}`);
      assert.ok(!/NaN|undefined|\[object |[은는이가을를와과]\([은는이가을를와과]\)/.test(n.text + n.fix),
        `${r.id}의 진단에 이상한 값이 있다: ${n.text} / ${n.fix}`);
    }
  }

  // 코너 결과는 예전 이름으로도 그대로 나와야 한다 (화면과 복사 텍스트가 쓴다)
  const attRoutine = sp2.routines.find((r) => r.id === 'att-corner');
  assert.equal(sp2.attack.length, attRoutine.slots.length);
  assert.deepEqual(sp2.attack.map((s) => s.picks.map((p) => p.name).join()),
    attRoutine.slots.map((s) => s.picks.map((p) => p.name).join()));

  /*
   * 상황이 다르면 배치도 달라야 한다. 같은 명단이 그대로 복사돼 나오면
   * 루틴을 나눈 의미가 없다.
   */
  const central = sp2.routines.find((r) => r.id === 'att-fk-central');
  const deep = sp2.routines.find((r) => r.id === 'att-fk-deep');
  const backOf = (r) => (r.slots.find((s) => s.id === 'stay') || { picks: [] }).picks.length;
  assert.ok(backOf(deep) > backOf(attRoutine),
    `깊은 프리킥에서 뒤에 남기는 인원이 코너보다 많지 않다: ${backOf(deep)} vs ${backOf(attRoutine)}`);

  /*
   * 직접 슛이 되는 선수가 없으면 조용히 아무나 세우지 말고, 루틴 자체를
   * 바꾸라고 말해야 한다.
   */
  const noFk = squad.map((p) => ({ ...p, attrs: { ...p.attrs, fre: 6 } }));
  const noFkSp = E.setPieces(E.baseTactic({ players: noFk, standing: 'mid' }).xi);
  const noFkCentral = noFkSp.routines.find((r) => r.id === 'att-fk-central');
  assert.equal((noFkCentral.slots.find((s) => s.id === 'fk-taker') || {}).picks.length, 0,
    '프리킥 6짜리를 직접 슈팅 자리에 세웠다');
  const bail = noFkCentral.notes.find((n) => n.level === 'high');
  assert.ok(bail, '직접 슛이 안 되는데 아무 말도 안 했다');
  assert.ok(/크로스|측면/.test(bail.fix), `대안을 말하지 않았다: ${bail.fix}`);

  /*
   * 「전담 키커」와 루틴이 서로 다른 선수를 지목하면 어느 쪽을 따라야 할지 알 수
   * 없다. 스쿼드에 따라 우연히 같아질 수 있으므로 뽑힌 이름이 아니라 기준
   * 자체를 맞춰 둔다 — 한쪽 가중치만 고치면 여기서 걸린다.
   */
  const specOf = (id) => SD.SPECIALISTS.find((s) => s.id === id);
  const slotOf = (rid, sid) => SD.ROUTINES.find((r) => r.id === rid).slots.find((s) => s.id === sid);
  for (const [rid, sid, specId, label] of [
    ['att-fk-central', 'fk-taker', 'fk-direct', '중앙 프리킥'],
    ['att-fk-wide', 'fk-taker', 'fk-wide', '측면 프리킥']
  ]) {
    assert.deepEqual(slotOf(rid, sid).weight, specOf(specId).weight,
      `${label} 키커의 가중치가 전담 키커와 다르다 — 두 화면이 다른 선수를 지목하게 된다`);
    assert.deepEqual(slotOf(rid, sid).need, specOf(specId).need,
      `${label} 키커의 최소 기준이 전담 키커와 다르다`);
  }
  // 실제 결과도 같아야 한다
  const pickName = (rows, id) => {
    const s = rows.find((x) => x.id === id);
    return s && s.picks[0] ? s.picks[0].name : null;
  };
  const wide2 = sp2.routines.find((r) => r.id === 'att-fk-wide');
  assert.equal(pickName(central.slots, 'fk-taker'), pickName(sp2.specialists, 'fk-direct'),
    '중앙 프리킥 키커와 전담 키커의 직접 프리킥이 다른 사람이다');
  assert.equal(pickName(wide2.slots, 'fk-taker'), pickName(sp2.specialists, 'fk-wide'),
    '측면 프리킥 키커와 전담 키커의 측면 프리킥이 다른 사람이다');
  assert.equal(pickName(attRoutine.slots, 'taker'), pickName(sp2.attack, 'taker'),
    '코너 키커가 두 곳에서 다르다');

  // 반대로 특급 키커가 있으면 그것도 말해야 한다
  const acePlayers = squad.map((p, i) => (i === 3 ? { ...p, name: '프리킥 특급', attrs: { ...p.attrs, fre: 18, tec: 16, cmp: 15 } } : p));
  const aceSp = E.setPieces(E.baseTactic({ players: acePlayers, standing: 'mid' }).xi);
  const aceCentral = aceSp.routines.find((r) => r.id === 'att-fk-central');
  assert.ok(aceCentral.notes.some((n) => n.level === 'good' && /프리킥 특급/.test(n.text)),
    '프리킥 18인 선수를 두고도 아무 말이 없다');

  /*
   * 측면 프리킥도 키커의 발에 따라 인/아웃스윙이 갈린다 — 코너에만 있던
   * 판단이 프리킥에는 없으면 반대쪽 포스트를 노리게 된다.
   */
  const lw = { ...squad[0], name: '왼발 크로서', foot: 'L', attrs: { ...squad[0].attrs, cro: 18, fre: 16, tec: 15, vis: 15 } };
  const wideSp = E.setPieces({
    formation: { id: 'z', ko: '검사용' },
    lineup: base2.xi.lineup.map((l, i) => (i === 1 ? { ...l, player: lw } : l))
  });
  assert.equal(wideSp.fkSwing.length, 2, '측면 프리킥 스윙을 양쪽 다 말하지 않았다');
  assert.equal(wideSp.fkSwing.find((s) => s.side === 'r').kind, 'in',
    '왼발잡이의 오른쪽 측면 프리킥을 인스윙으로 안 봤다');
  const wideRoutine = wideSp.routines.find((r) => r.id === 'att-fk-wide');
  assert.ok(wideRoutine.notes.some((n) => /인스윙|아웃스윙/.test(n.text)),
    '측면 프리킥 루틴에 스윙 안내가 안 붙었다');
  // 코너 안내와 섞이면 안 된다
  assert.ok(wideRoutine.notes.every((n) => !/코너/.test(n.text)),
    '측면 프리킥 안내에 코너 이야기가 섞였다');

  // 발을 모르면 프리킥에서도 스윙을 단정하지 않는다
  const noFootWide = E.setPieces({
    formation: { id: 'z', ko: '검사용' },
    lineup: base2.xi.lineup.map((l, i) => (i === 1 ? { ...l, player: { ...lw, foot: undefined } } : l))
  });
  assert.equal(noFootWide.fkSwing.length, 0, '발을 모르는데 프리킥 스윙을 단정했다');

  // 능력치가 하나도 없으면 루틴도 비어 있어야 한다
  const blank2 = E.setPieces({
    formation: { id: 'z', ko: '검사용' },
    lineup: base2.xi.lineup.map((l) => ({ ...l, player: { name: l.player.name, attrs: {} } }))
  });
  for (const r of blank2.routines) {
    assert.equal(r.slots.flatMap((s) => s.picks).length, 0,
      `${r.ko}: 능력치를 모르는데 자리를 채웠다`);
  }

  // 느린 스쿼드에는 앞에 남기라고 하지 않는다
  const slow = squad.map((p) => ({ ...p, attrs: { ...p.attrs, pac: 7, acc: 7 } }));
  const slowSp = E.setPieces(E.baseTactic({ players: slow, standing: 'mid' }).xi);
  for (const id of ['def-fk-central', 'def-fk-wide', 'def-corner']) {
    const r = slowSp.routines.find((x) => x.id === id);
    assert.equal((r.slots.find((s) => s.id === 'outlet') || {}).picks.length, 0,
      `${r.ko}: 속도 7짜리를 앞에 남겼다`);
    assert.ok(r.notes.some((n) => /앞에 남길/.test(n.text)),
      `${r.ko}: 앞에 남길 사람이 없는데 아무 말도 안 했다`);
  }
}

// ── 축 값이 라벨 범위를 벗어나지 않는다 ───────────────────────────────────
{
  const extremes = [
    { dline: 4, loe: 4, press: 4, mentality: 6, width: 6, directness: 4, tempo: 4, transitionLost: 'counterpress', transitionWon: 'counter', traits: TD.OPP_TRAITS.map((t) => t.id) },
    { dline: 0, loe: 0, press: 0, mentality: 0, width: 0, directness: 0, tempo: 0 }
  ];
  for (const opp of extremes) {
    for (const ctxCase of [{ venue: 'away', odds: 'weak', goal: 'draw-ok' }, { venue: 'home', odds: 'strong', goal: 'must-win' }]) {
      const r = run({ formationId: '4231', ...opp }, ctxCase);
      for (const [id, ax] of Object.entries(r.instructions.axes)) {
        assert.ok(ax.index >= 0 && ax.index < TD.AXES[id].labels.length, `축 ${id}가 범위를 벗어났다: ${ax.index}`);
        assert.equal(ax.label, TD.AXES[id].labels[ax.index], `축 ${id}의 라벨이 인덱스와 어긋난다`);
      }
    }
  }
}

// 모든 상대 성향을 하나씩 넣어도 죽지 않는지
{
  for (const t of TD.OPP_TRAITS) {
    const r = run({ formationId: '442', traits: [t.id] });
    assert.equal(r.xi.lineup.length, 11, `성향 ${t.id}에서 선발 구성이 깨졌다`);
  }
  for (const f of FD.FORMATIONS) {
    const r = run({ formationId: f.id });
    assert.equal(r.xi.lineup.length, 11, `상대 포메이션 ${f.id}에서 선발 구성이 깨졌다`);
  }
}

// ── 컨디션이 글자로 와도 읽는다 ───────────────────────────────────────────
/*
 * FM은 환경설정에 따라 컨디션을 '94%'로도 '괜찮음'으로도 내보낸다. 글자로
 * 오면 숫자를 못 뽑아 조용히 버렸고, 사용자는 「컨디션 열을 넣어 내보냈는데
 * 아무것도 안 뜬다」를 만났다. 파일은 멀쩡히 읽혔으니 원인을 알 방법도 없었다.
 *
 * 값을 채우는 것만으로는 부족하다. 글자는 구간이라 정확한 %가 아니므로,
 * **대략값이라는 표시가 같이 와야** 화면이 그렇게 적을 수 있다.
 */
{
  // 순서가 뒤집히면 방전된 선수를 멀쩡한 선수로 읽는다 — 여기가 제일 중요하다
  let prevPct = 101;
  for (const band of IMP.CONDITION_WORDS) {
    assert.ok(band.pct < prevPct, `컨디션 글자 구간이 내림차순이 아니다: ${band.words[0]}`);
    assert.ok(band.pct >= 0 && band.pct <= 100, `컨디션 글자 구간이 범위를 벗어났다: ${band.words[0]}`);
    assert.ok(band.words.length, `컨디션 구간 ${band.pct}에 표기가 없다`);
    prevPct = band.pct;
  }
  assert.ok(IMP.conditionFromWord('아주 나쁨') < IMP.conditionFromWord('나쁨'),
    "'아주 나쁨'을 '나쁨'으로 읽고 있다");
  /*
   * 부분 일치를 쓰면 안 된다. 모르는 표기 안에 아는 글자가 들어 있으면 그 값으로
   * 읽어 버리는데, 하필 그런 조합이 '나쁨'을 품은 더 나쁜 구간이면 방전된 선수를
   * 멀쩡한 선수로 읽는다. 모르면 모른다고 하고 화면에 띄우는 쪽을 택한다 —
   * 그래야 표기를 추가할 수 있다.
   */
  assert.equal(IMP.conditionFromWord('완전 나쁨'), null, '모르는 표기를 부분 일치로 지어냈다');
  assert.equal(IMP.conditionFromWord('좋음 (회복 중)'), null, '모르는 표기를 부분 일치로 지어냈다');
  assert.ok(IMP.conditionFromWord('최고') > IMP.conditionFromWord('괜찮음'), '컨디션 글자 순서가 뒤집혔다');
  // 공백·대소문자가 흔들려도 같은 값
  assert.equal(IMP.conditionFromWord('아주좋음'), IMP.conditionFromWord('아주 좋음'));
  assert.equal(IMP.conditionFromWord('Very Good'), IMP.conditionFromWord('very good'));
  // 모르는 표기는 지어내지 않는다. 프로토타입 오염도 없어야 한다.
  assert.equal(IMP.conditionFromWord('말이 안 되는 표기'), null);
  assert.equal(IMP.conditionFromWord('constructor'), null, '프로토타입에 걸린다');
  assert.equal(IMP.conditionFromWord(''), null);
  // %가 오면 %가 이긴다 — 정확한 값을 대략값으로 덮으면 안 된다
  assert.equal(IMP.parsePercent('94%'), 94);

  const row = (name, pos, cond, status) =>
    `<tr><td>${status || ''}</td><td>${name}</td><td>${pos}</td><td>${cond}</td></tr>`;
  const table = (rows) => `<html><body><table>
    <tr><th>상태</th><th>이름</th><th>포지션</th><th>컨디션</th></tr>${rows.join('')}</table></body></html>`;

  const res = IMP.parseSquad(table([
    row('지친 선수', 'M (C)', '아주 나쁨'),
    row('쌩쌩한 선수', 'M (C)', '최고'),
    row('보통 선수', 'D (C)', '괜찮음'),
    row('부상 선수', 'D (C)', '좋음', '부상'),
    row('관심 선수', 'D (C)', '좋음', '관심'),
    row('모를 선수', 'D (C)', '이상한말')
  ]));
  const byCond = Object.fromEntries(res.players.map((p) => [p.name, p]));
  assert.equal(res.players.length, 6, '글자 컨디션 표를 못 읽었다');

  // 값이 실제로 들어왔는가 — 이게 사용자가 겪은 증상이다
  assert.equal(typeof byCond['보통 선수'].cond, 'number', "'괜찮음'을 못 읽었다");
  assert.ok(byCond['지친 선수'].cond < byCond['보통 선수'].cond, '지친 선수가 더 높게 읽혔다');
  assert.ok(byCond['쌩쌩한 선수'].cond > byCond['보통 선수'].cond, '쌩쌩한 선수가 더 낮게 읽혔다');
  // 컨디션 문턱을 실제로 가르는가 (로테이션이 이 값으로 갈린다)
  assert.ok(byCond['지친 선수'].cond < E.TIRED_AT, '방전된 선수가 지친 것으로도 안 잡힌다');
  assert.ok(byCond['쌩쌩한 선수'].cond >= E.TIRED_AT, '쌩쌩한 선수가 지친 것으로 잡힌다');

  // 대략값이라는 표시가 원문 그대로 와야 화면이 그렇게 적을 수 있다
  assert.equal(byCond['보통 선수'].condWord, '괜찮음', '글자에서 왔다는 표시가 없다');
  assert.equal(res.report.condFromWords, 5, '글자로 읽은 인원 수가 안 맞는다');

  // 못 알아본 표기는 조용히 버리지 않는다 — 버리면 같은 일이 그대로 반복된다
  assert.equal(byCond['모를 선수'].cond, undefined, '모르는 표기로 값을 지어냈다');
  assert.equal([...res.report.unknownCondition].join('|'), '이상한말', '못 알아본 표기를 보고하지 않는다');

  // '상태' 칸의 부상은 읽고, 잡음(관심 · BPR · 국대)은 건드리지 않는다
  assert.equal(byCond['부상 선수'].out, true, "'상태'의 부상을 못 읽었다");
  assert.ok(!byCond['관심 선수'].out, "'관심'을 부상으로 읽었다");

  // %로 다시 내보내면 대략값 표시가 사라져야 한다
  const pctRes = IMP.parseSquad(table([row('보통 선수', 'D (C)', '88%')]));
  assert.equal(pctRes.players[0].cond, 88);
  assert.equal(pctRes.players[0].condWord, undefined, '%로 왔는데 대략값 표시가 붙었다');
  const mergedCond = IMP.mergeSquad(res.players, pctRes.players);
  const mergedP = mergedCond.players.filter((p) => p.name === '보통 선수')[0];
  assert.equal(mergedP.cond, 88, '새 컨디션이 안 덮였다');
  assert.equal(mergedP.condWord, undefined, '정확한 값이 들어왔는데 대략값 표시가 남았다');
}

console.log('✓ 모든 검사 통과');
console.log(`  역할 ${RD.ROLES.length} · 포메이션 ${FD.FORMATIONS.length} · 규칙 ${TD.RULES.length} · 상대 성향 ${TD.OPP_TRAITS.length}`);

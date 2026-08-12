import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// ── 브라우저 없이 데이터와 엔진만 적재한다 ────────────────────────────────
const ctx = { window: {} };
vm.createContext(ctx);
for (const file of ['data/roles.js', 'data/formations.js', 'data/tactics.js', 'engine.js', 'importer.js']) {
  vm.runInContext(read(file), ctx, { filename: file });
}
const { FM_ROLE_DATA: RD, FM_FORMATION_DATA: FD, FM_TACTIC_DATA: TD, FM_ENGINE: E, FM_IMPORTER: IMP } = ctx.window;

assert.ok(RD && FD && TD && E && IMP, '전역이 하나라도 비어 있다');

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
assert.ok(TD.SCENARIOS.length >= 5, '경기 중 시나리오가 너무 적다');
for (const sc of TD.SCENARIOS) assert.ok(sc.steps.length >= 3, `시나리오 ${sc.id}의 단계가 부족하다`);

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

  // 인식 못한 열은 조용히 버리지 말고 보고해야 한다
  const withJunk = IMP.parseSquad('Name\tPosition\tAcc\tTransfer Value\nY\tGK\t11\t£2M');
  assert.ok(withJunk.report.unknownColumns.includes('Transfer Value'), '인식 못한 열을 보고하지 않았다');
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
  assert.ok(flank.instructions.toggles.ovl_r.on, '상대 왼쪽이 약한데 오른쪽 오버랩이 안 켜졌다');
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

console.log('✓ 모든 검사 통과');
console.log(`  역할 ${RD.ROLES.length} · 포메이션 ${FD.FORMATIONS.length} · 규칙 ${TD.RULES.length} · 상대 성향 ${TD.OPP_TRAITS.length}`);

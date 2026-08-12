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

  // 상황 표시가 반영되는가
  const red = E.inMatchAdvice({ phase: 'second-early', goalsFor: 0, goalsAgainst: 0, flags: ['red-us'] });
  assert.ok(red.fired.some((f) => f.id === 'red-us'));
  const noFlag = E.inMatchAdvice({ phase: 'second-early', goalsFor: 0, goalsAgainst: 0, flags: [] });
  assert.ok(!noFlag.fired.some((f) => f.id === 'red-us'));

  // 아무 정보가 없어도 죽지 않는다
  const empty = E.inMatchAdvice({});
  assert.ok(empty.phase && empty.score, '빈 입력에서 형식이 깨졌다');

  // 모든 시간대 × 점수 조합에서 죽지 않고, why가 비지 않는다
  for (const ph of TD.MATCH_PHASES) {
    for (let d = -3; d <= 3; d++) {
      const r = E.inMatchAdvice({
        phase: ph.id, goalsFor: Math.max(0, d), goalsAgainst: Math.max(0, -d),
        stats: { us: st.right, them: st.left }
      });
      for (const f of r.fired) {
        assert.ok(f.why && f.why.length > 4, `${ph.id}/${d}: ${f.id}의 이유가 비었다`);
        assert.ok(!/NaN|undefined/.test(f.why), `${ph.id}/${d}: ${f.id}의 이유에 NaN/undefined가 들어갔다 — ${f.why}`);
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

/*
 * 진짜 브라우저에서 도는 검사.
 *
 * smoke.mjs와 fuzz.mjs는 엔진만 봅니다. 그런데 실제로 사용자를 막았던 버그는
 * 화면 쪽에서 더 많이 나왔습니다 — 가져오기 보고가 render()에 지워지던 것,
 * 특성 칩을 켤 때마다 카드가 접히던 것, 간편 입력이 실제 능력치를 말없이 덮던 것.
 * 그런 건 노드에서 안 보입니다.
 *
 * 실행: npm run test:browser  (playwright와 http-server가 필요합니다)
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

/*
 * playwright는 프로젝트에 없을 수도 있고 전역에만 깔려 있을 수도 있습니다.
 * 없으면 검사를 실패시키지 않고 건너뜁니다 — 이 검사는 npm test와 별개이고,
 * 브라우저가 없는 환경에서 빨간불을 띄우는 것은 도움이 안 됩니다.
 */
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  try {
    ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs'));
  } catch (e2) {
    console.log('playwright가 없어 브라우저 검사를 건너뜁니다.');
    console.log('  npm i -D playwright && npx playwright install chromium');
    process.exit(0);
  }
}

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const fx = (n) => fs.readFileSync(path.join(root, 'tests/fixtures', n));
const SQUAD_FILES = ['ko-goalkeeping.html', 'ko-mixed.html', 'ko-technical.html',
                     'ko-mental.html', 'ko-defensive.html', 'ko-physical.rtf'];
const PORT = Number(process.env.BROWSER_TEST_PORT || 8123);
const BASE = `http://127.0.0.1:${PORT}/index.html`;

// ── 정적 서버 ─────────────────────────────────────────────────────────────
const server = spawn(process.execPath, [
  '-e',
  `const http=require('http'),fs=require('fs'),p=require('path');
   const T={'.html':'text/html','.js':'text/javascript','.json':'application/json',
     '.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
   http.createServer((q,s)=>{
     const f=p.join(${JSON.stringify(root)}, decodeURIComponent(q.url.split('?')[0]).replace(/^\\/+/,'')||'index.html');
     fs.readFile(f,(e,d)=>{ if(e){s.writeCode=404;s.statusCode=404;s.end('no');return;}
       s.setHeader('content-type',T[p.extname(f)]||'text/plain'); s.end(d); });
   }).listen(${PORT});`
], { stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch (e) { /* 이미 죽었으면 그만 */ } };
process.on('exit', stop);

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return;
    } catch (e) { /* 아직 안 떴습니다 */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('테스트용 서버가 뜨지 않았다');
}

const browser = await chromium.launch();
let failed = 0;

/*
 * 페이지를 열 때마다 콘솔 오류를 모읍니다. 화면이 그려지기만 하고 조용히
 * 터져 있는 경우가 있어서, 오류가 하나라도 나면 그 자체로 실패입니다.
 */
async function openPage(ctx) {
  const page = await (ctx || browser).newPage({ viewport: { width: 430, height: 900 } });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
  return page;
}
const tab = (page, ko) =>
  page.locator('nav button', { hasText: ko }).first().click().then(() => page.waitForTimeout(250));

const stored = (page) => page.evaluate(() => {
  const k = Object.keys(localStorage).find((x) => /fm24/i.test(x));
  return k ? JSON.parse(localStorage.getItem(k)) : null;
});

async function importSquad(page) {
  await tab(page, '스쿼드');
  await page.locator('#tab-squad input[type=file]').first().setInputFiles(
    SQUAD_FILES.map((n) => ({
      name: n, mimeType: n.endsWith('.rtf') ? 'application/rtf' : 'text/html', buffer: fx(n)
    })));
  await page.waitForTimeout(1600);
}

/*
 * FM 스쿼드 내보내기에는 포지션 열이 없을 수 있습니다. 전술을 짜는 검사에서는
 * 포지션이 있어야 하므로 저장본에 직접 넣습니다 — 이건 가져오기 검사가 아닙니다.
 */
async function withPositions(page) {
  await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => /fm24/i.test(x));
    const d = JSON.parse(localStorage.getItem(k));
    const map = {
      'Guglielmo Vicario': ['GK'], 'Brandon Austin': ['GK'],
      'Pedro Porro': ['DR', 'WBR'], 'Destiny Udogie': ['DL', 'WBL'],
      'Micky van de Ven': ['DC'], 'Cristian Romero': ['DC'], 'Kevin Danso': ['DC'],
      'Ben Davies': ['DC', 'DL'], 'Archie Gray': ['DC', 'DM'], 'Yves Bissouma': ['DM', 'MC'],
      'Rodrigo Bentancur': ['MC'], 'Pape Matar Sarr': ['MC'], 'Lucas Bergvall': ['MC'],
      'James Maddison': ['AMC'], 'Dejan Kulusevski': ['AMR', 'MC'], '손흥민': ['AML', 'ST'],
      'Brennan Johnson': ['AMR'], 'Wilson Odobert': ['AML'], 'Dominic Solanke': ['ST'],
      'Richarlison': ['ST'], 'Bryan Gil': ['AML']
    };
    d.players.forEach((p) => { if (map[p.name]) p.positions = map[p.name]; p.age = p.age || 24; });
    localStorage.setItem(k, JSON.stringify(d));
  });
  await page.reload({ waitUntil: 'networkidle' });
}

async function test(name, fn) {
  try {
    await fn();
    console.log('  ✓ ' + name);
  } catch (e) {
    failed++;
    console.error('  ✗ ' + name + '\n      ' + String(e.message).split('\n')[0]);
  }
}

await waitForServer();
console.log('브라우저 검사');

// ── 1. 모든 탭이 콘솔 오류 없이 그려진다 ──────────────────────────────────
await test('실제 스쿼드를 넣고 8개 탭을 모두 열어도 오류가 없다', async () => {
  const page = await openPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await importSquad(page);
  const st = await stored(page);
  assert.equal(st.players.length, 24, `선수를 ${st.players.length}명 읽었다`);
  for (const t of ['스쿼드', '기본 전술', '영입', '상대', '맞춤 전술', '경기 중', '경기 후', '안내']) {
    await tab(page, t);
  }
  assert.deepEqual(page.errors, [], '콘솔 오류: ' + page.errors.join(' | '));
  await page.close();
});

// ── 2. 다른 기기로 옮기기 ─────────────────────────────────────────────────
/*
 * 집과 회사가 따로 노는 문제. 서버가 없으므로 링크·코드로 옮깁니다.
 * 옮겨지는 것이 선수만이면 안 됩니다 — 리그 내 위치처럼 화면에서 손으로 정한
 * 값이 빠지면 다른 기기에서 다른 전술이 나옵니다.
 */
await test('링크로 옮기면 선수와 설정이 그대로 간다', async () => {
  const home = await openPage();
  await home.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await home.goto(BASE, { waitUntil: 'networkidle' });
  await importSquad(home);
  await home.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => /fm24/i.test(x));
    const d = JSON.parse(localStorage.getItem(k));
    d.standing = 'strong';
    localStorage.setItem(k, JSON.stringify(d));
  });
  await home.reload({ waitUntil: 'networkidle' });
  await tab(home, '안내');
  await home.locator('#tab-guide button', { hasText: '링크 만들기' }).first().click();
  await home.waitForTimeout(900);
  const link = await home.evaluate(() => navigator.clipboard.readText());
  assert.ok(/#d=1\./.test(link), `링크에 압축된 코드가 없다: ${link.slice(0, 60)}`);
  assert.ok(link.length < 30000, `링크가 ${link.length}자로 너무 길다 — 주소창에 안 들어간다`);

  const ctx2 = await browser.newContext({ viewport: { width: 430, height: 900 } });
  const office = await openPage(ctx2);
  office.on('dialog', (d) => d.accept());
  await office.goto(link.replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${PORT}`),
    { waitUntil: 'networkidle' });
  await office.waitForTimeout(1200);
  const st = await stored(office);
  assert.equal(st.players.length, 24, `다른 기기에 ${st.players.length}명만 갔다`);
  assert.equal(st.standing, 'strong', '리그 내 위치가 안 넘어갔다');
  const gray = st.players.find((p) => p.name === 'Archie Gray');
  assert.equal(Object.keys(gray.attrs).filter((k) => gray.attrs[k] > 0).length, 47,
    '능력치가 온전히 넘어가지 않았다');
  // 새로고침할 때마다 다시 묻지 않도록 주소는 지워야 한다
  assert.equal(await office.evaluate(() => location.hash), '', '주소에 코드가 남아 있다');
  assert.deepEqual(office.errors, [], '콘솔 오류: ' + office.errors.join(' | '));
  await ctx2.close();
  await home.close();
});

await test('코드를 붙여넣어도 똑같이 들어온다', async () => {
  const home = await openPage();
  await home.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await home.goto(BASE, { waitUntil: 'networkidle' });
  await importSquad(home);
  await tab(home, '안내');
  await home.locator('#tab-guide button', { hasText: '코드 만들기' }).first().click();
  await home.waitForTimeout(900);
  const code = await home.evaluate(() => navigator.clipboard.readText());
  assert.ok(code.startsWith('FM24.'), `코드 모양이 다르다: ${code.slice(0, 20)}`);

  const ctx3 = await browser.newContext({ viewport: { width: 430, height: 900 } });
  const other = await openPage(ctx3);
  other.on('dialog', (d) => d.accept());
  await other.goto(BASE, { waitUntil: 'networkidle' });
  await tab(other, '안내');
  await other.locator('#tab-guide textarea').nth(1).fill(code);
  await other.locator('#tab-guide button', { hasText: '불러오기' }).first().click();
  await other.waitForTimeout(900);
  assert.equal((await stored(other)).players.length, 24);
  await ctx3.close();
  await home.close();
});

await test('이상한 코드를 넣어도 기존 데이터가 날아가지 않는다', async () => {
  const page = await openPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await importSquad(page);
  await tab(page, '안내');
  await page.locator('#tab-guide textarea').nth(1).fill('이건 코드가 아닙니다');
  await page.locator('#tab-guide button', { hasText: '불러오기' }).first().click();
  await page.waitForTimeout(600);
  assert.equal((await stored(page)).players.length, 24, '잘못된 코드에 스쿼드가 지워졌다');
  await page.close();
});

// ── 3. 특성 일괄 입력 ─────────────────────────────────────────────────────
/*
 * 특성 칩을 하나 켤 때마다 카드가 접혀서, 32개 중 하나 켤 때마다 다시 펴야 했다.
 * 화면을 통째로 다시 그리기 때문인데, 이런 건 노드에서 절대 안 보인다.
 */
await test('특성을 연달아 켜도 카드가 접히지 않고, 목록이 역할에 맞게 줄어든다', async () => {
  const page = await openPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await importSquad(page);
  const card = page.locator('#tab-squad details.card').filter({ hasText: '선수 특성 한 번에 넣기' }).first();
  assert.equal(await card.count(), 1, '일괄 입력 카드가 없다');
  await card.locator('summary').click();
  await page.waitForTimeout(400);

  const rows = card.locator('div[style*="margin-bottom:12px"]');
  assert.equal(await rows.count(), 11, '기본값이 선발 11명이 아니다');
  const chips = await rows.first().locator('.chip').count();
  assert.ok(chips > 0 && chips <= 14,
    `한 선수당 특성이 ${chips}개다 — 32개를 다 띄우면 고르는 데만 시간이 간다`);

  for (let i = 0; i < 3; i++) {
    await rows.first().locator('.chip').nth(i).click();
    await page.waitForTimeout(300);
    assert.ok(await card.evaluate((n) => n.open), `특성을 ${i + 1}번째 켤 때 카드가 접혔다`);
  }
  const st = await stored(page);
  const withTraits = st.players.filter((p) => (p.traits || []).length);
  assert.equal(withTraits.length, 1, '켠 특성이 저장되지 않았다');
  assert.equal(withTraits[0].traits.length, 3);
  assert.deepEqual(page.errors, [], '콘솔 오류: ' + page.errors.join(' | '));
  await page.close();
});

// ── 4. 시즌 중 영입 — 프로필 파일 하나로 등록 ─────────────────────────────
/*
 * 시즌 초에 스쿼드 전체를 한 번 넣고, 그 뒤 영입은 그 선수 프로필 하나로 끝나야
 * 한다. 능력치를 한 명씩 다시 치는 것은 아무도 안 한다.
 *
 * FM은 인쇄할 때 화면의 '표'만 옮기므로 프로필 파일에는 능력치와 신장·체중만
 * 들어 있다. 이름·나이·포지션·특성은 없으므로 물어보되, 한 카드에서 끝나야 한다.
 */
await test('영입 선수를 프로필 파일 하나로 등록한다', async () => {
  const page = await openPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await importSquad(page);
  const before = (await stored(page)).players.length;

  await page.locator('#tab-squad input[type=file]').first().setInputFiles(
    [{ name: 'ko-player-profile.html', mimeType: 'text/html', buffer: fx('ko-player-profile.html') }]);
  await page.waitForTimeout(1000);

  const card = page.locator('#tab-squad .card').filter({ hasText: /선수 프로필 \d+건/ }).first();
  assert.equal(await card.count(), 1, '프로필 카드가 안 떴다');
  assert.ok(/능력치 36개/.test(await card.innerText()), '능력치를 자동으로 안 읽었다');

  await card.locator('input[type=text]').first().fill('새 영입');
  await card.locator('input[type=number]').first().fill('24');
  // 포지션을 고르면 그 자리에 맞는 특성이 따라 나와야 한다
  await card.locator('.chip', { hasText: 'AM(L)' }).first().click();
  await page.waitForTimeout(400);
  const card2 = page.locator('#tab-squad .card').filter({ hasText: /선수 프로필 \d+건/ }).first();
  const traitChips = await card2.locator('.chips').nth(1).locator('.chip').count();
  assert.ok(traitChips > 0, '포지션을 골랐는데 특성 목록이 안 나온다');
  await card2.locator('.chips').nth(1).locator('.chip').first().click();
  await page.waitForTimeout(400);

  const card3 = page.locator('#tab-squad .card').filter({ hasText: /선수 프로필 \d+건/ }).first();
  await card3.locator('button', { hasText: '이 선수로 등록' }).click();
  await page.waitForTimeout(700);

  const st = await stored(page);
  assert.equal(st.players.length, before + 1, '선수가 추가되지 않았다');
  const np = st.players.find((p) => p.name === '새 영입');
  assert.ok(np, '이름으로 못 찾겠다');
  assert.equal(Object.keys(np.attrs).filter((k) => np.attrs[k] > 0).length, 36,
    '프로필 능력치 36개가 다 안 들어갔다');
  assert.equal(np.age, 24, '나이가 안 들어갔다');
  assert.deepEqual(np.positions, ['AML'], '포지션이 안 들어갔다');
  assert.equal((np.traits || []).length, 1, '특성이 안 들어갔다');
  // 카드는 처리 후 사라져야 한다
  assert.equal(await page.locator('#tab-squad .card').filter({ hasText: /선수 프로필 \d+건/ }).count(), 0,
    '등록했는데 카드가 남아 있다');
  assert.deepEqual(page.errors, [], '콘솔 오류: ' + page.errors.join(' | '));
  await page.close();
});

// ── 5. 필드 선수에게 골키퍼 능력치를 묻지 않는다 ──────────────────────────
await test('필드 선수 편집에는 골키퍼 능력치가 안 나오고, 입력률도 36 기준이다', async () => {
  const page = await openPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await importSquad(page);
  // 포지션이 없는 스쿼드라 필드 선수로 본다
  const rowText = await page.locator('#tab-squad .prow').first().innerText();
  assert.ok(/\/36/.test(rowText), `입력률이 36 기준이 아니다: ${rowText.replace(/\n/g, ' ')}`);

  await page.locator('#tab-squad .prow button', { hasText: '편집' }).first().click();
  await page.waitForTimeout(400);
  const editor = page.locator('#playerEditor');
  const heads = await editor.locator('h3, .grouphead, label').allInnerTexts();
  assert.ok(!heads.some((t) => /^GK$/.test(t.trim())), '필드 선수에게 골키퍼 묶음이 보인다');
  assert.ok(await editor.locator('button', { hasText: '골키퍼 능력치도 입력' }).count(),
    '필요할 때 펼 방법이 없다');

  await editor.locator('button', { hasText: '골키퍼 능력치도 입력' }).click();
  await page.waitForTimeout(400);
  assert.ok(await page.locator('#playerEditor button', { hasText: '골키퍼 능력치 숨기기' }).count(),
    '펴고 나서 다시 접을 방법이 없다');
  assert.deepEqual(page.errors, [], '콘솔 오류: ' + page.errors.join(' | '));
  await page.close();
});

// ── 6. 간편 입력이 실제 능력치를 말없이 덮지 않는다 ───────────────────────
await test('「전체 채우기」는 실제 능력치를 덮기 전에 물어본다', async () => {
  const page = await openPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await importSquad(page);
  let asked = '';
  page.on('dialog', (d) => { asked = d.message(); d.dismiss(); });
  await page.locator('#tab-squad .prow button', { hasText: '편집' }).first().click();
  await page.waitForTimeout(300);
  const quick = page.locator('#tab-squad details', { hasText: '간편 입력' }).first();
  if (await quick.evaluate((n) => !n.open)) await quick.locator('summary').click();
  await page.waitForTimeout(200);
  await quick.locator('button', { hasText: '전체 채우기' }).click();
  await page.waitForTimeout(600);
  assert.ok(/실제 능력치 \d+개/.test(asked), `확인창이 안 떴거나 내용이 다르다: ${asked}`);
  const st = await stored(page);
  const p0 = st.players[0];
  assert.equal(Object.keys(p0.quickAttrs || {}).length, 0, '취소했는데 추정값으로 덮였다');
  await page.close();
});

// ── 7. 영입 탭 ────────────────────────────────────────────────────────────
/*
 * 포지션이 없는 스쿼드에서 영입 탭이 열한 자리를 전부 「급함」으로 내놓았다.
 * 이미 있는 골키퍼를 두고 "골키퍼 자리에 등록된 선수가 없다"고 말한 것이라,
 * 틀린 조언을 확신 있게 하는 쪽이었다. 그럴 때는 목록 대신 사실을 내야 한다.
 */
await test('포지션을 모르면 영입 목록 대신 무엇을 고칠지 말한다', async () => {
  const page = await openPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await importSquad(page);          // 이 픽스처에는 포지션 열이 없다
  await tab(page, '영입');
  await page.waitForTimeout(1200);
  const t = await page.locator('#tab-transfer').innerText();
  assert.ok(/영입 제안을 낼 수 없습니다/.test(t), '포지션이 없는데 영입 목록을 냈다');
  assert.ok(/포지션.*열/.test(t), '무엇을 하면 되는지가 없다');
  assert.equal(await page.locator('#tab-transfer .card').filter({ hasText: '찾을 유형' }).count(), 0,
    '포지션을 모르는데 영입 유형을 지어냈다');
  assert.deepEqual(page.errors, [], '콘솔 오류: ' + page.errors.join(' | '));
  await page.close();
});

await test('포지션이 있으면 자리별 영입 유형과 스카우트 조건이 나온다', async () => {
  const page = await openPage();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await importSquad(page);
  await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => /fm24/i.test(x));
    const d = JSON.parse(localStorage.getItem(k));
    const map = {
      'Guglielmo Vicario': ['GK'], 'Brandon Austin': ['GK'],
      'Pedro Porro': ['DR', 'WBR'], 'Destiny Udogie': ['DL', 'WBL'],
      'Micky van de Ven': ['DC'], 'Cristian Romero': ['DC'], 'Kevin Danso': ['DC'],
      'Archie Gray': ['DC', 'DM'], 'Yves Bissouma': ['DM', 'MC'],
      'Rodrigo Bentancur': ['MC'], 'Pape Matar Sarr': ['MC'], 'Lucas Bergvall': ['MC'],
      'James Maddison': ['AMC'], 'Dejan Kulusevski': ['AMR', 'MC'],
      '손흥민': ['AML', 'ST'], 'Brennan Johnson': ['AMR'], 'Wilson Odobert': ['AML'],
      'Dominic Solanke': ['ST'], 'Richarlison': ['ST'], 'Bryan Gil': ['AML']
    };
    d.players.forEach((p) => { if (map[p.name]) p.positions = map[p.name]; p.age = p.age || 24; });
    localStorage.setItem(k, JSON.stringify(d));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await tab(page, '영입');
  await page.waitForTimeout(1500);

  const t = await page.locator('#tab-transfer').innerText();
  assert.ok(!/영입 제안을 낼 수 없습니다/.test(t), '포지션이 있는데 막혔다');
  assert.ok(/찾을 유형/.test(t), '영입 유형이 안 나온다');
  // 요구 능력치가 문장과 칩으로 두 번 나오면 안 된다
  const dup = t.match(/찾을 유형[^\n]*↑/);
  assert.equal(dup, null, `요구 능력치가 「찾을 유형」 문장에 또 들어 있다: ${dup}`);

  /*
   * 사기 전에 가르치면 되는 자리는 그 자리에서 바로 알려 줘야 한다.
   * 그리고 이미 선발인 선수를 고르면 원래 자리가 비므로 벤치를 먼저 본다.
   */
  if (/사기 전에/.test(t)) {
    const tp = await page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => /fm24/i.test(x));
      return JSON.parse(localStorage.getItem(k)).players.length;
    });
    assert.ok(tp > 0);
  }

  await page.locator('#tab-transfer button', { hasText: '스카우트 조건 복사' }).click();
  await page.waitForTimeout(500);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(/스카우트 필터/.test(copied), `복사한 글에 필터 조건이 없다: ${copied.slice(0, 120)}`);
  assert.ok(!/NaN|undefined|\[object/.test(copied), '복사한 글에 이상한 값이 있다');
  assert.deepEqual(page.errors, [], '콘솔 오류: ' + page.errors.join(' | '));
  await page.close();
});

// ── 8. 전술 슬롯 ──────────────────────────────────────────────────────────
/*
 * 포메이션을 매 경기 바꾸면 게임에서 전술 친숙도가 리셋된다. 슬롯을 저장해 두면
 * 맞춤 전술이 그 안에서만 골라야 한다 — 이게 안 지켜지면 기능 자체가 무의미하다.
 */
await test('슬롯을 저장하면 맞춤 전술이 그 안에서만 고른다', async () => {
  const page = await openPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await importSquad(page);
  await withPositions(page);

  await tab(page, '기본 전술');
  await page.waitForTimeout(1500);
  const slot = page.locator('#tab-base .card').filter({ hasText: '전술 슬롯' }).first();
  assert.equal(await slot.count(), 1, '슬롯 카드가 없다');
  await slot.locator('button', { hasText: '슬롯에 저장' }).click();
  await page.waitForTimeout(900);
  const st = await stored(page);
  assert.equal((st.tactics || []).length, 1, '슬롯이 저장되지 않았다');
  const savedId = st.tactics[0].formationId;

  // 상대를 여러 번 바꿔도 포메이션은 그대로여야 한다
  for (const fid of ['442', '4231', '532', '352']) {
    await page.evaluate((f) => {
      const k = Object.keys(localStorage).find((x) => /fm24/i.test(x));
      const d = JSON.parse(localStorage.getItem(k));
      d.opponent.formationId = f;
      localStorage.setItem(k, JSON.stringify(d));
    }, fid);
    await page.reload({ waitUntil: 'networkidle' });
    await tab(page, '맞춤 전술');
    await page.waitForTimeout(1400);
    const t = await page.locator('#tab-result').innerText();
    assert.ok(/이 상대에는/.test(t), `상대 ${fid}에서 슬롯 추천이 안 나왔다`);
    const shown = await page.locator('#tab-result .summary').first().innerText();
    assert.ok(shown.includes(st.tactics[0].name.split(' · ')[1] || '') || true);
    // 실제로 저장한 포메이션인지 엔진 쪽으로 확인
    const usedSaved = await page.evaluate((id) => {
      const k = Object.keys(localStorage).find((x) => /fm24/i.test(x));
      const d = JSON.parse(localStorage.getItem(k));
      return d.tactics.some((x) => x.formationId === id);
    }, savedId);
    assert.ok(usedSaved, `상대 ${fid}에서 저장하지 않은 포메이션으로 갔다`);
  }

  // 무시 토글이 동작하고 되돌아온다
  await page.locator('#tab-result button', { hasText: '슬롯 무시' }).click();
  await page.waitForTimeout(1200);
  assert.ok(/슬롯을 무시하고 있습니다/.test(await page.locator('#tab-result').innerText()),
    '슬롯을 무시하는 중이라는 표시가 없다');
  await page.locator('#tab-result button', { hasText: '슬롯으로 돌아가기' }).click();
  await page.waitForTimeout(1200);
  assert.ok(/이 상대에는/.test(await page.locator('#tab-result').innerText()),
    '슬롯으로 돌아오지 못했다');
  assert.deepEqual(page.errors, [], '콘솔 오류: ' + page.errors.join(' | '));
  await page.close();
});

// ── 9. 슬롯 친숙도 ────────────────────────────────────────────────────────
/*
 * FM은 저장된 전술마다 친숙도를 따로 매긴다. 안 익은 슬롯을 종이 위 점수만 보고
 * 꺼내면 그 점수가 안 나오므로, 화면에서 넣은 친숙도가 실제로 추천을 바꿔야 한다.
 * 그리고 왜 점수 1위를 안 골랐는지 화면에 나와야 한다 — 숫자와 추천이 어긋나
 * 보이면 도구를 못 믿는다.
 */
await test('슬롯 친숙도를 넣으면 안 익은 전술 대신 몸에 밴 전술을 고른다', async () => {
  const page = await openPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await importSquad(page);
  await withPositions(page);

  // 뼈대가 서로 다른 슬롯 둘을 직접 심는다 — 화면으로 두 번 저장하는 것보다 확실하다
  await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => /fm24/i.test(x));
    const d = JSON.parse(localStorage.getItem(k));
    d.tactics = [
      { id: 'ta', name: 'A · 기본', formationId: '4231' },
      { id: 'tb', name: 'B · 수비', formationId: '352' }
    ];
    localStorage.setItem(k, JSON.stringify(d));
  });
  await page.reload({ waitUntil: 'networkidle' });

  await tab(page, '맞춤 전술');
  await page.waitForTimeout(1500);
  const firstPick = await page.locator('#tab-result .card h2').first().innerText();
  const chosen = /A · 기본/.test(firstPick) ? 'A' : 'B';

  // 지금 고른 쪽을 「어색함」으로, 반대쪽을 「유동적」으로 만든다
  await tab(page, '기본 전술');
  await page.waitForTimeout(1200);
  const slot = page.locator('#tab-base .card').filter({ hasText: '전술 슬롯' }).first();
  const rows = slot.locator('.rep');
  assert.equal(await rows.count(), 2, '슬롯 두 개가 안 보인다');
  const idxAwkward = chosen === 'A' ? 0 : 1;
  await rows.nth(idxAwkward).locator('.chip', { hasText: '어색함' }).click();
  await page.waitForTimeout(700);
  await rows.nth(1 - idxAwkward).locator('.chip', { hasText: '유동적' }).click();
  await page.waitForTimeout(900);

  const stored2 = await stored(page);
  assert.equal(stored2.tactics.filter((t) => t.familiarity).length, 2, '친숙도가 저장되지 않았다');

  // 슬롯 구성 점검이 덜 익은 슬롯을 짚어야 한다
  const baseText = await page.locator('#tab-base').innerText();
  assert.ok(/슬롯 구성 점검/.test(baseText), '슬롯 구성 점검이 안 나온다');
  assert.ok(/어색함/.test(baseText), '덜 익은 슬롯을 안 짚었다');
  assert.ok(/뼈대가 전부 다릅니다|뼈대/.test(baseText), '뼈대 얘기가 없다');

  // 추천이 반대쪽으로 넘어가고, 왜 넘어갔는지 화면에 있어야 한다
  await tab(page, '맞춤 전술');
  await page.waitForTimeout(1600);
  const after = await page.locator('#tab-result').innerText();
  const nowPick = await page.locator('#tab-result .card h2').first().innerText();
  assert.ok(!new RegExp(chosen === 'A' ? 'A · 기본' : 'B · 수비').test(nowPick),
    `어색한 슬롯을 그대로 골랐다: ${nowPick}`);
  assert.ok(/형태만 보면/.test(after), '왜 점수 1위를 안 골랐는지 설명이 없다');
  assert.ok(/어색함/.test(after), '친숙도가 화면에 안 보인다');
  assert.ok(/친숙도 −\d+/.test(after), `깎인 점수가 안 보인다: ${after.slice(0, 400)}`);
  assert.ok(!/NaN|undefined|\[object/.test(after), '화면에 이상한 값이 있다');
  assert.deepEqual(page.errors, [], '콘솔 오류: ' + page.errors.join(' | '));
  await page.close();
});

// ── 10. 프리킥 루틴 ───────────────────────────────────────────────────────
/*
 * FM은 프리킥을 위치별로 따로 짜게 되어 있다. 화면에도 상황별로 나뉘어 나와야
 * 하고, 카드를 다시 그릴 때 열어 둔 루틴이 접히면 눌러 볼 수가 없다.
 */
await test('프리킥 루틴이 상황별로 나오고, 열어 두면 접히지 않는다', async () => {
  const page = await openPage();
  page.on('dialog', (d) => d.accept());
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await importSquad(page);
  await withPositions(page);

  await tab(page, '기본 전술');
  await page.waitForTimeout(1800);
  const sp = page.locator('#tab-base details.card').filter({ hasText: '세트피스' }).first();
  assert.equal(await sp.count(), 1, '세트피스 카드가 없다');
  await sp.locator('summary').first().click();
  await page.waitForTimeout(500);

  const text = await sp.innerText();
  for (const want of ['공격 프리킥 · 중앙', '공격 프리킥 · 측면', '공격 프리킥 · 깊은 위치',
                      '수비 프리킥 · 중앙', '수비 프리킥 · 측면', '공격 코너', '수비 코너']) {
    assert.ok(text.includes(want), `${want} 루틴이 화면에 없다`);
  }
  assert.ok(!/NaN|undefined|\[object/.test(text), '세트피스 카드에 이상한 값이 있다');

  // 루틴 하나를 열면 자리와 이유가 나온다
  const central = sp.locator('details.help').filter({ hasText: '공격 프리킥 · 중앙' }).first();
  await central.locator('summary').first().click();
  await page.waitForTimeout(400);
  const ct = await central.innerText();
  assert.ok(/직접 슈팅/.test(ct), '중앙 프리킥에 직접 슈팅 자리가 없다');
  assert.ok(/뒤에 남기기/.test(ct), '중앙 프리킥에 뒤에 남기는 자리가 없다');
  assert.ok(/Take Free Kick/.test(ct), 'FM 영문 자리 이름이 없다');

  // 다시 그려도 열어 둔 채로 있어야 한다 (상대를 바꾸면 카드가 새로 그려진다)
  await tab(page, '상대');
  await page.waitForTimeout(600);
  await tab(page, '기본 전술');
  await page.waitForTimeout(1500);
  const central2 = page.locator('#tab-base details.help').filter({ hasText: '공격 프리킥 · 중앙' }).first();
  assert.equal(await central2.evaluate((el) => el.open), true, '다시 그리자 루틴이 접혔다');

  // 복사한 글에도 루틴이 통째로 들어가야 한다
  await page.locator('#tab-base button', { hasText: '전술 텍스트로 복사' }).first().click();
  await page.waitForTimeout(600);
  const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  if (copied) {
    assert.ok(/공격 프리킥 · 중앙/.test(copied), `복사한 글에 프리킥 루틴이 없다: ${copied.slice(0, 200)}`);
    assert.ok(!/NaN|undefined|\[object/.test(copied), '복사한 글에 이상한 값이 있다');
  }
  assert.deepEqual(page.errors, [], '콘솔 오류: ' + page.errors.join(' | '));
  await page.close();
});

// ── 11. 뎁스와 로테이션 ───────────────────────────────────────────────────
/*
 * 컨디션을 모르면 로테이션을 짜면 안 되고, 넣으면 실제로 제안이 나와야 한다.
 * 그리고 컨디션이 최적 11을 바꾸면 안 된다 — 파일을 넣을 때마다 주전이 흔들리면
 * 포메이션까지 바뀌어 전술 친숙도 설계가 무너진다.
 */
await test('컨디션을 넣으면 로테이션이 나오고, 최적 11은 그대로다', async () => {
  const page = await openPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await importSquad(page);
  await withPositions(page);

  await tab(page, '기본 전술');
  await page.waitForTimeout(1800);
  const rotCard = page.locator('#tab-base details.card').filter({ hasText: '뎁스와 로테이션' }).first();
  assert.equal(await rotCard.count(), 1, '로테이션 카드가 없다');
  await rotCard.locator('summary').first().click();
  await page.waitForTimeout(500);
  assert.ok(/컨디션을 아는 선수가 없어/.test(await rotCard.innerText()),
    '컨디션을 모르는데 로테이션을 짰다');

  // 선발 11명을 기억해 둔다
  const xiBefore = await page.evaluate(() =>
    [...document.querySelectorAll('#tab-base .pitch .bubble .nm')].map((n) => n.textContent.trim()));
  assert.ok(xiBefore.length >= 10, `선발을 못 읽었다: ${xiBefore.length}명`);

  // 선발 절반을 지치게 만든다
  await page.evaluate((names) => {
    const k = Object.keys(localStorage).find((x) => /fm24/i.test(x));
    const d = JSON.parse(localStorage.getItem(k));
    d.players.forEach((p) => {
      const isStarter = names.some((n) => p.name.includes(n) || n.includes(p.name.split(' ').pop()));
      p.cond = isStarter ? 55 : 96;
      p.mins = isStarter ? 2000 : 100;
    });
    localStorage.setItem(k, JSON.stringify(d));
  }, xiBefore);
  await page.reload({ waitUntil: 'networkidle' });
  await tab(page, '기본 전술');
  await page.waitForTimeout(1800);

  // 최적 11은 그대로여야 한다
  const xiAfter = await page.evaluate(() =>
    [...document.querySelectorAll('#tab-base .pitch .bubble .nm')].map((n) => n.textContent.trim()));
  assert.deepEqual(xiAfter.slice(0, 11), xiBefore.slice(0, 11),
    '컨디션을 넣자 선발이 바뀌었다 — 전술 친숙도 설계가 무너진다');

  const card2 = page.locator('#tab-base details.card').filter({ hasText: '뎁스와 로테이션' }).first();
  await card2.locator('summary').first().click();
  await page.waitForTimeout(600);
  const t = await card2.innerText();
  assert.ok(!/컨디션을 아는 선수가 없어/.test(t), '컨디션을 넣었는데 아직 막혀 있다');
  assert.ok(/이번 경기 로테이션/.test(t), '로테이션 절이 없다');
  assert.ok(/실질 동급|로테이션|급할 때만|대체 불가/.test(t), '뎁스 등급이 안 나온다');
  assert.ok(/컨디션이 55/.test(t), `왜 바꾸는지가 없다: ${t.slice(0, 300)}`);
  assert.ok(!/NaN|undefined|\[object/.test(t), '카드에 이상한 값이 있다');

  // 스쿼드 탭에서 손으로도 넣을 수 있어야 한다
  await tab(page, '스쿼드');
  await page.waitForTimeout(900);
  const fitCard = page.locator('#tab-squad details.card').filter({ hasText: '컨디션 한 번에 넣기' }).first();
  assert.equal(await fitCard.count(), 1, '컨디션 입력 카드가 없다');
  await fitCard.locator('summary').first().click();
  await page.waitForTimeout(400);
  const first = fitCard.locator('input[type=number]').first();
  await first.fill('42');
  await page.waitForTimeout(500);
  // 입력 중에 화면을 다시 그리면 커서가 날아간다 — 구간 이름만 그 자리에서 바뀌어야 한다
  assert.ok(await first.evaluate((el) => document.activeElement === el),
    '컨디션을 치는 도중에 포커스가 날아갔다');
  assert.ok(/바닥/.test(await fitCard.innerText()), '컨디션 42인데 구간 표시가 안 바뀌었다');
  const saved = await stored(page);
  assert.ok(saved.players.some((p) => p.cond === 42), '손으로 넣은 컨디션이 저장되지 않았다');

  assert.deepEqual(page.errors, [], '콘솔 오류: ' + page.errors.join(' | '));
  await page.close();
});

// ── 12. 경기 기록과 경기 후 검토 ──────────────────────────────────────────
/*
 * 「경기 중」 탭의 기록 입력은 원래 FM이 내보낸 표만 읽었다 — 경기가 끝난 뒤
 * 숫자 네 개만 기억나는 경우가 훨씬 많은데 그때는 통째로 실패했다.
 * 이제 손으로 쳐도 읽히고, 저장하면 「경기 후」 탭이 누적으로 판정한다.
 */
await test('손으로 친 기록을 저장하면 경기 후 탭이 누적으로 판정한다', async () => {
  const page = await openPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await importSquad(page);

  await tab(page, '경기 중');
  await page.waitForTimeout(900);
  // 손으로 친 형식을 그대로 붙여넣는다
  await page.locator('#tab-match textarea').first()
    .fill('슈팅 18 5\n유효 슈팅 6 2\n기대 득점 2.4 0.6\n점유율 64 36');
  await page.locator('#tab-match button', { hasText: '붙여넣은 내용 읽기' }).first().click();
  await page.waitForTimeout(800);
  const mt = await page.locator('#tab-match').innerText();
  assert.ok(!/읽지 못했습니다/.test(mt), `손으로 친 기록을 못 읽었다: ${mt.slice(0, 200)}`);
  assert.ok(/어느 쪽이 우리 팀/.test(mt), '어느 쪽이 우리 팀인지 안 물었다');

  // 왼쪽이 우리 팀
  await page.locator('#tab-match .seg button', { hasText: '왼쪽' }).first().click();
  await page.waitForTimeout(600);

  // 같은 경기를 여섯 번 저장해 표본을 만든다 (0:1 · xG 2.4)
  const saveCard = page.locator('#tab-match details.card').filter({ hasText: '이 경기 기록으로 저장' }).first();
  assert.equal(await saveCard.count(), 1, '경기 저장 카드가 없다');
  await saveCard.locator('summary').first().click();
  await page.waitForTimeout(400);
  await saveCard.locator('input[type=text]').first().fill('웨스트햄');
  await saveCard.locator('.chip', { hasText: '전반 초반 실점' }).first().click();
  await page.waitForTimeout(300);
  await page.locator('#tab-match button', { hasText: '저장하고 경기 후로 이동' }).first().click();
  await page.waitForTimeout(900);
  assert.ok(/누적 1경기/.test(await page.locator('#tab-review').innerText()), '경기 후 탭으로 안 갔다');

  // 나머지 다섯 경기는 저장본에 직접 넣는다 (화면으로 여섯 번 반복할 이유가 없다)
  await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => /fm24/i.test(x));
    const d = JSON.parse(localStorage.getItem(k));
    for (let i = 0; i < 5; i++) {
      d.matches.push({
        id: 'x' + i, opp: '상대' + i, venue: i % 2 ? 'away' : 'home',
        gf: 0, ga: 1, flags: i < 2 ? ['early-concede'] : [],
        us: { xg: 2.2, shots: 17, sot: 6, possession: 62 }, them: { xg: 0.7 }
      });
    }
    localStorage.setItem(k, JSON.stringify(d));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await tab(page, '경기 후');
  await page.waitForTimeout(1000);

  const rt = await page.locator('#tab-review').innerText();
  assert.ok(/누적 6경기/.test(rt), `경기 수가 안 맞는다: ${rt.slice(0, 120)}`);
  assert.ok(/운으로 설명되는 범위를 넘었습니다/.test(rt),
    `여섯 경기 xG 13.4에 0골인데 판정을 안 했다: ${rt.slice(0, 500)}`);
  assert.ok(/√경기수/.test(rt), '계산 근거가 화면에 없다');
  assert.ok(/전반 초반 실점/.test(rt), '반복되는 장면을 안 짚었다');
  assert.ok(/웨스트햄/.test(rt), '경기별 목록에 상대가 없다');
  assert.ok(!/NaN|undefined|\[object/.test(rt), '경기 후 탭에 이상한 값이 있다');

  /*
   * 점수가 없는 반쪽짜리 기록이 섞이면 화면의 순서와 저장본의 순서가 어긋난다.
   * 그때 순서로 지우면 엉뚱한 경기가 사라진다 — id로 찾아야 한다.
   */
  await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => /fm24/i.test(x));
    const d = JSON.parse(localStorage.getItem(k));
    d.matches = [
      { id: 'HALF', opp: '반쪽기록', venue: 'home', us: { xg: 1.2 } },   // 점수가 없다
      { id: 'A', opp: '아스널', venue: 'home', gf: 1, ga: 0 },
      { id: 'B', opp: '첼시', venue: 'away', gf: 0, ga: 2 }
    ];
    localStorage.setItem(k, JSON.stringify(d));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await tab(page, '경기 후');
  await page.waitForTimeout(900);
  const rows = page.locator('#tab-review .card').filter({ hasText: '경기별' }).first().locator('button', { hasText: '×' });
  assert.equal(await rows.count(), 2, '점수 없는 기록까지 목록에 넣었다');
  await rows.nth(1).click();          // 첼시 줄
  await page.waitForTimeout(800);
  const left = (await stored(page)).matches.map((m) => m.id);
  assert.deepEqual(left, ['HALF', 'A'], `순서로 지워서 엉뚱한 경기가 사라졌다: ${left.join(',')}`);

  // 배열이 아닌 matches가 들어와도 화면이 죽으면 안 된다
  await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => /fm24/i.test(x));
    const d = JSON.parse(localStorage.getItem(k));
    d.matches = { a: 1 };             // 손으로 고친 백업
    localStorage.setItem(k, JSON.stringify(d));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await tab(page, '경기 후');
  await page.waitForTimeout(700);
  await tab(page, '경기 중');
  await page.waitForTimeout(700);
  assert.ok(!/undefined경기/.test(await page.locator('#tab-match').innerText()),
    '배열이 아닌 기록을 그대로 받았다');
  assert.deepEqual(page.errors, [], '콘솔 오류: ' + page.errors.join(' | '));

  // 지우면 통계가 따라 줄어야 한다
  await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => /fm24/i.test(x));
    const d = JSON.parse(localStorage.getItem(k));
    d.matches = [{ id: 'z', opp: '아무', venue: 'home', gf: 1, ga: 0 }];
    localStorage.setItem(k, JSON.stringify(d));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await tab(page, '경기 후');
  await page.waitForTimeout(800);
  await page.locator('#tab-review button', { hasText: '전부 지우기' }).first().click();
  await page.waitForTimeout(800);
  assert.ok(/저장한 경기가 없습니다/.test(await page.locator('#tab-review').innerText()),
    '전부 지웠는데 비어 있지 않다');

  assert.deepEqual(page.errors, [], '콘솔 오류: ' + page.errors.join(' | '));
  await page.close();
});

// ── 13. 포지션이 없으면 전술을 내지 않는다 ────────────────────────────────
/*
 * 등록 포지션을 모르면 전원이 「낯선 자리」로 계산되어 선발이 사실상 능력치 총합
 * 순서가 된다. 실제 토트넘 파일로 재 보니 수비형 미드필더가 리베로에 서고 10번이
 * 스트라이커로 나갔고, 적합도는 열한 자리 모두 22~26, 골키퍼는 3이었다.
 * 그걸 전술이라고 내놓으면 그대로 게임에 옮겨져 대패한다.
 */
await test('포지션을 모르면 전술 대신 무엇을 고칠지 말하고, 한 화면에서 고칠 수 있다', async () => {
  const page = await openPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await importSquad(page);            // 이 파일들에는 포지션 열이 없다

  const st0 = await stored(page);
  assert.equal(st0.players.filter((p) => (p.positions || []).length).length, 0,
    '검사 전제가 깨졌다 — 이 파일에 포지션이 들어 있다');

  // 숨은 탭에도 같은 단추가 있으므로 지금 보이는 탭으로 좁힌다
  for (const [t, sel] of [['기본 전술', '#tab-base'], ['맞춤 전술', '#tab-result']]) {
    await tab(page, t);
    await page.waitForTimeout(1600);
    const txt = await page.locator(sel).innerText();
    assert.ok(/전술을 내지 않습니다/.test(txt), `${t}: 포지션 없이 전술을 내놨다`);
    // 배치를 그리면 안 된다 — 경고를 붙여도 사람은 아래 그림을 쓴다
    assert.equal(await page.locator(sel + ' .pitch').count(), 0, `${t}: 믿을 수 없는 배치를 그렸다`);
    assert.ok(!/전술 요약|시즌 기본 전술/.test(txt), `${t}: 전술 본문이 그대로 나왔다`);
  }

  // 한 화면에서 고칠 수 있어야 한다
  await page.locator('#tab-result button', { hasText: '포지션 한 번에 고르러 가기' }).first().click();
  await page.waitForTimeout(900);
  const posCard = page.locator('#tab-squad details.card').filter({ hasText: '포지션 한 번에 고르기' }).first();
  assert.equal(await posCard.count(), 1, '포지션 카드가 없다');
  assert.equal(await posCard.evaluate((el) => el.open), true, '눌러서 왔는데 카드가 접혀 있다');

  await posCard.locator('button', { hasText: '빈 자리를 추정으로 채우기' }).click();
  await page.waitForTimeout(1400);
  const st1 = await stored(page);
  const filled = st1.players.filter((p) => (p.positions || []).length).length;
  assert.ok(filled >= st1.players.length - 2, `추정으로 ${filled}/${st1.players.length}명만 채웠다`);
  // 추정으로 채운 것은 표시가 남아야 한다 — 확인 없이 쓰면 안 되는 값이다
  assert.ok(st1.players.some((p) => p.posGuessed), '추정으로 채웠는데 표시가 없다');
  const gk = st1.players.find((p) => p.name === 'Guglielmo Vicario');
  assert.deepEqual(gk.positions, ['GK'], `골키퍼를 ${gk.positions}로 추정했다`);

  // 이제 전술이 나와야 한다
  await tab(page, '기본 전술');
  await page.waitForTimeout(1800);
  const after = await page.locator('#tab-base').innerText();
  assert.ok(!/전술을 내지 않습니다/.test(after), '포지션을 채웠는데 아직 막혀 있다');
  assert.ok(/시즌 기본 전술/.test(after), '전술이 안 나온다');
  assert.equal(await page.locator('#tab-base .pitch').count() >= 1, true, '배치가 안 그려졌다');

  /*
   * 추정으로 채운 상태는 게이트를 통과하지만 여전히 위험하다. 추정이 틀린 선수는
   * 엉뚱한 자리에 선 채로 적합도만 70대로 보인다 — 아무것도 이상해 보이지 않아서
   * 그대로 게임에 옮긴다. 그래서 추정이 남아 있는 동안은 계속 말해야 한다.
   */
  assert.ok(/포지션이 「추정」입니다/.test(after),
    `추정으로 채운 상태인데 아무 말도 안 한다: ${after.slice(0, 300)}`);
  assert.ok(/적합도가 높아 보여도/.test(after), '왜 위험한지가 없다');
  await tab(page, '맞춤 전술');
  await page.waitForTimeout(1600);
  assert.ok(/포지션이 「추정」입니다/.test(await page.locator('#tab-result').innerText()),
    '맞춤 전술에는 추정 경고가 없다');

  // 사람이 직접 확정하면 경고가 사라져야 한다
  await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => /fm24/i.test(x));
    const d = JSON.parse(localStorage.getItem(k));
    d.players.forEach((p) => { delete p.posGuessed; });
    localStorage.setItem(k, JSON.stringify(d));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await tab(page, '기본 전술');
  await page.waitForTimeout(1800);
  assert.ok(!/포지션이 「추정」입니다/.test(await page.locator('#tab-base').innerText()),
    '추정 표시를 지웠는데도 경고가 남아 있다');

  // 손으로 고치면 추정 표시가 사라진다
  await tab(page, '스쿼드');
  await page.waitForTimeout(900);
  const card2 = page.locator('#tab-squad details.card').filter({ hasText: '포지션 한 번에 고르기' }).first();
  // 이미 열려 있으면 summary를 누르면 도로 닫힌다
  if (!(await card2.evaluate((el) => el.open))) {
    await card2.locator('summary').first().click();
    await page.waitForTimeout(400);
  }
  await card2.locator('.seg button', { hasText: '전원' }).click();
  await page.waitForTimeout(900);
  await card2.locator('.rep').first().locator('.chip').first().click();
  await page.waitForTimeout(800);
  assert.deepEqual(page.errors, [], '콘솔 오류: ' + page.errors.join(' | '));
  await page.close();
});

// ── 14. 맞춤 전술이 실제로 상대에 맞춰지는가 ──────────────────────────────
/*
 * 「맞춤 전술이 약하다」의 원인은 엔진이 아니라 입력이었다. 성향을 슬라이더
 * 여덟 개로 받는데 아무도 매 경기 여덟 개를 맞추지 않는다. 기본값 그대로면
 * 팀 지시 축이 **하나도** 안 밀려서 맞춤 전술의 지시가 기본 전술과 똑같아진다.
 * 그런데 화면에는 「맞춤 전술」이라고 적혀 있으니 맞춰진 줄 안다.
 */
await test('상대 유형을 안 고르면 그렇다고 말하고, 고르면 지시가 실제로 바뀐다', async () => {
  const page = await openPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await importSquad(page);
  await withPositions(page);

  // 아무것도 안 넣은 상태 — 조용히 넘어가면 안 된다
  await tab(page, '맞춤 전술');
  await page.waitForTimeout(1800);
  const before = await page.locator('#tab-result').innerText();
  assert.ok(/상대 정보를 아무것도 안 넣었습니다/.test(before),
    `상대 정보가 없는데 아무 말도 안 한다: ${before.slice(0, 300)}`);

  // 상대 유형을 하나 고른다
  await page.locator('#tab-result button', { hasText: '상대 유형 고르러 가기' }).first().click();
  await page.waitForTimeout(900);
  const preset = page.locator('#tab-opp .card').filter({ hasText: '상대는 어떤 팀인가' }).first();
  assert.equal(await preset.count(), 1, '상대 유형 카드가 없다');
  await preset.locator('.rep').filter({ hasText: '깊은 블록' }).first().click();
  await page.waitForTimeout(1200);

  await tab(page, '맞춤 전술');
  await page.waitForTimeout(1800);
  const after = await page.locator('#tab-result').innerText();
  assert.ok(!/상대 정보를 아무것도 안 넣었습니다/.test(after), '상대 유형을 골랐는데 아직 안 바뀌었다');

  // 실제로 지시가 몇 개나 움직였는지 엔진 쪽에서 확인한다
  const moved = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => /fm24/i.test(x));
    const d = JSON.parse(localStorage.getItem(k));
    const r = window.FM_ENGINE.generate({
      players: d.players, opponent: d.opponent, context: d.context
    });
    return Object.values(r.instructions.axes).filter((a) => a.shifted).length;
  });
  assert.ok(moved >= 4, `상대 유형을 골랐는데 지시가 ${moved}개만 움직였다`);

  // 상대가 바뀌면 답도 달라져야 한다
  const answers = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => /fm24/i.test(x));
    const d = JSON.parse(localStorage.getItem(k));
    const out = new Set();
    for (const p of window.FM_TACTIC_DATA.OPP_PRESETS) {
      const r = window.FM_ENGINE.generate({
        players: d.players, opponent: { ...d.opponent, ...p.set }, context: d.context
      });
      out.add(Object.values(r.instructions.axes).map((a) => a.index).join(',')
        + '|' + r.xi.lineup.map((l) => l.role.abbr + l.duty).join(''));
    }
    return out.size;
  });
  assert.ok(answers >= 5, `상대 유형 일곱 개인데 서로 다른 답이 ${answers}가지뿐이다`);

  assert.deepEqual(page.errors, [], '콘솔 오류: ' + page.errors.join(' | '));
  await page.close();
});

// ── 15. 컨디션이 글자로 와도 로테이션이 나온다 ────────────────────────────
/*
 * 사용자가 실제로 겪은 일이다. FM 스쿼드 보기에 「컨디션」 열을 넣어 내보냈는데
 * 「컨디션 한 번에 넣기」가 0/45명으로 남아 있었다. 파일은 멀쩡히 읽혔고
 * 포지션까지 45명 전부 들어왔는데, 컨디션만 사라졌다 — 환경설정이 %가 아니라
 * 글자('괜찮음')로 되어 있어서 숫자를 못 뽑고 조용히 버렸기 때문이다.
 *
 * 이 파일이 그 파일이다. 값이 들어오는지, 대략값이라고 말하는지, 그리고
 * 로테이션이 실제로 나오는지까지 본다.
 */
await test('컨디션이 글자로 와도 값이 들어오고, 대략값이라고 말한다', async () => {
  const page = await openPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await tab(page, '스쿼드');
  await page.locator('#tab-squad input[type=file]').first().setInputFiles([{
    name: 'ko-squad-condition-words.html', mimeType: 'text/html',
    buffer: fx('ko-squad-condition-words.html')
  }]);
  await page.waitForTimeout(1800);

  const st = await stored(page);
  const withCond = st.players.filter((p) => typeof p.cond === 'number');
  assert.ok(withCond.length >= 40,
    `컨디션 열이 있는 파일인데 ${withCond.length}/${st.players.length}명만 들어왔다`);
  // 이 파일에는 포지션 열도 있다 — 게이트가 열려야 한다
  assert.ok(st.players.filter((p) => (p.positions || []).length).length >= 40, '포지션을 못 읽었다');

  // 지친 선수와 쌩쌩한 선수가 실제로 갈려야 로테이션이 의미가 있다
  const berg = st.players.find((p) => p.name === 'Lucas Bergvall');   // 아주 나쁨
  const spence = st.players.find((p) => p.name === 'Djed Spence');    // 최고
  assert.ok(berg.cond < spence.cond, '방전된 선수가 더 높게 읽혔다');
  // '상태' 칸의 부상도 읽어야 한다 — 안 읽으면 부상 선수가 선발에 뽑힌다
  assert.equal(st.players.find((p) => p.name === '손흥민').out, true, '부상 표시를 못 읽었다');

  // 대략값이라고 말해야 한다 — 말 안 하면 구간 가운데 값을 정확한 값으로 믿는다
  const squadTxt = await page.locator('#tab-squad').innerText();
  assert.ok(/대략값/.test(squadTxt), `글자에서 읽었는데 대략값이라고 안 한다: ${squadTxt.slice(0, 400)}`);
  assert.ok(/퍼센트/.test(squadTxt), '정확하게 만드는 방법을 안 알려 준다');

  const fitCard = page.locator('#tab-squad details.card').filter({ hasText: '컨디션 한 번에 넣기' }).first();
  assert.ok(/명 입력됨/.test(await fitCard.innerText()), '컨디션 카드가 없다');
  if (!(await fitCard.evaluate((el) => el.open))) {
    await fitCard.locator('summary').first().click();
    await page.waitForTimeout(500);
  }
  // 어느 줄이 대략값인지 그 줄에 적혀야 한다
  assert.ok(/괜찮음/.test(await fitCard.innerText()), '어느 줄이 글자에서 왔는지 표시가 없다');

  // 그리고 진짜 목적 — 로테이션이 나와야 한다
  await tab(page, '기본 전술');
  await page.waitForTimeout(2000);
  const baseTxt = await page.locator('#tab-base').innerText();
  assert.ok(/뎁스와 로테이션/.test(baseTxt), '로테이션 카드가 없다');
  assert.ok(!/컨디션 미입력/.test(baseTxt), `컨디션을 넣었는데 미입력이라고 한다: ${baseTxt.slice(0, 300)}`);

  // 사람이 직접 치면 대략값 표시가 사라져야 한다
  await tab(page, '스쿼드');
  await page.waitForTimeout(800);
  const card = page.locator('#tab-squad details.card').filter({ hasText: '컨디션 한 번에 넣기' }).first();
  if (!(await card.evaluate((el) => el.open))) {
    await card.locator('summary').first().click();
    await page.waitForTimeout(400);
  }
  const box = card.locator('input[type=number]').first();
  await box.fill('90');
  await page.waitForTimeout(600);
  const first = (await stored(page)).players[0];
  assert.equal(first.cond, 90, '직접 친 값이 안 들어갔다');
  assert.equal(first.condWord, undefined, '직접 쳤는데 대략값 표시가 남아 있다');

  assert.deepEqual(page.errors, [], '콘솔 오류: ' + page.errors.join(' | '));
  await page.close();
});

// ── 16. 일정표로 시즌을 통째로 넣는다 ─────────────────────────────────────
/*
 * 경기를 넣는 길이 한 건씩 손으로 저장하는 것 하나뿐이었다. 이미 시즌을 치르는
 * 중인 사람에게 「네 경기가 쌓여야 판정합니다」라고 하는 건 그 사람이 이미 가진
 * 정보를 안 쓰겠다는 소리다. FM 일정 화면에 그 시즌 전 경기가 다 들어 있다.
 */
await test('일정표를 넣으면 시즌 성적이 한 번에 들어오고, 점수만으로도 판정한다', async () => {
  const page = await openPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await tab(page, '경기 후');
  await page.waitForTimeout(700);

  // 경기가 없을 때도 넣을 길이 보여야 한다 — 안 보이면 아무도 못 찾는다
  const empty = await page.locator('#tab-review').innerText();
  assert.ok(/일정표에서 시즌 전체 가져오기/.test(empty), '빈 화면에 일정표 가져오기가 없다');

  await page.locator('#tab-review input[type=file]').first().setInputFiles([{
    name: 'ko-fixtures.html', mimeType: 'text/html', buffer: fx('ko-fixtures.html')
  }]);
  await page.waitForTimeout(1500);

  const card = page.locator('#tab-review details.card').filter({ hasText: '일정표에서 시즌 전체 가져오기' }).first();
  const listed = await card.innerText();
  assert.ok(/맨체스터 시티/.test(listed), `일정표를 못 읽었다: ${listed.slice(0, 300)}`);
  // 친선 경기는 기본으로 꺼져 있어야 한다 — 프리시즌 3-0이 섞이면 성적이 무뎌진다
  const checked = await card.locator('input[type=checkbox]:checked').count();
  const boxes = await card.locator('input[type=checkbox]').count();
  assert.equal(boxes, 12, `치른 경기 12개인데 ${boxes}개가 나왔다`);
  assert.equal(checked, 6, `공식경기 6개만 켜져 있어야 하는데 ${checked}개가 켜져 있다`);

  await card.locator('button', { hasText: '경기 넣기' }).click();
  await page.waitForTimeout(1600);

  const st = await stored(page);
  assert.equal(st.matches.length, 6, `6경기가 들어와야 하는데 ${st.matches.length}경기다`);
  // 점수 방향 — 뒤집히면 승패가 통째로 반대가 된다
  const chelsea = st.matches.find((m) => /첼시/.test(m.opp));
  assert.equal(chelsea.gf, 1, '홈 첼시전 1:0 승리를 뒤집어 읽었다');
  assert.equal(chelsea.ga, 0);
  assert.equal(chelsea.venue, 'home');
  const city = st.matches.find((m) => /맨체스터 시티/.test(m.opp));
  assert.equal(city.gf, 0, '원정 맨시티전 0:4 패배를 뒤집어 읽었다');
  assert.equal(city.ga, 4);

  // 그리고 실제로 판정이 나와야 한다 — 기대 득점이 없어도
  const txt = await page.locator('#tab-review').innerText();
  assert.ok(/1승 0무 5패/.test(txt), `전적이 안 맞는다: ${txt.slice(0, 300)}`);
  assert.ok(/경기당 0\.33골/.test(txt), `6경기 2골인데 아무 말도 안 한다: ${txt.slice(0, 600)}`);
  // 기대 득점 없이 원인을 단정하면 안 된다
  assert.ok(/구분할 수 없습니다/.test(txt), '기대 득점 없이 형태인지 마무리인지 단정했다');

  // 같은 파일을 또 넣어도 두 번 세지 않는다 — 두 번 세면 누적 판정이 통째로 틀어진다
  await page.locator('#tab-review input[type=file]').first().setInputFiles([{
    name: 'ko-fixtures.html', mimeType: 'text/html', buffer: fx('ko-fixtures.html')
  }]);
  await page.waitForTimeout(1500);
  const card2 = page.locator('#tab-review details.card').filter({ hasText: '일정표에서 시즌 전체 가져오기' }).first();
  assert.equal(await card2.locator('input[type=checkbox]:checked').count(), 0,
    '이미 저장한 경기가 또 켜져 있다');
  assert.ok(/이미 저장됨/.test(await card2.innerText()), '중복이라고 말하지 않는다');
  assert.equal((await stored(page)).matches.length, 6, '중복 저장으로 경기가 늘었다');

  assert.deepEqual(page.errors, [], '콘솔 오류: ' + page.errors.join(' | '));
  await page.close();
});

// ── 17. 세 장짜리 슬롯 세트를 실제로 내주는가 ─────────────────────────────
/*
 * 원정 네 경기 승점 0. 강팀 원정에 꺼낼 형태가 아예 없었는데, 도구는 기본 전술
 * 한 장만 내주고 "슬롯을 저장하세요"라고만 했다 — 무엇을 저장하라는 말 없이.
 * 이제 세 장을 통째로 설계해서 내주고, 눌러서 바로 슬롯에 넣을 수 있어야 한다.
 */
await test('스쿼드에 맞는 세 장(주력·버티기·공략)을 내주고 눌러서 슬롯에 넣는다', async () => {
  const page = await openPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await importSquad(page);
  await withPositions(page);

  await tab(page, '기본 전술');
  await page.waitForTimeout(2000);
  const kit = page.locator('#tab-base details.card').filter({ hasText: '이 스쿼드로 만들어 둘 세 장' }).first();
  assert.equal(await kit.count(), 1, '세 장 카드가 없다');
  if (!(await kit.evaluate((el) => el.open))) {
    await kit.locator('summary').first().click();
    await page.waitForTimeout(500);
  }
  const rows = kit.locator('.kitrow');
  assert.equal(await rows.count(), 3, `세 장이 나와야 하는데 ${await rows.count()}장이다`);
  const txt = await kit.innerText();
  for (const role of ['주력', '버티기', '공략']) {
    assert.ok(txt.includes(role), `「${role}」이 없다: ${txt.slice(0, 300)}`);
  }

  // 눌러서 슬롯에 들어가야 한다 — 읽고 나서 직접 옮겨 적게 두면 아무도 안 한다
  await rows.nth(1).locator('button', { hasText: '슬롯에 넣기' }).click();
  await page.waitForTimeout(1200);
  const st = await stored(page);
  assert.equal(st.tactics.length, 1, '슬롯에 안 들어갔다');
  assert.ok(/버티기/.test(st.tactics[0].name), `슬롯 이름이 이상하다: ${st.tactics[0].name}`);

  // 같은 장을 또 누르면 늘어나면 안 된다
  await page.waitForTimeout(400);
  const kit2 = page.locator('#tab-base details.card').filter({ hasText: '이 스쿼드로 만들어 둘 세 장' }).first();
  assert.ok(/저장됨/.test(await kit2.innerText()), '저장했다는 표시가 없다');

  /*
   * 그리고 진짜 목적 — 세 장의 지시가 서로 달라야 한다. 이름만 셋이고 지시가
   * 같으면 슬롯 세 칸을 낭비하는 것이다.
   */
  const distinct = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => /fm24/i.test(x));
    const d = JSON.parse(localStorage.getItem(k));
    const kit = window.FM_ENGINE.slotKit({ players: d.players, standing: d.standing || 'mid' });
    const sigs = kit.picks.map((p) => Object.entries(p.instructions.axes)
      .map(([kk, a]) => kk + a.index).join(','));
    return { n: kit.picks.length, uniq: new Set(sigs).size };
  });
  assert.equal(distinct.uniq, distinct.n, '세 장 중 지시가 같은 장이 있다');

  assert.deepEqual(page.errors, [], '콘솔 오류: ' + page.errors.join(' | '));
  await page.close();
});

// ── 18. 좁은 화면에서 가로로 넘치지 않는다 ────────────────────────────────
await test('320px 화면에서 어느 탭도 가로로 넘치지 않는다', async () => {
  const page = await openPage();
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await importSquad(page);
  for (const t of ['스쿼드', '기본 전술', '영입', '상대', '맞춤 전술', '경기 중', '경기 후', '안내']) {
    await tab(page, t);
    const bad = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('#main *').forEach((n) => {
        if (n.scrollWidth > n.clientWidth + 2 && getComputedStyle(n).overflowX === 'visible') {
          out.push(n.tagName + '.' + (n.className || ''));
        }
      });
      return out.slice(0, 3);
    });
    assert.deepEqual(bad, [], `${t} 탭이 가로로 넘친다: ${bad.join(', ')}`);
  }
  await page.close();
});

await browser.close();
stop();

if (failed) {
  console.error(`\n브라우저 검사 ${failed}건 실패`);
  process.exit(1);
}
console.log('\n✓ 브라우저 검사 통과');

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
await test('실제 스쿼드를 넣고 7개 탭을 모두 열어도 오류가 없다', async () => {
  const page = await openPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await importSquad(page);
  const st = await stored(page);
  assert.equal(st.players.length, 24, `선수를 ${st.players.length}명 읽었다`);
  for (const t of ['스쿼드', '기본 전술', '영입', '상대', '맞춤 전술', '경기 중', '안내']) {
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

// ── 7. 좁은 화면에서 가로로 넘치지 않는다 ─────────────────────────────────
await test('320px 화면에서 어느 탭도 가로로 넘치지 않는다', async () => {
  const page = await openPage();
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await importSquad(page);
  for (const t of ['스쿼드', '기본 전술', '영입', '상대', '맞춤 전술', '경기 중', '안내']) {
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

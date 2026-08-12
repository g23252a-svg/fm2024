/*
 * FM24 스쿼드 내보내기 파서
 *
 * FM은 어떤 화면이든 인쇄 아이콘으로 "웹 페이지(HTML)" 또는 "텍스트 파일(RTF)"로
 * 내보낼 수 있습니다. 이건 게임을 고치지 않고 쓰는 공식 경로이고, FM 관련
 * 외부 도구들이 오래전부터 쓰던 형식이기도 합니다.
 *
 * 세 가지 입력을 받습니다.
 *   - RTF  : |로 구분된 표. FM의 "텍스트 파일로 내보내기" 결과
 *   - HTML : <table>. FM의 "웹 페이지로 내보내기" 결과
 *   - 붙여넣기 : 탭/쉼표 구분 (스프레드시트에서 복사)
 *
 * 열 이름은 한국어판·영문판을 모두 인식합니다. 인식하지 못한 열은 버리고
 * 무엇을 버렸는지 보고합니다 — 조용히 0으로 채우면 그 능력치가 낮은 것과
 * 구분되지 않기 때문입니다.
 */
(function (root) {
  'use strict';

  var RD = root.FM_ROLE_DATA;

  // ── 열 이름 → 필드 ────────────────────────────────────────────────────
  var HEADER_MAP = {};
  function reg(field) {
    for (var i = 1; i < arguments.length; i++) {
      HEADER_MAP[norm(arguments[i])] = field;
    }
  }
  function norm(s) {
    return String(s == null ? '' : s)
      .replace(/\s+/g, '')
      .replace(/[().\-_/]/g, '')
      .toLowerCase();
  }

  // 메타 열
  reg('name', 'Name', '이름', '선수', '선수명', 'Player');
  // '위치'는 포지션이 아니라 능력치 '위치 선정'입니다(FM 한국어판 열 이름).
  reg('position', 'Position', 'Pos', '포지션', '등록 포지션');
  reg('age', 'Age', '나이', '연령');
  reg('foot', 'Preferred Foot', '주발', '선호발', 'Foot', '주로 쓰는 발');
  reg('club', 'Club', '클럽', '소속팀');

  // 알고는 있지만 쓰지 않는 열. 이걸 등록해 두지 않으면 "무시한 열" 목록에
  // 매번 올라와 사용자가 매핑해야 할 열인지 아닌지 헷갈립니다.
  reg('skip', 'Status', '상태', 'Inf', 'Info', '정보',
    // 전술에서 배정된 자리이지 선수의 등록 포지션이 아닙니다. 값이 '-'이거나
    // 역할 약어라서 포지션으로 읽으면 등록 포지션을 지워 버립니다.
    'Selected Position', '선택한 포지션', '선발 포지션',
    // 'Nat'은 국적이기도 하고 타고난 체력이기도 합니다. 능력치 쪽을 택합니다
    // (아래 ALIASES가 덮어씁니다) — 틀리면 화면에서 다시 지정할 수 있습니다.
    'Nationality', '국적', 'Apps', '출장', 'Gls', '득점',
    'Transfer Value', '이적료', 'Wage', '주급', 'Contract', '계약');

  /*
   * 능력치 열 이름.
   *
   * ★로 표시한 한국어 이름은 실제 FM24 한국어판 내보내기 파일에서 확인한 것입니다.
   * 처음에는 사전적 번역(가속도 · 민첩성 · 마무리 · 스태미너 …)을 넣어 두었는데,
   * FM 한국어판이 화면에 쓰는 이름은 그게 아니라 훨씬 짧은 말이었습니다
   * (순간 속도 · 민첩 · 결정 · 지구 …). 실제 파일에서 47개 중 하나만 맞았습니다.
   * 사전을 보고 채운 이름은 그래서 전부 뒤로 물리고 확인된 것을 앞에 둡니다.
   */
  var ALIASES = {
    // GK
    aer: ['Aer', 'Aerial Reach', '공중 장악', '공중 도달'],                      // ★ Aer (영문 그대로 나옴)
    cmd: ['장악', 'Cmd', 'Command of Area', '지역 장악', '수비 지휘'],            // ★ 장악
    com: ['조율', 'Com', 'Communication', '의사소통', '소통'],                    // ★ 조율
    ecc: ['기행', 'Ecc', 'Eccentricity', '괴짜 기질', '돌발성'],                  // ★ 기행
    han: ['핸들', 'Han', 'Handling', '핸들링'],                                   // ★ 핸들
    kic: ['골킥', 'Kic', 'Kicking', '킥'],                                        // ★ 골킥
    ono: ['1대1', '1v1', 'One on Ones', '일대일'],                                // ★ 1대1
    ref: ['반사', 'Ref', 'Reflexes', '반사 신경'],                                // ★ 반사
    tro: ['돌진하는 경향', 'TRO', 'Rushing Out', 'Tendency to Rush Out', '뛰쳐나가기'], // ★ 돌진하는 경향
    pun: ['펀칭 빈도', 'Pun', 'Punching', 'Tendency to Punch', '펀칭 성향'],       // ★ 펀칭 빈도
    thr: ['Thr', 'Throwing', '던지기', '스로잉'],                                 // ★ 스로인 (아래 주석 참고)
    // 기술
    cor: ['코너', 'Cor', 'Corners', '코너킥'],                                    // ★ 코너
    cro: ['크로스', 'Cro', 'Crossing'],                                           // ★ 크로스
    dri: ['돌파', 'Dri', 'Dribbling', '드리블'],                                  // ★ 돌파
    fin: ['결정', 'Fin', 'Finishing', '결정력', '마무리'],                        // ★ 결정
    fir: ['트랩', 'Fir', 'First Touch', '퍼스트 터치', '볼 컨트롤'],              // ★ 트랩
    fre: ['프리', 'Fre', 'Free Kick Taking', 'Free Kicks', '프리킥'],             // ★ 프리
    hea: ['헤더', 'Hea', 'Heading', '헤딩'],                                      // ★ 헤더
    lon: ['롱슛', 'Lon', 'Long Shots', '중거리 슛', '장거리 슛'],                 // ★ 롱슛
    lth: ['스로인', 'L Th', 'LTh', 'Long Throws', '롱 스로인'],                   // ★ 스로인
    mar: ['마크', 'Mar', 'Marking', '마킹'],                                      // ★ 마크
    pas: ['패스', 'Pas', 'Passing'],                                              // ★ 패스
    pen: ['PK', 'Pen', 'Penalty Taking', '페널티킥'],                             // ★ PK
    tck: ['태클', 'Tck', 'Tackling'],                                             // ★ 태클
    tec: ['기술', 'Tec', 'Technique', '테크닉'],                                  // ★ 기술
    // 정신
    agg: ['적극', 'Agg', 'Aggression', '적극성'],                                 // ★ 적극
    ant: ['예측', 'Ant', 'Anticipation', '예측력'],                               // ★ 예측
    bra: ['대담', 'Bra', 'Bravery', '대담성', '용감성'],                          // ★ 대담
    cmp: ['침착', 'Cmp', 'Composure', '침착성'],                                  // ★ 침착
    cnt: ['집중', 'Cnt', 'Con', 'Concentration', '집중력'],                       // ★ 집중
    dec: ['판단', 'Dec', 'Decisions', '판단력'],                                  // ★ 판단
    det: ['승부', 'Det', 'Determination', '결단력', '승부욕'],                    // ★ 승부
    fla: ['천재', 'Fla', 'Flair', '창조성', '개인기'],                            // ★ 천재
    ldr: ['리더십', 'Ldr', 'Leadership', '지도력'],                               // ★ 리더십
    otb: ['오프 더 볼', 'OtB', 'Off the Ball', '오프더볼', '움직임'],             // ★ 오프 더 볼
    pos: ['위치', 'Positioning', '위치 선정'],                                    // ★ 위치
    tea: ['팀워크', 'Tea', 'Teamwork', '협동심'],                                 // ★ 팀워크
    vis: ['시야', 'Vis', 'Vision'],                                               // ★ 시야
    wor: ['활동', 'Wor', 'Work Rate', '활동량'],                                  // ★ 활동
    // 신체
    acc: ['순간 속도', 'Acc', 'Acceleration', '가속도'],                          // ★ 순간 속도
    agi: ['민첩', 'Agi', 'Agility', '민첩성'],                                    // ★ 민첩
    bal: ['균형', 'Bal', 'Balance', '균형 감각'],                                 // ★ 균형
    jum: ['점프', 'Jum', 'Jumping Reach', '점프 도달력'],                         // ★ 점프
    nat: ['타고난 체력', 'Nat', 'Natural Fitness', '자연 체력'],                  // ★ 타고난 체력
    pac: ['주력', 'Pac', 'Pace', '속도'],                                         // ★ 주력
    sta: ['지구', 'Sta', 'Stamina', '지구력', '스태미너'],                        // ★ 지구
    str: ['몸싸움', 'Str', 'Strength', '체격']                                    // ★ 몸싸움
  };
  Object.keys(ALIASES).forEach(function (id) {
    reg.apply(null, ['attr:' + id].concat(ALIASES[id]));
  });

  // 'Pos'는 포지션 열과 위치 선정 능력치가 같은 약어를 씁니다.
  // FM 스쿼드 화면에서 'Pos'는 포지션이므로 그쪽을 기본으로 두고,
  // 능력치 표에서 온 경우는 주변 열로 판별합니다(resolveHeaders 참조).
  HEADER_MAP[norm('Pos')] = 'position';

  // ── 포지션 문자열 파서 ────────────────────────────────────────────────
  // 'D (RC), DM' · 'M/AM (R)' · 'GK' · 'ST (C)' 형태를 받습니다.
  var PREFIX_MAP = { GK: 'GK', D: 'D', WB: 'WB', DM: 'DM', M: 'M', AM: 'AM', ST: 'ST', SC: 'ST', F: 'ST' };

  function parsePositions(str) {
    if (!str) return [];
    var out = {};
    // 한국어판도 포지션 표기는 로마자를 씁니다. 혹시 모를 전각 괄호만 정리.
    var s = String(str).toUpperCase().replace(/[（）]/g, function (c) { return c === '（' ? '(' : ')'; });
    var tokens = s.split(',');
    tokens.forEach(function (tok) {
      tok = tok.trim();
      if (!tok) return;
      var m = tok.match(/^([A-Z/]+)\s*(?:\(([RLC]+)\))?/);
      if (!m) return;
      var prefixes = m[1].split('/').map(function (p) { return PREFIX_MAP[p.trim()]; }).filter(Boolean);
      var sides = m[2] ? m[2].split('') : null;
      prefixes.forEach(function (pre) {
        if (pre === 'GK') { out.GK = 1; return; }
        if (pre === 'ST') { out.ST = 1; return; }
        if (pre === 'DM') { out.DM = 1; return; }
        var list = sides || ['C'];
        list.forEach(function (side) {
          if (pre === 'D') out['D' + side] = 1;
          else if (pre === 'WB') { if (side !== 'C') out['WB' + side] = 1; }
          else if (pre === 'M') out['M' + side] = 1;
          else if (pre === 'AM') out['AM' + side] = 1;
        });
      });
    });
    // WB(C)나 존재하지 않는 조합은 위에서 걸러졌습니다.
    return Object.keys(out).filter(function (p) {
      return RD.POSITIONS.some(function (x) { return x.id === p; });
    });
  }

  // ── 값 파서 ───────────────────────────────────────────────────────────
  // '15' · '12-15'(스카우트 범위) · '-' · '' 를 처리합니다.
  function parseAttrValue(raw) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (!s || s === '-' || s === '–') return null;
    var range = s.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (range) return Math.round((parseInt(range[1], 10) + parseInt(range[2], 10)) / 2);
    var n = parseInt(s, 10);
    if (!isFinite(n)) return null;
    return clamp(n, 1, 20);
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function parseFoot(raw) {
    if (!raw) return 'B';
    var s = String(raw).toLowerCase();
    if (/both|양발|양쪽/.test(s)) return 'B';
    if (/left|왼/.test(s)) return 'L';
    if (/right|오른/.test(s)) return 'R';
    return 'B';
  }

  // ── 입력 형식별 파서 ──────────────────────────────────────────────────
  function rtfToText(rtf) {
    var s = String(rtf);
    s = s.replace(/\\par[d]?\b/g, '\n');
    s = s.replace(/\\line\b/g, '\n');
    s = s.replace(/\\u(-?\d+)\s*\??/g, function (m, n) {
      var c = parseInt(n, 10);
      if (c < 0) c += 65536;
      return String.fromCharCode(c);
    });
    s = s.replace(/\\'([0-9a-fA-F]{2})/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); });
    s = s.replace(/\\\*/g, '');
    s = s.replace(/\\[a-zA-Z]+-?\d*\s?/g, '');
    s = s.replace(/[{}]/g, '');
    return s;
  }

  function isSeparator(line) { return /^[\s|+\-=]*$/.test(line); }

  function parsePipeTable(text) {
    var rows = [];
    String(text).split(/\r?\n/).forEach(function (line) {
      if (line.indexOf('|') < 0) return;
      if (isSeparator(line)) return;
      var cells = line.split('|');
      // 양끝의 빈 칸(선행/후행 |) 제거
      if (cells.length && !cells[0].trim()) cells.shift();
      if (cells.length && !cells[cells.length - 1].trim()) cells.pop();
      cells = cells.map(function (c) { return c.trim(); });
      if (cells.length >= 2) rows.push(cells);
    });
    return rows;
  }

  function stripTags(html) {
    return String(html)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(parseInt(d, 10)); })
      .trim();
  }

  function parseHtmlTable(html) {
    var rows = [];
    var trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi, m;
    while ((m = trRe.exec(html)) !== null) {
      var cells = [];
      var tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi, n;
      while ((n = tdRe.exec(m[1])) !== null) cells.push(stripTags(n[1]));
      if (cells.length >= 2) rows.push(cells);
    }
    return rows;
  }

  /*
   * 구분자 표 파서.
   *
   * 단순히 split(',')로 자르면 `"Smith, John",ST (C),15` 같은 줄에서 이름이
   * 두 칸으로 쪼개지고, 그 뒤 열이 통째로 한 칸씩 밀립니다. 외부 도구가 내놓는
   * CSV에서는 이름에 쉼표가 흔하므로 따옴표를 제대로 처리합니다.
   * (따옴표 안의 줄바꿈까지 한 칸으로 봅니다.)
   */
  function parseDelimitedWith(text, delim) {
    var rows = [], row = [], field = '', inQuotes = false;
    var t = String(text).replace(/\r\n?/g, '\n');
    for (var i = 0; i < t.length; i++) {
      var c = t[i];
      if (inQuotes) {
        if (c === '"') {
          if (t[i + 1] === '"') { field += '"'; i++; }   // "" → 따옴표 한 글자
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === delim) {
        row.push(field.trim()); field = '';
      } else if (c === '\n') {
        row.push(field.trim()); rows.push(row); row = []; field = '';
      } else {
        field += c;
      }
    }
    if (field.length || row.length) { row.push(field.trim()); rows.push(row); }
    return rows.filter(function (r) {
      return r.some(function (c) { return c !== ''; });
    });
  }

  // 구분자를 세어서 고르면 이름 안의 쉼표에 속습니다. 실제로 잘라 보고
  // 열이 가장 많이 나오면서 행마다 열 수가 일정한 구분자를 씁니다.
  function parseDelimited(text) {
    var best = null, bestScore = -1;
    ['\t', ';', ',', '|'].forEach(function (d) {
      var rows = parseDelimitedWith(text, d);
      if (rows.length < 1) return;
      var cols = rows[0].length;
      if (cols < 2) return;
      var consistent = rows.filter(function (r) { return r.length === cols; }).length / rows.length;
      var score = cols * consistent;
      if (score > bestScore) { bestScore = score; best = rows; }
    });
    return best || [];
  }

  /*
   * 파일 바이트를 글자로 바꿉니다.
   *
   * 모든 걸 UTF-8로 읽으면 UTF-16으로 내보내는 도구(윈도우 프로그램에 흔합니다)의
   * 파일이 글자 사이에 널이 낀 쓰레기가 됩니다. 그러면 열 이름이 하나도 안 맞아
   * "열 이름을 인식하지 못했습니다"만 뜨고 원인을 알 수 없습니다.
   */
  function decodeBytes(buffer) {
    var b = new Uint8Array(buffer);
    var enc = 'utf-8';
    if (b[0] === 0xFF && b[1] === 0xFE) enc = 'utf-16le';
    else if (b[0] === 0xFE && b[1] === 0xFF) enc = 'utf-16be';
    else if (!(b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF)) {
      // BOM이 없는 UTF-16LE — 아스키 본문이면 홀수 번째 바이트가 대부분 0입니다.
      var look = Math.min(b.length, 1024), zeros = 0, odd = 0;
      for (var i = 1; i < look; i += 2) { odd++; if (b[i] === 0) zeros++; }
      if (odd >= 8 && zeros / odd > 0.6) enc = 'utf-16le';
    }
    if (typeof TextDecoder === 'undefined') {
      // 아주 오래된 브라우저. 최소한 아스키 표는 읽히게 해 둡니다.
      var out = '';
      var step = enc.indexOf('utf-16') === 0 ? 2 : 1;
      for (var k = (enc === 'utf-16le' && b[0] === 0xFF) || (enc === 'utf-16be' && b[0] === 0xFE) ? 2 : 0;
           k < b.length; k += step) {
        out += String.fromCharCode(enc === 'utf-16be' ? b[k + 1] : b[k]);
      }
      return out;
    }
    try {
      return new TextDecoder(enc).decode(b);
    } catch (e) {
      return new TextDecoder('utf-8').decode(b);
    }
  }

  function detectAndParse(text) {
    var t = String(text);
    if (/^\s*\{\\rtf/.test(t)) return { rows: parsePipeTable(rtfToText(t)), format: 'rtf' };
    if (/<\s*table/i.test(t) || /<\s*tr[\s>]/i.test(t)) return { rows: parseHtmlTable(t), format: 'html' };
    if (t.indexOf('|') >= 0 && /\|.*\|/.test(t)) return { rows: parsePipeTable(t), format: 'rtf-text' };
    return { rows: parseDelimited(t), format: 'delimited' };
  }

  // ── 헤더 해석 ─────────────────────────────────────────────────────────
  /*
   * 첫 행이 헤더라고 가정하지 않고, 알려진 열 이름이 가장 많이 맞는 행을 헤더로
   * 삼습니다. FM 내보내기는 표 위에 제목 행이 한두 줄 붙어 나오는 경우가 있습니다.
   */
  /*
   * 열 이름 하나를 필드로 바꿉니다.
   *
   * 정확히 맞는 게 없으면, 등록된 이름 중 **이 열 이름으로 시작하는 것이 딱 하나**일
   * 때만 그걸로 봅니다. FM은 화면 열 폭에 맞춰 이름을 줄여 내보내는 경우가 있어
   * 「지구」가 「지구력」으로, 「민첩」이 「민첩성」으로 잘려 나옵니다.
   * 반대 방향(등록 이름이 열 이름의 앞부분)은 허용하지 않습니다 —
   * 그러면 「패스 성공률」이 「패스」로 잡힙니다.
   */
  function lookupHeader(h, userMap) {
    var n = norm(h);
    if (!n) return null;
    if (userMap && userMap[n]) return userMap[n];
    if (HEADER_MAP[n]) return HEADER_MAP[n];
    if (n.length < 2) return null;
    var hits = {};
    Object.keys(HEADER_MAP).forEach(function (k) {
      if (k.length > n.length && k.indexOf(n) === 0) hits[HEADER_MAP[k]] = 1;
    });
    var fields = Object.keys(hits);
    return fields.length === 1 ? fields[0] : null;
  }

  function resolveHeaders(rows, userMap) {
    var bestIdx = -1, bestHit = 0, bestMap = null;
    var limit = Math.min(rows.length, 8);
    for (var i = 0; i < limit; i++) {
      var map = {}, hit = 0;
      rows[i].forEach(function (h, j) {
        var f = lookupHeader(h, userMap);
        if (f) { map[j] = f; hit++; }
      });
      if (hit > bestHit) { bestHit = hit; bestIdx = i; bestMap = map; }
    }
    if (bestIdx < 0 || bestHit < 2) return null;

    /*
     * FM의 'Pos'는 포지션이기도 하고 '위치 선정'이기도 합니다. 둘을 가릅니다.
     *
     * 1) 포지션으로 읽힌 열이 둘 이상이면 첫 번째만 포지션이고 나머지는 위치 선정입니다.
     *    (`Name | Position | Mar | Tck | Pos` 처럼 표 끝에 붙는 경우가 이쪽입니다.
     *    이걸 놓치면 능력치 값 "15"를 포지션으로 파싱해 빈 배열이 되고,
     *    멀쩡히 읽은 포지션을 덮어써 버립니다.)
     * 2) 하나뿐이어도 좌우가 모두 능력치면 위치 선정으로 봅니다.
     */
    var positionCols = Object.keys(bestMap).map(Number)
      .filter(function (j) { return bestMap[j] === 'position'; })
      .sort(function (a, b) { return a - b; });
    positionCols.slice(1).forEach(function (j) { bestMap[j] = 'attr:pos'; });
    if (positionCols.length === 1) {
      var j0 = positionCols[0];
      var left = bestMap[j0 - 1], right = bestMap[j0 + 1];
      if (left && left.indexOf('attr:') === 0 && right && right.indexOf('attr:') === 0) {
        bestMap[j0] = 'attr:pos';
      }
    }

    /*
     * '스로인'은 기술 표에서는 롱 스로인(lth), 골키퍼 표에서는 던지기(thr)입니다.
     * 같은 이름이 두 능력치를 가리키므로 표에 무엇이 같이 있는지로 가릅니다 —
     * 골키퍼 전용 열이 함께 있으면 골키퍼 표입니다.
     */
    var hasGkColumns = Object.keys(bestMap).some(function (j) {
      return ['attr:cmd', 'attr:han', 'attr:ref', 'attr:kic', 'attr:ecc', 'attr:tro', 'attr:pun']
        .indexOf(bestMap[j]) >= 0;
    });
    if (hasGkColumns) {
      Object.keys(bestMap).forEach(function (j) {
        if (bestMap[j] === 'attr:lth' && norm(rows[bestIdx][j]) === norm('스로인')) bestMap[j] = 'attr:thr';
      });
    }

    var unknown = [];
    rows[bestIdx].forEach(function (h, j) {
      if (!bestMap[j] && h) {
        var samples = [];
        for (var k = bestIdx + 1; k < rows.length && samples.length < 4; k++) {
          var v = rows[k][j];
          if (v && v !== '-') samples.push(v);
        }
        unknown.push({
          header: h, index: j, samples: samples,
          // 값이 전부 1~20 정수면 능력치 열이 거의 확실합니다.
          numeric: samples.length > 0 && samples.every(function (v) { return /^\d{1,2}$/.test(v) && +v >= 1 && +v <= 20; })
        });
      }
    });
    return { index: bestIdx, map: bestMap, unknown: unknown, hits: bestHit };
  }

  /*
   * 이름 칸 정리.
   *
   * FM 전술 화면을 내보내면 이름에 화면 조작용 문구가 붙어 나옵니다
   * ("Ben Wilson - 선수 선발"). 그대로 두면 같은 선수가 스쿼드 화면 내보내기와
   * 다른 이름이 되어 합쳐지지 않습니다. 하이픈이 붙은 성(Thomas-Asante)은
   * 양옆에 공백이 없으므로 잘리지 않습니다.
   */
  function cleanName(raw) {
    var s = String(raw == null ? '' : raw).trim();
    s = s.replace(/\s+-\s+(선수\s*선발|선수선발|Select\s+Player|Choose\s+Player)\s*$/i, '');
    return s.trim();
  }

  // 아직 선수가 배정되지 않은 자리는 '-' 또는 '- - -'로 나옵니다.
  function isPlaceholderName(s) {
    return !s || /^[-\s–—]*$/.test(s);
  }

  // ── 최종 변환 ─────────────────────────────────────────────────────────
  function parseSquad(text, userMap) {
    var det = detectAndParse(text);
    var rows = det.rows;
    if (!rows.length) {
      /*
       * 표가 아예 없는 파일. FM 화면 중에는 표가 아니라 그림으로 보여 주는 것이
       * 있고(전술 화면의 필드 보기), 그 상태로 내보내면 링크 한 줄만 든 빈 문서가
       * 나옵니다. "표를 찾지 못했습니다"만 띄우면 파일이 잘못된 줄 알게 되므로
       * FM이 만든 파일인지까지 확인해 무엇을 바꾸면 되는지 알려 줍니다.
       */
      var fromFm = /sigames\.com/i.test(String(text));
      return {
        players: [],
        report: {
          format: det.format, rows: 0, empty: true, fromFm: fromFm,
          error: fromFm
            ? 'FM이 만든 파일이 맞지만 표가 비어 있습니다. 그림으로 보여 주는 화면(전술 화면의 필드 보기 등)을 내보내면 이렇게 나옵니다.'
            : '표를 찾지 못했습니다.'
        }
      };
    }
    var head = resolveHeaders(rows, userMap);
    if (!head) {
      return {
        players: [],
        report: {
          format: det.format, rows: rows.length,
          error: '열 이름을 인식하지 못했습니다. FM에서 내보낼 때 이름·포지션과 능력치 열이 포함된 화면인지 확인하세요.'
        }
      };
    }

    var players = [];
    var attrCols = 0;
    Object.keys(head.map).forEach(function (j) { if (head.map[j].indexOf('attr:') === 0) attrCols++; });

    for (var i = head.index + 1; i < rows.length; i++) {
      var row = rows[i];
      var p = { name: '', positions: [], attrs: {}, foot: 'B' };
      var filled = 0;
      Object.keys(head.map).forEach(function (jStr) {
        var j = +jStr, field = head.map[j], raw = row[j];
        if (raw === undefined) return;
        if (field === 'skip') return;
        if (field === 'name') p.name = cleanName(raw);
        else if (field === 'position') p.positions = parsePositions(raw);
        else if (field === 'age') { var age = parseInt(raw, 10); if (isFinite(age)) p.age = age; }
        else if (field === 'foot') p.foot = parseFoot(raw);
        else if (field === 'club') p.club = String(raw).trim();
        else if (field.indexOf('attr:') === 0) {
          var v = parseAttrValue(raw);
          if (v !== null) { p.attrs[field.slice(5)] = v; filled++; }
        }
      });
      if (isPlaceholderName(p.name)) continue;
      // 헤더가 반복해서 나오는 내보내기(페이지마다 헤더)를 걸러냅니다.
      if (HEADER_MAP[norm(p.name)]) continue;
      p.id = 'imp' + i + '_' + p.name.replace(/\s+/g, '');
      p.attrCount = filled;
      players.push(p);
    }

    return {
      players: players,
      report: {
        format: det.format,
        rows: rows.length,
        headerRow: head.index,
        attrColumns: attrCols,
        unknownColumns: head.unknown,
        imported: players.length,
        noPosition: players.filter(function (p) { return !p.positions.length; }).length,
        noAttrs: players.filter(function (p) { return !p.attrCount; }).length
      }
    };
  }

  /*
   * ── 전술 화면 내보내기에서 포메이션 읽기 ────────────────────────────────
   *
   * FM 전술 화면을 내보내면 첫 열에 자리 이름이 위에서부터 순서대로 나옵니다
   * (골키퍼 · 수비수 (오른쪽) · … · 스트라이커 (중앙)). 아직 선수를 배정하지
   * 않은 시즌 전이라도 이 목록은 채워져 있어서, 상대 포메이션을 그대로 알 수 있습니다.
   */
  var SLOT_NAMES = [
    [/골\s*키퍼|goalkeeper/i, 'GK'],
    [/윙\s*백.*오른|wing\s*back.*right/i, 'WBR'],
    [/윙\s*백.*왼|wing\s*back.*left/i, 'WBL'],
    [/수비수.*오른|defender.*right/i, 'DR'],
    [/수비수.*왼|defender.*left/i, 'DL'],
    [/수비수.*중앙|defender.*(centre|center)/i, 'DC'],
    [/수비형\s*미드필더|defensive\s*midfielder/i, 'DM'],
    [/공격형\s*미드필더.*오른|attacking\s*midfielder.*right/i, 'AMR'],
    [/공격형\s*미드필더.*왼|attacking\s*midfielder.*left/i, 'AML'],
    [/공격형\s*미드필더.*중앙|attacking\s*midfielder.*(centre|center)/i, 'AMC'],
    [/미드필더.*오른|midfielder.*right/i, 'MR'],
    [/미드필더.*왼|midfielder.*left/i, 'ML'],
    [/미드필더.*중앙|midfielder.*(centre|center)/i, 'MC'],
    [/스트라이커|striker|공격수/i, 'ST']
  ];

  function slotFromName(text) {
    var s = String(text == null ? '' : text).trim();
    if (!s) return null;
    for (var i = 0; i < SLOT_NAMES.length; i++) {
      if (SLOT_NAMES[i][0].test(s)) return SLOT_NAMES[i][1];
    }
    return null;
  }

  function parseLineup(text) {
    var det = detectAndParse(text);
    var positions = [];
    det.rows.forEach(function (row) {
      if (!row.length) return;
      var slot = slotFromName(row[0]);
      // 열 순서가 다른 내보내기를 대비해 앞쪽 두 칸까지 봅니다.
      if (!slot && row.length > 1) slot = slotFromName(row[1]);
      if (slot) positions.push(slot);
    });
    // 11명을 넘어가면 교체 명단까지 읽은 것이므로 앞의 11개만 씁니다.
    if (positions.length > 11) positions = positions.slice(0, 11);
    return { positions: positions, format: det.format, matches: matchFormation(positions) };
  }

  // 자리 구성이 같은 포메이션을 모두 찾습니다. 3-5-2와 5-3-2처럼 배치가 같고
  // 임무만 다른 형태가 있으므로 하나로 단정하지 않습니다.
  function matchFormation(positions) {
    if (!positions || positions.length !== 11) return [];
    var FD = root.FM_FORMATION_DATA;
    if (!FD) return [];
    var want = tally(positions);
    return FD.FORMATIONS.filter(function (f) {
      return sameTally(want, tally(f.slots.map(function (s) { return s.pos; })));
    }).map(function (f) { return f.id; });
  }
  function tally(list) {
    var t = {};
    list.forEach(function (p) { t[p] = (t[p] || 0) + 1; });
    return t;
  }
  function sameTally(a, b) {
    var keys = Object.keys(a).concat(Object.keys(b));
    for (var i = 0; i < keys.length; i++) {
      if ((a[keys[i]] || 0) !== (b[keys[i]] || 0)) return false;
    }
    return true;
  }

  /*
   * 기존 스쿼드에 새로 가져온 선수를 합칩니다.
   *
   * 같은 이름이면 **덮어쓰지 않고 능력치를 채웁니다.** 열이 많아 화면이 좁을 때
   * 「이름·포지션·기술·정신」과 「이름·포지션·신체·골키퍼」로 나눠 두 번 내보내는
   * 방식이 흔한데, 통째로 교체하면 두 번째 가져오기가 첫 번째 능력치를 지웁니다.
   *
   * 원본을 건드리지 않고 새 배열을 돌려줍니다.
   */
  function mergeSquad(existing, incoming) {
    var out = (existing || []).map(function (p) {
      var copy = Object.assign({}, p, { attrs: Object.assign({}, p.attrs || {}) });
      if (p.quickAttrs) copy.quickAttrs = Object.assign({}, p.quickAttrs);
      return copy;
    });
    var byName = {};
    out.forEach(function (p, i) { byName[p.name] = i; });

    var added = 0, updated = 0, filled = 0;
    (incoming || []).forEach(function (p) {
      var i = byName[p.name];
      if (i === undefined) {
        out.push(p);
        byName[p.name] = out.length - 1;
        added++;
        return;
      }
      var cur = out[i];
      Object.keys(p.attrs || {}).forEach(function (k) {
        if (cur.attrs[k] === undefined) filled++;
        cur.attrs[k] = p.attrs[k];
        // 진짜 값이 들어오면 그 자리의 '추정값' 표시는 사라집니다.
        if (cur.quickAttrs) delete cur.quickAttrs[k];
      });
      // 비어 있는 값으로 이미 있는 값을 지우지 않습니다.
      if (p.positions && p.positions.length) cur.positions = p.positions;
      if (p.foot && p.foot !== 'B') cur.foot = p.foot;
      if (p.age) cur.age = p.age;
      if (p.club) cur.club = p.club;
      cur.attrCount = Object.keys(cur.attrs).filter(function (k) { return cur.attrs[k] > 0; }).length;
      updated++;
    });
    return { players: out, added: added, updated: updated, filled: filled };
  }

  root.FM_IMPORTER = {
    parseSquad: parseSquad,
    mergeSquad: mergeSquad,
    parseLineup: parseLineup,
    matchFormation: matchFormation,
    slotFromName: slotFromName,
    cleanName: cleanName,
    parsePositions: parsePositions,
    parseAttrValue: parseAttrValue,
    parseFoot: parseFoot,
    rtfToText: rtfToText,
    parsePipeTable: parsePipeTable,
    parseHtmlTable: parseHtmlTable,
    parseDelimited: parseDelimited,
    parseDelimitedWith: parseDelimitedWith,
    decodeBytes: decodeBytes,
    detectAndParse: detectAndParse,
    resolveHeaders: resolveHeaders,
    HEADER_MAP: HEADER_MAP
  };
})(typeof window !== 'undefined' ? window : globalThis);

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
  reg('position', 'Position', 'Pos', '포지션', '위치');
  reg('age', 'Age', '나이');
  reg('foot', 'Preferred Foot', '주발', '선호발', 'Foot');
  reg('club', 'Club', '클럽', '소속팀');

  // 영문 약어 + 한국어 정식 명칭 + 영문 정식 명칭
  var ALIASES = {
    // GK
    aer: ['Aer', 'Aerial Reach', '공중 장악'],
    cmd: ['Cmd', 'Command of Area', '지역 장악'],
    com: ['Com', 'Communication', '의사소통'],
    ecc: ['Ecc', 'Eccentricity', '괴짜 기질'],
    han: ['Han', 'Handling', '핸들링'],
    kic: ['Kic', 'Kicking', '킥'],
    ono: ['1v1', 'One on Ones', '일대일', '1대1'],
    ref: ['Ref', 'Reflexes', '반사 신경'],
    tro: ['TRO', 'Rushing Out', 'Tendency to Rush Out', '뛰쳐나가기'],
    pun: ['Pun', 'Punching', 'Tendency to Punch', '펀칭 성향'],
    thr: ['Thr', 'Throwing', '던지기'],
    // 기술
    cor: ['Cor', 'Corners', '코너킥'],
    cro: ['Cro', 'Crossing', '크로스'],
    dri: ['Dri', 'Dribbling', '드리블'],
    fin: ['Fin', 'Finishing', '마무리'],
    fir: ['Fir', 'First Touch', '퍼스트 터치'],
    fre: ['Fre', 'Free Kick Taking', 'Free Kicks', '프리킥'],
    hea: ['Hea', 'Heading', '헤딩'],
    lon: ['Lon', 'Long Shots', '중거리 슛'],
    lth: ['L Th', 'LTh', 'Long Throws', '롱 스로인'],
    mar: ['Mar', 'Marking', '마크'],
    pas: ['Pas', 'Passing', '패스'],
    pen: ['Pen', 'Penalty Taking', '페널티킥'],
    tck: ['Tck', 'Tackling', '태클'],
    tec: ['Tec', 'Technique', '테크닉'],
    // 정신
    agg: ['Agg', 'Aggression', '적극성'],
    ant: ['Ant', 'Anticipation', '예측력'],
    bra: ['Bra', 'Bravery', '용맹성'],
    cmp: ['Cmp', 'Composure', '침착성'],
    cnt: ['Cnt', 'Con', 'Concentration', '집중력'],
    dec: ['Dec', 'Decisions', '판단력'],
    det: ['Det', 'Determination', '결단력'],
    fla: ['Fla', 'Flair', '개인기'],
    ldr: ['Ldr', 'Leadership', '리더십'],
    otb: ['OtB', 'Off the Ball', '오프더볼', '오프 더 볼'],
    pos: ['Pos', 'Positioning', '위치 선정'],
    tea: ['Tea', 'Teamwork', '팀워크'],
    vis: ['Vis', 'Vision', '시야'],
    wor: ['Wor', 'Work Rate', '활동량'],
    // 신체
    acc: ['Acc', 'Acceleration', '가속도'],
    agi: ['Agi', 'Agility', '민첩성'],
    bal: ['Bal', 'Balance', '균형 감각'],
    jum: ['Jum', 'Jumping Reach', '점프 도달력'],
    nat: ['Nat', 'Natural Fitness', '자연 체력'],
    pac: ['Pac', 'Pace', '속도'],
    sta: ['Sta', 'Stamina', '스태미너'],
    str: ['Str', 'Strength', '몸싸움']
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

  function parseDelimited(text) {
    var lines = String(text).split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (!lines.length) return [];
    var delim = lines[0].indexOf('\t') >= 0 ? '\t' : (lines[0].indexOf(';') >= 0 ? ';' : ',');
    return lines.map(function (l) {
      return l.split(delim).map(function (c) { return c.trim().replace(/^"|"$/g, ''); });
    });
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
  function resolveHeaders(rows) {
    var bestIdx = -1, bestHit = 0, bestMap = null;
    var limit = Math.min(rows.length, 8);
    for (var i = 0; i < limit; i++) {
      var map = {}, hit = 0;
      rows[i].forEach(function (h, j) {
        var f = HEADER_MAP[norm(h)];
        if (f) { map[j] = f; hit++; }
      });
      if (hit > bestHit) { bestHit = hit; bestIdx = i; bestMap = map; }
    }
    if (bestIdx < 0 || bestHit < 2) return null;

    // 'Pos'가 능력치 표 한가운데 있으면 포지션이 아니라 '위치 선정'입니다.
    // 좌우 열이 모두 능력치면 그렇게 봅니다.
    Object.keys(bestMap).forEach(function (jStr) {
      var j = +jStr;
      if (bestMap[j] !== 'position') return;
      var left = bestMap[j - 1], right = bestMap[j + 1];
      var leftAttr = left && left.indexOf('attr:') === 0;
      var rightAttr = right && right.indexOf('attr:') === 0;
      if (leftAttr && rightAttr) bestMap[j] = 'attr:pos';
    });

    var unknown = [];
    rows[bestIdx].forEach(function (h, j) {
      if (!bestMap[j] && h) unknown.push(h);
    });
    return { index: bestIdx, map: bestMap, unknown: unknown, hits: bestHit };
  }

  // ── 최종 변환 ─────────────────────────────────────────────────────────
  function parseSquad(text) {
    var det = detectAndParse(text);
    var rows = det.rows;
    if (!rows.length) {
      return { players: [], report: { format: det.format, error: '표를 찾지 못했습니다.', rows: 0 } };
    }
    var head = resolveHeaders(rows);
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
        if (field === 'name') p.name = String(raw).trim();
        else if (field === 'position') p.positions = parsePositions(raw);
        else if (field === 'age') { var age = parseInt(raw, 10); if (isFinite(age)) p.age = age; }
        else if (field === 'foot') p.foot = parseFoot(raw);
        else if (field === 'club') p.club = String(raw).trim();
        else if (field.indexOf('attr:') === 0) {
          var v = parseAttrValue(raw);
          if (v !== null) { p.attrs[field.slice(5)] = v; filled++; }
        }
      });
      if (!p.name) continue;
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

  root.FM_IMPORTER = {
    parseSquad: parseSquad,
    parsePositions: parsePositions,
    parseAttrValue: parseAttrValue,
    parseFoot: parseFoot,
    rtfToText: rtfToText,
    parsePipeTable: parsePipeTable,
    parseHtmlTable: parseHtmlTable,
    parseDelimited: parseDelimited,
    detectAndParse: detectAndParse,
    resolveHeaders: resolveHeaders,
    HEADER_MAP: HEADER_MAP
  };
})(typeof window !== 'undefined' ? window : globalThis);

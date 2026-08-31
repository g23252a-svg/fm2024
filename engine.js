/*
 * FM24 맞춤형 전술 엔진
 *
 * 입력 : 우리 스쿼드(능력치) + 상대 전술 + 경기 상황
 * 출력 : 포메이션 후보 · 포지션별 역할/임무와 배정 선수 · 팀 지시 · 개인 지시
 *        · 상대 대응 브리핑 · 경기 중 조정안
 *
 * 브라우저에서는 <script>, 테스트에서는 node vm으로 읽히므로 전역 하나만 노출합니다.
 * 여기 있는 함수는 전부 순수 함수입니다 — 같은 입력이면 같은 출력이 나오고
 * DOM을 건드리지 않습니다. 테스트가 UI 없이 엔진만 돌릴 수 있어야 하기 때문입니다.
 */
(function (root) {
  'use strict';

  var RD = root.FM_ROLE_DATA;
  var FD = root.FM_FORMATION_DATA;
  var TD = root.FM_TACTIC_DATA;

  var ROLE_BY_ID = {};
  RD.ROLES.forEach(function (r) { ROLE_BY_ID[r.id] = r; });
  var FORMATION_BY_ID = {};
  FD.FORMATIONS.forEach(function (f) { FORMATION_BY_ID[f.id] = f; });

  // ── 유틸 ──────────────────────────────────────────────────────────────
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function avg(list) {
    var vals = list.filter(function (v) { return typeof v === 'number' && isFinite(v); });
    if (!vals.length) return 0;
    return vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
  }
  function round1(v) { return Math.round(v * 10) / 10; }

  /*
   * 한글 조사 고르기.
   *
   * 포메이션·지시 이름을 문장에 그대로 끼우면 "크리스마스 트리으로"처럼 나옵니다.
   * 받침 유무로 갈리는데, 이름 끝이 숫자나 로마자인 경우가 많아
   * (4-4-2 · 5-3-2 WB · 4-1-4-1 DM) 그것들의 한글 읽기까지 봅니다.
   */
  var DIGIT_JONG = { '0': 'ㅇ', '1': 'ㄹ', '2': '', '3': 'ㅁ', '4': '', '5': '', '6': 'ㄱ', '7': 'ㄹ', '8': 'ㄹ', '9': '' };
  var LATIN_JONG = {
    A: '', B: '', C: '', D: '', E: '', F: 'ㅍ', G: '', H: 'ㅣ', I: '', J: '', K: '', L: 'ㄹ',
    M: 'ㅁ', N: 'ㄴ', O: '', P: '', Q: '', R: 'ㄹ', S: 'ㅅ', T: '', U: '', V: '', W: 'ㅜ', X: 'ㅅ', Y: '', Z: ''
  };
  function finalConsonant(word) {
    var s = String(word == null ? '' : word).trim();
    // 괄호·공백을 걷어내고 마지막 의미 있는 글자를 봅니다.
    s = s.replace(/[)\]\s]+$/, '');
    if (!s) return null;
    var c = s.charAt(s.length - 1);
    var code = c.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      var jong = (code - 0xAC00) % 28;
      return jong === 0 ? '' : (jong === 8 ? 'ㄹ' : 'X');
    }
    if (DIGIT_JONG[c] !== undefined) return DIGIT_JONG[c] || '';
    var upper = c.toUpperCase();
    if (LATIN_JONG[upper] !== undefined) return LATIN_JONG[upper] === 'ㄹ' ? 'ㄹ' : (LATIN_JONG[upper] ? 'X' : '');
    return null;
  }
  // '로/으로' — 받침이 없거나 ㄹ이면 '로'.
  function ro(word) {
    var f = finalConsonant(word);
    if (f === null) return '으로';
    return (f === '' || f === 'ㄹ') ? '로' : '으로';
  }
  // '을/를' — 받침이 있으면 '을'.
  function eul(word) {
    var f = finalConsonant(word);
    if (f === null) return '을';
    return f === '' ? '를' : '을';
  }
  // '이/가'
  function iga(word) {
    var f = finalConsonant(word);
    if (f === null) return '이';
    return f === '' ? '가' : '이';
  }
  // '은/는'
  function eun(word) {
    var f = finalConsonant(word);
    if (f === null) return '은';
    return f === '' ? '는' : '은';
  }
  // '와/과' — 받침이 있으면 '과'.
  function wa(word) {
    var f = finalConsonant(word);
    if (f === null) return '과';
    return f === '' ? '와' : '과';
  }
  // '라/이라' — 서술격. '딥 라잉 포워드라' / '앵커 맨이라'.
  function ira(word) {
    var f = finalConsonant(word);
    if (f === null) return '이라';
    return f === '' ? '라' : '이라';
  }

  // 포지션 인접표 — 등록되지 않은 포지션이라도 여기 연결돼 있으면 부분 점수를 줍니다.
  var ADJACENT = {
    GK: {},
    DR: { WBR: 0.95, DC: 0.72, MR: 0.72 },
    DL: { WBL: 0.95, DC: 0.72, ML: 0.72 },
    DC: { DM: 0.78, DR: 0.66, DL: 0.66 },
    WBR: { DR: 0.95, MR: 0.82, AMR: 0.62 },
    WBL: { DL: 0.95, ML: 0.82, AML: 0.62 },
    DM: { MC: 0.86, DC: 0.7 },
    MC: { DM: 0.86, AMC: 0.82 },
    MR: { AMR: 0.88, WBR: 0.82, DR: 0.7, MC: 0.6 },
    ML: { AML: 0.88, WBL: 0.82, DL: 0.7, MC: 0.6 },
    AMR: { MR: 0.88, ST: 0.66, AMC: 0.66, WBR: 0.55 },
    AML: { ML: 0.88, ST: 0.66, AMC: 0.66, WBL: 0.55 },
    AMC: { MC: 0.82, ST: 0.74, AMR: 0.62, AML: 0.62 },
    ST: { AMC: 0.74, AMR: 0.62, AML: 0.62 }
  };

  function positionFamiliarity(player, pos) {
    var list = player.positions || [];
    if (list.indexOf(pos) >= 0) return 1;
    // 골키퍼와 필드 플레이어 사이에는 인접 관계가 없습니다.
    var isGkSlot = pos === 'GK';
    var isGkPlayer = list.length > 0 && list.every(function (p) { return p === 'GK'; });
    if (isGkSlot !== isGkPlayer && (isGkSlot || isGkPlayer)) return 0.05;
    var best = 0;
    var adj = ADJACENT[pos] || {};
    for (var i = 0; i < list.length; i++) {
      var v = adj[list[i]];
      if (v && v > best) best = v;
    }
    // 아예 낯선 자리. 0으로 두면 스쿼드가 얇을 때 배치 자체가 불가능해지므로
    // 강하게 깎되 후보로는 남깁니다.
    return best || 0.34;
  }

  // ── 능력치 접근 ───────────────────────────────────────────────────────
  // 값이 비어 있으면 같은 그룹의 평균으로 메우고, 그 사실을 커버리지로 남깁니다.
  function attrGetter(player) {
    var a = player.attrs || {};
    var groupAvg = {};
    var groupVals = {};
    RD.ATTR_ORDER.forEach(function (id) {
      var v = a[id];
      if (typeof v === 'number' && isFinite(v) && v > 0) {
        var g = RD.ATTRS[id].group;
        (groupVals[g] = groupVals[g] || []).push(v);
      }
    });
    Object.keys(groupVals).forEach(function (g) { groupAvg[g] = avg(groupVals[g]); });
    var all = [];
    Object.keys(groupVals).forEach(function (g) { all = all.concat(groupVals[g]); });
    var overall = all.length ? avg(all) : 10;
    return function (id) {
      var v = a[id];
      if (typeof v === 'number' && isFinite(v) && v > 0) return { v: v, known: true };
      var g = RD.ATTRS[id] ? RD.ATTRS[id].group : null;
      return { v: (g && groupAvg[g]) || overall, known: false };
    };
  }

  /*
   * 역할 적합도 (0~100)
   *   key 능력치 가중 3, pref 가중 1. 20점 만점을 100으로 환산합니다.
   *   그 위에 포지션 친숙도와 주발 보정을 곱합니다.
   */
  function roleFit(player, role, duty) {
    var get = player._get || (player._get = attrGetter(player));
    var key = role.key.slice();
    if (role.dutyKey && role.dutyKey[duty]) key = key.concat(role.dutyKey[duty]);
    var pref = role.pref || [];

    var sum = 0, wsum = 0, known = 0, total = 0;
    var seen = {};
    key.forEach(function (id) {
      if (seen[id]) return; seen[id] = 1;
      var r = get(id);
      sum += r.v * 3; wsum += 3; total++; if (r.known) known++;
    });
    pref.forEach(function (id) {
      if (seen[id]) return; seen[id] = 1;
      var r = get(id);
      sum += r.v * 1; wsum += 1; total++; if (r.known) known++;
    });
    var base = wsum ? (sum / wsum) / 20 * 100 : 0;

    var fam = positionFamiliarity(player, role._slotPos || role.pos[0]);
    var footAdj = footAdjust(player, role, role._slotPos);
    var req = requirementCheck(player, role, get);
    var tr = traitAdjust(player, role);

    return {
      score: clamp(base * fam * footAdj * req.factor * tr.factor, 0, 100),
      raw: base,
      familiarity: fam,
      reqFactor: req.factor,
      reqFail: req.fail,
      traitFactor: tr.factor,
      traitHits: tr.hits,
      coverage: total ? known / total : 0
    };
  }

  /*
   * 선수 특성 보정.
   *
   * 특성은 능력치보다 강하게 역할을 바꿉니다. 「측면 라인 붙기」가 있는 선수를
   * 인사이드 포워드로 세우면 그 역할이 하려는 것을 선수가 하지 않습니다.
   * 반대로 「안쪽으로 파고들기」가 있으면 윙어로 세워도 안으로 들어옵니다.
   *
   * 능력치처럼 평균에 섞지 않고 곱으로 둡니다 — 특성은 "조금 잘한다"가 아니라
   * "그 행동을 한다/안 한다"이기 때문입니다.
   */
  var TRAIT_BY_ID = null;
  function traitById(id) {
    if (!TRAIT_BY_ID) {
      TRAIT_BY_ID = {};
      var TD2 = root.FM_TRAIT_DATA;
      if (TD2) TD2.TRAITS.forEach(function (t) { TRAIT_BY_ID[t.id] = t; });
    }
    return TRAIT_BY_ID[id] || null;
  }

  function traitAdjust(player, role) {
    var ids = player.traits || [];
    if (!ids.length) return { factor: 1, hits: [] };
    var tags = role.tags || [];
    var pct = 0, hits = [];
    ids.forEach(function (id) {
      var t = traitById(id);
      if (!t) return;
      var d = 0;
      if (t.fit) {
        tags.forEach(function (tag) { if (t.fit[tag]) d += t.fit[tag]; });
      }
      if (t.roleFit && t.roleFit[role.id]) d += t.roleFit[role.id];
      if (d) { pct += d; hits.push({ id: id, ko: t.ko, delta: d }); }
    });
    // 특성이 여러 개 겹쳐도 역할 점수가 뒤집히지는 않게 폭을 제한합니다.
    return { factor: clamp(1 + pct / 100, 0.6, 1.35), hits: hits };
  }

  /*
   * 역할 요구치.
   *
   * 능력치 가중 평균만 쓰면 key 능력치가 적은 역할이 구조적으로 높게 나옵니다
   * (노 넌센스 센터백은 패스를 아예 안 보므로 패스 못 하는 수비수에게 항상 유리).
   * 게다가 "속도 10짜리 어드밴스드 포워드"처럼 그 역할의 전제 자체가 무너지는
   * 조합을 평균이 가려 버립니다. 그래서 몇몇 역할에는 그 역할이 성립하기 위한
   * 최소치를 두고, 미달이면 비례해서 깎습니다.
   *
   * 모르는 능력치는 건드리지 않습니다 — 안 적은 것과 낮은 것은 다릅니다.
   */
  function requirementCheck(player, role, get) {
    var req = role.req;
    if (!req) return { factor: 1, fail: [] };
    var ratios = [], fail = [];
    Object.keys(req).forEach(function (id) {
      var r = get(id);
      if (!r.known) return;
      var need = req[id];
      ratios.push(clamp(r.v / need, 0, 1));
      if (r.v < need) fail.push({ attr: id, need: need, have: r.v });
    });
    if (!ratios.length) return { factor: 1, fail: [] };
    var mean = ratios.reduce(function (a, b) { return a + b; }, 0) / ratios.length;
    return { factor: clamp(0.55 + 0.45 * mean, 0.55, 1), fail: fail };
  }

  // 인버티드 계열은 반대발, 정통 윙어는 같은 발이 자연스럽습니다.
  function footAdjust(player, role, slotPos) {
    var foot = player.foot;
    if (!foot || !slotPos) return 1;
    var side = slotPos.indexOf('L') >= 0 && slotPos !== 'GK' ? 'l'
      : slotPos.indexOf('R') >= 0 ? 'r' : null;
    if (!side) return 1;
    var tags = role.tags || [];
    var inverted = tags.indexOf('inverted') >= 0 || tags.indexOf('narrow-drift') >= 0;
    var wideCross = tags.indexOf('crosser') >= 0 && !inverted;
    if (foot === 'B') return 1;
    var strongSide = foot === 'L' ? 'l' : 'r';
    if (inverted) return strongSide === side ? 0.9 : 1.04;
    if (wideCross) return strongSide === side ? 1.03 : 0.95;
    return 1;
  }

  // ── 스쿼드 요약 ───────────────────────────────────────────────────────
  function summariseSquad(players) {
    if (!players.length) {
      return { pace: 0, technique: 0, aerial: 0, stamina: 0, gkKick: 0, count: 0, coverage: 0 };
    }
    function pick(ids, subset) {
      var pool = subset || players;
      return avg(pool.map(function (p) {
        var get = p._get || (p._get = attrGetter(p));
        var vals = ids.map(function (id) { var r = get(id); return r.known ? r.v : null; })
          .filter(function (v) { return v !== null; });
        return vals.length ? avg(vals) : null;
      }));
    }
    var outfield = players.filter(function (p) { return (p.positions || []).indexOf('GK') < 0; });
    var keepers = players.filter(function (p) { return (p.positions || []).indexOf('GK') >= 0; });
    var attackers = outfield.filter(function (p) {
      var ps = p.positions || [];
      return ps.some(function (x) { return ['ST', 'AMC', 'AMR', 'AML', 'MR', 'ML'].indexOf(x) >= 0; });
    });
    var known = 0, total = 0;
    players.forEach(function (p) {
      RD.ATTR_ORDER.forEach(function (id) {
        var v = (p.attrs || {})[id];
        total++;
        if (typeof v === 'number' && v > 0) known++;
      });
    });
    var defenders = outfield.filter(function (p) {
      return (p.positions || []).some(function (x) { return ['DC', 'DR', 'DL', 'WBR', 'WBL', 'DM'].indexOf(x) >= 0; });
    });
    var mids = outfield.filter(function (p) {
      return (p.positions || []).some(function (x) { return ['DM', 'MC', 'AMC'].indexOf(x) >= 0; });
    });
    var wideMen = outfield.filter(function (p) {
      return (p.positions || []).some(function (x) { return ['AMR', 'AML', 'MR', 'ML', 'WBR', 'WBL', 'DR', 'DL'].indexOf(x) >= 0; });
    });

    return {
      pace: round1(pick(['pac', 'acc'], attackers.length ? attackers : outfield)),
      technique: round1(pick(['tec', 'fir', 'pas'], outfield)),
      aerial: round1(pick(['jum', 'hea', 'str'], outfield)),
      stamina: round1(pick(['sta', 'wor'], outfield)),
      // 아래 넷은 시즌 기본 전술을 고를 때만 씁니다 — 경기별 전술은 상대가 정합니다.
      crossing: round1(pick(['cro'], wideMen.length ? wideMen : outfield)),
      defending: round1(pick(['mar', 'tck', 'pos'], defenders.length ? defenders : outfield)),
      creativity: round1(pick(['vis', 'pas', 'fla'], mids.length ? mids : outfield)),
      finishing: round1(pick(['fin', 'otb'], attackers.length ? attackers : outfield)),
      gkKick: round1(pick(['kic'], keepers)),
      count: players.length,
      coverage: total ? known / total : 0
    };
  }

  // ── 포메이션 요약 ─────────────────────────────────────────────────────
  function summariseFormation(f) {
    var c = { GK: 0, DC: 0, DR: 0, DL: 0, WBR: 0, WBL: 0, DM: 0, MC: 0, MR: 0, ML: 0, AMR: 0, AML: 0, AMC: 0, ST: 0 };
    f.slots.forEach(function (s) { c[s.pos]++; });
    var backLine = c.DC + c.DR + c.DL + c.WBR + c.WBL;
    return {
      counts: c,
      backLine: backLine,
      threeAtBack: c.DC === 3,
      centre: c.DM + c.MC + c.AMC,          // 중앙 라인에 선 인원
      midfield: c.DM + c.MC + c.MR + c.ML,  // 미드필드 줄 인원
      wideAttack: c.AMR + c.AML + c.MR + c.ML,
      wideDefend: c.DR + c.DL + c.WBR + c.WBL,
      // 측면을 실제로 지킬 수 있는 인원. 측면 수비수만 세면 4-2-3-1과
      // 4-4-2 다이아몬드가 똑같이 "측면 2명"이 되는데, 앞의 것은 2선 측면이
      // 내려와 돕고 뒤의 것은 아무도 없습니다.
      wideCover: c.DR + c.DL + c.WBR + c.WBL + c.MR + c.ML + 0.5 * (c.AMR + c.AML),
      strikers: c.ST,
      amc: c.AMC,
      dm: c.DM,
      tags: f.tags || []
    };
  }

  /*
   * ── 상대 스쿼드에서 성향 추정 ──────────────────────────────────────────
   *
   * 상대 전술을 슬라이더로 일일이 채우는 건 번거롭고, 시즌 전이면 알 수도 없습니다.
   * 상대 스쿼드를 가져오면 "어떤 무기를 가진 팀인가"는 능력치에서 바로 읽힙니다.
   * 여기서 내는 건 상대가 실제로 그렇게 하겠다는 보장이 아니라 그럴 수 있다는
   * 뜻이므로, 각 항목마다 근거가 된 선수 이름을 함께 돌려줍니다.
   */
  function inferOpponentTraits(players) {
    var out = [];
    var ps = (players || []).map(function (p, i) {
      var c = Object.assign({}, p);
      c._id = p.id || ('opp' + i);
      c.positions = p.positions || [];
      c.attrs = p.attrs || {};
      return c;
    });
    if (!ps.length) return out;

    function at(p, id) {
      var v = (p.attrs || {})[id];
      return typeof v === 'number' && v > 0 ? v : null;
    }
    function inPos() {
      var want = Array.prototype.slice.call(arguments);
      return ps.filter(function (p) {
        return p.positions.some(function (x) { return want.indexOf(x) >= 0; });
      });
    }
    function add(id, why, who) {
      out.push({ id: id, why: why, players: who.slice(0, 3).map(function (p) { return p.name; }) });
    }
    // 능력치가 없으면 아무것도 말할 수 없습니다.
    var known = ps.filter(function (p) { return Object.keys(p.attrs).length >= 3; });
    if (known.length < 3) return out;

    var fwd = inPos('ST', 'AMR', 'AML');
    var fast = fwd.filter(function (p) { return (at(p, 'pac') || 0) >= 15 && (at(p, 'acc') || 0) >= 15; });
    if (fast.length) add('fast-striker', '앞선에 속도 15 이상인 선수가 ' + fast.length + '명 있습니다.', fast);

    var target = inPos('ST').filter(function (p) {
      return (at(p, 'hea') || 0) >= 14 && (at(p, 'jum') || 0) >= 14 && (at(p, 'str') || 0) >= 13;
    });
    if (target.length) add('target-man', '최전방에 제공권으로 공을 지켜 줄 선수가 있습니다.', target);

    var amc = inPos('AMC').filter(function (p) {
      return (at(p, 'pas') || 0) >= 14 && (at(p, 'vis') || 0) >= 14;
    });
    if (amc.length) add('playmaker-amc', '2선에 패스·시야 14 이상인 선수가 있습니다.', amc);

    var deep = inPos('DM', 'MC').filter(function (p) {
      return (at(p, 'pas') || 0) >= 15 && (at(p, 'vis') || 0) >= 14;
    });
    if (deep.length) add('playmaker-deep', '중원 아래에 배급을 맡을 선수가 있습니다.', deep);

    var cbs = inPos('DC').filter(function (p) { return at(p, 'pac') !== null; });
    if (cbs.length >= 2) {
      var slow = cbs.filter(function (p) { return at(p, 'pac') <= 11; });
      if (slow.length >= Math.ceil(cbs.length / 2)) {
        add('slow-cb', '센터백 대부분이 속도 11 이하입니다.', slow);
      }
    }
    var cbsJ = inPos('DC').filter(function (p) { return at(p, 'jum') !== null; });
    if (cbsJ.length >= 2) {
      var small = cbsJ.filter(function (p) { return at(p, 'jum') <= 11; });
      if (small.length >= Math.ceil(cbsJ.length / 2)) {
        add('small-cb', '센터백 대부분이 점프 11 이하입니다.', small);
      }
    }

    var gks = inPos('GK').filter(function (p) { return at(p, 'kic') !== null; });
    if (gks.length) {
      var best = gks.reduce(function (a, b) { return at(a, 'kic') >= at(b, 'kic') ? a : b; });
      if (at(best, 'kic') <= 10) add('weak-gk-dist', '골키퍼의 킥이 ' + at(best, 'kic') + '입니다.', [best]);
    }

    var wide = inPos('AMR', 'AML', 'MR', 'ML', 'WBR', 'WBL');
    var crossers = wide.filter(function (p) { return (at(p, 'cro') || 0) >= 14; });
    if (crossers.length >= 3) add('cross-heavy', '측면에 크로스 14 이상인 선수가 ' + crossers.length + '명 있습니다.', crossers);
    if (wide.length >= 5 && crossers.length >= 2) add('wing-heavy', '측면 자원이 두텁습니다(' + wide.length + '명).', wide);

    var aggro = known.filter(function (p) { return (at(p, 'agg') || 0) >= 15; });
    if (aggro.length >= 4) add('aggressive-tackling', '적극성 15 이상인 선수가 ' + aggro.length + '명입니다.', aggro);

    var setPiece = known.filter(function (p) { return (at(p, 'cor') || 0) >= 14 || (at(p, 'fre') || 0) >= 14; });
    var aerial = known.filter(function (p) { return (at(p, 'jum') || 0) >= 15 && (at(p, 'hea') || 0) >= 14; });
    if (setPiece.length && aerial.length >= 2) {
      add('set-piece-threat', '키커와 박스 안 제공권 자원이 함께 있습니다.', setPiece.concat(aerial));
    }

    var stam = known.filter(function (p) { return at(p, 'sta') !== null; });
    if (stam.length >= 8) {
      var mean = avg(stam.map(function (p) { return at(p, 'sta'); }));
      if (mean < 12) add('low-stamina', '스쿼드 평균 지구력이 ' + round1(mean) + '입니다.', stam);
    }
    return out;
  }

  /*
   * 상대 선발에서 읽히는 약한 고리.
   *
   * 전술 화면 내보내기에는 능력치가 없지만, 그보다 값싼 정보가 있습니다 —
   * 등록 포지션이 아닌 자리에 선 선수와 컨디션이 나쁜 선수. 둘 다 "어느 쪽을
   * 노릴지"를 바로 알려 줍니다.
   */
  var POOR_CONDITION = /나쁨|저조|지침|Poor|Jaded|Tired/i;
  var OPP_SIDE = {
    DR: '왼쪽', WBR: '왼쪽', MR: '왼쪽', AMR: '왼쪽',
    DL: '오른쪽', WBL: '오른쪽', ML: '오른쪽', AML: '오른쪽'
  };

  // 상대 기준 왼쪽이 약하면 'weak-flank-l' — 우리는 오른쪽을 공략합니다.
  var SIDE_TO_TRAIT = { DR: 'weak-flank-r', WBR: 'weak-flank-r', MR: 'weak-flank-r', AMR: 'weak-flank-r',
    DL: 'weak-flank-l', WBL: 'weak-flank-l', ML: 'weak-flank-l', AML: 'weak-flank-l' };

  function opponentLineupNotes(slots) {
    var out = [];
    (slots || []).forEach(function (s) {
      if (!s.name) return;
      var ourSide = OPP_SIDE[s.pos];
      if (s.positions && s.positions.length && s.positions.indexOf(s.pos) < 0) {
        out.push({
          kind: 'out-of-position', trait: SIDE_TO_TRAIT[s.pos] || null,
          text: s.name + iga(s.name) + ' ' + posKo(s.pos) + '에 서는데 등록 포지션은 '
            + s.positions.join(' · ') + '입니다.',
          action: ourSide
            ? ('그 자리는 수비 가담이 약할 수 있습니다 — 우리 ' + ourSide + ' 측면을 밀어 보세요.')
            : '익숙하지 않은 자리라 위치 선정이 흔들릴 수 있습니다.'
        });
      }
      if (s.condition && POOR_CONDITION.test(s.condition)) {
        out.push({
          kind: 'condition', trait: SIDE_TO_TRAIT[s.pos] || null,
          text: s.name + '(' + posKo(s.pos) + ')의 컨디션이 ' + s.condition + '입니다.',
          action: ourSide
            ? ('우리 ' + ourSide + ' 측면에서 반복해서 달리게 만드세요 — 후반에 먼저 무너집니다.')
            : '경기가 진행될수록 그 자리가 먼저 벌어집니다.'
        });
      }
    });
    return out;
  }

  // ── 상대 입력 정규화 ──────────────────────────────────────────────────
  function normaliseOpponent(o) {
    o = o || {};
    return {
      formationId: o.formationId || null,
      mentality: numOr(o.mentality, 3),
      dline: numOr(o.dline, 2),
      loe: numOr(o.loe, 2),
      press: numOr(o.press, 2),
      width: numOr(o.width, 3),
      directness: numOr(o.directness, 2),
      tempo: numOr(o.tempo, 2),
      transitionLost: o.transitionLost || 'regroup',
      transitionWon: o.transitionWon || 'hold',
      traits: o.traits || [],
      keyPlayer: o.keyPlayer || null
    };
  }
  function numOr(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

  function normaliseContext(c) {
    c = c || {};
    return {
      venue: c.venue || 'home',
      odds: c.odds || 'even',
      goal: c.goal || 'win'
    };
  }

  // ── 구조 규칙 ─────────────────────────────────────────────────────────
  /*
   * 포메이션끼리의 맞물림은 손으로 쓴 대진표 대신 인원수 차이에서 계산합니다.
   * 포메이션이 20개면 대진표는 400칸이고, 슬롯을 한 번 고칠 때마다 그 400칸이
   * 조용히 어긋납니다. 숫자에서 뽑으면 그런 일이 없습니다.
   */
  function structuralRules(ourSum, oppF) {
    if (!oppF) return [];
    var t = summariseFormation(oppF);
    var out = [];

    var centreDiff = ourSum.centre - t.centre;
    if (centreDiff >= 1) {
      out.push({
        id: 'st-centre-plus', group: '형태 맞물림', tier: centreDiff >= 2 ? 'key' : 'normal',
        toggle: { focus_c: 0.6 * centreDiff },
        plan: { 'overload-centre': 1.1 * centreDiff, possession: 0.5 * centreDiff },
        why: '중앙 인원이 ' + centreDiff + '명 많습니다 (우리 ' + ourSum.centre + ' vs 상대 ' + t.centre + ').',
        action: '중앙으로 집중 공격해 이 수적 우위를 실제 패스 경로로 바꾸세요. 상대는 중앙에서 계속 한 명이 남습니다.'
      });
    } else if (centreDiff <= -1) {
      out.push({
        id: 'st-centre-minus', group: '형태 맞물림', tier: 'key',
        axis: { width: 0.5 },
        plan: { 'overload-centre': -1.2, 'wide-cross': 0.8 * -centreDiff, counter: 0.4 },
        role: { 'overload-centre': 1.1, inverted: 0.8 },
        why: '중앙 인원이 ' + (-centreDiff) + '명 적습니다 (우리 ' + ourSum.centre + ' vs 상대 ' + t.centre + ').',
        action: '중앙 대결을 피하고 측면으로 나가거나, 인버티드 윙백/인버티드 풀백을 써서 안쪽 인원을 한 명 늘리세요. 그대로 두면 중원에서 계속 밀립니다.'
      });
    }

    if (t.amc > 0 && ourSum.dm === 0) {
      out.push({
        id: 'st-their-amc', group: '형태 맞물림', tier: 'key',
        toggle: { tightmark: 1.2 },
        role: { holder: 1.4, 'defensive-cover': 0.8 },
        why: '상대는 공격형 미드필더를 두는데 우리는 수비형 미드필더 자리가 없습니다.',
        action: '중앙 미드필더 중 한 명을 수비 임무로 내리거나, 수비형 미드필더 자리가 있는 포메이션으로 바꾸세요. 이 자리를 비워 두면 우리 수비와 미드필드 사이가 상대 10번의 앞마당이 됩니다.'
      });
    }

    if (t.strikers >= 2 && ourSum.counts.DC <= 2) {
      out.push({
        id: 'st-two-strikers', group: '형태 맞물림',
        role: { 'defensive-cover': 1, holder: 0.8 },
        why: '상대는 최전방 2명, 우리 센터백은 ' + ourSum.counts.DC + '명 — 뒤에 남는 사람이 없습니다.',
        action: '수비형 미드필더를 수비 임무로 두어 사실상 세 번째 센터백을 만들거나, 스리백으로 바꿔 한 명을 남기세요.'
      });
    }
    if (ourSum.counts.DC >= 3 && t.strikers <= 1) {
      out.push({
        id: 'st-spare-cb', group: '형태 맞물림',
        plan: { possession: 0.6 },
        role: { buildout: 0.8 },
        why: '상대 최전방이 ' + t.strikers + '명인데 우리 센터백은 3명 — 한 명이 항상 남습니다.',
        action: '남는 센터백이 공을 들고 전진하게 하세요(볼 플레잉 디펜더·리베로). 그냥 서 있으면 수적 우위가 빌드업에서 아무 값도 하지 않습니다.'
      });
    }

    if (t.wideAttack === 0 && ourSum.wideAttack > 0) {
      out.push({
        id: 'st-they-narrow', group: '형태 맞물림',
        axis: { width: 0.8 },
        toggle: { ovl_l: 0.6, ovl_r: 0.6 },
        plan: { 'wide-cross': 1.2 },
        role: { width: 1 },
        why: '상대 포메이션에 측면 자원이 없습니다 — 측면은 상대 풀백 혼자 감당합니다.',
        action: '측면에서 계속 2대1을 만드세요. 상대 풀백이 끌려 나오면 그 안쪽이 그대로 열립니다.'
      });
    }
    if (t.wideAttack >= 2 && ourSum.wideCover <= 2) {
      out.push({
        id: 'st-they-wide', group: '형태 맞물림', tier: 'key',
        role: { 'defensive-cover': 1, width: 0.6 },
        why: '상대 측면 자원 ' + t.wideAttack + '명을 우리 측면 수비 ' + ourSum.wideDefend + '명이 도움 없이 맞습니다.',
        action: '측면 선수를 수비 가담이 되는 역할로 두거나 중앙 미드필더 한 명을 카릴레로로 바꿔 측면을 돕게 하세요. 지금 형태로는 풀백이 계속 2대1을 맞습니다.'
      });
    }

    if (t.threeAtBack) {
      out.push({
        id: 'st-vs-three', group: '형태 맞물림',
        toggle: { ovl_l: 0.5, ovl_r: 0.5 },
        plan: { 'wide-cross': 0.8 },
        role: { pace: 0.6, width: 0.8 },
        why: '상대가 스리백입니다 — 중앙은 두껍지만 윙백 뒤 공간이 열려 있습니다.',
        action: '측면 공격수를 상대 윙백 뒤쪽으로 돌리세요. 상대 와이드 센터백이 끌려 나오는 순간 스리백이 벌어집니다.'
      });
    }

    return out;
  }

  // ── 플랜과 지시 계산 ──────────────────────────────────────────────────
  function evaluateRules(opp, ctx, squad, ourSum, oppF) {
    var fired = [];
    TD.RULES.forEach(function (rule) {
      var ok;
      try { ok = rule.when(opp, ctx, squad, ourSum); } catch (e) { ok = false; }
      if (!ok) return;
      var scale = rule.scale ? rule.scale(opp, ctx, squad) : 1;
      fired.push({ rule: rule, scale: scale, why: fillTemplate(rule.why, squad), action: rule.action });
    });
    structuralRules(ourSum, oppF).forEach(function (rule) {
      fired.push({ rule: rule, scale: 1, why: rule.why, action: rule.action });
    });
    return fired;
  }

  function fillTemplate(str, squad) {
    if (!str) return str;
    return str.replace(/\{(\w+)\}/g, function (m, k) {
      return squad && squad[k] !== undefined ? String(squad[k]) : m;
    });
  }

  function accumulate(fired) {
    var axis = {}, toggle = {}, plan = {}, role = {};
    var reasons = { axis: {}, toggle: {}, plan: {}, role: {} };
    Object.keys(TD.AXES).forEach(function (k) { axis[k] = 0; reasons.axis[k] = []; });
    Object.keys(TD.TOGGLES).forEach(function (k) { toggle[k] = 0; reasons.toggle[k] = []; });
    Object.keys(TD.PLANS).forEach(function (k) { plan[k] = 0; });

    fired.forEach(function (f) {
      var r = f.rule, s = f.scale;
      if (r.axis) Object.keys(r.axis).forEach(function (k) {
        if (axis[k] === undefined) return;
        axis[k] += r.axis[k] * s;
        reasons.axis[k].push({ why: f.why, delta: r.axis[k] * s });
      });
      if (r.toggle) Object.keys(r.toggle).forEach(function (k) {
        if (toggle[k] === undefined) return;
        toggle[k] += r.toggle[k] * s;
        reasons.toggle[k].push({ why: f.why, delta: r.toggle[k] * s });
      });
      if (r.plan) Object.keys(r.plan).forEach(function (k) {
        if (plan[k] === undefined) return;
        plan[k] += r.plan[k] * s;
      });
      if (r.role) Object.keys(r.role).forEach(function (k) {
        role[k] = (role[k] || 0) + r.role[k] * s;
      });
    });
    return { axis: axis, toggle: toggle, plan: plan, role: role, reasons: reasons };
  }

  // 플랜이 정해지면 그 플랜이 다시 지시와 역할 선호를 밉니다.
  /*
   * ── 전술 방향이 실제로 지시를 바꿔야 한다 ────────────────────────────────
   *
   * 이 표가 이 도구에서 가장 중요한 표입니다. 「어떤 축구를 할 것인가」를 FM의
   * 팀 지시로 옮기는 자리이기 때문입니다. 그런데 오래도록 거의 아무 일도 하지
   * 않고 있었습니다 — 값이 전부 반올림 문턱 아래였기 때문입니다.
   *
   * 축은 정수 칸이고 인덱스는 Math.round(기본값 + 누적)으로 정합니다. 그래서
   * 0.4를 밀면 한 칸도 안 움직이고, -0.5는 Math.round(-0.5)가 -0이라 역시
   * 안 움직입니다. 실제로 재 보니 이랬습니다.
   *
   *     뒷공간 침투   축 0/2 움직임
   *     점유·중앙 조립 축 0/2
   *     역습         축 0/3
   *     중앙 과부하    축 0/1
   *
   * 즉 「점유·중앙 조립로 하세요」라고 말하면서 내주는 팀 지시가 「역습」과
   * 완전히 같았습니다. 실제 스쿼드로 뽑아 보니 축 열한 개가 전부 「표준」이고
   * 켜지는 토글은 둘뿐이었습니다 — 상위권 팀에게 사실상 FM 기본값을 주고
   * 「점유 축구」라고 불렀던 셈입니다.
   *
   * 그래서 일곱 방향을 전부 다시 썼습니다. 기준은 두 가지입니다.
   *   1. 각 방향은 혼자서도 축을 최소 두 칸 움직여야 한다.
   *   2. 일곱 방향이 서로 다른 지시를 내야 한다 — 이름만 다르고 지시가 같으면
   *      그건 방향이 아니다.
   * 둘 다 검사로 못 박았습니다.
   *
   * 값은 FM에서 그 축구를 하려면 실제로 어떤 지시를 켜는지를 옮긴 것입니다.
   * 두 방향이 함께 뽑히면 2위는 0.5배로 섞이므로, 값이 서로 상쇄되지 않도록
   * 각 방향의 성격이 분명한 축에만 큰 값을 둡니다.
   */
  var PLAN_EFFECTS = {
    /*
     * 뒷공간 침투 — 상대 라인 뒤로 빠르게 넘긴다.
     * 길게 잡아 두고 조립할 이유가 없으므로 짧은 패스와 박스 안 배급은 끕니다.
     */
    'in-behind': {
      axis: { directness: 1.2, tempo: 0.8, dline: 0.6, dribble: 0.4 },
      toggle: { pis: 1.6, wbib: -1.2, hec: 0.6, pod: -0.6 }
    },
    /*
     * 점유·중앙 조립 — 짧게 돌리며 중앙에서 상대를 끌어낸다.
     * 폭을 좁히는 것이 이 방향의 핵심입니다. 넓게 벌리면 패스 거리가 길어져
     * 「짧게」와 정면으로 부딪힙니다.
     */
    possession: {
      axis: { directness: -1.2, tempo: -0.7, width: -0.8, dline: 0.6, creativity: -0.6 },
      toggle: { pod: 1.6, wbib: 1.2, sos: -1.2, gk_cb: 0.8 }
    },
    /*
     * 측면·크로스 — 폭을 잡고 박스로 넣는다.
     * 크로스 종류와 오버랩 방향은 선발을 짠 뒤에 정합니다(그쪽 선수의 역할을
     * 봐야 하므로). 여기서는 폭과 목표 지점만 잡습니다.
     */
    'wide-cross': {
      axis: { width: 1.4, directness: 0.6, tempo: 0.4 },
      toggle: { ovl_l: 0.8, ovl_r: 0.8, cr_byline: 0.8, wbib: -0.8, gk_flank: 0.5 }
    },
    /*
     * 역습 — 내려서 받아 놓고 뺏는 즉시 나간다.
     * 라인을 내리는 것과 빠르게 직선적으로 나가는 것이 한 묶음이라야 합니다.
     * 하나만 하면 내려앉기만 하고 못 나가거나, 올린 채로 역습만 노리게 됩니다.
     */
    counter: {
      axis: { dline: -1.0, loe: -0.8, tempo: 0.8, directness: 1.2, mentality: -0.6 },
      toggle: { counter: 1.8, regroup: 1.4, pod: -1.2, distquick: 0.8, wbib: -0.8 }
    },
    /*
     * 전방 압박 — 높이 올라가 상대 진영에서 뺏는다.
     * 뺏은 뒤에 다시 압박하지 않으면 라인만 높고 뒤가 비는 형태가 됩니다.
     */
    'press-high': {
      axis: { loe: 1.2, press: 1.2, dline: 0.8, mentality: 0.6, tackling: 0.6 },
      toggle: { counterpress: 1.6, ptp: 1.0, offside: 0.6, distslow: -0.6 }
    },
    /*
     * 내려앉기 — 뒤를 지우고 버틴다.
     * 압박과 멘탈리티까지 같이 내려야 「라인은 낮은데 앞은 나가 있는」 형태가
     * 안 생깁니다. 그 어긋남이 실점의 가장 흔한 원인입니다.
     */
    'low-block': {
      axis: { dline: -1.2, loe: -1.2, press: -0.8, mentality: -0.8, width: -0.6, timewaste: 0.6 },
      toggle: { regroup: 1.6, pod: -1.0, holdshape: 1.0, tightmark: 0.6 }
    },
    /*
     * 중앙 과부하 — 중앙에 사람을 모아 숫자로 이긴다.
     * 폭을 확실히 좁히고 시선을 중앙에 둡니다. 언더랩은 측면 선수를 안쪽으로
     * 들여보내는 것이라 이 방향과 같은 편입니다.
     */
    'overload-centre': {
      axis: { width: -1.4, directness: -0.6, dribble: 0.4 },
      toggle: { focus_c: 1.4, unl_l: 0.6, unl_r: 0.6, cr_low: 0.5 }
    }
  };

  /*
   * 전술 방향 하나만 놓고 봤을 때 나오는 지시.
   *
   * 화면에서 「이 방향을 고르면 무엇이 달라지나」를 보여 주는 데 쓰고,
   * 검사에서 일곱 방향이 서로 다른 지시를 내는지 확인하는 데 씁니다.
   * 방향 이름만 다르고 지시가 같으면 그건 방향이 아닙니다.
   */
  function planInstructions(planId) {
    if (!TD.PLANS[planId]) return null;
    var acc = accumulate([]);
    var top = [{ id: planId, ko: TD.PLANS[planId].ko, desc: TD.PLANS[planId].desc, score: 1 }];
    return finaliseInstructions(acc, top);
  }

  function resolvePlans(planScores) {
    var entries = Object.keys(planScores).map(function (k) {
      return { id: k, ko: TD.PLANS[k].ko, desc: TD.PLANS[k].desc, score: round1(planScores[k]) };
    }).sort(function (a, b) { return b.score - a.score; });
    var top = entries.filter(function (e) { return e.score > 0; }).slice(0, 2);
    if (!top.length) top = [Object.assign({}, entries[0], { score: 0 })];
    // 1위 대비 절반 미만인 2위는 버립니다 — 성격이 반대인 플랜을 억지로 섞으면
    // 지시가 서로 상쇄돼 아무 색도 없는 전술이 나옵니다.
    if (top.length === 2 && top[1].score < top[0].score * 0.5) top = [top[0]];
    return { ranked: entries, top: top };
  }

  function planRoleWeights(top) {
    var w = {};
    top.forEach(function (p, i) {
      var mult = i === 0 ? 1 : 0.55;
      var tags = TD.PLANS[p.id].roleTags;
      Object.keys(tags).forEach(function (t) { w[t] = (w[t] || 0) + tags[t] * mult; });
    });
    return w;
  }

  /*
   * 누적값을 몇 칸으로 옮길지.
   *
   * 그냥 Math.round(기본값 + 누적)을 쓰면 안 됩니다. 자바스크립트의 반올림은
   * 항상 +∞ 쪽으로 붙어서 Math.round(-0.5)는 -0, Math.round(0.5)는 1입니다.
   * 즉 **같은 크기로 밀어도 내리는 쪽만 한 칸 손해**를 봅니다.
   *
   * 이 비대칭이 이 코드베이스에서 나온 버그의 뿌리였습니다 — 폭을 좁히는 규칙,
   * 태클을 자제시키는 규칙, 점유의 짧은 패스가 전부 「값은 들어 있는데 아무 일도
   * 안 일어나는」 상태였습니다. 개별 값은 검사로 걸러 냈지만, 여러 근거가 더해져
   * 정확히 -0.5가 되는 것까지는 막을 수 없습니다. 실제로 맨시티 원정(열세)에서
   * 수비 라인 누적이 -0.5로 나와 라인이 안 내려갔습니다.
   *
   * 그래서 부호에 대칭이 되게 자릅니다 — ±0.5는 양쪽 다 한 칸 움직입니다.
   * 경계에서 어느 쪽으로 붙을지를 「공격 쪽」으로 고정해 둘 이유가 없습니다.
   */
  function axisStep(delta) {
    // || 0으로 -0을 0으로 되돌립니다. -0은 계산에는 지장이 없지만 비교와
    // 화면 표시에서 0과 다르게 굴어 엉뚱한 곳에서 터집니다.
    return (delta < 0 ? -Math.round(-delta) : Math.round(delta)) || 0;
  }

  function finaliseInstructions(acc, top) {
    // 플랜 효과를 축·토글에 더합니다.
    top.forEach(function (p, i) {
      var eff = PLAN_EFFECTS[p.id]; if (!eff) return;
      var mult = i === 0 ? 1 : 0.5;
      if (eff.axis) Object.keys(eff.axis).forEach(function (k) {
        acc.axis[k] += eff.axis[k] * mult;
        acc.reasons.axis[k].push({ why: '전술 방향: ' + TD.PLANS[p.id].ko, delta: eff.axis[k] * mult });
      });
      if (eff.toggle) Object.keys(eff.toggle).forEach(function (k) {
        acc.toggle[k] += eff.toggle[k] * mult;
        acc.reasons.toggle[k].push({ why: '전술 방향: ' + TD.PLANS[p.id].ko, delta: eff.toggle[k] * mult });
      });
    });

    var axes = {};
    Object.keys(TD.AXES).forEach(function (k) {
      var def = TD.AXES[k];
      var idx = clamp(def.def + axisStep(acc.axis[k]), 0, def.labels.length - 1);
      axes[k] = {
        id: k, ko: def.ko, group: def.group, index: idx, label: def.labels[idx],
        shifted: idx !== def.def, raw: round1(acc.axis[k]),
        reasons: acc.reasons.axis[k].filter(function (r) { return Math.abs(r.delta) >= 0.05; })
          .sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); })
      };
    });

    // 배타 그룹은 점수가 가장 높은 하나만 켭니다.
    var best = {};
    Object.keys(TD.TOGGLES).forEach(function (k) {
      var g = TD.TOGGLES[k].excl; if (!g) return;
      if (!best[g] || acc.toggle[k] > acc.toggle[best[g]]) best[g] = k;
    });
    var toggles = {};
    Object.keys(TD.TOGGLES).forEach(function (k) {
      var def = TD.TOGGLES[k];
      var score = acc.toggle[k];
      var on = score >= 1;
      if (def.excl && on && best[def.excl] !== k) on = false;
      toggles[k] = {
        id: k, ko: def.ko, group: def.group, on: on, score: round1(score),
        reasons: acc.reasons.toggle[k].filter(function (r) { return Math.abs(r.delta) >= 0.05; })
          .sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); })
      };
    });
    return { axes: axes, toggles: toggles };
  }

  // ── 역할 후보 ─────────────────────────────────────────────────────────
  function candidateRoles(formation, slot, fSum) {
    var out = [];
    var sideMC = null;
    if (slot.pos === 'MC') {
      var mcs = formation.slots.filter(function (s) { return s.pos === 'MC'; });
      sideMC = mcs.length >= 2 && Math.abs(slot.x - 50) > 4;
    }
    RD.ROLES.forEach(function (role) {
      if (role.pos.indexOf(slot.pos) < 0) return;
      if (role.requiresBackLine === 3 && !fSum.threeAtBack) return;
      if (role.wideOnly && Math.abs(slot.x - 50) < 5) return;
      if (role.id === 'lib' && Math.abs(slot.x - 50) > 5) return;   // 리베로는 스리백 가운데만
      if (role.requiresSideMC && !sideMC) return;
      role.duties.forEach(function (duty) {
        out.push({ role: role, duty: duty });
      });
    });
    return out;
  }

  /*
   * 역할이 지금 전술 방향과 얼마나 맞는지.
   *
   * 태그 가중치를 그냥 더하면 태그를 많이 단 역할이 자동으로 이깁니다
   * (어드밴스드 포워드는 runner·finisher·pace·in-behind·presser를 한꺼번에
   * 갖고 있어서 '뒷공간 침투' 방향에서 다섯 번 가산됩니다). 그래서 태그 수의
   * 제곱근으로 나눕니다 — 여러 축에서 맞는 역할이 여전히 유리하되,
   * 태그 개수만으로 승부가 나지는 않습니다.
   */
  /*
   * 임무(수비/지원/공격)가 전술 방향을 따라가게 하는 항.
   *
   * 임무를 능력치만으로 고르면 크로스·오프더볼이 평범한 풀백은 상대가 아무리
   * 내려앉아도 영원히 수비 임무로 남습니다 — 공격 임무의 강조 능력치가 그 선수의
   * 약점이라 점수가 떨어지기 때문입니다. 그런데 상대가 자기 진영에 열한 명을
   * 세워 놨을 때 필요한 건 크로스 15짜리 풀백이 아니라 그냥 앞으로 올라가는
   * 풀백입니다. 그래서 자리마다 "이 방향에서 이 칸이 얼마나 전진해야 하는가"를
   * 따로 두고, 임무의 전진도가 거기서 멀어질수록 깎습니다.
   */
  var LINE_BIAS = {
    GK: 0.0, DC: 0.12, DR: 0.35, DL: 0.35, WBR: 0.5, WBL: 0.5, DM: 0.2,
    MC: 0.42, MR: 0.55, ML: 0.55, AMR: 0.65, AML: 0.65, AMC: 0.72, ST: 0.85
  };
  var DUTY_WEIGHT = 12;

  function dutyBias(pos, planW, ruleRoleW, mentalityShift) {
    var base = LINE_BIAS[pos] === undefined ? 0.4 : LINE_BIAS[pos];
    base += 0.05 * (mentalityShift || 0);
    if (['DR', 'DL', 'WBR', 'WBL'].indexOf(pos) >= 0) {
      var pushed = (planW['width'] || 0) + (planW['overlap'] || 0)
        + (ruleRoleW['width'] || 0) + (ruleRoleW['overlap'] || 0);
      base += clamp(pushed * 0.05, 0, 0.25);
      if ((ruleRoleW['risk-back'] || 0) < 0) base -= 0.18;
    }
    if (['ST', 'AMC', 'AMR', 'AML'].indexOf(pos) >= 0 && (planW['presser'] || 0) > 1) base += 0.05;
    return clamp(base, 0, 1);
  }

  function dutyScore(duty, desired) {
    var w = RD.DUTIES[duty] ? RD.DUTIES[duty].attackWeight : 0.5;
    return (1 - Math.abs(w - desired)) * DUTY_WEIGHT;
  }

  function roleTagScore(role, planW, ruleRoleW) {
    var tags = role.tags || [];
    if (!tags.length) return 0;
    var s = 0;
    tags.forEach(function (t) {
      s += (planW[t] || 0) + (ruleRoleW[t] || 0);
    });
    return s / Math.sqrt(tags.length);
  }

  // ── 선발 구성 ─────────────────────────────────────────────────────────
  /*
   * 1) 슬롯마다 (역할, 임무)를 고릅니다 — 플랜 적합도와 "그 자리를 채울 수 있는
   *    최고 선수의 적합도"를 함께 봅니다.
   * 2) 그 위에 팀 균형 규칙을 적용합니다(수비 앵커 확보, 무수비 역할 제한 등).
   * 3) 선수를 헝가리안 알고리즘으로 배정합니다 — 슬롯별로 탐욕적으로 뽑으면
   *    앞 슬롯이 뒤 슬롯의 유일한 적임자를 가져가는 일이 생깁니다.
   * 4) 역할을 하나씩 바꿔 보며 총점이 오르면 유지합니다.
   */
  function buildXI(players, formation, planW, ruleRoleW, opts) {
    opts = opts || {};
    var fSum = summariseFormation(formation);
    var fitCache = opts.fitCache || {};
    var mentalityShift = opts.mentalityShift || 0;
    // 캐시 키가 선수마다 달라야 합니다. generate()를 거치지 않고 직접 부를 때를 대비해
    // 여기서도 한 번 더 확인합니다 — 키가 겹치면 전원이 같은 적합도를 받습니다.
    players.forEach(function (p, i) { if (!p._id) p._id = p.id || p.name || ('p' + i); });

    function fitOf(player, role, duty, slotPos) {
      var k = player._id + '|' + role.id + '|' + duty + '|' + slotPos;
      if (fitCache[k] === undefined) {
        var proxy = Object.create(role);
        proxy._slotPos = slotPos;
        fitCache[k] = roleFit(player, proxy, duty);
      }
      return fitCache[k];
    }

    // 같은 포지션 칸이 여러 개면(센터백 둘, 최전방 둘 …) 각 칸이 실제로 쓸 수 있는
    // 선수는 1순위가 아니라 순번에 맞는 선수입니다. 모든 칸이 1순위 기준으로
    // 역할을 고르면 두 칸에 똑같은 역할이 앉고, 2순위 선수의 성격은 무시됩니다.
    var posRank = {};
    var slots = formation.slots.map(function (slot) {
      var rank = posRank[slot.pos] = (posRank[slot.pos] === undefined ? 0 : posRank[slot.pos] + 1);
      // 이 자리를 실제로 볼 수 있는 선수들. 역할별 기준선을 낼 때 스쿼드 전체를
      // 쓰면 골키퍼와 공격수가 센터백 기준선에 섞여 들어갑니다.
      var eligible = players.filter(function (p) { return positionFamiliarity(p, slot.pos) >= 0.6; });
      if (eligible.length < 4) {
        eligible = players.slice().sort(function (a, b) {
          return positionFamiliarity(b, slot.pos) - positionFamiliarity(a, slot.pos);
        }).slice(0, Math.min(6, players.length));
      }
      var desired = dutyBias(slot.pos, planW, ruleRoleW, mentalityShift);
      var cands = candidateRoles(formation, slot, fSum).map(function (c) {
        var fits = players.map(function (p) { return fitOf(p, c.role, c.duty, slot.pos).score; })
          .sort(function (a, b) { return b - a; });
        var baseline = avg(eligible.map(function (p) { return fitOf(p, c.role, c.duty, slot.pos).score; }));
        var pick = fits[Math.min(rank, fits.length - 1)] || 0;
        return {
          role: c.role, duty: c.duty,
          tagScore: roleTagScore(c.role, planW, ruleRoleW),
          dutyScore: dutyScore(c.duty, desired),
          bestFit: pick,
          topFit: fits[0] || 0,
          // 역할끼리의 적합도 절대값은 비교할 수 없습니다 — key 능력치가 적은 역할이
          // 누구에게나 높게 나오기 때문입니다. 그 역할의 스쿼드 평균을 빼면
          // "이 선수가 이 역할에 유난히 맞는가"만 남습니다.
          fitTerm: pick - baseline,
          baseline: baseline
        };
      });
      return { slot: slot, cands: cands, choice: null };
    });

    // 1) 초기 선택
    slots.forEach(function (s) {
      s.cands.sort(function (a, b) { return comboScore(b) - comboScore(a); });
      s.choice = s.cands[0];
    });
    function comboScore(c) { return c.fitTerm + c.tagScore * TAG_WEIGHT + c.dutyScore; }

    // 측면 수비 둘을 동시에 올려도 되는 방향인지 — 폭과 오버랩을 강하게 요구하고,
    // 뒤를 조심하라는 규칙이 없을 때만 허용합니다.
    var allowBothWide = (ruleRoleW['risk-back'] || 0) >= 0
      && (planW['overlap'] || 0) + (planW['width'] || 0)
       + (ruleRoleW['overlap'] || 0) + (ruleRoleW['width'] || 0) > 1.5;

    // 2) 팀 균형 보정 — 시작점을 성립하는 조합으로 옮겨 둡니다.
    applyBalance(slots, fSum, planW, ruleRoleW, comboScore, allowBothWide);

    // 3) 선수 배정 + 4) 역할 재검토
    var assigned = assignPlayers(slots, players, fitOf);
    // fast 모드는 재검토를 건너뜁니다. 기본 전술을 고를 때는 (플랜 7종 × 포메이션
    // 20종) 140가지를 훑어야 해서, 후보 추리기에는 초기 선택만으로 충분합니다.
    // 최종적으로 고른 하나에는 다시 전체 계산을 돌립니다.
    for (var pass = 0; pass < (opts.fast ? 0 : 3); pass++) {
      var improved = false;
      for (var i = 0; i < slots.length; i++) {
        var s = slots[i];
        var current = s.choice, currentTotal = totalScore(slots, assigned, fitOf, fSum, allowBothWide);
        for (var j = 0; j < s.cands.length && j < 10; j++) {
          if (s.cands[j] === current) continue;
          s.choice = s.cands[j];
          var trial = assignPlayers(slots, players, fitOf);
          var t = totalScore(slots, trial, fitOf, fSum, allowBothWide);
          if (t > currentTotal + 0.01) {
            currentTotal = t; current = s.cands[j]; assigned = trial; improved = true;
          }
        }
        s.choice = current;
      }
      if (!improved) break;
    }
    assigned = assignPlayers(slots, players, fitOf);

    var lineup = slots.map(function (s, i) {
      var p = assigned[i];
      var fit = p ? fitOf(p, s.choice.role, s.choice.duty, s.slot.pos) : null;
      return {
        slot: s.slot,
        role: s.choice.role,
        duty: s.choice.duty,
        tagScore: round1(s.choice.tagScore),
        player: p || null,
        fit: fit ? Math.round(fit.score) : null,
        familiarity: fit ? fit.familiarity : null,
        coverage: fit ? fit.coverage : null,
        alternatives: s.cands.slice(0, 4).filter(function (c) { return c !== s.choice; }).slice(0, 3)
          .map(function (c) { return { role: c.role, duty: c.duty }; })
      };
    });

    return {
      formation: formation,
      summary: fSum,
      lineup: lineup,
      teamFit: Math.round(avg(lineup.map(function (l) { return l.fit || 0; }))),
      planFit: round1(avg(lineup.map(function (l) { return l.tagScore; })))
    };
  }

  /*
   * 전술 방향이 역할을 고르고, 스쿼드가 그 자리에 앉을 선수를 고릅니다.
   * TAG_WEIGHT는 그 둘 사이의 환율입니다.
   *
   * 이 값이 높으면 "지금 방향에 맞는 역할"이 "그 역할을 할 수 있는 선수"를
   * 이깁니다 — 발이 느린 제공권형 공격수를 어드밴스드 포워드로 세우는 식입니다.
   * 낮으면 반대로 스쿼드가 전술을 통째로 결정해 상대가 누구든 같은 답이 나옵니다.
   * 적합도 3~4점(자연스러운 자리와 어색한 자리의 차이보다 작은 폭)을
   * 태그 1점과 맞바꾸는 지점에서 양쪽이 다 살아 있었습니다.
   */
  var TAG_WEIGHT = 3.5;

  // 같은 포지션 칸에 완전히 같은 역할+임무가 앉을 때의 감점.
  // 금지가 아니라 감점입니다 — 센터백 둘이 모두 '센터백/수비'인 조합은 정상입니다.
  var DUPLICATE_PENALTY = 7;

  /*
   * 팀 단위로 성립하지 않는 조합에 매기는 감점.
   * 이 계산은 반드시 총점 안에 있어야 합니다. 초기 선택에서 한 번만 손보면
   * 뒤이은 역할 재검토가 그걸 그대로 되돌립니다(플레이메이커 넷이 그렇게 나옵니다).
   */
  function balancePenalty(slots, fSum, allowBothWide) {
    var pen = 0;
    var seen = {};
    var counts = { playmaker: 0, 'no-defence': 0 };
    var attackDuties = 0, wideAttacking = 0, dmSlots = 0, dmAnchored = 0;
    var mcSlots = 0, mcHolder = 0;
    // 형태가 성립하려면 반드시 있어야 하는 것들.
    var widthHolders = 0, runners = 0, strikers = 0, droppingStrikers = 0;
    var narrowSide = { l: 0, r: 0 };

    for (var i = 0; i < slots.length; i++) {
      var s = slots[i], role = s.choice.role, duty = s.choice.duty;
      var tags = role.tags || [];
      var k = s.slot.pos + '|' + role.id + '|' + duty;
      if (seen[k]) pen += DUPLICATE_PENALTY;
      seen[k] = 1;

      if (tags.indexOf('playmaker') >= 0) counts.playmaker++;
      if (tags.indexOf('no-defence') >= 0) counts['no-defence']++;
      if (duty === 'a') attackDuties++;

      var goesIn = tags.indexOf('inverted') >= 0 || tags.indexOf('narrow-drift') >= 0;
      if (!goesIn && (tags.indexOf('width') >= 0 || tags.indexOf('overlap') >= 0 || tags.indexOf('crosser') >= 0)
          && duty !== 'd') widthHolders++;
      if (tags.indexOf('in-behind') >= 0 || tags.indexOf('runner') >= 0
          || tags.indexOf('late-run') >= 0 || tags.indexOf('poacher-wide') >= 0) runners++;
      if (s.slot.pos === 'ST') {
        strikers++;
        if (tags.indexOf('drop-deep') >= 0) droppingStrikers++;
      }
      if (goesIn && ['DR', 'DL', 'WBR', 'WBL', 'MR', 'ML', 'AMR', 'AML'].indexOf(s.slot.pos) >= 0) {
        narrowSide[s.slot.pos.slice(-1) === 'L' ? 'l' : 'r']++;
      }

      if (['DR', 'DL', 'WBR', 'WBL'].indexOf(s.slot.pos) >= 0) {
        if (duty === 'a' || tags.indexOf('risk-back') >= 0) wideAttacking++;
      }
      if (s.slot.pos === 'DM') {
        dmSlots++;
        if ((tags.indexOf('holder') >= 0 || tags.indexOf('defensive-cover') >= 0) && duty !== 'a') dmAnchored++;
      }
      if (s.slot.pos === 'MC') {
        mcSlots++;
        if (duty === 'd' || tags.indexOf('holder') >= 0 || tags.indexOf('ballwinner') >= 0) mcHolder++;
      }
    }

    // 볼이 몰리는 역할은 최대 둘. 셋째부터는 서로의 발을 밟습니다.
    if (counts.playmaker > 2) pen += (counts.playmaker - 2) * 26;
    // 수비를 아예 하지 않는 역할은 하나까지.
    if (counts['no-defence'] > 1) pen += (counts['no-defence'] - 1) * 42;
    // 박스 안에 들어갈 사람이 없는 조합.
    if (attackDuties === 0) pen += 30;
    else if (attackDuties >= 5) pen += (attackDuties - 4) * 10;
    // 양쪽 측면 수비가 동시에 비워지는 조합.
    if (wideAttacking >= 2 && !allowBothWide) pen += 18;
    // 수비형 미드필더 자리가 있는데 아무도 뒤를 지키지 않는 조합.
    if (dmSlots > 0 && dmAnchored === 0) pen += 24;
    // 수비형 미드필더 자리가 없고 중앙이 셋 이상인데 균형을 잡는 사람이 없는 조합.
    if (!fSum.dm && mcSlots >= 3 && mcHolder === 0) pen += 18;

    /*
     * 아래 넷은 "적합도가 아무리 높아도 형태가 성립하지 않는" 조합입니다.
     * 역할 적합도만 보면 인버티드 계열이 능력치 좋은 선수에게 잘 붙어서,
     * 양쪽 측면이 모두 안으로 들어오는 11명이 태연히 1등을 합니다.
     */
    // 아무도 폭을 잡지 않으면 상대 블록이 좌우로 늘어나지 않습니다.
    if (widthHolders === 0) pen += 40;
    // 뒷공간으로 달리는 사람이 없으면 최종 패스를 넣을 곳이 없습니다.
    if (runners === 0) pen += 34;
    // 한쪽 측면의 앞뒤가 모두 안으로 들어오면 그 측면이 통째로 빕니다.
    ['l', 'r'].forEach(function (side) { if (narrowSide[side] >= 2) pen += 30; });
    // 최전방이 전부 내려오는데 그 공간을 쓸 사람이 없는 조합.
    if (strikers > 0 && droppingStrikers === strikers && runners === 0) pen += 26;

    return pen;
  }

  function totalScore(slots, assigned, fitOf, fSum, allowBothWide) {
    var t = 0;
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i], p = assigned[i];
      t += s.choice.tagScore * TAG_WEIGHT + s.choice.dutyScore;
      if (p) t += fitOf(p, s.choice.role, s.choice.duty, s.slot.pos).score;
    }
    return t - balancePenalty(slots, fSum, allowBothWide);
  }

  /*
   * 팀 균형 — 개별 슬롯에서 최고점인 역할을 모아 놓으면 팀으로는 성립하지 않는
   * 조합이 자주 나옵니다(수비 안 하는 역할 세 개, 플레이메이커 세 명 등).
   * 여기서 그런 조합을 뒤로 물립니다.
   */
  function applyBalance(slots, fSum, planW, ruleRoleW, comboScore, allowBothWide) {
    function tagCount(tag) {
      return slots.filter(function (s) { return (s.choice.role.tags || []).indexOf(tag) >= 0; }).length;
    }
    // 수비를 하지 않는 역할은 최대 하나.
    var guard = 0;
    while (tagCount('no-defence') > 1 && guard++ < 6) {
      var worst = null;
      slots.forEach(function (s) {
        if ((s.choice.role.tags || []).indexOf('no-defence') < 0) return;
        if (!worst || comboScore(s.choice) < comboScore(worst.choice)) worst = s;
      });
      if (!worst) break;
      var alt = worst.cands.filter(function (c) { return (c.role.tags || []).indexOf('no-defence') < 0; })[0];
      if (!alt) break;
      worst.choice = alt;
    }

    // 볼이 몰리는 플레이메이커 계열은 최대 둘.
    guard = 0;
    while (tagCount('playmaker') > 2 && guard++ < 6) {
      var w2 = null;
      slots.forEach(function (s) {
        if ((s.choice.role.tags || []).indexOf('playmaker') < 0) return;
        if (!w2 || comboScore(s.choice) < comboScore(w2.choice)) w2 = s;
      });
      if (!w2) break;
      var a2 = w2.cands.filter(function (c) { return (c.role.tags || []).indexOf('playmaker') < 0; })[0];
      if (!a2) break;
      w2.choice = a2;
    }

    // 수비형 미드필더 자리가 있으면 그중 하나는 반드시 뒤를 지킵니다.
    var dmSlots = slots.filter(function (s) { return s.slot.pos === 'DM'; });
    if (dmSlots.length) {
      var anchored = dmSlots.some(function (s) {
        var t = s.choice.role.tags || [];
        return (t.indexOf('holder') >= 0 || t.indexOf('defensive-cover') >= 0) && s.choice.duty !== 'a';
      });
      if (!anchored) {
        var target = dmSlots[dmSlots.length - 1];
        var altD = target.cands.filter(function (c) {
          var t = c.role.tags || [];
          return (t.indexOf('holder') >= 0 || t.indexOf('defensive-cover') >= 0) && c.duty !== 'a';
        })[0];
        if (altD) target.choice = altD;
      }
    }

    // 수비형 미드필더 자리가 없는데 중앙 미드필더가 셋이면 한 명은 수비 임무로.
    if (!fSum.dm && fSum.counts.MC >= 3) {
      var mcs = slots.filter(function (s) { return s.slot.pos === 'MC'; });
      var hasHolder = mcs.some(function (s) {
        var t = s.choice.role.tags || [];
        return s.choice.duty === 'd' || t.indexOf('holder') >= 0 || t.indexOf('ballwinner') >= 0;
      });
      if (!hasHolder) {
        var m = mcs[Math.floor(mcs.length / 2)];
        var altM = m.cands.filter(function (c) {
          var t = c.role.tags || [];
          return c.duty === 'd' || t.indexOf('ballwinner') >= 0 || t.indexOf('holder') >= 0;
        })[0];
        if (altM) m.choice = altM;
      }
    }

    // 양쪽 측면 수비가 동시에 공격 임무가 되지 않게 합니다(전진 성향이 강한 플랜이 아니면).
    var wide = slots.filter(function (s) { return ['DR', 'DL', 'WBR', 'WBL'].indexOf(s.slot.pos) >= 0; });
    var attackingWide = wide.filter(function (s) { return s.choice.duty === 'a' || (s.choice.role.tags || []).indexOf('risk-back') >= 0; });
    if (attackingWide.length >= 2 && !allowBothWide) {
      var drop = attackingWide.reduce(function (a, b) { return comboScore(a.choice) <= comboScore(b.choice) ? a : b; });
      var altW = drop.cands.filter(function (c) {
        return c.duty !== 'a' && (c.role.tags || []).indexOf('risk-back') < 0;
      })[0];
      if (altW) drop.choice = altW;
    }

    // 박스 안에 들어갈 사람이 아무도 없는 조합을 막습니다.
    var attackDuties = slots.filter(function (s) { return s.choice.duty === 'a'; }).length;
    if (attackDuties === 0) {
      var fwd = slots.filter(function (s) { return ['ST', 'AMC', 'AMR', 'AML'].indexOf(s.slot.pos) >= 0; });
      if (fwd.length) {
        var f = fwd[0];
        var altF = f.cands.filter(function (c) { return c.duty === 'a'; })[0];
        if (altF) f.choice = altF;
      }
    }
    return slots;
  }

  // 헝가리안 알고리즘(최소 비용 완전 매칭, e-maxx 판본). rows<=cols.
  function hungarian(cost) {
    var n = cost.length, m = cost[0].length;
    var INF = Infinity;
    var u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0);
    var p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
    for (var i = 1; i <= n; i++) {
      p[0] = i;
      var j0 = 0;
      var minv = new Array(m + 1).fill(INF);
      var used = new Array(m + 1).fill(false);
      do {
        used[j0] = true;
        var i0 = p[j0], delta = INF, j1 = -1;
        for (var j = 1; j <= m; j++) {
          if (used[j]) continue;
          var cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (var k = 0; k <= m; k++) {
          if (used[k]) { u[p[k]] += delta; v[k] -= delta; }
          else minv[k] -= delta;
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do { var j2 = way[j0]; p[j0] = p[j2]; j0 = j2; } while (j0);
    }
    var res = new Array(n).fill(-1);
    for (var jj = 1; jj <= m; jj++) if (p[jj]) res[p[jj] - 1] = jj - 1;
    return res;
  }

  function assignPlayers(slots, players, fitOf) {
    var n = slots.length;
    if (!players.length) return new Array(n).fill(null);
    var m = Math.max(players.length, n);
    var cost = [];
    for (var i = 0; i < n; i++) {
      var row = [];
      for (var j = 0; j < m; j++) {
        if (j >= players.length) { row.push(1000); continue; }
        var f = fitOf(players[j], slots[i].choice.role, slots[i].choice.duty, slots[i].slot.pos);
        row.push(100 - f.score);
      }
      cost.push(row);
    }
    var res = hungarian(cost);
    return res.map(function (j) { return j >= 0 && j < players.length ? players[j] : null; });
  }

  /*
   * 선발이 정해진 뒤에야 정할 수 있는 지시.
   *
   * 오버랩과 언더랩이 대표적입니다. 둘은 "측면을 공격한다"는 같은 말이 아니라
   * 정반대의 배치입니다 — 오버랩은 풀백이 측면 선수 바깥으로 돌고, 언더랩은
   * 안쪽(하프 스페이스)으로 들어갑니다. 어느 쪽이 맞는지는 그 측면 선수가
   * 안으로 좁히는 유형인지 폭을 잡는 유형인지로 갈립니다. 상대만 보고는 정할 수
   * 없어서, 선발을 짠 뒤에 여기서 정합니다.
   */
  function contextualInstructions(acc, xi, opp, ctx, planTop) {
    if (!xi || !xi.lineup) return;
    var lineup = xi.lineup;
    var planIds = (planTop || []).map(function (p) { return p.id; });
    function push(id, delta, why) {
      if (acc.toggle[id] === undefined) return;
      acc.toggle[id] += delta;
      acc.reasons.toggle[id].push({ why: why, delta: delta });
    }
    function slotAt() {
      var want = Array.prototype.slice.call(arguments);
      return lineup.filter(function (l) { return want.indexOf(l.slot.pos) >= 0; })[0] || null;
    }
    function has(tagList, l) {
      var t = (l.role.tags || []);
      return tagList.some(function (x) { return t.indexOf(x) >= 0; });
    }
    function attrOf(l, id) {
      var v = l.player && l.player.attrs ? l.player.attrs[id] : null;
      return (typeof v === 'number' && v > 0) ? v : null;
    }

    // ── 오버랩 / 언더랩 ──────────────────────────────────────────────
    [['l', 'AML', 'ML', 'DL', 'WBL', '왼쪽', 'ovl_l', 'unl_l'],
     ['r', 'AMR', 'MR', 'DR', 'WBR', '오른쪽', 'ovl_r', 'unl_r']].forEach(function (S) {
      var wideAtt = slotAt(S[1], S[2]);
      var wideDef = slotAt(S[3], S[4]);
      var sideKo = S[5], OVL = S[6], UNL = S[7];
      if (!wideAtt || !wideDef) {
        // 측면 자원이 없으면 풀백 자신이 폭입니다 — 겹칠 상대가 없습니다.
        push(OVL, -1.5, sideKo + ' 측면에 앞선 자원이 없어 겹쳐 뛸 상대가 없습니다.');
        push(UNL, -1.5, sideKo + ' 측면에 앞선 자원이 없어 겹쳐 뛸 상대가 없습니다.');
        return;
      }
      if (wideDef.duty === 'd') {
        push(OVL, -2, sideKo + ' 측면 수비가 수비 임무라 올라가지 않습니다.');
        push(UNL, -2, sideKo + ' 측면 수비가 수비 임무라 올라가지 않습니다.');
        return;
      }
      var inverted = has(['inverted', 'narrow-drift'], wideAtt);
      var holdsWidth = !inverted && has(['width', 'crosser'], wideAtt);
      // 인버티드 풀백·윙백은 역할 자체가 안쪽으로 들어옵니다. 그 선수에게
      // 오버랩을 시키는 건 말이 안 되고, 언더랩은 이미 하고 있는 일입니다.
      var defGoesWide = !has(['inverted'], wideDef);
      var attKo = wideAtt.role.ko, defKo = wideDef.role.ko;
      if (inverted && defGoesWide) {
        push(OVL, 1.4, sideKo + ' ' + attKo + iga(attKo) + ' 안으로 좁히므로 ' + defKo + iga(defKo) + ' 바깥으로 돌아야 폭이 생깁니다.');
        push(UNL, -2, sideKo + ' ' + attKo + iga(attKo) + ' 이미 안쪽에 있어 언더랩과 같은 공간을 씁니다.');
      } else if (inverted) {
        // 앞뒤가 모두 안으로 들어옵니다 — 지시로 될 문제가 아니라 조합 문제입니다.
        push(OVL, -1.5, sideKo + ' ' + attKo + wa(attKo) + ' ' + defKo + ' 둘 다 안으로 들어와 오버랩할 사람이 없습니다.');
        push(UNL, -1.5, sideKo + ' ' + attKo + wa(attKo) + ' ' + defKo + ' 둘 다 안쪽 공간을 씁니다.');
      } else if (holdsWidth && !defGoesWide) {
        push(UNL, -1.5, sideKo + ' ' + defKo + eun(defKo) + ' 역할 자체가 안쪽으로 들어오므로 언더랩 지시가 겹칩니다.');
        push(OVL, -1.5, sideKo + ' ' + attKo + iga(attKo) + ' 측면을 잡고 있어 오버랩할 공간이 없습니다.');
      } else if (holdsWidth) {
        push(UNL, 1.4, sideKo + ' ' + attKo + iga(attKo) + ' 측면을 잡고 있으므로 ' + defKo + eun(defKo) + ' 안쪽 하프 스페이스로 들어가야 겹치지 않습니다.');
        push(OVL, -2, sideKo + ' ' + attKo + iga(attKo) + ' 이미 측면에 있어 오버랩하면 같은 자리에 둘이 섭니다.');
      }
    });

    // ── 크로스 종류 ─────────────────────────────────────────────────
    var boxMen = lineup.filter(function (l) { return ['ST', 'AMC'].indexOf(l.slot.pos) >= 0; });
    var bestAerial = null, fastest = null;
    boxMen.forEach(function (l) {
      var hea = attrOf(l, 'hea'), jum = attrOf(l, 'jum'), pac = attrOf(l, 'pac');
      if (hea !== null && jum !== null && (!bestAerial || hea + jum > bestAerial.v)) bestAerial = { l: l, v: hea + jum, hea: hea, jum: jum };
      if (pac !== null && (!fastest || pac > fastest.v)) fastest = { l: l, v: pac };
    });
    if (bestAerial && bestAerial.hea >= 15 && bestAerial.jum >= 15) {
      push('cr_float', 1.2, bestAerial.l.player.name + '의 헤딩 ' + bestAerial.hea + ' · 점프 ' + bestAerial.jum + ' — 띄워 주면 경합에서 이깁니다.');
    } else if (bestAerial && bestAerial.hea >= 13) {
      push('cr_whip', 1.2, bestAerial.l.player.name + '의 제공권이 압도적이지는 않습니다(헤딩 ' + bestAerial.hea + ') — 빠르게 휘어 들어가는 공이 경합을 줄여 줍니다.');
    } else if (fastest && fastest.v >= 15) {
      push('cr_low', 1.2, fastest.l.player.name + '의 속도 ' + fastest.v + ' — 제공권 대신 낮고 빠른 공으로 달려 들어가게 합니다.');
    }
    // 골라인까지 vs 깊은 지점 — 측면 선수가 뚫을 수 있으면 끝까지, 아니면 일찍.
    var wideMen = lineup.filter(function (l) { return ['AMR', 'AML', 'MR', 'ML'].indexOf(l.slot.pos) >= 0; });
    var dribbler = wideMen.some(function (l) { return (attrOf(l, 'dri') || 0) >= 14 && (attrOf(l, 'acc') || 0) >= 14; });
    var crosser = wideMen.some(function (l) { return (attrOf(l, 'cro') || 0) >= 14; });
    if (planIds.indexOf('wide-cross') >= 0 || acc.toggle.cr_float > 0 || acc.toggle.cr_whip > 0) {
      if (dribbler) push('cr_byline', 1, '측면에 상대를 벗겨낼 수 있는 선수가 있어 골라인까지 파고드는 편이 낫습니다.');
      else if (crosser) push('cr_deep', 1, '측면 선수가 돌파형은 아니지만 크로스가 좋습니다 — 깊이 들어가기 전에 올리는 편이 낫습니다.');
    }

    // ── 골키퍼 배급 대상 ────────────────────────────────────────────
    var deepPm = lineup.filter(function (l) {
      return ['DM', 'MC'].indexOf(l.slot.pos) >= 0 && has(['playmaker', 'creator-deep'], l);
    })[0];
    var buildCb = lineup.filter(function (l) {
      return l.slot.pos === 'DC' && has(['buildout'], l);
    })[0];
    var oppPress = opp && opp.press >= 3 && opp.loe >= 3;
    if (!oppPress) {
      if (deepPm) {
        push('gk_pm', 1.2, deepPm.player
          ? (deepPm.player.name + iga(deepPm.player.name) + ' ' + deepPm.role.ko + ro(deepPm.role.ko) + ' 배급을 맡습니다 — 골키퍼가 그쪽으로 주면 전개가 한 단계 빨라집니다.')
          : '후방 배급을 맡는 역할이 있습니다.');
      } else if (buildCb) {
        push('gk_cb', 1.2, buildCb.role.ko + iga(buildCb.role.ko) + ' 있어 센터백에서 전개를 시작할 수 있습니다.');
      } else {
        var fb = slotAt('DR', 'DL', 'WBR', 'WBL');
        if (fb && fb.duty !== 'd') {
          push('gk_fb', 1, '후방에 배급을 맡을 역할이 없습니다 — 압박이 덜한 측면 수비로 빼는 편이 안전합니다.');
        }
      }
    }

    // ── 천천히 진행 ─────────────────────────────────────────────────
    if ((ctx && ctx.goal === 'draw-ok') || planIds.indexOf('low-block') >= 0) {
      push('distslow', 1.2, ctx && ctx.goal === 'draw-ok'
        ? '무승부도 받아들일 수 있는 경기입니다 — 골키퍼가 서둘러 내보낼 이유가 없습니다.'
        : '내려앉는 방향이라 골키퍼가 급하게 내보내면 그대로 소유권을 넘깁니다.');
    }

    // ── 안쪽/바깥쪽 유도 ────────────────────────────────────────────
    // 상대가 중앙이 두꺼우면 바깥으로 밀어냅니다. 단 우리 측면이 버틸 수 있을 때만.
    var ourSum = summariseFormation(xi.formation);
    if (opp && opp.formationId && FORMATION_BY_ID[opp.formationId]) {
      var t = summariseFormation(FORMATION_BY_ID[opp.formationId]);
      var centreGap = t.centre - ourSum.centre;
      var wideOk = ourSum.wideCover >= t.wideAttack + 1;
      if ((centreGap >= 1 || (opp.traits || []).indexOf('playmaker-amc') >= 0) && wideOk) {
        push('trap_out', 1.3, centreGap >= 1
          ? ('상대 중앙 인원이 ' + centreGap + '명 많습니다 — 중앙에서 맞붙지 말고 바깥으로 밀어내는 편이 낫습니다(우리 측면은 ' + ourSum.wideCover + '명으로 버팁니다).')
          : '상대 중앙에 경기를 만드는 선수가 있습니다 — 공을 바깥으로 밀어내면 그 선수를 거치지 않게 됩니다.');
      }
    }
  }

  /*
   * ── 역할 조합 충돌 검사 ─────────────────────────────────────────────────
   *
   * 지시나 상대를 보지 않고 11자리의 역할·임무만으로 판정합니다.
   * 개별 규칙을 그때그때 덧붙이던 방식은 새 조합이 생길 때마다 조용히 새는데,
   * 여기서는 "무엇이 있어야 하는가"를 한자리에 모아 한 번에 셉니다.
   *
   * 각 항목에 fix(무엇을 하면 되는가)를 함께 답니다 — 무엇이 잘못됐는지만
   * 알려 주고 끝내면 화면 앞에서 다시 막힙니다.
   */
  function chemistry(xi) {
    var out = [];
    var lineup = xi.lineup;
    function tagsOf(l) { return l.role.tags || []; }
    function count(tag) { return lineup.filter(function (l) { return tagsOf(l).indexOf(tag) >= 0; }).length; }
    function countAny(list) {
      return lineup.filter(function (l) {
        return list.some(function (t) { return tagsOf(l).indexOf(t) >= 0; });
      }).length;
    }
    function at(pos) { return lineup.filter(function (l) { return l.slot.pos === pos; })[0] || null; }
    function add(kind, level, text, fix) { out.push({ kind: kind, level: level, text: text, fix: fix }); }

    // ── 있어야 할 것이 없는 경우 ──
    // 폭을 잡는 사람. 아무도 없으면 상대 블록이 좌우로 늘어나지 않아
    // 중앙이 영원히 닫혀 있습니다.
    var widthHolders = lineup.filter(function (l) {
      var t = tagsOf(l);
      if (t.indexOf('inverted') >= 0 || t.indexOf('narrow-drift') >= 0) return false;
      return t.indexOf('width') >= 0 || t.indexOf('overlap') >= 0 || t.indexOf('crosser') >= 0;
    });
    if (widthHolders.length === 0) {
      add('no-width', 'high',
        '측면 폭을 잡는 선수가 한 명도 없습니다 — 열한 명이 전부 안쪽에 섭니다.',
        '측면 수비 한 명을 윙백이나 풀백(지원 이상)으로 바꾸거나, 측면 공격수 한 명을 윙어로 돌리세요.');
    }

    // 뒷공간으로 달리는 사람. 없으면 최종 패스를 넣을 곳 자체가 없습니다.
    if (countAny(['in-behind', 'runner', 'late-run', 'poacher-wide']) === 0) {
      add('no-runner', 'high',
        '앞으로 달려 들어가는 역할이 없습니다 — 상대 수비 라인을 뒤로 밀 사람이 없어 전방에 패스를 넣을 공간이 생기지 않습니다.',
        '최전방을 어드밴스드 포워드·포처 계열로 바꾸거나, 2선에 섀도 스트라이커를 넣으세요.');
    }

    // 경기를 만드는 사람.
    if (countAny(['creator', 'creator-deep', 'playmaker']) === 0) {
      add('no-creator', 'mid',
        '공격을 만드는 역할이 없습니다 — 볼을 앞으로 옮길 수는 있어도 마지막 패스를 넣을 사람이 없습니다.',
        '중원 한 자리를 어드밴스드 플레이메이커나 딥 라잉 플레이메이커로 바꾸세요.');
    }

    // 박스 안 제공권. 크로스·세트피스가 전부 여기에 걸립니다.
    if (countAny(['aerial', 'target']) === 0) {
      add('no-aerial', 'mid',
        '박스 안에서 공중볼을 다툴 역할이 없습니다 — 크로스와 코너킥이 그대로 상대 공이 됩니다.',
        '최전방을 타깃 포워드·컴플리트 포워드 계열로 바꾸거나, 크로스 위주 방향을 접고 땅으로 들어가세요.');
    }

    // ── 너무 많은 경우 ──
    var attackDuties = lineup.filter(function (l) { return l.duty === 'a'; }).length;
    if (attackDuties === 0) {
      add('no-attack-duty', 'high',
        '공격 임무가 한 명도 없습니다 — 박스 안으로 들어가는 선수가 없어 크로스와 컷백이 전부 낭비됩니다.',
        '최전방이나 2선 한 자리를 공격 임무로 올리세요.');
    } else if (attackDuties >= 5) {
      add('too-many-attack-duty', 'mid',
        '공격 임무가 ' + attackDuties + '명입니다 — 뺏겼을 때 되돌아올 사람이 부족합니다.',
        '측면 수비 한쪽을 지원이나 수비로 내리세요. 양쪽을 동시에 올린 상태가 가장 위험합니다.');
    }

    if (count('no-defence') >= 2) {
      add('no-defence', 'high',
        '수비에 가담하지 않는 역할이 둘 이상입니다 — 수비 시 사실상 9명으로 싸우게 됩니다.',
        '둘 중 하나를 압박에 가담하는 역할(프레싱 포워드 · 인사이드 포워드)로 바꾸세요.');
    }
    if (count('playmaker') >= 3) {
      add('too-many-playmakers', 'mid',
        '플레이메이커 계열이 셋입니다 — 볼이 한 곳으로 모이지 않고 분산돼 오히려 공격 경로가 흐려집니다.',
        '하나만 남기고 나머지는 볼을 앞으로 나르는 역할(박스 투 박스 · 카릴레로)로 바꾸세요.');
    }
    if (count('roam') >= 3) {
      add('too-many-roam', 'mid',
        '자유롭게 움직이는 역할이 ' + count('roam') + '명입니다 — 서로 같은 공간으로 흘러 대형이 유지되지 않습니다.',
        '중원에 자리를 지키는 역할(앵커 맨 · 카릴레로 · 딥 라잉 플레이메이커)을 하나 두세요.');
    }

    // ── 서로 부딪히는 경우 ──
    // 같은 측면에서 앞뒤가 모두 안쪽으로 들어오면 그 측면이 통째로 빕니다.
    ['l', 'r'].forEach(function (side) {
      var sideKo = side === 'l' ? '왼쪽' : '오른쪽';
      var wideAtt = at(side === 'l' ? 'AML' : 'AMR') || at(side === 'l' ? 'ML' : 'MR');
      var back = at(side === 'l' ? 'DL' : 'DR') || at(side === 'l' ? 'WBL' : 'WBR');
      if (!wideAtt || !back) return;
      var attIn = tagsOf(wideAtt).some(function (t) { return t === 'inverted' || t === 'narrow-drift'; });
      var backIn = tagsOf(back).indexOf('inverted') >= 0;
      var backStays = back.duty === 'd';
      if (attIn && backIn) {
        add('both-inverted-' + side, 'high',
          sideKo + ' 측면에서 ' + wideAtt.role.ko + wa(wideAtt.role.ko) + ' ' + back.role.ko + iga(back.role.ko) + ' 둘 다 안으로 들어옵니다 — 그쪽 측면에 아무도 없습니다.',
          '뒤를 일반 풀백이나 윙백으로 바꿔 폭을 맡기세요. 둘 다 안쪽 역할이면 오버랩·언더랩 어느 쪽도 켤 수 없습니다.');
      } else if (attIn && backStays) {
        add('side-no-width-' + side, 'mid',
          sideKo + ' 측면에서 ' + wideAtt.role.ko + iga(wideAtt.role.ko) + ' 안으로 들어오는데 뒤의 ' + back.role.ko + eun(back.role.ko) + ' 올라가지 않습니다 — 그쪽 폭이 사라집니다.',
          '뒤의 임무를 지원 이상으로 올리고 그쪽 오버랩을 켜세요.');
      }
    });

    // 양쪽 측면 수비가 모두 올라가는데 앞을 받칠 사람이 없는 경우
    var backs = ['DR', 'DL', 'WBR', 'WBL'].map(at).filter(Boolean);
    var bothUp = backs.filter(function (l) { return l.duty === 'a'; }).length >= 2;
    var hasHolder = lineup.some(function (l) {
      return ['DM', 'MC'].indexOf(l.slot.pos) >= 0
        && (tagsOf(l).indexOf('holder') >= 0 || tagsOf(l).indexOf('defensive-cover') >= 0 || l.duty === 'd');
    });
    if (bothUp && !hasHolder) {
      add('no-cover-behind', 'high',
        '양쪽 측면 수비가 모두 공격 임무인데 그 앞을 받칠 중원이 없습니다 — 뺏기면 센터백 둘이 그대로 노출됩니다.',
        '수비형 미드필더 한 명을 수비 임무(앵커 맨 · 홀딩 미드필더)로 두거나, 한쪽 측면 수비를 지원으로 내리세요.');
    }

    // 최전방이 내려오는데 그 공간을 쓸 사람이 없는 경우
    var st = lineup.filter(function (l) { return l.slot.pos === 'ST'; });
    var dropping = st.filter(function (l) { return tagsOf(l).indexOf('drop-deep') >= 0; });
    if (dropping.length && st.length === dropping.length
        && countAny(['runner', 'late-run', 'in-behind']) === 0) {
      add('empty-front', 'high',
        '최전방이 ' + dropping[0].role.ko + ira(dropping[0].role.ko) + ' 내려오는데 그 빈 공간으로 들어갈 선수가 없습니다 — 상대 센터백이 아무도 안 따라 나옵니다.',
        '2선이나 측면에 침투하는 역할(섀도 스트라이커 · 인사이드 포워드 공격 · 메잘라)을 넣거나, 최전방을 앞에 남는 역할로 바꾸세요.');
    }

    // ── 세트피스를 찰 사람 ──
    var bestCorner = 0, bestFk = 0, known = 0;
    lineup.forEach(function (l) {
      var a = (l.player && l.player.attrs) || {};
      if (l.slot.pos === 'GK') return;
      if (typeof a.cor === 'number' && a.cor > 0) { known++; bestCorner = Math.max(bestCorner, a.cor); }
      if (typeof a.fre === 'number' && a.fre > 0) bestFk = Math.max(bestFk, a.fre);
    });
    // 능력치를 모르는 스쿼드에서 "키커가 없다"고 말하면 안 됩니다.
    if (known >= 6 && bestCorner < 11) {
      add('no-setpiece-taker', 'mid',
        '선발 중 코너킥이 가장 높은 값이 ' + bestCorner + '입니다 — 세트피스에서 얻을 것이 거의 없습니다.',
        '코너킥이 되는 선수를 선발에 넣거나, 코너를 짧게 처리하는 쪽으로 두세요. 세트피스 노리기를 켤 상황은 아닙니다.');
    }

    return out;
  }

  // ── 팀 밸런스 경고 ────────────────────────────────────────────────────
  // 조합 자체의 문제는 chemistry()가 보고, 여기서는 지시·상대·선수 상태와
  // 부딪히는 것만 봅니다.
  function balanceWarnings(xi, axes, toggles, squad, opp) {
    var w = chemistry(xi).map(function (c) {
      return { level: c.level, text: c.text, fix: c.fix, kind: c.kind };
    });
    var lineup = xi.lineup;
    function has(tag) { return lineup.some(function (l) { return (l.role.tags || []).indexOf(tag) >= 0; }); }

    if (axes.dline.index >= 3) {
      var gkRole = lineup.filter(function (l) { return l.slot.pos === 'GK'; })[0];
      if (gkRole && gkRole.role.id === 'gk') {
        w.push({ level: 'mid', text: '수비 라인을 올리면서 골키퍼가 일반 골키퍼입니다 — 뒷공간을 정리할 사람이 없습니다. 스위퍼 키퍼로 바꾸는 편이 안전합니다.' });
      }
    }
    if (axes.press.index >= 3 && squad.stamina > 0 && squad.stamina < 13) {
      w.push({ level: 'high', text: '압박 강도가 높은데 선발진 스태미너 평균이 ' + squad.stamina + '입니다 — 60분 이후 압박과 대형이 함께 무너집니다.' });
    }
    if (toggles.pod.on && squad.technique > 0 && squad.technique < 11) {
      w.push({ level: 'mid', text: '후방에서 짧게 시작하는데 팀 기술 평균이 ' + squad.technique + '입니다 — 우리 진영에서 잃을 위험이 큽니다.' });
    }
    if (toggles.pod.on && opp.press >= 3 && opp.loe >= 3) {
      w.push({ level: 'high', text: '상대가 강하게 전방 압박하는데 후방 짧은 패스가 켜져 있습니다 — 둘 중 하나는 정리해야 합니다.' });
    }

    if (!has('target') && !has('aerial') && (toggles.cr_float.on || toggles.cr_byline.on || toggles.hec.on)) {
      w.push({ level: 'mid', text: '크로스 지시를 켰지만 박스 안에 제공권 자원이 없습니다 — 크로스가 그대로 상대 공이 됩니다.' });
    }

    var lowStamina = lineup.filter(function (l) {
      if (!l.player) return false;
      var v = (l.player.attrs || {}).sta;
      var heavy = (l.role.tags || []).indexOf('stamina') >= 0;
      return heavy && typeof v === 'number' && v > 0 && v < 13;
    });
    lowStamina.forEach(function (l) {
      w.push({
        level: 'mid',
        text: l.player.name + eun(l.player.name) + ' ' + l.role.ko + '인데 스태미너가 ' + l.player.attrs.sta + '입니다 — 60~65분 교체를 미리 준비하세요.',
        fix: '스태미너가 높은 선수로 그 자리를 바꾸거나, 활동량이 적은 역할로 내리세요.'
      });
    });

    /*
     * 포지션을 아예 모르는 것과 등록 포지션이 아닌 자리에 세운 것은 다릅니다.
     * 앞엣것은 내보내기에 포지션 열이 없다는 뜻이라 선수마다 한 줄씩 띄우면
     * 같은 말이 열한 번 반복됩니다 — 한 줄로 묶고 무엇을 하면 되는지만 말합니다.
     */
    var unknownPos = lineup.filter(function (l) {
      return l.player && !(l.player.positions && l.player.positions.length);
    });
    if (unknownPos.length >= 3) {
      w.push({
        level: 'high',
        text: '선발 ' + unknownPos.length + '명의 등록 포지션을 모릅니다 — 지금 배치는 능력치만 보고 짠 것이라 실제로 설 수 없는 자리가 섞여 있습니다.',
        fix: 'FM 스쿼드 화면 보기에 「포지션」 열을 넣어 한 번만 다시 내보내 주세요. 그 한 번으로 배치가 통째로 정확해집니다.'
      });
    }

    lineup.forEach(function (l) {
      // 위에서 한 줄로 묶은 선수는 여기서 다시 말하지 않습니다.
      if (unknownPos.length >= 3 && l.player && !(l.player.positions && l.player.positions.length)) return;
      if (l.familiarity !== null && l.familiarity < 0.6 && l.player) {
        var own = (l.player.positions || []).join(' · ');
        w.push({
          level: 'mid',
          text: l.player.name + eun(l.player.name) + ' ' + l.slot.pos + ' 자리가 익숙하지 않습니다'
            + (own ? ' (등록 포지션 ' + own + ')' : '') + '.',
          fix: own
            ? '그 자리에 맞는 선수로 바꾸거나, FM에서 이 선수에게 ' + l.slot.pos + ' 추가 포지션 훈련을 시키세요.'
            : '등록 포지션을 선수 목록에서 지정해 주세요.'
        });
      }
    });

    return w;
  }

  // ── 개인 지시 ─────────────────────────────────────────────────────────
  function individualInstructions(xi, opp, planTop, axes) {
    var out = [];
    var traitNotes = [];
    var oppTraits = opp.traits || [];
    var planIds = planTop.map(function (p) { return p.id; });
    function planHas(id) { return planIds.indexOf(id) >= 0; }

    xi.lineup.forEach(function (l) {
      var pi = [];
      var a = (l.player && l.player.attrs) || {};
      var tags = l.role.tags || [];
      var pos = l.slot.pos;
      function av(id) { var v = a[id]; return typeof v === 'number' && v > 0 ? v : null; }

      (l.role.locked || []).forEach(function (t) {
        pi.push({ text: t, why: l.role.ko + ' 역할이 자동으로 켜는 지시입니다(끌 수 없음).', locked: true });
      });

      // 측면 공격수
      if (['AMR', 'AML', 'MR', 'ML'].indexOf(pos) >= 0 && tags.indexOf('inverted') < 0) {
        var cro = av('cro'), dri = av('dri'), fin = av('fin');
        if (cro !== null && dri !== null && cro < 11 && dri >= 14) {
          pi.push({ text: '안쪽으로 접어 들어가기', why: '크로스 ' + cro + ' / 드리블 ' + dri + ' — 크로스보다 안으로 파고드는 편이 값이 큽니다.' });
        } else if (cro !== null && cro >= 14 && planHas('wide-cross')) {
          pi.push({ text: '골라인까지 파고들어 크로스', why: '크로스 ' + cro + ' — 측면·크로스 방향이라 깊은 지점에서 올리게 합니다.' });
        }
        if (fin !== null && fin >= 14 && l.duty === 'a') {
          pi.push({ text: '더 자주 슛', why: '마무리 ' + fin + ' — 박스 안에서 직접 마무리할 수 있습니다.' });
        }
      }

      // 측면 수비
      if (['DR', 'DL', 'WBR', 'WBL'].indexOf(pos) >= 0) {
        var side = pos.indexOf('L') >= 0 ? 'l' : 'r';
        var ahead = xi.lineup.filter(function (x) {
          return x.slot.pos === (side === 'l' ? 'AML' : 'AMR') || x.slot.pos === (side === 'l' ? 'ML' : 'MR');
        })[0];
        if (ahead && (ahead.role.tags || []).some(function (t) { return t === 'inverted' || t === 'narrow-drift'; }) && l.duty !== 'd') {
          pi.push({ text: '넓게 벌리기', why: '앞의 ' + ahead.role.ko + iga(ahead.role.ko) + ' 안쪽으로 들어오므로 이 선수가 측면 폭을 전담해야 합니다.' });
        }
        if (oppTraits.indexOf('wing-heavy') >= 0 || oppTraits.indexOf('overlapping-fb') >= 0) {
          pi.push({ text: '강하게 밀착 마크', why: '상대 공격이 측면에 몰려 있어 이 자리에서 먼저 붙어야 합니다.' });
        }
      }

      // 센터백
      if (pos === 'DC') {
        var pac = av('pac');
        if (oppTraits.indexOf('fast-striker') >= 0 && pac !== null && pac < 11) {
          pi.push({ text: '발 떼지 않기', why: '속도 ' + pac + ' — 상대 빠른 공격수를 상대로 달려들면 한 번에 벗겨집니다.' });
        }
        if (oppTraits.indexOf('target-man') >= 0 && (av('jum') || 0) >= 14) {
          pi.push({ text: '강하게 밀착 마크', why: '제공권이 좋아 상대 타깃형 공격수를 직접 맡기기 적합합니다.' });
        }
      }

      // 수비형 미드필더 / 중앙
      if ((pos === 'DM' || pos === 'MC') && oppTraits.indexOf('playmaker-amc') >= 0) {
        if (tags.indexOf('holder') >= 0 || l.duty === 'd') {
          pi.push({
            text: opp.keyPlayer ? (opp.keyPlayer + ' 전담 마크') : '상대 공격형 미드필더 전담 마크',
            why: '상대 2선 플레이메이커를 지우는 것이 이 경기의 핵심입니다.'
          });
        }
      }

      // 최전방
      if (pos === 'ST') {
        var pacS = av('pac'), heaS = av('hea');
        if (opp.dline >= 3 && pacS !== null && pacS >= 14) {
          pi.push({ text: '채널로 이동', why: '속도 ' + pacS + ' + 상대 라인이 높음 — 센터백과 풀백 사이로 달리게 합니다.' });
        }
        if (oppTraits.indexOf('playmaker-deep') >= 0) {
          pi.push({ text: '더 많이 압박', why: '상대 후방 배급 담당에게 시간을 주지 않아야 합니다.' });
        }
        if (heaS !== null && heaS >= 15 && planHas('wide-cross')) {
          pi.push({ text: '더 자주 슛', why: '헤딩 ' + heaS + ' — 크로스의 1차 목표점입니다.' });
        }
      }

      // 공통
      var fla = av('fla'), vis = av('vis'), lon = av('lon');
      if (fla !== null && fla <= 7 && ['DC', 'DR', 'DL', 'DM'].indexOf(pos) >= 0) {
        pi.push({ text: '위험을 줄이기', why: '개인기 ' + fla + ' — 무리한 시도가 실점으로 이어지기 쉬운 자리입니다.' });
      }
      if (vis !== null && vis >= 16 && (tags.indexOf('playmaker') >= 0 || tags.indexOf('creator') >= 0)) {
        pi.push({ text: '위험한 패스 시도', why: '시야 ' + vis + ' — 이 선수만 볼 수 있는 패스가 있습니다.' });
      }
      if (lon !== null && lon >= 15 && ['MC', 'DM', 'AMC'].indexOf(pos) >= 0 && opp.dline <= 1) {
        pi.push({ text: '더 자주 슛', why: '중거리 슛 ' + lon + ' + 상대가 내려앉음 — 박스 앞이 막혔을 때의 대안입니다.' });
      }

      /*
       * 선수 특성으로 걸러 냅니다.
       *
       * 특성은 지시로 켜고 끄는 것이 아니라 선수에게 박힌 습관입니다. 그래서
       *  - 특성이 이미 하고 있는 지시는 뺍니다(중복해서 켤 이유가 없습니다).
       *  - 특성과 정면으로 부딪히는 지시는 지우지 않고 "소용없다"고 표시합니다 —
       *    조용히 빼면 왜 그 조언이 없는지 알 수 없고, 사용자는 직접 켜 버립니다.
       */
      var traitIds = (l.player && l.player.traits) || [];
      if (traitIds.length) {
        var makes = {}, fightsBy = {};
        traitIds.forEach(function (id) {
          var t = traitById(id);
          if (!t) return;
          (t.makes || []).forEach(function (x) { makes[x] = t.ko; });
          (t.fights || []).forEach(function (x) { fightsBy[x] = t.ko; });
        });
        pi = pi.filter(function (item) {
          if (item.locked) return true;
          if (makes[item.text]) {
            traitNotes.push({
              slot: l.slot, player: l.player,
              text: '「' + item.text + '」은 넣지 않았습니다 — 특성 「' + makes[item.text] + '」이 이미 그 행동입니다.'
            });
            return false;
          }
          return true;
        });
        pi.forEach(function (item) {
          if (fightsBy[item.text]) {
            item.blockedBy = fightsBy[item.text];
            item.why = (item.why ? item.why + ' ' : '')
              + '다만 특성 「' + fightsBy[item.text] + '」과 반대 방향이라 지시만으로는 바뀌지 않습니다.';
          }
        });
        // 특성 자체가 알려 줄 것이 있으면 그대로 붙입니다.
        traitIds.forEach(function (id) {
          var t = traitById(id);
          if (t && t.warn) {
            pi.push({ text: '특성: ' + t.ko, why: t.warn, trait: true });
          }
        });
      }

      if (pi.length) out.push({ slot: l.slot, role: l.role, duty: l.duty, player: l.player, items: pi });
    });
    out.traitNotes = traitNotes;
    return out;
  }

  // ── 대응 브리핑 ───────────────────────────────────────────────────────
  function counterBrief(fired) {
    var key = [], normal = [];
    fired.forEach(function (f) {
      if (!f.why) return;
      var item = { why: f.why, action: f.action, group: f.rule.group };
      if (f.rule.tier === 'key') key.push(item); else normal.push(item);
    });
    return { key: key, normal: normal };
  }

  // ── 포메이션 순위 ─────────────────────────────────────────────────────
  var PLAN_FORMATION_TAGS = {
    'press-high': { press: 4, 'defensive-shape': -3, attacking: 1 },
    'low-block': { 'defensive-shape': 5, 'three-at-back': 2, attacking: -6, press: -2 },
    counter: { 'defensive-shape': 3, 'two-striker': 2, 'three-at-back': 1, attacking: -2 },
    possession: { 'overload-centre': 3, modern: 2, 'defensive-shape': -2 },
    'wide-cross': { wide: 3, wingback: 2, narrow: -4 },
    'in-behind': { 'two-striker': 1, attacking: 1, 'defensive-shape': -1 },
    'overload-centre': { 'overload-centre': 4, narrow: 3, wide: -2 }
  };

  function rankFormations(players, opp, ctx, squad, oppF, allowed) {
    var fitCache = {};
    var results = [];
    var pool = FD.FORMATIONS.filter(function (f) {
      return !allowed || !allowed.length || allowed.indexOf(f.id) >= 0;
    });

    pool.forEach(function (f) {
      var ourSum = summariseFormation(f);
      var fired = evaluateRules(opp, ctx, squad, ourSum, oppF);
      var acc = accumulate(fired);
      var plans = resolvePlans(acc.plan);
      var planW = planRoleWeights(plans.top);
      var xi = buildXI(players, f, planW, acc.role, {
        fitCache: fitCache, mentalityShift: acc.axis.mentality
      });

      // 구조 점수 — 상대 포메이션과의 맞물림.
      var structure = 0, notes = [];
      if (oppF) {
        var t = summariseFormation(oppF);
        var cd = clamp(ourSum.centre - t.centre, -3, 3);
        structure += cd * 5;
        if (cd) notes.push({ text: '중앙 인원 ' + (cd > 0 ? '+' : '') + cd, value: cd * 5 });

        if (t.amc > 0 && ourSum.dm === 0) { structure -= 9; notes.push({ text: '상대 공격형 미드필더 앞에 수비형 미드필더 없음', value: -9 }); }
        if (t.amc > 0 && ourSum.dm >= 1) { structure += 4; notes.push({ text: '상대 공격형 미드필더를 수비형 미드필더가 차단', value: 4 }); }
        if (t.strikers >= 2 && ourSum.counts.DC <= 2 && ourSum.dm === 0) { structure -= 6; notes.push({ text: '상대 투톱 대비 뒤에 남는 수비 없음', value: -6 }); }
        if (ourSum.counts.DC >= 3 && t.strikers <= 1) { structure += 3; notes.push({ text: '센터백이 한 명 남음', value: 3 }); }
        if (t.wideAttack === 0 && ourSum.wideAttack >= 2) { structure += 5; notes.push({ text: '상대 측면 자원 없음 — 측면 우위', value: 5 }); }
        // 측면은 1대1로 맞추면 이미 불리합니다 — 상대 풀백이 겹쳐 올라오면
        // 그 순간 2대1이 되기 때문입니다. 그래서 한 명 여유를 기준으로 봅니다.
        var wideGap = t.wideAttack + 1 - ourSum.wideCover;
        if (wideGap > 0) { structure -= wideGap * 5; notes.push({ text: '측면 수비 인원이 ' + wideGap + '명 부족', value: -wideGap * 5 }); }
        if (t.threeAtBack && ourSum.wideAttack >= 2) { structure += 3; notes.push({ text: '상대 스리백의 윙백 뒤를 노릴 측면 자원 보유', value: 3 }); }
      }

      var planScore = 0;
      plans.top.forEach(function (p, i) {
        var tagW = PLAN_FORMATION_TAGS[p.id] || {};
        var mult = i === 0 ? 1 : 0.5;
        (f.tags || []).forEach(function (tag) { planScore += (tagW[tag] || 0) * mult; });
      });

      var total = xi.teamFit * 1.0 + structure * 1.0 + planScore * 1.0 + xi.planFit * 1.5;
      results.push({
        formation: f, xi: xi, plans: plans, acc: acc, fired: fired,
        structure: round1(structure), structureNotes: notes,
        planScore: round1(planScore), teamFit: xi.teamFit,
        total: round1(total)
      });
    });

    results.sort(function (a, b) { return b.total - a.total; });
    return results;
  }

  /*
   * 지금 뛸 수 없는 선수를 뺍니다.
   * 부상·출장 정지 선수를 선발에 넣으면 그 전술은 이번 주말에 못 씁니다.
   * 스쿼드 목록에서는 지우지 않고 여기서만 빼서, 복귀하면 그대로 돌아오게 합니다.
   */
  function splitAvailable(players) {
    var out = [], avail = [];
    players.forEach(function (p) {
      if (p.out) out.push({ name: p.name, reason: p.outReason || '이탈' });
      else avail.push(p);
    });
    return { available: avail, unavailable: out };
  }

  /*
   * ── 시즌 기본 전술 ──────────────────────────────────────────────────────
   *
   * 상대를 보지 않고 스쿼드만으로 고르는 전술입니다. 매 경기 새로 짜는 대신
   * 여기서 나온 것을 기본으로 두고, 상대에 따라 「맞춤 전술」에서 조정하는 식으로
   * 쓰는 것을 전제로 합니다.
   *
   * 경기별 전술과 다르게 봐야 하는 것이 둘 있습니다.
   *   - 지속 가능성: 한 경기만 버티면 되는 게 아니라 시즌 내내 씁니다. 스쿼드
   *     스태미너가 받쳐 주지 않는 압박은 여기서 고르면 안 됩니다.
   *   - 두께: 주전 11명만 맞는 형태보다, 교체 자원까지 같은 자리를 채울 수 있는
   *     형태가 시즌 전술로 낫습니다.
   *
   * "최강 전술" 같은 건 없습니다. 여기서 내는 건 우리 스쿼드가 가장 잘 수행할 수
   * 있는 형태이지 승률이 가장 높은 형태가 아닙니다.
   */
  var PLAN_SQUAD_FIT = {
    'press-high': function (s) { return (s.stamina - 13) * 2.2 + (s.pace - 12) * 0.6; },
    possession: function (s) { return (s.technique - 12) * 2.4 + (s.creativity - 12) * 1.2; },
    'wide-cross': function (s) { return (s.crossing - 12) * 1.6 + (s.aerial - 12) * 1.6; },
    counter: function (s) { return (s.pace - 13) * 2 + (s.defending - 12) * 1; },
    'in-behind': function (s) { return (s.pace - 13) * 2.2 + (s.finishing - 12) * 1.2; },
    'low-block': function (s) { return (s.defending - 12) * 2 - (s.technique - 12) * 0.8; },
    'overload-centre': function (s) { return (s.creativity - 12) * 1.8 + (s.technique - 12) * 1; }
  };

  /*
   * 리그 내 위치에 따른 기본 전술 성향.
   *
   * 스쿼드 능력치만으로는 "내려앉기"가 쉽게 1등이 됩니다 — 수비 능력치가 평범만
   * 해도 점수가 붙고, 역할 적합도는 어떤 방향에서도 비슷하게 나오기 때문입니다.
   * 그런데 시즌 내내 쓸 기본 전술로 블록을 세우면 약팀을 만났을 때 이길 방법이
   * 없습니다. 반대로 약팀이 전방 압박을 기본으로 삼으면 매 경기 무너집니다.
   *
   * 이건 능력치에서 나오지 않는 정보이므로 사용자에게 직접 받습니다.
   */
  var STANDING_PLAN_PRIOR = {
    strong: { 'low-block': -7, counter: -2, possession: 1.5, 'press-high': 1, 'wide-cross': 0.5, 'overload-centre': 0.5, 'in-behind': 0 },
    mid: { 'low-block': -3, counter: 0.5, possession: 0.5, 'press-high': 0, 'wide-cross': 0.5, 'overload-centre': 0, 'in-behind': 0.5 },
    weak: { 'low-block': 2, counter: 2.5, possession: -1.5, 'press-high': -1.5, 'wide-cross': 0, 'overload-centre': -0.5, 'in-behind': 1 }
  };
  // 시즌 기본으로 삼기 어려운 형태. 4-2-4처럼 한쪽으로 몰린 배치는 특정 상황용입니다.
  var BASE_FORMATION_PRIOR = { attacking: -3 };

  function basePrior(planId, formation, standing) {
    var p = (STANDING_PLAN_PRIOR[standing] || STANDING_PLAN_PRIOR.mid)[planId] || 0;
    (formation.tags || []).forEach(function (t) { p += BASE_FORMATION_PRIOR[t] || 0; });
    return p;
  }

  function squadPlanBonus(planId, squad) {
    var f = PLAN_SQUAD_FIT[planId];
    if (!f) return 0;
    // 능력치를 모르면 이 항목은 침묵합니다 — 0을 낮은 값으로 읽으면 안 됩니다.
    if (!squad.technique && !squad.pace && !squad.defending) return 0;
    return clamp(f(squad), -7, 7);
  }

  // 주전 11명을 빼고 남은 선수로 같은 자리를 채워 봅니다.
  function benchFor(players, xi) {
    var used = {};
    xi.lineup.forEach(function (l) { if (l.player) used[l.player._id] = 1; });
    var rest = players.filter(function (p) { return !used[p._id]; });
    if (!rest.length) return [];
    var cache = {};
    function fitOf(player, role, duty, slotPos) {
      var k = player._id + '|' + role.id + '|' + duty + '|' + slotPos;
      if (cache[k] === undefined) {
        var proxy = Object.create(role);
        proxy._slotPos = slotPos;
        cache[k] = roleFit(player, proxy, duty);
      }
      return cache[k];
    }
    var slots = xi.lineup.map(function (l) {
      return { slot: l.slot, choice: { role: l.role, duty: l.duty } };
    });
    var assigned = assignPlayers(slots, rest, fitOf);
    return xi.lineup.map(function (l, i) {
      var p = assigned[i];
      return {
        slot: l.slot, role: l.role, duty: l.duty, player: p || null,
        fit: p ? Math.round(fitOf(p, l.role, l.duty, l.slot.pos).score) : null
      };
    });
  }

  /*
   * ── 같은 상대를 다시 만날 때 ────────────────────────────────────────────
   *
   * 기록을 쌓아 놓고 다음 경기 준비에 안 쓰면 절반만 한 것입니다. 첼시를 두 번째
   * 만나는데 지난번에 무슨 일이 있었는지 도구가 말해 주지 않으면, 사람이
   * 「경기 후」 탭을 열어 목록을 훑어야 합니다. 그러면 아무도 안 봅니다.
   *
   * 이름은 사람이 친 글자라 표기가 흔들립니다(첼시 / 첼시 FC / Chelsea).
   * 공백과 대소문자를 걷어내고 한쪽이 다른 쪽을 포함하면 같은 팀으로 봅니다 —
   * 자동으로 뭘 바꾸지는 않고 보여 주기만 하므로, 틀려도 손해가 작습니다.
   */
  function normTeam(x) {
    return String(x == null ? '' : x).replace(/\s+/g, '').replace(/fc|f\.c\./gi, '').toLowerCase();
  }

  function opponentHistory(matches, name) {
    var key = normTeam(name);
    if (!key) return null;
    var past = (matches || []).filter(function (m) {
      if (!m || num(m.gf) === null || num(m.ga) === null) return false;
      var k = normTeam(m.opp);
      return k && (k === key || k.indexOf(key) >= 0 || key.indexOf(k) >= 0);
    });
    if (!past.length) return null;

    var w = 0, d = 0, l = 0, gf = 0, ga = 0;
    past.forEach(function (m) {
      gf += m.gf; ga += m.ga;
      if (m.gf > m.ga) w++; else if (m.gf === m.ga) d++; else l++;
    });

    // 이 상대에게 반복해서 당한 장면 — 다음 경기 전에 이것만 봐도 값어치가 있습니다.
    var tagCount = {};
    past.forEach(function (m) {
      var seen = {};
      (m.flags || []).forEach(function (id) {
        if (seen[id]) return;
        seen[id] = 1;
        tagCount[id] = (tagCount[id] || 0) + 1;
      });
    });
    var repeats = (TD.MATCH_TAGS || []).filter(function (t) {
      return (tagCount[t.id] || 0) >= 2 || ((tagCount[t.id] || 0) >= 1 && past.length === 1);
    }).map(function (t) {
      return { id: t.id, ko: t.ko, count: tagCount[t.id], fix: t.fix };
    });

    var withXg = past.filter(function (m) { return num(m.us && m.us.xg) !== null; });
    var lines = past.slice().reverse().map(function (m) {
      return {
        venue: m.venue === 'away' ? '원정' : m.venue === 'home' ? '홈' : '—',
        score: m.gf + ':' + m.ga,
        result: m.gf > m.ga ? 'w' : m.gf === m.ga ? 'd' : 'l',
        xg: num(m.us && m.us.xg), xgAgainst: num(m.them && m.them.xg),
        flags: (m.flags || []).map(function (id) {
          var t = (TD.MATCH_TAGS || []).filter(function (x) { return x.id === id; })[0];
          return t ? t.ko : id;
        })
      };
    });

    return {
      name: name, n: past.length, w: w, d: d, l: l, gf: gf, ga: ga,
      xgFor: withXg.length ? Math.round(sum(withXg.map(function (m) { return m.us.xg; })) * 10) / 10 : null,
      xgSample: withXg.length,
      repeats: repeats, lines: lines,
      text: '이 상대와 ' + past.length + '경기 — ' + w + '승 ' + d + '무 ' + l + '패 (' + gf + ':' + ga + ')'
    };
  }

  /*
   * ── 포지션 추정 ─────────────────────────────────────────────────────────
   *
   * FM 스쿼드 내보내기에 「포지션」 열이 없으면 이 도구는 사실상 아무것도 못 합니다.
   * 등록 포지션을 모르면 포지션 친숙도가 전원 0.34(낯선 자리)로 깔리고, 그러면
   * 선발이 "능력치 총합 순서"가 됩니다 — 수비형 미드필더가 리베로에 서고 10번이
   * 스트라이커로 나갑니다. 그걸 그대로 게임에 옮기면 대패합니다.
   *
   * 그래서 두 가지를 합니다. 하나는 포지션을 모르면 전술을 아예 안 내놓는 것(아래
   * generate/baseTactic 쪽이 아니라 화면에서 막습니다). 다른 하나가 이겁니다 —
   * 능력치로 자리를 **추정**해서, 스물몇 명을 한 화면에서 몇 분 만에 확인만 하고
   * 넘어가게 하는 것.
   *
   * 추정은 추정입니다. 확정하지 않고 후보로만 내놓고, 화면에서 사람이 누릅니다.
   * 좌우는 능력치로 알 수 없으므로(주발이 힌트일 뿐) 중앙 자리를 먼저 내놓고
   * 측면은 양쪽을 같이 제안합니다.
   */
  var POS_SIGNATURE = {
    GK:  { han: 3, ref: 3, ono: 2, aer: 2, cmd: 2, kic: 1 },
    DC:  { mar: 3, tck: 3, hea: 3, jum: 2, pos: 2, str: 2, cnt: 1, pac: -1 },
    // 풀백과 윙어는 몸이 비슷합니다. 가르는 것은 마크·태클·위치 선정이고,
    // 반대로 마무리가 높으면 풀백이 아닙니다. 여기서 안 갈라 두면 오른쪽 풀백이
    // 전부 '측면 공격수'로 추정됩니다.
    DR:  { mar: 3, tck: 3, pos: 2, pac: 2, acc: 2, sta: 2, cro: 1, fin: -2, hea: -1 },
    DL:  { mar: 3, tck: 3, pos: 2, pac: 2, acc: 2, sta: 2, cro: 1, fin: -2, hea: -1 },
    WBR: { pac: 3, acc: 3, sta: 3, cro: 2, dri: 2, wor: 2, mar: 2, tck: 1, fin: -2 },
    WBL: { pac: 3, acc: 3, sta: 3, cro: 2, dri: 2, wor: 2, mar: 2, tck: 1, fin: -2 },
    DM:  { tck: 3, pos: 3, ant: 2, cnt: 2, pas: 2, wor: 2, str: 1, fin: -2, dri: -1 },
    MC:  { pas: 3, vis: 2, tec: 2, dec: 2, wor: 2, sta: 2, fir: 2, tea: 1, cro: -1 },
    MR:  { cro: 3, dri: 2, pac: 2, sta: 2, wor: 2, tec: 1, fin: -1 },
    ML:  { cro: 3, dri: 2, pac: 2, sta: 2, wor: 2, tec: 1, fin: -1 },
    AMC: { vis: 3, pas: 3, tec: 3, dri: 2, fla: 2, otb: 2, fir: 2, tck: -1 },
    AMR: { dri: 3, cro: 2, pac: 3, acc: 2, agi: 2, otb: 2, fla: 1, tck: -1 },
    AML: { dri: 3, cro: 2, pac: 3, acc: 2, agi: 2, otb: 2, fla: 1, tck: -1 },
    ST:  { fin: 3, otb: 3, cmp: 2, ant: 2, hea: 2, dri: 1, pac: 1, tck: -2 }
  };
  var GK_KEYS = ['han', 'ref', 'ono', 'aer', 'cmd', 'kic', 'thr', 'tro', 'pun', 'com', 'ecc'];

  function guessPositions(player, squad) {
    var a = (player && player.attrs) || {};
    var known = Object.keys(a).filter(function (k) { return typeof a[k] === 'number' && a[k] > 0; });
    if (known.length < 8) {
      return { picks: [], confident: false, why: '능력치를 아는 항목이 ' + known.length + '개뿐이라 추정할 수 없습니다.' };
    }

    /*
     * 골키퍼는 다른 잣대로 봅니다.
     *
     * FM 내보내기는 필드 선수에게도 골키퍼 능력치 칸을 채워 줍니다. 처음에는
     * "골키퍼 능력치 평균 10 이상"으로 갈랐는데, 그러면 능력치가 고르게 높은
     * 스쿼드에서 센터백이 전부 골키퍼가 됩니다. 절대값이 아니라 **팀 안에서
     * 튀는지**로 봐야 합니다 — 진짜 골키퍼는 나머지와 격차가 큽니다.
     */
    function gkMeanOf(pl) {
      var at = (pl && pl.attrs) || {};
      var v = GK_KEYS.map(function (k) { return at[k]; })
        .filter(function (x) { return typeof x === 'number' && x > 0; });
      return v.length >= 4 ? avg(v) : null;
    }
    var gkMean = gkMeanOf(player);
    if (gkMean !== null) {
      var others = (squad || []).filter(function (pl) { return pl && pl !== player; })
        .map(gkMeanOf).filter(function (v) { return v !== null; }).sort(function (x, y) { return x - y; });
      var mid = others.length ? others[Math.floor(others.length / 2)] : null;
      if (gkMean >= 10 && (mid === null || gkMean - mid >= 4)) {
        return {
          picks: ['GK'], confident: true,
          why: '골키퍼 능력치 평균이 ' + Math.round(gkMean * 10) / 10
            + (mid === null ? '' : '로 팀 중앙값(' + Math.round(mid * 10) / 10 + ')보다 크게 높습니다') + '.'
        };
      }
    }

    // 팀 평균 대비로 봅니다 — 절대값으로 보면 약팀은 전원이 수비수가 됩니다.
    var mean = {};
    var pool = (squad || []).filter(function (p) { return p && p.attrs; });
    Object.keys(POS_SIGNATURE.ST).concat(Object.keys(POS_SIGNATURE.DC),
      Object.keys(POS_SIGNATURE.AMC), Object.keys(POS_SIGNATURE.WBR),
      Object.keys(POS_SIGNATURE.MC), Object.keys(POS_SIGNATURE.DM)).forEach(function (k) {
      if (mean[k] !== undefined) return;
      var vals = pool.map(function (p) { return p.attrs[k]; })
        .filter(function (v) { return typeof v === 'number' && v > 0; });
      mean[k] = vals.length ? avg(vals) : 10;
    });

    var scores = [];
    Object.keys(POS_SIGNATURE).forEach(function (pos) {
      if (pos === 'GK') return;
      var w = POS_SIGNATURE[pos], sum = 0, wsum = 0, seen = 0;
      Object.keys(w).forEach(function (k) {
        var v = a[k];
        wsum += Math.abs(w[k]);
        if (typeof v !== 'number' || v <= 0) return;
        seen++;
        sum += (v - (mean[k] === undefined ? 10 : mean[k])) * w[k];
      });
      if (!seen || seen < Math.ceil(Object.keys(w).length / 2)) return;
      scores.push({ pos: pos, score: sum / wsum });
    });
    if (!scores.length) return { picks: [], confident: false, why: '자리를 가를 만한 능력치가 없습니다.' };
    scores.sort(function (x, y) { return y.score - x.score; });

    /*
     * 좌우는 능력치로 못 가릅니다. 1등이 한쪽 측면이면 반대쪽도 같이 냅니다 —
     * 도구가 왼쪽이라고 단정하면 사람이 그걸 믿고 그대로 둡니다.
     */
    var MIRROR = { DR: 'DL', DL: 'DR', WBR: 'WBL', WBL: 'WBR', MR: 'ML', ML: 'MR', AMR: 'AML', AML: 'AMR' };
    var top = scores[0];
    var picks = [top.pos];
    if (MIRROR[top.pos]) picks.push(MIRROR[top.pos]);
    else if (scores[1] && top.score - scores[1].score < 0.6) picks.push(scores[1].pos);

    var gap = scores[1] ? Math.round((top.score - scores[1].score) * 100) / 100 : null;
    return {
      picks: picks, confident: gap !== null && gap >= 0.5, scores: scores.slice(0, 3),
      why: MIRROR[top.pos]
        ? '측면 자원으로 보입니다 — 좌우는 능력치로 알 수 없으니 직접 고르세요.'
        : (gap === null ? '' : '2위와 ' + gap + ' 차이입니다.')
    };
  }

  /*
   * ── 경기 후 검토 ────────────────────────────────────────────────────────
   *
   * 「경기 중」 탭은 기대 득점이 쌓이는데 골이 없으면 "전술을 바꾸지 마세요"라고
   * 말합니다. 한 경기에서는 그게 맞습니다 — 그런데 그 말이 옳았는지 확인할 방법이
   * 없었습니다. 기록을 안 남겼으니까요.
   *
   * 세 경기째 같은 일이 반복되면 그건 운이 아니라 스쿼드 문제입니다. 그 둘을
   * 가르려면 표본이 필요하고, 여기서 그 계산을 합니다.
   *
   * 쓰는 통계는 하나뿐입니다 — 실제 득점과 기대 득점의 차이를 표본 크기로 나눈 값.
   * 한 경기의 (득점 − xG)는 표준편차가 대략 1골이므로, N경기 누적 차이를 √N으로
   * 나누면 "이 정도 차이가 운으로 나올 만한가"를 잴 수 있습니다. 이 도구는
   * 1.5를 넘으면 운으로 설명하지 않습니다.
   *
   * 이 값은 축구 통계의 표준이 아니라 이 도구의 기준입니다. 그래서 화면에
   * 계산 근거를 같이 적습니다 — 숫자만 던지면 믿을 근거가 없습니다.
   */
  var FINISH_SIGMA = 1.0;      // 한 경기 (득점 − xG)의 대략적인 표준편차
  var FINISH_Z = 1.5;          // 이 이상 벌어지면 운으로 보지 않습니다
  var FINISH_Z_SOFT = 1.0;     // 이 이상이면 "의심스럽다"까지만 말합니다
  var MIN_MATCHES = 4;         // 이보다 적으면 마무리 판정을 아예 하지 않습니다
  var SHOT_QUALITY_LOW = 0.08; // 슈팅당 기대 득점 — 경기 중 규칙과 같은 기준
  var SHOT_QUALITY_GOOD = 0.12;
  var TAG_REPEAT = 0.4;        // 경기의 이 비율 이상에서 나오면 '반복'으로 봅니다

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function sum(list) { return list.reduce(function (a, b) { return a + b; }, 0); }
  // 화면의 기준값은 −1.5처럼 유니코드 빼기를 씁니다. 계산 결과만 -4.08로 나오면
  // 같은 문장 안에서 두 종류의 빼기 기호가 섞여 읽기 나쁩니다.
  function signed(v) { return v < 0 ? '−' + Math.abs(v) : String(v); }

  /*
   * 선발을 같이 넘기면 이름까지 말합니다.
   *
   * "슛을 가장 많이 쏘는 선수의 마무리를 보세요"는 맞는 말이지만, 그걸 보러
   * 스쿼드 탭으로 갔다가 다시 돌아와야 합니다. 그 값은 이미 다 읽고 있으므로
   * 여기서 바로 짚습니다 — 선발을 안 넘기면 예전처럼 일반론만 냅니다.
   */
  var FRONT_SLOTS = { ST: 1, AMC: 1, AML: 1, AMR: 1 };

  function frontFinishers(xi) {
    if (!xi || !xi.lineup) return [];
    return xi.lineup.filter(function (l) {
      return l.player && FRONT_SLOTS[l.slot.pos];
    }).map(function (l) {
      var a = l.player.attrs || {};
      return {
        name: l.player.name, pos: posKo(l.slot.pos), role: l.role ? l.role.ko : '',
        fin: num(a.fin), cmp: num(a.cmp)
      };
    }).filter(function (p) { return p.fin !== null; })
      .sort(function (x, y) { return x.fin - y.fin; });
  }

  function keeperOf(xi) {
    if (!xi || !xi.lineup) return null;
    var gk = xi.lineup.filter(function (l) { return l.slot.pos === 'GK' && l.player; })[0];
    if (!gk) return null;
    var a = gk.player.attrs || {};
    return { name: gk.player.name, ref: num(a.ref), ono: num(a.ono), cnt: num(a.cnt) };
  }

  function matchReview(matches, xi) {
    var list = (matches || []).filter(function (m) {
      return m && num(m.gf) !== null && num(m.ga) !== null;
    });
    if (!list.length) return null;

    var findings = [];
    var n = list.length;

    // ── 성적 ──
    var w = 0, d = 0, l = 0, gf = 0, ga = 0;
    list.forEach(function (m) {
      gf += m.gf; ga += m.ga;
      if (m.gf > m.ga) w++; else if (m.gf === m.ga) d++; else l++;
    });
    var record = {
      n: n, w: w, d: d, l: l, gf: gf, ga: ga,
      pts: w * 3 + d, ppg: Math.round((w * 3 + d) / n * 100) / 100
    };

    /*
     * 통계마다 표본이 다릅니다.
     *
     * 기록은 손으로 저장하므로 어떤 경기는 기대 득점만, 어떤 경기는 점유율만
     * 있습니다. 그런데 처음에는 상대 기대 득점을 '우리 기대 득점이 있는 경기'
     * 안에서만 찾았고, 슈팅당 기대 득점을 다른 표본에서 구해 놓고 화면에는
     * 전체 표본인 것처럼 적었습니다. 서로 다른 경기 묶음에서 나온 숫자를 한
     * 문장에 넣으면 그 문장은 어떤 경기에 대해서도 참이 아닙니다.
     *
     * 그래서 묶음을 먼저 각각 만들고, 문장마다 그 묶음의 크기를 같이 말합니다.
     */
    var has = function (side, key) {
      return function (m) { return num(m[side] && m[side][key]) !== null; };
    };
    var mXg = list.filter(has('us', 'xg'));
    var mXga = list.filter(has('them', 'xg'));          // 우리 기록과 독립입니다
    var mShots = list.filter(function (m) { return has('us', 'xg')(m) && has('us', 'shots')(m); });
    var mPoss = list.filter(has('us', 'possession'));
    var mSot = list.filter(has('us', 'sot'));
    // 내려앉은 상대 판정은 두 값이 같은 경기에 다 있어야 성립합니다.
    var mParked = list.filter(function (m) { return has('us', 'possession')(m) && has('us', 'sot')(m); });

    var stats = {
      xgFor: null, xgAgainst: null, shots: null, sot: null, possession: null,
      perShot: null, z: null, zAgainst: null,
      sample: mXg.length, sampleAgainst: mXga.length,
      sampleShots: mShots.length, samplePoss: mPoss.length,
      sampleSot: mSot.length, sampleParked: mParked.length
    };

    /*
     * 반올림한 값으로 다시 계산하지 않습니다.
     * 화면에 13.0으로 보이는 값이 실제로는 12.96일 수 있는데, 그걸로 z를 구하면
     * 경계에서 판정이 뒤집힙니다.
     */
    var xgForRaw = null, xgAgainstRaw = null, shotXgRaw = null;
    if (mXg.length) {
      xgForRaw = sum(mXg.map(function (m) { return m.us.xg; }));
      stats.xgFor = Math.round(xgForRaw * 10) / 10;
      stats.goalsFor = sum(mXg.map(function (m) { return m.gf; }));
      stats.z = Math.round((stats.goalsFor - xgForRaw) / (FINISH_SIGMA * Math.sqrt(mXg.length)) * 100) / 100;
      stats.shortBy = Math.round((xgForRaw - stats.goalsFor) * 10) / 10;
    }
    if (mXga.length) {
      xgAgainstRaw = sum(mXga.map(function (m) { return m.them.xg; }));
      stats.xgAgainst = Math.round(xgAgainstRaw * 10) / 10;
      stats.goalsAgainst = sum(mXga.map(function (m) { return m.ga; }));
      stats.zAgainst = Math.round((stats.goalsAgainst - xgAgainstRaw) / (FINISH_SIGMA * Math.sqrt(mXga.length)) * 100) / 100;
      // 화면에 보일 값만 반올림합니다. 판정은 아래에서 원값으로 합니다 —
      // 1.499를 1.5로 올린 뒤 '1.5 이상'을 재면 경계에서 뒤집힙니다.
      stats.xgaPerRaw = xgAgainstRaw / mXga.length;
      stats.xgaPer = Math.round(stats.xgaPerRaw * 100) / 100;
    }
    if (mShots.length) {
      var shotTotal = sum(mShots.map(function (m) { return m.us.shots; }));
      shotXgRaw = sum(mShots.map(function (m) { return m.us.xg; }));
      stats.shots = shotTotal;
      stats.shotXg = Math.round(shotXgRaw * 10) / 10;
      stats.perShot = shotTotal > 0 ? Math.round(shotXgRaw / shotTotal * 1000) / 1000 : null;
    }
    if (mPoss.length) {
      stats.possession = Math.round(sum(mPoss.map(function (m) { return m.us.possession; })) / mPoss.length);
    }
    if (mSot.length) {
      stats.sot = Math.round(sum(mSot.map(function (m) { return m.us.sot; })) / mSot.length * 10) / 10;
    }

    /*
     * ── 마무리 ──
     *
     * 여기가 이 화면의 핵심입니다. "결정력 부족"은 한 경기로는 절대 알 수 없고,
     * 표본이 모자라면 모자라다고 말해야 합니다 — 세 경기로 스트라이커를 파는 것이
     * 가장 비싼 실수입니다.
     */
    var sampleKo = mXg.length + '경기';
    var front = frontFinishers(xi);
    /*
     * 값을 아는 전방 자원이 있으면 가장 낮은 쪽을 이름으로 짚습니다.
     * 없으면 예전처럼 무엇을 보라고만 말합니다 — 지어내지 않습니다.
     */
    function finisherHint() {
      if (!front.length) {
        return '슛을 가장 많이 쏘는 선수의 마무리 · 침착성 · 퍼스트 터치를 보고, 낮으면 개인 훈련 초점을 그쪽으로 돌리거나 그 자리를 영입 목록에 올리세요.';
      }
      var low = front[0];
      var others = front.slice(1, 3).map(function (p) {
        return p.name + ' ' + p.fin + (p.cmp === null ? '' : '/' + p.cmp);
      });
      return '지금 선발에서 마무리가 가장 낮은 자리는 ' + low.pos + ' ' + low.name
        + '(마무리 ' + low.fin + (low.cmp === null ? '' : ' · 침착성 ' + low.cmp) + ')입니다'
        + (others.length ? ' — 다음은 ' + others.join(', ') : '')
        + '. 개인 훈련 초점을 마무리로 돌리거나, 「영입」 탭에서 그 자리를 보세요.';
    }
    if (!mXg.length) {
      findings.push({
        kind: 'no-xg', level: 'note',
        text: '기대 득점을 넣은 경기가 없어 마무리를 판정할 수 없습니다.',
        fix: '「경기 중」 탭에서 기록을 넣고 저장하면 여기서 누적으로 봅니다. 슈팅 · 유효 슈팅 · 기대 득점 · 점유율 네 개만 있어도 됩니다.'
      });
    } else if (mXg.length < MIN_MATCHES) {
      findings.push({
        kind: 'small-sample', level: 'note',
        text: '기대 득점이 있는 경기가 ' + sampleKo + '뿐입니다 — 아직 운과 실력을 가를 수 없습니다.',
        fix: MIN_MATCHES + '경기는 넘겨야 판정합니다. 지금 스트라이커를 파는 것이 가장 비싼 실수입니다.'
      });
    } else if (stats.z <= -FINISH_Z) {
      findings.push({
        kind: 'finishing-bad', level: 'high',
        text: sampleKo + ' 누적 기대 득점 ' + stats.xgFor + '에 실제 ' + stats.goalsFor + '골 — '
          + stats.shortBy + '골 부족합니다. 운으로 설명되는 범위를 넘었습니다.',
        fix: '전술이 아니라 마무리하는 선수의 문제입니다. ' + finisherHint(),
        who: front,
        detail: '기준: (실제 득점 − 기대 득점) ÷ √경기수 = ' + signed(stats.z) + '. −' + FINISH_Z + ' 아래면 운으로 보지 않습니다.'
      });
    } else if (stats.z <= -FINISH_Z_SOFT) {
      findings.push({
        kind: 'finishing-soft', level: 'note',
        text: sampleKo + ' 누적 기대 득점 ' + stats.xgFor + '에 실제 ' + stats.goalsFor + '골 — 조금 밑돕니다.',
        fix: '아직 운의 범위 안입니다. 몇 경기 더 보고 판단하세요.',
        detail: '기준: (실제 득점 − 기대 득점) ÷ √경기수 = ' + signed(stats.z) + '.'
      });
    } else if (stats.z >= FINISH_Z) {
      findings.push({
        kind: 'finishing-hot', level: 'note',
        text: sampleKo + ' 누적 기대 득점 ' + stats.xgFor + '에 실제 ' + stats.goalsFor + '골 — 기대치를 크게 넘고 있습니다.',
        fix: '지금 성적은 만드는 기회보다 좋습니다. 이 차이는 대개 되돌아오므로, 성적만 보고 전술을 그대로 두면 나중에 갑자기 안 들어갑니다. 기회의 양 자체를 늘려 두세요.',
        detail: '기준: (실제 득점 − 기대 득점) ÷ √경기수 = ' + signed(stats.z) + '.'
      });
    } else {
      findings.push({
        kind: 'finishing-ok', level: 'good',
        text: sampleKo + ' 누적 기대 득점 ' + stats.xgFor + '에 실제 ' + stats.goalsFor + '골 — 만드는 만큼 넣고 있습니다.',
        fix: '', detail: '기준: (실제 득점 − 기대 득점) ÷ √경기수 = ' + signed(stats.z) + '.'
      });
    }

    /*
     * ── 기회의 질 ──
     * 같은 기대 득점 2.0이라도 슈팅 10개로 만든 것과 25개로 만든 것은 다른 경기입니다.
     * 이 숫자는 슈팅 기록이 있는 경기에서만 나오므로, 그 경기 수를 같이 말합니다.
     */
    if (stats.perShot !== null && mShots.length >= 3) {
      var shotsKo = (mShots.length === mXg.length ? '' : '슈팅 기록이 있는 ' + mShots.length + '경기에서 ');
      if (stats.perShot <= SHOT_QUALITY_LOW) {
        findings.push({
          kind: 'far-shots', level: 'high',
          text: shotsKo + '슈팅 ' + stats.shots + '개에 기대 득점 ' + stats.shotXg
            + ' — 슈팅당 ' + stats.perShot + '입니다. 먼 거리에서만 쏘고 있습니다.',
          fix: '슈팅 수가 아니라 슈팅 위치가 문제입니다. 「적극적으로 슛」을 끄고 「박스 안까지 볼 배급」을 켜세요. 중거리 슛이 높은 선수의 개인 지시에서 「더 자주 슛」도 빼야 합니다.'
        });
      } else if (stats.perShot >= SHOT_QUALITY_GOOD) {
        findings.push({
          kind: 'good-shots', level: 'good',
          text: shotsKo + '슈팅당 기대 득점이 ' + stats.perShot + '입니다 — 좋은 자리에서 쏘고 있습니다.',
          fix: ''
        });
      }
    }

    /*
     * ── 수비 ──
     *
     * 둘은 정반대의 처방입니다 — 실점이 기대 실점을 넘는 것은 골키퍼,
     * 기대 실점 자체가 높은 것은 형태. 그런데 둘 다 참일 수도 있어서, 처음에는
     * "형태를 고쳐도 소용없다"와 "형태로 고쳐라"가 나란히 떴습니다. 서로 부정하는
     * 조언 두 개는 조언이 아니므로, 둘 다 걸리면 무엇을 먼저 할지까지 말합니다.
     */
    var gkNow = keeperOf(xi);
    function keeperHint() {
      if (!gkNow || (gkNow.ref === null && gkNow.ono === null && gkNow.cnt === null)) {
        return '골키퍼의 반사 신경 · 일대일 · 집중력이 낮으면 형태를 고쳐도 같은 일이 반복됩니다.';
      }
      var parts = [];
      if (gkNow.ref !== null) parts.push('반사 신경 ' + gkNow.ref);
      if (gkNow.ono !== null) parts.push('일대일 ' + gkNow.ono);
      if (gkNow.cnt !== null) parts.push('집중력 ' + gkNow.cnt);
      return '지금 골키퍼는 ' + gkNow.name + '(' + parts.join(' · ') + ')입니다.';
    }
    var keeperBad = stats.zAgainst !== null && mXga.length >= MIN_MATCHES && stats.zAgainst >= FINISH_Z;
    var shapeBad = num(stats.xgaPerRaw) !== null
      && mXga.length >= MIN_MATCHES && stats.xgaPerRaw >= 1.5;
    var xgaKo = mXga.length + '경기';
    if (shapeBad) {
      findings.push({
        kind: 'defence-shape', level: 'high',
        text: xgaKo + ' 기준 경기당 기대 실점이 ' + stats.xgaPer + '입니다 — 내주는 기회 자체가 많습니다.',
        fix: '이건 전술로 고칩니다. 수비 라인과 압박 강도가 스쿼드 속도에 맞는지, 수비형 미드필더가 뒤를 가리고 있는지부터 보세요.'
      });
    }
    if (keeperBad) {
      findings.push({
        kind: 'keeper', level: 'high',
        text: xgaKo + ' 기준 기대 실점 ' + stats.xgAgainst + '에 실제 ' + stats.goalsAgainst
          + '실점 — 내주는 기회에 비해 너무 많이 먹고 있습니다.',
        fix: (shapeBad
          ? '위의 형태 문제와 별개입니다. 형태를 먼저 고치되, 그것만으로는 이 차이가 안 없어집니다.'
          : '내주는 기회 자체는 많지 않습니다. 수비 형태보다 골키퍼를 먼저 보세요.')
          + ' ' + keeperHint(),
        who: gkNow ? [gkNow] : [],
        detail: '기준: (실제 실점 − 기대 실점) ÷ √경기수 = ' + signed(stats.zAgainst) + '.'
      });
    }

    /*
     * ── 내려앉은 상대를 반복해서 못 여는가 ──
     * 점유율과 유효 슈팅이 **같은 경기에** 다 있어야 성립합니다. 서로 다른 경기에서
     * 뽑은 두 평균을 한 문장에 넣으면 어느 경기에 대해서도 참이 아닌 말이 됩니다.
     * 기준은 경기 중 규칙(점유율 58%+ / 유효 슈팅 3개 이하)과 같게 둡니다.
     */
    /*
     * 강팀 상대로 점유율이 높고 유효 슈팅이 적은 것은 정상입니다 — 그쪽이
     * 내려앉은 게 아니라 우리가 밀린 것일 수도 있습니다. 상대 전력을 아는
     * 경기가 충분하면 강팀을 빼고 봅니다.
     */
    var parkedPool = mParked.filter(function (m) { return m.oppLevel !== 'stronger'; });
    if (parkedPool.length < 3) parkedPool = mParked;
    if (parkedPool.length >= 3) {
      var mParkedUse = parkedPool;
      var pAvg = sum(mParkedUse.map(function (m) { return m.us.possession; })) / mParkedUse.length;
      var sAvg = sum(mParkedUse.map(function (m) { return m.us.sot; })) / mParkedUse.length;
      if (pAvg >= 58 && sAvg <= 3) {
        findings.push({
          kind: 'parked-repeat', level: 'high',
          text: '점유율과 유효 슈팅이 같이 있는 ' + mParkedUse.length + '경기에서 평균 점유율 '
            + Math.round(pAvg) + '%인데 경기당 유효 슈팅이 ' + (Math.round(sAvg * 10) / 10)
            + '개입니다 — 상대가 내려앉으면 반복해서 못 열고 있습니다.',
          fix: '한 경기의 문제가 아니라 형태의 문제입니다. 내려앉은 블록을 여는 형태(폭을 잡는 측면 자원 + 오버랩 + 박스 안 제공권)를 슬롯 하나로 만들어 두세요.'
        });
      }
    }

    /*
     * ── 상대 전력별로 갈라 보기 ─────────────────────────────────────────
     *
     * 지금까지 상대 전력을 저장만 하고 안 썼습니다. 그래서 첼시 홈 1:0 승리와
     * 최하위 팀 홈 1:0 승리가 같은 값이었습니다. 전혀 다른 결과인데도요.
     *
     * 섞어 놓은 평균은 어느 쪽 문제인지 못 가립니다 — 강팀 상대로 기대 득점을
     * 못 만드는 것과 약체 상대로 만들어 놓고 못 넣는 것은 처방이 정반대입니다.
     * 그래서 보정 계수를 지어내는 대신 **묶음을 나눠서 각각 말합니다.**
     */
    var TIER_KO = { weaker: '약체', even: '비슷한 상대', stronger: '강팀' };
    var EXP = TD.EXPECTED_PTS || {};
    function ptsOf(m) { return m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0; }

    var byTier = ['weaker', 'even', 'stronger'].map(function (tier) {
      var ms = list.filter(function (m) { return m.oppLevel === tier; });
      if (!ms.length) return null;
      var pts = sum(ms.map(ptsOf));
      // 기대 승점은 장소를 아는 경기에서만 셉니다 — 모르는 장소를 홈으로 치면 안 됩니다.
      var withVenue = ms.filter(function (m) { return m.venue === 'home' || m.venue === 'away'; });
      var exp = sum(withVenue.map(function (m) {
        return (EXP[m.venue] && EXP[m.venue][tier]) || 0;
      }));
      var tXg = ms.filter(has('us', 'xg'));
      return {
        tier: tier, ko: TIER_KO[tier], n: ms.length,
        w: ms.filter(function (m) { return m.gf > m.ga; }).length,
        d: ms.filter(function (m) { return m.gf === m.ga; }).length,
        l: ms.filter(function (m) { return m.gf < m.ga; }).length,
        pts: pts, expPts: Math.round(exp * 10) / 10, expFrom: withVenue.length,
        short: withVenue.length ? Math.round((exp - sum(withVenue.map(ptsOf))) * 10) / 10 : null,
        xg: tXg.length ? Math.round(sum(tXg.map(function (m) { return m.us.xg; })) * 10) / 10 : null,
        goals: tXg.length ? sum(tXg.map(function (m) { return m.gf; })) : null,
        xgSample: tXg.length
      };
    }).filter(Boolean);

    var noTier = list.filter(function (m) {
      return m.oppLevel !== 'weaker' && m.oppLevel !== 'even' && m.oppLevel !== 'stronger';
    }).length;
    if (noTier && noTier === n) {
      findings.push({
        kind: 'no-tier', level: 'note',
        text: '저장한 경기에 상대 전력이 없어 상대별로 가를 수 없습니다.',
        fix: '「경기 중」 탭에서 상대 전력을 고르고 저장하면, 약체 상대로 못 이기는 것과 강팀 상대로 지는 것을 따로 봅니다 — 처방이 정반대입니다.'
      });
    }

    /*
     * 승점이 기대에 크게 못 미치는 묶음을 짚습니다. 시즌은 대개 한 묶음에서
     * 무너지는데, 전체 평균만 보면 그게 안 보입니다.
     */
    byTier.forEach(function (t) {
      if (t.expFrom < 3 || t.short === null) return;
      if (t.short < 2) return;
      findings.push({
        kind: 'tier-' + t.tier, level: t.short >= 4 ? 'high' : 'note',
        text: t.ko + ' 상대 ' + t.expFrom + '경기에서 승점 ' + sum(list.filter(function (m) {
          return m.oppLevel === t.tier && (m.venue === 'home' || m.venue === 'away');
        }).map(ptsOf)) + '점 — 이 도구의 기준(' + t.expPts + '점)보다 ' + t.short + '점 모자랍니다.',
        fix: t.tier === 'weaker'
          ? '시즌은 여기서 무너집니다. 약체는 대개 내려앉으므로, 블록을 여는 형태(폭을 잡는 측면 + 오버랩 + 박스 안 제공권)를 슬롯 하나로 만들어 두세요.'
          : t.tier === 'stronger'
            ? '강팀 상대 승점은 원래 적습니다. 그래도 크게 벌어지면 형태보다 멘탈리티와 수비 라인을 먼저 보세요 — 맞불을 놓다 벌어지는 경우가 많습니다.'
            : '비슷한 상대에서 벌어지면 순위가 그대로 갈립니다. 홈에서 내려앉은 상대를 못 여는지, 원정에서 역습에 뚫리는지 먼저 가르세요.',
        detail: '기준: 홈 약체 2.4 · 동급 1.7 · 강팀 1.1 / 원정 1.8 · 1.2 · 0.6 (이 도구의 잣대입니다)'
      });
    });

    /*
     * 마무리가 문제로 잡혔으면, 어느 상대에서 그런지까지 말합니다.
     * 강팀 상대로 못 넣는 것은 흔한 일이고, 약체 상대로 못 넣는 것이 진짜 문제입니다.
     */
    var badFinish = findings.filter(function (f) { return f.kind === 'finishing-bad'; })[0];
    if (badFinish) {
      var worst = byTier.filter(function (t) { return t.xgSample >= 3 && t.xg !== null; })
        .map(function (t) { return { t: t, gap: t.xg - t.goals }; })
        .sort(function (x, y) { return y.gap - x.gap; })[0];
      if (worst && worst.gap >= 1.5) {
        findings.push({
          kind: 'finishing-tier', level: 'high',
          text: '그 부족분은 ' + worst.t.ko + ' 상대에 몰려 있습니다 — ' + worst.t.xgSample
            + '경기에서 기대 득점 ' + worst.t.xg + '에 ' + worst.t.goals + '골.',
          fix: worst.t.tier === 'weaker'
            ? '약체 상대로 기회를 만들어 놓고 못 넣고 있습니다. 이건 형태가 아니라 마무리하는 선수의 문제입니다.'
            : '강팀 상대로 못 넣는 것은 흔합니다. 약체 상대 기록이 정상이라면 스트라이커를 갈아치울 이유는 아직 없습니다.'
        });
      }
    }

    // ── 홈/원정 ──
    var home = list.filter(function (m) { return m.venue === 'home'; });
    var away = list.filter(function (m) { return m.venue === 'away'; });
    function ppgOf(a) {
      if (!a.length) return null;
      return sum(a.map(function (m) { return m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0; })) / a.length;
    }
    var hp = ppgOf(home), ap = ppgOf(away);
    if (home.length >= MIN_MATCHES && away.length >= MIN_MATCHES && hp !== null && ap !== null && ap - hp >= 1) {
      findings.push({
        kind: 'home-worse', level: 'note',
        text: '홈 ' + home.length + '경기 승점이 경기당 ' + Math.round(hp * 100) / 100
          + '점, 원정 ' + away.length + '경기가 ' + Math.round(ap * 100) / 100 + '점입니다 — 홈에서 더 못하고 있습니다.',
        fix: '홈에서는 상대가 내려앉습니다. 원정용 형태 그대로 홈 경기를 치르면 공간이 없어 막힙니다 — 내려앉은 상대용 슬롯이 따로 필요합니다.'
      });
    }

    /*
     * 원정에서만 무너지는 경우. 홈이 더 나쁜 경우(home-worse)는 내려앉은 상대를
     * 못 여는 신호이고, 이쪽은 정반대 — 원정에서 형태가 통째로 밀리는 신호라
     * 처방이 다릅니다. 지금까지 한쪽만 보고 있었습니다.
     */
    if (home.length >= MIN_MATCHES && away.length >= MIN_MATCHES && hp !== null && ap !== null && hp - ap >= 1.5) {
      findings.push({
        kind: 'away-collapse', level: 'high',
        text: '홈 ' + home.length + '경기 승점이 경기당 ' + Math.round(hp * 100) / 100
          + '점인데 원정 ' + away.length + '경기는 ' + Math.round(ap * 100) / 100 + '점입니다.',
        fix: '원정에서 홈과 같은 형태로 나가면 밀립니다. 라인을 한 칸 내리고 압박을 줄인 원정용 슬롯을 하나 만들어 두고, '
          + '「상대」 탭에서 장소를 원정으로 두고 뽑으세요 — 그래야 원정 대응 규칙이 걸립니다.'
      });
    }

    /*
     * ── 기대 득점이 없어도 말할 수 있는 것 ────────────────────────────────
     *
     * 이 화면의 판정은 사실상 전부 기대 득점을 요구하고 있었습니다. 그런데
     * 일정표로 시즌을 통째로 넣으면 점수밖에 없습니다 — 여섯 경기에서 두 골을
     * 넣고 열한 골을 먹었는데 도구가 낸 말은 "마무리를 판정할 수 없습니다"
     * 하나였습니다. 사람이 보기에 그건 고장 난 것과 구별되지 않습니다.
     *
     * 경기당 0.33골은 통계가 필요 없는 사실입니다. 사실은 사실대로 말하고
     * **가를 수 없는 것만 가를 수 없다고 합니다** — 기회를 못 만드는 것인지
     * 만들어 놓고 못 넣는 것인지는 기대 득점 없이 알 수 없고, 그 둘은 처방이
     * 정반대입니다. 그러면 여기서 할 일은 무엇을 더 넣어야 답이 갈리는지까지
     * 말하는 것입니다.
     */
    /*
     * 문턱은 리그 평균에서 잡았지 이 화면에 뜨게 하려고 맞춘 값이 아닙니다.
     * 1부 리그는 대체로 경기당 1.4골 안팎에서 오갑니다 — 넣는 쪽이 0.8이면
     * 최하위권 공격이고, 먹는 쪽이 1.8이면 강등권 수비입니다. 그 선을 넘을 때만
     * 말합니다. 화면에도 이 기준을 같이 적습니다(이 도구의 잣대입니다).
     */
    var GOAL_DROUGHT = 0.8, CONCEDE_HEAVY = 1.8, MIN_SCORELINE = 5;
    if (n >= MIN_SCORELINE) {
      var gpg = gf / n, cpg = ga / n;
      if (gpg <= GOAL_DROUGHT) {
        findings.push({
          kind: 'goal-drought', level: 'high',
          text: n + '경기에서 ' + gf + '골 — 경기당 ' + (Math.round(gpg * 100) / 100) + '골입니다.',
          fix: mXg.length
            ? '기대 득점과 나란히 보세요. 기대 득점도 낮으면 기회를 못 만드는 것이고(형태 문제), 기대 득점만 높으면 마무리입니다.'
            : '여기서 갈리는 두 가지는 처방이 정반대입니다 — 기회를 못 만드는 것(형태)과 만들어 놓고 못 넣는 것(마무리). '
              + '점수만으로는 구분할 수 없습니다. 다음 경기부터 「경기 중」 탭에 기대 득점만 넣어도 이 판정이 갈립니다.',
          detail: '기준: 경기당 ' + GOAL_DROUGHT + '골 이하 — 1부 리그 평균은 1.4골 안팎입니다 (이 도구의 잣대입니다)'
        });
      }
      if (cpg >= CONCEDE_HEAVY) {
        findings.push({
          kind: 'concede-heavy', level: 'high',
          text: n + '경기에서 ' + ga + '실점 — 경기당 ' + (Math.round(cpg * 100) / 100) + '골입니다.',
          fix: '이 수준이면 선수 개인 실수보다 형태를 먼저 보세요. 수비 라인과 압박 강도가 서로 안 맞으면(라인은 높은데 압박은 약함) 그 사이 공간으로 계속 뚫립니다.',
          detail: '기준: 경기당 ' + CONCEDE_HEAVY + '실점 이상 — 강등권 수준입니다 (이 도구의 잣대입니다)'
        });
      }
    }

    /*
     * ── 반복되는 장면 ──
     * 태그는 한 경기에 같은 것을 여러 번 붙일 수 있으므로 경기 단위로 셉니다.
     * 그리고 마무리와 같은 표본 기준을 씁니다 — 두 경기로 "반복됩니다"라고 하면서
     * 옆에서는 "아직 판정할 수 없습니다"라고 하면 앞뒤가 안 맞습니다.
     */
    var tagCount = {};
    list.forEach(function (m) {
      var seen = {};
      (m.flags || []).forEach(function (id) {
        if (seen[id]) return;
        seen[id] = 1;
        tagCount[id] = (tagCount[id] || 0) + 1;
      });
    });
    if (n >= MIN_MATCHES) {
      (TD.MATCH_TAGS || []).forEach(function (t) {
        var c = tagCount[t.id] || 0;
        if (c < 2 || c / n < TAG_REPEAT) return;
        findings.push({
          kind: 'tag-' + t.id, level: 'high',
          text: n + '경기 중 ' + c + '경기에서 「' + t.ko + '」 — ' + t.repeat,
          fix: t.fix
        });
      });
    }

    // 경기별 표 — 화면에 그대로 그립니다. id를 같이 냅니다(지울 때 순서로 찾으면 안 됩니다).
    var perMatch = list.map(function (m) {
      var xg = num(m.us && m.us.xg);
      var shots = num(m.us && m.us.shots);
      return {
        id: m.id,
        opp: m.opp || '',
        venue: m.venue === 'away' ? '원정' : m.venue === 'home' ? '홈' : '—',
        score: m.gf + ':' + m.ga,
        result: m.gf > m.ga ? 'w' : m.gf === m.ga ? 'd' : 'l',
        xg: xg, xgAgainst: num(m.them && m.them.xg), shots: shots,
        perShot: (xg !== null && shots) ? Math.round(xg / shots * 1000) / 1000 : null,
        flags: m.flags || []
      };
    });

    return {
      record: record, stats: stats, findings: findings, perMatch: perMatch,
      tagCount: tagCount, byTier: byTier, noTier: noTier
    };
  }

  /*
   * ── 뎁스와 로테이션 ─────────────────────────────────────────────────────
   *
   * 지금까지 선수는 주전 아니면 나머지, 둘뿐이었습니다. 그런데 적합도 71과 70은
   * 사실상 같은 선수인데 하나는 주전, 하나는 그냥 '나머지'가 됩니다. 그 상태로는
   * "이번 주는 돌려도 된다"를 말할 수 없습니다.
   *
   * 그리고 컨디션·출전 시간을 아예 안 봤습니다. 그래서 "누구를 쉬게 할까"는
   * 이 도구가 답할 수 없는 질문이었습니다.
   *
   * 여기서 지키는 선 하나 — **최적 11은 능력치로만 정합니다.** 컨디션을 선발
   * 계산에 섞으면 파일을 새로 넣을 때마다 주전이 바뀌고, 포메이션까지 흔들려
   * 전술 친숙도 설계가 통째로 무너집니다. 컨디션은 여기서만 씁니다.
   */
  var COND_BANDS = (TD.CONDITION_BANDS || []).slice().sort(function (a, b) { return b.min - a.min; });
  var TIERS = (TD.DEPTH_TIERS || []).slice().sort(function (a, b) { return a.gap - b.gap; });

  function condBand(v) {
    if (typeof v !== 'number' || !isFinite(v) || v <= 0) return null;
    for (var i = 0; i < COND_BANDS.length; i++) {
      if (v >= COND_BANDS[i].min) return COND_BANDS[i];
    }
    return COND_BANDS[COND_BANDS.length - 1] || null;
  }
  function tierFor(gap) {
    for (var i = 0; i < TIERS.length; i++) {
      if (gap <= TIERS[i].gap) return TIERS[i];
    }
    return TIERS[TIERS.length - 1] || null;
  }

  /*
   * 자리마다 후보를 줄 세웁니다.
   *
   * 벤치 배정(benchFor)과 다른 점 — benchFor는 한 사람이 한 자리만 맡도록
   * 전체를 최적화합니다. 여기서는 "이 자리에 누가 들어올 수 있나"를 자리별로
   * 따로 봅니다. 같은 선수가 두 자리의 후보로 나오는 것이 맞습니다.
   */
  function squadTiers(input) {
    var all = (input.players || []).map(function (p, i) {
      var c = Object.assign({}, p);
      c._id = p.id || ('p' + i);
      c.positions = p.positions || [];
      c.attrs = p.attrs || {};
      return c;
    });
    var pool = splitAvailable(all).available;

    /*
     * 화면이 이미 계산해 둔 기본 전술을 넘겨받아 두 번 계산하지 않습니다.
     * 다만 그게 **지금 이 스쿼드로 만든 것인지** 확인해야 합니다 — 캐시가 낡았거나
     * 다른 목록으로 만든 것이면 이적한 선수가 '주전'으로 남아, 그 자리 뎁스가
     * 통째로 거짓이 됩니다. 하나라도 어긋나면 조용히 다시 계산합니다.
     */
    var base = (input && input.base) || null;
    if (base) {
      var inPool = {};
      pool.forEach(function (p) { inPool[p.name] = 1; });
      var stale = (base.xi && base.xi.lineup || []).some(function (l) {
        return l.player && !inPool[l.player.name];
      });
      if (stale || !base.xi) base = null;
    }
    if (!base) base = baseTactic(input || {});
    if (!base) return null;
    var cache = {};
    function fitOf(player, role, duty, slotPos) {
      var k = player._id + '|' + role.id + '|' + duty + '|' + slotPos;
      if (cache[k] === undefined) {
        var proxy = Object.create(role);
        proxy._slotPos = slotPos;
        cache[k] = roleFit(player, proxy, duty);
      }
      return cache[k];
    }

    var starterIds = {};
    base.xi.lineup.forEach(function (l) { if (l.player) starterIds[l.player._id] = 1; });

    var slots = base.xi.lineup.map(function (l) {
      var starterFit = l.player ? Math.round(fitOf(l.player, l.role, l.duty, l.slot.pos).score) : null;
      var alts = pool.filter(function (p) {
        return !l.player || p._id !== l.player._id;
      }).map(function (p) {
        var f = Math.round(fitOf(p, l.role, l.duty, l.slot.pos).score);
        var gap = starterFit === null ? 0 : starterFit - f;
        return {
          player: p, name: p.name, fit: f, gap: gap,
          tier: tierFor(Math.max(0, gap)),
          starterElsewhere: !!starterIds[p._id],
          cond: typeof p.cond === 'number' ? p.cond : null,
          band: condBand(p.cond),
          age: p.age || null, mins: typeof p.mins === 'number' ? p.mins : null
        };
      }).sort(function (a, b) { return b.fit - a.fit; });

      /*
       * 다른 자리의 주전을 '대체 자원'으로 세면 뎁스가 실제보다 두껍게 보입니다.
       * 그 사람을 여기로 옮기면 원래 자리가 비니까요. 그래서 등급 판정은
       * 선발이 아닌 선수 중에서만 합니다.
       */
      var free = alts.filter(function (a) { return !a.starterElsewhere; });
      var best = free[0] || null;
      return {
        slot: l.slot, pos: l.slot.pos, posKo: posKo(l.slot.pos),
        role: l.role, duty: l.duty,
        starter: l.player ? {
          name: l.player.name, fit: starterFit,
          cond: typeof l.player.cond === 'number' ? l.player.cond : null,
          band: condBand(l.player.cond),
          age: l.player.age || null,
          mins: typeof l.player.mins === 'number' ? l.player.mins : null,
          sharp: typeof l.player.sharp === 'number' ? l.player.sharp : null
        } : null,
        alts: alts.slice(0, 4),
        backup: best,
        tier: best ? best.tier : tierFor(Infinity)
      };
    });

    var counts = {};
    TIERS.forEach(function (t) { counts[t.id] = 0; });
    slots.forEach(function (s) { counts[s.tier.id]++; });

    /*
     * 같은 사람이 여러 자리의 대체 자원으로 잡히는 것은 맞는 계산입니다 —
     * 그 자리에 누가 들어올 수 있느냐를 자리별로 보니까요. 그런데 "대체 자원이
     * 있는 자리 7곳"만 말하면 사람이 일곱 명 있는 것처럼 읽힙니다. 실제로는
     * 세 명이 일곱 자리를 겹쳐 맡고 있을 수 있고, 그 셋 중 둘이 같은 주에 빠지면
     * 메울 수 없습니다. 그래서 겹침을 따로 셉니다.
     */
    var covered = slots.filter(function (s) { return s.backup; });
    var distinct = {};
    covered.forEach(function (s) { distinct[s.backup.player._id] = 1; });
    var heads = Object.keys(distinct).length;
    var overlap = null;
    if (covered.length && heads < covered.length) {
      overlap = {
        slots: covered.length, heads: heads,
        text: '대체 자원이 있는 ' + covered.length + '자리를 ' + heads + '명이 겹쳐 맡고 있습니다.',
        fix: heads <= 2
          ? '이 ' + heads + '명 중 하나만 빠져도 여러 자리가 동시에 비어 있는 상태가 됩니다.'
          : '같은 주에 둘이 함께 빠지면 메울 수 없는 자리가 생깁니다. 뎁스가 보이는 것보다 얇습니다.'
      };
    }

    return { base: base, slots: slots, counts: counts, pool: pool, overlap: overlap };
  }

  /*
   * 로테이션 제안.
   *
   * 세 가지 이유로만 바꿉니다. 이유 없이 "돌리세요"는 조언이 아닙니다.
   *   1. 지쳤다 — 컨디션이 낮은 주전을 대신할 사람이 있다
   *   2. 실전 감각이 없다 — 경기 체력이 바닥인데 계속 벤치에 있다
   *   3. 어린 선수가 안 뛴다 — 차이가 작은데 출전 시간이 없다
   *
   * 그리고 대가를 반드시 같이 냅니다. "몇 점을 잃고 바꾸는 것인가"를 말하지
   * 않으면 사람이 판단할 수 없습니다.
   */
  var TIRED_AT = 85;        // 이 아래면 지친 것으로 봅니다(CONDITION_BANDS의 '보통' 하한)
  var SWAP_MAX_COST = 12;   // 이보다 많이 잃으면서 쉬게 하지는 않습니다
  var YOUNG_MAX_COST = 8;   // 성장 목적이면 대가가 더 작아야 합니다

  function rotationPlan(input) {
    var t = squadTiers(input);
    if (!t) return null;

    var known = t.slots.filter(function (s) { return s.starter && s.starter.cond !== null; }).length;
    var total = t.slots.filter(function (s) { return s.starter; }).length;
    if (!total) return null;

    /*
     * 컨디션을 모르면 지어내지 않습니다. 전원 100으로 두면 "아무도 안 지쳤다"가
     * 되어 로테이션이 영원히 안 나옵니다 — 조용히 틀린 답입니다.
     */
    if (known === 0) {
      return {
        tiers: t, swaps: [], cost: 0, xi: null, known: 0, total: total,
        blocked: {
          reason: 'no-condition',
          text: '선발 중 컨디션을 아는 선수가 없어 로테이션을 짤 수 없습니다.',
          why: '컨디션을 모르는 채로 "돌리세요"라고 하면 멀쩡한 선수를 빼고 지친 선수를 넣을 수 있습니다.',
          fix: 'FM 스쿼드 보기에 「컨디션」 열(가능하면 「경기 체력」 · 「출전 시간」도)을 넣어 다시 내보내 가져오세요. 아래에서 손으로 넣어도 됩니다.'
        }
      };
    }

    var taken = {};
    var swaps = [];
    t.slots.forEach(function (s) {
      if (!s.starter) return;
      var cand = s.alts.filter(function (a) {
        return !a.starterElsewhere && !taken[a.player._id] && a.fit !== null;
      });
      if (!cand.length) return;

      var st = s.starter;
      var reason = null, limit = SWAP_MAX_COST;

      if (st.cond !== null && st.cond < TIRED_AT) reason = 'tired';

      /*
       * 지친 주전이 없더라도, 차이가 거의 없는 어린 선수가 아예 안 뛰고 있으면
       * 그건 따로 말해 줄 값어치가 있습니다. FM에서 출전 시간은 성장 그 자체입니다.
       */
      var young = null;
      if (!reason) {
        young = cand.filter(function (a) {
          return a.age !== null && a.age <= 21 && a.gap <= YOUNG_MAX_COST
            && a.mins !== null && (st.mins === null || a.mins * 3 < st.mins);
        })[0] || null;
        if (young) { reason = 'young'; limit = YOUNG_MAX_COST; }
      }
      if (!reason) return;

      /*
       * 들어올 사람도 뛸 상태여야 합니다.
       *
       * 처음에는 '지쳤다' 경로에서만 컨디션을 봤습니다. 그랬더니 무작위 검사에서
       * 컨디션 99인 주전을 빼고 76인 유망주를 넣는 조언이 나왔습니다 — 출전
       * 시간만 보고 고른 탓입니다. 어느 이유로 바꾸든 지친 선수를 넣지는 않습니다.
       */
      var pick = (reason === 'young' ? [young] : cand).filter(function (a) {
        if (a.gap > limit) return false;
        if (a.cond === null) return true;                  // 모르면 막지 않습니다
        if (a.cond < TIRED_AT) return false;               // 지친 선수를 넣지 않습니다
        if (reason !== 'tired') return true;
        return st.cond === null || a.cond > st.cond;       // 쉬게 하려면 더 나은 상태여야 합니다
      })[0];
      if (!pick) {
        if (reason === 'tired') {
          swaps.push({
            kind: 'hold', pos: s.pos, posKo: s.posKo, slot: s.slot,
            out: st, in: null, cost: null,
            text: st.name + eun(st.name) + ' 컨디션 ' + st.cond + '인데 대신할 사람이 없습니다.',
            why: s.tier.id === 'none'
              ? '이 자리는 대체 자원이 아예 없습니다.'
              : '쓸 만한 후보가 있어도 그쪽이 더 지쳤거나 차이가 너무 큽니다(허용 ' + limit + '점).',
            fix: '그대로 쓰되 후반 60~70분에 교체를 예약해 두세요. 다음 이적시장에서 이 자리 뎁스를 봐야 합니다.'
          });
        }
        return;
      }

      taken[pick.player._id] = 1;
      swaps.push({
        kind: 'swap', reason: reason, pos: s.pos, posKo: s.posKo, slot: s.slot,
        out: st, in: pick, cost: Math.max(0, pick.gap),
        text: st.name + ' → ' + pick.name + ' (' + s.posKo + ' · ' + s.role.ko + ')',
        why: reason === 'tired'
          ? st.name + '의 컨디션이 ' + st.cond + '입니다' + (pick.cond !== null ? ' (' + pick.name + ' ' + pick.cond + ')' : '')
            + ' — 이 상태로 90분을 더 뛰면 다음 경기까지 잃습니다.'
          : pick.name + '(' + pick.age + '세)의 출전 시간이 ' + pick.mins + '분입니다'
            + (st.mins !== null ? ' (' + st.name + ' ' + st.mins + '분)' : '')
            + ' — 차이가 ' + Math.max(0, pick.gap) + '점뿐인데 안 뛰면 성장하지 않습니다.',
        // 경기 체력이 낮은 선수가 들어가면 그 출전이 감각 회복이기도 합니다.
        sharpNote: (pick.player && typeof pick.player.sharp === 'number' && pick.player.sharp < 60)
          ? pick.name + '의 경기 체력이 ' + pick.player.sharp + '%입니다 — 이 출전이 실전 감각 회복도 됩니다.'
          : '',
        fix: pick.gap <= 4
          ? '적합도 차이가 ' + Math.max(0, pick.gap) + '점입니다 — 사실상 전력 손실이 없습니다.'
          : '적합도 ' + st.fit + ' → ' + pick.fit + ro(pick.fit) + ' ' + Math.max(0, pick.gap) + '점 내려갑니다. 상대가 약하면 감수할 만합니다.'
      });
    });

    var applied = swaps.filter(function (s) { return s.kind === 'swap'; });
    var cost = applied.reduce(function (n, s) { return n + s.cost; }, 0);

    // 실제로 바꾼 11명 — 화면에 그대로 그릴 수 있게 lineup 모양을 맞춥니다.
    var byPos = {};
    applied.forEach(function (s) { byPos[s.slot.id || s.slot.pos] = s; });
    var xi = t.base.xi.lineup.map(function (l) {
      var sw = byPos[l.slot.id || l.slot.pos];
      if (!sw) return l;
      return Object.assign({}, l, { player: sw.in.player, fit: sw.in.fit, rotated: true });
    });

    return {
      tiers: t, swaps: swaps, applied: applied, cost: Math.round(cost),
      xi: applied.length ? { formation: t.base.xi.formation, lineup: xi } : null,
      known: known, total: total, blocked: null
    };
  }

  /*
   * ── 슬롯 세트 추천 ──────────────────────────────────────────────────────
   *
   * 이 도구는 슬롯을 진단만 하고 있었습니다 — "셋 다 같은 성격입니다", "뼈대가
   * 쪼개졌습니다". 맞는 말인데, **무엇을 만들어야 하는지는 말하지 않았습니다.**
   *
   * 실제 시즌 기록을 받아 보니 그게 그대로 드러났습니다. 원정 네 경기에서 승점 0,
   * 1득 10실. 강팀 원정에서 꺼낼 형태가 아예 없었던 것인데, 도구는 기본 전술
   * 하나만 내주고 "슬롯을 저장하세요"라고만 했습니다. 한 장짜리 전술로 시즌을
   * 치르면 맨시티 원정과 최하위 홈경기를 같은 형태로 치르게 됩니다.
   *
   * 그래서 **세 장을 통째로 설계해서 내줍니다.**
   *   1. 주력      — 대부분의 경기
   *   2. 버티기     — 강팀 원정, 리드 지키기 (내려앉기 / 역습)
   *   3. 공략      — 내려앉은 약체 (점유 / 측면 / 중앙 과부하 / 뒷공간)
   *
   * 세 장은 **뼈대(뒷선 인원 · 최전방 인원)를 맞춥니다.** 전술 친숙도는 전술마다
   * 따로 쌓이지만 선수 개인의 포지션 친숙도는 선수한테 쌓이기 때문에, 뼈대가 같은
   * 슬롯은 훨씬 싸게 익습니다. 뼈대를 맞추느라 점수를 얼마나 손해 봤는지도 같이
   * 냅니다 — 그 손해가 크면 사람이 직접 판단해야 하니까요.
   */
  var KIT_ROLES = [
    { id: 'primary', ko: '주력', plans: null,
      why: '대부분의 경기에서 씁니다. 스쿼드에 가장 잘 맞는 형태입니다.' },
    { id: 'hold', ko: '버티기', plans: ['low-block', 'counter'],
      why: '강팀 원정, 그리고 리드를 지켜야 하는 마지막 20분에 꺼냅니다. 이게 없으면 강팀 원정을 주력 전술로 치르게 됩니다.' },
    { id: 'break', ko: '공략', plans: ['possession', 'wide-cross', 'overload-centre', 'in-behind'],
      why: '내려앉은 약체를 상대할 때 꺼냅니다. 이게 없으면 홈에서 버스를 세운 팀을 못 엽니다.' }
  ];

  function slotKit(input) {
    var players = (input.players || []).map(function (p, i) {
      var c = Object.assign({}, p);
      c._id = p.id || ('p' + i);
      c.positions = p.positions || [];
      c.attrs = p.attrs || {};
      return c;
    });
    players = splitAvailable(players).available;
    if (players.length < 11) return null;

    var squad = summariseSquad(players);
    var standing = STANDING_PLAN_PRIOR[input.standing] ? input.standing : 'mid';
    var fitCache = {};

    // 플랜 × 포메이션 전부를 한 번 훑습니다(빠른 계산). 세 장을 여기서 고릅니다.
    var grid = [];
    Object.keys(TD.PLANS).forEach(function (planId) {
      var planW = planRoleWeights([{ id: planId }]);
      var bonus = squadPlanBonus(planId, squad);
      FD.FORMATIONS.forEach(function (f) {
        var xi = buildXI(players, f, planW, {}, { fitCache: fitCache, fast: true });
        grid.push({
          planId: planId, formation: f, xi: xi,
          shape: shapeOf(f),
          score: round1(xi.teamFit + xi.planFit * 2 + bonus + basePrior(planId, f, standing))
        });
      });
    });
    grid.sort(function (a, b) { return b.score - a.score; });

    var primary = grid[0];
    var usedForm = {}, usedPlan = {};
    var picks = [];

    KIT_ROLES.forEach(function (role) {
      var pool = grid.filter(function (c) {
        if (role.plans && role.plans.indexOf(c.planId) < 0) return false;
        // 같은 포메이션을 두 슬롯에 넣으면 한 장을 버리는 것과 같습니다.
        if (usedForm[c.formation.id]) return false;
        /*
         * 방향까지 같으면 더 나쁩니다 — 포메이션만 다르고 팀 지시가 글자까지
         * 같은 두 장을 들고 다니게 됩니다. 세 장을 두는 이유는 상황이 세 가지라서지
         * 형태가 세 가지라서가 아닙니다.
         */
        if (usedPlan[c.planId]) return false;
        return true;
      });
      if (!pool.length) return;
      // 뼈대가 같은 것 중 최고. 없으면 뼈대를 포기하고 최고를 씁니다.
      var same = pool.filter(function (c) { return c.shape.key === primary.shape.key; });
      var pick = same.length ? same[0] : pool[0];
      var free = pool[0];
      usedForm[pick.formation.id] = 1;
      usedPlan[pick.planId] = 1;
      picks.push({
        role: role.id, roleKo: role.ko, why: role.why,
        planId: pick.planId, planKo: TD.PLANS[pick.planId].ko,
        formationId: pick.formation.id, formationKo: pick.formation.ko,
        shape: pick.shape, score: pick.score,
        sameShape: pick.shape.key === primary.shape.key,
        // 뼈대를 안 따졌으면 나왔을 점수. 이걸 같이 내야 뼈대 비용을 검산할 수 있습니다.
        freeScore: free.score,
        /*
         * 뼈대를 맞추느라 잃은 점수. 크면 사람이 판단해야 합니다 — 훈련이
         * 쪼개지는 값을 치르더라도 더 맞는 형태를 쓸지는 취향이 아니라 사정입니다.
         */
        shapeCost: round1(free.score - pick.score),
        instructions: planInstructions(pick.planId)
      });
    });

    if (!picks.length) return null;

    var offShape = picks.filter(function (p) { return !p.sameShape; });
    return {
      shape: primary.shape,
      picks: picks,
      offShape: offShape.length,
      note: offShape.length
        ? offShape.length + '장은 뼈대가 다릅니다 — 그만큼 전술 훈련이 쪼개집니다.'
        : '세 장이 뼈대(' + primary.shape.ko + ')를 공유합니다 — 선수 포지션 친숙도를 같이 쓰므로 훨씬 싸게 익습니다.'
    };
  }

  function baseTactic(input) {
    var players = (input.players || []).map(function (p, i) {
      var c = Object.assign({}, p);
      c._id = p.id || ('p' + i);
      c.positions = p.positions || [];
      c.attrs = p.attrs || {};
      return c;
    });
    var split = splitAvailable(players);
    players = split.available;
    if (players.length < 7) return null;

    var squad = summariseSquad(players);
    var ctx = normaliseContext(input.context);
    var opp = normaliseOpponent({});      // 상대 없음 — 중립
    var standing = STANDING_PLAN_PRIOR[input.standing] ? input.standing : 'mid';
    var fitCache = {};
    var planIds = Object.keys(TD.PLANS);
    var pool = FD.FORMATIONS.filter(function (f) {
      return !input.allowedFormations || !input.allowedFormations.length
        || input.allowedFormations.indexOf(f.id) >= 0;
    });

    // 1) 플랜 × 포메이션을 빠르게 훑어 후보를 추립니다.
    var cands = [];
    planIds.forEach(function (planId) {
      var planW = planRoleWeights([{ id: planId }]);
      var bonus = squadPlanBonus(planId, squad);
      pool.forEach(function (f) {
        var xi = buildXI(players, f, planW, {}, { fitCache: fitCache, fast: true });
        var prior = basePrior(planId, f, standing);
        cands.push({
          planId: planId, formation: f, xi: xi,
          squadBonus: round1(bonus), prior: round1(prior),
          score: xi.teamFit + xi.planFit * 2 + bonus + prior
        });
      });
    });
    cands.sort(function (a, b) { return b.score - a.score; });

    // 2) 상위 후보만 제대로 다시 계산합니다(역할 재검토 + 교체 두께).
    var top = cands.slice(0, 8).map(function (c) {
      var planW = planRoleWeights([{ id: c.planId }]);
      var xi = buildXI(players, c.formation, planW, {}, { fitCache: fitCache });
      var bench = benchFor(players, xi);
      // 채워진 자리만으로 평균을 냅니다. 빈 자리를 0으로 세면 스쿼드가 얇을 때
      // 모든 포메이션이 똑같이 낮아져 아무것도 구분하지 못합니다.
      var filled = bench.filter(function (b) { return b.player; });
      var depth = filled.length ? avg(filled.map(function (b) { return b.fit; })) : 0;
      var covered = filled.length;
      return {
        planId: c.planId, formation: c.formation, xi: xi, bench: bench,
        squadBonus: c.squadBonus, prior: c.prior,
        depth: Math.round(depth), depthCovered: covered,
        score: round1(xi.teamFit + xi.planFit * 2 + c.squadBonus + c.prior
          + clamp((depth - 45) * 0.12, -4, 4) * (covered / 11))
      };
    }).sort(function (a, b) { return b.score - a.score; });

    var best = top[0];

    // 3) 고른 플랜으로 지시를 냅니다. 상대는 중립이므로 여기서 나오는 지시는
    //    스쿼드와 우리 형태에서만 나온 것입니다.
    var ourSum = summariseFormation(best.formation);
    var xiPlayers = best.xi.lineup.map(function (l) { return l.player; }).filter(Boolean);
    var xiSquad = xiPlayers.length >= 7 ? summariseSquad(xiPlayers) : squad;
    var fired = evaluateRules(opp, ctx, xiSquad, ourSum, null);
    var acc = accumulate(fired);
    // 상대가 없으므로 플랜은 우리가 고른 것으로 고정합니다.
    var planTop = [{ id: best.planId, ko: TD.PLANS[best.planId].ko, desc: TD.PLANS[best.planId].desc, score: best.score }];
    contextualInstructions(acc, best.xi, opp, ctx, planTop);
    var instructions = finaliseInstructions(acc, planTop);
    var warnings = balanceWarnings(best.xi, instructions.axes, instructions.toggles, xiSquad, opp);
    var pis = individualInstructions(best.xi, opp, planTop, instructions.axes);

    return {
      squad: squad,
      xiSquad: xiSquad,
      standing: standing,
      unavailable: split.unavailable,
      plan: planTop[0],
      formation: best.formation,
      xi: best.xi,
      bench: best.bench,
      depth: best.depth,
      depthCovered: best.depthCovered,
      instructions: instructions,
      warnings: warnings,
      individual: pis,
      reasons: fired.map(function (f) { return { why: f.why, action: f.action, group: f.rule.group }; }),
      ranking: top.map(function (c) {
        return {
          planId: c.planId, planKo: TD.PLANS[c.planId].ko,
          formationId: c.formation.id, formationKo: c.formation.ko,
          score: c.score, teamFit: c.xi.teamFit, planFit: c.xi.planFit,
          squadBonus: c.squadBonus, prior: c.prior, depth: c.depth, depthCovered: c.depthCovered
        };
      })
    };
  }

  /*
   * ── 영입이 필요한 자리 ──────────────────────────────────────────────────
   *
   * 기본 전술을 기준으로 스쿼드를 봅니다. "어느 포지션에 선수가 몇 명 있나"만
   * 세면 쓸모가 없습니다 — 이름만 그 자리인 선수가 셋 있어도 전술이 요구하는
   * 역할을 못 하면 없는 것과 같기 때문입니다. 그래서 기본 전술이 그 자리에
   * 요구하는 역할을 기준으로, 지금 최고인 선수가 그 역할의 요구치를 넘는지까지 봅니다.
   *
   * 원하는 선수 유형도 같은 이유로 "좋은 센터백"이 아니라 그 역할의 요구 능력치와
   * 지금 부족한 값으로 적습니다. 스카우트 필터에 그대로 옮길 수 있어야 쓸모가 있습니다.
   */
  var SIDE_KO = { DR: '오른쪽', WBR: '오른쪽', MR: '오른쪽', AMR: '오른쪽',
    DL: '왼쪽', WBL: '왼쪽', ML: '왼쪽', AML: '왼쪽' };

  function wantedFoot(role, pos) {
    var tags = role.tags || [];
    var side = pos.indexOf('R') >= 0 ? 'r' : (pos.indexOf('L') >= 0 && pos !== 'GK' ? 'l' : null);
    if (!side) return null;
    if (tags.indexOf('inverted') >= 0 || tags.indexOf('narrow-drift') >= 0) {
      return side === 'r' ? '왼발' : '오른발';
    }
    if (tags.indexOf('crosser') >= 0) return side === 'r' ? '오른발' : '왼발';
    return null;
  }

  function squadNeeds(input) {
    var base = input.base || baseTactic(input);
    if (!base) return null;
    var players = splitAvailable((input.players || []).map(function (p, i) {
      var c = Object.assign({}, p);
      c._id = p.id || ('p' + i);
      c.positions = p.positions || [];
      c.attrs = p.attrs || {};
      return c;
    })).available;

    var slotCount = {};
    base.formation.slots.forEach(function (s) { slotCount[s.pos] = (slotCount[s.pos] || 0) + 1; });

    /*
     * 포지션을 모르면 영입 제안을 하면 안 됩니다.
     *
     * 스쿼드에 포지션 열이 없으면 모든 자리가 "등록된 선수 0명"이 되어, 열한
     * 자리를 전부 「급함」으로 내놓습니다. 실제로 골키퍼가 있는데도 "골키퍼가
     * 없다"고 말하게 됩니다 — 틀린 조언을 확신 있게 하는 것이라 아무 말도
     * 안 하느니만 못합니다. 그래서 세어 보고, 모자라면 목록 대신 사실을 냅니다.
     */
    var withPos = players.filter(function (p) { return p.positions.length; }).length;
    var posCoverage = players.length ? withPos / players.length : 0;
    if (players.length >= 7 && posCoverage < 0.5) {
      return {
        blocked: {
          reason: 'no-positions',
          withPos: withPos, total: players.length,
          text: '선수 ' + players.length + '명 중 ' + withPos + '명만 등록 포지션을 알고 있습니다.',
          why: '누가 어느 자리를 볼 수 있는지 모르면 「이 자리에 사람이 없다」와 「포지션을 안 넣었다」를 구분할 수 없습니다. '
            + '지금 상태로 목록을 내면 이미 있는 골키퍼를 두고 골키퍼를 사라고 하게 됩니다.',
          fix: 'FM 스쿼드 화면 보기에 「포지션」 열을 넣어 한 번만 다시 내보내 주세요. 그 한 번으로 이 탭이 통째로 정확해집니다.'
        },
        needs: [], surplus: [], team: [], base: base, unavailable: base.unavailable || []
      };
    }

    // 포지션별로 한 번씩만 봅니다 — 센터백 두 자리를 따로 적으면 같은 말이 두 번 나옵니다.
    var seen = {}, needs = [], surplus = [];
    base.xi.lineup.forEach(function (l, i) {
      var pos = l.slot.pos;
      if (seen[pos]) return;
      seen[pos] = 1;

      var naturals = players.filter(function (p) { return p.positions.indexOf(pos) >= 0; });
      var need = slotCount[pos];
      var starter = l.player, starterFit = l.fit;
      var back = base.bench[i] || {};

      /*
       * 이 자리를 볼 수 있는 선수들의 능력치 최고값. 무엇이 모자란지 보려면
       * 지금 팀에서 가장 나은 값과 비교해야 합니다.
       *
       * 등록 선수가 없을 때 스쿼드 전체를 기준으로 삼으면 안 됩니다 —
       * 오른쪽 풀백을 구하는데 센터백의 마크 16을 보고 "마크 17 이상"을 요구하게
       * 됩니다. 그 자리를 볼 수 있는 사람이 아무도 없으면 기준도 없는 것입니다.
       */
      var refPool = naturals.length ? naturals
        : players.filter(function (p) { return positionFamiliarity(p, pos) >= 0.6; });
      function bestAttr(id) {
        var vals = refPool.map(function (p) {
          var v = p.attrs[id];
          return typeof v === 'number' && v > 0 ? v : null;
        }).filter(function (v) { return v !== null; });
        return vals.length ? Math.max.apply(null, vals) : null;
      }
      // 그 자리를 볼 수 있는 선수가 아예 없을 때의 기준. 스쿼드의 일반적인 수준을
      // 씁니다 — 최고값을 쓰면 전문가 한 명(센터백의 마크)이 기준이 되어,
      // 오른쪽 풀백에게 마크 17을 요구하는 식이 됩니다.
      function levelAttr(id) {
        var vals = players.map(function (p) {
          var v = p.attrs[id];
          return typeof v === 'number' && v > 0 ? v : null;
        }).filter(function (v) { return v !== null; }).sort(function (x, y) { return x - y; });
        return vals.length ? vals[Math.floor(vals.length / 2)] : null;
      }

      var req = l.role.req || {};
      var wantAttrs = Object.keys(req).map(function (id) {
        return { id: id, ko: RD.ATTRS[id].ko, need: req[id], best: bestAttr(id), level: levelAttr(id) };
      });
      // 요구치가 없는 역할은 강조 능력치 앞쪽을 대신 씁니다.
      if (!wantAttrs.length) {
        wantAttrs = l.role.key.slice(0, 4).map(function (id) {
          return { id: id, ko: RD.ATTRS[id].ko, need: null, best: bestAttr(id), level: levelAttr(id) };
        });
      }
      var short = wantAttrs.filter(function (a) { return a.need && a.best !== null && a.best < a.need; });

      // 그 자리에 선 선수가 원래 그 자리 선수인지 — 아니면 급한 대로 메운 것입니다.
      var starterNatural = !!(starter && starter.positions.indexOf(pos) >= 0);

      var severity = null, reason = '';
      if (!naturals.length) {
        severity = 'critical';
        reason = starter
          ? ('이 자리에 등록된 선수가 없어 ' + starter.name + iga(starter.name) + ' 임시로 서 있습니다(적합도 ' + starterFit + ').')
          : '이 자리에 등록된 선수가 한 명도 없습니다.';
      } else if (!starterNatural) {
        severity = 'critical';
        reason = '등록 선수가 ' + naturals.length + '명 있지만 다른 자리에 쓰이고 있어, 지금은 이 자리가 아닌 선수가 서 있습니다.';
      } else if (starterFit !== null && starterFit < 55) {
        severity = 'critical';
        reason = '주전 적합도가 ' + starterFit + '입니다 — 이 역할을 수행할 선수가 사실상 없습니다.';
      } else if (short.length) {
        severity = 'high';
        reason = '이 자리에서 가장 나은 선수도 ' + l.role.ko + ' 요구치를 못 넘습니다.';
      } else if (naturals.length <= need) {
        severity = 'high';
        reason = need > 1
          ? ('선발 ' + need + '자리를 ' + naturals.length + '명이 채우고 있어 백업이 없습니다.')
          : '백업이 없습니다 — 부상이나 경고 누적이면 이 자리가 비어 버립니다.';
      } else if (!back.player) {
        severity = 'high';
        // 등록 선수는 남는데 백업이 비었다면, 그 선수가 다른 빈 자리를 메우고 있는 것입니다.
        reason = '등록 선수는 ' + naturals.length + '명이지만 남는 선수가 다른 빈 자리를 메우고 있어, 이 자리에 백업이 없습니다.';
      } else if (back.fit !== null && back.fit < 50) {
        severity = 'high';
        reason = '백업 적합도가 ' + back.fit + '입니다 — 로테이션에 쓰기 어렵습니다.';
      } else if (back.fit < 58) {
        severity = 'mid';
        reason = '백업 적합도가 ' + back.fit + ira(back.fit) + ' 주전과 차이가 큽니다.';
      }

      if (naturals.length >= need + 3) {
        surplus.push({ pos: pos, ko: posKo(pos), count: naturals.length, need: need });
      }
      if (!severity) return;

      /*
       * 목표치는 왜 필요한 영입인지에 따라 달라집니다.
       * 주전이 없거나 못 뛰는 자리는 지금보다 나은 선수가 필요하고,
       * 백업이 없는 자리는 주전만큼일 필요 없이 비슷한 수준이면 됩니다.
       * 둘을 같은 값으로 적으면 "3번째 센터백에게 팀 최고보다 높은 마크"를 요구하게 됩니다.
       */
      var upgrade = severity === 'critical';
      wantAttrs.forEach(function (a) {
        if (a.need) { a.target = a.need; a.targetKind = 'req'; return; }
        if (!naturals.length) {
          // 비교할 선수가 없으니 스쿼드 일반 수준보다 한 단계 위를 적습니다.
          a.target = a.level === null ? null : Math.min(20, Math.max(12, a.level + 1));
          a.targetKind = 'level';
          return;
        }
        if (a.best === null) { a.target = null; a.targetKind = null; return; }
        a.target = upgrade ? Math.min(20, a.best + 1) : Math.max(11, a.best - 1);
        a.targetKind = upgrade ? 'upgrade' : 'depth';
      });

      var foot = wantedFoot(l.role, pos);
      var sideKo = SIDE_KO[pos] || '';
      needs.push({
        pos: pos, ko: posKo(pos), severity: severity, reason: reason,
        role: { id: l.role.id, ko: l.role.ko, abbr: l.role.abbr }, duty: l.duty,
        starter: starter ? { name: starter.name, fit: starterFit, natural: starterNatural } : null,
        backup: back.player ? { name: back.player.name, fit: back.fit } : null,
        naturalCount: naturals.length, slots: need,
        wantAttrs: wantAttrs, shortAttrs: short, foot: foot,
        profile: (sideKo ? sideKo + ' ' : '') + l.role.ko
          + (foot ? ' · ' + foot : '')
          + ' — ' + wantAttrs.map(function (a) {
            // "좋은 센터백"은 스카우트 필터에 넣을 수 없습니다. 숫자로 적습니다.
            return a.ko + (a.target ? ' ' + a.target + '↑' : '');
          }).join(' · ')
      });
    });

    // 영입이 필요하다고 적은 자리를 '남는 자리'에도 올리면 서로 어긋나 보입니다.
    // 등록 인원은 많은데 쓸 만한 백업이 없는 경우가 그렇고, 그건 영입 쪽 이야기입니다.
    var needPos = {};
    needs.forEach(function (n) { needPos[n.pos] = 1; });
    surplus = surplus.filter(function (x) { return !needPos[x.pos]; });

    var order = { critical: 0, high: 1, mid: 2 };
    needs.sort(function (a, b) {
      if (order[a.severity] !== order[b.severity]) return order[a.severity] - order[b.severity];
      return b.shortAttrs.length - a.shortAttrs.length;
    });

    // 팀 전체 관점 — 자리별로는 안 보이는 구멍.
    var team = [];
    var s = base.xiSquad;
    var plan = base.plan.id;
    var hasAerial = base.xi.lineup.some(function (l) {
      var a = (l.player && l.player.attrs) || {};
      return ['ST', 'AMC'].indexOf(l.slot.pos) >= 0 && (a.hea || 0) >= 14 && (a.jum || 0) >= 14;
    });
    if ((plan === 'wide-cross') && !hasAerial) {
      team.push('전술 방향이 측면·크로스인데 박스 안에서 헤딩으로 받아 줄 선수가 없습니다 — 제공권 있는 최전방이 이 스쿼드의 가장 큰 구멍입니다.');
    }
    if (plan === 'press-high' && s.stamina > 0 && s.stamina < 13) {
      team.push('전방 압박을 기본으로 두려면 스태미너·활동량이 받쳐 줘야 합니다(현재 평균 ' + s.stamina + '). 중원과 최전방에 체력형 자원이 필요합니다.');
    }
    if (plan === 'possession' && s.technique > 0 && s.technique < 12) {
      team.push('점유를 기본으로 두기에는 팀 기술 평균이 ' + s.technique + ro(s.technique) + ' 낮습니다 — 후방과 중원의 패스·퍼스트 터치를 올릴 영입이 먼저입니다.');
    }
    if (s.pace > 0 && s.pace < 12) {
      team.push('앞선 평균 속도가 ' + s.pace + '입니다 — 뒷공간을 노리는 경기 방식 자체가 막혀 있어, 상대가 라인을 올려도 벌줄 방법이 없습니다.');
    }
    if (base.depthCovered < 6) {
      team.push('선발 11자리 중 백업이 있는 자리가 ' + base.depthCovered + '곳뿐입니다 — 시즌을 치르려면 폭 자체가 부족합니다.');
    }

    return { needs: needs, surplus: surplus, team: team, base: base,
      unavailable: base.unavailable || [] };
  }

  function posKo(pos) {
    var p = RD.POSITIONS.filter(function (x) { return x.id === pos; })[0];
    return p ? p.ko : pos;
  }

  /*
   * ── 세트피스 ────────────────────────────────────────────────────────────
   *
   * 선발 11명을 받아 코너킥·프리킥·페널티·스로인에 누구를 세울지 냅니다.
   *
   * 원칙 두 가지.
   *  - 능력치를 모르면 비워 둡니다. 모르는 값을 0으로 보면 "능력치가 낮은
   *    선수"와 구분되지 않아 엉뚱한 사람이 키커가 됩니다.
   *  - 한 사람이 두 자리를 겸하지 않습니다. 키커가 박스 안에 있을 수 없습니다.
   */
  function spScore(player, spec) {
    var a = (player && player.attrs) || {};
    var sum = 0, wsum = 0, seen = 0;
    Object.keys(spec.weight).forEach(function (id) {
      var v = a[id];
      var w = spec.weight[id];
      wsum += w;
      if (typeof v === 'number' && v > 0) { sum += v * w; seen++; }
    });
    if (!seen || !wsum) return null;
    // 값을 아는 항목이 절반도 안 되면 판단하지 않습니다.
    if (seen < Math.ceil(Object.keys(spec.weight).length / 2)) return null;
    var score = (sum / wsum);
    /*
     * 「감아 차기」 같은 특성은 같은 능력치라면 이 선수를 키커로 만듭니다.
     * 자리 id는 루틴마다 겹치므로 FM 자리 이름으로 판단합니다 — 프리킥 루틴이
     * 늘어날 때마다 여기에 id를 하나씩 더 적는 방식은 반드시 빠뜨립니다.
     */
    var key = spec.fm === 'Corner Taker' ? 'corner'
      : (spec.fm === 'Take Free Kick' || spec.fm === 'Free Kick Taker' || spec.fm === 'Wide Free Kick')
        ? 'fkDirect' : null;
    if (key) {
      ((player && player.traits) || []).forEach(function (id) {
        var t = traitById(id);
        if (t && t.setPiece && t.setPiece[key]) score += t.setPiece[key];
      });
    }
    return Math.round(score * 10) / 10;
  }

  function meetsNeed(player, spec) {
    if (!spec.need) return true;
    var a = (player && player.attrs) || {};
    return Object.keys(spec.need).every(function (id) {
      var v = a[id];
      // 모르는 값은 막지 않습니다 — 능력치를 안 넣은 스쿼드에서 전부 비어 버립니다.
      return typeof v !== 'number' || v <= 0 || v >= spec.need[id];
    });
  }

  function assignSetPiece(specs, pool) {
    var taken = {};
    return specs.map(function (spec) {
      var picks = [];
      for (var n = 0; n < (spec.count || 1); n++) {
        var best = null, bestScore = -1;
        pool.forEach(function (p) {
          if (!p.player || taken[p.player.name]) return;
          if (!meetsNeed(p.player, spec)) return;
          var s = spScore(p.player, spec);
          if (s === null) return;
          if (s > bestScore) { bestScore = s; best = p; }
        });
        if (!best) break;
        taken[best.player.name] = 1;
        picks.push({ name: best.player.name, pos: best.slot.pos, role: best.role.ko, score: bestScore });
      }
      return { id: spec.id, ko: spec.ko, fm: spec.fm, why: spec.why, need: spec.need || null, picks: picks };
    });
  }

  /*
   * 오른쪽 코너를 왼발잡이가 차면 공이 골문 쪽으로 감겨 들어옵니다(인스윙).
   * 같은 발이면 골문에서 멀어지며 나갑니다(아웃스윙). 둘은 노려야 할 자리가
   * 다르므로, 발을 알면 여기까지 말해 줘야 배치가 맞물립니다.
   */
  function swingNote(taker, side, what) {
    if (!taker) return null;
    var foot = taker.foot;
    if (foot !== 'L' && foot !== 'R') return null;
    var sideKo = side === 'r' ? '오른쪽' : '왼쪽';
    var label = what || '코너';
    var inswing = (side === 'r' && foot === 'L') || (side === 'l' && foot === 'R');
    return inswing
      ? {
        side: side, kind: 'in',
        text: sideKo + ' ' + label + eun(label) + ' ' + (foot === 'L' ? '왼발' : '오른발') + '잡이가 차면 인스윙입니다 — 공이 골문 쪽으로 감겨 들어옵니다.',
        fix: '니어 포스트로 달려드는 선수와 골키퍼 방해를 살리세요. 공이 이미 골문으로 오므로 먼저 닿기만 하면 됩니다.'
      }
      : {
        side: side, kind: 'out',
        text: sideKo + ' ' + label + eun(label) + ' ' + (foot === 'L' ? '왼발' : '오른발') + '잡이가 차면 아웃스윙입니다 — 공이 골문에서 멀어지며 나옵니다.',
        fix: '파 포스트로 달려드는 선수와 박스 가장자리 대기를 살리세요. 골키퍼가 나와서 잡기 어려운 궤적입니다.'
      };
  }

  function setPieces(xi) {
    var SP = root.FM_SETPIECE_DATA;
    if (!SP || !xi || !xi.lineup) return null;

    var outfield = xi.lineup.filter(function (l) { return l.slot.pos !== 'GK' && l.player; });
    var all = xi.lineup.filter(function (l) { return l.player; });

    /*
     * 루틴별로 따로 배치합니다.
     *
     * 상황이 다르면 세울 사람도 다릅니다 — 중앙 프리킥의 키커와 측면 프리킥의
     * 키커는 요구하는 능력치가 아예 다르고, 깊은 프리킥에서는 뒤에 남길 인원이
     * 두 배입니다. 한 배치를 모든 프리킥에 돌려 쓰면 셋 다 어중간해집니다.
     */
    var routines = (SP.ROUTINES || []).map(function (r) {
      return {
        id: r.id, side: r.side, kind: r.kind, ko: r.ko, fm: r.fm,
        when: r.when, desc: r.desc,
        slots: assignSetPiece(r.slots, outfield),
        notes: []
      };
    });
    var byRoutine = {};
    routines.forEach(function (r) { byRoutine[r.id] = r; });

    // 예전 이름 — 화면과 검사가 코너를 이 이름으로 씁니다.
    var attack = byRoutine['att-corner'] ? byRoutine['att-corner'].slots : assignSetPiece(SP.ATT_CORNER, outfield);
    var defence = byRoutine['def-corner'] ? byRoutine['def-corner'].slots : assignSetPiece(SP.DEF_CORNER, outfield);
    // 전문 키커는 서로 겸할 수 있습니다 — FM에서도 같은 선수가 프리킥과 페널티를
    // 함께 차는 것이 보통입니다. 그래서 자리를 나눠 갖지 않고 각각 최고를 뽑습니다.
    var specialists = SP.SPECIALISTS.map(function (spec) {
      var best = null, bestScore = -1;
      outfield.forEach(function (p) {
        if (!meetsNeed(p.player, spec)) return;
        var s = spScore(p.player, spec);
        if (s === null) return;
        if (s > bestScore) { bestScore = s; best = p; }
      });
      return {
        id: spec.id, ko: spec.ko, fm: spec.fm, why: spec.why, need: spec.need || null,
        picks: best ? [{ name: best.player.name, pos: best.slot.pos, role: best.role.ko, score: bestScore }] : []
      };
    });

    function playerNamed(name) {
      if (!name) return null;
      var hit = all.filter(function (l) { return l.player.name === name; })[0];
      return hit ? hit.player : null;
    }
    // 어떤 루틴에서 어느 자리를 누가 맡았는지 — 아래 진단이 전부 여기서 나옵니다.
    function pickOf(routineId, slotId, n) {
      var r = byRoutine[routineId];
      if (!r) return null;
      var s = r.slots.filter(function (x) { return x.id === slotId; })[0];
      return (s && s.picks[n || 0]) || null;
    }
    function playerAt(routineId, slotId, n) {
      var p = pickOf(routineId, slotId, n);
      return p ? playerNamed(p.name) : null;
    }

    // 코너 키커의 발 — 인스윙/아웃스윙 판단
    var taker = playerAt('att-corner', 'taker');
    var swing = [swingNote(taker, 'l'), swingNote(taker, 'r')].filter(Boolean);

    /*
     * 이 팀이 세트피스로 먹고살 팀인지 진단합니다.
     * 「세트피스 노리기」를 켤지가 여기서 갈립니다 — 제공권 자원이 없는데 켜면
     * 공격 방향만 단순해지고 얻는 것이 없습니다.
     */
    function aerialOf(l) {
      var a = (l.player && l.player.attrs) || {};
      if (typeof a.hea !== 'number' || typeof a.jum !== 'number' || a.hea <= 0 || a.jum <= 0) return null;
      return (a.hea + a.jum) / 2;
    }
    var aerials = outfield.map(aerialOf).filter(function (v) { return v !== null; });
    var box = aerials.slice().sort(function (a, b) { return b - a; }).slice(0, 4);
    var boxMean = box.length ? Math.round((box.reduce(function (s, v) { return s + v; }, 0) / box.length) * 10) / 10 : null;
    var known = aerials.length;

    var verdict = null;
    if (known >= 6 && boxMean !== null) {
      if (boxMean >= 14) {
        verdict = {
          level: 'good', mean: boxMean,
          text: '박스 안 제공권 상위 4명의 평균이 ' + boxMean + '입니다 — 세트피스가 이 팀의 실제 득점 경로입니다.',
          fix: '팀 지시에서 「세트피스 노리기」를 켜고, 코너를 짧게 처리하지 마세요.'
        };
      } else if (boxMean >= 11.5) {
        verdict = {
          level: 'mid', mean: boxMean,
          text: '박스 안 제공권 평균이 ' + boxMean + '입니다 — 세트피스는 덤이지 주 무기는 아닙니다.',
          fix: '「세트피스 노리기」는 켜지 말고, 뒤지고 있을 때만 경기 중에 켜세요.'
        };
      } else {
        verdict = {
          level: 'poor', mean: boxMean,
          text: '박스 안 제공권 평균이 ' + boxMean + '입니다 — 높은 공을 올려 봐야 상대가 걷어냅니다.',
          fix: '코너는 짧게 처리하고 두 번째 공을 노리세요. 박스 가장자리 대기를 한 명 더 두는 편이 낫습니다.'
        };
      }
    }

    // 수비 세트피스는 별개입니다 — 공격은 골라 넣을 수 있지만 수비는 못 피합니다.
    var weakDef = null;
    if (known >= 8) {
      var lowCount = aerials.filter(function (v) { return v < 10; }).length;
      if (lowCount >= 4) {
        weakDef = {
          count: lowCount,
          text: '선발 중 공중볼이 약한 선수가 ' + lowCount + '명입니다 — 상대 코너에서 계속 위험해집니다.',
          fix: '맨마킹 대신 지역 방어 비중을 늘리고, 앞에 남기는 인원을 하나로 줄여 박스 안 숫자를 확보하세요.'
        };
      }
    }

    /*
     * ── 루틴별 진단 ───────────────────────────────────────────────────────
     *
     * 배치만 내놓으면 "이대로 두면 되나"를 알 수 없습니다. 프리킥은 특히
     * 그렇습니다 — 직접 슛이 되는 선수가 없으면 중앙 루틴 자체를 크로스로
     * 바꿔야 하고, 키커의 발에 따라 노려야 할 포스트가 반대가 됩니다.
     * 배치와 같은 자리에 그 판단을 붙입니다.
     */
    function note(routineId, level, text, fix) {
      var r = byRoutine[routineId];
      if (r) r.notes.push({ level: level, text: text, fix: fix || '' });
    }
    function footKo(p) { return p && p.foot === 'L' ? '왼발' : p && p.foot === 'R' ? '오른발' : null; }

    // 공격 프리킥 · 중앙 — 직접 노릴 사람이 있는가
    var fkTaker = playerAt('att-fk-central', 'fk-taker');
    var fkPick = pickOf('att-fk-central', 'fk-taker');
    var fkSecond = playerAt('att-fk-central', 'fk-second');
    var bestFre = null;
    outfield.forEach(function (l) {
      var v = l.player.attrs && l.player.attrs.fre;
      if (typeof v === 'number' && v > 0 && (bestFre === null || v > bestFre)) bestFre = v;
    });
    if (!fkPick) {
      note('att-fk-central', 'high',
        bestFre === null
          ? '프리킥 능력치를 아는 선발이 없어 직접 슈팅 자리를 못 정했습니다.'
          : '선발 중 프리킥 12를 넘는 선수가 없습니다(가장 높은 값 ' + bestFre + ') — 직접 노리면 대부분 벽에 맞습니다.',
        '중앙에서도 「공격 프리킥 · 측면」의 크로스 배치를 그대로 쓰세요. 박스 안에 사람을 넣는 편이 훨씬 낫습니다.');
    } else if (bestFre !== null && bestFre >= 15) {
      note('att-fk-central', 'good',
        fkPick.name + '의 프리킥이 ' + bestFre + '입니다 — 이 선수의 프리킥 자체가 득점 경로입니다.',
        '파울을 얻는 위치를 만드세요. 측면 자원에게 「안쪽으로 접어 들어가기」를 주면 골문 앞에서 파울이 늘어납니다.');
    }
    if (fkTaker && fkSecond) {
      var f1 = footKo(fkTaker), f2 = footKo(fkSecond);
      if (f1 && f2 && f1 !== f2) {
        note('att-fk-central', 'good',
          '공 위의 두 명이 서로 다른 발입니다(' + fkPick.name + ' ' + f1 + ' / ' + pickOf('att-fk-central', 'fk-second').name + ' ' + f2 + ') — 상대가 벽 위치와 골키퍼 자리를 미리 못 정합니다.', '');
      } else if (f1 && f2) {
        note('att-fk-central', 'note',
          '공 위의 두 명이 같은 발입니다(둘 다 ' + f1 + ') — 상대 골키퍼가 한쪽만 보면 됩니다.',
          '반대발 선수를 한 명 세우면 같은 배치로 효과가 커집니다.');
      }
    }

    // 공격 프리킥 · 측면 — 키커의 발이 노릴 포스트를 정합니다
    var wideTaker = playerAt('att-fk-wide', 'fk-taker');
    var fkSwing = [swingNote(wideTaker, 'l', '측면 프리킥'), swingNote(wideTaker, 'r', '측면 프리킥')].filter(Boolean);
    fkSwing.forEach(function (s) { note('att-fk-wide', 'note', s.text, s.fix); });
    if (verdict && verdict.level === 'poor') {
      note('att-fk-wide', 'high',
        '박스 안 제공권이 약해(평균 ' + verdict.mean + ') 올려도 상대가 걷어냅니다.',
        '「짧은 패스 옵션」을 살려 짧게 연결하고, 박스 안 인원 하나를 박스 가장자리로 빼세요.');
      note('att-fk-deep', 'high',
        '깊은 위치에서 그냥 띄우면 이 스쿼드로는 경합에서 거의 못 이깁니다.',
        '짧게 연결해 공을 지키고 다시 만드세요. 여기서 뺏기면 그대로 역습입니다.');
    }

    // 수비 — 앞에 남길 사람이 없으면 배치가 통째로 달라집니다
    ['def-fk-central', 'def-fk-wide', 'def-corner'].forEach(function (id) {
      if (!byRoutine[id]) return;
      if (pickOf(id, 'outlet')) return;
      note(id, 'note',
        '앞에 남길 만큼 발 빠른 선수가 없습니다(속도 12 이상).',
        '전원 내려서 막고 세컨볼만 노리세요. 느린 선수를 앞에 남기면 그냥 한 명을 버리는 것입니다.');
    });
    if (weakDef) {
      note('def-fk-wide', 'high', weakDef.text, weakDef.fix);
    }

    // 자리를 채울 사람이 없으면 그 자리는 조용히 비는 대신 이유를 말합니다.
    routines.forEach(function (r) {
      var empty = r.slots.filter(function (s) {
        return !s.picks.length && s.need;
      });
      if (!empty.length) return;
      r.notes.push({
        level: 'note',
        text: empty.map(function (s) { return '「' + s.ko + '」'; }).join(', ')
          + ' 자리는 최소 기준을 넘는 선수가 없어 비워 뒀습니다.',
        fix: '기준에 못 미치는 선수를 세우면 조언이 아니라 방해가 됩니다. 그 자리는 FM 기본값으로 두세요.'
      });
    });

    return {
      attack: attack, defence: defence, specialists: specialists,
      routines: routines, fkSwing: fkSwing,
      swing: swing, verdict: verdict, weakDefence: weakDef,
      known: known, boxMean: boxMean
    };
  }

  /*
   * ── 저장해 둔 전술 중에서 고르기 ────────────────────────────────────────
   *
   * FM에서는 포메이션을 매 경기 갈아엎을 수 없습니다. 선수들이 그 전술에
   * 익숙해지는 데 몇 주가 걸리고(전술 친숙도), 바꾸는 순간 그게 리셋됩니다.
   * 그런데 이 도구는 상대가 바뀔 때마다 포메이션을 새로 골랐습니다 — 상대
   * 다섯 팀에 포메이션 네 종류가 나왔습니다. 게임에서 따라 할 수 없는 조언입니다.
   *
   * 그래서 FM처럼 전술을 최대 세 개 들고 다니고, 경기마다 **그중에서** 고릅니다.
   * 포메이션은 고정한 채 역할·임무·지시만 상대에 맞춰 움직입니다.
   *
   * 저장해 둔 것으로 도저히 안 되는 상대도 있습니다. 그때는 조용히 새 포메이션을
   * 내밀지 않고, 얼마나 차이가 나는지와 "새로 만들면 훈련이 필요하다"를 함께
   * 말합니다 — 판단은 사람이 합니다.
   */
  var NEW_TACTIC_GAP = 12;   // 이 정도 벌어지면 새로 만드는 것을 검토할 만합니다
  var MAX_SLOTS = 3;         // FM도 세 개까지입니다
  var KO_COUNT = { 1: '하나', 2: '둘', 3: '셋' };

  var FAM_BY_ID = {};
  (TD.FAMILIARITY || []).forEach(function (f) { FAM_BY_ID[f.id] = f; });

  /*
   * 슬롯의 '뼈대'.
   *
   * 전술 친숙도는 전술마다 따로 쌓이지만, 선수 개인의 포지션 친숙도는 선수한테
   * 쌓입니다. 그래서 뒷선 인원과 최전방 인원이 같은 두 슬롯은 선수들이 서는
   * 자리가 대체로 같고, 배우는 비용이 훨씬 쌉니다. 4-2-3-1과 4-4-1-1은 옆
   * 슬롯으로 둘 만하지만 4-2-3-1과 3-5-2는 사실상 전술을 두 벌 익히는 일입니다.
   */
  function shapeOf(f) {
    var back = 0, st = 0;
    f.slots.forEach(function (s) {
      if (s.pos === 'DC' || s.pos === 'DL' || s.pos === 'DR' || s.pos === 'WBL' || s.pos === 'WBR') back++;
      if (s.pos === 'ST') st++;
    });
    return {
      key: back + '-' + st,
      ko: (back >= 5 ? '스리백' : '포백') + ' · 최전방 ' + st + '명'
    };
  }

  function famOf(t) {
    return (t && t.familiarity && FAM_BY_ID[t.familiarity]) || null;
  }

  /*
   * ── 슬롯 구성 진단 ──────────────────────────────────────────────────────
   *
   * "카운터 전술을 상대마다 유지하면 전술 적응력이 실패하지 않느냐"는 질문의
   * 답은 슬롯 구성에 달려 있습니다. 이미 익힌 슬롯끼리 갈아타는 것은 공짜지만,
   * 뼈대가 다 제각각인 슬롯 세 개는 훈련이 셋으로 쪼개져 어느 것도 안 올라갑니다.
   * 반대로 셋 다 성격이 비슷하면 훈련은 싸지만 강팀 원정에서 꺼낼 게 없습니다.
   *
   * 이 함수는 그 둘을 같이 봅니다 — 훈련 비용과 대응 폭.
   */
  function slotAudit(tactics) {
    var slots = (tactics || []).filter(function (t) {
      return t && t.formationId && FORMATION_BY_ID[t.formationId];
    }).map(function (t) {
      var f = FORMATION_BY_ID[t.formationId];
      var sh = shapeOf(f);
      return {
        tactic: t, formation: f, shape: sh.key, shapeKo: sh.ko,
        fam: famOf(t),
        roles: (TD.SLOT_ROLES || []).filter(function (r) {
          return r.tags.some(function (tag) { return f.tags.indexOf(tag) >= 0; });
        }).map(function (r) { return r.id; })
      };
    });

    var n = slots.length;
    var findings = [];
    var shapes = {};
    slots.forEach(function (s) { shapes[s.shape] = (shapes[s.shape] || 0) + 1; });
    var shapeKeys = Object.keys(shapes);

    var covered = {}, missing = [];
    (TD.SLOT_ROLES || []).forEach(function (r) {
      var who = slots.filter(function (s) { return s.roles.indexOf(r.id) >= 0; });
      covered[r.id] = who.map(function (s) { return s.tactic.name; });
      if (!who.length) missing.push(r);
    });

    if (!n) {
      findings.push({
        kind: 'none', level: 'high',
        text: '저장한 전술이 없습니다 — 「맞춤 전술」이 상대마다 포메이션까지 새로 고릅니다.',
        fix: '그대로 따라 하면 게임에서 전술 친숙도가 매번 리셋됩니다. 지금 전술을 슬롯에 저장해 두세요.'
      });
      return { slots: slots, findings: findings, count: 0, shapes: shapeKeys, covered: covered, missing: missing, split: '' };
    }

    // ── 훈련 비용 ──
    if (n === 1) {
      findings.push({
        kind: 'single', level: 'note',
        text: '슬롯이 하나입니다 — 훈련이 전부 여기에 몰리니 친숙도는 가장 빨리 올라갑니다.',
        fix: '대신 성격이 다른 상대를 만나면 형태를 바꿀 수단이 없습니다. 익은 뒤에 두 번째를 만드세요.'
      });
    } else if (shapeKeys.length === 1) {
      findings.push({
        kind: 'one-shape', level: 'good',
        text: '슬롯 ' + n + '개가 모두 같은 뼈대(' + slots[0].shapeKo + ')입니다 — 선수들이 서는 자리가 같아 훈련이 가장 싸게 먹힙니다.',
        fix: ''
      });
    } else if (shapeKeys.length === n && n >= 3) {
      var splitKo = KO_COUNT[n] || n + '개';
      findings.push({
        kind: 'all-distinct', level: 'high',
        text: '슬롯 ' + n + '개의 뼈대가 전부 다릅니다(' + slots.map(function (s) { return s.shapeKo; }).join(' / ') + ') — 전술 훈련이 ' + splitKo + ro(splitKo) + ' 쪼개져 어느 것도 잘 안 올라갑니다.',
        fix: '두 개는 뒷선과 최전방 인원을 맞추세요. 선수들이 서는 자리가 같으면 개인 포지션 친숙도가 그대로 이어져 훨씬 싸게 익습니다.'
      });
    } else if (shapeKeys.length === n) {
      // 슬롯 둘, 뼈대 둘. 대응 폭은 생기지만 훈련이 정확히 반으로 갈립니다.
      findings.push({
        kind: 'split-shape', level: 'note',
        text: '슬롯 둘의 뼈대가 다릅니다(' + slots.map(function (s) { return s.shapeKo; }).join(' / ') + ') — 대응 폭은 넓어지지만 전술 훈련이 둘로 갈립니다.',
        fix: '둘 다 익을 때까지는 세 번째를 만들지 마세요. 어중간한 셋보다 몸에 밴 둘이 셉니다.'
      });
    } else {
      // 셋 중 둘이 같은 뼈대 — 훈련이 한쪽에 모이면서 대응 폭도 남습니다.
      findings.push({
        kind: 'shared-shape', level: 'good',
        text: '슬롯 ' + n + '개 중 둘이 같은 뼈대(' + slots.filter(function (s) { return shapes[s.shape] > 1; })[0].shapeKo + ')라 훈련이 그쪽에 모입니다 — 대응 폭과 훈련 비용이 둘 다 맞는 구성입니다.',
        fix: ''
      });
    }

    // ── 중복 ──
    var byFormation = {};
    slots.forEach(function (s) {
      (byFormation[s.formation.id] = byFormation[s.formation.id] || []).push(s.tactic.name);
    });
    Object.keys(byFormation).forEach(function (fid) {
      if (byFormation[fid].length < 2) return;
      findings.push({
        kind: 'duplicate', level: 'note',
        text: '「' + byFormation[fid].join('」와 「') + '」' + iga(byFormation[fid][byFormation[fid].length - 1])
          + ' 같은 포메이션입니다(' + FORMATION_BY_ID[fid].ko + ').',
        fix: 'FM에서는 같은 포메이션을 멘탈리티만 바꿔 두 벌 저장하는 것이 유효하지만, 이 도구는 어차피 상대마다 역할·임무·지시를 바꿔 줍니다. 슬롯은 형태가 다를 때만 여기서 의미가 있습니다.'
      });
    });

    // ── 대응 폭 ──
    missing.forEach(function (r) {
      var full = n >= MAX_SLOTS;
      findings.push({
        kind: 'gap-' + r.id, level: 'note',
        text: '「' + r.ko + '」에 쓸 형태가 슬롯에 없습니다 — ' + r.why,
        fix: full
          ? '슬롯 ' + MAX_SLOTS + '개가 다 찼습니다. 가장 안 쓰는 슬롯을 이 자리로 바꿀지 검토해 보세요.'
          : '남은 슬롯에 이 성격의 포메이션을 하나 넣어 두면 대응 폭이 생깁니다.'
      });
    });

    // ── 친숙도 ──
    var unknown = slots.filter(function (s) { return !s.fam; });
    var raw = slots.filter(function (s) { return s.fam && s.fam.penalty >= 6; });
    if (raw.length) {
      findings.push({
        kind: 'untrained', level: 'high',
        // 조사를 괄호 뒤에 붙이면 「B · 수비」(어색함)는 처럼 어긋납니다.
        text: raw.length > 1
          ? '아직 덜 익은 슬롯이 ' + (KO_COUNT[raw.length] || raw.length + '개') + '입니다 — '
            + raw.map(function (s) { return '「' + s.tactic.name + '」(' + s.fam.ko + ')'; }).join(', ') + '.'
          : '「' + raw[0].tactic.name + '」' + eun(raw[0].tactic.name) + ' 아직 ' + raw[0].fam.ko
            + '입니다 — 지금 꺼내면 점수표대로 안 나옵니다.',
        fix: raw[0].fam.fix
      });
    }
    if (unknown.length === n) {
      findings.push({
        kind: 'fam-unknown', level: 'note',
        text: '슬롯 친숙도를 아직 넣지 않았습니다 — 지금은 종이 위 궁합만 보고 고릅니다.',
        fix: 'FM 전술 화면의 친숙도 막대를 보고 슬롯마다 넣어 두면, 형태가 조금 덜 맞아도 몸에 밴 쪽을 고릅니다.'
      });
    }

    var split = n === 1
      ? '전술 훈련 세션이 전부 이 하나에 들어갑니다.'
      : '전술 훈련 세션 한 칸은 전술 하나만 올립니다 — 슬롯이 ' + (KO_COUNT[n] || n + '개')
        + '이면 같은 주에 다 올릴 수 없습니다.';

    return {
      slots: slots, findings: findings, count: n,
      shapes: shapeKeys, covered: covered, missing: missing, split: split
    };
  }

  function pickTactic(input) {
    var tactics = (input.tactics || []).filter(function (t) {
      return t && t.formationId && FORMATION_BY_ID[t.formationId];
    });
    if (!tactics.length) return null;

    var ids = tactics.map(function (t) { return t.formationId; });
    var fitted = generate(Object.assign({}, input, { allowedFormations: ids }));
    if (!fitted) return null;
    var free = generate(Object.assign({}, input, { allowedFormations: null }));

    /*
     * 슬롯별 점수 — 저장한 순서가 아니라 이 상대에 맞는 순서로 세웁니다.
     *
     * total은 종이 위 궁합, effective는 거기서 친숙도만큼 깎은 값입니다.
     * 친숙도를 아직 안 넣었으면 둘이 같으므로 예전과 똑같이 동작합니다.
     */
    var byId = {};
    (fitted.formationRanking || []).forEach(function (r) { byId[r.id] = r; });
    var ranking = tactics.map(function (t) {
      var r = byId[t.formationId] || null;
      var fam = famOf(t);
      var total = r ? r.total : null;
      var pen = fam ? fam.penalty : 0;
      var sh = shapeOf(FORMATION_BY_ID[t.formationId]);
      return {
        tactic: t,
        formation: FORMATION_BY_ID[t.formationId],
        total: total,
        fam: fam,
        famPenalty: pen,
        effective: total === null ? null : round1(total - pen),
        shape: sh.key, shapeKo: sh.ko,
        notes: r ? r.notes : [],
        weakness: FORMATION_BY_ID[t.formationId].weakness
      };
    }).sort(function (a, b) {
      return (b.effective === null ? -1e9 : b.effective) - (a.effective === null ? -1e9 : a.effective);
    });

    var best = ranking[0];

    // 종이 위 궁합만 봤을 때의 1위. 친숙도가 순서를 뒤집었는지 보려면 따로 필요합니다.
    var rawBest = ranking.slice().sort(function (a, b) {
      return (b.total === null ? -1e9 : b.total) - (a.total === null ? -1e9 : a.total);
    })[0];

    /*
     * 친숙도가 순서를 뒤집었으면 그 슬롯으로 다시 짭니다.
     * generate는 저장된 것 중 점수 1위를 고르므로, 그대로 두면 화면에 나온
     * 슬롯 이름과 실제 선발이 어긋납니다.
     */
    if (best.tactic.formationId !== fitted.xi.formation.id) {
      var redone = generate(Object.assign({}, input, { allowedFormations: [best.tactic.formationId] }));
      if (redone) fitted = redone;
    }

    var freeTop = (free && free.formationRanking && free.formationRanking[0]) || null;
    // 새 포메이션을 만들지 말지는 '종이 위 궁합'끼리 견줍니다. 저장본이 덜 익었다는
    // 것은 훈련으로 풀 문제이지 포메이션을 하나 더 만들 이유가 아닙니다.
    var saved = rawBest.total;
    var gap = (freeTop && saved !== null) ? round1(freeTop.total - saved) : 0;
    var sameAsFree = !freeTop || freeTop.id === rawBest.tactic.formationId;

    /*
     * 친숙도가 선택을 바꾼 경우 — 왜 점수 1위를 안 골랐는지 먼저 말해야 합니다.
     * 말하지 않으면 표에 보이는 숫자와 추천이 어긋난 것으로만 보입니다.
     */
    var famOverride = null;
    if (rawBest.tactic !== best.tactic) {
      famOverride = {
        from: rawBest, to: best,
        diff: round1((rawBest.total || 0) - (best.total || 0)),
        text: '형태만 보면 「' + rawBest.tactic.name + '」' + iga(rawBest.tactic.name) + ' '
          + round1((rawBest.total || 0) - (best.total || 0)) + '점 낫지만 아직 ' + rawBest.fam.ko
          + ira(rawBest.fam.ko) + ', 이번 경기는 ' + (best.fam ? best.fam.ko + '까지 올라온 ' : '')
          + '「' + best.tactic.name + '」' + eul(best.tactic.name) + ' 씁니다 — '
          + '안 익은 전술은 점수표대로 안 나옵니다.'
      };
    }

    // 제약 없이 골랐다면 어땠을까 — 새 포메이션을 만들지 말지는 여기서 갈립니다.
    var advise = 'use-saved', tail = '';
    if (sameAsFree) {
      tail = '제약 없이 골라도 ' + rawBest.formation.ko + iga(rawBest.formation.ko)
        + ' 1위입니다 — 슬롯 구성 자체는 이 상대에 맞습니다.';
    } else if (gap < NEW_TACTIC_GAP) {
      tail = '제약 없이 고르면 ' + freeTop.ko + iga(freeTop.ko) + ' 조금 더 맞지만(+' + gap + ') '
        + '그 차이로 포메이션을 새로 익힐 값어치는 없습니다 — 전술 친숙도가 리셋되는 손해가 더 큽니다.';
    } else {
      advise = 'consider-new';
      tail = '저장해 둔 전술로는 이 상대가 버겁습니다. ' + freeTop.ko + iga(freeTop.ko) + ' '
        + rawBest.formation.ko + '보다 ' + gap + '점 낫습니다. '
        + '다만 새 포메이션은 선수들이 익히는 데 시간이 걸리므로, 이번 한 경기 때문에 바꾸지는 마세요 — '
        + '같은 유형의 상대를 자주 만난다면 세 번째 슬롯으로 만들어 두고 훈련시키는 쪽이 맞습니다.';
    }

    // 왜 이 슬롯인가 — 한 문장.
    var lead = famOverride ? famOverride.text
      : advise === 'consider-new'
        ? '저장해 둔 전술 중에서는 「' + best.tactic.name + '」' + iga(best.tactic.name) + ' 낫습니다.'
        : '저장해 둔 전술 중 「' + best.tactic.name + '」' + iga(best.tactic.name) + ' 이 상대에 가장 맞습니다.';
    var note = lead + ' ' + tail;

    // 고른 슬롯 자체가 덜 익었으면 그것도 말합니다.
    var trainNote = '';
    if (best.fam && best.fam.penalty >= 6) {
      trainNote = '다만 「' + best.tactic.name + '」' + eun(best.tactic.name) + ' 아직 ' + best.fam.ko
        + '입니다 — ' + best.fam.fix;
    }

    return {
      best: best, ranking: ranking, result: fitted,
      free: free, freeTop: freeTop, gap: gap, sameAsFree: sameAsFree,
      rawBest: rawBest, famOverride: famOverride, trainNote: trainNote,
      audit: slotAudit(tactics),
      advise: advise, note: note
    };
  }

  /*
   * ── 훈련 제안 ───────────────────────────────────────────────────────────
   *
   * 지금까지 이 도구는 "이 자리에 사람이 없으니 영입하라"까지만 말했습니다.
   * 그런데 FM에서 훨씬 싼 해법은 **추가 포지션 훈련**입니다 — 이미 스쿼드에 있는
   * 선수가 그 자리를 배우면 됩니다. 판단에 필요한 값은 이미 다 계산하고 있습니다.
   *
   * 두 가지를 냅니다.
   *   1. 포지션 훈련 — 비어 있는 자리를 누가 배우면 메워지는가
   *   2. 개인 훈련 초점 — 선발 각자가 지금 역할에서 가장 손해 보고 있는 능력치
   */
  /*
   * 훈련으로 배울 수 있는 범위.
   *   LEARN_FLOOR : 이 아래로 낯선 자리는 훈련 대상이 아닙니다(옆자리가 아님).
   *   LEARN_CEIL  : 배워도 원래 자리만큼 자연스러워지지는 않습니다.
   */
  var LEARN_FLOOR = 0.55;
  var LEARN_CEIL = 0.85;
  var TRAIN_AGE_NOTE = {
    young: '어려서 새 포지션을 빨리 배웁니다.',
    ok: '',
    old: '나이가 있어 습득이 느립니다 — 급하면 영입이 빠릅니다.'
  };
  function ageBand(age) {
    if (typeof age !== 'number' || !age) return 'ok';
    if (age <= 23) return 'young';
    if (age >= 30) return 'old';
    return 'ok';
  }

  function trainingPlan(input) {
    var players = (input.players || []).filter(function (p) { return !p.out; });
    var base = baseTactic(input);
    if (!base) return null;

    var lineup = base.xi.lineup;
    var starters = {};
    lineup.forEach(function (l) { if (l.player) starters[l.player.name] = 1; });

    /*
     * 1) 포지션 훈련.
     *
     * 자리마다 "지금 그 자리를 등록 포지션으로 가진 선수"가 몇 명인지 셉니다.
     * 모자란 자리에 대해, 배우면 가장 크게 오르는 선수를 찾습니다. 적합도는
     * 이미 친숙도를 곱해서 내므로, 친숙도만 1로 두고 다시 계산하면
     * "배운 뒤의 값"이 그대로 나옵니다.
     */
    var posTraining = [];
    var slotPos = {};
    lineup.forEach(function (l) { slotPos[l.slot.pos] = (slotPos[l.slot.pos] || 0) + 1; });

    Object.keys(slotPos).forEach(function (pos) {
      var natural = players.filter(function (p) {
        return (p.positions || []).indexOf(pos) >= 0;
      });
      // 선발 자리 수보다 그 자리를 뛸 수 있는 사람이 많으면 훈련이 필요 없습니다.
      if (natural.length > slotPos[pos]) return;

      var slot = lineup.filter(function (l) { return l.slot.pos === pos; })[0];
      if (!slot) return;
      var role = slot.role;

      var best = null;
      players.forEach(function (p) {
        if ((p.positions || []).indexOf(pos) >= 0) return;      // 이미 뛸 수 있음
        var r = Object.create(role);
        r._slotPos = pos;
        var now = roleFit(p, r, slot.duty);
        /*
         * 옆자리만 제안합니다.
         *
         * 처음에는 친숙도가 낮을수록 이득이 커 보여서 골키퍼에게 왼쪽 수비를
         * 배우라고 했습니다 — 친숙도 0.05로 나누니 이득이 폭발했기 때문입니다.
         * 실제로 배울 만한 것은 옆자리뿐이고, 그 밖은 훈련이 아니라 영입 문제입니다.
         */
        if (now.familiarity < LEARN_FLOOR || now.familiarity >= LEARN_CEIL) return;
        // 훈련해도 '자연스러움'까지는 잘 가지 않습니다. 현실적인 천장을 둡니다.
        var learned = clamp(now.score / now.familiarity * LEARN_CEIL, 0, 100);
        var gain = learned - now.score;
        if (gain < 4) return;
        var band = ageBand(p.age);
        /*
         * 이미 선발인 선수를 다른 자리로 가르치라고 하면, 그 자리를 메우는 대신
         * 원래 자리에 구멍이 납니다. 주전 센터백에게 오른쪽 수비를 배우라는 조언은
         * 실제로 쓸 수가 없습니다. 그래서 벤치 자원을 먼저 봅니다.
         */
        var isStarter = !!starters[p.name];
        // 어린 선수가 같은 이득이면 먼저입니다 — 실제로 더 빨리 배웁니다.
        var rank = gain * (band === 'young' ? 1.25 : band === 'old' ? 0.7 : 1)
          * (isStarter ? 0.45 : 1);
        if (!best || rank > best.rank) {
          best = {
            rank: rank, player: p, pos: pos, role: role, isStarter: isStarter,
            now: Math.round(now.score), after: Math.round(learned),
            gain: Math.round(gain), band: band, age: p.age || null,
            familiarity: Math.round(now.familiarity * 100)
          };
        }
      });
      if (!best) return;
      posTraining.push({
        pos: pos, posKo: posKo(pos), roleKo: role.ko, isStarter: best.isStarter,
        name: best.player.name, age: best.age, band: best.band,
        now: best.now, after: best.after, gain: best.gain,
        naturals: natural.length, slots: slotPos[pos],
        text: best.player.name + eul(best.player.name) + ' ' + posKo(pos) + '에 추가 포지션 훈련',
        why: natural.length === 0
          ? posKo(pos) + eul(posKo(pos)) + ' 등록 포지션으로 가진 선수가 한 명도 없습니다 — 지금은 남의 자리에 세워 두고 있습니다.'
          : posKo(pos) + eul(posKo(pos)) + ' 뛸 수 있는 선수가 ' + natural.length + '명인데 선발에서 '
            + slotPos[pos] + '자리를 씁니다 — 한 명만 빠지면 메울 사람이 없습니다.',
        gainText: '적합도 ' + best.now + ' → ' + best.after + ' (+' + best.gain + ')',
        ageNote: TRAIN_AGE_NOTE[best.band],
        // 벤치 자원이 없어 주전을 고른 경우. 그대로 두면 다른 자리가 빕니다.
        starterNote: best.isStarter
          ? best.player.name + eun(best.player.name) + ' 지금 선발입니다 — 이 자리로 옮기면 원래 자리가 빕니다. 벤치에 배울 만한 자원이 없다는 뜻이기도 합니다.'
          : ''
      });
    });
    posTraining.sort(function (a, b) { return b.gain - a.gain; });

    /*
     * 2) 개인 훈련 초점.
     *
     * 선발 각자가 지금 맡은 역할에서 가장 손해 보고 있는 능력치를 찾습니다.
     * 역할이 강조하는 능력치(key) 중 팀 안에서도 낮고 역할 요구에도 못 미치는 것.
     * 요구치를 못 넘긴 항목이 있으면 그게 최우선입니다 — 역할의 전제 자체입니다.
     */
    var focus = [];
    lineup.forEach(function (l) {
      if (!l.player) return;
      var a = l.player.attrs || {};
      var role = Object.create(l.role);
      role._slotPos = l.slot.pos;
      var fit = roleFit(l.player, role, l.duty);

      // 요구치 미달이 있으면 그것부터.
      if (fit.reqFail && fit.reqFail.length) {
        var worst = fit.reqFail.slice().sort(function (x, y) {
          return (x.have / x.need) - (y.have / y.need);
        })[0];
        focus.push({
          name: l.player.name, pos: l.slot.pos, roleKo: l.role.ko,
          attr: worst.attr, attrKo: RD.ATTRS[worst.attr].ko,
          have: worst.have, want: worst.need, kind: 'req',
          band: ageBand(l.player.age), age: l.player.age || null,
          why: l.role.ko + iga(l.role.ko) + ' 성립하려면 ' + RD.ATTRS[worst.attr].ko + ' ' + worst.need
            + iga(String(worst.need)) + ' 필요한데 ' + worst.have + '입니다 — 역할의 전제가 무너진 상태입니다.'
        });
        return;
      }
      // 아니면 key 능력치 중 가장 낮은 것.
      var cands = (l.role.key || []).map(function (id) {
        var v = a[id];
        return (typeof v === 'number' && v > 0) ? { id: id, v: v } : null;
      }).filter(Boolean).sort(function (x, y) { return x.v - y.v; });
      if (!cands.length) return;
      var low = cands[0];
      if (low.v >= 13) return;   // 이미 쓸 만하면 굳이 훈련 초점을 잡지 않습니다
      focus.push({
        name: l.player.name, pos: l.slot.pos, roleKo: l.role.ko,
        attr: low.id, attrKo: RD.ATTRS[low.id].ko,
        have: low.v, want: null, kind: 'key',
        band: ageBand(l.player.age), age: l.player.age || null,
        why: l.role.ko + iga(l.role.ko) + ' 가장 많이 쓰는 능력치 중 ' + RD.ATTRS[low.id].ko
          + iga(RD.ATTRS[low.id].ko) + ' ' + low.v + ro(String(low.v)) + ' 가장 낮습니다.'
      });
    });
    focus.sort(function (x, y) {
      if (x.kind !== y.kind) return x.kind === 'req' ? -1 : 1;
      return x.have - y.have;
    });

    /*
     * 3) 나이 — 2년 뒤에 비는 자리.
     *
     * age를 읽고 있으면서 아무 데도 쓰지 않고 있었습니다. 지금 멀쩡한 자리라도
     * 주전이 30대이고 뒤가 비어 있으면 그건 곧 영입이 필요한 자리입니다.
     */
    var ageing = [];
    lineup.forEach(function (l) {
      if (!l.player || typeof l.player.age !== 'number' || l.player.age < 30) return;
      var pos = l.slot.pos;
      var younger = players.filter(function (p) {
        return p.name !== l.player.name
          && (p.positions || []).indexOf(pos) >= 0
          && typeof p.age === 'number' && p.age <= 26;
      });
      ageing.push({
        name: l.player.name, age: l.player.age, pos: pos, posKo: posKo(pos), roleKo: l.role.ko,
        successors: younger.map(function (p) { return p.name; }),
        text: l.player.name + '(' + l.player.age + '세) · ' + posKo(pos),
        why: younger.length
          ? '뒤에 ' + younger.map(function (p) { return p.name + '(' + p.age + '세)'; }).join(', ')
            + iga('세)') + ' 있습니다 — 지금부터 출전 시간을 나눠 두면 됩니다.'
          : '이 자리에 26세 이하 자원이 없습니다. 지금은 문제가 없어도 2년 안에 비는 자리입니다.'
      });
    });
    ageing.sort(function (x, y) { return (x.successors.length - y.successors.length) || (y.age - x.age); });

    return {
      position: posTraining, focus: focus, ageing: ageing,
      formation: base.xi.formation, plan: base.plan
    };
  }

  /*
   * ── 경기 중 조정 ────────────────────────────────────────────────────────
   *
   * 시간대 · 점수 · 상황 · 전반 기록을 받아 무엇을 건드릴지 냅니다.
   *
   * 없는 값은 NaN으로 둡니다. null로 두면 `null <= 42`가 참이 되어,
   * 점유율을 모르는 경기에서 "밀리고 있습니다"가 튀어나옵니다.
   */
  function normStats(o) {
    var out = {};
    TD.MATCH_STATS.forEach(function (m) {
      var v = o ? o[m.id] : undefined;
      out[m.id] = (typeof v === 'number' && isFinite(v)) ? v : NaN;
    });
    return out;
  }

  function inMatchAdvice(input) {
    input = input || {};
    var phase = TD.MATCH_PHASES.filter(function (p) { return p.id === input.phase; })[0]
      || TD.MATCH_PHASES[2];
    var gf = numOr(input.goalsFor, 0), ga = numOr(input.goalsAgainst, 0);
    var flags = input.flags || [];
    var hasStats = !!(input.stats && input.stats.us && input.stats.them);
    var us = normStats(hasStats ? input.stats.us : null);
    var them = normStats(hasStats ? input.stats.them : null);

    // 모르면 '비슷함'으로 봅니다. 여기서 약체나 강팀으로 찍으면 조언이
    // 정반대로 갈리므로, 확인되지 않은 쪽으로 기울이지 않습니다.
    var levels = TD.OPP_LEVELS.map(function (l) { return l.id; });
    var oppLevel = levels.indexOf(input.oppLevel) >= 0 ? input.oppLevel : 'even';

    var c = {
      phase: phase.id, phaseIdx: phase.idx,
      diff: gf - ga, gf: gf, ga: ga,
      oppLevel: oppLevel,
      flag: function (id) { return flags.indexOf(id) >= 0; },
      s: hasStats, us: us, them: them
    };

    var fired = [];
    TD.INMATCH_RULES.forEach(function (rule) {
      var ok;
      try { ok = rule.when(c); } catch (e) { ok = false; }
      if (!ok) return;
      fired.push({
        id: rule.id, tier: rule.tier, group: rule.group,
        why: typeof rule.why === 'function' ? rule.why(c) : rule.why,
        items: rule.items
      });
    });
    // 「바꾸지 마세요」가 있으면 맨 위에 둡니다 — 다른 항목을 먼저 읽고 손대면
    // 그 조언은 이미 늦습니다.
    var weight = function (f) {
      var hold = f.items.some(function (i) { return i.kind === 'hold'; });
      return (f.tier === 'key' ? 0 : 10) + (hold ? -1 : 0);
    };
    fired.sort(function (a, b) { return weight(a) - weight(b); });

    return {
      phase: phase, score: { gf: gf, ga: ga, diff: gf - ga },
      oppLevel: oppLevel, flags: flags, hasStats: hasStats,
      stats: hasStats ? { us: us, them: them } : null,
      fired: fired
    };
  }

  /*
   * 이탈 선수가 전술을 어떻게 바꿨는지.
   *
   * 부상 선수를 빼고 다시 짜기만 하면 "왜 갑자기 이 역할이지?"가 됩니다.
   * 전원이 있을 때의 전술과 나란히 놓고 달라진 것만 보여 줍니다 —
   * 대체 선수의 성격이 다르면 역할과 지시가 함께 움직이기 때문입니다.
   */
  function diffTactics(full, cur, unavailable) {
    var out = { formation: null, slots: [], instructions: [], plan: null };
    if (!full) return out;

    if (full.xi.formation.id !== cur.xi.formation.id) {
      out.formation = { from: full.xi.formation.ko, to: cur.xi.formation.ko };
    }
    var fullPlan = full.plans.top.map(function (p) { return p.ko; }).join(' + ');
    var curPlan = cur.plans.top.map(function (p) { return p.ko; }).join(' + ');
    if (fullPlan !== curPlan) out.plan = { from: fullPlan, to: curPlan };

    // 포메이션이 그대로일 때만 자리별로 비교합니다 — 형태가 바뀌면 자리 자체가 달라집니다.
    if (!out.formation) {
      var byId = {};
      full.xi.lineup.forEach(function (l) { byId[l.slot.id] = l; });
      cur.xi.lineup.forEach(function (l) {
        var was = byId[l.slot.id];
        if (!was) return;
        var playerChanged = (was.player && was.player.name) !== (l.player && l.player.name);
        var roleChanged = was.role.id !== l.role.id || was.duty !== l.duty;
        if (!playerChanged && !roleChanged) return;
        out.slots.push({
          slot: l.slot,
          fromPlayer: was.player ? was.player.name : null,
          toPlayer: l.player ? l.player.name : null,
          fromRole: was.role.ko + '/' + RD.DUTIES[was.duty].ko,
          toRole: l.role.ko + '/' + RD.DUTIES[l.duty].ko,
          roleChanged: roleChanged,
          fitDrop: (was.fit != null && l.fit != null) ? was.fit - l.fit : null,
          // 이 자리의 원래 주인이 빠진 사람인가
          wasUnavailable: !!(was.player && unavailable.some(function (u) { return u.name === was.player.name; }))
        });
      });
    }

    Object.keys(cur.instructions.axes).forEach(function (k) {
      var a = cur.instructions.axes[k], b = full.instructions.axes[k];
      if (a.index !== b.index) out.instructions.push({ ko: a.ko, from: b.label, to: a.label });
    });
    Object.keys(cur.instructions.toggles).forEach(function (k) {
      var a = cur.instructions.toggles[k], b = full.instructions.toggles[k];
      if (a.on !== b.on) out.instructions.push({ ko: a.ko, from: b.on ? '켜기' : '끄기', to: a.on ? '켜기' : '끄기' });
    });
    return out;
  }

  // ── 최상위 진입점 ─────────────────────────────────────────────────────
  function generate(input) {
    var players = (input.players || []).map(function (p, i) {
      var c = Object.assign({}, p);
      c._id = p.id || ('p' + i);
      c.positions = p.positions || [];
      c.attrs = p.attrs || {};
      return c;
    });
    var opp = normaliseOpponent(input.opponent);
    var ctx = normaliseContext(input.context);
    var oppF = opp.formationId ? FORMATION_BY_ID[opp.formationId] : null;

    var split = splitAvailable(players);
    players = split.available;

    var squad = summariseSquad(players);
    var ranked = rankFormations(players, opp, ctx, squad, oppF, input.allowedFormations);
    if (!ranked.length) return null;

    // 2차 계산 — 선발이 정해졌으니 스쿼드 요약을 그 11명으로 다시 냅니다.
    // (팀 전체 평균으로 압박 강도를 정하면 선발에 없는 선수의 체력이 섞입니다.)
    var first = ranked[0];
    var xiPlayers = first.xi.lineup.map(function (l) { return l.player; }).filter(Boolean);
    var xiSquad = xiPlayers.length >= 7 ? summariseSquad(xiPlayers) : squad;

    var ourSum = summariseFormation(first.formation);
    var fired = evaluateRules(opp, ctx, xiSquad, ourSum, oppF);
    var acc = accumulate(fired);
    var plans = resolvePlans(acc.plan);
    var planW = planRoleWeights(plans.top);
    var xi = buildXI(players, first.formation, planW, acc.role, { mentalityShift: acc.axis.mentality });
    // 선발이 정해진 뒤에야 정할 수 있는 지시(오버랩/언더랩, 크로스 종류, 배급 대상 …)
    contextualInstructions(acc, xi, opp, ctx, plans.top);
    var instructions = finaliseInstructions(acc, plans.top);
    var warnings = balanceWarnings(xi, instructions.axes, instructions.toggles, xiSquad, opp);
    var pis = individualInstructions(xi, opp, plans.top, instructions.axes);

    var result = {
      squad: squad,
      xiSquad: xiSquad,
      unavailable: split.unavailable,
      // 이 경기에 쓸 교체 자원 — 주전을 빼고 남은 선수로 같은 자리를 채워 봅니다.
      bench: benchFor(players, xi),
      opponent: opp,
      opponentFormation: oppF,
      context: ctx,
      plans: plans,
      formationRanking: ranked.slice(0, 5).map(function (r) {
        return {
          id: r.formation.id, ko: r.formation.ko, total: r.total,
          teamFit: r.teamFit, structure: r.structure, planScore: r.planScore,
          notes: r.structureNotes, note: r.formation.note,
          strength: r.formation.strength, weakness: r.formation.weakness
        };
      }),
      xi: xi,
      instructions: instructions,
      warnings: warnings,
      individual: pis,
      brief: counterBrief(fired),
      scenarios: TD.SCENARIOS
    };

    /*
     * 빠진 선수가 있으면 "전원이 있었다면 어땠을지"를 한 번 더 계산해 견줍니다.
     * 대체 선수의 성격이 다르면 역할과 지시가 함께 움직이는데, 그걸 말해 주지
     * 않으면 "왜 갑자기 이 역할이지?"가 됩니다.
     */
    if (split.unavailable.length && !input._noImpact) {
      var full = null;
      try {
        full = generate({
          players: (input.players || []).map(function (p) {
            var c = Object.assign({}, p);
            delete c.out; delete c.outReason;
            return c;
          }),
          opponent: input.opponent, context: input.context,
          allowedFormations: input.allowedFormations, _noImpact: true
        });
      } catch (e) { full = null; }
      if (full) result.injuryImpact = diffTactics(full, result, split.unavailable);
    }
    return result;
  }

  root.FM_ENGINE = {
    contextualInstructions: contextualInstructions,
    opponentLineupNotes: opponentLineupNotes,
    inMatchAdvice: inMatchAdvice,
    chemistry: chemistry,
    setPieces: setPieces,
    trainingPlan: trainingPlan,
    pickTactic: pickTactic,
    slotAudit: slotAudit,
    slotKit: slotKit,
    KIT_ROLES: KIT_ROLES,
    planInstructions: planInstructions,
    axisStep: axisStep,
    PLAN_EFFECTS: PLAN_EFFECTS,
    squadTiers: squadTiers,
    rotationPlan: rotationPlan,
    matchReview: matchReview,
    guessPositions: guessPositions,
    opponentHistory: opponentHistory,
    condBand: condBand,
    TIRED_AT: TIRED_AT,
    NEW_TACTIC_GAP: NEW_TACTIC_GAP,
    MAX_SLOTS: MAX_SLOTS,
    traitAdjust: traitAdjust,
    splitAvailable: splitAvailable,
    josa: { ro: ro, eul: eul, iga: iga, eun: eun, wa: wa, ira: ira },
    generate: generate,
    baseTactic: baseTactic,
    squadNeeds: squadNeeds,
    benchFor: benchFor,
    inferOpponentTraits: inferOpponentTraits,
    roleFit: roleFit,
    summariseSquad: summariseSquad,
    summariseFormation: summariseFormation,
    rankFormations: rankFormations,
    buildXI: buildXI,
    candidateRoles: candidateRoles,
    hungarian: hungarian,
    positionFamiliarity: positionFamiliarity,
    normaliseOpponent: normaliseOpponent,
    normaliseContext: normaliseContext,
    evaluateRules: evaluateRules,
    accumulate: accumulate,
    resolvePlans: resolvePlans,
    planRoleWeights: planRoleWeights,
    finaliseInstructions: finaliseInstructions,
    ROLE_BY_ID: ROLE_BY_ID,
    FORMATION_BY_ID: FORMATION_BY_ID
  };
})(typeof window !== 'undefined' ? window : globalThis);

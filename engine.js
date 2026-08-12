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

    return {
      score: clamp(base * fam * footAdj * req.factor, 0, 100),
      raw: base,
      familiarity: fam,
      reqFactor: req.factor,
      reqFail: req.fail,
      coverage: total ? known / total : 0
    };
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
    return {
      pace: round1(pick(['pac', 'acc'], attackers.length ? attackers : outfield)),
      technique: round1(pick(['tec', 'fir', 'pas'], outfield)),
      aerial: round1(pick(['jum', 'hea', 'str'], outfield)),
      stamina: round1(pick(['sta', 'wor'], outfield)),
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
  var PLAN_EFFECTS = {
    'in-behind': { axis: { directness: 0.4, tempo: 0.3 }, toggle: { pis: 1.2, wbib: -0.6 } },
    possession: { axis: { directness: -0.5, tempo: -0.2 }, toggle: { pod: 1.2, wbib: 0.8, sos: -0.8 } },
    'wide-cross': { axis: { width: 0.8 }, toggle: { ovl_l: 0.5, ovl_r: 0.5, cr_byline: 0.5 } },
    counter: { axis: { dline: -0.4, tempo: 0.4, directness: 0.4 }, toggle: { counter: 1.6, regroup: 1, pod: -0.5 } },
    'press-high': { axis: { loe: 0.9, press: 0.9, dline: 0.6 }, toggle: { counterpress: 1.4, ptp: 0.8 } },
    'low-block': { axis: { dline: -0.9, loe: -0.9, press: -0.5, mentality: -0.5 }, toggle: { regroup: 1.2, pod: -0.6 } },
    'overload-centre': { axis: { width: -0.5 }, toggle: { focus_c: 0.8 } }
  };

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
      var idx = clamp(Math.round(def.def + acc.axis[k]), 0, def.labels.length - 1);
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
    for (var pass = 0; pass < 3; pass++) {
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

    for (var i = 0; i < slots.length; i++) {
      var s = slots[i], role = s.choice.role, duty = s.choice.duty;
      var tags = role.tags || [];
      var k = s.slot.pos + '|' + role.id + '|' + duty;
      if (seen[k]) pen += DUPLICATE_PENALTY;
      seen[k] = 1;

      if (tags.indexOf('playmaker') >= 0) counts.playmaker++;
      if (tags.indexOf('no-defence') >= 0) counts['no-defence']++;
      if (duty === 'a') attackDuties++;

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
    function replace(pred, filter) {
      for (var i = 0; i < slots.length; i++) {
        var s = slots[i];
        if (!pred(s)) continue;
        var alt = s.cands.filter(filter)[0];
        if (alt) { s.choice = alt; return true; }
      }
      return false;
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

  // ── 팀 밸런스 경고 ────────────────────────────────────────────────────
  function balanceWarnings(xi, axes, toggles, squad, opp) {
    var w = [];
    var lineup = xi.lineup;
    function has(tag) { return lineup.some(function (l) { return (l.role.tags || []).indexOf(tag) >= 0; }); }
    function count(tag) { return lineup.filter(function (l) { return (l.role.tags || []).indexOf(tag) >= 0; }).length; }

    var attackDuties = lineup.filter(function (l) { return l.duty === 'a'; }).length;
    if (attackDuties === 0) w.push({ level: 'high', text: '공격 임무가 한 명도 없습니다 — 박스 안으로 들어가는 선수가 없어 크로스와 컷백이 전부 낭비됩니다.' });
    else if (attackDuties >= 5) w.push({ level: 'mid', text: '공격 임무가 ' + attackDuties + '명입니다 — 뺏겼을 때 되돌아올 사람이 부족합니다.' });

    if (count('no-defence') >= 2) w.push({ level: 'high', text: '수비에 가담하지 않는 역할이 둘 이상입니다 — 수비 시 사실상 9명으로 싸우게 됩니다.' });
    if (count('playmaker') >= 3) w.push({ level: 'mid', text: '플레이메이커 계열이 셋입니다 — 볼이 몰릴 곳이 분산돼 오히려 공격 경로가 흐려집니다.' });

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

    // 측면 폭이 양쪽 다 사라지는 조합
    ['l', 'r'].forEach(function (side) {
      var wideAtt = lineup.filter(function (l) {
        return l.slot.pos === (side === 'l' ? 'AML' : 'AMR') || l.slot.pos === (side === 'l' ? 'ML' : 'MR');
      })[0];
      var back = lineup.filter(function (l) {
        return l.slot.pos === (side === 'l' ? 'DL' : 'DR') || l.slot.pos === (side === 'l' ? 'WBL' : 'WBR');
      })[0];
      if (!wideAtt || !back) return;
      var inverted = (wideAtt.role.tags || []).some(function (t) { return t === 'inverted' || t === 'narrow-drift'; });
      var backStaysIn = back.duty === 'd' || (back.role.tags || []).indexOf('inverted') >= 0;
      if (inverted && backStaysIn) {
        w.push({
          level: 'mid',
          text: (side === 'l' ? '왼쪽' : '오른쪽') + ' 측면에서 ' + wideAtt.role.ko + '가 안으로 들어오는데 뒤의 ' + back.role.ko + '도 올라가지 않습니다 — 그쪽 폭이 완전히 사라집니다.'
        });
      }
    });

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
      w.push({ level: 'mid', text: l.player.name + '은(는) ' + l.role.ko + '인데 스태미너가 ' + l.player.attrs.sta + '입니다 — 60~65분 교체를 미리 준비하세요.' });
    });

    lineup.forEach(function (l) {
      if (l.familiarity !== null && l.familiarity < 0.6 && l.player) {
        w.push({ level: 'mid', text: l.player.name + '은(는) ' + l.slot.pos + ' 자리가 익숙하지 않습니다 — 등록 포지션을 확인하세요.' });
      }
    });

    return w;
  }

  // ── 개인 지시 ─────────────────────────────────────────────────────────
  function individualInstructions(xi, opp, planTop, axes) {
    var out = [];
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
          pi.push({ text: '넓게 벌리기', why: '앞의 ' + ahead.role.ko + '가 안쪽으로 들어오므로 이 선수가 측면 폭을 전담해야 합니다.' });
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

      if (pi.length) out.push({ slot: l.slot, role: l.role, duty: l.duty, player: l.player, items: pi });
    });
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
    var instructions = finaliseInstructions(acc, plans.top);
    var warnings = balanceWarnings(xi, instructions.axes, instructions.toggles, xiSquad, opp);
    var pis = individualInstructions(xi, opp, plans.top, instructions.axes);

    return {
      squad: squad,
      xiSquad: xiSquad,
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
  }

  root.FM_ENGINE = {
    generate: generate,
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

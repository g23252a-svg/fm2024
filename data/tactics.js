/*
 * FM24 팀 지시 카탈로그와 대응 규칙
 *
 * 설계 원칙 하나: 지시를 "켠다/끈다"로 바로 결정하지 않고 축(axis) 위의 값을
 * 밀고 당긴 다음 마지막에 FM 라벨로 변환합니다. 서로 반대 방향인 근거가
 * 동시에 성립할 때(예: 상대가 높은 라인 + 우리 공격수가 느림) 둘 중 하나를
 * 임의로 버리지 않고 합산 결과가 남게 하려는 것입니다.
 * 그래서 모든 규칙은 자기가 민 방향과 이유를 함께 남기고, 결과 화면은
 * 각 지시마다 "왜 이 값인지"를 그 목록으로 보여 줍니다.
 */
(function (root) {
  'use strict';

  // ── 연속 축 ───────────────────────────────────────────────────────────
  // labels[i]가 곧 FM 화면에 뜨는 값입니다. def는 기본값 인덱스.
  var AXES = {
    mentality: {
      ko: '멘탈리티', group: 'core', def: 3,
      labels: ['매우 수비적', '수비적', '신중한', '균형', '긍정적', '공격적', '매우 공격적']
    },
    dline: {
      ko: '수비 라인', group: 'ood', def: 2,
      labels: ['훨씬 더 내리기', '더 내리기', '표준', '더 올리기', '훨씬 더 올리기']
    },
    loe: {
      ko: '압박 시작 위치', group: 'ood', def: 2,
      labels: ['훨씬 더 내리기', '더 내리기', '표준', '더 올리기', '훨씬 더 올리기']
    },
    press: {
      ko: '압박 강도', group: 'ood', def: 2,
      labels: ['훨씬 덜 적극적', '덜 적극적', '표준', '더 적극적', '매우 적극적']
    },
    tackling: {
      ko: '태클 강도', group: 'ood', def: 1,
      labels: ['발 떼지 않기', '표준', '강하게 태클']
    },
    tempo: {
      ko: '템포', group: 'ip', def: 2,
      labels: ['훨씬 느리게', '느리게', '표준', '빠르게', '훨씬 빠르게']
    },
    directness: {
      ko: '패스 길이', group: 'ip', def: 2,
      labels: ['훨씬 짧게', '짧게', '표준', '직선적으로', '훨씬 직선적으로']
    },
    width: {
      ko: '공격 폭', group: 'ip', def: 3,
      labels: ['매우 좁게', '좁게', '약간 좁게', '표준', '약간 넓게', '넓게', '매우 넓게']
    },
    dribble: {
      ko: '드리블', group: 'ip', def: 1,
      labels: ['적게 드리블', '표준', '많이 드리블']
    },
    creativity: {
      ko: '창의성', group: 'ip', def: 1,
      labels: ['규율 있게', '표준', '자유롭게']
    },
    timewaste: {
      ko: '시간 지연', group: 'ip', def: 1,
      labels: ['적게', '표준', '많이']
    }
  };

  // ── 토글 지시 ─────────────────────────────────────────────────────────
  // def=true면 기본으로 켜져 있는 지시. excl는 동시에 켤 수 없는 지시 묶음.
  var TOGGLES = {
    // 공격 시
    pod: { ko: '후방에서 짧게 시작', group: 'ip', def: false },
    rad: { ko: '수비 진영으로 드리블 돌파', group: 'ip', def: false },
    pis: { ko: '공간으로 패스', group: 'ip', def: false },
    hec: { ko: '얼리 크로스', group: 'ip', def: false, excl: 'crosspos' },
    wbib: { ko: '박스 안까지 볼 배급', group: 'ip', def: false, excl: 'boxentry' },
    sos: { ko: '적극적으로 슛', group: 'ip', def: false, excl: 'boxentry' },
    pfsp: { ko: '세트피스 노리기', group: 'ip', def: false },
    focus_l: { ko: '왼쪽으로 집중 공격', group: 'ip', def: false, excl: 'focus' },
    focus_c: { ko: '중앙으로 집중 공격', group: 'ip', def: false, excl: 'focus' },
    focus_r: { ko: '오른쪽으로 집중 공격', group: 'ip', def: false, excl: 'focus' },
    ovl_l: { ko: '왼쪽 오버랩', group: 'ip', def: false },
    ovl_r: { ko: '오른쪽 오버랩', group: 'ip', def: false },
    unl_l: { ko: '왼쪽 언더랩', group: 'ip', def: false },
    unl_r: { ko: '오른쪽 언더랩', group: 'ip', def: false },
    cr_low: { ko: '낮은 크로스', group: 'ip', def: false, excl: 'crosstype' },
    cr_whip: { ko: '휘어지는 크로스', group: 'ip', def: false, excl: 'crosstype' },
    cr_float: { ko: '띄우는 크로스', group: 'ip', def: false, excl: 'crosstype' },
    cr_byline: { ko: '골라인까지 파고들어 크로스', group: 'ip', def: false, excl: 'crosspos' },
    cr_deep: { ko: '깊은 지점에서 크로스', group: 'ip', def: false, excl: 'crosspos' },
    // 전환
    counterpress: { ko: '역압박', group: 'tr', def: false, excl: 'lost' },
    regroup: { ko: '재정비', group: 'tr', def: false, excl: 'lost' },
    counter: { ko: '역습', group: 'tr', def: false, excl: 'won' },
    holdshape: { ko: '대형 유지', group: 'tr', def: false, excl: 'won' },
    distquick: { ko: '빠르게 배급', group: 'tr', def: false, excl: 'gkpace' },
    distslow: { ko: '천천히 진행', group: 'tr', def: false, excl: 'gkpace' },
    gk_short: { ko: '골키퍼 짧은 킥', group: 'tr', def: false },
    gk_cb: { ko: '센터백에게 배급', group: 'tr', def: false, excl: 'gktarget' },
    gk_fb: { ko: '풀백에게 배급', group: 'tr', def: false, excl: 'gktarget' },
    gk_pm: { ko: '플레이메이커에게 배급', group: 'tr', def: false, excl: 'gktarget' },
    gk_flank: { ko: '측면으로 배급', group: 'tr', def: false, excl: 'gktarget' },
    // 수비 시
    ptp: { ko: '압박 트리거 강화', group: 'ood', def: false },
    psgd: { ko: '골키퍼 짧은 배급 차단', group: 'ood', def: false },
    trap_in: { ko: '안쪽으로 유도', group: 'ood', def: false, excl: 'trap' },
    trap_out: { ko: '바깥쪽으로 유도', group: 'ood', def: false, excl: 'trap' },
    offside: { ko: '오프사이드 트랩', group: 'ood', def: false },
    stepup: { ko: '더 전진하기', group: 'ood', def: false },
    tightmark: { ko: '강하게 밀착 마크', group: 'ood', def: false }
  };

  var GROUP_KO = { core: '기본', ip: '공격 시', tr: '전환', ood: '수비 시' };

  // ── 전술 계획(플랜) ───────────────────────────────────────────────────
  // 규칙들이 플랜에 점수를 주고, 가장 높은 플랜이 역할 선택을 이끕니다.
  var PLANS = {
    'in-behind': {
      ko: '뒷공간 침투', short: '뒤로',
      desc: '상대 최종 수비 뒤로 달려 들어가 마무리합니다.',
      roleTags: { runner: 2, 'in-behind': 2.4, pace: 1.8, 'late-run': 1, static: -1, 'drop-deep': -1.2, target: -0.6 }
    },
    possession: {
      ko: '점유·중앙 조립', short: '점유',
      desc: '짧은 패스로 공을 지키며 중앙에서 상대를 끌어냅니다.',
      roleTags: { playmaker: 2.2, creator: 1.8, 'creator-deep': 1.4, buildout: 1.4, link: 1.2, clearance: -2.2, target: -0.8, outlet: -0.8 }
    },
    'wide-cross': {
      ko: '측면·크로스', short: '측면',
      desc: '측면에서 폭을 만들어 박스 안으로 크로스를 넣습니다.',
      roleTags: { width: 2.2, crosser: 2.2, target: 2, aerial: 1.4, overlap: 1.2, inverted: -1.6, narrow: -1.2, 'narrow-drift': -0.8 }
    },
    counter: {
      ko: '역습', short: '역습',
      desc: '내려서서 공을 뺏은 뒤 빠르게 앞으로 나갑니다.',
      roleTags: { runner: 1.8, pace: 2, holder: 1.6, 'defensive-cover': 1.2, outlet: 1.2, 'in-behind': 1.4, roam: -1, 'risk-back': -1.2 }
    },
    'press-high': {
      ko: '전방 압박', short: '압박',
      desc: '높은 위치에서 공을 뺏어 짧은 거리에서 마무리합니다.',
      roleTags: { presser: 2.4, stamina: 1.6, ballwinner: 1.6, 'no-defence': -2.6, static: -2, 'drop-deep': -0.6 }
    },
    'low-block': {
      ko: '내려앉기', short: '블록',
      desc: '진영을 낮게 유지하고 공간을 지웁니다.',
      roleTags: { 'defensive-cover': 2.2, holder: 2, clearance: 1.2, aerial: 0.8, 'no-defence': -2.4, 'risk-back': -2.4, roam: -1.2, 'risk-pass': -1 }
    },
    'overload-centre': {
      ko: '중앙 과부하', short: '중앙',
      desc: '중앙에 사람을 몰아 상대 미드필드를 수적으로 이깁니다.',
      roleTags: { 'overload-centre': 2.2, inverted: 1.6, 'half-space': 1.4, narrow: 1.2, 'narrow-drift': 1, width: -1 }
    }
  };

  /*
   * FM 전술 유형(프리셋)과의 대응.
   *
   * 세이브를 처음 시작하면 「전술 → 기본 정보」에 전술 유형 목록만 뜨고 포메이션이
   * 비어 있습니다. 그 화면에서 무엇을 누를지가 첫 관문이라, 우리 전술 방향에 가장
   * 가까운 유형을 함께 알려 줍니다.
   *
   * 다만 프리셋은 역할·임무·지시를 자기 값으로 한 번에 채웁니다. 이 도구가 낸
   * 값과 다른 부분은 프리셋을 고른 뒤 덮어써야 합니다. 그게 번거로우면
   * 「자신만의 전술 유형 생성」으로 백지에서 시작하는 편이 어긋날 일이 없습니다.
   */
  var FM_PRESETS = {
    possession: { ko: '점유율 중시', alt: '티키타카' },
    'press-high': { ko: '게겐프레스', alt: '전진 티키타카' },
    'wide-cross': { ko: '측면 플레이', alt: null },
    counter: { ko: '빠른 역습', alt: '유연한 역습' },
    'in-behind': { ko: '유연한 역습', alt: '길게 차기' },
    'low-block': { ko: '카테나치오', alt: '버스 세우기' },
    'overload-centre': { ko: '전진 티키타카', alt: '티키타카' }
  };
  var FM_PRESET_BLANK = '자신만의 전술 유형 생성';

  // ── 상대 성향 태그 ────────────────────────────────────────────────────
  var OPP_TRAITS = [
    { id: 'fast-striker', ko: '빠른 공격수', hint: '뒷공간으로 달리는 공격수가 있다' },
    { id: 'target-man', ko: '제공권 강한 최전방', hint: '크로스와 롱볼을 머리로 받아 준다' },
    { id: 'playmaker-amc', ko: '2선 플레이메이커', hint: '공격형 미드필더가 경기를 만든다' },
    { id: 'playmaker-deep', ko: '후방 플레이메이커', hint: '수비형 미드필더/센터백이 배급을 전담한다' },
    { id: 'wing-heavy', ko: '측면 중심', hint: '윙어·윙백이 공격의 주된 경로다' },
    { id: 'overlapping-fb', ko: '풀백 오버랩', hint: '풀백/윙백이 계속 올라온다' },
    { id: 'cross-heavy', ko: '크로스 위주', hint: '측면에서 박스로 계속 올린다' },
    { id: 'long-ball', ko: '롱볼 위주', hint: '후방에서 길게 넘긴다' },
    { id: 'slow-cb', ko: '느린 센터백', hint: '센터백이 속도로 뚫린다' },
    { id: 'small-cb', ko: '작은 수비진', hint: '제공권이 약하다' },
    { id: 'weak-gk-dist', ko: '골키퍼 배급 불안', hint: '짧은 배급을 막으면 흔들린다' },
    { id: 'aggressive-tackling', ko: '거친 태클', hint: '태클이 거칠고 경고가 잦다' },
    { id: 'low-stamina', ko: '체력 저하', hint: '일정이 빡빡하거나 체력이 떨어져 있다' },
    { id: 'set-piece-threat', ko: '세트피스 강점', hint: '코너·프리킥에서 위협적이다' },
    { id: 'weak-flank-l', ko: '왼쪽 수비 약점', hint: '상대 왼쪽(우리 오른쪽)이 약하다' },
    { id: 'weak-flank-r', ko: '오른쪽 수비 약점', hint: '상대 오른쪽(우리 왼쪽)이 약하다' }
  ];

  /*
   * 규칙
   *   when   : (o=상대, c=상황, s=우리 스쿼드 요약, f=우리 포메이션 요약) → 성립 여부
   *   axis   : 축을 미는 양(칸 단위, 소수 가능 — 마지막에 반올림)
   *   toggle : 토글 점수(+면 켜는 쪽, 합계 1 이상이면 켬)
   *   plan   : 플랜 점수
   *   role   : 역할 태그 선호 가중
   *   tier   : 'key'면 대응 브리핑 상단에 올라감
   */
  var RULES = [
    // ── 상대 수비 라인 ──────────────────────────────────────────────
    {
      id: 'opp-high-line', group: '상대 수비 라인', tier: 'key',
      when: function (o) { return o.dline >= 3; },
      scale: function (o) { return o.dline === 4 ? 1.4 : 1; },
      axis: { directness: 0.8, tempo: 0.6 },
      toggle: { pis: 2.2, counter: 1.4, wbib: -1.2, pfsp: -1 },
      plan: { 'in-behind': 3, counter: 1 },
      role: { 'in-behind': 1.2, pace: 1 },
      why: '상대 수비 라인이 높습니다 — 최종 수비수 뒤에 넓은 공간이 있습니다.',
      action: '공간으로 패스를 켜고 빠른 공격수를 뒷공간으로 달리게 하세요. 발밑으로 받으러 내려오는 역할(딥 라잉 포워드·폴스 나인)은 이 공간을 지워 버립니다.'
    },
    {
      id: 'opp-low-block', group: '상대 수비 라인', tier: 'key',
      when: function (o) { return o.dline <= 1; },
      scale: function (o) { return o.dline === 0 ? 1.3 : 1; },
      axis: { dline: 1, loe: 0.8, width: 1, mentality: 0.3, tempo: -0.2 },
      toggle: { wbib: 1.6, pod: 1.2, counter: -1.6, pis: -1.4, ovl_l: 1, ovl_r: 1, cr_low: 0.8 },
      plan: { possession: 2, 'wide-cross': 1.6, 'overload-centre': 1 },
      role: { creator: 1, width: 0.8, overlap: 0.8, 'in-behind': -1.2 },
      why: '상대가 내려앉아 있습니다 — 뒷공간이 없고 박스 앞이 사람으로 막혀 있습니다.',
      action: '폭을 넓혀 상대 블록을 좌우로 늘리고 박스 안까지 볼을 배급하세요. 빠른 역습 지시는 상대가 이미 내려와 있어 쓸 곳이 없습니다.'
    },

    // ── 상대 압박 ───────────────────────────────────────────────────
    {
      id: 'opp-high-press', group: '상대 압박', tier: 'key',
      when: function (o) { return o.press >= 3 && o.loe >= 3; },
      scale: function (o) { return o.press === 4 ? 1.35 : 1; },
      axis: { directness: 1, tempo: 0.8 },
      toggle: { pod: -2.4, distquick: 1.8, gk_flank: 0.8, counter: 1.2, rad: -0.8 },
      plan: { counter: 1.6, 'in-behind': 1.4 },
      role: { target: 1.2, outlet: 1.4, pace: 0.8, buildout: -0.8 },
      why: '상대가 높은 곳에서 강하게 압박합니다 — 우리 진영에서 짧게 돌리면 그대로 뺏깁니다.',
      action: '후방 짧은 패스를 끄고 패스를 길게 가져가세요. 압박을 한 번 넘기면 상대 뒤는 텅 비어 있으므로 그 한 번을 넘길 목표점(타깃 포워드·측면 타깃)을 두는 게 핵심입니다.'
    },
    {
      id: 'opp-passive', group: '상대 압박',
      when: function (o) { return o.press <= 1 && o.loe <= 2; },
      axis: { directness: -0.6, dribble: 0.6, tempo: -0.3 },
      toggle: { pod: 1.6, rad: 1.2, wbib: 0.8 },
      plan: { possession: 1.6 },
      role: { buildout: 0.8, creator: 0.6 },
      why: '상대가 압박하지 않고 기다립니다 — 우리 후방에 시간이 충분합니다.',
      action: '후방에서 짧게 시작해 안전하게 전진하고, 상대가 나오지 않으므로 드리블로 직접 끌고 올라가 수비를 끌어내세요.'
    },
    {
      id: 'opp-counterpress', group: '상대 압박',
      when: function (o) { return o.transitionLost === 'counterpress'; },
      axis: { tempo: 0.6, directness: 0.4 },
      toggle: { distquick: 1.2, pod: -0.8 },
      role: { 'first-touch': 0.5 },
      why: '상대가 공을 잃자마자 곧바로 역압박합니다 — 뺏은 직후 2~3초가 가장 위험합니다.',
      action: '뺏은 즉시 첫 패스를 앞으로 보내세요. 그 순간을 넘기면 상대는 전원이 앞으로 나와 있는 상태입니다.'
    },

    // ── 상대 전환 ───────────────────────────────────────────────────
    {
      id: 'opp-counterattack', group: '상대 전환', tier: 'key',
      when: function (o) { return o.transitionWon === 'counter' && (o.dline <= 2 || o.mentality <= 3); },
      axis: { dline: -0.6, mentality: -0.3 },
      toggle: { regroup: 2, counterpress: -1.6, holdshape: 0.6, ovl_l: -0.6, ovl_r: -0.6 },
      plan: { 'low-block': 0.6 },
      role: { 'defensive-cover': 1.4, holder: 1.4, 'risk-back': -2 },
      why: '상대가 내려서서 역습을 노립니다 — 우리가 공을 잃는 순간이 상대의 득점 기회입니다.',
      action: '공을 잃으면 역압박 대신 재정비하고, 최소한 한쪽 풀백은 수비 임무로 남기세요. 양쪽 윙백을 동시에 올리는 조합은 이 상대에게 가장 위험합니다.'
    },

    // ── 상대 성향 ───────────────────────────────────────────────────
    {
      id: 'opp-fast-striker', group: '상대 선수', tier: 'key',
      when: function (o) { return o.traits.indexOf('fast-striker') >= 0; },
      axis: { dline: -0.9, loe: -0.3, tackling: -0.4 },
      toggle: { offside: -0.8, stepup: -1 },
      role: { 'defensive-cover': 1.2, pace: 1.4 },
      why: '상대에 뒷공간으로 달리는 빠른 공격수가 있습니다.',
      action: '수비 라인을 내려 달릴 공간을 지우고, 센터백 중 한 명은 커버 임무 + 속도 있는 선수로 두세요. 스위퍼 키퍼가 뒤를 정리하면 라인을 조금 덜 내려도 됩니다.'
    },
    {
      id: 'opp-target-man', group: '상대 선수',
      when: function (o) { return o.traits.indexOf('target-man') >= 0; },
      axis: { dline: 0.3 },
      toggle: { trap_in: 1.4, tightmark: 0.8 },
      role: { aerial: 1.6, 'defensive-cover': 0.6 },
      why: '상대 최전방이 제공권으로 공을 지켜 줍니다 — 롱볼과 크로스의 목표점입니다.',
      action: '안쪽으로 유도해 크로스 자체를 줄이고, 센터백은 몸싸움·점프 도달력이 높은 조합으로 맞추세요. 라인을 너무 내리면 오히려 크로스를 계속 허용합니다.'
    },
    {
      id: 'opp-playmaker-amc', group: '상대 선수', tier: 'key',
      when: function (o) { return o.traits.indexOf('playmaker-amc') >= 0; },
      toggle: { tightmark: 1.6 },
      role: { holder: 1.8, 'no-roam': 1.2 },
      needDM: true,
      why: '상대 2선 플레이메이커가 우리 수비와 미드필드 사이에서 공을 받습니다.',
      action: '수비형 미드필더를 두고(앵커맨이 가장 확실합니다) 그 선수에게 전담 마크를 붙이세요. 수비형 미드필더 없이 이 상대를 막으려면 중앙 미드필더 한 명이 계속 끌려 나가고 그 자리가 곧 실점 경로가 됩니다.'
    },
    {
      id: 'opp-playmaker-deep', group: '상대 선수',
      when: function (o) { return o.traits.indexOf('playmaker-deep') >= 0; },
      axis: { loe: 0.7, press: 0.6 },
      toggle: { ptp: 1.4, psgd: 1 },
      plan: { 'press-high': 1.2 },
      role: { presser: 1 },
      why: '상대가 후방 플레이메이커를 통해 빌드업합니다 — 그 선수를 지우면 배급이 끊깁니다.',
      action: '압박 시작 위치를 올리고 압박 트리거를 강화해 그 선수에게 공이 편하게 가지 않도록 하세요. 최전방은 프레싱 포워드로 두고 개인 지시로 그 선수를 마크시키면 확실합니다.'
    },
    {
      id: 'opp-weak-gk', group: '상대 선수',
      when: function (o) { return o.traits.indexOf('weak-gk-dist') >= 0; },
      axis: { loe: 0.6, press: 0.4 },
      toggle: { psgd: 2, ptp: 1 },
      plan: { 'press-high': 1.4 },
      why: '상대 골키퍼의 배급이 불안합니다.',
      action: '골키퍼 짧은 배급 차단을 켜세요. 길게 차게 만들면 소유권이 반반이 되고, 그 위치는 우리 골문에서 멉니다.'
    },
    {
      id: 'opp-slow-cb', group: '상대 선수',
      when: function (o) { return o.traits.indexOf('slow-cb') >= 0; },
      toggle: { pis: 1.4, rad: 0.8 },
      plan: { 'in-behind': 1.6 },
      role: { pace: 1.4, 'in-behind': 1.2, dribbler: 0.8 },
      why: '상대 센터백이 느립니다.',
      action: '속도로 붙는 공격수를 세우고 공간으로 패스를 켜세요. 라인이 낮더라도 어깨 뒤로 도는 움직임 한 번이면 뒤집힙니다.'
    },
    {
      id: 'opp-small-cb', group: '상대 선수',
      when: function (o) { return o.traits.indexOf('small-cb') >= 0; },
      axis: { width: 0.6 },
      toggle: { cr_float: 1.4, cr_byline: 0.6 },
      plan: { 'wide-cross': 1.8 },
      role: { aerial: 1.6, target: 1.4, crosser: 1 },
      why: '상대 수비진의 제공권이 약합니다.',
      action: '띄우는 크로스를 켜고 박스 안에 헤딩으로 받아 줄 선수를 두세요. 세트피스에서도 같은 우위가 그대로 적용됩니다.'
    },
    {
      id: 'opp-cross-heavy', group: '상대 성향',
      when: function (o) { return o.traits.indexOf('cross-heavy') >= 0 || o.traits.indexOf('wing-heavy') >= 0; },
      toggle: { trap_in: 1.6 },
      role: { aerial: 1, 'defensive-cover': 1 },
      why: '상대 공격이 측면과 크로스에 몰려 있습니다.',
      action: '안쪽으로 유도해 측면으로 나가는 길을 먼저 막으세요. 우리 측면 선수는 수비 가담이 되는 역할(와이드 미드필더·디펜시브 윙어)이어야 풀백이 2대1로 노출되지 않습니다.'
    },
    {
      id: 'opp-overlap-fb', group: '상대 성향',
      when: function (o) { return o.traits.indexOf('overlapping-fb') >= 0; },
      toggle: { counter: 0.8 },
      role: { pace: 0.8, 'defensive-cover': 0.8 },
      why: '상대 풀백/윙백이 계속 전진합니다 — 그 뒤가 비어 있습니다.',
      action: '우리 측면 공격수를 높게 남겨 그 공간을 노리세요. 상대 풀백이 올라가는 쪽이 곧 우리 역습 경로입니다.'
    },
    {
      id: 'opp-long-ball', group: '상대 성향',
      when: function (o) { return o.traits.indexOf('long-ball') >= 0 || o.directness >= 4; },
      // 0.3씩 밀면 Math.round에서 한 칸도 안 움직입니다 — 규칙이 걸려도 지시는
      // 그대로였습니다. 이 상황에서 라인을 내리고 압박을 줄이는 것은 실제 처방이라
      // 한 칸은 움직여야 합니다.
      axis: { dline: -0.7, press: -0.7, loe: -0.6 },
      toggle: { ptp: -0.8 },
      role: { aerial: 1.4, 'defensive-cover': 0.6 },
      why: '상대가 후방에서 길게 넘겨 압박을 건너뜁니다.',
      action: '전방 압박은 효과가 떨어지므로 강도를 낮추고, 2차 볼을 줍는 중앙 미드필더와 제공권 있는 센터백을 준비하세요.'
    },
    {
      id: 'opp-aggressive', group: '상대 성향',
      when: function (o) { return o.traits.indexOf('aggressive-tackling') >= 0; },
      axis: { tempo: 0.4 },
      toggle: { rad: 0.8 },
      why: '상대 태클이 거칠어 경고가 쌓이기 쉽습니다.',
      action: '드리블로 붙어 파울을 유도하면 상대 수비 한 명을 경고로 묶을 수 있습니다. 다만 우리 핵심 드리블러의 부상 위험도 같이 올라가니, 이미 몸 상태가 나쁜 선수에게는 시키지 마세요.'
    },
    {
      id: 'opp-low-stamina', group: '상대 성향',
      when: function (o) { return o.traits.indexOf('low-stamina') >= 0; },
      axis: { tempo: 0.6, press: 0.6, width: 0.4 },
      plan: { 'press-high': 1 },
      why: '상대 체력이 떨어져 있습니다.',
      action: '템포를 올려 상대를 계속 뛰게 하세요. 60분 이후에 격차가 벌어지므로 그 시점에 쓸 교체 카드를 남겨 두는 게 이 경기의 승부처입니다.'
    },
    {
      id: 'opp-setpiece', group: '상대 성향',
      when: function (o) { return o.traits.indexOf('set-piece-threat') >= 0; },
      /*
       * -0.5는 Math.round(-0.5)가 -0이라 한 칸도 안 움직입니다. 이 규칙은 축
       * 하나만 밀었으므로 걸려도 아무 일이 없었습니다 — 조언 문구만 떴습니다.
       * 세트피스가 강한 상대에게는 불필요한 파울을 줄이는 것이 실제 처방이라
       * 한 칸은 내려야 하고, 박스 안 제공권도 같이 챙겨야 합니다.
       */
      axis: { tackling: -0.7 },
      role: { aerial: 1.0 },
      why: '상대가 세트피스에서 위협적입니다.',
      action: '불필요한 파울과 코너를 줄이도록 태클을 자제시키고, 세트피스 수비에서 제공권 있는 선수를 골문 앞에 배치하세요.'
    },
    {
      id: 'opp-weak-flank-l', group: '상대 약점',
      when: function (o) { return o.traits.indexOf('weak-flank-l') >= 0; },
      toggle: { focus_r: 1.6, ovl_r: 1 },
      why: '상대 왼쪽 수비가 약합니다(우리 기준 오른쪽).',
      action: '오른쪽으로 집중 공격하고 그쪽 오버랩을 켜 2대1을 반복해서 만드세요.'
    },
    {
      id: 'opp-weak-flank-r', group: '상대 약점',
      when: function (o) { return o.traits.indexOf('weak-flank-r') >= 0; },
      toggle: { focus_l: 1.6, ovl_l: 1 },
      why: '상대 오른쪽 수비가 약합니다(우리 기준 왼쪽).',
      action: '왼쪽으로 집중 공격하고 그쪽 오버랩을 켜 2대1을 반복해서 만드세요.'
    },

    // ── 상대 멘탈리티 ───────────────────────────────────────────────
    {
      id: 'opp-very-attacking', group: '상대 멘탈리티',
      when: function (o) { return o.mentality >= 5; },
      axis: { mentality: -0.3 },
      toggle: { counter: 1.4, regroup: 0.6 },
      plan: { counter: 1.4, 'in-behind': 0.8 },
      why: '상대가 공격적으로 나옵니다 — 인원을 앞으로 보내므로 뒤가 얇습니다.',
      action: '무리해서 맞불을 놓지 말고 역습을 켜세요. 상대가 스스로 열어 준 공간을 쓰는 쪽이 훨씬 쌉니다.'
    },
    {
      id: 'opp-very-defensive', group: '상대 멘탈리티',
      when: function (o) { return o.mentality <= 1; },
      axis: { mentality: 0.6, dline: 0.6, width: 0.6 },
      toggle: { wbib: 1.2, counter: -1.2 },
      plan: { possession: 1.4, 'wide-cross': 1 },
      why: '상대가 수비적으로 나옵니다 — 공은 우리가 대부분 갖게 됩니다.',
      action: '점유를 전제로 폭을 넓히고, 우리 수비 라인을 올려 경기를 상대 진영에 가둬 두세요.'
    },
    {
      id: 'opp-narrow', group: '상대 형태',
      when: function (o) { return o.width <= 2; },
      axis: { width: 1 },
      toggle: { ovl_l: 0.8, ovl_r: 0.8 },
      plan: { 'wide-cross': 1.4 },
      role: { width: 1.2, overlap: 1 },
      why: '상대가 좁게 섭니다 — 측면이 비어 있습니다.',
      action: '폭을 넓히고 양쪽 오버랩을 켜세요. 상대 좁은 대형은 옆으로 끌려 나오는 순간 중앙에 틈이 생깁니다.'
    },
    {
      /*
       * 템포는 지금까지 어떤 규칙도 보지 않던 축이었습니다. 상대가 빠르게
       * 굴리면 우리가 정렬하기 전에 다음 패스가 나갑니다 — 압박을 따라 올리면
       * 계속 뚫리고, 블록을 유지하면서 간격을 좁히는 쪽이 맞습니다.
       */
      id: 'opp-fast-tempo', group: '상대 성향',
      when: function (o) { return o.tempo >= 4; },
      axis: { press: -0.6, width: -0.6, tempo: 0.4 },
      toggle: { ptp: -0.6 },
      role: { 'defensive-cover': 0.8, 'overload-centre': 0.4 },
      why: '상대가 볼을 아주 빠르게 굴립니다 — 우리가 자리를 잡기 전에 다음 패스가 나갑니다.',
      action: '따라가며 압박하지 말고 간격을 좁혀 블록을 유지하세요. 한 명이 나가면 그 옆이 그대로 열립니다.'
    },
    {
      id: 'opp-wide', group: '상대 형태',
      when: function (o) { return o.width >= 5; },
      // -0.5는 Math.round(-0.5)가 -0이라 아무 일도 안 일어납니다. 경계값을 피합니다.
      axis: { width: -0.7 },
      role: { 'overload-centre': 0.8 },
      why: '상대가 넓게 섭니다 — 중앙 사이 간격이 벌어져 있습니다.',
      action: '폭을 조금 좁혀 중앙에 사람을 모으세요. 상대가 좌우로 벌어져 있으면 중앙 통과가 오히려 쉽습니다.'
    },

    // ── 우리 상황 ───────────────────────────────────────────────────
    {
      id: 'ctx-away-underdog', group: '경기 상황',
      when: function (o, c) { return c.venue === 'away' && c.odds === 'weak'; },
      axis: { mentality: -0.8, dline: -0.6, press: -0.4, tempo: -0.3 },
      toggle: { regroup: 1, counter: 1.2, pod: -0.6 },
      plan: { counter: 1.6, 'low-block': 1.2 },
      why: '원정이고 전력에서 밀립니다.',
      action: '점유를 포기하고 대형을 지키다 역습을 노리세요. 원정에서 열린 경기를 만들면 전력 차가 그대로 점수 차가 됩니다.'
    },
    {
      id: 'ctx-home-favourite', group: '경기 상황',
      when: function (o, c) { return c.venue === 'home' && c.odds === 'strong'; },
      axis: { mentality: 0.6, dline: 0.6, press: 0.6, loe: 0.4 },
      toggle: { pod: 0.6 },
      plan: { 'press-high': 1, possession: 0.8 },
      why: '홈이고 전력에서 앞섭니다.',
      action: '경기를 상대 진영에 가둬 두세요. 압박 시작 위치를 올리고 라인을 밀어 상대가 우리 진영에 올 일 자체를 줄입니다.'
    },
    {
      id: 'ctx-draw-ok', group: '경기 상황',
      when: function (o, c) { return c.goal === 'draw-ok'; },
      axis: { mentality: -0.6, tempo: -0.3, timewaste: 0.6 },
      toggle: { regroup: 0.8 },
      plan: { 'low-block': 0.8 },
      why: '무승부도 받아들일 수 있는 경기입니다.',
      action: '실점 위험을 먼저 줄이세요. 시간 지연을 올리고 무리한 전진을 줄입니다.'
    },
    {
      id: 'ctx-must-win', group: '경기 상황',
      when: function (o, c) { return c.goal === 'must-win'; },
      axis: { mentality: 0.7, dline: 0.4, press: 0.4, tempo: 0.4, timewaste: -0.6 },
      toggle: { counterpress: 0.8 },
      plan: { 'press-high': 0.8 },
      why: '반드시 이겨야 하는 경기입니다.',
      action: '실점 위험을 감수하고 앞으로 나가세요. 다만 전반부터 다 열지 말고, 되돌릴 수 없는 시점(65분 이후)에 맞춰 단계적으로 올리는 편이 안전합니다.'
    },

    // ── 우리 스쿼드 조건 ────────────────────────────────────────────
    {
      id: 'sq-low-stamina', group: '우리 스쿼드', tier: 'key',
      when: function (o, c, s) { return s.stamina > 0 && s.stamina < 12; },
      axis: { press: -0.8, tempo: -0.6 },
      toggle: { counterpress: -1.2 },
      plan: { 'press-high': -2 },
      why: '우리 선발진의 스태미너가 낮습니다(평균 ' + '{stamina}' + ').',
      action: '압박 강도를 낮추세요. 스태미너가 받쳐 주지 않는 압박은 60분경 무너지고, 그 뒤 30분은 압박도 대형도 없는 상태가 됩니다.'
    },
    {
      id: 'sq-pace', group: '우리 스쿼드',
      when: function (o, c, s) { return s.pace >= 14; },
      toggle: { pis: 0.8, counter: 0.8 },
      plan: { 'in-behind': 1.2, counter: 1 },
      why: '우리 공격진이 빠릅니다(평균 속도 ' + '{pace}' + ').',
      action: '속도를 쓰는 방향으로 기울이세요 — 공간으로 패스와 역습이 그대로 무기가 됩니다.'
    },
    {
      id: 'sq-technique', group: '우리 스쿼드',
      when: function (o, c, s) { return s.technique >= 14; },
      toggle: { pod: 0.8 },
      plan: { possession: 1.2 },
      role: { buildout: 0.8, 'creator-deep': 0.5, clearance: -0.8 },
      why: '우리 선수들의 기술이 좋습니다(평균 ' + '{technique}' + ').',
      action: '짧은 패스로 공을 지키는 쪽이 유리합니다.'
    },
    {
      id: 'sq-aerial', group: '우리 스쿼드',
      when: function (o, c, s) { return s.aerial >= 14; },
      plan: { 'wide-cross': 1.2 },
      role: { crosser: 0.8 },
      why: '우리 팀의 제공권이 좋습니다(평균 ' + '{aerial}' + ').',
      action: '크로스와 세트피스가 실질적인 득점 경로가 됩니다.'
    },
    {
      id: 'sq-weak-technique', group: '우리 스쿼드',
      when: function (o, c, s) { return s.technique > 0 && s.technique < 10; },
      axis: { directness: 0.6 },
      toggle: { pod: -1.4 },
      plan: { possession: -1.6 },
      role: { clearance: 1, buildout: -1, 'risk-pass': -1, playmaker: -0.5 },
      why: '우리 선수들의 기술이 낮습니다(평균 ' + '{technique}' + ').',
      action: '후방에서 짧게 돌리면 우리 진영에서 공을 잃습니다. 패스를 길게 가져가고 2차 볼 싸움으로 끌고 가세요.'
    },
    {
      id: 'sq-gk-kick', group: '우리 스쿼드',
      when: function (o, c, s) { return s.gkKick > 0 && s.gkKick < 10; },
      toggle: { pod: -0.8, gk_short: 0.6 },
      why: '우리 골키퍼의 킥이 약합니다(' + '{gkKick}' + ').',
      action: '길게 차게 하면 그대로 상대 공이 됩니다. 짧은 킥으로 가되, 상대가 강하게 압박한다면 이 조합 자체가 위험하므로 배급 대상을 측면으로 돌리세요.'
    }
  ];

  // 포메이션끼리 맞물리는 부분(중원 인원 차이, 상대 공격형 미드필더 유무 등)은
  // 여기 규칙으로 적지 않고 engine.js의 structuralRules()가 인원수에서 직접 계산합니다.
  // 규칙으로 적으면 포메이션 20개에 대해 400가지를 손으로 관리해야 하고,
  // 슬롯을 하나 고칠 때마다 그 400가지가 조용히 어긋납니다.

  // ── 경기 중 상황 ──────────────────────────────────────────────────────
  var MATCH_PHASES = [
    { id: 'first-early', ko: '전반 0~25분', idx: 0 },
    { id: 'first-late', ko: '전반 25~45분', idx: 1 },
    { id: 'half-time', ko: '하프타임', idx: 2 },
    { id: 'second-early', ko: '후반 45~60분', idx: 3 },
    { id: 'second-mid', ko: '60~75분', idx: 4 },
    // 75분과 88분은 쓸 수 있는 수단이 다릅니다. 한 칸으로 묶어 두면
    // "포메이션을 바꾸세요"와 "골키퍼를 코너에 올리세요"가 같은 조언이 됩니다.
    { id: 'second-late', ko: '75~85분', idx: 5 },
    { id: 'second-end', ko: '85분 이후 · 추가시간', idx: 6 }
  ];

  var MATCH_FLAGS = [
    { id: 'red-us', ko: '우리 퇴장' },
    { id: 'red-them', ko: '상대 퇴장' },
    { id: 'opp-changed', ko: '상대가 형태를 바꿈' },
    { id: 'tired', ko: '우리 체력 저하' },
    { id: 'opp-tired', ko: '상대 체력 저하' },
    { id: 'opp-parked', ko: '상대가 내려앉음' },
    { id: 'just-conceded', ko: '방금 실점함' }
  ];

  /*
   * 상대와의 전력 차이.
   *
   * 같은 1:1이라도 강팀 원정에서는 지켜야 할 승점 1이고, 약체 홈경기에서는
   * 잃고 있는 승점 2입니다. 점수만 보고 조언하면 이 둘이 같은 답을 받습니다.
   * 파일로는 알 수 없으므로 화면에서 직접 고르게 합니다.
   */
  var OPP_LEVELS = [
    { id: 'stronger', ko: '우리보다 강함' },
    { id: 'even', ko: '비슷함' },
    { id: 'weaker', ko: '우리보다 약함' }
  ];

  /*
   * ── 상대 유형 프리셋 ────────────────────────────────────────────────────
   *
   * 「맞춤 전술」이 약한 진짜 이유는 엔진이 아니라 입력이었습니다. 상대 성향을
   * 슬라이더 여덟 개로 받는데, 아무도 여덟 개를 매 경기 맞추지 않습니다.
   * 기본값 그대로 두면 팀 지시 축 열한 개 중 **하나도** 안 밀립니다 — 즉
   * 「맞춤 전술」의 팀 지시가 「기본 전술」과 완전히 같아집니다. 포메이션 상성만
   * 반영되고 나머지는 다 죽어 있었습니다.
   *
   * 사람은 상대를 슬라이더로 기억하지 않습니다. "얘네는 라인 올리고 압박한다",
   * "얘네는 내려앉아서 역습한다"로 기억합니다. 그걸 한 번에 넣게 합니다.
   *
   * 값은 게임에서 읽어 온 것이 아니라 그 유형이 보통 이렇다는 뜻입니다.
   * 누른 뒤에도 슬라이더는 그대로 만질 수 있습니다.
   */
  var OPP_PRESETS = [
    {
      id: 'gegen', ko: '하이라인 강압박', short: '게겐프레싱',
      why: '라인을 올려 압축하고 뺏기면 곧바로 다시 덮칩니다. 뒷공간이 넓게 남습니다.',
      set: { dline: 4, loe: 4, press: 4, mentality: 4, width: 4, tempo: 3, directness: 2,
        transitionLost: 'counterpress', transitionWon: 'hold' }
    },
    {
      id: 'lowblock', ko: '깊은 블록 · 역습', short: '버스+역습',
      why: '내려앉아 공간을 지우고 뺏으면 한 번에 넘깁니다. 우리가 열어야 합니다.',
      set: { dline: 0, loe: 0, press: 1, mentality: 1, width: 1, tempo: 2, directness: 4,
        transitionLost: 'regroup', transitionWon: 'counter' }
    },
    {
      id: 'possession', ko: '점유 · 짧은 패스', short: '점유',
      why: '공을 오래 잡고 천천히 옮깁니다. 우리가 공을 못 만지는 경기가 됩니다.',
      set: { dline: 3, loe: 3, press: 3, mentality: 3, width: 3, tempo: 1, directness: 0,
        transitionLost: 'counterpress', transitionWon: 'hold' }
    },
    {
      id: 'direct', ko: '롱볼 · 직선', short: '롱볼',
      why: '뒤에서 곧장 앞으로 넘깁니다. 세컨볼 싸움이 경기를 가릅니다.',
      set: { dline: 2, loe: 2, press: 2, mentality: 3, width: 3, tempo: 4, directness: 4,
        transitionLost: 'regroup', transitionWon: 'hold' }
    },
    {
      id: 'wide', ko: '측면 · 크로스 중심', short: '측면',
      why: '폭을 넓게 쓰고 크로스를 많이 올립니다. 우리 풀백이 계속 1대1을 겪습니다.',
      set: { dline: 2, loe: 2, press: 2, mentality: 3, width: 5, tempo: 3, directness: 3,
        transitionLost: 'regroup', transitionWon: 'hold' }
    },
    {
      id: 'narrow', ko: '중원 장악 · 좁게', short: '중앙',
      why: '중앙에 사람을 몰아 숫자로 이깁니다. 측면이 비는 대신 중앙이 막힙니다.',
      set: { dline: 3, loe: 3, press: 3, mentality: 3, width: 0, tempo: 2, directness: 1,
        transitionLost: 'counterpress', transitionWon: 'hold' }
    },
    {
      id: 'balanced', ko: '특징 없음 · 균형', short: '균형',
      why: '뚜렷한 성향이 없습니다. 이걸 고르면 포메이션 상성만 반영됩니다.',
      set: { dline: 2, loe: 2, press: 2, mentality: 3, width: 3, tempo: 2, directness: 2,
        transitionLost: 'regroup', transitionWon: 'hold' }
    }
  ];

  /*
   * 상대 전력별 기대 승점.
   *
   * 「경기 후」 탭은 상대 전력을 저장만 하고 쓰지 않았습니다. 그래서 첼시 원정
   * 1:0 승리와 최하위 팀 홈 1:0 승리가 완전히 같은 값이었습니다. 그 둘은 전혀
   * 다른 결과인데도요 — 강팀 상대로 기대 득점 1.4에 1골은 훌륭한 경기이고,
   * 약체 상대로 기대 득점 2.5에 1골은 결정력 문제입니다.
   *
   * 아래 값은 **이 도구의 잣대**이지 축구의 법칙이 아닙니다. 리그 순위표에서
   * 대략 이 정도가 나옵니다 — 홈에서 약체를 만나면 이겨야 하고, 강팀 원정에서
   * 승점 1이면 잘한 것입니다. 화면에 기준을 같이 적어서, 동의하지 않으면
   * 그 줄을 무시할 수 있게 합니다.
   */
  var EXPECTED_PTS = {
    home: { weaker: 2.4, even: 1.7, stronger: 1.1 },
    away: { weaker: 1.8, even: 1.2, stronger: 0.6 }
  };

  /*
   * 경기 전에 고르는 「우세/비슷/열세」와 경기 중에 고르는 「상대 전력」은
   * 같은 것을 반대 방향으로 말합니다 — 우리가 우세하면 상대는 약체입니다.
   * 두 화면이 따로 놀지 않도록 여기서 한 번만 맞춰 둡니다.
   */
  var ODDS_TO_OPP = { strong: 'weaker', even: 'even', weak: 'stronger' };

  /*
   * 전술 친숙도 (Tactical Familiarity).
   *
   * FM은 저장된 전술 하나하나에 친숙도를 따로 매깁니다. 그래서 이미 익혀 둔
   * 슬롯끼리 경기마다 갈아타는 것은 공짜입니다 — 친숙도가 깎이는 것은 포메이션을
   * 새로 만들거나 저장해 둔 전술의 뼈대를 뜯어고칠 때입니다.
   *
   * 대신 슬롯을 늘리면 전술 훈련 시간이 그만큼 쪼개집니다. 종이 위 궁합 점수만
   * 보고 고르면 "형태는 잘 맞는데 선수들이 아직 못 하는 전술"을 꺼내게 됩니다.
   * penalty가 그 보정입니다.
   *
   * penalty는 게임 내부 수치가 아니라 이 도구의 가중치입니다. 기준은
   * NEW_TACTIC_GAP(12점) — 포메이션을 새로 익힐 값어치가 있다고 보는 격차입니다.
   * 어색함(14)을 그보다 크게 둔 것은 "안 익힌 전술을 쓰느니 형태가 조금 덜
   * 맞아도 몸에 밴 것을 쓴다"는 뜻입니다.
   */
  var FAMILIARITY = [
    {
      id: 'awkward', ko: '어색함', en: 'Awkward', penalty: 14, pct: 20,
      note: '선수들이 아직 이 형태를 모릅니다. 실전에 꺼내면 점수표대로 안 나옵니다.',
      fix: '전술 훈련 세션(경기 연습 · 공격 조직 · 수비 조직)을 주간 일정에 넣고, 프리시즌이나 컵 경기에서 먼저 돌려 보세요.'
    },
    {
      id: 'competent', ko: '능숙함', en: 'Competent', penalty: 6, pct: 45,
      note: '기본은 돌아가지만 아직 몸에 붙지 않았습니다. 큰 경기에 꺼내기는 이릅니다.',
      fix: '주간 전술 세션을 한 칸 더 붙이면 몇 주 안에 올라갑니다.'
    },
    {
      id: 'accomplished', ko: '숙달됨', en: 'Accomplished', penalty: 2, pct: 70,
      note: '실전에 써도 되는 상태입니다. 아직 최고는 아닙니다.',
      fix: '이대로 경기를 치르면 자연히 올라갑니다.'
    },
    {
      id: 'fluid', ko: '유동적', en: 'Fluid', penalty: 0, pct: 100,
      note: '완전히 익은 전술입니다. 언제 꺼내도 제 점수가 나옵니다.',
      fix: ''
    }
  ];

  /*
   * 슬롯 세 개가 채워야 할 자리.
   *
   * 슬롯을 세 개 다 채웠는데 셋 다 "중원 장악"이면, 강팀 원정에서 꺼낼 게
   * 없습니다. 반대로 셋 다 성격이 달라도 문제입니다 — 훈련이 셋으로 쪼개집니다.
   * 이 둘을 같이 봐야 슬롯 구성을 판단할 수 있습니다.
   */
  var SLOT_ROLES = [
    {
      id: 'low', ko: '내려앉아 버티기', tags: ['defensive-shape'],
      why: '강팀 원정, 그리고 리드를 지켜야 하는 마지막 20분에 꺼낼 형태입니다.'
    },
    {
      id: 'control', ko: '중원 장악', tags: ['overload-centre', 'dm-anchored'],
      why: '비슷한 상대와 중앙에서 수적 싸움을 벌일 때 쓰는 형태입니다.'
    },
    {
      id: 'chase', ko: '몰아붙이기', tags: ['attacking', 'two-striker'],
      why: '내려앉은 약체를 상대하거나, 지고 있어서 앞에 사람을 더 둬야 할 때 쓰는 형태입니다.'
    }
  ];

  /*
   * ── 경기 기록 ───────────────────────────────────────────────────────────
   *
   * 한 경기만으로는 운과 실력을 구분할 수 없습니다. 기대 득점 2.4에 무득점으로
   * 진 경기는 그 자체로는 아무것도 말해 주지 않습니다 — 세 경기째 같은 일이
   * 반복되면 그때 마무리가 문제인 것입니다.
   *
   * 그런데 이 도구는 경기 기록을 남기지 않았습니다. 그래서 「경기 중」 탭이
   * "전술을 바꾸지 마세요"라고 말한 것이 옳았는지 영영 알 수 없었습니다.
   *
   * 숫자로 알 수 없는 것은 태그로 받습니다. 실점 장면이 세트피스였는지 역습이었는지는
   * 통계 표에 없는데, 그게 반복되면 전술보다 먼저 고쳐야 할 문제입니다.
   */
  var MATCH_TAGS = [
    {
      id: 'early-concede', ko: '전반 초반 실점 (15분 이내)',
      repeat: '전반 초반 실점이 반복됩니다 — 경기가 안정되기 전에 열려 있다는 뜻입니다.',
      fix: '홈 경기 첫 15분만 멘탈리티를 한 칸 내리고 수비 라인을 반 칸 내려 경기를 재운 뒤 올리세요.'
    },
    {
      id: 'setpiece-concede', ko: '세트피스 실점',
      repeat: '세트피스에서 반복해서 실점하고 있습니다.',
      fix: '수비 세트피스 배치를 다시 보세요. 공중볼이 약한 선발이 넷 이상이면 앞에 남기는 인원을 줄여 박스 안 숫자를 확보해야 합니다.'
    },
    {
      id: 'counter-concede', ko: '역습 실점',
      repeat: '역습에 반복해서 뚫리고 있습니다.',
      fix: '수비 라인이나 압박 강도가 스쿼드 속도에 비해 높습니다. 뒤에 남기는 인원과 수비형 미드필더의 임무부터 보세요.'
    },
    {
      id: 'mistake-concede', ko: '개인 실수 실점',
      repeat: '개인 실수로 반복해서 실점하고 있습니다.',
      fix: '전술 문제가 아닙니다. 후방 빌드업 지시를 줄이거나(짧은 패스·골키퍼 배급), 그 선수를 바꾸세요.'
    },
    {
      id: 'late-concede', ko: '후반 막판 실점 (80분 이후)',
      repeat: '막판에 반복해서 실점하고 있습니다 — 체력이 떨어지는 구간입니다.',
      fix: '70분 전후로 교체를 예약하고, 리드 중이면 그때 멘탈리티를 한 칸만 내리세요. 통째로 내려앉으면 오히려 더 위험합니다.'
    },
    {
      id: 'opp-parked', ko: '상대가 내려앉음',
      repeat: '상대가 반복해서 내려앉습니다 — 이제 그게 기본 상황입니다.',
      fix: '내려앉은 블록을 여는 형태를 슬롯 하나로 만들어 두세요. 매 경기 그때그때 바꾸는 것보다 낫습니다.'
    },
    {
      id: 'red-card', ko: '퇴장 (우리)',
      repeat: '퇴장이 반복됩니다 — 태클 강도가 스쿼드의 판단력에 비해 높습니다.',
      fix: '태클 강도를 한 칸 낮추고, 경고를 받은 선수의 개인 지시에서 「강하게 태클」을 빼세요.'
    }
  ];

  var MATCH_RESULTS = [
    { id: 'w', ko: '승', pts: 3 },
    { id: 'd', ko: '무', pts: 1 },
    { id: 'l', ko: '패', pts: 0 }
  ];

  /*
   * ── 선수 상태 ───────────────────────────────────────────────────────────
   *
   * 지금까지 선발은 능력치만 보고 정했습니다. 그래서 "이번 주는 로테를 돌려야
   * 한다"를 말할 수 없었습니다 — 컨디션도 출전 시간도 모르니까요.
   *
   * 컨디션과 경기 체력은 FM 스쿼드 화면의 열입니다. 보기에 넣어 내보내면
   * 그대로 읽힙니다. 화면에서 손으로 넣을 수도 있습니다.
   *
   * 중요한 것 하나 — 이 값들은 **최적 11을 정하는 데 쓰지 않습니다.** 컨디션을
   * 선발 계산에 섞으면 파일을 새로 넣을 때마다 주전이 바뀌고, 그러면 포메이션도
   * 흔들려 전술 친숙도 설계가 통째로 무너집니다. 최적 11은 능력치로 고정하고,
   * 컨디션은 "이번 경기 누구를 쉬게 할까"에만 씁니다.
   */
  var CONDITION_BANDS = [
    {
      id: 'fresh', ko: '충분', min: 93,
      note: '그대로 선발로 씁니다.'
    },
    {
      id: 'ok', ko: '보통', min: 85,
      note: '한 경기는 문제없습니다. 사흘 뒤 또 경기가 있으면 그때 봅니다.'
    },
    {
      id: 'tired', ko: '지침', min: 75,
      note: '이 상태로 선발이면 후반에 떨어지고 부상 위험도 올라갑니다.'
    },
    {
      id: 'spent', ko: '바닥', min: 0,
      note: '쉬게 하세요. 여기서 90분을 더 뛰면 다음 두세 경기를 잃습니다.'
    }
  ];

  /*
   * 자리별 뎁스 등급.
   *
   * 지금까지 선수는 주전 아니면 나머지, 둘 뿐이었습니다. 그런데 적합도 71과 70은
   * 사실상 같은 선수인데 하나는 주전, 하나는 그냥 '나머지'가 됩니다. 로테이션을
   * 말하려면 그 사이가 필요합니다.
   *
   * gap은 그 자리 주전과의 적합도 차이입니다.
   */
  var DEPTH_TIERS = [
    {
      id: 'equal', ko: '실질 동급', gap: 4,
      note: '주전과 차이가 거의 없습니다. 아무 때나 돌려도 전력 손실이 없습니다.'
    },
    {
      id: 'rotation', ko: '로테이션', gap: 12,
      note: '한 경기 정도는 맡길 수 있습니다. 연전 사이에 쓰기 좋습니다.'
    },
    {
      id: 'emergency', ko: '급할 때만', gap: 24,
      note: '주전이 빠졌을 때만 씁니다. 계획해서 돌릴 자원은 아닙니다.'
    },
    {
      id: 'none', ko: '대체 불가', gap: Infinity,
      note: '이 자리는 주전이 빠지면 메울 사람이 없습니다.'
    }
  ];

  // FM 경기 통계 화면의 항목. 가운데가 항목명, 좌우가 두 팀입니다.
  var MATCH_STATS = [
    { id: 'shots', ko: '슈팅', aliases: ['슈팅 수', '슈팅', 'Shots'] },
    { id: 'sot', ko: '유효 슈팅', aliases: ['유효 슈팅', 'Shots on Target', 'On Target'] },
    { id: 'xg', ko: '기대 득점', aliases: ['기대 득점', 'xG', 'Expected Goals'] },
    { id: 'corners', ko: '코너킥', aliases: ['코너킥', '코너', 'Corners'] },
    { id: 'fouls', ko: '반칙', aliases: ['반칙', '파울', 'Fouls'] },
    { id: 'cards', ko: '경고', aliases: ['경고', '옐로 카드', 'Yellow Cards', 'Bookings'] },
    { id: 'passPct', ko: '패스 성공률', aliases: ['패스 성공', '패스 성공률', 'Passes Completed', 'Pass Completion'] },
    { id: 'possession', ko: '점유율', aliases: ['점유율', 'Possession'] },
    { id: 'offsides', ko: '오프사이드', aliases: ['오프사이드', 'Offsides'] },
    { id: 'tackles', ko: '태클 성공', aliases: ['태클 성공', '태클', 'Tackles Won', 'Tackles'] },
    { id: 'saves', ko: '선방', aliases: ['선방', '세이브', 'Saves'] },
    { id: 'dribbles', ko: '드리블 성공', aliases: ['드리블 성공', '드리블', 'Dribbles'] },
    { id: 'headers', ko: '공중 경합 승', aliases: ['헤딩 성공', '공중 볼 경합', 'Headers Won'] },
    { id: 'interceptions', ko: '인터셉트', aliases: ['인터셉트', '가로채기', 'Interceptions'] }
  ];

  /*
   * 경기 중 조정 규칙.
   *
   * 경기 전 전술과 다른 점이 하나 있습니다 — 여기서는 "바꾸지 마세요"도 답입니다.
   * 기대 득점이 쌓이는데 골이 안 들어가는 상황에서 전술을 뒤집으면, 만들고 있던
   * 것까지 잃습니다. 그래서 hold 종류의 항목을 따로 둡니다.
   *
   * c.phaseIdx 0~6, c.diff = 우리 득점 - 상대 득점, c.gf = 우리 득점,
   * c.flag(id), c.oppLevel = 'stronger'|'even'|'weaker',
   * c.s = 통계(없으면 null), c.us/c.them = 팀별 통계값
   */
  var INMATCH_RULES = [
    // ── 점수와 시간 ────────────────────────────────────────────────
    /*
     * 전반에도 점수가 움직이면 할 말이 있어야 합니다. 예전에는 규칙이 전부
     * 하프타임 이후만 봐서, 20분에 0:2로 끌려가도 화면이 비어 있었습니다.
     */
    {
      id: 'behind-first-half', tier: 'key', group: '점수',
      when: function (c) { return c.diff < 0 && c.phaseIdx <= 1; },
      why: function (c) {
        return '전반인데 ' + (-c.diff) + '골 뒤지고 있습니다 — 아직 시간이 충분합니다.';
      },
      items: [
        { kind: 'hold', text: '지금 전술을 뒤집지 마세요.', why: '전반에 열면 하프타임 전에 한 골을 더 먹습니다. 그때는 두 골 차가 되어 후반 계획 자체가 없어집니다.' },
        { kind: 'shape', text: '실점 경로 하나만 막습니다 — 그 골이 측면이었는지 뒷공간이었는지 중앙이었는지.', why: '상대는 통한 길을 다시 씁니다. 한 곳만 고치는 것은 대형을 흔들지 않습니다.' },
        { kind: 'sub', text: '교체는 하프타임까지 미룹니다. 부상이 아니면 지금 쓰지 마세요.', why: '전반에 쓴 카드는 후반 30분을 버틸 다리를 미리 태우는 것입니다.' }
      ]
    },
    {
      id: 'lead-first-half', tier: 'normal', group: '점수',
      when: function (c) { return c.diff > 0 && c.phaseIdx <= 1; },
      why: function (c) { return '전반에 ' + c.diff + '골 앞서 있습니다.'; },
      items: [
        { kind: 'hold', text: '지금 내려앉지 마세요.', why: '이른 리드에서 물러서면 남은 시간이 너무 깁니다. 60분 넘게 우리 진영에서 버티는 경기가 됩니다.' },
        { kind: 'toggle', text: '역압박을 켜서 상대가 전개를 시작하기 전에 끊습니다.', why: '실점 직후의 상대가 가장 급하게 나오는 구간입니다.' },
        { kind: 'sub', text: '체력 소모가 큰 역할의 교체를 60분에 맞춰 미리 정해 둡니다.', why: '리드를 지키는 구간이 오기 전에 다리를 남겨 둬야 합니다.' }
      ]
    },
    {
      id: 'lead2-halftime', tier: 'key', group: '점수',
      when: function (c) { return c.diff >= 2 && c.phaseIdx === 2; },
      why: '두 골 차로 앞선 채 하프타임입니다.',
      items: [
        { kind: 'hold', text: '지금은 내리지 마세요.', why: '남은 45분에 두 골 차는 안전하지 않습니다. 여기서 물러서면 상대에게 45분을 통째로 내주게 됩니다.' },
        { kind: 'shape', text: '한 골 더 넣어 경기를 끝내는 쪽으로 갑니다.', why: '세 골 차가 되면 그때 안전하게 내릴 수 있습니다.' },
        { kind: 'sub', text: '체력 소모가 큰 역할(프레싱 포워드·볼 위닝 미드필더·컴플리트 윙백)의 교체를 60분에 맞춰 준비합니다.', why: '리드를 지키는 구간이 오기 전에 다리를 남겨 둬야 합니다.' }
      ]
    },
    {
      id: 'lead2-late', tier: 'key', group: '점수',
      when: function (c) { return c.diff >= 2 && c.phaseIdx >= 4; },
      why: '두 골 차 리드로 경기 막바지입니다.',
      items: [
        { kind: 'axis', text: '멘탈리티를 한 칸 내립니다.', why: '두 칸을 한 번에 내리면 팀이 통째로 물러서 상대를 우리 진영으로 불러들입니다.' },
        { kind: 'axis', text: '수비 라인과 압박 시작 위치를 함께 한 칸씩 내립니다.', why: '라인만 내리면 라인과 압박선 사이가 벌어지고, 그 공간이 곧 상대의 슈팅 지역이 됩니다.' },
        { kind: 'toggle', text: '공을 잃으면 재정비, 뺏으면 대형 유지로 바꿉니다.', why: '역습으로 한 골 더 넣는 값보다 대형을 유지해 실점을 막는 값이 큽니다.' },
        { kind: 'axis', text: '시간 지연을 올립니다.', why: '' },
        { kind: 'shape', text: '공격 임무인 측면 수비를 지원이나 수비로 내립니다.', why: '막판 실점은 대개 측면 뒷공간에서 나옵니다.' }
      ]
    },
    {
      id: 'lead1-halftime', tier: 'key', group: '점수',
      when: function (c) { return c.diff === 1 && c.phaseIdx === 2; },
      why: '한 골 차로 앞선 채 하프타임입니다.',
      items: [
        { kind: 'hold', text: '전술은 그대로 둡니다.', why: '한 골 차로 45분을 버티는 건 두 골 차보다 훨씬 어렵습니다. 지금 내리면 후반 내내 밀립니다.' },
        { kind: 'toggle', text: '역압박을 켜서 상대가 전개를 시작하기 전에 끊습니다.', why: '후반 시작 15분이 상대가 가장 강하게 나오는 구간입니다.' }
      ]
    },
    {
      id: 'lead-second-early', tier: 'normal', group: '점수',
      when: function (c) { return c.diff >= 1 && c.phaseIdx === 3; },
      why: function (c) { return c.diff + '골 앞선 채 후반이 시작됐습니다.'; },
      items: [
        { kind: 'hold', text: '아직 내리지 마세요 — 내리는 구간은 70분부터입니다.', why: '45분에 물러서면 45분을 통째로 버텨야 합니다. 그렇게 지킨 리드는 대개 마지막 15분에 무너집니다.' },
        { kind: 'toggle', text: '역압박을 켜서 후반 시작 15분을 넘깁니다.', why: '상대가 하프타임에 무엇을 바꿨든 가장 세게 나오는 구간이 여기입니다.' },
        { kind: 'sub', text: '체력이 떨어진 자리를 60분에 교체할 수 있게 지금 정해 둡니다.', why: '' }
      ]
    },
    {
      id: 'lead1-late', tier: 'key', group: '점수',
      when: function (c) { return c.diff === 1 && c.phaseIdx >= 4; },
      why: '한 골 차 리드로 경기 막바지입니다.',
      items: [
        { kind: 'axis', text: '멘탈리티를 한 칸 내리고 시간 지연을 올립니다.', why: '' },
        { kind: 'axis', text: '수비 라인·압박 시작 위치를 함께 내립니다.', why: '둘을 따로 움직이면 그 사이가 벌어집니다.' },
        { kind: 'shape', text: '최전방 한 명은 남겨 둡니다.', why: '전원이 내려가면 걷어낸 공이 즉시 되돌아와 압박이 끊이지 않습니다.' },
        { kind: 'sub', text: '체력이 떨어진 압박형 선수를 수비 가담이 되는 유형으로 교체합니다.', why: '' }
      ]
    },
    {
      id: 'level-halftime', tier: 'normal', group: '점수',
      when: function (c) { return c.diff === 0 && c.phaseIdx === 2; },
      why: '동점으로 하프타임입니다.',
      items: [
        { kind: 'hold', text: '통계를 먼저 보고 정하세요.', why: '동점 자체는 아무 정보도 주지 않습니다. 만들고 있는데 안 들어가는 것과 아무것도 못 만드는 것은 정반대의 처방이 필요합니다.' },
        { kind: 'axis', text: '판단이 서지 않으면 멘탈리티를 한 칸만 올리고 60분에 다시 봅니다.', why: '하프타임에 크게 바꾸면 그 변화가 맞았는지 틀렸는지 알 수 없게 됩니다.' }
      ]
    },
    /*
     * 동점은 하프타임에만 규칙이 있었습니다. 그래서 85분 동점에서는 점수에 대한
     * 조언이 하나도 나오지 않고 기록 진단만 떴습니다 — 정작 가장 중요한
     * "남은 시간에 이 점수를 어떻게 볼 것인가"가 빠져 있었습니다.
     */
    {
      id: 'level-second', tier: 'normal', group: '점수',
      when: function (c) { return c.diff === 0 && (c.phaseIdx === 3 || c.phaseIdx === 4); },
      why: '동점으로 후반 중반입니다 — 아직 크게 바꾸지 않아도 되는 마지막 구간입니다.',
      items: [
        { kind: 'axis', text: '멘탈리티를 한 칸 올리고 템포를 한 칸 올립니다.', why: '75분이 지나면 선택지가 확 줄어듭니다. 움직이려면 지금이 비용이 가장 쌉니다.' },
        { kind: 'sub', text: '교체 카드 세 장 중 한 장을 여기서 씁니다 — 지친 자리 하나만.', why: '세 장을 다 막판에 쓰면 새 선수가 경기에 들어올 시간이 없습니다.' }
      ]
    },
    {
      id: 'level-late-weaker', tier: 'key', group: '점수',
      when: function (c) { return c.diff === 0 && c.phaseIdx >= 5 && c.oppLevel === 'weaker'; },
      why: '우리보다 약한 상대와 동점인 채로 막바지입니다 — 지금은 승점 2를 잃고 있는 상태입니다.',
      items: [
        { kind: 'axis', text: '멘탈리티를 공격적까지 올립니다. 매우 공격적은 쓰지 마세요.', why: '약체 상대에게 남은 10분은 실점 위험보다 무득점이 더 비쌉니다. 다만 매우 공격적은 대형이 흩어져 역습 한 방에 지는 쪽입니다 — 비기던 경기를 지는 경기로 바꿉니다.' },
        { kind: 'axis', text: '공격 폭을 최대로 넓히고 수비 라인을 올려 경기장을 압축합니다.', why: '약한 상대가 동점을 지키는 방법은 거의 항상 좁게 내려앉는 것입니다. 좁은 블록은 좌우로 늘려야 열립니다.' },
        { kind: 'shape', text: '최전방 인원을 한 명 늘립니다 — 수비형 미드필더나 측면 수비 하나를 공격 자원으로 바꿉니다.', why: '지시만 올리면 박스 안 인원은 그대로입니다. 크로스를 아무리 올려도 받을 사람이 없습니다.' },
        { kind: 'toggle', text: '85분까지는 박스 안까지 볼 배급을 켜고 역습 지시는 끕니다. 85분을 넘기면 얼리 크로스로 바꿉니다.', why: '상대가 이미 내려와 있으면 역습으로 쓸 공간 자체가 없습니다. 다만 마지막 몇 분에는 줄을 쌓을 시간이 없어 방향이 반대가 됩니다 — 두 지시는 같이 켤 수 없습니다.' },
        { kind: 'sub', text: '남은 교체를 지금 다 씁니다 — 드리블 돌파형 측면과 박스 안 제공권 자원.', why: '아껴 봐야 쓸 경기가 남아 있지 않습니다.' }
      ]
    },
    {
      id: 'level-late-stronger', tier: 'key', group: '점수',
      when: function (c) { return c.diff === 0 && c.phaseIdx >= 5 && c.oppLevel === 'stronger'; },
      why: '우리보다 강한 상대와 동점인 채로 막바지입니다 — 승점 1은 이미 벌어 놓은 것입니다.',
      items: [
        { kind: 'hold', text: '먼저 열지 마세요.', why: '전력이 앞선 상대와 서로 열면 그 교환은 우리가 집니다. 여기서 얻을 수 있는 최선은 대부분 무승부입니다.' },
        { kind: 'axis', text: '수비 라인과 압박 시작 위치를 함께 한 칸 내리고 시간 지연을 올립니다.', why: '라인만 내리면 라인과 압박선 사이가 벌어지고, 그 공간이 그대로 상대의 슈팅 지역이 됩니다.' },
        { kind: 'sub', text: '체력이 떨어진 수비와 수비형 미드필더부터 교체합니다.', why: '막판 실점은 대부분 다리가 멈춘 자리에서 나옵니다.' },
        { kind: 'shape', text: '역습 한 방을 노린다면 최전방 한 명만 빠른 선수로 바꾸고 나머지는 그대로 둡니다.', why: '이기려는 시도는 대형을 건드리지 않는 선까지만 합니다.' }
      ]
    },
    {
      id: 'level-late-even', tier: 'key', group: '점수',
      when: function (c) {
        return c.diff === 0 && c.phaseIdx >= 5 && c.oppLevel !== 'weaker' && c.oppLevel !== 'stronger';
      },
      why: '비슷한 상대와 동점인 채로 막바지입니다.',
      items: [
        { kind: 'axis', text: '멘탈리티를 한 칸만 올립니다.', why: '전력이 비슷하면 서로 여는 순간 먼저 실수하는 쪽이 집니다. 두 칸은 그 실수를 우리가 하게 만듭니다.' },
        { kind: 'shape', text: '한쪽 측면 수비만 공격 임무로 올리고 그쪽 집중 공격을 켭니다 — 양쪽을 동시에 올리지 마세요.', why: '한쪽만 올리면 반대쪽이 역습을 받아 줍니다.' },
        { kind: 'sub', text: '남아 있는 교체 카드를 씁니다 — 상대도 다리가 멈춰 있는 구간입니다.', why: '' }
      ]
    },
    {
      id: 'down1-halftime', tier: 'key', group: '점수',
      when: function (c) { return c.diff === -1 && c.phaseIdx === 2; },
      why: '한 골 뒤진 채 하프타임입니다.',
      items: [
        { kind: 'hold', text: '아직 45분 남았습니다 — 지금 다 열지 마세요.', why: '하프타임에 전부 열면 60분에 두 골 차가 되고, 그때는 손쓸 방법이 없습니다.' },
        { kind: 'axis', text: '멘탈리티를 한 칸만 올립니다.', why: '' },
        { kind: 'sub', text: '교체 카드는 60분 이후에 씁니다.', why: '지금 쓰면 마지막 30분에 쓸 카드가 없습니다.' }
      ]
    },
    {
      id: 'down1-second-early', tier: 'normal', group: '점수',
      when: function (c) { return c.diff === -1 && c.phaseIdx === 3; },
      why: '한 골 뒤진 채 후반이 시작됐습니다.',
      items: [
        { kind: 'hold', text: '하프타임에 정한 것을 60분까지는 지켜봅니다.', why: '후반 시작 15분은 상대도 아직 자리를 못 잡은 구간입니다. 여기서 또 바꾸면 무엇이 통했는지 알 수 없게 됩니다.' },
        { kind: 'axis', text: '아직 아무것도 안 바꿨다면 멘탈리티를 한 칸 올립니다.', why: '' },
        { kind: 'sub', text: '교체는 60분에 맞춰 준비만 해 둡니다.', why: '지금 쓰면 마지막 30분에 쓸 카드가 없습니다.' }
      ]
    },
    {
      id: 'down1-mid', tier: 'key', group: '점수',
      when: function (c) { return c.diff === -1 && c.phaseIdx === 4; },
      why: '한 골 뒤진 채 60분을 넘겼습니다 — 움직일 시점입니다.',
      items: [
        { kind: 'axis', text: '멘탈리티를 올리고 수비 라인·압박 시작 위치를 함께 올립니다.', why: '경기장을 압축해 상대가 시간을 쓰지 못하게 합니다.' },
        { kind: 'toggle', text: '역압박을 켭니다.', why: '' },
        { kind: 'sub', text: '수비형 미드필더 한 명을 공격 자원으로 교체합니다 — 한 명까지입니다.', why: '둘을 한 번에 빼면 중원이 뚫려 역습으로 경기가 끝납니다.' }
      ]
    },
    {
      id: 'down1-late', tier: 'key', group: '점수',
      when: function (c) { return c.diff === -1 && c.phaseIdx >= 5; },
      why: '한 골 뒤진 채 75분을 넘겼습니다.',
      items: [
        { kind: 'shape', text: '포메이션을 바꿔 최전방 인원을 늘립니다(4-2-3-1 → 4-2-4 등).', why: '지시만 올리는 것으로는 박스 안 인원이 늘지 않습니다.' },
        { kind: 'sub', text: '남은 교체를 여기서 다 씁니다.', why: '한 장을 아껴 봐야 89분에 들어간 선수는 경기에 영향을 주지 못합니다.' }
      ]
    },
    {
      id: 'down2', tier: 'key', group: '점수',
      when: function (c) { return c.diff <= -2 && c.phaseIdx >= 2; },
      why: '두 골 이상 뒤지고 있습니다.',
      items: [
        { kind: 'shape', text: '포메이션 자체를 공격형으로 바꿉니다.', why: '지시만 올리는 것으로는 부족합니다.' },
        { kind: 'axis', text: '멘탈리티는 공격적까지만 올립니다.', why: '매우 공격적은 대형이 흩어져 실점만 늘리는 경우가 많습니다.' },
        { kind: 'axis', text: '수비 라인을 올려 경기장을 압축하고 실점을 감수합니다.', why: '두 골 차에서 한 골을 더 먹는 값은 크지 않습니다.' },
        { kind: 'sub', text: '체력이 남은 선수를 먼저 투입합니다.', why: '' }
      ]
    },
    // ── 마지막 5분 ─────────────────────────────────────────────────
    /*
     * 85분 이후에는 "포메이션을 바꾸세요" 같은 조언이 이미 늦습니다.
     * 남은 것은 세트피스와 박스 안 인원, 그리고 시간뿐입니다.
     */
    {
      id: 'endgame-chase', tier: 'key', group: '점수',
      when: function (c) { return c.phaseIdx === 6 && c.diff <= 0; },
      why: function (c) {
        return c.diff === 0 ? '85분이 지났고 동점입니다 — 남은 것은 몇 분뿐입니다.'
          : '85분이 지났고 뒤지고 있습니다 — 남은 것은 몇 분뿐입니다.';
      },
      items: [
        { kind: 'toggle', text: '얼리 크로스와 세트피스 노리기를 켭니다. 앞에서 「박스 안까지 볼 배급」을 켜 뒀다면 여기서는 끕니다.', why: '남은 시간에 줄을 쌓아 올릴 여유가 없어 가장 짧은 경로인 측면 크로스와 세트피스를 씁니다. 박스 안까지 볼 배급은 얼리 크로스를 막는 지시라 둘을 같이 켜면 서로 지웁니다.' },
        { kind: 'shape', text: '제공권이 되는 선수를 전부 앞으로 올립니다 — 센터백 한 명을 최전방으로 올리는 것도 여기서는 맞습니다.', why: '80분대까지는 손해지만 마지막 몇 분에는 잃을 것이 없습니다.' },
        { kind: 'toggle', text: '후방에서 짧게 시작을 끄고 패스를 길게 바꿉니다.', why: '뒤에서부터 만들면 한 번의 공격을 시작하는 데만 30초가 갑니다.' },
        { kind: 'axis', text: '골키퍼는 코너킥과 프리킥에만 올립니다.', why: '흐름 중에 올리면 그 뒤에 실점하고, 그 실점은 되돌릴 시간이 없습니다.' },
        { kind: 'sub', text: '교체 카드가 남아 있다면 지금 다 씁니다.', why: '경기 시간을 멈추는 효과까지 같이 얻습니다.' }
      ]
    },
    {
      id: 'endgame-hold', tier: 'key', group: '점수',
      when: function (c) { return c.phaseIdx === 6 && c.diff >= 1; },
      why: '85분이 지났고 앞서 있습니다 — 이제 필요한 것은 골이 아니라 시간입니다.',
      items: [
        { kind: 'axis', text: '시간 지연을 최대로 올립니다.', why: '' },
        { kind: 'toggle', text: '공을 잃으면 재정비, 뺏으면 대형 유지로 둡니다.', why: '역습을 나가려다 공을 잃으면 대형이 벌어진 채로 상대 공격을 맞습니다.' },
        { kind: 'sub', text: '교체 카드가 남아 있으면 씁니다 — 누구를 넣느냐보다 시간을 쓰는 것이 목적입니다.', why: '' },
        { kind: 'shape', text: '코너킥·프리킥 수비에 전원을 남기고, 최전방 한 명만 앞에 둡니다.', why: '완전히 비우면 걷어낸 공이 즉시 되돌아와 압박이 끊이지 않습니다.' }
      ]
    },
    // ── 전력 차이 ──────────────────────────────────────────────────
    {
      id: 'weaker-behind', tier: 'key', group: '전력',
      when: function (c) { return c.oppLevel === 'weaker' && c.diff < 0 && c.phaseIdx >= 2; },
      why: '우리보다 약한 상대에게 뒤지고 있습니다.',
      items: [
        { kind: 'hold', text: '먼저 원인을 고르세요 — 상대가 내려앉아 못 여는 것과 역습에 계속 뚫리는 것은 정반대의 처방입니다.', why: '약체에게 지고 있을 때 가장 흔한 실수가 무조건 멘탈리티부터 올리는 것입니다. 역습에 당하고 있었다면 그 순간 경기가 끝납니다.' },
        { kind: 'axis', text: '못 여는 쪽이면 공격 폭을 넓히고 수비 라인을 올려 상대를 자기 진영에 가둡니다.', why: '약한 상대는 라인을 올려도 뒷공간을 쓸 능력이 부족한 경우가 많습니다.' },
        { kind: 'axis', text: '역습에 당하는 쪽이면 멘탈리티는 그대로 두고 측면 수비 임무만 내립니다.', why: '뒤가 뚫리는 상태에서 더 올리면 뚫리는 횟수만 늘어납니다.' }
      ]
    },
    {
      id: 'stronger-lead', tier: 'normal', group: '전력',
      when: function (c) { return c.oppLevel === 'stronger' && c.diff > 0 && c.phaseIdx >= 3; },
      why: '우리보다 강한 상대를 상대로 앞서 있습니다.',
      items: [
        { kind: 'hold', text: '완전히 내려앉지는 마세요.', why: '전력이 앞선 상대를 우리 진영으로 불러들이면 결국 숫자에서 집니다. 버티는 시간이 길수록 실점 확률이 올라갑니다.' },
        { kind: 'shape', text: '최전방에 빠른 선수를 한 명 남겨 역습 위협을 유지합니다.', why: '상대 센터백이 올라오지 못하게 붙잡아 두는 것만으로 압박이 줄어듭니다.' },
        { kind: 'axis', text: '압박 강도는 낮추되 압박 시작 위치는 너무 내리지 않습니다.', why: '' }
      ]
    },
    // ── 특수 상황 ──────────────────────────────────────────────────
    {
      id: 'just-conceded', tier: 'key', group: '상황',
      when: function (c) { return c.flag('just-conceded') && c.phaseIdx <= 4; },
      why: '방금 실점했습니다 — 통계적으로 다음 실점이 가장 잘 나오는 구간입니다.',
      items: [
        { kind: 'hold', text: '실점 직후 5분은 형태를 바꾸지 마세요.', why: '실점 직후에 손대면 흔들린 상태에서 대형까지 새로 맞춰야 합니다. 두 번째 실점이 여기서 나옵니다.' },
        { kind: 'shape', text: '그 골이 어디서 나왔는지부터 보고 그 경로 하나만 막습니다.', why: '상대는 통한 길을 반드시 다시 씁니다. 측면 크로스였다면 안쪽으로 유도, 뒷공간이었다면 수비 라인을 내리는 식으로 한 곳만 고칩니다.' },
        { kind: 'axis', text: '5분을 넘긴 뒤에 점수에 맞춰 움직입니다.', why: '' }
      ]
    },
    {
      id: 'just-conceded-late', tier: 'key', group: '상황',
      when: function (c) { return c.flag('just-conceded') && c.phaseIdx >= 5; },
      why: '막바지에 실점했습니다 — 기다릴 시간이 없습니다.',
      items: [
        { kind: 'shape', text: '실점 경로 한 곳만 막고, 나머지는 점수에 맞춰 그대로 밀어붙입니다.', why: '남은 시간이 짧으면 "5분 버티기"는 곧 경기를 포기하는 것과 같습니다. 다만 상대가 통한 길을 그대로 다시 쓰게 두면 두 골 차가 됩니다.' },
        { kind: 'sub', text: '실점 장면에서 뚫린 선수가 지쳐 있으면 그 자리부터 교체합니다.', why: '같은 자리가 두 번 뚫리는 것이 막판 실점의 가장 흔한 모양입니다.' }
      ]
    },
    {
      id: 'red-us', tier: 'key', group: '상황',
      when: function (c) { return c.flag('red-us'); },
      why: '우리가 퇴장으로 수적 열세입니다.',
      items: [
        { kind: 'shape', text: '측면 공격수 한 명을 빼고 그 자리를 수비·미드필드로 메웁니다. 최전방 한 명은 남기세요.', why: '전원 후퇴는 압박을 영구히 허용합니다.' },
        { kind: 'axis', text: '멘탈리티를 신중한으로 내리고 수비 라인·압박 시작 위치를 함께 내립니다.', why: '' },
        { kind: 'axis', text: '압박 강도를 낮춥니다.', why: '10명으로 압박하면 곧바로 대형이 찢어집니다.' },
        { kind: 'shape', text: '남은 최전방은 타깃 포워드 계열로 둡니다.', why: '걷어낸 공이 곧바로 되돌아오지 않게 해야 숨을 쉴 수 있습니다.' }
      ]
    },
    {
      id: 'red-them', tier: 'key', group: '상황',
      when: function (c) { return c.flag('red-them'); },
      why: '상대가 퇴장으로 우리가 수적 우위입니다.',
      items: [
        { kind: 'axis', text: '공격 폭을 넓힙니다.', why: '10명은 좌우로 늘어나는 것을 가장 못 버팁니다.' },
        { kind: 'axis', text: '수비 라인을 올려 상대를 자기 진영에 가둡니다.', why: '' },
        { kind: 'shape', text: '한쪽 풀백을 공격으로 올리고 그쪽 집중 공격을 켭니다.', why: '' },
        { kind: 'axis', text: '멘탈리티는 한 칸만 올리세요.', why: '상대가 내려앉은 상태에서 무리하게 열면 역습 한 번에 뒤집힙니다.' }
      ]
    },
    {
      id: 'opp-changed', tier: 'normal', group: '상황',
      when: function (c) { return c.flag('opp-changed'); },
      why: '상대가 형태를 바꿨습니다.',
      items: [
        { kind: 'shape', text: '중원 인원부터 다시 셉니다 — 밀리면 측면 자원 한 명을 중앙으로 내립니다.', why: '' },
        { kind: 'shape', text: '상대가 공격형 미드필더를 새로 세웠다면 수비형 미드필더에게 전담 마크를 붙입니다.', why: '' },
        { kind: 'shape', text: '상대가 스리백으로 바꿨다면 측면 공격수를 상대 윙백 뒤쪽으로 돌립니다.', why: '' },
        { kind: 'shape', text: '상대가 투톱으로 바꿨고 우리 센터백이 둘이라면 수비형 미드필더 한 명을 수비 임무로 내립니다.', why: '' }
      ]
    },
    {
      id: 'tired', tier: 'key', group: '상황',
      when: function (c) { return c.flag('tired'); },
      why: '우리 선수들의 체력이 떨어졌습니다.',
      items: [
        { kind: 'axis', text: '압박 강도와 템포를 한 칸씩 내립니다.', why: '체력이 없는 상태의 압박은 대형만 벌려 놓고 공을 뺏지 못합니다.' },
        { kind: 'sub', text: '활동량이 큰 역할부터 교체합니다 — 볼 위닝 미드필더 · 박스 투 박스 · 프레싱 포워드 · 컴플리트 윙백.', why: '' }
      ]
    },
    {
      id: 'opp-tired', tier: 'normal', group: '상황',
      when: function (c) { return c.flag('opp-tired'); },
      why: '상대 체력이 떨어졌습니다.',
      items: [
        { kind: 'axis', text: '템포와 공격 폭을 올려 상대를 계속 뛰게 합니다.', why: '' },
        { kind: 'sub', text: '체력이 남은 측면 자원을 투입해 1대1을 반복해서 겁니다.', why: '' }
      ]
    },
    {
      id: 'opp-parked', tier: 'key', group: '상황',
      when: function (c) { return c.flag('opp-parked'); },
      why: '상대가 내려앉았습니다.',
      items: [
        { kind: 'axis', text: '공격 폭을 넓혀 상대 블록을 좌우로 늘립니다.', why: '좁은 블록은 옆으로 끌려 나오는 순간 중앙에 틈이 생깁니다.' },
        { kind: 'toggle', text: '박스 안까지 볼 배급을 켜고, 역습 지시는 끕니다.', why: '상대가 이미 내려와 있어 역습으로 쓸 공간이 없습니다.' },
        { kind: 'shape', text: '한쪽 풀백을 공격 임무로 올리고 그쪽 오버랩을 켭니다 — 양쪽을 동시에 올리지 마세요.', why: '' },
        { kind: 'sub', text: '측면에 드리블 돌파형을 넣어 1대1을 만듭니다.', why: '내려앉은 블록은 패스로는 잘 안 열리고 개인 돌파로 열립니다.' }
      ]
    },
    // ── 통계 ──────────────────────────────────────────────────────
    {
      id: 'stat-unlucky', tier: 'key', group: '기록',
      when: function (c) { return c.s && c.us.xg >= 1.2 && c.gf === 0; },
      why: function (c) { return '기대 득점 ' + c.us.xg + '인데 아직 득점이 없습니다.'; },
      items: [
        { kind: 'hold', text: '전술을 바꾸지 마세요.', why: '기회는 만들어지고 있는데 마무리가 안 된 것입니다. 여기서 형태를 뒤집으면 만들고 있던 것까지 잃습니다.' },
        { kind: 'sub', text: '바꾸려면 전술이 아니라 마무리하는 선수를 바꾸세요.', why: '' }
      ]
    },
    {
      id: 'stat-parked-detected', tier: 'key', group: '기록',
      when: function (c) { return c.s && c.us.possession >= 58 && c.us.sot <= 3; },
      why: function (c) { return '점유율 ' + c.us.possession + '%인데 유효 슈팅이 ' + c.us.sot + '개입니다 — 상대가 내려앉아 있습니다.'; },
      items: [
        { kind: 'axis', text: '공격 폭을 한 칸 넓히고 양쪽 오버랩을 켭니다.', why: '공은 갖고 있는데 들어갈 틈이 없다는 뜻이므로, 블록을 옆으로 늘려야 합니다.' },
        { kind: 'toggle', text: '박스 안까지 볼 배급을 켭니다.', why: '' },
        { kind: 'sub', text: '측면 1대1이 되는 드리블러와 박스 안 제공권 자원을 넣습니다.', why: '' }
      ]
    },
    {
      id: 'stat-far-shots', tier: 'key', group: '기록',
      when: function (c) { return c.s && c.us.shots >= 8 && c.us.xg !== null && c.us.xg <= c.us.shots * 0.08; },
      why: function (c) { return '슈팅 ' + c.us.shots + '개에 기대 득점 ' + c.us.xg + ' — 먼 거리에서만 쏘고 있습니다.'; },
      items: [
        { kind: 'toggle', text: '적극적으로 슛을 끄고 박스 안까지 볼 배급을 켭니다.', why: '슈팅 수가 아니라 슈팅 위치가 문제입니다.' },
        { kind: 'shape', text: '중거리 슛이 높은 선수의 개인 지시에서 「더 자주 슛」을 뺍니다.', why: '' }
      ]
    },
    {
      id: 'stat-dominated', tier: 'key', group: '기록',
      when: function (c) { return c.s && c.us.possession <= 42 && c.them.shots >= 8; },
      why: function (c) { return '점유율 ' + c.us.possession + '%에 상대 슈팅 ' + c.them.shots + '개 — 밀리고 있습니다.'; },
      items: [
        { kind: 'axis', text: '압박 시작 위치를 내리고 대형을 낮게 모읍니다.', why: '높은 곳에서 못 뺏는 압박은 대형만 벌려 놓습니다.' },
        { kind: 'toggle', text: '공을 잃으면 재정비로 바꿉니다.', why: '' },
        { kind: 'shape', text: '중원에 한 명을 더 두는 형태로 바꿉니다.', why: '점유율이 이 정도로 낮으면 중원 숫자가 모자란 경우가 대부분입니다.' }
      ]
    },
    {
      id: 'stat-opp-xg', tier: 'key', group: '기록',
      when: function (c) { return c.s && c.them.xg !== null && c.them.xg >= 1.0; },
      why: function (c) { return '상대 기대 득점이 ' + c.them.xg + '입니다 — 좋은 기회를 계속 내주고 있습니다.'; },
      items: [
        { kind: 'axis', text: '수비 라인과 압박 시작 위치를 함께 내립니다.', why: '' },
        { kind: 'shape', text: '수비형 미드필더를 수비 임무로 내리거나 한 명 더 둡니다.', why: '' },
        { kind: 'shape', text: '실점 장면이 측면 크로스에서 나왔다면 안쪽으로 유도를 켜세요.', why: '' }
      ]
    },
    {
      id: 'stat-pass-low', tier: 'normal', group: '기록',
      when: function (c) { return c.s && c.us.passPct !== null && c.us.passPct <= 78; },
      why: function (c) { return '패스 성공률이 ' + c.us.passPct + '%입니다.'; },
      items: [
        { kind: 'axis', text: '패스를 짧게, 템포를 한 칸 내립니다.', why: '성공률이 낮은 상태에서 템포를 올리면 잃는 횟수만 늘어납니다.' },
        { kind: 'toggle', text: '상대가 강하게 압박한다면 후방에서 짧게 시작을 끕니다.', why: '우리 진영에서 잃는 것이 가장 비쌉니다.' }
      ]
    },
    {
      id: 'stat-fouls', tier: 'normal', group: '기록',
      when: function (c) { return c.s && (c.us.fouls >= 10 || c.us.cards >= 2); },
      why: function (c) { return '반칙 ' + c.us.fouls + '회 · 경고 ' + c.us.cards + '장입니다.'; },
      items: [
        { kind: 'axis', text: '태클 강도를 「발 떼지 않기」로 내립니다.', why: '경고가 쌓인 선수가 퇴장당하면 그 뒤는 전술 문제가 아닙니다.' },
        { kind: 'sub', text: '경고를 받은 수비수는 교체를 고려하세요.', why: '' }
      ]
    },
    {
      id: 'stat-corners', tier: 'normal', group: '기록',
      when: function (c) { return c.s && c.us.corners >= 6 && c.gf === 0; },
      why: function (c) { return '코너킥 ' + c.us.corners + '개에서 아직 득점이 없습니다.'; },
      items: [
        { kind: 'toggle', text: '세트피스 노리기를 켜고 제공권 자원을 박스 안에 더 둡니다.', why: '이미 코너를 많이 얻고 있다면 그 경로가 가장 싼 득점 방법입니다.' }
      ]
    },
    {
      id: 'stat-offside', tier: 'normal', group: '기록',
      when: function (c) { return c.s && c.us.offsides !== null && c.us.offsides >= 4; },
      why: function (c) { return '오프사이드가 ' + c.us.offsides + '회입니다.'; },
      items: [
        { kind: 'toggle', text: '공간으로 패스를 끕니다.', why: '뒷공간 침투가 계속 걸리고 있다는 뜻입니다 — 타이밍이 아니라 방법을 바꿔야 합니다.' },
        { kind: 'shape', text: '최전방을 발밑으로 받는 역할(딥 라잉 포워드)로 바꿔 봅니다.', why: '' }
      ]
    },
    {
      id: 'stat-no-shots', tier: 'key', group: '기록',
      when: function (c) { return c.s && c.us.shots <= 3 && c.us.possession >= 48; },
      why: function (c) { return '점유율 ' + c.us.possession + '%인데 슈팅이 ' + c.us.shots + '개뿐입니다 — 공은 갖고 있는데 만들지 못하고 있습니다.'; },
      items: [
        { kind: 'shape', text: '최전방과 2선에 침투하는 역할을 넣습니다(섀도 스트라이커 · 어드밴스드 포워드).', why: '앞으로 달리는 사람이 없으면 패스를 넣을 곳도 없습니다.' },
        { kind: 'axis', text: '패스를 조금 더 직선적으로, 템포를 올립니다.', why: '옆으로만 도는 점유는 상대를 전혀 움직이지 못합니다.' }
      ]
    }
  ];

  // ── 경기 중 시나리오 ──────────────────────────────────────────────────
  var SCENARIOS = [
    {
      id: 'stuck', ko: '0-0으로 흘러가고 후반이 시작될 때',
      when: '전반을 지배했는데 골이 없거나, 상대 블록을 못 여는 상태',
      steps: [
        '멘탈리티를 한 칸만 올립니다(두 칸은 역습 한 방에 무너집니다).',
        '공격 폭을 한 칸 넓혀 상대 블록을 좌우로 늘립니다.',
        '한쪽 풀백을 공격 임무로 올리고 그쪽 오버랩을 켭니다 — 양쪽을 동시에 올리지 마세요.',
        '측면 공격수 한 명을 드리블 돌파형으로 교체해 1대1 상황을 만듭니다.',
        '그래도 안 열리면 박스 안에 제공권 자원을 한 명 넣고 크로스 지시를 켭니다.'
      ]
    },
    {
      id: 'leading-early', ko: '전반에 앞서 나갔을 때',
      when: '20~40분 사이 리드',
      steps: [
        '지금 전술을 그대로 둡니다 — 이른 리드에서 곧바로 내려앉으면 남은 시간이 너무 깁니다.',
        '역압박을 켜서 상대가 전개를 시작하기 전에 끊습니다.',
        '한 골을 더 넣으면 경기가 끝나는 구간이므로 오히려 압박 시작 위치를 유지하세요.'
      ]
    },
    {
      id: 'leading-late', ko: '75분 이후 한 골 차로 앞설 때',
      when: '막판 리드 지키기',
      steps: [
        '멘탈리티를 한 칸 내리고 시간 지연을 올립니다.',
        '수비 라인과 압박 시작 위치를 함께 내립니다 — 라인만 내리면 라인과 압박선 사이가 벌어져 그 공간을 그대로 내줍니다.',
        '공을 잃으면 재정비, 뺏으면 대형 유지로 바꿉니다.',
        '공격 임무 풀백/윙백을 지원이나 수비로 내립니다.',
        '체력이 떨어진 압박형 공격수를 수비 가담이 되는 유형으로 교체합니다.'
      ]
    },
    {
      id: 'trailing', ko: '한 골 뒤진 채 60분을 넘겼을 때',
      when: '따라가야 하는 상황',
      steps: [
        '멘탈리티를 한 칸 올리고 수비 라인·압박 시작 위치를 함께 올립니다.',
        '역압박을 켜서 상대가 시간을 쓰지 못하게 합니다.',
        '수비형 미드필더 한 명을 공격 자원으로 교체합니다 — 다만 한 명까지입니다.',
        '75분이 지나도 그대로면 포메이션을 바꿔 최전방 인원을 늘립니다(4-2-3-1 → 4-2-4 등).',
        '85분 이후에는 얼리 크로스와 세트피스 노리기를 켜고 제공권 자원을 최대한 올립니다.'
      ]
    },
    {
      id: 'two-down', ko: '두 골 이상 뒤질 때',
      when: '전술 자체를 바꿔야 하는 상황',
      steps: [
        '포메이션을 공격형으로 바꿉니다 — 지시만 올리는 것으로는 부족합니다.',
        '멘탈리티는 공격적까지만 올립니다. 매우 공격적은 대형이 흩어져 실점만 늘리는 경우가 많습니다.',
        '수비 라인을 올려 경기장을 압축하고, 실점을 감수합니다.',
        '체력이 남은 선수를 먼저 투입해 마지막 20분의 강도를 확보합니다.'
      ]
    },
    {
      id: 'red-card', ko: '우리가 퇴장으로 수적 열세일 때',
      when: '10명',
      steps: [
        '측면 공격수 한 명을 빼고 그 자리를 수비/미드필드로 메웁니다 — 최전방 한 명은 남겨 두세요(전원 후퇴는 압박을 영구히 허용합니다).',
        '4-4-1 또는 5-3-1 형태로 두 줄을 유지합니다.',
        '멘탈리티를 신중한으로 내리고 수비 라인·압박 시작 위치를 함께 내립니다.',
        '압박 강도를 낮춥니다 — 10명으로 압박하면 곧바로 대형이 찢어집니다.',
        '남은 최전방은 타깃 포워드 계열로 두어 걷어낸 공이 곧바로 되돌아오지 않게 합니다.'
      ]
    },
    {
      id: 'opp-red-card', ko: '상대가 퇴장으로 수적 우위일 때',
      when: '11 vs 10',
      steps: [
        '공격 폭을 넓힙니다 — 10명은 좌우로 늘어나는 것을 가장 못 버팁니다.',
        '수비 라인을 올려 상대를 자기 진영에 가둡니다.',
        '한쪽 풀백을 공격으로 올리고 그쪽 집중 공격을 켭니다.',
        '멘탈리티는 한 칸만 올리세요 — 상대가 내려앉은 상태에서 무리하게 열면 역습 한 번에 뒤집힙니다.'
      ]
    },
    {
      id: 'opp-shape-change', ko: '상대가 포메이션을 바꿨을 때',
      when: '상대가 하프타임 이후 형태를 변경',
      steps: [
        '먼저 중원 인원부터 다시 셉니다 — 우리가 밀리면 측면 자원 한 명을 중앙으로 내립니다.',
        '상대가 공격형 미드필더를 새로 세웠다면 수비형 미드필더에게 전담 마크를 붙입니다.',
        '상대가 스리백으로 바꿨다면 우리 측면 공격수를 상대 윙백 뒤쪽으로 돌립니다.',
        '상대가 투톱으로 바꿨고 우리가 센터백 둘이라면 수비형 미드필더 한 명을 수비 임무로 내립니다.'
      ]
    }
  ];

  root.FM_TACTIC_DATA = {
    AXES: AXES,
    TOGGLES: TOGGLES,
    GROUP_KO: GROUP_KO,
    PLANS: PLANS,
    FM_PRESETS: FM_PRESETS,
    FM_PRESET_BLANK: FM_PRESET_BLANK,
    OPP_TRAITS: OPP_TRAITS,
    RULES: RULES,
    MATCH_PHASES: MATCH_PHASES,
    MATCH_FLAGS: MATCH_FLAGS,
    OPP_LEVELS: OPP_LEVELS,
    FAMILIARITY: FAMILIARITY,
    SLOT_ROLES: SLOT_ROLES,
    CONDITION_BANDS: CONDITION_BANDS,
    DEPTH_TIERS: DEPTH_TIERS,
    MATCH_TAGS: MATCH_TAGS,
    OPP_PRESETS: OPP_PRESETS,
    EXPECTED_PTS: EXPECTED_PTS,
    ODDS_TO_OPP: ODDS_TO_OPP,
    MATCH_RESULTS: MATCH_RESULTS,
    MATCH_STATS: MATCH_STATS,
    INMATCH_RULES: INMATCH_RULES,
    SCENARIOS: SCENARIOS
  };
})(typeof window !== 'undefined' ? window : globalThis);

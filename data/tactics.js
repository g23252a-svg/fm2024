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
      axis: { tempo: 0.5, directness: 0.4 },
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
      axis: { loe: 0.7, press: 0.5 },
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
      axis: { dline: -0.3, press: -0.3 },
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
      axis: { tempo: 0.6, press: 0.5, width: 0.4 },
      plan: { 'press-high': 1 },
      why: '상대 체력이 떨어져 있습니다.',
      action: '템포를 올려 상대를 계속 뛰게 하세요. 60분 이후에 격차가 벌어지므로 그 시점에 쓸 교체 카드를 남겨 두는 게 이 경기의 승부처입니다.'
    },
    {
      id: 'opp-setpiece', group: '상대 성향',
      when: function (o) { return o.traits.indexOf('set-piece-threat') >= 0; },
      axis: { tackling: -0.5 },
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
      axis: { mentality: 0.5, dline: 0.6, width: 0.6 },
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
      id: 'opp-wide', group: '상대 형태',
      when: function (o) { return o.width >= 5; },
      axis: { width: -0.5 },
      role: { 'overload-centre': 0.8 },
      why: '상대가 넓게 섭니다 — 중앙 사이 간격이 벌어져 있습니다.',
      action: '폭을 조금 좁혀 중앙에 사람을 모으세요. 상대가 좌우로 벌어져 있으면 중앙 통과가 오히려 쉽습니다.'
    },

    // ── 우리 상황 ───────────────────────────────────────────────────
    {
      id: 'ctx-away-underdog', group: '경기 상황',
      when: function (o, c) { return c.venue === 'away' && c.odds === 'weak'; },
      axis: { mentality: -0.8, dline: -0.5, press: -0.4, tempo: -0.3 },
      toggle: { regroup: 1, counter: 1.2, pod: -0.6 },
      plan: { counter: 1.6, 'low-block': 1.2 },
      why: '원정이고 전력에서 밀립니다.',
      action: '점유를 포기하고 대형을 지키다 역습을 노리세요. 원정에서 열린 경기를 만들면 전력 차가 그대로 점수 차가 됩니다.'
    },
    {
      id: 'ctx-home-favourite', group: '경기 상황',
      when: function (o, c) { return c.venue === 'home' && c.odds === 'strong'; },
      axis: { mentality: 0.6, dline: 0.5, press: 0.5, loe: 0.4 },
      toggle: { pod: 0.6 },
      plan: { 'press-high': 1, possession: 0.8 },
      why: '홈이고 전력에서 앞섭니다.',
      action: '경기를 상대 진영에 가둬 두세요. 압박 시작 위치를 올리고 라인을 밀어 상대가 우리 진영에 올 일 자체를 줄입니다.'
    },
    {
      id: 'ctx-draw-ok', group: '경기 상황',
      when: function (o, c) { return c.goal === 'draw-ok'; },
      axis: { mentality: -0.5, tempo: -0.3, timewaste: 0.5 },
      toggle: { regroup: 0.8 },
      plan: { 'low-block': 0.8 },
      why: '무승부도 받아들일 수 있는 경기입니다.',
      action: '실점 위험을 먼저 줄이세요. 시간 지연을 올리고 무리한 전진을 줄입니다.'
    },
    {
      id: 'ctx-must-win', group: '경기 상황',
      when: function (o, c) { return c.goal === 'must-win'; },
      axis: { mentality: 0.7, dline: 0.4, press: 0.4, tempo: 0.4, timewaste: -0.5 },
      toggle: { counterpress: 0.8 },
      plan: { 'press-high': 0.8 },
      why: '반드시 이겨야 하는 경기입니다.',
      action: '실점 위험을 감수하고 앞으로 나가세요. 다만 전반부터 다 열지 말고, 되돌릴 수 없는 시점(65분 이후)에 맞춰 단계적으로 올리는 편이 안전합니다.'
    },

    // ── 우리 스쿼드 조건 ────────────────────────────────────────────
    {
      id: 'sq-low-stamina', group: '우리 스쿼드', tier: 'key',
      when: function (o, c, s) { return s.stamina > 0 && s.stamina < 12; },
      axis: { press: -0.8, tempo: -0.5 },
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
    OPP_TRAITS: OPP_TRAITS,
    RULES: RULES,
    SCENARIOS: SCENARIOS
  };
})(typeof window !== 'undefined' ? window : globalThis);

/*
 * FM24 역할 데이터베이스
 *
 * 이 파일은 브라우저에서는 <script>로, 테스트에서는 node vm 컨텍스트로 읽힙니다.
 * 그래서 모듈 시스템 대신 전역 하나(FM_ROLE_DATA)만 노출합니다.
 *
 * 능력치 약어는 FM 커뮤니티 표준(Genie Scout / FMRTE 표기)을 따릅니다.
 * 역할별 key/pref는 게임 안에서 해당 역할을 선택했을 때 강조되는 능력치를 옮긴 것으로,
 * key는 초록(핵심), pref는 그 아래 단계(선호)에 해당합니다.
 */
(function (root) {
  'use strict';

  // ── 능력치 ────────────────────────────────────────────────────────────────
  var ATTR_GROUPS = {
    tec: { ko: '기술', order: 1 },
    men: { ko: '정신', order: 2 },
    phy: { ko: '신체', order: 3 },
    gk: { ko: 'GK', order: 0 }
  };

  // id: [한글명, 그룹]
  var ATTR_TABLE = {
    // 골키퍼 전용
    aer: ['공중 장악', 'gk'],
    cmd: ['지역 장악', 'gk'],
    com: ['의사소통', 'gk'],
    ecc: ['괴짜 기질', 'gk'],
    han: ['핸들링', 'gk'],
    kic: ['킥', 'gk'],
    ono: ['일대일', 'gk'],
    ref: ['반사 신경', 'gk'],
    tro: ['뛰쳐나가기', 'gk'],
    pun: ['펀칭 성향', 'gk'],
    thr: ['던지기', 'gk'],
    // 기술
    cor: ['코너킥', 'tec'],
    cro: ['크로스', 'tec'],
    dri: ['드리블', 'tec'],
    fin: ['마무리', 'tec'],
    fir: ['퍼스트 터치', 'tec'],
    fre: ['프리킥', 'tec'],
    hea: ['헤딩', 'tec'],
    lon: ['중거리 슛', 'tec'],
    lth: ['롱 스로인', 'tec'],
    mar: ['마크', 'tec'],
    pas: ['패스', 'tec'],
    pen: ['페널티킥', 'tec'],
    tck: ['태클', 'tec'],
    tec: ['테크닉', 'tec'],
    // 정신
    agg: ['적극성', 'men'],
    ant: ['예측력', 'men'],
    bra: ['용맹성', 'men'],
    cmp: ['침착성', 'men'],
    cnt: ['집중력', 'men'],
    dec: ['판단력', 'men'],
    det: ['결단력', 'men'],
    fla: ['개인기', 'men'],
    ldr: ['리더십', 'men'],
    otb: ['오프더볼', 'men'],
    pos: ['위치 선정', 'men'],
    tea: ['팀워크', 'men'],
    vis: ['시야', 'men'],
    wor: ['활동량', 'men'],
    // 신체
    acc: ['가속도', 'phy'],
    agi: ['민첩성', 'phy'],
    bal: ['균형 감각', 'phy'],
    jum: ['점프 도달력', 'phy'],
    nat: ['자연 체력', 'phy'],
    pac: ['속도', 'phy'],
    sta: ['스태미너', 'phy'],
    str: ['몸싸움', 'phy']
  };

  var ATTRS = {};
  Object.keys(ATTR_TABLE).forEach(function (id) {
    ATTRS[id] = { id: id, ko: ATTR_TABLE[id][0], group: ATTR_TABLE[id][1] };
  });

  // ── 포지션 ────────────────────────────────────────────────────────────────
  // FM의 포지션 칸. side는 좌우 구분, line은 세로 라인(0=GK … 5=ST).
  var POSITIONS = [
    { id: 'GK', ko: 'GK', line: 0, side: 'c' },
    { id: 'DR', ko: 'D(R)', line: 1, side: 'r' },
    { id: 'DC', ko: 'D(C)', line: 1, side: 'c' },
    { id: 'DL', ko: 'D(L)', line: 1, side: 'l' },
    { id: 'WBR', ko: 'WB(R)', line: 2, side: 'r' },
    { id: 'DM', ko: 'DM', line: 2, side: 'c' },
    { id: 'WBL', ko: 'WB(L)', line: 2, side: 'l' },
    { id: 'MR', ko: 'M(R)', line: 3, side: 'r' },
    { id: 'MC', ko: 'M(C)', line: 3, side: 'c' },
    { id: 'ML', ko: 'M(L)', line: 3, side: 'l' },
    { id: 'AMR', ko: 'AM(R)', line: 4, side: 'r' },
    { id: 'AMC', ko: 'AM(C)', line: 4, side: 'c' },
    { id: 'AML', ko: 'AM(L)', line: 4, side: 'l' },
    { id: 'ST', ko: 'ST(C)', line: 5, side: 'c' }
  ];

  // ── 임무(Duty) ────────────────────────────────────────────────────────────
  var DUTIES = {
    d: { ko: '수비', abbr: '수', attackWeight: 0 },
    st: { ko: '스토퍼', abbr: '스', attackWeight: 0.15 },
    co: { ko: '커버', abbr: '커', attackWeight: 0 },
    s: { ko: '지원', abbr: '지', attackWeight: 0.5 },
    a: { ko: '공격', abbr: '공', attackWeight: 1 }
  };

  /*
   * 역할 정의
   *   pos      : 배치 가능한 포지션 칸
   *   duties   : 선택 가능한 임무
   *   key/pref : 공통 강조 능력치
   *   dutyKey  : 특정 임무에서만 추가로 강조되는 능력치
   *   tags     : 엔진이 전술 계획과 역할을 맞출 때 쓰는 성격 표
   *   locked   : 역할이 자동으로 켜는(끌 수 없는) 개인 지시
   */
  var ROLES = [
    // ── GK ──────────────────────────────────────────────────────────────
    {
      id: 'gk', ko: '골키퍼', abbr: 'GK', en: 'Goalkeeper',
      pos: ['GK'], duties: ['d'],
      key: ['aer', 'cmd', 'han', 'ono', 'ref', 'cnt', 'pos', 'agi'],
      pref: ['com', 'kic', 'dec', 'ant', 'bra'],
      tags: ['keeper', 'safe-keeper'],
      note: '골문 안에 머무릅니다. 뒷공간을 정리하지 않으므로 수비 라인을 높게 올릴 때는 위험합니다.'
    },
    {
      id: 'sk', ko: '스위퍼 키퍼', abbr: 'SK', en: 'Sweeper Keeper',
      req: { tro: 12, cmd: 11 },
      pos: ['GK'], duties: ['d', 's', 'a'],
      key: ['cmd', 'ono', 'ref', 'ant', 'cnt', 'dec', 'pos', 'agi', 'tro', 'kic'],
      pref: ['com', 'han', 'fir', 'pas', 'thr', 'cmp', 'vis', 'acc', 'ecc'],
      dutyKey: { s: ['fir', 'pas'], a: ['fir', 'pas', 'vis', 'cmp', 'tec'] },
      tags: ['keeper', 'sweeper', 'buildout'],
      note: '수비 라인 뒤 공간을 정리합니다. 높은 라인을 쓸 때 사실상 필수이고, 임무가 올라갈수록 빌드업에 더 관여합니다.'
    },

    // ── 센터백 ──────────────────────────────────────────────────────────
    {
      id: 'cd', ko: '센터백', abbr: 'CD', en: 'Central Defender',
      pos: ['DC'], duties: ['d', 'st', 'co'],
      key: ['mar', 'tck', 'hea', 'pos', 'cnt', 'dec', 'str', 'jum'],
      pref: ['ant', 'bra', 'agg', 'cmp', 'tea', 'pac'],
      dutyKey: { st: ['agg', 'bra', 'ant'], co: ['ant', 'pac', 'acc'] },
      tags: ['stopper', 'aerial'],
      note: '가장 무난한 센터백. 스토퍼는 앞으로 나가 끊고, 커버는 뒤를 지킵니다. 둘을 섞어 쓰는 조합이 안정적입니다.'
    },
    {
      id: 'bpd', ko: '볼 플레잉 디펜더', abbr: 'BPD', en: 'Ball Playing Defender',
      req: { pas: 11, cmp: 10, tec: 10 },
      pos: ['DC'], duties: ['d', 'st', 'co'],
      key: ['mar', 'tck', 'hea', 'pos', 'cnt', 'dec', 'cmp', 'pas', 'tec', 'fir', 'str', 'jum'],
      pref: ['ant', 'vis', 'bra', 'agg', 'tea', 'pac'],
      dutyKey: { st: ['agg', 'bra', 'ant'], co: ['ant', 'pac', 'acc'] },
      tags: ['stopper', 'aerial', 'buildout', 'creator-deep'],
      note: '후방에서 전진 패스를 시도합니다. 판단력·침착성이 낮으면 위험 지역에서 공을 잃습니다.'
    },
    {
      id: 'ncb', ko: '노 넌센스 센터백', abbr: 'NCB', en: 'No-Nonsense Centre Back',
      pos: ['DC'], duties: ['d', 'st', 'co'],
      key: ['mar', 'tck', 'hea', 'pos', 'cnt', 'str', 'jum', 'bra'],
      pref: ['agg', 'ant', 'dec', 'pac'],
      dutyKey: { st: ['agg', 'bra', 'ant'], co: ['ant', 'pac', 'acc'] },
      tags: ['stopper', 'aerial', 'clearance'],
      locked: ['위험할 때 무조건 걷어내기'],
      note: '기술이 부족한 수비수에게 어울립니다. 빌드업에는 관여하지 않으므로 후방 짧은 패스와 함께 쓰면 상충합니다.'
    },
    {
      id: 'lib', ko: '리베로', abbr: 'L', en: 'Libero',
      req: { pas: 13, tec: 12, dec: 13 },
      pos: ['DC'], duties: ['d', 's'],
      key: ['mar', 'tck', 'hea', 'pos', 'cnt', 'dec', 'cmp', 'pas', 'fir', 'tec', 'tea', 'sta'],
      pref: ['ant', 'vis', 'otb', 'dri', 'str', 'jum', 'pac', 'wor'],
      dutyKey: { s: ['otb', 'dri', 'vis'] },
      tags: ['buildout', 'creator-deep', 'stamina'],
      requiresBackLine: 3,
      note: '스리백 가운데에서 미드필드로 올라가 수적 우위를 만듭니다. 스리백이 아니면 선택할 수 없고, 올라간 자리를 누가 메울지 정해두어야 합니다.'
    },
    {
      id: 'wcb', ko: '와이드 센터백', abbr: 'WCB', en: 'Wide Centre Back',
      req: { sta: 13, wor: 12 },
      pos: ['DC'], duties: ['d', 's', 'a'],
      key: ['mar', 'tck', 'hea', 'pos', 'cnt', 'dec', 'str', 'jum', 'wor', 'sta'],
      pref: ['ant', 'cro', 'dri', 'pas', 'fir', 'otb', 'tea', 'pac', 'acc'],
      dutyKey: { s: ['cro', 'dri', 'otb'], a: ['cro', 'dri', 'otb', 'pas', 'acc', 'pac', 'fir'] },
      tags: ['aerial', 'width-half'],
      requiresBackLine: 3, wideOnly: true,
      note: '스리백의 좌우 센터백이 측면으로 전진합니다. 윙백과 함께 올라가면 측면 뒷공간이 크게 열립니다.'
    },

    // ── 풀백 / 윙백 ─────────────────────────────────────────────────────
    {
      id: 'fb', ko: '풀백', abbr: 'FB', en: 'Full Back',
      pos: ['DR', 'DL'], duties: ['d', 's', 'a'],
      key: ['mar', 'tck', 'pos', 'ant', 'cnt', 'tea', 'wor', 'dec'],
      pref: ['cro', 'pas', 'fir', 'tec', 'otb', 'sta', 'pac', 'acc', 'agi'],
      dutyKey: { s: ['cro', 'otb', 'sta'], a: ['cro', 'dri', 'otb', 'sta', 'pac', 'acc'] },
      tags: ['width', 'defensive-cover'],
      note: '수비 임무는 라인을 지키고, 공격 임무는 윙어를 추월합니다. 상대 역습이 무서우면 최소 한쪽은 수비로 둡니다.'
    },
    {
      id: 'nfb', ko: '노 넌센스 풀백', abbr: 'NFB', en: 'No-Nonsense Full Back',
      pos: ['DR', 'DL'], duties: ['d'],
      key: ['mar', 'tck', 'pos', 'ant', 'cnt', 'str', 'bra', 'wor'],
      pref: ['agg', 'tea', 'dec', 'jum', 'sta', 'pac'],
      tags: ['defensive-cover', 'clearance'],
      locked: ['위험할 때 무조건 걷어내기'],
      note: '측면을 잠그는 데만 집중합니다. 공격 가담이 거의 없어 그쪽 측면 공격은 윙어 혼자 책임집니다.'
    },
    {
      id: 'ifb', ko: '인버티드 풀백', abbr: 'IFB', en: 'Inverted Full Back',
      req: { hea: 11, pos: 12 },
      pos: ['DR', 'DL'], duties: ['d', 's'],
      key: ['mar', 'tck', 'pos', 'hea', 'ant', 'cnt', 'dec', 'cmp', 'tea', 'str'],
      pref: ['pas', 'fir', 'tec', 'agi', 'jum', 'wor'],
      dutyKey: { s: ['pas', 'fir', 'tec', 'vis'] },
      tags: ['inverted', 'defensive-cover', 'buildout', 'narrow'],
      note: '공을 잡으면 안쪽으로 좁혀 세 번째 센터백처럼 섭니다. 측면 폭이 사라지므로 그쪽 윙어는 반드시 넓게 서야 합니다.'
    },
    {
      id: 'wb', ko: '윙백', abbr: 'WB', en: 'Wing Back',
      req: { sta: 14, wor: 13 },
      pos: ['DR', 'DL', 'WBR', 'WBL'], duties: ['d', 's', 'a'],
      key: ['cro', 'dri', 'tck', 'mar', 'otb', 'tea', 'wor', 'sta', 'pac', 'acc'],
      pref: ['fir', 'tec', 'pas', 'ant', 'pos', 'dec', 'agi', 'bal', 'cnt'],
      dutyKey: { a: ['cro', 'dri', 'otb', 'fla'] },
      tags: ['width', 'stamina', 'overlap'],
      note: '측면을 위아래로 오갑니다. 스태미너가 전부라고 봐도 됩니다 — 70 아래면 후반에 사라집니다.'
    },
    {
      id: 'cwb', ko: '컴플리트 윙백', abbr: 'CWB', en: 'Complete Wing Back',
      req: { sta: 15, wor: 14, pac: 13 },
      pos: ['DR', 'DL', 'WBR', 'WBL'], duties: ['s', 'a'],
      key: ['cro', 'dri', 'fir', 'pas', 'tec', 'otb', 'dec', 'tea', 'wor', 'sta', 'pac', 'acc', 'agi', 'bal'],
      pref: ['tck', 'mar', 'ant', 'fla', 'cmp', 'vis'],
      tags: ['width', 'stamina', 'overlap', 'creator', 'risk-back'],
      note: '측면 공격의 주축이 됩니다. 수비 복귀가 늦으므로 뒤를 받칠 수비형 미드필더나 스리백이 사실상 필요합니다.'
    },
    {
      id: 'iwb', ko: '인버티드 윙백', abbr: 'IWB', en: 'Inverted Wing Back',
      req: { pas: 12, tec: 11 },
      pos: ['DR', 'DL', 'WBR', 'WBL'], duties: ['d', 's', 'a'],
      key: ['mar', 'tck', 'pas', 'fir', 'tec', 'cmp', 'dec', 'pos', 'tea', 'wor', 'ant', 'agi', 'sta'],
      pref: ['dri', 'vis', 'otb', 'cnt', 'bal', 'acc'],
      dutyKey: { a: ['otb', 'dri', 'vis', 'lon'] },
      tags: ['inverted', 'narrow', 'buildout', 'overload-centre'],
      note: '측면이 아니라 중앙으로 들어와 미드필드 수를 늘립니다. 상대 중원이 셋 이상일 때 유효하고, 폭은 윙어가 전담합니다.'
    },

    // ── 수비형 미드필더 ─────────────────────────────────────────────────
    {
      id: 'dm', ko: '수비형 미드필더', abbr: 'DM', en: 'Defensive Midfielder',
      pos: ['DM'], duties: ['d', 's'],
      key: ['tck', 'mar', 'pos', 'ant', 'cnt', 'tea', 'wor', 'cmp', 'dec'],
      pref: ['pas', 'fir', 'agg', 'str', 'sta', 'bra'],
      dutyKey: { s: ['pas', 'fir', 'vis'] },
      tags: ['holder', 'ballwinner', 'defensive-cover'],
      note: '수비 라인 앞을 지키는 기본형. 특별한 색은 없지만 어떤 조합에도 어긋나지 않습니다.'
    },
    {
      id: 'anc', ko: '앵커맨', abbr: 'A', en: 'Anchor Man',
      req: { pos: 13, cnt: 12 },
      pos: ['DM'], duties: ['d'],
      key: ['mar', 'tck', 'pos', 'ant', 'cnt', 'dec', 'tea', 'cmp'],
      pref: ['str', 'pas', 'agg', 'jum', 'bra'],
      tags: ['holder', 'defensive-cover', 'no-roam'],
      locked: ['위치 유지'],
      note: '절대 자리를 비우지 않습니다. 상대 역습과 침투형 공격형 미드필더를 막는 가장 안전한 선택입니다.'
    },
    {
      id: 'hb', ko: '하프백', abbr: 'HB', en: 'Half Back',
      req: { pos: 12, ant: 12 },
      pos: ['DM'], duties: ['d'],
      key: ['mar', 'tck', 'pos', 'ant', 'cnt', 'dec', 'tea', 'wor', 'cmp'],
      pref: ['pas', 'fir', 'sta', 'str', 'agg', 'bra'],
      tags: ['holder', 'defensive-cover', 'buildout', 'backline-drop'],
      note: '수비 시 센터백 사이로 내려가 백3을 만듭니다. 양쪽 풀백을 동시에 올리고 싶을 때 뒤를 메워 줍니다.'
    },
    {
      id: 'bwm', ko: '볼 위닝 미드필더', abbr: 'BWM', en: 'Ball Winning Midfielder',
      req: { agg: 12, wor: 13, sta: 13 },
      pos: ['DM', 'MC'], duties: ['d', 's'],
      key: ['tck', 'agg', 'ant', 'tea', 'wor', 'sta', 'bra', 'dec', 'pos'],
      pref: ['mar', 'cnt', 'str', 'pac', 'acc', 'cmp', 'pas'],
      tags: ['ballwinner', 'presser', 'stamina'],
      locked: ['강하게 태클', '더 많이 압박'],
      note: '공을 뺏는 데 전념합니다. 적극성이 높고 판단력이 낮으면 경고를 자주 받습니다.'
    },
    {
      id: 'dlp', ko: '딥 라잉 플레이메이커', abbr: 'DLP', en: 'Deep Lying Playmaker',
      req: { pas: 13, vis: 12 },
      pos: ['DM', 'MC'], duties: ['d', 's'],
      key: ['pas', 'fir', 'tec', 'vis', 'dec', 'cmp', 'tea', 'ant'],
      pref: ['pos', 'cnt', 'otb', 'bal', 'agi', 'mar', 'tck'],
      dutyKey: { d: ['pos', 'cnt', 'mar', 'tck'], s: ['otb'] },
      tags: ['creator-deep', 'buildout', 'playmaker', 'no-roam'],
      note: '후방에서 경기를 조립합니다. 팀 패스가 이쪽으로 몰리므로 상대가 이 선수를 마크하면 빌드업이 통째로 막힙니다.'
    },
    {
      id: 'reg', ko: '레지스타', abbr: 'RGA', en: 'Regista',
      req: { pas: 14, vis: 14, cmp: 13 },
      pos: ['DM'], duties: ['s'],
      key: ['pas', 'fir', 'tec', 'vis', 'dec', 'cmp', 'fla', 'otb', 'ant', 'dri'],
      pref: ['tea', 'agi', 'bal', 'lon', 'wor'],
      tags: ['creator-deep', 'playmaker', 'roam', 'risk-pass'],
      note: '딥 라잉 플레이메이커보다 훨씬 공격적으로 움직이고 위험한 패스를 시도합니다. 뒤를 받치는 수비가 없으면 역습에 그대로 노출됩니다.'
    },
    {
      id: 'rpm', ko: '로밍 플레이메이커', abbr: 'RPM', en: 'Roaming Playmaker',
      req: { sta: 14, wor: 14, pas: 13 },
      pos: ['DM', 'MC'], duties: ['s'],
      key: ['pas', 'fir', 'tec', 'dri', 'vis', 'dec', 'cmp', 'ant', 'otb', 'tea', 'wor', 'sta'],
      pref: ['acc', 'agi', 'bal', 'fla', 'pos'],
      tags: ['creator-deep', 'playmaker', 'roam', 'stamina'],
      locked: ['자유롭게 이동'],
      note: '공을 받으러 어디든 갑니다. 활동량과 스태미너가 낮으면 성립하지 않고, 자리를 비우므로 옆의 미드필더가 균형을 잡아야 합니다.'
    },
    {
      id: 'sv', ko: '세군도 볼란테', abbr: 'SV', en: 'Segundo Volante',
      req: { sta: 14, wor: 13, otb: 12 },
      pos: ['DM'], duties: ['s', 'a'],
      key: ['pas', 'fir', 'tck', 'otb', 'ant', 'dec', 'wor', 'pos', 'tea', 'sta', 'str'],
      pref: ['lon', 'fin', 'mar', 'cmp', 'acc', 'pac', 'dri'],
      dutyKey: { a: ['fin', 'lon', 'dri', 'acc', 'pac'] },
      tags: ['runner', 'ballwinner', 'stamina', 'late-run'],
      note: '수비형 미드필더 자리에서 출발해 공격 시 박스까지 침투합니다. 스리백이나 다른 수비형 미드필더와 짝지어야 뒤가 빕니다.'
    },

    // ── 중앙 미드필더 ───────────────────────────────────────────────────
    {
      id: 'cm', ko: '중앙 미드필더', abbr: 'CM', en: 'Central Midfielder',
      pos: ['MC'], duties: ['d', 's', 'a'],
      key: ['pas', 'fir', 'tck', 'dec', 'tea', 'wor', 'cmp', 'sta'],
      pref: ['ant', 'pos', 'otb', 'tec', 'vis', 'mar', 'agg', 'lon'],
      dutyKey: { d: ['pos', 'mar', 'ant', 'cnt'], a: ['otb', 'lon', 'vis', 'fin'] },
      tags: ['balanced', 'link'],
      note: '색이 옅은 대신 어디에도 어긋나지 않습니다. 양옆 역할이 강할 때 균형추로 씁니다.'
    },
    {
      id: 'b2b', ko: '박스 투 박스 미드필더', abbr: 'BBM', en: 'Box to Box Midfielder',
      req: { sta: 14, wor: 14 },
      pos: ['MC'], duties: ['s'],
      key: ['pas', 'fir', 'tck', 'otb', 'ant', 'dec', 'tea', 'wor', 'pos', 'sta', 'str'],
      pref: ['lon', 'fin', 'dri', 'cmp', 'acc', 'pac', 'bal', 'agg'],
      tags: ['runner', 'link', 'stamina', 'late-run', 'presser'],
      note: '위아래를 전부 뜁니다. 스태미너·활동량이 둘 다 높지 않으면 어느 쪽에서도 제 몫을 못 합니다.'
    },
    {
      id: 'ap', ko: '어드밴스드 플레이메이커', abbr: 'AP', en: 'Advanced Playmaker',
      req: { pas: 13, vis: 12 },
      pos: ['MC', 'AMC', 'AMR', 'AML'], duties: ['s', 'a'],
      key: ['pas', 'fir', 'tec', 'vis', 'dec', 'cmp', 'otb', 'ant', 'tea'],
      pref: ['dri', 'fla', 'agi', 'bal', 'lon', 'wor'],
      dutyKey: { a: ['dri', 'fla', 'acc'] },
      tags: ['creator', 'playmaker', 'link'],
      note: '공격 지역의 패스 중심입니다. 팀이 이 선수를 계속 찾으므로 상대가 전담 마크를 붙이면 대안을 준비해야 합니다.'
    },
    {
      id: 'mez', ko: '메짤라', abbr: 'MEZ', en: 'Mezzala',
      req: { dri: 11, otb: 12, sta: 13 },
      pos: ['MC'], duties: ['s', 'a'],
      key: ['pas', 'fir', 'tec', 'dri', 'otb', 'vis', 'dec', 'wor', 'ant', 'sta'],
      pref: ['fla', 'cmp', 'lon', 'fin', 'acc', 'agi', 'bal', 'tea'],
      dutyKey: { a: ['fin', 'lon', 'fla', 'acc'] },
      tags: ['runner', 'creator', 'half-space', 'wide-drift'],
      requiresSideMC: true,
      note: '중앙에서 옆 하프 스페이스로 벌려 나갑니다. 그 측면 풀백이 오버랩할 공간을 열어 주지만, 중앙 한 칸이 비므로 반대편은 안정적인 역할이어야 합니다.'
    },
    {
      id: 'car', ko: '카릴레로', abbr: 'CAR', en: 'Carrilero',
      req: { wor: 12, tea: 12 },
      pos: ['MC'], duties: ['s'],
      key: ['pas', 'fir', 'tck', 'dec', 'tea', 'wor', 'pos', 'ant', 'cmp', 'sta'],
      pref: ['mar', 'tec', 'cnt', 'otb', 'agi'],
      tags: ['link', 'half-space', 'defensive-cover', 'no-roam'],
      requiresSideMC: true,
      note: '중앙과 측면 사이 빈칸을 메웁니다. 윙어가 없는 다이아몬드나 4-3-3에서 측면 수비 부담을 나눠 집니다.'
    },

    // ── 측면 미드필더 ───────────────────────────────────────────────────
    {
      id: 'wm', ko: '와이드 미드필더', abbr: 'WM', en: 'Wide Midfielder',
      pos: ['MR', 'ML'], duties: ['d', 's', 'a'],
      key: ['cro', 'pas', 'fir', 'tck', 'dec', 'tea', 'wor', 'sta', 'otb'],
      pref: ['ant', 'mar', 'cnt', 'tec', 'pos', 'dri', 'cmp'],
      dutyKey: { d: ['mar', 'pos', 'cnt', 'ant'], a: ['dri', 'otb', 'acc'] },
      tags: ['width', 'link', 'defensive-cover'],
      note: '측면에서 수비와 공격을 절반씩 합니다. 4-4-2의 기본이고, 풀백 혼자 측면을 감당하지 않게 해 줍니다.'
    },
    {
      id: 'w', ko: '윙어', abbr: 'W', en: 'Winger',
      req: { acc: 12, pac: 12 },
      pos: ['MR', 'ML', 'AMR', 'AML'], duties: ['s', 'a'],
      key: ['cro', 'dri', 'tec', 'fir', 'otb', 'wor', 'ant', 'acc', 'pac', 'agi'],
      pref: ['pas', 'fla', 'bal', 'sta', 'dec', 'cmp'],
      dutyKey: { a: ['fla', 'otb'] },
      tags: ['width', 'dribbler', 'crosser', 'pace'],
      note: '측면을 끝까지 파고들어 크로스합니다. 박스 안에 헤딩으로 받아 줄 선수가 없으면 크로스가 낭비됩니다.'
    },
    {
      id: 'dw', ko: '디펜시브 윙어', abbr: 'DW', en: 'Defensive Winger',
      req: { wor: 14, sta: 14 },
      pos: ['MR', 'ML', 'AMR', 'AML'], duties: ['d', 's'],
      key: ['cro', 'dri', 'tck', 'mar', 'pos', 'ant', 'cnt', 'tea', 'wor', 'sta', 'dec'],
      pref: ['pas', 'fir', 'tec', 'acc', 'pac', 'agg', 'otb'],
      tags: ['width', 'presser', 'defensive-cover', 'stamina'],
      note: '상대 풀백·윙백을 따라다니며 묶습니다. 상대 측면 공격이 강하고 우리 풀백이 혼자 감당하기 힘들 때 씁니다.'
    },
    {
      id: 'wp', ko: '와이드 플레이메이커', abbr: 'WP', en: 'Wide Playmaker',
      req: { pas: 13, vis: 12 },
      pos: ['MR', 'ML', 'AMR', 'AML'], duties: ['s', 'a'],
      key: ['pas', 'fir', 'tec', 'vis', 'dec', 'cmp', 'otb', 'tea', 'dri', 'ant'],
      pref: ['cro', 'fla', 'agi', 'bal', 'acc', 'wor'],
      tags: ['creator', 'playmaker', 'narrow-drift', 'inverted'],
      note: '측면에서 안쪽으로 들어와 경기를 조립합니다. 폭을 포기하므로 그쪽 풀백이 반드시 오버랩해야 합니다.'
    },
    {
      id: 'iw', ko: '인버티드 윙어', abbr: 'IW', en: 'Inverted Winger',
      req: { dri: 12, tec: 12 },
      pos: ['MR', 'ML', 'AMR', 'AML'], duties: ['s', 'a'],
      key: ['cro', 'dri', 'pas', 'fir', 'tec', 'otb', 'ant', 'dec', 'acc', 'pac', 'agi'],
      pref: ['vis', 'fla', 'wor', 'lon', 'bal', 'cmp'],
      dutyKey: { a: ['lon', 'fin', 'fla'] },
      tags: ['inverted', 'creator', 'dribbler', 'narrow-drift'],
      locked: ['안쪽으로 접어 들어가기'],
      note: '반대발 윙어가 안쪽으로 접어 들어와 패스와 슛을 노립니다. 인사이드 포워드보다 얕게 서서 연결에 더 관여합니다.'
    },

    // ── 측면 공격수 ─────────────────────────────────────────────────────
    {
      id: 'if', ko: '인사이드 포워드', abbr: 'IF', en: 'Inside Forward',
      req: { acc: 13, pac: 13, dri: 12 },
      pos: ['AMR', 'AML'], duties: ['s', 'a'],
      key: ['dri', 'fin', 'fir', 'tec', 'otb', 'ant', 'fla', 'cmp', 'dec', 'acc', 'pac', 'agi', 'bal'],
      pref: ['pas', 'vis', 'lon', 'wor', 'sta'],
      dutyKey: { a: ['fin', 'otb'] },
      tags: ['inverted', 'finisher', 'dribbler', 'pace', 'narrow-drift'],
      locked: ['안쪽으로 접어 들어가기'],
      note: '반대발 선수가 안쪽으로 파고들어 직접 마무리합니다. 측면 폭이 사라지므로 그쪽 풀백은 공격 임무여야 합니다.'
    },
    {
      id: 'rd', ko: '라움도이터', abbr: 'RMD', en: 'Raumdeuter',
      req: { otb: 13, ant: 12 },
      pos: ['AMR', 'AML'], duties: ['a'],
      key: ['fin', 'otb', 'ant', 'cmp', 'dec', 'cnt', 'bal', 'acc', 'pac', 'agi', 'fir', 'tec'],
      pref: ['dri', 'hea', 'jum', 'wor'],
      tags: ['finisher', 'poacher-wide', 'no-defence', 'narrow-drift'],
      locked: ['자유롭게 이동', '적게 압박'],
      note: '수비에 거의 가담하지 않고 반대편 박스 안 빈 공간에서 기다립니다. 그쪽 측면 수비는 풀백 혼자 감당해야 합니다.'
    },
    {
      id: 'wtf', ko: '와이드 타깃 포워드', abbr: 'WTF', en: 'Wide Target Forward',
      req: { hea: 12, jum: 12 },
      pos: ['AMR', 'AML'], duties: ['s', 'a'],
      key: ['hea', 'fir', 'bra', 'tea', 'otb', 'ant', 'wor', 'jum', 'str', 'bal'],
      pref: ['fin', 'agg', 'cmp', 'dec', 'pas'],
      tags: ['target', 'aerial', 'outlet'],
      note: '측면에서 롱볼을 받아 지켜 줍니다. 압박이 심한 상대에게서 탈출구를 만들 때 유효합니다.'
    },

    // ── 공격형 미드필더 ─────────────────────────────────────────────────
    {
      id: 'am', ko: '공격형 미드필더', abbr: 'AM', en: 'Attacking Midfielder',
      pos: ['AMC'], duties: ['s', 'a'],
      key: ['pas', 'fir', 'tec', 'lon', 'dri', 'otb', 'ant', 'dec', 'fla', 'cmp', 'vis', 'agi'],
      pref: ['fin', 'bal', 'acc', 'wor'],
      dutyKey: { a: ['fin', 'otb'] },
      tags: ['creator', 'link', 'shooter'],
      note: '중앙 2선의 기본형. 창조와 마무리를 절반씩 하고 특정 성향에 치우치지 않습니다.'
    },
    {
      id: 'treq', ko: '트레콰르티스타', abbr: 'TQ', en: 'Trequartista',
      req: { tec: 14, fla: 12, dri: 13 },
      pos: ['AMC', 'AMR', 'AML', 'ST'], duties: ['a'],
      key: ['dri', 'fin', 'fir', 'pas', 'tec', 'otb', 'ant', 'cmp', 'dec', 'fla', 'vis', 'agi', 'bal'],
      pref: ['lon', 'acc', 'pac'],
      tags: ['creator', 'finisher', 'roam', 'no-defence'],
      locked: ['적게 압박', '자유롭게 이동'],
      note: '수비 부담을 완전히 면제받는 대신 공격에서 자유롭게 움직입니다. 나머지 열 명이 수비 부담을 나눠 져야 성립합니다.'
    },
    {
      id: 'ss', ko: '섀도 스트라이커', abbr: 'SS', en: 'Shadow Striker',
      req: { otb: 13, acc: 13 },
      pos: ['AMC'], duties: ['a'],
      key: ['fin', 'fir', 'dri', 'tec', 'otb', 'ant', 'cmp', 'dec', 'wor', 'acc', 'pac', 'agi', 'bal'],
      pref: ['pas', 'lon', 'sta', 'fla'],
      tags: ['runner', 'finisher', 'late-run', 'presser'],
      note: '공격수보다 뒤에서 출발해 박스로 침투합니다. 앞의 공격수가 수비를 끌어 주는 유형(딥 라잉 포워드·타깃 포워드)일 때 가장 잘 맞습니다.'
    },
    {
      id: 'eng', ko: '엥간체', abbr: 'ENG', en: 'Enganche',
      req: { pas: 14, vis: 14 },
      pos: ['AMC'], duties: ['s'],
      key: ['pas', 'fir', 'tec', 'vis', 'dec', 'cmp', 'fla', 'tea', 'ant'],
      pref: ['dri', 'agi', 'bal', 'otb'],
      tags: ['creator', 'playmaker', 'no-roam', 'no-defence', 'static'],
      locked: ['위치 유지', '적게 압박'],
      note: '움직이지 않고 공을 받아 뿌리는 고전적 10번입니다. 주변에 뛰어 줄 선수가 세 명은 있어야 하고, 압박이 강한 상대에게는 고립됩니다.'
    },

    // ── 스트라이커 ──────────────────────────────────────────────────────
    {
      id: 'af', ko: '어드밴스드 포워드', abbr: 'AF', en: 'Advanced Forward',
      req: { pac: 13, acc: 13 },
      pos: ['ST'], duties: ['a'],
      key: ['fin', 'dri', 'fir', 'tec', 'cmp', 'otb', 'ant', 'dec', 'wor', 'acc', 'pac', 'agi', 'bal'],
      pref: ['pas', 'sta', 'fla', 'str'],
      tags: ['runner', 'finisher', 'pace', 'in-behind', 'presser'],
      note: '상대 최종 수비 라인을 계속 밀어붙이며 뒷공간을 노립니다. 상대 수비 라인이 높을 때 가장 강력합니다.'
    },
    {
      id: 'poa', ko: '포처', abbr: 'P', en: 'Poacher',
      req: { fin: 13, otb: 12 },
      pos: ['ST'], duties: ['a'],
      key: ['fin', 'fir', 'otb', 'ant', 'cmp', 'dec', 'cnt', 'tec'],
      pref: ['hea', 'acc', 'pac', 'bal', 'jum'],
      tags: ['finisher', 'in-behind', 'no-defence', 'static'],
      locked: ['적게 압박'],
      note: '박스 안에만 머뭅니다. 연결에 관여하지 않으므로 2선에서 기회를 만들어 줄 선수가 반드시 필요합니다.'
    },
    {
      id: 'cf', ko: '컴플리트 포워드', abbr: 'CF', en: 'Complete Forward',
      req: { fin: 13, tec: 13, otb: 13, str: 12 },
      pos: ['ST'], duties: ['s', 'a'],
      key: ['fin', 'dri', 'fir', 'hea', 'pas', 'tec', 'otb', 'ant', 'cmp', 'dec', 'vis', 'wor', 'acc', 'pac', 'agi', 'bal', 'jum', 'str'],
      pref: ['lon', 'tea', 'sta', 'fla'],
      tags: ['finisher', 'target', 'creator', 'runner', 'aerial'],
      note: '모든 걸 다 하는 대신 모든 능력치가 다 높아야 합니다. 웬만한 선수는 요구치를 못 맞춥니다.'
    },
    {
      id: 'dlf', ko: '딥 라잉 포워드', abbr: 'DLF', en: 'Deep Lying Forward',
      req: { fir: 12, pas: 12 },
      pos: ['ST'], duties: ['s', 'a'],
      key: ['fir', 'pas', 'tec', 'fin', 'otb', 'ant', 'cmp', 'dec', 'tea', 'vis', 'bal', 'str'],
      pref: ['dri', 'hea', 'wor', 'agi', 'fla'],
      tags: ['link', 'creator', 'target', 'drop-deep'],
      note: '내려와 공을 받아 2선에 연결합니다. 뒤에서 침투해 들어오는 선수(섀도 스트라이커·메짤라)와 짝이 맞습니다.'
    },
    {
      id: 'tf', ko: '타깃 포워드', abbr: 'TF', en: 'Target Forward',
      req: { hea: 12, jum: 12, str: 12 },
      pos: ['ST'], duties: ['s', 'a'],
      key: ['hea', 'fin', 'fir', 'bra', 'otb', 'ant', 'cmp', 'dec', 'tea', 'wor', 'bal', 'jum', 'str'],
      pref: ['agg', 'pas', 'tec'],
      dutyKey: { a: ['fin', 'otb', 'ant'] },
      tags: ['target', 'aerial', 'outlet', 'hold-up'],
      note: '롱볼과 크로스의 목표점입니다. 압박이 심한 상대를 뛰어넘는 탈출구가 되고, 크로스 전술의 필수 조건이기도 합니다.'
    },
    {
      id: 'pf', ko: '프레싱 포워드', abbr: 'PF', en: 'Pressing Forward',
      req: { wor: 13, sta: 13, agg: 11 },
      pos: ['ST'], duties: ['d', 's', 'a'],
      key: ['fir', 'otb', 'ant', 'agg', 'bra', 'cmp', 'dec', 'det', 'tea', 'wor', 'acc', 'pac', 'sta', 'str'],
      pref: ['fin', 'tec', 'dri', 'pas', 'bal'],
      dutyKey: { s: ['fin', 'pas'], a: ['fin', 'dri'] },
      tags: ['presser', 'runner', 'stamina'],
      locked: ['더 많이 압박', '강하게 태클'],
      note: '최전방에서 상대 수비를 몰아붙입니다. 압박 전술의 시작점이지만 스태미너 소모가 가장 크므로 교체를 미리 계획해야 합니다.'
    },
    {
      id: 'f9', ko: '폴스 나인', abbr: 'F9', en: 'False Nine',
      req: { pas: 13, tec: 13, otb: 12 },
      pos: ['ST'], duties: ['s'],
      key: ['fin', 'fir', 'pas', 'tec', 'dri', 'otb', 'ant', 'cmp', 'dec', 'vis', 'fla', 'tea', 'acc', 'agi', 'bal'],
      pref: ['lon', 'wor', 'pac'],
      tags: ['creator', 'link', 'drop-deep', 'roam', 'overload-centre'],
      note: '내려와 상대 센터백을 끌어내고 그 공간을 다른 선수가 씁니다. 침투해 들어올 측면·중앙 자원이 없으면 최전방이 텅 빕니다.'
    }
  ];

  root.FM_ROLE_DATA = {
    ATTRS: ATTRS,
    ATTR_GROUPS: ATTR_GROUPS,
    ATTR_ORDER: Object.keys(ATTR_TABLE),
    POSITIONS: POSITIONS,
    DUTIES: DUTIES,
    ROLES: ROLES
  };
})(typeof window !== 'undefined' ? window : globalThis);

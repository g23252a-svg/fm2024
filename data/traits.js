/*
 * FM24 선수 특성(Player Preferred Moves)
 *
 * 특성은 능력치보다 강하게 경기를 바꿉니다. 「먼 거리에서 슛 시도」가 있는 선수에게
 * 「적극적으로 슛」을 빼라고 조언해 봐야 소용이 없습니다 — 그건 지시로 끄는 것이
 * 아니라 선수에게 박힌 습관이라 그대로 쏩니다. 반대로 「안쪽으로 파고들기」가 있는
 * 선수는 인사이드 포워드가 아니어도 안으로 들어옵니다.
 *
 * ── 이름 표기에 대해 ──
 * 영문 이름을 기준으로 둡니다. 한국어 표기는 게임 판본에 따라 다를 수 있는데
 * 영문은 그대로이기 때문입니다. 화면에서는 둘 다 보여 주고, 못 찾겠으면 영문으로
 * 맞추면 됩니다. 여기 없는 특성은 전술 판단을 바꾸지 않는 것들입니다
 * (심판에게 항의, 관중 선동 등) — 목록을 길게 만들면 고르는 데만 시간이 갑니다.
 *
 * ── 각 항목의 뜻 ──
 *   fit     : 역할 태그별 적합도 보정(%). +8이면 그 역할 점수를 8% 올립니다.
 *   roleFit : 특정 역할 id에만 붙는 보정.
 *   makes   : 이 특성이 이미 하고 있는 개인 지시. 중복해서 켤 필요가 없습니다.
 *   fights  : 이 특성과 정면으로 부딪히는 개인 지시. 켜도 특성이 이깁니다.
 *   warn    : 조합에 따라 경고로 띄울 내용.
 */
(function (root) {
  'use strict';

  var TRAITS = [
    // ── 움직임 ────────────────────────────────────────────────────────────
    {
      id: 'cuts-inside', ko: '안쪽으로 파고들기', en: 'Cuts Inside From Both Wings', group: '움직임',
      fit: { inverted: 10, 'narrow-drift': 10, width: -12, crosser: -10 },
      makes: ['안쪽으로 접어 들어가기'],
      fights: ['넓게 벌리기', '골라인까지 파고들어 크로스'],
      note: '측면에 세워도 안으로 들어옵니다. 그 측면의 폭은 뒤의 측면 수비가 전담해야 합니다.'
    },
    {
      id: 'hugs-line', ko: '측면 라인 붙기', en: 'Hugs Line', group: '움직임',
      fit: { width: 10, crosser: 8, inverted: -14, 'narrow-drift': -12, 'overload-centre': -8 },
      makes: ['넓게 벌리기'],
      fights: ['안쪽으로 접어 들어가기'],
      note: '측면 라인을 밟고 섭니다. 인사이드 포워드로 쓰면 역할이 통째로 죽습니다.'
    },
    {
      id: 'gets-forward', ko: '기회가 되면 전진', en: 'Gets Forward Whenever Possible', group: '움직임',
      fit: { overlap: 10, width: 6, 'defensive-cover': -10, holder: -12 },
      note: '수비 임무를 줘도 올라갑니다. 뒤를 받칠 사람을 반드시 두세요.'
    },
    {
      id: 'stays-back', ko: '항상 뒤에 남기', en: 'Stays Back At All Times', group: '움직임',
      fit: { 'defensive-cover': 12, holder: 10, overlap: -18, 'risk-back': -20, runner: -12 },
      fights: ['넓게 벌리기'],
      note: '공격 임무를 줘도 올라가지 않습니다. 이 선수를 공격형 윙백으로 쓰면 그 자리는 없는 것과 같습니다.'
    },
    {
      id: 'late-runs', ko: '박스에 늦게 침투', en: 'Arrives Late In Opposition Area', group: '움직임',
      fit: { 'late-run': 12, runner: 8, static: -8 },
      note: '뒤에서 박스로 들어갑니다. 앞이 비어 있어야 살아나므로 최전방이 내려오는 형태와 잘 맞습니다.'
    },
    {
      id: 'gets-into-area', ko: '상대 박스 안으로 침투', en: 'Gets Into Opposition Area', group: '움직임',
      fit: { finisher: 8, runner: 6, 'creator-deep': -6 },
      note: ''
    },
    {
      id: 'moves-channels', ko: '측면 공간으로 이동', en: 'Moves Into Channels', group: '움직임',
      fit: { 'half-space': 12, target: 6, static: -10 }, roleFit: { poa: -8 },
      note: '최전방이 옆으로 빠져 센터백을 끌어냅니다. 그 공간을 쓸 침투 자원이 있어야 값이 납니다.'
    },
    {
      id: 'comes-deep', ko: '내려와서 볼 받기', en: 'Comes Deep To Get Ball', group: '움직임',
      fit: { 'drop-deep': 14, link: 8, 'in-behind': -16, finisher: -8 },
      note: '최전방이 내려옵니다. 어드밴스드 포워드·포처로 쓰면 서로 반대 방향입니다.'
    },
    {
      id: 'back-to-goal', ko: '등지고 플레이', en: 'Plays With Back To Goal', group: '움직임',
      fit: { 'hold-up': 12, target: 10, 'in-behind': -12 },
      note: ''
    },
    // ── 볼 다루기 ─────────────────────────────────────────────────────────
    {
      id: 'runs-often', ko: '자주 드리블 전진', en: 'Runs With Ball Often', group: '볼 다루기',
      fit: { dribbler: 10, 'creator-deep': -8 },
      fights: ['위험을 줄이기'],
      note: '드리블로 직접 밀고 올라갑니다. 「볼을 빨리 넘기라」는 방향과는 반대입니다.'
    },
    {
      id: 'beats-man', ko: '반복해서 제치기', en: 'Likes To Beat Man Repeatedly', group: '볼 다루기',
      fit: { dribbler: 10 },
      warn: '템포가 높은 전술에서는 공격이 이 선수 앞에서 자꾸 멈춥니다.',
      note: ''
    },
    {
      id: 'dwells', ko: '볼을 오래 소유', en: 'Dwells On Ball', group: '볼 다루기',
      fit: { playmaker: -6, 'ballwinner': -6 },
      warn: '빠른 템포·역습 방향과 정면으로 부딪힙니다 — 역습의 첫 두 번째 패스가 여기서 죽습니다.',
      note: ''
    },
    {
      id: 'knocks-past', ko: '툭 치고 달리기', en: 'Knocks Ball Past Opponent', group: '볼 다루기',
      fit: { pace: 10, dribbler: 6 },
      note: '발이 빠른 선수에게만 값이 있습니다. 느리면 그냥 뺏깁니다.'
    },
    {
      id: 'plays-way-out', ko: '압박에서 풀어 나가기', en: 'Tries To Play Way Out Of Trouble', group: '볼 다루기',
      fit: { buildout: 10, clearance: -14 },
      fights: ['위험할 때 무조건 걷어내기'],
      warn: '상대가 강하게 전방 압박하면 우리 진영에서 잃습니다.',
      note: ''
    },
    // ── 패스 ──────────────────────────────────────────────────────────────
    {
      id: 'killer-balls', ko: '결정적인 패스 시도', en: 'Tries Killer Balls Often', group: '패스',
      fit: { creator: 10, playmaker: 8, 'risk-pass': 10 },
      makes: ['위험한 패스 시도'],
      note: ''
    },
    {
      id: 'short-passes', ko: '짧고 단순한 패스', en: 'Plays Short Simple Passes', group: '패스',
      fit: { buildout: 6, creator: -10, 'risk-pass': -14 },
      fights: ['위험한 패스 시도'],
      note: '플레이메이커로 세워도 안전한 패스만 합니다.'
    },
    {
      id: 'long-passes', ko: '롱패스 시도', en: 'Tries Long Range Passes', group: '패스',
      fit: { 'creator-deep': 8, 'risk-pass': 8 },
      warn: '점유 위주 전술에서는 소유권을 자주 넘겨줍니다.',
      note: ''
    },
    {
      id: 'switch-flank', ko: '반대 측면으로 전환', en: 'Likes To Switch Ball To Other Flank', group: '패스',
      fit: { 'creator-deep': 8, playmaker: 6 },
      note: '상대가 좁게 내려앉았을 때 값이 큽니다 — 블록을 좌우로 늘립니다.'
    },
    {
      id: 'one-twos', ko: '2대1 패스 시도', en: 'Plays One-Twos', group: '패스',
      fit: { link: 8, 'overload-centre': 6 },
      note: ''
    },
    {
      id: 'looks-for-pass', ko: '슛보다 패스 선택', en: 'Looks For Pass Rather Than Attempting To Score', group: '패스',
      fit: { creator: 8, finisher: -14 }, roleFit: { poa: -16, af: -12 },
      fights: ['더 자주 슛'],
      note: '최전방에 세우면 마무리를 미룹니다. 포처·어드밴스드 포워드와는 반대입니다.'
    },
    // ── 슈팅 ──────────────────────────────────────────────────────────────
    {
      id: 'shoots-distance', ko: '먼 거리에서 슛 시도', en: 'Shoots From Distance', group: '슈팅',
      fit: { shooter: 10, finisher: -4 },
      makes: ['더 자주 슛'],
      warn: '중거리 슛이 14 아래면 기대 득점만 깎아먹습니다 — 지시로는 못 막습니다.',
      note: '「적극적으로 슛」을 꺼도 그대로 쏩니다. 지시가 아니라 선수를 바꿔야 합니다.'
    },
    {
      id: 'refrains-long', ko: '중거리 슛 자제', en: 'Refrains From Taking Long Shots', group: '슈팅',
      fit: { shooter: -12 },
      fights: ['더 자주 슛'],
      note: ''
    },
    {
      id: 'first-time-shots', ko: '원터치 슛 시도', en: 'Tries First Time Shots', group: '슈팅',
      fit: { finisher: 6 }, roleFit: { poa: 8 },
      note: ''
    },
    {
      id: 'places-shots', ko: '구석으로 감아 차기', en: 'Places Shots', group: '슈팅',
      fit: { finisher: 6 },
      note: ''
    },
    {
      id: 'rounds-keeper', ko: '골키퍼 제치기', en: 'Rounds Keeper', group: '슈팅',
      fit: { 'in-behind': 8, pace: 4 },
      note: '일대일 상황이 자주 나는 전술(뒷공간 침투·역습)에서만 값이 납니다.'
    },
    // ── 수비 ──────────────────────────────────────────────────────────────
    {
      id: 'tight-marking', ko: '상대를 밀착 마크', en: 'Marks Opponent Tightly', group: '수비',
      fit: { 'defensive-cover': 8, stopper: 6 },
      makes: ['강하게 밀착 마크'],
      warn: '발이 느리면 뒷공간을 그대로 내줍니다.',
      note: ''
    },
    {
      id: 'dives-in', ko: '거칠게 달려들기', en: 'Dives Into Tackles', group: '수비',
      fit: { ballwinner: 6, stopper: 4 },
      makes: ['강하게 태클'],
      warn: '경고가 쌓이기 쉽습니다. 이미 경고를 받았으면 태클 강도를 내려도 소용이 없습니다.',
      note: ''
    },
    {
      id: 'no-dive-in', ko: '태클에 함부로 들어가지 않기', en: 'Does Not Dive Into Tackles', group: '수비',
      fit: { 'defensive-cover': 6, ballwinner: -8 }, roleFit: { cd: 6, anc: 6 },
      fights: ['강하게 태클'],
      note: '커버형 센터백·앵커 맨에 잘 맞습니다.'
    },
    // ── 세트피스 · 기타 ───────────────────────────────────────────────────
    {
      id: 'curls-ball', ko: '감아 차기', en: 'Curls Ball', group: '세트피스',
      setPiece: { corner: 1.5, fkDirect: 1.5 },
      note: '코너와 프리킥의 궤적이 좋아집니다 — 같은 능력치면 이 선수가 키커입니다.'
    },
    {
      id: 'power-fk', ko: '강하게 프리킥', en: 'Hits Free Kicks With Power', group: '세트피스',
      setPiece: { fkDirect: 1 },
      note: ''
    },
    {
      id: 'long-fk', ko: '먼 거리 프리킥 시도', en: 'Tries Long Range Free Kicks', group: '세트피스',
      setPiece: { fkDirect: 0.5 },
      warn: '먼 거리에서도 직접 노려 공격 기회를 소모합니다.',
      note: ''
    },
    {
      id: 'weaker-foot', ko: '약발 사용 기피', en: 'Avoids Using Weaker Foot', group: '기타',
      note: '반대발 자리에 세우면 안쪽으로만 접습니다. 그 측면의 크로스는 포기해야 합니다.'
    }
  ];

  root.FM_TRAIT_DATA = { TRAITS: TRAITS };
})(typeof window !== 'undefined' ? window : globalThis);

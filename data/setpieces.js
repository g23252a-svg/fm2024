/*
 * FM24 세트피스 데이터
 *
 * FM24에서 득점의 상당 부분이 코너킥과 프리킥에서 나오는데, 이 도구는 여기에
 * 대해 아무 말도 하지 않았습니다. 그런데 필요한 능력치는 이미 전부 읽고 있습니다 —
 * 코너킥 · 프리킥 · 헤딩 · 점프 · 몸싸움 · 오프 더 볼 · 예측력 · 주력 · 마크.
 *
 * 자리 이름은 한국어 설명과 FM 영문 표기를 함께 둡니다. 게임 언어에 따라
 * 화면에 뜨는 한국어 문구가 다를 수 있는데, 영문 표기는 그대로이기 때문입니다.
 * 지어낸 한국어 라벨만 적어 두면 화면에서 못 찾습니다.
 *
 * weight는 그 자리에 얼마나 중요한지입니다. need는 그 값을 밑도는 선수를
 * 아예 세우지 않는 최소선입니다 — 코너킥 8인 선수를 키커로 세우면 조언이 아니라
 * 방해입니다.
 */
(function (root) {
  'use strict';

  // ── 공격 코너 ────────────────────────────────────────────────────────────
  // 인원은 FM 기본값에 맞춰 잡았습니다. 박스 안 셋 + 가장자리 하나 + 뒤 둘.
  var ATT_CORNER = [
    {
      id: 'taker', ko: '키커', fm: 'Corner Taker', count: 1,
      weight: { cor: 3, tec: 1, vis: 1 }, need: { cor: 10 },
      why: '코너킥 능력치가 그대로 배달 정확도입니다. 여기가 낮으면 아래 배치를 아무리 잘해도 공이 안 옵니다.'
    },
    {
      id: 'near', ko: '니어 포스트로 달려들기', fm: 'Attack Near Post', count: 1,
      weight: { ant: 2, otb: 2, jum: 1.5, hea: 1.5, bra: 1 }, need: { jum: 10 },
      why: '니어는 키보다 타이밍입니다 — 먼저 닿는 사람이 이깁니다.'
    },
    {
      id: 'far', ko: '파 포스트로 달려들기', fm: 'Attack Far Post', count: 1,
      weight: { jum: 2.5, hea: 2.5, str: 1, otb: 1 }, need: { hea: 10 },
      why: '파 포스트는 공중에서 이기는 자리입니다. 팀에서 가장 높이 뛰고 머리가 좋은 선수를 둡니다.'
    },
    {
      id: 'keeper', ko: '골키퍼 방해', fm: 'Challenge Keeper', count: 1,
      weight: { str: 2.5, bra: 2, jum: 1, hea: 1 }, need: { str: 11 },
      why: '골키퍼가 나오지 못하게 몸으로 막는 자리라 몸싸움과 대담성이 전부입니다. 키가 커도 약하면 밀립니다.'
    },
    {
      id: 'edge', ko: '박스 가장자리에서 대기', fm: 'Lurk Outside Area', count: 1,
      weight: { lon: 2.5, tec: 1.5, ant: 1 }, need: { lon: 12 },
      why: '걷어낸 공이 가장 많이 떨어지는 자리입니다. 중거리 슛이 되는 선수가 아니면 여기 세울 값어치가 없습니다.'
    },
    {
      id: 'stay', ko: '뒤에 남기기', fm: 'Stay Back', count: 2,
      weight: { pac: 2, pos: 1.5, tck: 1, mar: 1 },
      why: '코너 실점은 대부분 우리 코너에서 시작된 역습입니다. 상대 최전방을 따라갈 발이 있어야 합니다.'
    }
  ];

  // ── 수비 코너 ────────────────────────────────────────────────────────────
  var DEF_CORNER = [
    {
      id: 'marker', ko: '맨마킹', fm: 'Man Mark', count: 3,
      weight: { mar: 2.5, hea: 2, jum: 2, str: 1.5, bra: 1 }, need: { jum: 10 },
      why: '상대 제공권 자원에 붙는 자리입니다. 마크와 공중 능력이 함께 필요합니다.'
    },
    {
      id: 'nearpost', ko: '니어 포스트 지키기', fm: 'Stand On Near Post', count: 1,
      weight: { hea: 2, jum: 1.5, cnt: 1.5, ant: 1 },
      why: '니어에서 흘리는 공을 끊는 자리입니다. 여기가 비면 짧은 코너 한 번에 무너집니다.'
    },
    {
      id: 'edge', ko: '박스 가장자리 지키기', fm: 'Edge Of Area', count: 1,
      weight: { ant: 2, cnt: 1.5, tck: 1, pos: 1 },
      why: '걷어낸 공을 상대가 다시 잡아 때리는 것을 막습니다.'
    },
    {
      id: 'outlet', ko: '앞에 남기기', fm: 'Stay Forward', count: 1,
      weight: { pac: 3, acc: 2, otb: 1.5, str: 1 }, need: { pac: 12 },
      why: '이 한 명이 상대 수비 둘을 붙잡아 둡니다. 발이 느리면 그냥 한 명을 버리는 것입니다.'
    }
  ];

  // ── 프리킥 · 페널티 · 스로인 ────────────────────────────────────────────
  var SPECIALISTS = [
    {
      id: 'fk-direct', ko: '직접 프리킥', fm: 'Free Kick Taker',
      weight: { fre: 3, tec: 1, cmp: 0.5 }, need: { fre: 12 },
      why: '골문 앞 20~25m에서 직접 노릴 사람입니다. 프리킥 12 아래면 직접 슛보다 크로스가 낫습니다.'
    },
    {
      id: 'fk-wide', ko: '측면 프리킥 · 크로스', fm: 'Wide Free Kick',
      weight: { cro: 2.5, fre: 1.5, tec: 1, vis: 1 }, need: { cro: 11 },
      why: '먼 측면에서 올리는 공입니다. 직접 프리킥과 다른 사람이어도 됩니다.'
    },
    {
      id: 'pen', ko: '페널티킥', fm: 'Penalty Taker',
      weight: { pen: 3, cmp: 2, tec: 1 }, need: { pen: 11 },
      why: '침착성이 페널티 능력치만큼 중요합니다 — 페널티는 능력이 아니라 상황에서 갈립니다.'
    },
    {
      id: 'throw', ko: '롱 스로인', fm: 'Long Throw Taker',
      weight: { lth: 3, str: 1 }, need: { lth: 14 },
      why: '롱 스로인 14 아래면 켜 봐야 코너처럼 쓸 거리가 안 나옵니다.'
    }
  ];

  /*
   * ── 프리킥 루틴 ──────────────────────────────────────────────────────────
   *
   * 지금까지 프리킥은 "누가 차나" 한 줄이 전부였습니다. 그런데 FM의 세트피스
   * 편집기는 프리킥을 **위치별로 따로** 짜게 되어 있습니다 — 골문 정면에서
   * 직접 노리는 것, 측면에서 올리는 것, 하프라인 근처에서 띄우는 것은 세울
   * 사람도 노릴 자리도 다릅니다. 한 줄로 뭉뚱그리면 셋 다 못 씁니다.
   *
   * 자리 이름은 코너와 같은 목록을 씁니다. FM의 세트피스 역할 목록은 코너와
   * 프리킥이 공유하기 때문입니다 — 여기서 새 영문 이름을 지어내면 화면에서
   * 못 찾습니다.
   *
   * 벽에 누가 서는지는 여기서 정하지 않습니다. 이 도구는 배치와 남길 인원만
   * 봅니다.
   */

  /*
   * FM 세트피스 화면에서 고를 수 있는 자리 이름 전부.
   *
   * 한 군데 모아 두는 이유는 지어낸 이름을 막기 위해서입니다. 루틴을 하나 더
   * 만들 때마다 그럴듯한 영문 이름을 새로 적으면, 화면에서 그 자리를 못 찾아
   * 조언 전체가 못 쓰게 됩니다. 여기에 없는 이름을 쓰면 검사가 막습니다.
   */
  var FM_ROLE_NAMES = [
    'Corner Taker', 'Take Free Kick', 'Wide Free Kick', 'Free Kick Taker',
    'Penalty Taker', 'Long Throw Taker', 'Offer Short Option',
    'Attack Near Post', 'Attack Far Post', 'Attack Ball From Deep',
    'Challenge Keeper', 'Lurk Outside Area',
    'Man Mark', 'Stand On Near Post', 'Stand On Far Post', 'Edge Of Area',
    'Stay Back', 'Stay Forward'
  ];

  // 공격 프리킥 · 중앙(골문 정면 18~25m) — 직접 노릴 수 있는 거리
  var ATT_FK_CENTRAL = [
    {
      // 가중치는 아래 「전담 키커」의 직접 프리킥과 같아야 합니다. 어긋나면 두
      // 화면이 서로 다른 선수를 지목해 어느 쪽을 따라야 할지 알 수 없습니다.
      id: 'fk-taker', ko: '직접 슈팅', fm: 'Take Free Kick', count: 1,
      weight: { fre: 3, tec: 1, cmp: 0.5 }, need: { fre: 12 },
      why: '벽을 넘겨 골문 구석으로 보내는 자리입니다. 프리킥 12 아래면 직접 노리는 것 자체가 손해입니다 — 크로스 루틴으로 바꾸는 편이 낫습니다.'
    },
    {
      id: 'fk-second', ko: '공 위에 한 명 더', fm: 'Take Free Kick', count: 1,
      weight: { fre: 2.5, tec: 1, vis: 1 }, need: { fre: 10 },
      why: '공 위에 두 명을 세우면 상대가 벽 위치와 골키퍼 자리를 미리 정하지 못합니다. 두 사람의 발이 다르면 효과가 가장 큽니다.'
    },
    {
      id: 'keeper', ko: '골키퍼 시야 가리기', fm: 'Challenge Keeper', count: 1,
      weight: { bra: 2.5, str: 2, hea: 1 }, need: { bra: 10 },
      why: '골키퍼 앞이나 벽 끝에 서서 공을 늦게 보게 만듭니다. 날아오는 공을 보고 피해야 하므로 용맹성이 먼저입니다.'
    },
    {
      id: 'far', ko: '파 포스트로 달려들기', fm: 'Attack Far Post', count: 1,
      weight: { jum: 2.5, hea: 2.5, otb: 1 }, need: { hea: 10 },
      why: '직접 슛이 벽을 맞거나 골키퍼가 쳐내면 공은 대부분 파 포스트 쪽으로 흐릅니다.'
    },
    {
      id: 'near', ko: '니어 포스트로 달려들기', fm: 'Attack Near Post', count: 1,
      weight: { ant: 2, otb: 2, jum: 1.5, hea: 1 },
      why: '벽을 감아 도는 낮은 공이 오면 여기서 끝납니다. 키보다 타이밍입니다.'
    },
    {
      id: 'deep', ko: '뒤에서 달려들기', fm: 'Attack Ball From Deep', count: 1,
      weight: { ant: 2, otb: 2, pac: 1.5 },
      why: '벽과 수비 사이로 뒤늦게 들어옵니다. 마크가 붙지 않아 흘러나온 공을 가장 먼저 잡습니다.'
    },
    {
      id: 'edge', ko: '리바운드 대기', fm: 'Lurk Outside Area', count: 1,
      weight: { lon: 2.5, ant: 1.5, tec: 1 }, need: { lon: 12 },
      why: '벽에 맞고 튀어나온 공을 그대로 때리는 자리입니다. 중거리 슛이 안 되면 여기 세울 값어치가 없습니다.'
    },
    {
      id: 'stay', ko: '뒤에 남기기', fm: 'Stay Back', count: 3,
      weight: { pac: 2, pos: 1.5, mar: 1 },
      why: '중앙 프리킥은 우리 선수가 골문 앞에 몰려 있어 끊기는 순간 그대로 역습입니다. 코너보다 한 명 더 남깁니다.'
    }
  ];

  // 공격 프리킥 · 측면 — 크로스로 여는 자리
  var ATT_FK_WIDE = [
    {
      // 「전담 키커」의 측면 프리킥과 같은 가중치입니다.
      id: 'fk-taker', ko: '크로스 키커', fm: 'Wide Free Kick', count: 1,
      weight: { cro: 2.5, fre: 1.5, tec: 1, vis: 1 }, need: { cro: 11 },
      why: '멈춘 공을 올리는 것이라 크로스 능력치가 그대로 나옵니다. 직접 프리킥 키커와 다른 사람이어도 됩니다.'
    },
    {
      id: 'short', ko: '짧은 패스 옵션', fm: 'Offer Short Option', count: 1,
      weight: { pas: 2, fir: 1.5, tec: 1.5, dec: 1 },
      why: '상대가 박스를 다 채웠을 때 빼는 길입니다. 짧게 받아 각을 만들면 같은 크로스가 훨씬 쉬워집니다.'
    },
    {
      id: 'far', ko: '파 포스트로 달려들기', fm: 'Attack Far Post', count: 1,
      weight: { jum: 2.5, hea: 2.5, str: 1, otb: 1 }, need: { hea: 10 },
      why: '측면에서 올린 공이 가장 많이 떨어지는 자리입니다. 가장 높이 뛰는 선수를 둡니다.'
    },
    {
      id: 'near', ko: '니어 포스트로 달려들기', fm: 'Attack Near Post', count: 1,
      weight: { ant: 2, otb: 2, jum: 1.5, hea: 1.5 },
      why: '니어에서 방향만 바꿔 주는 자리입니다. 먼저 닿는 사람이 이깁니다.'
    },
    {
      id: 'keeper', ko: '골키퍼 방해', fm: 'Challenge Keeper', count: 1,
      weight: { str: 2.5, bra: 2, jum: 1 }, need: { str: 11 },
      why: '코너와 같습니다 — 골키퍼가 나와서 잡지 못하게 몸으로 막습니다.'
    },
    {
      id: 'deep', ko: '뒤에서 달려들기', fm: 'Attack Ball From Deep', count: 1,
      weight: { ant: 2, otb: 2, pac: 1.5 },
      why: '박스 안이 이미 꽉 차 있으므로, 마크가 없는 한 명이 뒤에서 들어와야 두 번째 공을 잡습니다.'
    },
    {
      id: 'edge', ko: '박스 가장자리에서 대기', fm: 'Lurk Outside Area', count: 1,
      weight: { lon: 2.5, tec: 1.5, ant: 1 }, need: { lon: 12 },
      why: '걷어낸 공이 떨어지는 자리입니다.'
    },
    {
      id: 'stay', ko: '뒤에 남기기', fm: 'Stay Back', count: 2,
      weight: { pac: 2, pos: 1.5, tck: 1, mar: 1 },
      why: '측면 프리킥은 우리 풀백이 이미 올라와 있는 상태입니다. 둘은 반드시 남깁니다.'
    }
  ];

  // 공격 프리킥 · 깊은 위치(하프라인 부근) — 여기서 뺏기면 그대로 역습입니다
  var ATT_FK_DEEP = [
    {
      id: 'fk-taker', ko: '띄워 올릴 사람', fm: 'Wide Free Kick', count: 1,
      weight: { cro: 2, vis: 2, pas: 1.5, tec: 1 }, need: { cro: 10 },
      why: '여기서는 감아 차는 것보다 정확히 띄우는 것이 중요합니다 — 시야와 패스가 크로스만큼 셉니다. 측면 프리킥 키커와 같은 사람이 되는 경우가 많지만, 시야가 좋은 미드필더가 더 나을 때도 있습니다.'
    },
    {
      id: 'target', ko: '경합 목표', fm: 'Attack Ball From Deep', count: 1,
      weight: { jum: 2.5, hea: 2.5, str: 1.5 }, need: { hea: 11 },
      why: '깊은 위치의 공은 체공 시간이 길어 상대가 먼저 자리를 잡습니다. 몸으로 이기는 선수 하나는 있어야 합니다.'
    },
    {
      id: 'second', ko: '세컨볼 줍기', fm: 'Lurk Outside Area', count: 2,
      weight: { ant: 2, otb: 1.5, wor: 1.5 },
      why: '헤딩 경합에서 흘러나오는 공을 잡는 자리입니다. 깊은 프리킥 득점은 거의 다 여기서 나옵니다.'
    },
    {
      id: 'stay', ko: '뒤에 남기기', fm: 'Stay Back', count: 4,
      weight: { pac: 2, pos: 1.5, mar: 1 },
      why: '하프라인에서 올린 공을 뺏기면 우리 뒷선이 텅 빈 채로 역습을 맞습니다. 여기는 넉넉히 남깁니다.'
    }
  ];

  // 수비 프리킥 · 중앙 — 벽은 자동으로 서고, 사람이 정하는 것은 박스 안입니다
  var DEF_FK_CENTRAL = [
    {
      id: 'farpost', ko: '파 포스트 지키기', fm: 'Stand On Far Post', count: 1,
      weight: { cnt: 2, ant: 1.5, hea: 1.5, jum: 1 },
      why: '골키퍼는 벽 반대쪽에 서기 때문에 파 포스트 구석이 비어 있습니다. 그 구석을 덮는 자리입니다.'
    },
    {
      id: 'marker', ko: '맨마킹', fm: 'Man Mark', count: 3,
      weight: { mar: 2.5, hea: 2, jum: 2, str: 1.5 }, need: { jum: 10 },
      why: '상대 제공권 자원에 붙습니다. 프리킥은 코너보다 공이 빠르게 오므로 마크가 더 중요합니다.'
    },
    {
      id: 'edge', ko: '세컨볼 차단', fm: 'Edge Of Area', count: 2,
      weight: { ant: 2, cnt: 1.5, tck: 1, pos: 1 },
      why: '벽에 맞고 튀어나온 공이 가장 위험합니다 — 되받아치기가 여기서 나옵니다. 코너보다 한 명 더 둡니다.'
    },
    {
      id: 'outlet', ko: '앞에 남기기', fm: 'Stay Forward', count: 1,
      weight: { pac: 3, acc: 2, otb: 1.5 }, need: { pac: 12 },
      why: '이 한 명이 상대 수비 둘을 붙잡아 둡니다. 발이 느리면 그냥 한 명을 버리는 것입니다.'
    }
  ];

  // 수비 프리킥 · 측면 — 벽이 없으므로 박스 안 인원이 그대로 승부입니다
  var DEF_FK_WIDE = [
    {
      id: 'marker', ko: '맨마킹', fm: 'Man Mark', count: 4,
      weight: { mar: 2.5, hea: 2, jum: 2, str: 1.5 }, need: { jum: 10 },
      why: '측면 프리킥에는 벽이 없어 상대가 박스에 사람을 더 넣습니다. 코너보다 한 명 더 붙입니다.'
    },
    {
      id: 'nearpost', ko: '니어 포스트 지키기', fm: 'Stand On Near Post', count: 1,
      weight: { hea: 2, jum: 1.5, cnt: 1.5, ant: 1 },
      why: '니어에서 방향만 바꾼 공을 막습니다. 여기가 비면 짧은 프리킥 한 번에 무너집니다.'
    },
    {
      id: 'farpost', ko: '파 포스트 지키기', fm: 'Stand On Far Post', count: 1,
      weight: { cnt: 2, hea: 1.5, jum: 1.5, ant: 1 },
      why: '골키퍼가 니어를 보고 나오면 파 포스트가 그대로 비어 있습니다.'
    },
    {
      id: 'edge', ko: '박스 가장자리 지키기', fm: 'Edge Of Area', count: 1,
      weight: { ant: 2, cnt: 1.5, tck: 1, pos: 1 },
      why: '걷어낸 공을 상대가 다시 잡아 때리는 것을 막습니다.'
    },
    {
      id: 'outlet', ko: '앞에 남기기', fm: 'Stay Forward', count: 1,
      weight: { pac: 3, acc: 2, otb: 1.5, str: 1 }, need: { pac: 12 },
      why: '역습으로 나갈 한 명입니다. 상대 센터백을 내려앉게 만듭니다.'
    }
  ];

  /*
   * 루틴 목록.
   *
   * 코너는 원래 있던 배열을 그대로 씁니다 — 같은 화면에서 같은 모양으로
   * 보여야 하고, 프리킥만 따로 노는 카드가 되면 오히려 못 찾습니다.
   */
  var ROUTINES = [
    {
      id: 'att-corner', side: 'att', kind: 'corner', ko: '공격 코너', fm: 'Attacking Corner',
      when: '우리 코너킥', slots: ATT_CORNER,
      desc: '박스 안 셋 + 가장자리 하나 + 뒤 둘. 한 사람이 두 자리를 겸하지 않습니다.'
    },
    {
      id: 'att-fk-central', side: 'att', kind: 'fk', ko: '공격 프리킥 · 중앙', fm: 'Attacking Free Kick (Central)',
      when: '골문 정면 18~25m — 직접 노릴 수 있는 거리', slots: ATT_FK_CENTRAL,
      desc: '공 위에 둘, 박스 안 넷, 리바운드 하나, 뒤에 셋. 직접 슛이 안 되는 스쿼드면 이 루틴 대신 크로스 루틴을 쓰세요.'
    },
    {
      id: 'att-fk-wide', side: 'att', kind: 'fk', ko: '공격 프리킥 · 측면', fm: 'Attacking Free Kick (Wide)',
      when: '측면 깊은 곳에서 얻은 프리킥', slots: ATT_FK_WIDE,
      desc: '코너와 비슷하지만 짧게 빼는 길을 하나 열어 둡니다. 상대가 박스를 다 채우면 그쪽이 답입니다.'
    },
    {
      id: 'att-fk-deep', side: 'att', kind: 'fk', ko: '공격 프리킥 · 깊은 위치', fm: 'Attacking Free Kick (Deep)',
      when: '하프라인 부근에서 얻은 프리킥', slots: ATT_FK_DEEP,
      desc: '득점보다 잃지 않는 것이 먼저입니다. 넷을 남기고 경합 하나 + 세컨볼 둘로 갑니다.'
    },
    {
      id: 'def-corner', side: 'def', kind: 'corner', ko: '수비 코너', fm: 'Defending Corner',
      when: '상대 코너킥', slots: DEF_CORNER,
      desc: '맨마킹 셋에 니어 포스트 · 가장자리 · 앞에 남길 한 명씩.'
    },
    {
      id: 'def-fk-central', side: 'def', kind: 'fk', ko: '수비 프리킥 · 중앙', fm: 'Defending Free Kick (Central)',
      when: '상대가 골문 정면에서 얻은 프리킥', slots: DEF_FK_CENTRAL,
      desc: '벽에 누가 서는지는 여기서 정하지 않습니다. 파 포스트 구석과 세컨볼 차단이 사람이 정할 수 있는 부분입니다.'
    },
    {
      id: 'def-fk-wide', side: 'def', kind: 'fk', ko: '수비 프리킥 · 측면', fm: 'Defending Free Kick (Wide)',
      when: '상대가 측면에서 얻은 프리킥', slots: DEF_FK_WIDE,
      desc: '벽이 없어 상대가 박스에 사람을 더 넣습니다. 맨마킹을 한 명 더 붙이고 양쪽 포스트를 다 덮습니다.'
    }
  ];

  root.FM_SETPIECE_DATA = {
    FM_ROLE_NAMES: FM_ROLE_NAMES,
    ATT_CORNER: ATT_CORNER,
    DEF_CORNER: DEF_CORNER,
    ATT_FK_CENTRAL: ATT_FK_CENTRAL,
    ATT_FK_WIDE: ATT_FK_WIDE,
    ATT_FK_DEEP: ATT_FK_DEEP,
    DEF_FK_CENTRAL: DEF_FK_CENTRAL,
    DEF_FK_WIDE: DEF_FK_WIDE,
    ROUTINES: ROUTINES,
    SPECIALISTS: SPECIALISTS
  };
})(typeof window !== 'undefined' ? window : globalThis);

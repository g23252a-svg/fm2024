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

  root.FM_SETPIECE_DATA = {
    ATT_CORNER: ATT_CORNER,
    DEF_CORNER: DEF_CORNER,
    SPECIALISTS: SPECIALISTS
  };
})(typeof window !== 'undefined' ? window : globalThis);

/*
 * FM24 포메이션 데이터베이스
 *
 * 좌표는 화면에 그리기 위한 것입니다. x는 0(왼쪽 터치라인)~100(오른쪽),
 * y는 0(우리 골문)~100(상대 골문)입니다.
 *
 * 각 포메이션의 성격(중원 수, 폭의 출처, 뒷공간 노출)은 엔진이 slots에서
 * 직접 계산합니다. 여기에 손으로 적어 두면 슬롯을 고칠 때 같이 안 고쳐져서
 * 어긋나기 때문입니다. note/strength/weakness만 사람이 씁니다.
 */
(function (root) {
  'use strict';

  // y좌표 기준선
  var Y = { GK: 5, D: 19, WB: 27, DM: 37, M: 53, AM: 69, ST: 85 };

  function s(pos, x, y, id) {
    return { pos: pos, x: x, y: y, id: id || pos };
  }

  var FORMATIONS = [
    {
      id: '442', ko: '4-4-2', tags: ['classic', 'two-striker', 'wide'],
      slots: [
        s('GK', 50, Y.GK), s('DL', 15, Y.D), s('DC', 37, Y.D, 'DCl'), s('DC', 63, Y.D, 'DCr'), s('DR', 85, Y.D),
        s('ML', 12, Y.M), s('MC', 38, Y.M, 'MCl'), s('MC', 62, Y.M, 'MCr'), s('MR', 88, Y.M),
        s('ST', 40, Y.ST, 'STl'), s('ST', 60, Y.ST, 'STr')
      ],
      note: '두 줄 네 명이 나란히 서는 가장 단순한 형태. 선수들이 자기 자리를 이해하기 쉽고 측면과 최전방에 사람이 충분합니다.',
      strength: ['측면 두 명 + 풀백으로 폭이 자연스럽게 확보됨', '투톱이 상대 센터백 둘을 모두 묶음', '수비 시 두 줄 네 명이 촘촘함'],
      weakness: ['중앙 미드필더가 둘뿐 — 중원 셋 이상인 상대에게 수적으로 밀림', '중앙 미드필더 사이 공간을 공격형 미드필더에게 내주기 쉬움']
    },
    {
      id: '442d', ko: '4-4-2 다이아몬드', tags: ['narrow', 'two-striker', 'overload-centre'],
      slots: [
        s('GK', 50, Y.GK), s('DL', 15, Y.D), s('DC', 37, Y.D, 'DCl'), s('DC', 63, Y.D, 'DCr'), s('DR', 85, Y.D),
        s('DM', 50, Y.DM), s('MC', 30, Y.M, 'MCl'), s('MC', 70, Y.M, 'MCr'), s('AMC', 50, Y.AM),
        s('ST', 40, Y.ST, 'STl'), s('ST', 60, Y.ST, 'STr')
      ],
      note: '중앙에 네 명을 세워 중원을 완전히 장악하는 대신 측면을 통째로 포기합니다.',
      strength: ['중앙 4명 — 웬만한 상대 중원을 수적으로 압도', '투톱과 공격형 미드필더가 좁은 삼각형을 이룸'],
      weakness: ['측면 폭이 풀백 둘뿐 — 풀백이 지치면 공격이 중앙에서 막힘', '상대 윙어와 풀백이 겹쳐 들어오면 우리 풀백이 2대1로 노출됨']
    },
    {
      id: '4411', ko: '4-4-1-1', tags: ['classic', 'wide', 'defensive-shape'],
      slots: [
        s('GK', 50, Y.GK), s('DL', 15, Y.D), s('DC', 37, Y.D, 'DCl'), s('DC', 63, Y.D, 'DCr'), s('DR', 85, Y.D),
        s('ML', 12, Y.M), s('MC', 38, Y.M, 'MCl'), s('MC', 62, Y.M, 'MCr'), s('MR', 88, Y.M),
        s('AMC', 50, Y.AM), s('ST', 50, Y.ST)
      ],
      note: '4-4-2에서 한 명을 내려 중앙 2선을 만든 형태. 수비 시에는 4-4-2처럼 접히고 공격 시에는 10번이 살아납니다.',
      strength: ['수비 시 두 줄 네 명 + 앞선 두 명으로 촘촘함', '10번이 상대 수비형 미드필더 옆 공간을 씀'],
      weakness: ['최전방이 혼자여서 고립되기 쉬움', '중앙 미드필더 둘로는 여전히 중원 셋 상대에 밀림']
    },
    {
      id: '4231', ko: '4-2-3-1 와이드', tags: ['modern', 'wide', 'dm-anchored', 'balanced'],
      slots: [
        s('GK', 50, Y.GK), s('DL', 15, Y.D), s('DC', 37, Y.D, 'DCl'), s('DC', 63, Y.D, 'DCr'), s('DR', 85, Y.D),
        s('DM', 38, Y.DM, 'DMl'), s('DM', 62, Y.DM, 'DMr'),
        s('AML', 14, Y.AM), s('AMC', 50, Y.AM), s('AMR', 86, Y.AM),
        s('ST', 50, Y.ST)
      ],
      note: '수비형 미드필더 둘이 뒤를 잠그고 2선 셋이 공격을 만듭니다. 가장 무난하면서 대부분의 상대에게 통하는 형태입니다.',
      strength: ['수비형 미드필더 2명 — 역습 차단과 중원 장악을 동시에', '2선 3명이 상대 수비 라인과 미드필드 사이를 점거', '수비 시 4-4-1-1 또는 4-5-1로 자연스럽게 접힘'],
      weakness: ['최전방이 혼자 — 2선이 침투하지 않으면 고립됨', '수비형 미드필더 둘이 모두 수비적이면 빌드업이 느려짐']
    },
    {
      id: '4141', ko: '4-1-4-1 DM', tags: ['modern', 'wide', 'dm-anchored', 'defensive-shape'],
      slots: [
        s('GK', 50, Y.GK), s('DL', 15, Y.D), s('DC', 37, Y.D, 'DCl'), s('DC', 63, Y.D, 'DCr'), s('DR', 85, Y.D),
        s('DM', 50, Y.DM),
        s('ML', 12, Y.M), s('MC', 38, Y.M, 'MCl'), s('MC', 62, Y.M, 'MCr'), s('MR', 88, Y.M),
        s('ST', 50, Y.ST)
      ],
      note: '수비형 미드필더 한 명 위에 네 명이 한 줄로 섭니다. 수비 시 다섯 명이 한 줄을 이뤄 가로로 아주 촘촘합니다.',
      strength: ['미드필더 다섯 — 중원 수적 우위를 거의 항상 확보', '수비 시 4-5-1 블록이 견고함', '수비형 미드필더가 최종 라인 앞을 전담'],
      weakness: ['최전방 고립이 가장 심한 형태 — 미드필더가 올라가 줘야 함', '수비형 미드필더가 혼자라 그 자리를 비우면 곧바로 뚫림']
    },
    {
      id: '433dm', ko: '4-3-3 DM 와이드', tags: ['modern', 'wide', 'dm-anchored', 'press'],
      slots: [
        s('GK', 50, Y.GK), s('DL', 15, Y.D), s('DC', 37, Y.D, 'DCl'), s('DC', 63, Y.D, 'DCr'), s('DR', 85, Y.D),
        s('DM', 50, Y.DM), s('MC', 32, Y.M, 'MCl'), s('MC', 68, Y.M, 'MCr'),
        s('AML', 14, Y.AM), s('AMR', 86, Y.AM), s('ST', 50, Y.ST)
      ],
      note: '수비형 미드필더 하나에 중앙 미드필더 둘, 앞에 셋. 압박 전술의 표준형입니다.',
      strength: ['앞선 세 명이 상대 백4를 그대로 압박', '중원 삼각형이 안정적이고 전진 패스 각이 많음', '측면 공격수가 상대 풀백과 1대1'],
      weakness: ['수비형 미드필더 하나 — 상대 공격형 미드필더가 그 옆을 파고들면 위험', '측면 공격수가 수비 복귀를 안 하면 풀백이 고립됨']
    },
    {
      id: '433', ko: '4-3-3', tags: ['modern', 'wide', 'press', 'overload-centre'],
      slots: [
        s('GK', 50, Y.GK), s('DL', 15, Y.D), s('DC', 37, Y.D, 'DCl'), s('DC', 63, Y.D, 'DCr'), s('DR', 85, Y.D),
        s('MC', 26, Y.M, 'MCl'), s('MC', 50, Y.M, 'MCc'), s('MC', 74, Y.M, 'MCr'),
        s('AML', 14, Y.AM), s('AMR', 86, Y.AM), s('ST', 50, Y.ST)
      ],
      note: '중앙 미드필더 셋이 같은 줄에 서는 형태. 4-3-3 DM보다 중원이 높게 서고 공격적입니다.',
      strength: ['중앙 미드필더 셋이 같은 높이 — 전진 압박과 2차 볼 회수에 강함', '앞선 셋이 상대 백4를 압박'],
      weakness: ['최종 라인 앞을 전담하는 선수가 없어 역습에 취약', '중앙 미드필더 중 한 명은 반드시 수비적 임무여야 함']
    },
    {
      id: '451', ko: '4-5-1', tags: ['defensive-shape', 'wide', 'overload-centre'],
      slots: [
        s('GK', 50, Y.GK), s('DL', 15, Y.D), s('DC', 37, Y.D, 'DCl'), s('DC', 63, Y.D, 'DCr'), s('DR', 85, Y.D),
        s('ML', 12, Y.M), s('MC', 32, Y.M, 'MCl'), s('MC', 50, Y.M, 'MCc'), s('MC', 68, Y.M, 'MCr'), s('MR', 88, Y.M),
        s('ST', 50, Y.ST)
      ],
      note: '미드필더 다섯을 한 줄로 세워 공간을 지웁니다. 원정에서 강팀을 상대할 때의 기본형입니다.',
      strength: ['가로로 가장 촘촘한 중원 — 중앙 침투를 거의 허용하지 않음', '중원 수적 우위가 확실함'],
      weakness: ['공격이 최전방 한 명에게 전부 걸림', '공을 뺏어도 앞으로 나갈 사람이 없어 곧바로 다시 내줌']
    },
    {
      id: '4222', ko: '4-2-2-2', tags: ['two-striker', 'narrow', 'dm-anchored', 'press'],
      slots: [
        s('GK', 50, Y.GK), s('DL', 15, Y.D), s('DC', 37, Y.D, 'DCl'), s('DC', 63, Y.D, 'DCr'), s('DR', 85, Y.D),
        s('DM', 38, Y.DM, 'DMl'), s('DM', 62, Y.DM, 'DMr'),
        s('AML', 22, Y.AM), s('AMR', 78, Y.AM),
        s('ST', 40, Y.ST, 'STl'), s('ST', 60, Y.ST, 'STr')
      ],
      note: '앞선 네 명이 좁게 서서 상대 중앙을 덮칩니다. 압박으로 높은 지역에서 공을 뺏는 데 특화돼 있습니다.',
      strength: ['앞선 4명의 압박 그물이 촘촘함 — 상대 빌드업을 높은 곳에서 끊음', '수비형 미드필더 둘이 뒤를 받쳐 과감하게 압박 가능'],
      weakness: ['측면 폭이 풀백 둘뿐', '압박이 한 번 뚫리면 수비형 미드필더 둘과 백4만 남음', '체력 소모가 모든 포메이션 중 가장 큼']
    },
    {
      id: '4312', ko: '4-3-1-2', tags: ['narrow', 'two-striker', 'overload-centre'],
      slots: [
        s('GK', 50, Y.GK), s('DL', 15, Y.D), s('DC', 37, Y.D, 'DCl'), s('DC', 63, Y.D, 'DCr'), s('DR', 85, Y.D),
        s('MC', 28, Y.M, 'MCl'), s('MC', 50, Y.M, 'MCc'), s('MC', 72, Y.M, 'MCr'),
        s('AMC', 50, Y.AM), s('ST', 40, Y.ST, 'STl'), s('ST', 60, Y.ST, 'STr')
      ],
      note: '중앙에 다섯 명을 쌓습니다. 다이아몬드보다도 좁고 중원 장악력은 최대입니다.',
      strength: ['중앙 5명 — 어떤 상대 중원보다 숫자가 많음', '짧은 패스로 중앙을 뚫기에 각이 많음'],
      weakness: ['측면이 완전히 비어 상대 윙어에게 1대1을 계속 허용', '풀백 둘의 체력과 수비력에 전부 걸림']
    },
    {
      id: '4132', ko: '4-1-3-2', tags: ['two-striker', 'wide', 'dm-anchored'],
      slots: [
        s('GK', 50, Y.GK), s('DL', 15, Y.D), s('DC', 37, Y.D, 'DCl'), s('DC', 63, Y.D, 'DCr'), s('DR', 85, Y.D),
        s('DM', 50, Y.DM),
        s('ML', 14, Y.M), s('MC', 50, Y.M, 'MCc'), s('MR', 86, Y.M),
        s('ST', 40, Y.ST, 'STl'), s('ST', 60, Y.ST, 'STr')
      ],
      note: '수비형 미드필더 하나가 뒤를 받치고 그 앞에 셋, 최전방에 둘. 투톱을 쓰면서 측면도 포기하지 않는 절충안입니다.',
      strength: ['투톱과 측면을 동시에 확보', '수비형 미드필더가 최종 라인 앞을 정리'],
      weakness: ['중앙 미드필더가 사실상 둘(DM+MC) — 중원 셋 상대에 밀림', '측면 미드필더가 수비까지 하려면 활동량이 매우 높아야 함']
    },
    {
      id: '424', ko: '4-2-4', tags: ['two-striker', 'wide', 'attacking'],
      slots: [
        s('GK', 50, Y.GK), s('DL', 15, Y.D), s('DC', 37, Y.D, 'DCl'), s('DC', 63, Y.D, 'DCr'), s('DR', 85, Y.D),
        s('MC', 38, Y.M, 'MCl'), s('MC', 62, Y.M, 'MCr'),
        s('AML', 14, Y.AM), s('AMR', 86, Y.AM), s('ST', 40, Y.ST, 'STl'), s('ST', 60, Y.ST, 'STr')
      ],
      note: '앞에 네 명을 세우는 극단적인 공격 형태. 지고 있는 경기 막판에 쓰는 카드입니다.',
      strength: ['최전방 4명 — 상대 백4를 전부 묶음', '박스 안에 사람이 항상 많음'],
      weakness: ['중앙 미드필더 둘만 남아 중원을 통째로 내줌', '한 번 뺏기면 그대로 역습을 맞음 — 90분 내내 쓸 형태가 아님']
    },
    {
      id: '4321', ko: '4-3-2-1 크리스마스 트리', tags: ['narrow', 'overload-centre'],
      slots: [
        s('GK', 50, Y.GK), s('DL', 15, Y.D), s('DC', 37, Y.D, 'DCl'), s('DC', 63, Y.D, 'DCr'), s('DR', 85, Y.D),
        s('MC', 28, Y.M, 'MCl'), s('MC', 50, Y.M, 'MCc'), s('MC', 72, Y.M, 'MCr'),
        s('AMC', 36, Y.AM, 'AMCl'), s('AMC', 64, Y.AM, 'AMCr'), s('ST', 50, Y.ST)
      ],
      note: '중앙만으로 삼각형을 위로 쌓습니다. 창조적인 2선 자원이 둘 있을 때 그들을 동시에 쓰는 방법입니다.',
      strength: ['중앙 6명 — 좁은 지역에서의 연계가 가장 촘촘함', '상대 수비형 미드필더 양옆을 둘이 동시에 공략'],
      weakness: ['측면이 풀백 둘뿐이고 그마저 앞에 도와줄 사람이 없음', '측면 수비 부담이 모든 포메이션 중 가장 큼']
    },
    {
      id: '352', ko: '3-5-2', tags: ['three-at-back', 'two-striker', 'overload-centre', 'wingback'],
      slots: [
        s('GK', 50, Y.GK), s('DC', 30, Y.D, 'DCl'), s('DC', 50, Y.D, 'DCc'), s('DC', 70, Y.D, 'DCr'),
        s('WBL', 10, Y.WB), s('WBR', 90, Y.WB),
        s('MC', 30, Y.M, 'MCl'), s('MC', 50, Y.M, 'MCc'), s('MC', 70, Y.M, 'MCr'),
        s('ST', 40, Y.ST, 'STl'), s('ST', 60, Y.ST, 'STr')
      ],
      note: '센터백 셋이 뒤를 지키고 윙백 둘이 측면을 위아래로 전담합니다. 공격 시 3-5-2, 수비 시 5-3-2로 접힙니다.',
      strength: ['중앙 미드필더 셋 + 투톱으로 중앙이 두꺼움', '센터백 셋이 상대 투톱을 수적 우위로 상대', '윙백이 전진하면 사실상 3-3-4'],
      weakness: ['윙백이 올라간 뒤 측면 공간이 크게 열림', '윙백의 스태미너가 경기 전체를 좌우함', '상대 윙어가 우리 윙백 뒤를 노리면 센터백이 끌려 나옴']
    },
    {
      id: '532', ko: '5-3-2 WB', tags: ['three-at-back', 'two-striker', 'defensive-shape', 'wingback'],
      slots: [
        s('GK', 50, Y.GK), s('DC', 30, Y.D, 'DCl'), s('DC', 50, Y.D, 'DCc'), s('DC', 70, Y.D, 'DCr'),
        s('WBL', 10, Y.WB), s('WBR', 90, Y.WB),
        s('MC', 30, Y.M, 'MCl'), s('MC', 50, Y.M, 'MCc'), s('MC', 70, Y.M, 'MCr'),
        s('ST', 40, Y.ST, 'STl'), s('ST', 60, Y.ST, 'STr')
      ],
      note: '3-5-2와 같은 배치지만 윙백을 수비적으로 두어 다섯 명이 뒤에 남습니다. 역습을 노릴 때의 기본형입니다.',
      strength: ['수비 라인 다섯 — 측면과 중앙 모두 뒤가 두꺼움', '투톱이 남아 있어 뺏자마자 곧바로 역습'],
      weakness: ['공격 시 인원이 부족해 점유율을 잡을 수 없음', '상대가 내려앉으면 공격 방법이 사라짐']
    },
    {
      id: '343', ko: '3-4-3', tags: ['three-at-back', 'wide', 'attacking', 'wingback'],
      slots: [
        s('GK', 50, Y.GK), s('DC', 30, Y.D, 'DCl'), s('DC', 50, Y.D, 'DCc'), s('DC', 70, Y.D, 'DCr'),
        s('WBL', 10, Y.WB), s('MC', 38, Y.M, 'MCl'), s('MC', 62, Y.M, 'MCr'), s('WBR', 90, Y.WB),
        s('AML', 18, Y.AM), s('ST', 50, Y.ST), s('AMR', 82, Y.AM)
      ],
      note: '스리백 위에 네 명, 앞에 셋. 앞선 셋과 윙백이 함께 상대 백4를 넓게 늘립니다.',
      strength: ['앞선 3명 + 윙백 2명 = 측면에서 항상 수적 우위', '스리백이 상대 최전방을 수적으로 압도'],
      weakness: ['중앙 미드필더 둘뿐 — 중원 셋 이상 상대에게 밀림', '윙백과 측면 공격수가 동시에 올라가면 뒤가 크게 비고 센터백 셋이 넓은 지역을 감당해야 함']
    },
    {
      id: '523', ko: '5-2-3 WB', tags: ['three-at-back', 'wide', 'defensive-shape', 'wingback', 'press'],
      slots: [
        s('GK', 50, Y.GK), s('DC', 30, Y.D, 'DCl'), s('DC', 50, Y.D, 'DCc'), s('DC', 70, Y.D, 'DCr'),
        s('WBL', 10, Y.WB), s('WBR', 90, Y.WB),
        s('MC', 38, Y.M, 'MCl'), s('MC', 62, Y.M, 'MCr'),
        s('AML', 18, Y.AM), s('ST', 50, Y.ST), s('AMR', 82, Y.AM)
      ],
      note: '뒤에 다섯을 두고 앞에 셋을 남깁니다. 수비는 두껍게 하면서 역습 인원은 확보하는 절충안입니다.',
      strength: ['뒤 5명 + 앞 3명 — 수비와 역습을 동시에', '앞선 셋이 상대 빌드업을 압박할 수 있음'],
      weakness: ['중앙 미드필더 둘 — 중원을 계속 내줌', '앞과 뒤가 끊겨 중간이 텅 비기 쉬움']
    },
    {
      id: '541', ko: '5-4-1 WB', tags: ['three-at-back', 'defensive-shape', 'wingback', 'wide'],
      slots: [
        s('GK', 50, Y.GK), s('DC', 30, Y.D, 'DCl'), s('DC', 50, Y.D, 'DCc'), s('DC', 70, Y.D, 'DCr'),
        s('WBL', 8, Y.WB), s('WBR', 92, Y.WB),
        s('ML', 18, Y.M), s('MC', 38, Y.M, 'MCl'), s('MC', 62, Y.M, 'MCr'), s('MR', 82, Y.M),
        s('ST', 50, Y.ST)
      ],
      note: '가장 수비적인 형태. 아홉 명이 공 뒤에 서서 공간을 지웁니다.',
      strength: ['두 줄 다섯·넷 — 뚫을 공간이 거의 없음', '측면에 윙백과 측면 미드필더가 겹쳐 서서 2대1을 허용하지 않음'],
      weakness: ['공격 인원이 사실상 없음 — 세트피스와 역습에 의존', '한 골 뒤지는 순간 전술 자체를 바꿔야 함']
    },
    {
      id: '3412', ko: '3-4-1-2', tags: ['three-at-back', 'two-striker', 'narrow', 'wingback'],
      slots: [
        s('GK', 50, Y.GK), s('DC', 30, Y.D, 'DCl'), s('DC', 50, Y.D, 'DCc'), s('DC', 70, Y.D, 'DCr'),
        s('WBL', 10, Y.WB), s('MC', 38, Y.M, 'MCl'), s('MC', 62, Y.M, 'MCr'), s('WBR', 90, Y.WB),
        s('AMC', 50, Y.AM), s('ST', 40, Y.ST, 'STl'), s('ST', 60, Y.ST, 'STr')
      ],
      note: '스리백 위에 윙백 둘과 중앙 미드필더 둘, 그 위에 10번과 투톱. 중앙 연계와 측면 폭을 함께 가져갑니다.',
      strength: ['10번과 투톱이 좁은 삼각형을 만들고 윙백이 폭을 담당', '스리백이 상대 투톱을 수적으로 상대'],
      weakness: ['중앙 미드필더 둘이 넓은 지역을 감당해야 함', '윙백이 내려가면 앞선 셋이 고립됨']
    },
    {
      id: '3142', ko: '3-1-4-2', tags: ['three-at-back', 'two-striker', 'dm-anchored', 'wide'],
      slots: [
        s('GK', 50, Y.GK), s('DC', 30, Y.D, 'DCl'), s('DC', 50, Y.D, 'DCc'), s('DC', 70, Y.D, 'DCr'),
        s('DM', 50, Y.DM),
        s('ML', 14, Y.M), s('MC', 38, Y.M, 'MCl'), s('MC', 62, Y.M, 'MCr'), s('MR', 86, Y.M),
        s('ST', 40, Y.ST, 'STl'), s('ST', 60, Y.ST, 'STr')
      ],
      note: '스리백과 수비형 미드필더로 뒤를 네 겹으로 만들고, 그 앞에 네 명과 투톱을 둡니다.',
      strength: ['스리백 + 수비형 미드필더 — 중앙 뒷공간이 거의 없음', '미드필더 넷과 투톱으로 앞선 인원도 충분'],
      weakness: ['측면 미드필더가 윙백 없이 측면 전체를 감당해야 함', '인원이 앞뒤로 갈려 중간 연결이 끊기기 쉬움']
    }
  ];

  root.FM_FORMATION_DATA = { FORMATIONS: FORMATIONS, Y: Y };
})(typeof window !== 'undefined' ? window : globalThis);

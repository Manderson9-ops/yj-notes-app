// FAKE 알림장 자료(합성). mock API 전용이며 빌드에 들어가지 않는다. 이름은 테스트아이·교사A·친구A/B 만 쓴다.
import { previewOfDay } from "../../src/lib/notePreview.ts";
import type { NoteComment, NoteDay, NoteReport } from "../../src/lib/notesSchemas.ts";

const PIECES = [
  "블록을 높이 쌓고 무너뜨리기를 반복했어요.",
  "친구A 옆에 앉아 그림책을 한참 봤어요.",
  "교사A가 이름을 부르면 돌아보며 웃었어요.",
  "모래놀이터에서 삽으로 모래를 퍼 담았어요.",
  "점심은 밥과 국을 절반쯤 먹었어요.",
  "낮잠은 한 시간 반쯤 잤어요.",
  "친구B가 울자 곁에서 지켜봤어요.",
  "색연필로 동그라미를 여러 개 그렸어요.",
  "미끄럼틀을 여러 번 타고 손뼉을 쳤어요.",
  "노래 시간에 리듬악기를 흔들었어요.",
  "비눗방울을 쫓아 뛰어다녔어요.",
  "정리 시간에 장난감을 바구니에 담았어요.",
];
const COMMENT_PARENT = [
  "잘 지냈다니 다행이에요. 감사합니다.",
  "집에서도 이야기해 볼게요.",
  "고맙습니다.",
];
const COMMENT_TEACHER = ["내일도 즐겁게 지내요.", "필요하면 말씀해 주세요."];

export const MOCK_CLASS = "합성반";
const DAYS = 62;
const START = Date.UTC(2020, 2, 2); // 2020-03-02

export const dateOf = (i: number): string =>
  new Date(START + i * 86_400_000).toISOString().slice(0, 10);

/** 합성 생일 2020-01-15 기준 개월 수 */
function ageMonths(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return (y - 2020) * 12 + (m - 1) - (d < 15 ? 1 : 0);
}

function build(i: number): NoteDay {
  const date = dateOf(i);
  const pick = (k: number): string => PIECES[(i * 5 + k) % PIECES.length] ?? "";
  let body = `${pick(0)} ${pick(1)}\n${pick(2)} ${pick(3)}`;
  if (i % 7 === 3) body += `\n${pick(4)}`;
  let comments: NoteComment[] = [];
  if (i % 4 !== 0) {
    comments = [
      {
        id: i * 10 + 1,
        who: "parent",
        postedAt: `${date} 17:00`,
        body: COMMENT_PARENT[i % 3] ?? "",
      },
    ];
    if (i % 3 === 0) {
      comments.push({
        id: i * 10 + 2,
        who: "teacher",
        postedAt: `${date} 17:05`,
        body: COMMENT_TEACHER[i % 2] ?? "",
      });
    }
  }
  const items: NoteReport[] = [
    {
      reportId: 8_000_000 + i * 10,
      authorRole: "교사",
      direction: "to_home",
      weather: i % 2 === 0 ? "맑음" : null,
      postedAt: `${date} 16:10`,
      body,
      comments,
    },
  ];
  // 경계값: 하루 2건(가정 메모 포함), 빈 본문, 이모지, 아주 긴 글
  if (i === 9) {
    items.unshift({
      reportId: 8_000_000 + i * 10 + 1,
      authorRole: "엄마",
      direction: "to_center",
      weather: null,
      postedAt: `${date} 08:30`,
      body: "가정에서 보낸 메모: 아침에 일찍 일어났어요.",
      comments: [],
    });
  }
  // 인사말(안부 질문)로 시작하는 글: 목록 첫 줄은 인사말을 건너뛴 다음 줄이어야 한다. 공백이 겹친 줄도 섞는다.
  if (i === 5) {
    items[0] = {
      ...items[0],
      body: `테스트아이와  즐거운 주말 보내셨나요?\n\n${pick(1)}\n${pick(2)}`,
    } as NoteReport;
  }
  // 하루 두 건(앞은 짧은 안내, 뒤는 활동 글): 목록은 더 긴 글의 줄을 보인다.
  if (i === 30) {
    items.unshift({
      reportId: 8_000_000 + i * 10 + 1,
      authorRole: "교사",
      direction: "to_home",
      weather: null,
      postedAt: `${date} 09:40`,
      body: "준비물을 내일까지 보내 주세요.",
      comments: [],
    });
  }
  if (i === 20) items[0] = { ...items[0], body: "", comments: [] } as NoteReport;
  if (i === 22)
    items[0] = { ...items[0], body: `오늘은 기분이 좋아 보였어요 😊 ${pick(1)}` } as NoteReport;
  if (i === 40) {
    const long = Array.from({ length: 30 }, (_, k) => `${pick(k)} ${pick(k + 3)}`).join("\n\n");
    items[0] = { ...items[0], body: long } as NoteReport;
  }
  return { date, class: MOCK_CLASS, ageMonths: ageMonths(date), items, prev: null, next: null };
}

/** 날짜 오름차순 전체 자료 */
export const MOCK_DAYS: NoteDay[] = Array.from({ length: DAYS }, (_, i) => build(i));

export const firstLineOf = (d: NoteDay): string => previewOfDay(d.items);
export const commentCount = (d: NoteDay): number =>
  d.items.reduce((n, r) => n + r.comments.length, 0);

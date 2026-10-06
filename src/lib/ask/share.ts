// font-subset: skip (공유 글은 메신저로 나가는 본문이라 장식 글꼴 대상이 아니다 — tools/fonts/collect.ts)
// 물어보기 공유 글 생성(T-Q3 §6). 순수 함수: 입력 → 문자열. 가족 단톡(메신저)에 붙여 넣기 좋은 모양(이모지·구분선 허용).
// 정적 문구는 짧게 나눠 둔다(번들 한글 장문 검사 G7).
import { levelInfo } from "../../../shared/ask-levels";
import type { Answer } from "../../../shared/ask-schema";
import { seoulDateOf } from "../dateFormat";

/** 공유 글 길이 상한(메신저 한 통에 들어가는 길이, UTF-16 길이 기준). */
export const SHARE_MAX = 3000;
const BAR = "━━━━━━━━━━";
const BLANK = "";

/** summary: 「짧게」, full: 「자세히」(상황 요약·기록·근거·한계까지). */
export type ShareMode = "summary" | "full";

export interface ShareInput {
  id: number;
  body: string;
  askedBy: string;
  /** 질문 시각(ISO). 날짜는 한국 시간. */
  createdAt: string;
  answer: Answer;
  /** 단계(not_behavior 는 null: 단계는 어디에도 쓰지 않는다). */
  level: number | null;
  redFlag?: boolean;
  /** 앱 주소(예: https://example.test). 끝 슬래시는 떼어 쓴다. */
  origin: string;
  mode?: ShareMode;
}

/** 연락처(기관·전문가·119)가 적힌 「올라가는 신호」만 모은다. */
const CONTACT =
  /소아과|어린이집|선생님|발달|상담|언어재활사|클리닉|정신건강|119|병원|응급|센터|의사/;

export function shareUrl(origin: string, id: number): string {
  return `${origin.replace(/\/+$/, "")}/ask/${String(id)}`;
}

/** 「2020-03-05」 → 「3월 5일」 (연도 없음). */
export function monthDay(date: string): string {
  const [, m = "0", d = "0"] = date.split("-");
  return `${String(Number(m))}월 ${String(Number(d))}일`;
}

/** 공유 시트의 제목. */
export function shareTitle(input: Pick<ShareInput, "createdAt">): string {
  return `물어보기 ${monthDay(seoulDateOf(input.createdAt))}`;
}

/** 글자 단위(가능하면 grapheme)로 자른다: 이모지·합자가 반으로 잘리지 않는다. 길이는 UTF-16 기준 max 이하(말줄임 포함). */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const limit = Math.max(0, max - 1);
  const parts: string[] =
    typeof Intl.Segmenter === "function"
      ? Array.from(
          new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(s),
          (x) => x.segment,
        )
      : Array.from(s);
  let out = "";
  for (const p of parts) {
    if (out.length + p.length > limit) break;
    out += p;
  }
  return `${out}…`;
}

/** 「지금 바로 119에 전화해요」 → 「119에 전화해요」 (앞의 지금/바로를 뗀다). */
export function stripUrgency(action: string): string {
  return action.replace(/^(?:(?:지금|바로)\s*)+/, "").trim();
}

interface Section {
  id: string;
  lines: string[];
}

/** 길이가 넘을 때 빼는 순서(앞에서부터). 단계·해 볼 것은 빼지 않고, 「이럴 땐 상담」은 가장 마지막에 뺀다. */
const DROP_ORDER = [
  "limits",
  "forAsker",
  "evidence",
  "records",
  "summary",
  "observe",
  "avoid",
  "contact",
] as const;

/** 구역(표시 순서). */
function behaviorSections(a: Answer, level: number | null, mode: ShareMode): Section[] {
  const out: Section[] = [];
  // level 이 null 이면 단계 줄 자체를 만들지 않는다.
  out.push({
    id: "level",
    lines:
      level === null
        ? [a.levelReason]
        : [`📊 단계 ${String(level)}/10 · ${levelInfo(level).title}`, a.levelReason],
  });
  if (mode === "full") out.push({ id: "summary", lines: ["📌 상황 요약", a.summary] });
  out.push({
    id: "try",
    lines: [
      "✅ 지금 해 볼 것",
      ...a.tryNow.flatMap((t, i) => [
        `${String(i + 1)}. ${t.action}`,
        ...(t.say ? [`   👉 「${t.say}」`] : []),
      ]),
    ],
  });
  out.push({ id: "avoid", lines: ["❌ 피할 것", ...a.avoid.map((x) => `- ${x}`)] });
  if (a.observe)
    out.push({
      id: "observe",
      lines: [`👀 지켜볼 것: ${a.observe.what} (${a.observe.howLong})`],
    });
  const contacts = a.upIf.filter((u) => CONTACT.test(u));
  if (contacts.length > 0)
    out.push({ id: "contact", lines: ["⬆️ 이럴 땐 상담", ...contacts.map((c) => `- ${c}`)] });
  if (mode === "full") {
    if (a.fromRecords.length > 0) {
      out.push({
        id: "records",
        lines: [
          "📖 기록에서 본 것",
          ...a.fromRecords.map((r) => `- ${monthDay(r.date)} ${r.what} (${r.link})`),
        ],
      });
    }
    out.push({ id: "evidence", lines: ["🔎 근거", ...a.evidence.map((e) => `- ${e.point}`)] });
    out.push({ id: "forAsker", lines: ["🙋 질문하신 분께", a.forAsker] });
    if (a.limits) out.push({ id: "limits", lines: ["ℹ️ 한계", a.limits] });
  }
  return out;
}

/** 공유 글을 만든다. 3,000자 이하(넘으면 자세히 구역 → 질문 글 → 구역 끝 순으로 줄인다). */
export function buildShareText(input: ShareInput): string {
  const mode = input.mode ?? "summary";
  const a = input.answer;
  const head = `📝 아이 물어보기 (${monthDay(seoulDateOf(input.createdAt))} · 질문: ${input.askedBy})`;
  const foot = `앱에서 보기: ${shareUrl(input.origin, input.id)} (가족 PIN 필요)`;
  const notBehavior = a.kind === "not_behavior";

  // 위급: 맨 위 한 줄. 행동 질문이 아닌 글이 위급으로 들어오면 고정 문구(처치 내용 없음)
  const red: string[] = [];
  if (input.redFlag === true) {
    const first = notBehavior ? undefined : a.tryNow[0];
    red.push(
      first
        ? `🚨 위급 신호: ${stripUrgency(first.action)}`
        : "🚨 위급 신호예요. 앱에서 안내를 확인해요.",
      BLANK,
    );
  }

  const sections: Section[] = notBehavior
    ? [{ id: "notice", lines: ["ℹ️ 안내", a.summary, a.levelReason] }]
    : behaviorSections(a, input.level, mode);

  /** 구역은 빈 줄로 나눈다(구분선 바로 뒤에는 빈 줄 없음). */
  const body = (secs: Section[]): string[] =>
    secs.flatMap((s, i) => (i === 0 ? s.lines : [BLANK, ...s.lines]));
  const build = (question: string, secs: Section[]): string =>
    [...red, head, BAR, "💬 질문", question, BAR, ...body(secs), BAR, foot].join("\n");

  let secs = sections;
  let question = input.body.trim();
  let text = build(question, secs);
  // 1) 질문 글을 먼저 400자로 줄인다
  if (text.length > SHARE_MAX) {
    question = clip(question, 400);
    text = build(question, secs);
  }
  // 2) 그래도 길면 덜 중요한 구역부터 뺀다(상담 구역이 마지막, 단계·해 볼 것은 남긴다)
  for (const id of DROP_ORDER) {
    if (text.length <= SHARE_MAX) break;
    if (!secs.some((x) => x.id === id)) continue;
    secs = secs.filter((x) => x.id !== id);
    text = build(question, secs);
  }
  // 3) 그래도 길면 가운데를 자르되 끝의 구분선과 링크 줄은 지킨다
  if (text.length > SHARE_MAX) {
    const tail = `\n${BAR}\n${foot}`;
    const upper = text.slice(0, text.length - tail.length);
    text = `${clip(upper, SHARE_MAX - tail.length)}${tail}`;
  }
  return text;
}

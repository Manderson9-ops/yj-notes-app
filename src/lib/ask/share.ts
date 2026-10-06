// font-subset: skip (공유 글은 메신저로 나가는 본문이라 장식 글꼴 대상이 아니다 — tools/fonts/collect.ts)
// 물어보기 공유 글 생성(T-Q3 §6). 순수 함수: 입력 → 문자열. 가족 단톡(메신저)에 붙여 넣기 좋은 모양(이모지·구분선 허용).
// 정적 문구는 짧게 나눠 둔다(번들 한글 장문 검사 G7).
import { levelInfo } from "../../../shared/ask-levels";
import type { Answer } from "../../../shared/ask-schema";
import { seoulDateOf } from "../dateFormat";

/** 공유 글 길이 상한(메신저 한 통에 들어가는 길이). */
export const SHARE_MAX = 3000;
const BAR = "━━━━━━━━━━";
const BLANK = "";

export type ShareMode = "summary" | "full";

export interface ShareInput {
  id: number;
  body: string;
  askedBy: string;
  /** 질문 시각(ISO). 날짜는 한국 시간. */
  createdAt: string;
  answer: Answer;
  /** 단계(not_behavior 는 null). */
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

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

/** 공유 글의 제목(공유 시트의 title). */
export function shareTitle(input: Pick<ShareInput, "createdAt">): string {
  return `물어보기 ${seoulDateOf(input.createdAt)}`;
}

/** 각 구역은 줄 목록. 길이가 넘으면 뒤쪽(덜 중요한) 구역부터 뺀다. */
function behaviorSections(a: Answer, level: number | null, mode: ShareMode): string[][] {
  const out: string[][] = [];
  const lv = level ?? a.level;
  out.push([`📊 단계 ${String(lv)} · ${levelInfo(lv).title}`, a.levelReason]);
  if (mode === "full") out.push(["📌 상황 요약", a.summary]);
  out.push([
    "✅ 지금 해 볼 것",
    ...a.tryNow.flatMap((t, i) => [
      `${String(i + 1)}. ${t.action}`,
      ...(t.say ? [`   👉 「${t.say}」`] : []),
    ]),
  ]);
  out.push(["❌ 피할 것", ...a.avoid.map((x) => `- ${x}`)]);
  if (a.observe) out.push([`👀 지켜볼 것: ${a.observe.what} (${a.observe.howLong})`]);
  const contacts = a.upIf.filter((u) => CONTACT.test(u));
  if (contacts.length > 0) out.push([`⬆️ 이럴 땐 상담: ${contacts.join(" / ")}`]);
  if (mode === "full") {
    if (a.fromRecords.length > 0) {
      out.push([
        "📖 기록에서 본 것",
        ...a.fromRecords.map((r) => `- ${r.date} ${r.what} (${r.link})`),
      ]);
    }
    out.push(["🔎 근거", ...a.evidence.map((e) => `- ${e.point}`)]);
    out.push(["🙋 질문하신 분께", a.forAsker]);
    if (a.limits) out.push(["ℹ️ 한계", a.limits]);
  }
  return out;
}

/** 공유 글을 만든다. 3,000자 이하(넘으면 전체 구역 → 질문 글 → 구역 끝 순으로 줄인다). */
export function buildShareText(input: ShareInput): string {
  const mode = input.mode ?? "summary";
  const a = input.answer;
  const head = `📝 아이 물어보기 (${seoulDateOf(input.createdAt)} · 질문: ${input.askedBy})`;
  const foot = `앱에서 보기: ${shareUrl(input.origin, input.id)} (가족 PIN 필요)`;
  const red =
    input.redFlag === true && a.kind === "behavior" && a.tryNow[0]
      ? [`🚨 위급: 지금 바로 ${a.tryNow[0].action}`, BLANK]
      : [];

  let sections: string[][];
  if (a.kind === "not_behavior") {
    // 행동 질문이 아닌 글: 질문·요약·안내만(단계·기록·근거 없음)
    sections = [[a.summary], [a.levelReason]];
  } else {
    sections = behaviorSections(a, input.level, mode);
  }

  const build = (question: string, secs: string[][]): string =>
    [...red, head, BAR, "💬 질문", question, BAR, ...secs.flatMap((s) => s), BAR, foot].join("\n");

  let secs = sections;
  let question = input.body.trim();
  let text = build(question, secs);
  // 1) 뒤쪽 구역부터 뺀다(해 볼 것까지는 남긴다)
  const keep = a.kind === "not_behavior" ? secs.length : 3;
  while (text.length > SHARE_MAX && secs.length > keep) {
    secs = secs.slice(0, -1);
    text = build(question, secs);
  }
  // 2) 질문 글을 줄인다
  if (text.length > SHARE_MAX) {
    question = clip(question, Math.max(80, 400));
    text = build(question, secs);
  }
  // 3) 그래도 길면 머리·끝을 지키고 가운데를 자른다(해 볼 것 줄은 짧은 편이라 드물다)
  if (text.length > SHARE_MAX) {
    const room = SHARE_MAX - foot.length - 2;
    text = `${clip(text.slice(0, text.length - foot.length - 1), room)}\n${foot}`;
  }
  return text;
}

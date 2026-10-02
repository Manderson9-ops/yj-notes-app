// 알림장 목록·홈에 보일 한 줄(미리보기) 고르기. 서버(server/routes)와 mock 이 같이 쓴다. 의존 없음.
// 목적: 「오늘 뭐 했나」가 첫 줄에 보이게. 인사말(안부 질문)만 있는 첫 줄은 건너뛴다.
// 규칙(실제 자료 점검에서 나온 패턴만, 내용 예시는 두지 않는다):
//  1) 하루에 글이 여럿이면 집에서 보낸 글보다 알림장을, 그중 가장 긴 글을 쓴다.
//  2) 줄 안 공백은 하나로 줄인다.
//  3) 첫 단락이 한 줄이고 물음표로 끝나는 짧은 안부 질문이거나 "안녕하세요" 로 시작하는 짧은 인사면, 뒤에 줄이 있을 때 건너뛴다(최대 2줄).
//  4) 너무 길면 단어 경계에서 자르고 … 를 붙인다.

export interface PreviewItem {
  direction: string;
  body: string;
}

const MAX_CHARS = 90;
const GREETING_MAX = 45;

const squeeze = (s: string): string => s.replace(/[\s\u00a0\u3000]+/g, " ").trim();

const endsWithQuestion = (s: string): boolean =>
  /[?？][\s\p{Extended_Pictographic}\p{P}~^]*$/u.test(s);

function isGreeting(line: string, singleLineParagraph: boolean): boolean {
  if (/^안녕(하세요|하십니까)/.test(line) && Array.from(line).length <= GREETING_MAX) return true;
  return singleLineParagraph && endsWithQuestion(line) && Array.from(line).length <= GREETING_MAX;
}

function cut(line: string): string {
  const chars = Array.from(line);
  if (chars.length <= MAX_CHARS) return line;
  const head = chars.slice(0, MAX_CHARS).join("");
  const space = head.lastIndexOf(" ");
  const base = space >= MAX_CHARS * 0.6 ? head.slice(0, space) : head;
  return `${base.trimEnd()}…`;
}

/** 본문 하나에서 미리보기 줄. 비어 있으면 "". */
export function previewOfBody(body: string): string {
  const paragraphs = body
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((p) =>
      p
        .split("\n")
        .map(squeeze)
        .filter((l) => l !== ""),
    )
    .filter((p) => p.length > 0);
  const flat = paragraphs.flatMap((p) => p.map((line) => ({ line, single: p.length === 1 })));
  let i = 0;
  while (
    i < 2 &&
    i < flat.length - 1 &&
    isGreeting(flat[i]?.line ?? "", flat[i]?.single ?? false)
  ) {
    i += 1;
  }
  return cut(flat[i]?.line ?? "");
}

/** 하루치 글들에서 미리보기 줄. */
export function previewOfDay(items: readonly PreviewItem[], fallback = ""): string {
  const filled = items.filter((r) => r.body.trim() !== "");
  if (filled.length === 0) return fallback === "" ? "" : previewOfBody(fallback);
  const home = filled.filter((r) => r.direction === "to_home");
  const pool = home.length > 0 ? home : filled;
  const main = pool.reduce((a, b) => (b.body.length > a.body.length ? b : a));
  return previewOfBody(main.body);
}

// 자료 목록 카드의 설명 한 줄. 문서 앞부분에서 첫 설명 문단을 뽑는다. 서버(server/routes/reports.ts)와 mock 이 같이 쓴다.
// 제목·표·목록·코드·구분선·접는 칸 줄은 건너뛰고, 없으면 첫 인용문을 쓴다. HTML 문서는 첫 <p> 의 글자만 쓴다.

const MAX_CHARS = 60;
const MIN_CHARS = 6;

const squeeze = (s: string): string => s.replace(/[\s\u00a0\u3000]+/g, " ").trim();

function cut(text: string): string | null {
  const t = squeeze(text);
  if (Array.from(t).length < MIN_CHARS) return null;
  const chars = Array.from(t);
  if (chars.length <= MAX_CHARS) return t;
  const head = chars.slice(0, MAX_CHARS).join("");
  const space = head.lastIndexOf(" ");
  return `${(space >= MAX_CHARS * 0.6 ? head.slice(0, space) : head).trimEnd()}…`;
}

/** 굵게·기울임·코드·링크 기호를 벗긴다. */
export function stripInlineMarks(s: string): string {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
    .replace(/\*(?!\s)(.+?)\*/g, "$1")
    .replace(/<[^>]+>/g, "");
}

/**
 * 설명이 아닌 문단: 경로·파일 이름 꼴로 시작(`폴더/이름.확장자`), 따옴표 조각으로 시작, 생성·갱신·출처 같은 메타 문장.
 * 이런 문단은 건너뛰고 다음 문단을 본다.
 */
const PATHLIKE = /^[`([]?[\w.-]*[/\\][\w./\\-]*|^[`([]?[\w-]+\.(md|html|py|ts|csv|json|xlsx)\b/i;
const QUOTE_LEAD = /^["'「『“‘<]/;
const META_LEAD =
  /^(자동\s*생성|생성\s*(일|됨|도구)|갱신|마지막\s*(갱신|수정)|작성\s*(일|자)|수정\s*(일|됨)|버전|출처|기준\s*일|업데이트|※|참고\s*:|주의\s*:)/;

export function isDescriptive(text: string): boolean {
  const t = text.trim();
  return !PATHLIKE.test(t) && !QUOTE_LEAD.test(t) && !META_LEAD.test(t);
}

export function summaryOfMarkdown(src: string): string | null {
  const lines = src
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  let fence = false;
  let para: string[] = [];
  let quote: string | null = null;
  const flush = (): string | null => {
    const plain = stripInlineMarks(para.join(" "));
    const out = para.length > 0 && isDescriptive(plain) ? cut(plain) : null;
    para = [];
    return out;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    if (line === "") {
      const got = flush();
      if (got) return got;
      continue;
    }
    if (line.startsWith(">")) {
      quote ??= cut(stripInlineMarks(line.replace(/^>\s?/, "")));
      flush();
      continue;
    }
    const skip =
      /^#{1,6}\s/.test(line) ||
      /^(\||<)/.test(line) ||
      /^([-*_])(\s*\1){2,}$/.test(line) ||
      /^([-*+]|\d+[.)])\s/.test(line);
    if (skip) {
      const got = flush();
      if (got) return got;
      continue;
    }
    para.push(line);
  }
  return flush() ?? quote;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  nbsp: " ",
};

export function summaryOfHtml(src: string): string | null {
  const body = src
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, "");
  for (const m of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = (m[1] ?? "")
      .replace(/<[^>]+>/g, "")
      .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_s, k: string) => ENTITIES[k] ?? "");
    if (!isDescriptive(text)) continue;
    const got = cut(text);
    if (got) return got;
  }
  return null;
}

/** head: 본문 앞부분(서버는 DB 에서 앞 일부만 읽는다). */
export function docSummary(kind: "html" | "markdown", head: string): string | null {
  return kind === "html" ? summaryOfHtml(head) : summaryOfMarkdown(head);
}

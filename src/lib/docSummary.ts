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

export function summaryOfMarkdown(src: string): string | null {
  const lines = src
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  let fence = false;
  let para: string[] = [];
  let quote: string | null = null;
  const flush = (): string | null => {
    const out = para.length > 0 ? cut(stripInlineMarks(para.join(" "))) : null;
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
    const got = cut(text);
    if (got) return got;
  }
  return null;
}

/** head: 본문 앞부분(서버는 DB 에서 앞 일부만 읽는다). */
export function docSummary(kind: "html" | "markdown", head: string): string | null {
  return kind === "html" ? summaryOfHtml(head) : summaryOfMarkdown(head);
}

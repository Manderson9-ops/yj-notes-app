// 아주 작은 안전 마크다운 파서. 원시 HTML 은 해석하지 않고 글자 그대로 둔다(렌더 쪽이 React 요소만 만든다).
// 지원: 제목(#~####), 문단, 목록(-,*,+,1.), 인용(>), 코드 블록(```), 구분선, 표(GFM 최소), 굵게·기울임·코드·링크.

export type Block =
  | { t: "h"; level: 1 | 2 | 3 | 4; text: string; id: string }
  | { t: "p"; text: string }
  | { t: "ul" | "ol"; items: string[] }
  | { t: "quote"; text: string }
  | { t: "code"; text: string }
  | { t: "hr" }
  | { t: "table"; head: string[]; rows: string[][] };

export type Inline =
  | { t: "text"; text: string }
  | { t: "code"; text: string }
  | { t: "strong"; text: string }
  | { t: "em"; text: string }
  | { t: "link"; text: string; href: string };

const HEADING = /^(#{1,4})\s+(.+?)\s*#*\s*$/;
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s*```/;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function startsBlock(line: string, next: string | undefined): boolean {
  return (
    HEADING.test(line) ||
    FENCE.test(line) ||
    HR.test(line) ||
    LIST_ITEM.test(line) ||
    /^\s*>/.test(line) ||
    (line.includes("|") && next !== undefined && TABLE_SEP.test(next))
  );
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let headingCount = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (FENCE.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i] ?? "")) {
        body.push(lines[i] ?? "");
        i++;
      }
      i++; // 닫는 울타리
      blocks.push({ t: "code", text: body.join("\n") });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      blocks.push({
        t: "h",
        level: (h[1] ?? "#").length as 1 | 2 | 3 | 4,
        text: h[2] ?? "",
        id: `sec-${String(headingCount++)}`,
      });
      i++;
      continue;
    }
    if (HR.test(line)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }
    if (line.includes("|") && TABLE_SEP.test(lines[i + 1] ?? "")) {
      const head = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? "").trim() !== "" && (lines[i] ?? "").includes("|")) {
        rows.push(splitRow(lines[i] ?? ""));
        i++;
      }
      blocks.push({ t: "table", head, rows });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? "")) {
        body.push((lines[i] ?? "").replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ t: "quote", text: body.join(" ") });
      continue;
    }
    const li = LIST_ITEM.exec(line);
    if (li) {
      const ordered = /^\d/.test(li[1] ?? "");
      const items: string[] = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i] ?? "");
        if (!m || /^\d/.test(m[1] ?? "") !== ordered) break;
        items.push(m[2] ?? "");
        i++;
      }
      blocks.push({ t: ordered ? "ol" : "ul", items });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() !== "" &&
      (para.length === 0 || !startsBlock(lines[i] ?? "", lines[i + 1]))
    ) {
      para.push((lines[i] ?? "").trim());
      i++;
    }
    blocks.push({ t: "p", text: para.join(" ") });
  }
  return blocks;
}

/** 링크로 만들어도 되는 주소인가: http(s), mailto 만. 그 밖(javascript:, data:, 상대 경로)은 글자로만 보인다. */
export function safeHref(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:"
      ? u.href
      : null;
  } catch {
    return null;
  }
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(!?\[([^\]]*)\]\(([^)\s]+)\))/g;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of src.matchAll(INLINE)) {
    const at = m.index;
    if (at > last) out.push({ t: "text", text: src.slice(last, at) });
    const token = m[0];
    if (m[1]) out.push({ t: "code", text: token.slice(1, -1) });
    else if (m[2]) out.push({ t: "strong", text: token.slice(2, -2) });
    else if (m[3]) out.push({ t: "em", text: token.slice(1, -1) });
    else {
      const label = m[5] ?? "";
      const href = token.startsWith("!") ? null : safeHref(m[6] ?? "");
      // 그림은 지원하지 않고 설명 글만 보인다. 안전하지 않은 주소는 링크 없이 글자만.
      if (href) out.push({ t: "link", text: label || href, href });
      else out.push({ t: "text", text: label });
    }
    last = at + token.length;
  }
  if (last < src.length) out.push({ t: "text", text: src.slice(last) });
  return out;
}

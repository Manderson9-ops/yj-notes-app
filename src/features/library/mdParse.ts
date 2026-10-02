// 아주 작은 안전 마크다운 파서. 원시 HTML 은 해석하지 않고 글자 그대로 둔다(렌더 쪽이 React 요소만 만든다).
// 예외로 해석하는 HTML 은 `<details>`/`<summary>` 줄과 `<br>` 뿐이다(실제 문서가 접는 칸·줄바꿈에 쓴다).
// 지원: 제목(#~####), 문단(줄 끝 공백 둘=줄바꿈), 목록(-,*,+,1.; 중첩·체크박스), 인용(>), 코드 블록(```), 구분선,
//       표(GFM 최소), 접는 칸, 굵게·기울임·취소선·코드·링크, 같은 폴더 문서(`NN-이름.md`) 링크.
// 지원하지 않음: 그림, 각주, 정의 목록, 인용 안의 다른 블록(실제 문서에 없음).

export interface ListItem {
  text: string;
  /** 체크박스 목록(`[ ]`/`[x]`)이면 true/false, 아니면 null */
  check: boolean | null;
  /** 이 항목 아래 들여쓴 하위 목록 */
  sub: ListBlock[];
}
export interface ListBlock {
  t: "ul" | "ol";
  items: ListItem[];
  /** 번호 목록의 첫 번호(빈 줄로 끊긴 목록이 1부터 다시 세지 않게) */
  start: number;
}

export type Block =
  | { t: "h"; level: 1 | 2 | 3 | 4; text: string; id: string }
  | { t: "p"; text: string }
  | ListBlock
  | { t: "quote"; paras: string[] }
  | { t: "code"; text: string }
  | { t: "hr" }
  | { t: "table"; head: string[]; rows: string[][] }
  | { t: "details"; summary: string; blocks: Block[] };

export type Inline =
  | { t: "text"; text: string }
  | { t: "code"; text: string }
  | { t: "br" }
  | { t: "strong" | "em" | "del"; children: Inline[] }
  | { t: "link"; children: Inline[]; href: string }
  | { t: "doc"; children: Inline[]; file: string };

const HEADING = /^(#{1,4})\s+(.+?)\s*#*\s*$/;
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s*```/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const DETAILS_OPEN = /^\s*<details(\s[^>]*)?>/i;
const SUMMARY = /<summary[^>]*>([\s\S]*?)<\/summary>/i;

interface Ctx {
  headings: number;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, "|").trim());
}

function startsBlock(line: string, next: string | undefined): boolean {
  return (
    HEADING.test(line) ||
    FENCE.test(line) ||
    HR.test(line) ||
    LIST_ITEM.test(line) ||
    DETAILS_OPEN.test(line) ||
    /^\s*>/.test(line) ||
    (line.includes("|") && next !== undefined && TABLE_SEP.test(next))
  );
}

const indentOf = (s: string): number => s.length - s.replace(/^[ \t]+/, "").length;
const hardBreak = (line: string): boolean => / {2,}$/.test(line) || line.endsWith("\\");
const joinLines = (parts: string[], breaks: boolean[]): string =>
  parts.reduce((acc, p, i) => (i === 0 ? p : `${acc}${breaks[i - 1] ? "\n" : " "}${p}`), "");

/** lines[i] 가 목록 항목일 때, 같은 들여쓰기의 목록 하나(하위 목록 포함)를 읽는다. */
function parseList(lines: string[], start: number): { block: ListBlock; next: number } {
  const first = LIST_ITEM.exec(lines[start] ?? "");
  const base = indentOf(first?.[1] ?? "");
  const ordered = /^\d/.test(first?.[2] ?? "");
  const items: ListItem[] = [];
  const startNo = ordered ? Number.parseInt(first?.[2] ?? "1", 10) : 1;
  let i = start;
  let lastBreak = false;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      // 빈 줄 뒤에도 같은 목록의 항목이 이어지면 한 목록으로 본다
      let j = i + 1;
      while (j < lines.length && (lines[j] ?? "").trim() === "") j++;
      const m = LIST_ITEM.exec(lines[j] ?? "");
      if (m && indentOf(m[1] ?? "") >= base && j < lines.length) {
        if (indentOf(m[1] ?? "") === base && /^\d/.test(m[2] ?? "") !== ordered) break;
        i = j;
        continue;
      }
      break;
    }
    const m = LIST_ITEM.exec(line);
    if (m) {
      const ind = indentOf(m[1] ?? "");
      if (ind >= base + 2) {
        const last = items[items.length - 1];
        if (!last) break;
        const sub = parseList(lines, i);
        last.sub.push(sub.block);
        i = sub.next;
        continue;
      }
      if (ind < base || /^\d/.test(m[2] ?? "") !== ordered) break;
      let text = m[3] ?? "";
      let check: boolean | null = null;
      const box = /^\[( |x|X)\]\s+(.*)$/.exec(text);
      if (box) {
        check = box[1] !== " ";
        text = box[2] ?? "";
      }
      lastBreak = hardBreak(text);
      items.push({ text: text.trim(), check, sub: [] });
      i++;
      continue;
    }
    // 이어지는 줄: 항목보다 더 들여쓴 줄만 그 항목 글에 붙인다
    const last = items[items.length - 1];
    if (last && indentOf(line) > base && !startsBlock(line, lines[i + 1])) {
      last.text = `${last.text}${lastBreak ? "\n" : " "}${line.trim()}`;
      lastBreak = hardBreak(line);
      i++;
      continue;
    }
    break;
  }
  return { block: { t: ordered ? "ol" : "ul", items, start: startNo }, next: i };
}

function parseLines(lines: string[], ctx: Ctx): Block[] {
  const blocks: Block[] = [];
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
    if (DETAILS_OPEN.test(line)) {
      // 같은 종류가 중첩돼도 짝을 센다. 닫는 태그가 없으면 끝까지 접는 칸 안으로 본다.
      let depth = 0;
      const chunk: string[] = [];
      while (i < lines.length) {
        const l = lines[i] ?? "";
        depth += (l.match(/<details(\s[^>]*)?>/gi) ?? []).length;
        depth -= (l.match(/<\/details>/gi) ?? []).length;
        chunk.push(l);
        i++;
        if (depth <= 0) break;
      }
      let inner = chunk.join("\n").replace(DETAILS_OPEN, "");
      const closeAt = inner.toLowerCase().lastIndexOf("</details>");
      if (closeAt >= 0) inner = inner.slice(0, closeAt);
      const sm = SUMMARY.exec(inner);
      const summary = (sm?.[1] ?? "").replace(/<[^>]+>/g, "").trim();
      if (sm) inner = inner.replace(SUMMARY, "");
      blocks.push({
        t: "details",
        summary: summary === "" ? "더 보기" : summary,
        blocks: parseLines(inner.split("\n"), ctx),
      });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      blocks.push({
        t: "h",
        level: (h[1] ?? "#").length as 1 | 2 | 3 | 4,
        text: h[2] ?? "",
        id: `sec-${String(ctx.headings++)}`,
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
      const paras: string[][] = [[]];
      const breaks: boolean[][] = [[]];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? "")) {
        const body = (lines[i] ?? "").replace(/^\s*>\s?/, "");
        if (body.trim() === "") {
          if ((paras[paras.length - 1] ?? []).length > 0) {
            paras.push([]);
            breaks.push([]);
          }
        } else {
          paras[paras.length - 1]?.push(body.trim());
          breaks[breaks.length - 1]?.push(hardBreak(body));
        }
        i++;
      }
      blocks.push({
        t: "quote",
        paras: paras.map((p, k) => joinLines(p, breaks[k] ?? [])).filter((p) => p !== ""),
      });
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const { block, next } = parseList(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }
    const para: string[] = [];
    const brk: boolean[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() !== "" &&
      (para.length === 0 || !startsBlock(lines[i] ?? "", lines[i + 1]))
    ) {
      const l = lines[i] ?? "";
      para.push(l.trim());
      brk.push(hardBreak(l));
      i++;
    }
    blocks.push({ t: "p", text: joinLines(para, brk) });
  }
  return blocks;
}

/** HTML 주석(`<!-- ... -->`, 여러 줄 가능)을 뺀다. 코드 블록 안은 그대로 둔다. 생성 도구가 문서 맨 위에 남기는 표시가 글자로 보이지 않게. */
export function stripComments(lines: string[]): string[] {
  const out: string[] = [];
  let fence = false;
  let open = false;
  for (const line of lines) {
    if (!open && FENCE.test(line)) {
      fence = !fence;
      out.push(line);
      continue;
    }
    if (fence) {
      out.push(line);
      continue;
    }
    let s = line;
    if (open) {
      const end = s.indexOf("-->");
      if (end < 0) continue;
      s = s.slice(end + 3);
      open = false;
    }
    s = s.replace(/<!--.*?-->/g, "");
    const start = s.indexOf("<!--");
    if (start >= 0) {
      s = s.slice(0, start);
      open = true;
    }
    out.push(s);
  }
  return out;
}

export function parseMarkdown(src: string): Block[] {
  return parseLines(stripComments(src.replace(/\r\n?/g, "\n").split("\n")), { headings: 0 });
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

/** 같은 폴더의 문서 링크(`NN-이름.md`, 선택적으로 `#절`). 스킴·경로 이동(`/`, `..`)이 있으면 아니다. */
export function docFileOf(raw: string): string | null {
  const m = /^([^/\\:#?]+\.md)(#.*)?$/i.exec(raw.trim());
  return m?.[1] ?? null;
}

// 순서가 곧 우선순위: 코드 > <br> > 링크(그림 포함) > 굵게 > 취소선 > 기울임
const INLINE =
  /(`[^`]+`)|(<br\s*\/?>)|(!?\[([^\]]*)\]\(([^)\s]+)\))|(\*\*(?=\S)(.+?)\*\*(?!\*))|(~~(?=\S)(.+?)~~)|(\*(?![\s*])(.+?)(?<![\s*])\*)/gi;

function textWithBreaks(text: string): Inline[] {
  const parts = text.split("\n");
  return parts.flatMap((p, i): Inline[] => {
    const out: Inline[] = [];
    if (i > 0) out.push({ t: "br" });
    if (p !== "") out.push({ t: "text", text: p });
    return out;
  });
}

export function parseInline(src: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of src.matchAll(INLINE)) {
    const at = m.index;
    if (at > last) out.push(...textWithBreaks(src.slice(last, at)));
    const token = m[0];
    const inner = (s: string | undefined): Inline[] =>
      depth < 4 ? parseInline(s ?? "", depth + 1) : [{ t: "text", text: s ?? "" }];
    if (m[1]) out.push({ t: "code", text: token.slice(1, -1) });
    else if (m[2]) out.push({ t: "br" });
    else if (m[3]) {
      const label = m[4] ?? "";
      const raw = m[5] ?? "";
      const href = token.startsWith("!") ? null : safeHref(raw);
      const file = token.startsWith("!") ? null : docFileOf(raw);
      // 그림은 지원하지 않고 설명 글만 보인다. 안전하지 않은 주소는 링크 없이 글자만.
      if (href) out.push({ t: "link", children: inner(label === "" ? href : label), href });
      else if (file) out.push({ t: "doc", children: inner(label === "" ? file : label), file });
      else out.push(...textWithBreaks(label));
    } else if (m[6]) out.push({ t: "strong", children: inner(m[7]) });
    else if (m[8]) out.push({ t: "del", children: inner(m[9]) });
    else out.push({ t: "em", children: inner(m[11]) });
    last = at + token.length;
  }
  if (last < src.length) out.push(...textWithBreaks(src.slice(last)));
  return out;
}

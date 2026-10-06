// 질문 즉시 결과: 알림장 본문·자료 제목에서 질문의 낱말을 찾는다. AI 없음, 결정적. 질문 글은 기록하지 않는다.
import { likePattern } from "../routes/notes";

const PARTICLES =
  /(?:에서|으로|하고|해요|했어요|해서|하는|은|는|이|가|을|를|에|도|의|로|와|과|랑)$/;
const SNIPPET_CHARS = 70;
export const INSTANT_MAX = 5;
const TOKENS_MAX = 4;

/** 질문에서 찾을 낱말(최대 4개, 긴 것 우선). 한 글자·숫자만인 것은 뺀다. */
export function questionTokens(body: string): string[] {
  const seen = new Set<string>();
  for (const raw of body.normalize("NFC").split(/[^\p{L}\p{N}]+/u)) {
    let w = raw.slice(0, 20);
    if (w.length >= 3) w = w.replace(PARTICLES, "");
    if (w.length >= 2 && !/^\p{N}+$/u.test(w)) seen.add(w);
  }
  return [...seen].sort((a, b) => b.length - a.length).slice(0, TOKENS_MAX);
}

export function snippetAround(body: string, tokens: readonly string[]): string {
  const flat = body.replace(/\s+/g, " ").trim();
  let at = -1;
  for (const t of tokens) {
    const i = flat.indexOf(t);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  const start = Math.max(0, (at === -1 ? 0 : at) - 20);
  const cut = flat.slice(start, start + SNIPPET_CHARS);
  return `${start > 0 ? "…" : ""}${cut}${start + SNIPPET_CHARS < flat.length ? "…" : ""}`;
}

export interface Instant {
  notes: { date: string; snippet: string; id: number }[];
  docs: { slug: string; title: string }[];
}

export async function instantResults(db: D1Database, body: string): Promise<Instant> {
  const tokens = questionTokens(body);
  if (tokens.length === 0) return { notes: [], docs: [] };
  const likes = tokens.map(likePattern);
  // 조건 개수만 바뀌는 고정 조각이다(낱말은 전부 bind).
  const noteWhere = likes.map(() => "body LIKE ? ESCAPE '\\'").join(" OR ");
  const docWhere = likes
    .map(() => "(title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')")
    .join(" OR ");
  const notes = await db
    .prepare(
      `SELECT report_id AS id, date, body FROM note_item WHERE ${noteWhere} ORDER BY date DESC, report_id DESC LIMIT ?`,
    )
    .bind(...likes, INSTANT_MAX)
    .all<{ id: number; date: string; body: string }>();
  const docs = await db
    .prepare(
      `SELECT slug, title FROM report_doc WHERE ${docWhere} ORDER BY generated_at DESC, slug ASC LIMIT ?`,
    )
    .bind(...likes.flatMap((l) => [l, l]), INSTANT_MAX)
    .all<{ slug: string; title: string }>();
  return {
    notes: notes.results.map((r) => ({
      id: r.id,
      date: r.date,
      snippet: snippetAround(r.body, tokens),
    })),
    docs: docs.results.map((r) => ({ slug: r.slug, title: r.title })),
  };
}

// 일치 강조용 글 조각 나누기. 서버가 준 범위(목록)와 검색어(상세) 두 경로를 같은 모양으로 돌려준다.
export interface Segment {
  text: string;
  hit: boolean;
}

/** [start, end) 범위들(오름차순, 겹치지 않음)로 text 를 나눈다. 범위가 text 를 넘으면 잘라 쓴다. */
export function segmentsByRanges(
  text: string,
  ranges: readonly (readonly [number, number])[],
): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const [s0, e0] of ranges) {
    const s = Math.max(at, Math.min(s0, text.length));
    const e = Math.max(s, Math.min(e0, text.length));
    if (e === s) continue;
    if (s > at) out.push({ text: text.slice(at, s), hit: false });
    out.push({ text: text.slice(s, e), hit: true });
    at = e;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out.length > 0 ? out : [{ text, hit: false }];
}

/** 대소문자 무시로 term 이 나오는 모든 곳을 강조 조각으로 나눈다. term 이 비면 한 조각. */
export function segmentsByTerm(text: string, term: string): Segment[] {
  if (term === "") return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  if (lower.length !== text.length) return [{ text, hit: false }];
  const ranges: [number, number][] = [];
  let from = 0;
  for (;;) {
    const at = lower.indexOf(needle, from);
    if (at < 0) break;
    ranges.push([at, at + needle.length]);
    from = at + needle.length;
  }
  return segmentsByRanges(text, ranges);
}

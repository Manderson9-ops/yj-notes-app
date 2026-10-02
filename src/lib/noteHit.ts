// 검색 일치 발췌 만들기: 서버(server/routes/notes.ts)와 mock 이 같이 쓴다. zod/DOM 의존 없음.
// 확장자 없는 import 를 피하려고(vite 설정 로더 경고) 응답 모양을 여기서 구조적으로 선언한다.
// notesSchemas.ts 의 noteHitSchema 와 같은 모양이며, server/notes.test.ts 가 zod 로 맞는지 검증한다.
export interface NoteHit {
  source: "body" | "comment";
  text: string;
  ranges: [number, number][];
  cutStart: boolean;
  cutEnd: boolean;
}

const BEFORE = 24;
const AFTER = 48;

const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/** 대소문자 무시 비교용. 길이가 달라지는 문자가 있으면 원문 그대로 비교한다. */
function fold(s: string): string {
  const lower = s.toLowerCase();
  return lower.length === s.length ? lower : s;
}

/** text 안에서 q 가 처음 나오는 곳 주변 발췌. 없으면 null. */
export function buildHit(text: string, q: string, source: NoteHit["source"]): NoteHit | null {
  if (q === "") return null;
  const hay = fold(text);
  const needle = fold(q);
  const idx = hay.indexOf(needle);
  if (idx < 0) return null;

  let start = Math.max(0, idx - BEFORE);
  let end = Math.min(text.length, idx + needle.length + AFTER);
  if (start > 0 && isLowSurrogate(text.charCodeAt(start))) start -= 1;
  if (end < text.length && isLowSurrogate(text.charCodeAt(end))) end += 1;

  const slice = text.slice(start, end).replace(/[\r\n\t]/g, " ");
  const sliceFolded = hay.slice(start, end).replace(/[\r\n\t]/g, " ");
  const ranges: [number, number][] = [];
  let from = 0;
  for (;;) {
    const at = sliceFolded.indexOf(needle, from);
    if (at < 0) break;
    ranges.push([at, at + needle.length]);
    from = at + needle.length;
  }
  return { source, text: slice, ranges, cutStart: start > 0, cutEnd: end < text.length };
}

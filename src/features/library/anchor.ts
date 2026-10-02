// 문서 주소의 `#절번호`(예: `#3-1`)가 가리키는 제목을 찾는다. 가족 기록 경고의 가이드 링크가 쓴다.
import type { Block } from "./mdParse";

/** 제목 글자가 절 번호로 시작하는지: "3-1. 제목", "3-1 제목", "3.1 제목" 모두 `3-1`. 뒤에 숫자·`-` 가 더 이어지면 다른 절이다. */
function startsWithSection(text: string, section: string): boolean {
  const norm = text.trim().replace(/^(\d+)\.(\d+)/, "$1-$2");
  if (!norm.startsWith(section)) return false;
  const next = norm.charAt(section.length);
  return next === "" || !/[0-9-]/.test(next);
}

/** 제목 id 를 돌려준다. 못 찾으면 null(화면은 문서 처음부터 보여 주고 안내한다). */
export function findHeadingId(blocks: readonly Block[], hash: string): string | null {
  let key = "";
  try {
    key = decodeURIComponent(hash.replace(/^#/, "")).trim();
  } catch {
    return null;
  }
  if (key === "") return null;
  const heads = blocks.filter((b) => b.t === "h");
  const byId = heads.find((b) => b.id === key);
  if (byId) return byId.id;
  if (!/^\d+(-\d+)*$/.test(key)) return null;
  const hit = heads.find((b) => startsWithSection(b.text, key));
  return hit ? hit.id : null;
}

// 유출 방지 가드 검사 함수 (순수 로직 + 파일 읽기). 실행기는 cli.ts.
// Guard check implementations. Never print matched sensitive text in full: use mask().
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ALLOWED_EMAIL_DOMAINS,
  BINARY_ALLOW_PREFIXES,
  BINARY_EXTENSIONS,
  BUNDLE_FORBIDDEN_WORDS,
  BUNDLE_LONG_RUN,
  CONTENT_PATTERNS,
  CONTENT_SCAN_SKIP,
  FORBIDDEN_BASENAME_EXCEPTIONS,
  FORBIDDEN_BASENAME_REGEXES,
  FORBIDDEN_DIRS,
  FORBIDDEN_PATH_REGEXES,
  MAX_TEXT_BYTES,
  SENTENCE_MAX_INDEX,
  SENTENCE_MIN_LETTERS,
  SENTENCE_WINDOW,
} from "./config.ts";

export type CheckId = "G1" | "G2" | "G3" | "G4" | "G5" | "G6" | "G7";

export interface Finding {
  id: CheckId;
  path: string;
  /** 1부터. 0 이면 경로 자체. / 1-based; 0 means the path itself. */
  line: number;
  message: string;
  /** 일부만 가린 일치 문자열. / Masked match. */
  masked?: string;
}

export interface Notice {
  level: "info" | "warn";
  id: CheckId;
  message: string;
}

/** 검사 대상 한 파일. content 가 없으면 본문 검사를 건너뛴다(경로 검사만). */
export interface GuardFile {
  /** 저장소(또는 번들 디렉터리) 기준 상대경로, / 구분. */
  path: string;
  content?: Buffer | undefined;
}

/** 중간 글자를 가린다. / Mask the middle of a string. */
export function mask(text: string): string {
  const chars = Array.from(text);
  if (chars.length <= 2) return "*".repeat(chars.length);
  if (chars.length <= 5) return chars[0]! + "*".repeat(chars.length - 1);
  return chars.slice(0, 2).join("") + "*".repeat(chars.length - 3) + chars[chars.length - 1]!;
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

// ───────────────────────── G1 ─────────────────────────
export function checkForbiddenPath(path: string): Finding | null {
  const p = normalizePath(path);
  const lower = p.toLowerCase();
  const segments = lower.split("/");
  const base = segments[segments.length - 1] ?? "";
  const dirs = segments.slice(0, -1);
  let label: string | null = null;
  for (const d of FORBIDDEN_DIRS) {
    if (dirs.includes(d)) label = `${d}/`;
  }
  for (const r of FORBIDDEN_PATH_REGEXES) if (r.re.test(lower)) label = r.label;
  if (!FORBIDDEN_BASENAME_EXCEPTIONS.includes(base)) {
    for (const r of FORBIDDEN_BASENAME_REGEXES) if (r.re.test(base)) label = r.label;
  }
  if (label === null) return null;
  return {
    id: "G1",
    path: p,
    line: 0,
    message: `금지 경로입니다 (${label}). 실제 자료·비밀값은 저장소에 둘 수 없습니다. / Forbidden path (${label}). Real data and secrets must never be committed.`,
  };
}

// ───────────────────────── G2 ─────────────────────────
export function checkBinaryFile(path: string): Finding | null {
  const p = normalizePath(path);
  const lower = p.toLowerCase();
  const ext = BINARY_EXTENSIONS.find((e) => lower.endsWith(e));
  if (ext === undefined) return null;
  if (BINARY_ALLOW_PREFIXES.some((a) => lower.startsWith(a))) return null;
  return {
    id: "G2",
    path: p,
    line: 0,
    message: `이미지·문서 바이너리(${ext})는 허용 폴더(${BINARY_ALLOW_PREFIXES.join(", ")}) 밖에 둘 수 없습니다. 스크린샷은 fixtures 로 만드세요. / Binary/document file (${ext}) outside allowed dirs; screenshots must use fixtures.`,
  };
}

// ───────────────────────── 텍스트 판정 ─────────────────────────
export function isScannableText(path: string, content: Buffer | undefined): content is Buffer {
  if (content === undefined) return false;
  if (content.length > MAX_TEXT_BYTES) return false;
  const p = normalizePath(path);
  if (CONTENT_SCAN_SKIP.some((s) => s.path.test(p))) return false;
  const head = content.subarray(0, 8000);
  return !head.includes(0);
}

function decode(content: Buffer): string {
  return content.toString("utf8").replace(/^\uFEFF/, "");
}

// ───────────────────────── G3 ─────────────────────────
function emailAllowed(email: string): boolean {
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  return ALLOWED_EMAIL_DOMAINS.includes(domain);
}

/** @param skipIds 건너뛸 패턴 id (번들 모드에서 vendor 이메일 제외 등) */
export function checkPatterns(
  path: string,
  text: string,
  skipIds: readonly string[] = [],
): Finding[] {
  const out: Finding[] = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const pat of CONTENT_PATTERNS) {
      if (skipIds.includes(pat.id)) continue;
      pat.re.lastIndex = 0;
      for (const m of line.matchAll(pat.re)) {
        if (pat.id === "email" && emailAllowed(m[0])) continue;
        out.push({
          id: "G3",
          path: normalizePath(path),
          line: i + 1,
          message: `${pat.label} 가 발견되었습니다. / Found: ${pat.label}.`,
          masked: mask(m[0]),
        });
      }
    }
  });
  return out;
}

// ───────────────────────── G4 ─────────────────────────
export function parseDenylist(raw: string): string[] {
  return raw
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
}

export function loadDenylist(dataDir: string): { terms: string[] | null; file: string } {
  const file = join(dataDir, ".guard", "denylist.txt");
  if (!existsSync(file)) return { terms: null, file };
  return { terms: parseDenylist(readFileSync(file, "utf8")), file };
}

export function checkDenylist(
  path: string,
  text: string | null,
  terms: readonly string[],
): Finding[] {
  const out: Finding[] = [];
  const lowerTerms = terms.map((t) => t.normalize("NFC").toLowerCase());
  const make = (line: number, term: string): Finding => ({
    id: "G4",
    path: normalizePath(path),
    line,
    message: `비공개 금지어 목록(denylist)의 단어가 발견되었습니다. / A denylist term was found.`,
    masked: mask(term),
  });
  const pathLower = normalizePath(path).normalize("NFC").toLowerCase();
  lowerTerms.forEach((t, k) => {
    if (pathLower.includes(t)) out.push(make(0, terms[k]!));
  });
  if (text === null) return out;
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const l = line.normalize("NFC").toLowerCase();
    lowerTerms.forEach((t, k) => {
      if (l.includes(t)) out.push(make(i + 1, terms[k]!));
    });
  });
  return out;
}

// ───────────────────────── G5 ─────────────────────────
const LETTER = /\p{L}/u;

function isLetter(code: number, ch: string): boolean {
  if (code < 128) return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
  return LETTER.test(ch);
}

/** 공백 정리(NFC) 한 텍스트와 문자별 원본 줄 번호. */
export function collapseText(text: string): { s: string; lineOf: Uint32Array } {
  const parts: string[] = [];
  const lineNos: number[] = [];
  text.split("\n").forEach((raw, i) => {
    const seg = raw.normalize("NFC").replace(/\s+/g, " ").trim();
    if (seg !== "") {
      parts.push(seg);
      lineNos.push(i + 1);
    }
  });
  const s = parts.join(" ");
  const lineOf = new Uint32Array(s.length);
  let pos = 0;
  parts.forEach((p, k) => {
    lineOf.fill(lineNos[k]!, pos, pos + p.length + 1 > s.length ? s.length : pos + p.length + 1);
    pos += p.length + 1;
  });
  return { s, lineOf };
}

const B1 = 1000003;
const B2 = 16777619;

/** 모든 SENTENCE_WINDOW 창에 대해 (키, 시작 위치) 를 넘긴다. 글자 수 부족 창은 건너뛴다. */
function forEachWindow(s: string, step: number, fn: (key: number, start: number) => void): void {
  const W = SENTENCE_WINDOW;
  if (s.length < W) return;
  let p1 = 1;
  let p2 = 1;
  for (let i = 0; i < W - 1; i++) {
    p1 = Math.imul(p1, B1);
    p2 = Math.imul(p2, B2);
  }
  const q1 = Math.imul(p1, B1);
  const q2 = Math.imul(p2, B2);
  let h1 = 0;
  let h2 = 0;
  let letters = 0;
  const isL: boolean[] = new Array<boolean>(s.length);
  for (let i = 0; i < s.length; i++) isL[i] = isLetter(s.charCodeAt(i), s[i]!);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = (Math.imul(h1, B1) + c) | 0;
    h2 = (Math.imul(h2, B2) + c) | 0;
    if (isL[i]) letters++;
    if (i >= W) {
      const o = s.charCodeAt(i - W);
      h1 = (h1 - Math.imul(o, q1)) | 0;
      h2 = (h2 - Math.imul(o, q2)) | 0;
      if (isL[i - W]) letters--;
    }
    if (i >= W - 1) {
      const start = i - W + 1;
      if (start % step === 0 && letters >= SENTENCE_MIN_LETTERS) {
        fn((h1 >>> 0) * 2097152 + (h2 >>> 11), start);
      }
    }
  }
}

export interface SentenceIndex {
  keys: Set<number>;
  stride: number;
  sources: number;
}

function* walkFiles(dir: string, ext: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walkFiles(full, ext);
    else if (e.isFile() && e.name.toLowerCase().endsWith(ext)) yield full;
  }
}

function stripFrontmatter(text: string): string {
  const t = text.replace(/^\uFEFF/, "");
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(t);
  return m ? t.slice(m[0].length) : t;
}

/** DATA_DIR 의 알림장 md 본문과 관측 CSV 에서 창 색인을 만든다. */
export function buildSentenceIndex(dataDir: string): SentenceIndex {
  const texts: string[] = [];
  for (const f of walkFiles(join(dataDir, "alrimjang"), ".md")) {
    texts.push(collapseText(stripFrontmatter(readFileSync(f, "utf8"))).s);
  }
  const csv = join(dataDir, "tracking", "observations.csv");
  if (existsSync(csv) && statSync(csv).isFile()) {
    const raw = readFileSync(csv, "utf8");
    texts.push(collapseText(raw).s);
    // 셀 단위(따옴표·쉼표로 나눈 조각)도 색인해 셀 경계가 창을 끊지 않게 한다.
    for (const cell of raw.split(/[\r\n,"]+/)) {
      const c = cell.normalize("NFC").replace(/\s+/g, " ").trim();
      if (c.length >= SENTENCE_WINDOW) texts.push(c);
    }
  }
  const total = texts.reduce((n, t) => n + t.length, 0);
  const stride = Math.max(1, Math.ceil(total / SENTENCE_MAX_INDEX));
  const keys = new Set<number>();
  for (const t of texts) forEachWindow(t, stride, (k) => keys.add(k));
  return { keys, stride, sources: texts.length };
}

export function checkSentences(path: string, text: string, index: SentenceIndex): Finding[] {
  if (index.keys.size === 0) return [];
  const { s, lineOf } = collapseText(text);
  const hitLines = new Map<number, number>(); // line -> start offset of first hit
  forEachWindow(s, 1, (key, start) => {
    if (index.keys.has(key)) {
      const line = lineOf[s[start] === " " ? start + 1 : start] ?? 1;
      if (!hitLines.has(line)) hitLines.set(line, start);
    }
  });
  return [...hitLines].map(([line, start]) => ({
    id: "G5" as const,
    path: normalizePath(path),
    line,
    message: `비공개 자료(알림장·관측)와 ${SENTENCE_WINDOW}자 이상 같은 문장이 있습니다. 실제 문장을 쓰지 말고 새로 쓰세요. / Text matches private source material (${SENTENCE_WINDOW}+ chars). Write synthetic text instead.`,
    masked: mask(s.slice(start, start + SENTENCE_WINDOW)),
  }));
}

// ───────────────────────── G7 ─────────────────────────
const HANGUL_RUN = /[가-힣ㄱ-ㅎㅏ-ㅣ ,.!?·…~:;()\-\u3000]+/g;
const HANGUL = /[가-힣]/;

export function parseAllowlist(raw: string): string[] {
  return raw
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
}

export function checkLongHangul(
  path: string,
  text: string,
  allowlist: readonly string[],
): Finding[] {
  const out: Finding[] = [];
  text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(HANGUL_RUN)) {
      const run = m[0].trim();
      if (run.length < BUNDLE_LONG_RUN || !HANGUL.test(run)) continue;
      if (allowlist.some((a) => a.includes(run))) continue;
      out.push({
        id: "G7",
        path: normalizePath(path),
        line: i + 1,
        message: `번들에 한글 ${BUNDLE_LONG_RUN}자 이상 연속 문구가 있습니다. UI 문구라면 tools/guard/bundle-allowlist.txt 에 명시하세요. / Long Hangul run in bundle; allowlist it explicitly if it is a UI string.`,
        masked: mask(run),
      });
    }
  });
  return out;
}

export function checkBundleWords(path: string, text: string): Finding[] {
  const out: Finding[] = [];
  const lower = text.toLowerCase();
  if (!BUNDLE_FORBIDDEN_WORDS.some((w) => lower.includes(w))) return out;
  text.split("\n").forEach((line, i) => {
    const l = line.toLowerCase();
    for (const w of BUNDLE_FORBIDDEN_WORDS) {
      if (l.includes(w)) {
        out.push({
          id: "G7",
          path: normalizePath(path),
          line: i + 1,
          message: `번들에 금지 표지어가 있습니다. / Forbidden marker word found in bundle.`,
          masked: mask(w),
        });
      }
    }
  });
  return out;
}

export function checkBundlePath(path: string): Finding[] {
  const p = normalizePath(path);
  const out: Finding[] = [];
  if (p.toLowerCase().endsWith(".map")) {
    out.push({
      id: "G7",
      path: p,
      line: 0,
      message: "소스맵(*.map)은 배포물에 넣지 않습니다. / Source maps must not be shipped.",
    });
  }
  const lower = p.toLowerCase();
  if (BUNDLE_FORBIDDEN_WORDS.some((w) => lower.includes(w))) {
    out.push({
      id: "G7",
      path: p,
      line: 0,
      message: "파일 이름에 금지 표지어가 있습니다. / Forbidden marker word in file name.",
    });
  }
  return out;
}

/** 번들 디렉터리의 모든 파일(상대경로 + 내용). */
export function listBundleFiles(dir: string): GuardFile[] {
  const out: GuardFile[] = [];
  const walk = (d: string, rel: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const r = rel === "" ? e.name : `${rel}/${e.name}`;
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full, r);
      else if (e.isFile()) {
        const big = statSync(full).size > MAX_TEXT_BYTES;
        out.push({ path: r, content: big ? undefined : readFileSync(full) });
      }
    }
  };
  walk(dir, "");
  return out;
}

export { decode };

// 유출 방지 가드 설정 (docs/04 §5). 이 파일을 넓히려면 설계 담당 승인이 필요하다 (AGENTS.md §0-5).
// Guard configuration. Widening any allowlist requires design-owner approval.

/** G1: 어느 깊이에 있든 이 디렉터리 아래 파일은 금지. / Directories forbidden at any depth. */
export const FORBIDDEN_DIRS: readonly string[] = [
  "alrimjang",
  "records",
  "_source",
  "backups",
  ".ingest",
];

/** G1: 경로 전체(저장소 루트 기준, / 구분) 정규식. / Whole-path regexes (repo-relative). */
export const FORBIDDEN_PATH_REGEXES: readonly { re: RegExp; label: string }[] = [
  { re: /^report\/[^/]+\.html$/i, label: "report/*.html" },
];

/** G1: 파일 이름(basename) 정규식. / Basename regexes. */
export const FORBIDDEN_BASENAME_REGEXES: readonly { re: RegExp; label: string }[] = [
  { re: /\.sqlite/i, label: "*.sqlite*" },
  { re: /\.db(-(wal|shm|journal))?$/i, label: "*.db" },
  { re: /^\.dev\.vars(\..*)?$/i, label: ".dev.vars" },
  { re: /^\.env(\..*)?$/i, label: ".env" },
  { re: /^d1-export.*\.sql$/i, label: "d1-export*.sql" },
];

/** G1: 위 규칙의 예외(basename). / Basename exceptions. */
export const FORBIDDEN_BASENAME_EXCEPTIONS: readonly string[] = [".env.example"];

/** G2: 바이너리·문서 확장자. / Binary & document extensions. */
export const BINARY_EXTENSIONS: readonly string[] = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".heic",
  ".pdf",
  ".xlsx",
  ".xls",
  ".docx",
  ".mp4",
  ".mov",
  ".zip",
];

/** G2: 허용 디렉터리 접두사. 스크린샷은 fixtures 로만 만든다. / Allowed dir prefixes. */
export const BINARY_ALLOW_PREFIXES: readonly string[] = [
  "public/icons/",
  "docs/img/",
  "e2e/__screenshots__/",
];

/** G3: 본문 패턴. / Content patterns. 경계는 숫자 기준(해시·긴 숫자열 오탐 방지). */
export const CONTENT_PATTERNS: readonly { id: string; re: RegExp; label: string }[] = [
  {
    id: "rrn",
    re: /(?<!\d)\d{6}-?[1-4]\d{6}(?!\d)/g,
    label: "주민등록번호 형태 / resident registration number pattern",
  },
  {
    id: "rrn-masked",
    re: /(?<!\d)\d{6}-[1-4]\*{6}/g,
    label: "마스킹된 주민등록번호 형태 / masked RRN pattern",
  },
  {
    id: "phone",
    re: /(?<!\d)01[016789]-?\d{3,4}-?\d{4}(?!\d)/g,
    label: "휴대전화번호 형태 / mobile phone number pattern",
  },
  {
    id: "email",
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g,
    label: "이메일 주소 / email address",
  },
  {
    id: "kidsnote-url",
    re: /kidsnote\.com\/service\/report\/\d+|\/api\/v1[^\s"'`]*children\/\d+/gi,
    label: "키즈노트 형태 URL / Kidsnote-like URL",
  },
];

/** G3: 허용 이메일 도메인(소문자). / Allowed email domains. */
export const ALLOWED_EMAIL_DOMAINS: readonly string[] = [
  "users.noreply.github.com",
  "example.com",
  "example.org",
];

/** G3·G5·G7: 본문 검사를 건너뛰는 파일. 이유를 적는다. / Files exempt from content scans. */
export const CONTENT_SCAN_SKIP: readonly { path: RegExp; reason: string }[] = [
  { path: /^package-lock\.json$/, reason: "의존성 잠금 파일(해시·패키지 작성자 메일) / lockfile" },
];

/** 텍스트 검사 최대 크기(바이트). / Max size of text files to scan. */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/** G5: 문장 대조 창 크기(문자). / Sentence match window size in characters. */
export const SENTENCE_WINDOW = 20;
/** G5: 창 안에 글자(\p{L})가 최소 이만큼 있어야 대조 대상(표 선·구분선 오탐 방지). */
export const SENTENCE_MIN_LETTERS = 10;
/** G5: 색인 최대 창 수(메모리 상한). 넘으면 간격을 늘리고 경고한다. */
export const SENTENCE_MAX_INDEX = 8_000_000;

/** G7: 번들 한글 장문 기준(문자 수). / Bundle long-Hangul run threshold. */
export const BUNDLE_LONG_RUN = 30;
/** G7: 번들 한글 장문 허용 목록(저장소 상대경로). */
export const BUNDLE_ALLOWLIST_FILE = "tools/guard/bundle-allowlist.txt";
/** G7: 번들에 있으면 안 되는 표지어(대소문자 무시). */
export const BUNDLE_FORBIDDEN_WORDS: readonly string[] = ["kidsnote"];

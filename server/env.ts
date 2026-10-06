// Cloudflare 바인딩과 비밀값 (docs/02 §3, wrangler.toml, .dev.vars.example).
// Bindings and secrets available to Pages Functions.
export interface Env {
  DB: D1Database;
  /** R2 binding. M4 에서 R2 활성화 전까지 없음(wrangler.toml 주석). 사용하는 코드는 존재 확인 필수. */
  FILES?: R2Bucket;
  /** PBKDF2-SHA256(pin, PIN_SALT, 100000) base64. 비밀값. */
  PIN_HASH: string;
  /** base64 salt for PIN_HASH. */
  PIN_SALT: string;
  /** 선택. PIN 자릿수("4"~"12" 정수 문자열). 유효하면 GET /api/session 이 pinLength 로 알려 자동 전송에 쓴다. 그 밖 값은 무시. */
  PIN_LENGTH?: string;
  /** HMAC key for the `yjs` session cookie. */
  SESSION_SECRET: string;
  /** HMAC key used to hash client IPs before they are stored in auth_attempt. */
  IP_HASH_SALT: string;
  /** Optional build/version label shown by /api/health. */
  APP_VERSION?: string;
  /** 선택(집 PC 워커 연결 시 필수). 워커 Bearer 토큰의 SHA-256 hex(64자). 없거나 형식이 틀리면 /api/worker/* 는 503 (fail closed). 비밀값. */
  ASK_WORKER_TOKEN_HASH?: string;
}

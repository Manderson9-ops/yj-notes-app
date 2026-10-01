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
  /** HMAC key for the `yjs` session cookie. */
  SESSION_SECRET: string;
  /** HMAC key used to hash client IPs before they are stored in auth_attempt. */
  IP_HASH_SALT: string;
  /** Optional build/version label shown by /api/health. */
  APP_VERSION?: string;
}

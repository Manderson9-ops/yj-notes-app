// 기록 id(UUIDv7)와 이 기기의 식별자·기본 기록자. 오프라인 재전송을 멱등으로 만드는 키가 id 다 (docs/03 family_log).

/** UUIDv7: 48비트 밀리초 시각 + 무작위. 같은 id 로 다시 PUT 해도 서버에 한 행만 남는다. */
export function uuidv7(now: number = Date.now(), rand?: Uint8Array): string {
  const b = rand ?? crypto.getRandomValues(new Uint8Array(10));
  const bytes = new Uint8Array(16);
  let t = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = t % 256;
    t = Math.floor(t / 256);
  }
  for (let i = 0; i < 10; i++) bytes[6 + i] = b[i] ?? 0;
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const DEVICE_KEY = "yj.deviceId";
const RECORDER_KEY = "yj.recorder";

export const RECORDERS = ["엄마", "아빠", "할머니", "할아버지", "이모"] as const;

export function deviceId(): string {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved) return saved;
    const fresh = uuidv7();
    localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    return "device-unknown";
  }
}

export function getDefaultRecorder(): string | null {
  try {
    return localStorage.getItem(RECORDER_KEY);
  } catch {
    return null;
  }
}

export function setDefaultRecorder(name: string): void {
  try {
    localStorage.setItem(RECORDER_KEY, name);
  } catch {
    /* 저장소를 못 쓰면 이번만 적용 */
  }
}

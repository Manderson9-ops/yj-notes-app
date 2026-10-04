// PIN_HASH / PIN_SALT 생성기 (관리자 PC 전용). docs/04 §3.
// 사용: npm run pin:hash   -> PIN 을 두 번 입력(가능하면 화면에 보이지 않게) -> 값과 wrangler 명령을 '출력만' 한다.
// 파일에 쓰지 않는다. 출력된 해시는 비밀값이다: 터미널 기록·공유 화면에 남기지 말고 Pages secret 에만 넣는다.
// Admin-only generator. Prints values and commands; never writes files.
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { createInterface } from "node:readline";

/** server/auth/pin.ts 와 같은 값이어야 한다(pin-hash.test.ts 가 서버 구현과 일치를 검증). */
export const PBKDF2_ITERATIONS = 100_000;
/** 관리자 도구는 서버(4~12 허용)보다 엄격하게 6~12자리만 만든다(R1-1: 4자리는 1만 가지뿐이라 잠금 정책만으로는 약하다). */
export const PIN_PATTERN = /^[0-9]{6,12}$/;
export const PIN_TOO_SHORT_MESSAGE =
  "PIN 은 숫자 6~12자리여야 합니다. 4~5자리는 경우의 수가 너무 적어(1만~10만 가지) 시도 제한만으로는 안전하지 않습니다. 생일·전화번호 뒷자리 같은 짐작 가능한 숫자는 피하고 무작위 숫자를 쓰세요.";
export const PROJECT_NAME = "yj-notes-app";

export function computePinHash(pin: string, salt: Buffer): string {
  return pbkdf2Sync(pin, salt, PBKDF2_ITERATIONS, 32, "sha256").toString("base64");
}

export function formatOutput(saltB64: string, hashB64: string, pinLength?: number): string {
  return [
    "PIN_SALT=" + saltB64,
    "PIN_HASH=" + hashB64,
    ...(pinLength === undefined ? [] : ["PIN_LENGTH=" + String(pinLength)]),
    "",
    "# Cloudflare Pages secret 등록 (프롬프트에 위 값을 붙여 넣는다). 운영은 production, 미리보기는 --env preview:",
    `npx wrangler pages secret put PIN_SALT --project-name ${PROJECT_NAME}`,
    `npx wrangler pages secret put PIN_HASH --project-name ${PROJECT_NAME}`,
    ...(pinLength === undefined
      ? []
      : [
          `npx wrangler pages secret put PIN_LENGTH --project-name ${PROJECT_NAME}   # 입력값: ${String(pinLength)}`,
          "# 주의: PIN_LENGTH 가 실제 PIN 길이와 다르면 아무도 로그인할 수 없다. 세 값(PIN_SALT·PIN_HASH·PIN_LENGTH)을 함께 등록하고 재배포한다.",
        ]),
    "",
    "# SESSION_SECRET / IP_HASH_SALT 이 아직 없다면 (각각 한 번씩 실행해 나온 값을 secret 으로 등록):",
    `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`,
    `npx wrangler pages secret put SESSION_SECRET --project-name ${PROJECT_NAME}`,
    `npx wrangler pages secret put IP_HASH_SALT --project-name ${PROJECT_NAME}`,
    "",
    "# 로컬 개발: 위 PIN_SALT / PIN_HASH 두 줄을 .dev.vars 에 넣는다(.dev.vars 는 git 무시).",
    "# PIN 을 바꾼 뒤에는 기존 로그인을 모두 끊는다: npm run session:revoke -- --remote",
  ].join("\n");
}

/** 에코 없이 한 줄 입력. TTY 가 아니면 null. */
function readHidden(prompt: string): Promise<string> | null {
  const stdin = process.stdin;
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") return null;
  return new Promise((resolve, reject) => {
    process.stdout.write(prompt);
    let input = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\u0003") {
          cleanup();
          reject(new Error("취소됨"));
          return;
        }
        if (ch === "\r" || ch === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(input);
          return;
        }
        if (ch === "\u007f" || ch === "\b") input = input.slice(0, -1);
        else input += ch;
      }
    };
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    stdin.on("data", onData);
  });
}

async function ask(prompt: string, warned: { value: boolean }): Promise<string> {
  const hidden = readHidden(prompt);
  if (hidden) return hidden;
  if (!warned.value) {
    warned.value = true;
    console.error(
      "경고: 이 터미널은 입력 숨김을 지원하지 않아 PIN 이 화면에 보입니다. 주변을 확인하세요.",
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  const warned = { value: false };
  const pin = await ask("새 PIN (무작위 숫자 6~12자리, 생일 금지): ", warned);
  if (!PIN_PATTERN.test(pin)) {
    console.error(PIN_TOO_SHORT_MESSAGE);
    process.exitCode = 1;
    return;
  }
  const again = await ask("PIN 다시 입력: ", warned);
  if (again !== pin) {
    console.error("두 번 입력한 PIN 이 다릅니다.");
    process.exitCode = 1;
    return;
  }
  const salt = randomBytes(16);
  // PIN 자체는 출력하지 않는다. 자릿수(비밀 아님)만 알려서 PIN_LENGTH 를 맞추게 한다.
  console.log(formatOutput(salt.toString("base64"), computePinHash(pin, salt), pin.length));
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : "실패");
    process.exitCode = 1;
  });
}

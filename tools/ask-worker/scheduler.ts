// Windows 작업 스케줄러 등록 (관리자 권한 불필요: 현재 사용자의 로그온 트리거, 최소 권한).
// 창은 wscript 런처(숨김)로 띄우고, 비정상 종료 시 1분 후 재시작(RestartOnFailure)한다.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { askHome } from "./config.ts";
import { pidAlive } from "./lock.ts";

export const TASK_NAME = "YJ-AskWorker";

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function vbsQuote(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

/** wscript 로 node 를 창 없이 실행하고 종료 코드를 그대로 돌려주는 런처(VBScript). */
export function buildLauncherVbs(nodePath: string, scriptPath: string, cwd: string): string {
  const cmd = `"${nodePath}" "${scriptPath}"`;
  return [
    'Set sh = CreateObject("WScript.Shell")',
    `sh.CurrentDirectory = ${vbsQuote(cwd)}`,
    `rc = sh.Run(${vbsQuote(cmd)}, 0, True)`,
    "WScript.Quit rc",
    "",
  ].join("\r\n");
}

export function buildTaskXml(user: string, vbsPath: string): string {
  const u = xmlEscape(user);
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>YJ ask worker (home PC)</Description></RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>${u}</UserId></LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author"><UserId>${u}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec><Command>wscript.exe</Command><Arguments>//B //Nologo ${xmlEscape(vbsQuote(vbsPath))}</Arguments></Exec>
  </Actions>
</Task>
`;
}

export function utf16le(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
}

function schtasks(args: string[]): { status: number; out: string } {
  const r = spawnSync("schtasks.exe", args, {
    encoding: "buffer",
    windowsHide: true,
    shell: false,
  });
  // schtasks 출력은 콘솔 코드페이지(한국어 Windows 는 CP949)라 그대로 글자만 보여 준다.
  const dec = new TextDecoder(process.platform === "win32" ? "euc-kr" : "utf-8");
  return { status: r.status ?? 1, out: dec.decode(Buffer.concat([r.stdout, r.stderr])) };
}

const workerScript = fileURLToPath(new URL("./worker.ts", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export function install(): number {
  const home = askHome();
  mkdirSync(home, { recursive: true });
  if (!existsSync(join(home, "worker.env"))) {
    console.error(`먼저 ${join(home, "worker.env")} 를 만드세요 (docs/12-ask-worker.md).`);
    return 1;
  }
  const vbs = join(home, "run-worker.vbs");
  writeFileSync(vbs, utf16le(buildLauncherVbs(process.execPath, workerScript, repoRoot)));
  const user = `${process.env.USERDOMAIN ?? ""}\\${process.env.USERNAME ?? ""}`.replace(/^\\/, "");
  const xml = join(home, "task.xml");
  writeFileSync(xml, utf16le(buildTaskXml(user, vbs)));
  const r = schtasks(["/Create", "/TN", TASK_NAME, "/XML", xml, "/F"]);
  unlinkSync(xml);
  if (r.status !== 0) {
    console.error("작업 등록에 실패했어요. 권한 문제면 docs/12 문제 해결을 보세요.");
    return r.status;
  }
  schtasks(["/Run", "/TN", TASK_NAME]);
  console.log(`등록 완료: ${TASK_NAME} (로그온 시 자동 시작, 지금 한 번 시작했어요)`);
  return 0;
}

export function uninstall(): number {
  schtasks(["/End", "/TN", TASK_NAME]);
  const r = schtasks(["/Delete", "/TN", TASK_NAME, "/F"]);
  console.log(r.status === 0 ? "작업을 삭제했어요" : "등록된 작업이 없어요");
  return 0;
}

export function status(): number {
  const home = askHome();
  const q = schtasks(["/Query", "/TN", TASK_NAME, "/FO", "LIST", "/V"]);
  if (q.status !== 0) console.log(`작업 스케줄러: ${TASK_NAME} 등록 안 됨`);
  else {
    const keep = q.out
      .split(/\r?\n/)
      .filter((l) =>
        /^(TaskName|작업 이름|Status|상태|Last Run Time|마지막 실행 시간|Last Result|마지막 결과|Next Run Time|다음 실행 시간)/.test(
          l.trim(),
        ),
      );
    console.log(keep.join("\n"));
  }
  const lock = join(home, "worker.lock");
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, "utf8").trim());
    console.log(
      `워커 프로세스: ${Number.isInteger(pid) && pidAlive(pid) ? `실행 중 (pid ${pid})` : "잠금만 남음(실행 안 됨)"}`,
    );
  } else console.log("워커 프로세스: 실행 안 됨");
  const logDir = join(home, "logs");
  if (existsSync(logDir)) console.log(`로그: ${logDir}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cmd = process.argv[2];
  process.exit(cmd === "install" ? install() : cmd === "uninstall" ? uninstall() : status());
}

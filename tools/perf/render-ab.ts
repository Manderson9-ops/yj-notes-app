// A/B 교차 측정: 같은 프로세스에서 두 서버(전/후)를 번갈아 재서 PC 부하 잡음을 상쇄한다.
// 사용: AB="before=http://127.0.0.1:5187,after=http://127.0.0.1:5186" node tools/perf/render-ab.ts [webkit|chromium] [cpuRate]
// 지표(ms): shot = 미리보기 화면 전체 page.screenshot() 한 장(래스터까지 포함), repaint = 색 변경 후 rAF 2회.
// 각 (테마, 변형)마다 새 컨텍스트로 ROUNDS 번 반복하고, 라운드별 "최소값"의 중앙값을 낸다.
import { chromium, webkit } from "@playwright/test";

const engine = process.argv[2] ?? "webkit";
const rate = Number(process.argv[3] ?? 1);
const variants = (process.env.AB ?? "").split(",").map((s) => s.split("=") as [string, string]);
const themes = (process.env.THEMES ?? "basic,crayon,forest").split(",");
const ROUNDS = Number(process.env.ROUNDS ?? 5);
const N = Number(process.env.N ?? 6);
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
const browser = await (engine === "chromium" ? chromium : webkit).launch();

async function once(base: string, theme: string) {
  const ctx = await browser.newContext({
    viewport: { width: 360, height: 740 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    colorScheme: "light",
  });
  const page = await ctx.newPage();
  if (engine === "chromium" && rate > 1) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  }
  await page.addInitScript(`localStorage.setItem("yj.theme", ${JSON.stringify(theme)})`);
  await page.goto(base + "/");
  for (const d of "0000") await page.getByRole("button", { name: d, exact: true }).click();
  await page.getByRole("button", { name: "확인" }).click();
  await page.getByRole("heading", { level: 1, name: "홈" }).waitFor();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("link", { name: "설정", exact: true }).click();
  await page.getByRole("link", { name: "디자인 미리보기" }).click();
  await page.getByRole("heading", { level: 1, name: "디자인 미리보기" }).waitFor();
  await page.waitForTimeout(800);
  const shots: number[] = [];
  const reps: number[] = [];
  for (let i = 0; i < N; i++) {
    const t = Date.now();
    await page.screenshot({ fullPage: true });
    shots.push(Date.now() - t);
    reps.push(
      Number(
        await page.evaluate(`(async () => {
          document.body.style.color = document.body.style.color === 'rgb(1, 2, 3)' ? 'rgb(3, 2, 1)' : 'rgb(1, 2, 3)';
          const t = performance.now();
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          return performance.now() - t;
        })()`),
      ),
    );
  }
  await ctx.close();
  return { shot: Math.min(...shots), repaint: Math.min(...reps) };
}

const acc: Record<string, { shot: number[]; repaint: number[] }> = {};
for (let r = 0; r < ROUNDS; r++) {
  for (const theme of themes) {
    for (const [label, base] of variants) {
      const v = await once(base, theme);
      const k = `${theme}|${label}`;
      (acc[k] ??= { shot: [], repaint: [] }).shot.push(v.shot);
      acc[k].repaint.push(v.repaint);
    }
  }
}
for (const [k, v] of Object.entries(acc)) {
  const [theme, label] = k.split("|");
  console.log(
    JSON.stringify({
      engine,
      rate,
      theme,
      variant: label,
      shotMedian: median(v.shot),
      repaintMedian: +median(v.repaint).toFixed(1),
    }),
  );
}
await browser.close();

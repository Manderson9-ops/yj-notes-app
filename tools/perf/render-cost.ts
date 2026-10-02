// 테마별 렌더 비용 측정 (docs/design/theme-system.md "렌더 비용 규칙" 참고).
// 사용: E2E_PORT=5186 node tools/perf/render-cost.ts [webkit|chromium] [cpuRate]
//  - 먼저 `npm run dev:mock` 이 E2E_PORT 에서 떠 있어야 한다. 합성 mock API 만 쓴다.
//  - 환경변수: THEMES(기본 basic,crayon,forest) SCHEMES(light,dark) N(반복, 기본 7) INJECT_CSS(원인 분리용 CSS)
//  - 지표(ms, 중앙값 + *Min=최소, PC 부하 잡음에 강함): repaint = 색을 바꿔 전체를 다시 칠하게 한 뒤 requestAnimationFrame 2회까지,
//    shot = page.screenshot() 한 장, axe = AxeBuilder.analyze().
//  - cpuRate>1 은 chromium 에서만(CDP Emulation.setCPUThrottlingRate). webkit 은 지원 없음.
import { chromium, webkit, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const engine = process.argv[2] ?? "webkit";
const rate = Number(process.argv[3] ?? 1);
const port = process.env.E2E_PORT ?? "5186";
const base = `http://127.0.0.1:${port}`;
const themes = (process.env.THEMES ?? "basic,crayon,forest").split(",");
const N = Number(process.env.N ?? 7);

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;

async function repaintOnce(page: Page) {
  return Number(
    await page.evaluate(`(async () => {
      document.body.style.color = document.body.style.color === 'rgb(1, 2, 3)' ? 'rgb(3, 2, 1)' : 'rgb(1, 2, 3)';
      const t = performance.now();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return performance.now() - t;
    })()`),
  );
}

const browserType = engine === "chromium" ? chromium : webkit;
const browser = await browserType.launch();
const out: unknown[] = [];
for (const theme of themes) {
  for (const scheme of (process.env.SCHEMES ?? "light,dark").split(",")) {
    const ctx = await browser.newContext({
      viewport: { width: 360, height: 740 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: engine !== "firefox",
      colorScheme: scheme as "light" | "dark",
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
    // 원인 분리(ablation)용: INJECT_CSS 로 특정 규칙만 끄고 비교한다(예: "*{filter:none!important}").
    if (process.env.INJECT_CSS) await page.addStyleTag({ content: process.env.INJECT_CSS });
    for (const screen of ["home", "preview"]) {
      if (screen === "preview") {
        await page.getByRole("link", { name: "설정", exact: true }).click();
        await page.getByRole("link", { name: "디자인 미리보기" }).click();
        await page.getByRole("heading", { level: 1, name: "디자인 미리보기" }).waitFor();
      }
      await page.waitForTimeout(600);
      const rp: number[] = [];
      const sh: number[] = [];
      for (let i = 0; i < N; i++) {
        rp.push(await repaintOnce(page));
        const t = Date.now();
        await page.screenshot();
        sh.push(Date.now() - t);
      }
      const t0 = Date.now();
      await new AxeBuilder({ page }).analyze();
      const axe = Date.now() - t0;
      const row = {
        engine,
        rate,
        theme,
        scheme,
        screen,
        repaint: +median(rp).toFixed(1),
        repaintMin: +Math.min(...rp).toFixed(1),
        shot: median(sh),
        shotMin: Math.min(...sh),
        axe,
      };
      out.push(row);
      console.log(JSON.stringify(row));
    }
    await ctx.close();
  }
}
await browser.close();

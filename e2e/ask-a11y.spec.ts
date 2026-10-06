import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { settle, stableShot } from "./helpers";

// 물어보기(S50)의 접근성(axe serious/critical 0), 3테마 × 라이트/다크, 큰 글씨, 터치 영역, 진행 흐름.
// 목업 API(vite-plugins/mock/ask.ts): 1 완료(단계 5) · 2 완료(단계 1) · 3 완료(위급, 단계 10) · 4 대기 · 5 작성 중 · 6 다시 작성 중. 합성 자료만.
// 360px 스크린샷은 e2e/__screenshots__/ask-<화면>-<테마>-<scheme>.png (mobile-chromium 만).

const THEMES = ["basic", "crayon", "forest"] as const;
test.describe.configure({ timeout: 90_000 });

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map(
      (v) =>
        `${v.id}: ${v.help} (${String(v.nodes.length)}) ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
    );
}

async function login(page: Page) {
  await page.goto("/");
  for (const d of "0000") await page.getByRole("button", { name: d, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
}

for (const theme of THEMES) {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`${theme} ${scheme}`, () => {
      test.use({ colorScheme: scheme });

      test("물어보기 화면들: axe 0 + 360px 스크린샷", async ({ page }, info) => {
        await page.addInitScript((t) => {
          localStorage.setItem("yj.theme", t);
          localStorage.setItem("yj.recorder", "엄마");
        }, theme);
        const shot = async (name: string, fullPage = false) => {
          if (info.project.name !== "mobile-chromium") return;
          await stableShot(page, `ask-${name}-${theme}-${scheme}`, fullPage);
        };
        const check = async () => {
          // 아래쪽 따라오는(sticky) 탭바가 긴 화면을 가리면 axe 가 겹침으로 본다: 한 화면에 다 들어오게 키워서 잰다.
          await page.setViewportSize({ width: 360, height: 3600 });
          await settle(page);
          const found = await seriousViolations(page);
          await page.setViewportSize({ width: 360, height: 740 });
          expect(found).toEqual([]);
        };

        await login(page);

        // 목록 + 입력
        await page.goto("/ask");
        await expect(page.getByRole("heading", { level: 1, name: "물어보기" })).toBeVisible();
        await expect(page.locator("a.ask-row")).toHaveCount(6);
        await check();
        await shot("list", true);

        // 위급 신호를 쓰면 보내기 전에 경고
        await page.getByLabel("궁금한 것").fill("자다가 경련을 했어요");
        await expect(page.getByText(/119/)).toBeVisible();
        await check();
        await shot("redflag-input");

        // 답변 카드: 단계 5 / 단계 1 / 위급 단계 10
        await page.goto("/ask/1");
        await expect(page.getByRole("article", { name: "답변" })).toBeVisible();
        await expect(page.getByText("단계 5", { exact: true })).toBeVisible();
        await check();
        await shot("answer5", true);

        await page.goto("/ask/2");
        await expect(page.getByText("단계 1", { exact: true })).toBeVisible();
        await check();

        await page.goto("/ask/3");
        await expect(page.getByText("단계 10", { exact: true })).toBeVisible();
        await expect(page.getByText(/119/)).toBeVisible();
        await check();
        await shot("answer10", true);

        // 대기 중: 진행 단계 + 상태 줄
        await page.goto("/ask/4");
        await expect(page.getByRole("list", { name: "진행 단계" })).toBeVisible();
        await check();
        await shot("pending");
      });
    });
  }
}

test("보내기 → 접수 → 작성 중 → 검토 중 → 답변, 의견 남기기", async ({ page }) => {
  await login(page);
  await page.goto("/ask");
  await page.getByRole("button", { name: "아빠", exact: true }).click();
  await page.getByLabel("궁금한 것").fill("합성 질문: 낮잠 전에 인형을 꼭 안아요");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "질문" })).toBeVisible();
  const now = page.locator("ol[aria-label='진행 단계'] [aria-current='step']");
  await expect(now).toContainText("접수");
  await expect(page.locator(".ask-status-line")).toContainText("질문을 받았어요");
  await expect(now).toContainText("작성 중", { timeout: 20_000 });
  await expect(now).toContainText("검토 중", { timeout: 20_000 });
  await expect(page.getByRole("article", { name: "답변" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("list", { name: "진행 단계" })).toHaveCount(0);

  const up = page.getByRole("button", { name: "도움이 됐어요", exact: true });
  await up.click();
  await expect(up).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("ask-vote-live")).toContainText("반영했어요");
  await page.getByRole("textbox", { name: "해 봤어요 메모" }).fill("안아 주니 그쳤어요");
  await page.getByRole("button", { name: "메모 남기기" }).click();
  await expect(page.getByText("안아 주니 그쳤어요")).toBeVisible();
});

test("위급 질문을 보내면 상세에서도 경고가 먼저, 답은 단계 10", async ({ page }) => {
  await login(page);
  await page.goto("/ask");
  await page.getByRole("button", { name: "엄마", exact: true }).click();
  await page.getByLabel("궁금한 것").fill("합성 질문: 경련을 했어요");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByText(/119/)).toBeVisible();
  await expect(page.getByText("단계 10", { exact: true })).toBeVisible({ timeout: 30_000 });
});

test("홈 맨 위에 물어보기 큰 버튼, 탭은 4개 그대로", async ({ page }) => {
  await login(page);
  await expect(page.locator("nav.tabbar a")).toHaveCount(4);
  await page.getByRole("link", { name: "물어보기", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "물어보기" })).toBeVisible();
});

test.describe("큰 글씨", () => {
  for (const theme of THEMES) {
    test(`${theme}: 가로 넘침 없음, 터치 영역 48px 이상, axe 0`, async ({ page }) => {
      await page.addInitScript(
        ([t]) => {
          localStorage.setItem("yj.theme", t ?? "basic");
          localStorage.setItem("yj.largeText", "1");
          localStorage.setItem("yj.recorder", "엄마");
        },
        [theme],
      );
      await login(page);
      const noOverflow = async (label: string) => {
        await page.setViewportSize({ width: 360, height: 4200 });
        const wide = await page.evaluate(
          "document.documentElement.scrollWidth > document.documentElement.clientWidth + 1",
        );
        expect(wide, `${label} horizontal overflow`).toBe(false);
        for (const sel of [".chip", ".btn", ".btn-primary", ".ask-progress > li"]) {
          for (const loc of await page.locator(sel).all()) {
            const box = await loc.boundingBox();
            if (!box) continue;
            expect(box.height, `${label} ${sel} height`).toBeGreaterThanOrEqual(47.5);
          }
        }
        await settle(page);
        expect(await seriousViolations(page)).toEqual([]);
      };
      await page.goto("/ask");
      await expect(page.locator("a.ask-row")).toHaveCount(6);
      await noOverflow("ask");
      await page.goto("/ask/1");
      await expect(page.getByRole("article", { name: "답변" })).toBeVisible();
      await noOverflow("answer");
      await page.goto("/ask/3");
      await expect(page.getByText("단계 10", { exact: true })).toBeVisible();
      await noOverflow("redflag");
      await page.goto("/ask/4");
      await expect(page.getByRole("list", { name: "진행 단계" })).toBeVisible();
      await noOverflow("pending");
    });
  }
});

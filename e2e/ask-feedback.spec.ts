import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { settle, stableShot } from "./helpers";

// 물어보기 2차(T-Q3): 표 선택·다시 답변 이유·다시 작성 중·공유 — 3테마 × 라이트/다크 × 보통/선명하게(high), axe serious/critical 0.
// 목업 API(vite-plugins/mock/ask.ts): 1 완료(가족 표·메모 있음) · 2 완료 · 6 다시 작성 중. 합성 자료만.
// 360px 스크린샷: e2e/__screenshots__/ask2-<화면>-<테마>-<scheme>[-high].png (mobile-chromium 만).

const THEMES = ["basic", "crayon", "forest"] as const;
test.describe.configure({ timeout: 120_000 });

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

for (const mode of ["normal", "high"] as const) {
  for (const theme of THEMES) {
    for (const scheme of ["light", "dark"] as const) {
      test.describe(`${theme} ${scheme}${mode === "high" ? " high" : ""}`, () => {
        test.use({ colorScheme: scheme });

        test("표 선택·이유 고르기·다시 작성 중·공유: axe 0 + 스크린샷", async ({ page }, info) => {
          await page.addInitScript(
            ([t, m]) => {
              localStorage.setItem("yj.theme", t ?? "basic");
              localStorage.setItem("yj.recorder", "엄마");
              if (m === "high") localStorage.setItem("yj.contrast", "high");
            },
            [theme, mode],
          );
          const suffix = `${theme}-${scheme}${mode === "high" ? "-high" : ""}`;
          const shot = async (name: string) => {
            if (info.project.name !== "mobile-chromium") return;
            await stableShot(page, `ask2-${name}-${suffix}`, true);
          };
          const check = async () => {
            await page.setViewportSize({ width: 360, height: 4200 });
            await settle(page);
            const found = await seriousViolations(page);
            await page.setViewportSize({ width: 360, height: 740 });
            expect(found).toEqual([]);
          };
          await login(page);

          // 표 선택 상태(엄마 👍 선택됨) + 가족별 요약 + 공유 버튼
          await page.goto("/ask/1");
          const up = page.getByRole("button", { name: "도움이 됐어요", exact: true });
          await expect(up).toHaveAttribute("aria-pressed", "true");
          await expect(page.getByTestId("ask-vote-summary")).toContainText("엄마");
          await expect(page.getByRole("button", { name: "공유하기" })).toHaveCount(1);
          await check();
          await shot("voted");

          // 👎 → 이유 고르기 시트
          await page.goto("/ask/2");
          await page.getByRole("button", { name: "도움이 안 됐어요", exact: true }).click();
          await page.getByRole("radio", { name: "이미 해 봤어요", exact: true }).click();
          await expect(page.getByTestId("ask-reask-panel")).toBeVisible();
          await check();
          await shot("reask-sheet");

          // 다시 작성 중
          await page.goto("/ask/6");
          await expect(page.getByText("다시 작성 중이에요.")).toBeVisible();
          await expect(page.getByText("1번째 답 · 1월 15일")).toBeVisible();
          await check();
          await shot("reasking");
        });
      });
    }
  }
}

test("표: 같은 쪽 다시 누르면 취소, 다른 쪽 누르면 바꾸기", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("yj.recorder", "아빠");
  });
  await login(page);
  await page.goto("/ask/2");
  const up = page.getByRole("button", { name: "도움이 됐어요", exact: true });
  const down = page.getByRole("button", { name: "도움이 안 됐어요", exact: true });
  await up.click();
  await expect(up).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("ask-vote-summary")).toContainText("아빠");
  await down.click();
  await expect(down).toHaveAttribute("aria-pressed", "true");
  await expect(up).toHaveAttribute("aria-pressed", "false");
  await down.click();
  await expect(down).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("ask-vote-live")).toContainText("취소");
});

test("다시 답변 받기: 이유 → 다시 작성 중 → 새 답 + 이전 답변 보관", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("yj.recorder", "아빠");
  });
  await login(page);
  await page.goto("/ask/2");
  await page.getByRole("button", { name: "도움이 안 됐어요", exact: true }).click();
  await page.getByRole("radio", { name: "더 자세히 알고 싶어요", exact: true }).click();
  await page.getByLabel("더 알려 주고 싶은 점(선택)").fill("할 말 예시가 더 있으면 좋아요");
  await page.getByRole("button", { name: "다시 답변 받기" }).click();
  await expect(page.getByText(/다시 작성/).first()).toBeVisible();
  await expect(page.getByRole("article", { name: "답변" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("1번째 답 · 1월 15일")).toBeVisible();
  // 이전 답의 표는 새 답에는 세지 않는다
  await expect(page.getByRole("button", { name: "도움이 안 됐어요", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("공유하기: navigator.share 가 있으면 시트, 없으면 복사 + 안내", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
  await login(page);
  await page.goto("/ask/1");
  await expect(page.getByRole("article", { name: "답변" })).toBeVisible();
  await page.evaluate(`(() => {
    window.__shared = null;
    navigator.share = (d) => { window.__shared = d; return Promise.resolve(); };
  })()`);
  await page.getByRole("button", { name: "공유하기" }).first().click();
  const shared = await page.evaluate<{ title: string; text: string; url?: string }>(
    "window.__shared",
  );
  expect(shared.text).toContain("📝 아이 물어보기");
  expect(shared.text).toContain("✅ 지금 해 볼 것");
  expect(shared.url).toBeUndefined();
  expect(shared.text).toContain("/ask/1 (가족 PIN 필요)");
  expect(shared.text.length).toBeLessThanOrEqual(3000);
  // share 가 없는 브라우저: 클립보드 복사
  await page.evaluate(
    "Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })",
  );
  await page.evaluate(`(() => {
    window.__copied = null;
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } }, configurable: true });
  })()`);
  await page.getByRole("button", { name: "복사하기" }).last().click();
  await expect(page.getByText("복사했어요.").first()).toBeVisible();
  expect((await page.evaluate<string>("window.__copied")).length).toBeGreaterThan(50);
});

test("설정: 최근 7일 의견 한 줄", async ({ page }) => {
  await login(page);
  await page.goto("/settings");
  await expect(page.getByTestId("ask-feedback-7d")).toContainText("메모 2");
});

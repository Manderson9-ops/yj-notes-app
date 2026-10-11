import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { settle, stableElementShot } from "./helpers";

// T-S1: 홈의 자동 업데이트 경고(실패·미실행·멈춤)와 설정 한 줄. 3 테마 × 라이트/다크 + 선명하게 보기 + 큰 글씨. axe serious/critical 0.
// 상태는 page.route 로 overview 응답의 sync 만 바꾸고, 브라우저 시계는 고정한다(합성 값). 스크린샷은 mobile-chromium 만.

const THEMES = ["basic", "crayon", "forest"] as const;
// 고정 시각: 2020-05-02 21:40 KST (오늘 저녁 8시 실행이 이미 돌았어야 하는 때)
const NOW = "2020-05-02T12:40:00.000Z";

async function seriousViolations(page: Page) {
  // 화면이 길어서 따라오는(sticky) 탭바가 아래쪽 요소를 가린다(axe 는 스크롤하지 않음). 검사하는 동안만 흐름 안에 둔다(a11y.spec 와 같은 방식).
  await page.evaluate("document.querySelector('.tabbar')?.classList.add('is-static-for-shot')");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  await page.evaluate("document.querySelector('.tabbar')?.classList.remove('is-static-for-shot')");
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

async function setOverview(
  page: Page,
  sync: Record<string, unknown>,
  patch: (body: Record<string, unknown>) => void = () => undefined,
) {
  await page.clock.setFixedTime(new Date(NOW));
  await page.route("**/api/overview", async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as Record<string, unknown>;
    body.sync = sync;
    patch(body);
    await route.fulfill({ response: res, json: body });
  });
}

const base = {
  lastOkAt: "2020-05-01T11:10:00.000Z", // 5월 1일 저녁 8시 10분
  lastAttemptAt: "2020-05-02T11:00:05.000Z",
  lastAttemptReceivedAt: "2020-05-02T11:00:06.000Z",
  newReports: 3,
  lastNoteDate: "2020-05-01",
};

async function noHorizontalOverflow(page: Page) {
  const over = await page.evaluate(
    "document.documentElement.scrollWidth - document.documentElement.clientWidth",
  );
  expect(over).toBeLessThanOrEqual(0);
}

/** 경고 상자 글줄 수: 글자 사각형의 세로 위치를 줄 단위로 묶어 센다(첫 줄만 굵고 크므로 높이 나눗셈은 맞지 않는다). */
async function noticeLines(page: Page): Promise<number> {
  return Number(
    await page.evaluate(
      "(() => { const p = document.querySelector('[data-testid=sync-notice] .notice > p'); const r = document.createRange(); r.selectNodeContents(p); const ys = [...r.getClientRects()].filter((q) => q.width > 1).map((q) => q.top + q.height / 2).sort((a, b) => a - b); let n = 0, last = -99; for (const y of ys) { if (y - last > 6) n++; last = y; } return n; })()",
    ),
  );
}

const COMBOS = [
  ...THEMES.flatMap((theme) => [
    { theme, scheme: "light" as const, high: false, large: false },
    { theme, scheme: "dark" as const, high: false, large: false },
  ]),
  ...THEMES.map((theme) => ({ theme, scheme: "light" as const, high: true, large: false })),
  ...THEMES.map((theme) => ({ theme, scheme: "light" as const, high: false, large: true })),
];

for (const { theme, scheme, high, large } of COMBOS) {
  test.describe(`자동 업데이트 ${theme} ${scheme}${high ? " 선명하게" : ""}${large ? " 큰 글씨" : ""}`, () => {
    test.use({ colorScheme: scheme });
    test.setTimeout(90_000);

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(
        ([t, h, l]) => {
          localStorage.setItem("yj.theme", t ?? "basic");
          if (h === "1") localStorage.setItem("yj.contrast", "high");
          if (l === "1") localStorage.setItem("yj.largeText", "1");
        },
        [theme, high ? "1" : "0", large ? "1" : "0"],
      );
    });

    const name = (what: string) =>
      `sync-${what}-${theme}${high ? "-high" : ""}${large ? "-large" : ""}-${scheme}`;
    const check = async (page: Page) => {
      await settle(page);
      expect(await seriousViolations(page)).toEqual([]);
      await noHorizontalOverflow(page);
    };

    test("홈 실패 배너: 첫 줄·사유·반영 날짜·누가 하는지·다음 안내, axe 0", async ({
      page,
    }, info) => {
      await setOverview(page, { ...base, state: "failed", code: "kidsnote_login" });
      await login(page);
      const box = page.getByTestId("sync-notice");
      await expect(box).toBeVisible();
      await expect(box).toHaveAttribute("role", "status");
      await expect(page.getByTestId("sync-head")).toHaveText(
        "오늘 저녁 알림장 자동 업데이트가 안 됐어요.",
      );
      await expect(box).toContainText("키즈노트 로그인이 풀렸어요.");
      await expect(box).toContainText("마지막 알림장: 5월 1일");
      await expect(box).toContainText("관리자가 확인해요(가족은 하실 일 없어요).");
      await expect(box).toContainText("내일 저녁 8시에 다시 해요.");
      if (!large) expect(await noticeLines(page), "보통 글씨 360px 줄 수").toBeLessThanOrEqual(7);
      await check(page);
      if (info.project.name === "mobile-chromium") {
        await stableElementShot(page, box, name("home-failed"));
      }
    });

    test("홈 미실행 배너: 집 PC 사유, 관리자가 집 PC 확인, axe 0", async ({ page }, info) => {
      await setOverview(page, {
        ...base,
        state: "missed",
        code: "missed",
        lastAttemptAt: "2020-05-01T11:00:05.000Z",
        lastAttemptReceivedAt: "2020-05-01T11:00:06.000Z",
      });
      await login(page);
      const box = page.getByTestId("sync-notice");
      await expect(box).toContainText("집 PC가 꺼져 있었던 것 같아요.");
      await expect(box).toContainText("관리자가 집 PC를 확인해요(가족은 하실 일 없어요).");
      if (!large) expect(await noticeLines(page), "보통 글씨 360px 줄 수").toBeLessThanOrEqual(7);
      await check(page);
      if (info.project.name === "mobile-chromium") {
        await stableElementShot(page, box, name("home-missed"));
      }
    });

    test("홈 멈춤 배너: 너무 오래 걸려 멈췄어요, axe 0", async ({ page }, info) => {
      await setOverview(page, { ...base, state: "stuck", code: "stuck" });
      await login(page);
      const box = page.getByTestId("sync-notice");
      await expect(box).toContainText("업데이트가 너무 오래 걸려 멈췄어요.");
      await check(page);
      if (info.project.name === "mobile-chromium") {
        await stableElementShot(page, box, name("home-stuck"));
      }
    });

    test("쌓이지 않는다: 적재 실패·14일 경고가 있어도 경고 상자는 하나", async ({ page }) => {
      await setOverview(page, { ...base, state: "failed", code: "ingest" }, (body) => {
        body.ingestState = "failed";
        body.lastIngest = { at: "2020-03-01T00:00:00.000Z", status: "ok", commit: "fixture0000" };
      });
      await login(page);
      await expect(page.getByTestId("sync-notice")).toBeVisible();
      await expect(page.locator(".notice")).toHaveCount(1);
      await expect(page.getByText("마지막 갱신이 실패했어요.")).toHaveCount(0);
      await expect(page.getByText(/마지막 동기화가 \d+일 전이에요/)).toHaveCount(0);
      await check(page);
    });

    test("설정 한 줄: 매일 저녁 8시 · 마지막 성공 · 새 알림장 · 오늘은 안 됐어요, axe 0", async ({
      page,
    }, info) => {
      await setOverview(page, { ...base, state: "failed", code: "media" });
      await login(page);
      await page.getByRole("link", { name: "설정", exact: true }).click();
      const line = page.getByTestId("sync-line");
      await expect(line).toHaveText(
        "매일 저녁 8시 · 마지막 성공 5월 1일 저녁 8시 10분 · 새 알림장 3건 · 오늘은 안 됐어요",
      );
      await check(page);
      if (info.project.name === "mobile-chromium") {
        await stableElementShot(page, line, name("settings-line"));
      }
    });

    test("정상이면 홈에 경고가 없고 설정 줄에 안 됐다는 말이 없다", async ({ page }) => {
      await setOverview(page, { ...base, state: "ok", code: null, newReports: 0 });
      await login(page);
      await expect(page.getByText("최근 알림장")).toBeVisible();
      await expect(page.getByTestId("sync-notice")).toHaveCount(0);
      await page.getByRole("link", { name: "설정", exact: true }).click();
      await expect(page.getByTestId("sync-line")).toHaveText(
        "매일 저녁 8시 · 마지막 성공 5월 1일 저녁 8시 10분 · 새 알림장 없음",
      );
    });
  });
}

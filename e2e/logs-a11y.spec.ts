import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { settle, stableShot } from "./helpers";

// 가족 기록 화면(S20·S21)의 접근성(axe serious/critical 0), 3테마 × 라이트/다크, 큰 글씨, 터치 영역.
// 360px 스크린샷(합성 화면, 시계 고정)은 e2e/__screenshots__/logs-<화면>-<테마>-<scheme>.png (mobile-chromium 만).

const THEMES = ["basic", "crayon", "forest"] as const;
test.describe.configure({ timeout: 90_000 });

const FIXED_NOW = new Date("2030-03-14T12:00:00+09:00"); // 목요일. 합성 날짜.

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

async function seed(page: Page) {
  const meal = (id: string, occurredOn: string, tantrum: number, aggression: string) =>
    page.request.put(`/api/logs/${id}`, {
      data: {
        type: "meal",
        occurredOn,
        recorder: "아빠",
        payload: {
          announced: "O",
          came: "달래서 옴",
          tantrum_min: tantrum,
          aggression,
          amount: "조금",
          snack_before: "없음",
          sick: "X",
          phone: "없음",
        },
        note: "합성 메모 예시",
        deviceId: "e2e",
      },
    });
  await meal("01926f4a-0000-7000-8000-0000000000a1", "2030-03-14", 25, "사람 때림");
  await meal("01926f4a-0000-7000-8000-0000000000a2", "2030-03-08", 10, "없음");
  await page.request.put("/api/logs/01926f4a-0000-7000-8000-0000000000a3", {
    data: {
      type: "cry",
      occurredOn: "2030-03-13",
      recorder: "엄마",
      payload: { trigger: "밴드", minutes: 5, soothed_by: "안아줌", place: "집" },
      deviceId: "e2e",
    },
  });
}

const btn = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

for (const theme of THEMES) {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`${theme} ${scheme}`, () => {
      test.use({ colorScheme: scheme });

      test("기록 화면: axe 0 + 360px 스크린샷", async ({ page }, info) => {
        await page.clock.setFixedTime(FIXED_NOW);
        await page.addInitScript((t) => {
          localStorage.setItem("yj.theme", t);
        }, theme);
        const shot = async (name: string, fullPage = false) => {
          if (info.project.name !== "mobile-chromium") return;
          await stableShot(page, `logs-${name}-${theme}-${scheme}`, fullPage);
        };
        const check = async () => {
          // 아래쪽 따라오는(sticky) 탭바가 긴 화면의 버튼을 가리면 axe 가 겹침으로 본다: 한 화면에 다 들어오게 키워서 잰다.
          await page.setViewportSize({ width: 360, height: 3200 });
          await settle(page);
          const found = await seriousViolations(page);
          await page.setViewportSize({ width: 360, height: 740 });
          expect(found).toEqual([]);
        };

        await login(page);
        await seed(page);

        // S21: 경고 목록 + 주차 비교 + 교차표 + 목록
        await page.goto("/logs");
        await expect(page.locator("article.log-card")).toHaveCount(3);
        await btn(page, "저녁 식사").click();
        await expect(page.getByRole("table", { name: "저녁 식사 주차별 기록" })).toBeVisible();
        await check();
        await shot("summary", true);

        // 지우기 확인 대화상자
        await page
          .getByRole("button", { name: /기록 지우기$/ })
          .first()
          .click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await check();
        await shot("dialog");
        await page.keyboard.press("Escape");

        // S20: 종류 → 질문(칩) → 숫자 질문 → 확인 → 저장 후
        await page.goto("/logs/new");
        await expect(btn(page, "저녁 식사")).toBeVisible();
        await check();
        await btn(page, "저녁 식사").click();
        await btn(page, "O").click();
        await expect(page.getByRole("heading", { level: 2, name: "식탁에 올 때" })).toBeVisible();
        await check();
        await shot("question");
        await btn(page, "달래서 옴").click();
        await expect(page.getByRole("heading", { level: 2, name: "떼쓴 시간" })).toBeVisible();
        await btn(page, "직접").click();
        await expect(page.getByLabel("직접 입력 (분)")).toBeVisible();
        await check();
        await btn(page, "25분").click();
        for (const a of ["없음", "조금", "없음", "X", "없음"]) await btn(page, a).click();
        await btn(page, "엄마").click();
        await expect(page.getByRole("heading", { level: 2, name: "저녁 식사 확인" })).toBeVisible();
        await check();
        await shot("review", true);
        await btn(page, "저장").click();
        await expect(page.getByRole("heading", { level: 2, name: "저장했어요" })).toBeVisible();
        await check();
        await shot("done");
      });
    });
  }
}

test.describe("큰 글씨", () => {
  for (const theme of THEMES) {
    test(`${theme}: 가로 넘침 없음, 터치 영역 48px 이상, axe 0`, async ({ page }) => {
      await page.clock.setFixedTime(FIXED_NOW);
      await page.addInitScript(
        ([t]) => {
          localStorage.setItem("yj.theme", t ?? "basic");
          localStorage.setItem("yj.largeText", "1");
        },
        [theme],
      );
      await login(page);
      await seed(page);
      const noOverflow = async (label: string) => {
        // 아래쪽 따라오는(sticky) 탭바가 긴 화면의 칩을 가리면 axe 가 겹침으로 본다: 한 화면에 다 들어오게 키우고 잰다.
        await page.setViewportSize({ width: 360, height: 3200 });
        const wide = await page.evaluate(
          "document.documentElement.scrollWidth > document.documentElement.clientWidth + 1",
        );
        expect(wide, `${label} horizontal overflow`).toBe(false);
        for (const sel of [".chip", ".btn", ".btn-primary", ".review-row"]) {
          for (const loc of await page.locator(sel).all()) {
            const box = await loc.boundingBox();
            if (!box) continue;
            expect(box.height, `${label} ${sel} height`).toBeGreaterThanOrEqual(47.5);
          }
        }
        await settle(page);
        expect(await seriousViolations(page)).toEqual([]);
      };

      await page.goto("/logs");
      await btn(page, "저녁 식사").click();
      await expect(page.getByRole("table", { name: "저녁 식사 주차별 기록" })).toBeVisible();
      await noOverflow("logs");
      await page.goto("/logs/new");
      await btn(page, "저녁 식사").click();
      await noOverflow("type/question");
      await btn(page, "O").click();
      await btn(page, "달래서 옴").click();
      await noOverflow("int question");
      await btn(page, "5분").click();
      for (const a of ["없음", "조금", "없음", "X", "없음"]) await btn(page, a).click();
      await expect(page.getByRole("heading", { level: 2, name: "저녁 식사 확인" })).toBeVisible();
      await noOverflow("review");
    });
  }
});

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { stableShot, tallViewport } from "./helpers";

// 물어보기 대화(T-Q5): 「질문 → 답 카드 → 이어서 묻기 → 짧은 답 → (카드 갱신) → 다시 묻기 → 짧은 답」 흐름, 입력 잠금·한도·위급·오프라인.
// 목업 API(vite-plugins/mock/ask.ts)의 상태 있는 시나리오로 끝까지 돈다. 목록에 나오지 않는 변형 질문(주소로만 연다):
//   7 대화 예시(카드 3번 갱신·한도) · 8 후속 10번 한도 · 9 위급 후속 카드 실패 · 10 집 PC 꺼짐(활성 턴) · 11 카드 정리 중(멈춤).
// 360px 스크린샷: e2e/__screenshots__/ask3-<화면>-<테마>-<scheme>.png (mobile-chromium 만). 합성 자료만.

const THEMES = ["basic", "crayon", "forest"] as const;
test.describe.configure({ timeout: 150_000 });

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

/** 아래쪽 따라오는 탭바가 긴 화면을 가리면 axe 가 겹침으로 본다: 한 화면에 다 들어오게(문서 높이만큼) 키워서 잰다. */
async function axeZero(page: Page) {
  await tallViewport(page);
  const found = await seriousViolations(page);
  await page.setViewportSize({ width: 360, height: 740 });
  expect(found).toEqual([]);
}

const lock = (page: Page) => page.getByTestId("ask-chat-lock");
const field = (page: Page) => page.getByRole("textbox", { name: "이어서 궁금한 것" });
const send = (page: Page) => page.getByRole("button", { name: "보내기", exact: true });

for (const theme of THEMES) {
  test.describe(`${theme} 흐름`, () => {
    test(`질문 → 답 카드 → 이어서 묻기 → 짧은 답 → 다시 묻기(카드 갱신) → 짧은 답 (${theme}, 360px)`, async ({
      page,
    }, info) => {
      await page.addInitScript((t) => {
        localStorage.setItem("yj.theme", t);
        localStorage.setItem("yj.recorder", "엄마");
      }, theme);
      const shot = async (name: string) => {
        if (info.project.name !== "mobile-chromium") return;
        await stableShot(page, `ask3-${name}-${theme}-light`, true);
      };
      await login(page);

      // 1. 질문 → 답 카드
      await page.goto("/ask");
      await page.getByLabel("궁금한 것").fill("합성 질문: 낮잠 전에 인형을 꼭 안아요");
      await page.getByRole("button", { name: "보내기", exact: true }).click();
      await expect(page.getByRole("article", { name: "답변" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("단계 5", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "대화" })).toBeVisible();
      await expect(page.getByTestId("ask-turn-count")).toHaveText("이어서 묻기 0/10");
      await expect(send(page)).toBeDisabled();

      // 2. 이어서 묻기 → 입력 잠금(짧은 답을 만드는 중) → 짧은 답
      await field(page).fill("밤에도 같은 방법을 써도 될까요?");
      await expect(send(page)).toBeEnabled();
      await send(page).click();
      await expect(lock(page)).toHaveText("답을 만드는 중이에요 · 끝나면 이어서 물어볼 수 있어요");
      await expect(send(page)).toBeDisabled();
      await expect(field(page)).toHaveValue("");
      await shot("asked");
      await expect(page.getByText("짧은 답이에요 (합성 예시)")).toBeVisible({ timeout: 30_000 });
      await expect(lock(page)).toBeEmpty();
      await expect(page.getByTestId("ask-turn-count")).toHaveText("이어서 묻기 1/10");
      await expect(page.getByText("엄마 · ").first()).toBeVisible();

      // 3. 단계가 달라질 만한 후속 → 짧은 답 → 「카드를 다시 정리하는 중」 → 「카드가 새로 정리됐어요(단계 5 → 7)」
      await field(page).fill("요즘 더 심해져서 걱정돼요");
      await send(page).click();
      await expect(
        page.getByText("카드를 정리하는 중이에요 · 끝나면 이어서 물어볼 수 있어요"),
      ).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId("ask-card-redo-top")).toBeVisible();
      await expect(
        page.getByText("카드를 다시 정리하는 중이에요", { exact: true }).first(),
      ).toBeVisible();
      await shot("card-redo");
      await expect(page.getByText("카드가 새로 정리됐어요 (단계 5 → 7)")).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText("단계 7", { exact: true })).toBeVisible();
      await expect(page.getByText("1번째 답 · 1월 15일")).toBeVisible();
      await expect(lock(page)).toBeEmpty();

      // 4. 다시 묻기(👎 이유) → 질문은 done 그대로, 대화에 카드만 다시 만드는 턴 → 새 카드 버전
      await page.getByRole("button", { name: "도움이 안 됐어요", exact: true }).click();
      await page.getByRole("radio", { name: "우리 상황과 달라요", exact: true }).click();
      await page.getByLabel("더 알려 주고 싶은 점(선택)").fill("우리 집은 다르게 해요");
      await page.getByRole("button", { name: "다시 답변 받기" }).click();
      await expect(page.getByRole("article", { name: "답변" })).toBeVisible();
      await expect(page.getByRole("list", { name: "진행 단계" })).toHaveCount(0);
      await expect(page.getByText("다시 답변 요청: 우리 상황과 달라요")).toBeVisible();
      await expect(page.getByText("카드가 새로 정리됐어요 (단계 7 → 6)")).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText("단계 6", { exact: true })).toBeVisible();
      await expect(page.getByTestId("ask-turn-count")).toHaveText("이어서 묻기 3/10");
      await expect(lock(page)).toBeEmpty();

      // 5. 다시 묻기 뒤의 짧은 답
      await field(page).fill("그럼 낮에는 어떻게 해요?");
      await send(page).click();
      await expect(page.getByText("짧은 답이에요 (합성 예시)").nth(1)).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId("ask-turn-count")).toHaveText("이어서 묻기 4/10");
      await shot("done");
      await axeZero(page);
    });
  });
}

for (const theme of THEMES) {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`${theme} ${scheme} 변형`, () => {
      test.use({ colorScheme: scheme });

      test("대화 예시·한도·위급 실패·오프라인·잠금: axe 0 + 스크린샷", async ({ page }, info) => {
        await page.addInitScript((t) => {
          localStorage.setItem("yj.theme", t);
          localStorage.setItem("yj.recorder", "엄마");
        }, theme);
        const shot = async (name: string) => {
          if (info.project.name !== "mobile-chromium") return;
          await stableShot(page, `ask3-${name}-${theme}-${scheme}`, true);
        };
        await login(page);

        // 7: 카드 4개(3번 갱신) — 이름·시각·짧은 답·카드 갱신 Notice·한도 안내
        await page.goto("/ask/7");
        await expect(page.getByRole("heading", { level: 2, name: "대화" })).toBeVisible();
        await expect(page.getByText("카드가 새로 정리됐어요 (단계 5 → 7)")).toBeVisible();
        await expect(page.getByText("카드가 새로 정리됐어요 (단계 7 → 6)")).toBeVisible();
        await expect(page.getByText("카드가 새로 정리됐어요 (단계 6 → 5)")).toBeVisible();
        await expect(page.getByText("카드는 세 번까지 다시 만들 수 있어요")).toBeVisible();
        await expect(page.getByText("다시 답변 요청: 너무 일반적이에요")).toBeVisible();
        await axeZero(page);
        await shot("talk");

        // 8: 후속 10번 한도 → 「새 질문으로 이어가기」
        await page.goto("/ask/8");
        await expect(page.getByTestId("ask-turn-count")).toHaveText("이어서 묻기 10/10");
        await expect(page.getByRole("link", { name: "새 질문으로 이어가기" })).toBeVisible();
        await expect(field(page)).toHaveCount(0);
        await axeZero(page);

        // 9: 위급 후속의 카드 실패 → 이전 카드 위에 경고 고정
        await page.goto("/ask/9");
        await expect(page.getByTestId("ask-red-failed")).toHaveText(
          "답을 만들지 못했어요 · 지금 바로 119·응급실·소아과에 연락하세요",
        );
        await expect(page.getByText("카드를 새로 만들지 못했어요")).toBeVisible();
        await axeZero(page);
        await shot("redfail");

        // 10: 집 PC 꺼짐 + 활성 턴
        await page.goto("/ask/10");
        await expect(page.getByTestId("ask-chat-offline")).toHaveText("집 PC가 켜지면 답변해요.");
        await expect(lock(page)).toHaveText(
          "답을 만드는 중이에요 · 끝나면 이어서 물어볼 수 있어요",
        );
        await axeZero(page);

        // 11: 카드 정리 중(입력 잠금) — 위급 글을 쓰면 즉시 경고
        await page.goto("/ask/11");
        await expect(lock(page)).toHaveText(
          "카드를 정리하는 중이에요 · 끝나면 이어서 물어볼 수 있어요",
        );
        await expect(page.getByTestId("ask-card-redo-top")).toBeVisible();
        await field(page).fill("자다가 경련을 했어요");
        await expect(page.getByText(/지금 바로 119/).first()).toBeVisible();
        await expect(send(page)).toBeEnabled();
        await axeZero(page);
        await shot("locked-red");
      });
    });
  }
}

test("입력 잠금: 활성 턴이 있으면 보내기가 막히고 글은 미리 쓸 수 있다", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("yj.recorder", "엄마");
  });
  await login(page);
  await page.goto("/ask/11");
  await expect(lock(page)).toHaveText("카드를 정리하는 중이에요 · 끝나면 이어서 물어볼 수 있어요");
  await field(page).fill("이어서 묻고 싶은 것");
  await expect(field(page)).toHaveValue("이어서 묻고 싶은 것");
  await expect(send(page)).toBeDisabled();
  await expect(page.getByText(/119/)).toHaveCount(0);
});

test("후속 10번 한도: 「새 질문으로 이어가기」는 원 질문 링크가 든 초안으로 /ask 를 연다", async ({
  page,
}) => {
  await login(page);
  await page.goto("/ask/8");
  await page.getByRole("link", { name: "새 질문으로 이어가기" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "물어보기" })).toBeVisible();
  await expect(page.getByLabel("궁금한 것")).toHaveValue(/\/ask\/8\)/);
});

test("위급 후속: 진행 중 턴·한도와 상관없이 보내고, 질문은 위급 단계 10 카드로 바뀐다", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("yj.recorder", "아빠");
  });
  await login(page);
  await page.goto("/ask/2");
  await field(page).fill("자다가 경련을 했어요");
  await expect(page.getByText(/지금 바로 119/).first()).toBeVisible();
  await send(page).click();
  await expect(
    page.getByText("카드를 정리하는 중이에요 · 끝나면 이어서 물어볼 수 있어요"),
  ).toBeVisible();
  await expect(page.getByText("단계 10", { exact: true })).toBeVisible({ timeout: 30_000 });
  // 위급 잠금: 다시 답변 버튼은 비활성
  await page.getByRole("button", { name: "도움이 안 됐어요", exact: true }).click();
  await page.getByRole("radio", { name: "이미 해 봤어요", exact: true }).click();
  await expect(page.getByRole("button", { name: "다시 답변 받기" })).toBeDisabled();
  await expect(
    page.getByText(
      "위급 질문이라 카드는 10단계로 유지해요 · 다른 걱정은 새 질문으로 물어봐 주세요",
    ),
  ).toBeVisible();
});

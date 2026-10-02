import { expect, test, type Page } from "@playwright/test";

// 핵심 흐름 2·3 (docs/08 §2) + 고치기·지우기·키보드. FAKE mock API(vite-plugins/mock/logs.ts, 브라우저 세션별 저장)에 대해 돈다.

test.describe.configure({ timeout: 60_000 });

async function login(page: Page) {
  await page.goto("/");
  for (const d of "0000") await page.getByRole("button", { name: d, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "홈" })).toBeVisible();
}

const btn = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

/** 저녁 식사 질문 8개에 답한다(각 답을 고르면 자동으로 다음 화면). */
async function answerMeal(page: Page, tantrum = "5분") {
  await btn(page, "저녁 식사").click();
  for (const a of ["O", "달래서 옴", tantrum, "없음", "조금", "없음", "X", "없음"]) {
    await btn(page, a).click();
  }
  await expect(page.getByRole("heading", { level: 2, name: "저녁 식사 확인" })).toBeVisible();
}

async function saveMeal(page: Page, tantrum?: string) {
  await answerMeal(page, tantrum);
  await btn(page, "엄마").click();
  await btn(page, "저장").click();
}

test("흐름 2: 저녁 식사를 30초 안에 입력 -> 목록·요약 반영 -> 25분 경고 -> 가이드 링크", async ({
  page,
}) => {
  page.on("dialog", () => {
    throw new Error("native dialog must not be used");
  });
  await login(page);
  const started = Date.now();
  await page.getByRole("link", { name: "기록", exact: true }).click();
  await page.getByRole("link", { name: "기록하기" }).click();
  await saveMeal(page, "25분");
  await expect(page.getByRole("heading", { level: 2, name: "저장했어요" })).toBeVisible();
  expect(Date.now() - started).toBeLessThan(30_000);

  // 저장 후에는 사실만: 몇 번째 기록인지. 칭찬·평가 문구 없음.
  await expect(page.getByText("이번 주 1번째 기록")).toBeVisible();
  await expect(page.getByText("떼쓴 시간 25분 이상이 기록됐어요.")).toBeVisible();
  const guide = page.getByRole("link", { name: "도움 받을 때 기준 보기" });
  await expect(guide).toHaveAttribute("href", "/library/doc/guide-05#3-1");
  await expect(page.locator("main")).not.toContainText(/잘했|훌륭|정상|지연|달성|미달/);

  await page.getByRole("link", { name: "기록 목록" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "기록" })).toBeVisible();
  const card = page.locator("article.log-card");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("저녁 식사");
  await expect(card).toContainText("떼쓴 시간 25분");

  // 경고 목록 -> 가이드 링크
  const alerts = page.getByRole("region", { name: /도움 받을 때 기준에 해당한 기록 1건/ });
  await expect(alerts.getByRole("link", { name: "도움 받을 때 기준 보기" })).toHaveAttribute(
    "href",
    "/library/doc/guide-05#3-1",
  );

  // 종류를 고르면 주차 비교와 교차표
  await btn(page, "저녁 식사").click();
  const weeks = page.getByRole("table", { name: "저녁 식사 주차별 기록" });
  await expect(weeks).toBeVisible();
  await expect(weeks.getByRole("columnheader", { name: /1주차/ })).toBeVisible();
  await expect(weeks.getByRole("row", { name: /기록 수/ })).toContainText("1건");
  await expect(weeks.getByRole("row", { name: /떼쓴 시간/ })).toContainText(
    /평균 25분\s*최대 25분/,
  );
  const cross = page.getByRole("table", { name: "식전 간식별 먹은 양 기록 수" });
  await expect(cross.getByRole("row", { name: /^없음/ })).toContainText("1");
});

test("흐름 3: 오프라인에서 기록 2건 -> 온라인 복귀 -> 자동 전송, 중복 없음", async ({
  page,
  context,
}) => {
  await login(page);
  await page.getByRole("link", { name: "기록", exact: true }).click();
  await page.getByRole("link", { name: "기록하기" }).click();
  // 입력 화면 조각(lazy)이 내려온 뒤에 연결을 끊는다("저녁 식사" 칩은 기록 목록 화면에도 있다).
  await expect(page.getByRole("heading", { level: 2, name: "무엇을 기록할까요?" })).toBeVisible();

  // 배너의 건수 부분(lazy)이 내려온 뒤에 연결을 끊는다(로그인 1.5초 뒤 미리 받아 둔다).
  await expect
    .poll(() =>
      page.evaluate(
        "performance.getEntriesByType('resource').some((e) => e.name.includes('QueueBanners'))",
      ),
    )
    .toBe(true);
  await context.setOffline(true);
  await saveMeal(page, "5분");
  await expect(page.getByRole("heading", { level: 2, name: "기기에 저장했어요" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "오프라인" })).toContainText(
    "오프라인이에요. 보내지 않은 기록 1건은 연결되면 보내요.",
  );
  await btn(page, "하나 더 기록하기").click();
  await saveMeal(page, "10분");
  await expect(page.getByRole("status").filter({ hasText: "오프라인" })).toContainText(
    "보내지 않은 기록 2건은 연결되면 보내요.",
  );
  const stats = async () =>
    (await (await page.request.get("/api/logs/__stats")).json()) as { puts: number; rows: number };
  expect(await stats()).toEqual({ puts: 0, rows: 0 }); // 끊긴 동안 서버에는 아무것도 가지 않았다

  await context.setOffline(false);
  await expect(page.locator(".offline-banner")).toHaveCount(0);
  await expect.poll(stats).toEqual({ puts: 2, rows: 2 }); // 한 번씩만 보냈고 서버에 2건
  const ids = (
    (await (await page.request.get("/api/logs")).json()) as { items: { id: string }[] }
  ).items.map((i) => i.id);
  expect(new Set(ids).size).toBe(2);

  // IndexedDB 대기열은 비었다
  const left = await page.evaluate(
    "new Promise((res) => { const r = indexedDB.open('yj-queue', 1); r.onsuccess = () => { const q = r.result.transaction('pending').objectStore('pending').count(); q.onsuccess = () => res(q.result); }; })",
  );
  expect(left).toBe(0);
});

test("일시 오류(503)면 대기열에 남고 지수 백오프로 다시 보내 서버에는 1건", async ({ page }) => {
  await login(page);
  await page.goto("/logs/new");
  await page.request.post("/api/logs/__fail", { data: { n: 1 } });
  await saveMeal(page);
  await expect(page.getByRole("heading", { level: 2, name: "기기에 저장했어요" })).toBeVisible();
  await expect
    .poll(
      async () => (await (await page.request.get("/api/logs/__stats")).json()) as { rows: number },
      {
        timeout: 15_000,
      },
    )
    .toEqual({ puts: 2, rows: 1 }); // 503 한 번 + 재전송 성공 한 번, 행은 1개
  await expect(page.locator(".offline-banner")).toHaveCount(0);
});

test("직접 입력은 범위를 벗어나면 이유를 보여 주고 넘어가지 않는다", async ({ page }) => {
  await login(page);
  await page.goto("/logs/new");
  // 직접 입력에 범위를 벗어난 값
  await btn(page, "저녁 식사").click();
  await btn(page, "O").click();
  await btn(page, "달래서 옴").click();
  await btn(page, "직접").click();
  await page.getByLabel("직접 입력 (분)").fill("999");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("0부터 120 사이 숫자를 적어 주세요.");
  await expect(page.getByRole("heading", { level: 2, name: "떼쓴 시간" })).toBeVisible();
});

test("고치기와 지우기(앱 안 확인 대화상자, 취소 시 그대로)", async ({ page }) => {
  page.on("dialog", () => {
    throw new Error("native dialog must not be used");
  });
  await login(page);
  await page.goto("/logs/new");
  await saveMeal(page, "5분");
  await expect(page.getByRole("heading", { level: 2, name: "저장했어요" })).toBeVisible();
  await page.getByRole("link", { name: "기록 목록" }).click();

  // 고치기: 먹은 양만 바꾼다
  await page.getByRole("link", { name: /기록 고치기$/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "기록 고치기" })).toBeVisible();
  await page.getByRole("button", { name: /^먹은 양 조금 고치기$/ }).click();
  await btn(page, "많이").click();
  await expect(page.getByRole("heading", { level: 2, name: "저녁 식사 확인" })).toBeVisible();
  await btn(page, "저장").click();
  await expect(page.getByRole("heading", { level: 2, name: "고쳤어요" })).toBeVisible();
  await expect(page.getByText("이번 주 기록 1건")).toBeVisible();
  await page.getByRole("link", { name: "기록 목록" }).click();
  await expect(page.locator("article.log-card")).toContainText("먹은 양 많이");
  await expect(page.locator("article.log-card")).toHaveCount(1);

  // 지우기: Esc 로 취소하면 그대로, 확인하면 사라진다
  await page.getByRole("button", { name: /기록 지우기$/ }).click();
  const dlg = page.getByRole("dialog", { name: "이 기록을 지울까요?" });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole("button", { name: "취소" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await expect(page.locator("article.log-card")).toHaveCount(1);
  await page.getByRole("button", { name: /기록 지우기$/ }).click();
  await dlg.getByRole("button", { name: "지우기" }).click();
  await expect(page.locator("article.log-card")).toHaveCount(0);
  await expect(page.getByText("아직 기록이 없어요.")).toBeVisible();
});

test("키보드만으로 입력: Enter 로 고르면 다음 질문 제목으로 포커스가 옮겨 간다", async ({
  page,
}) => {
  await login(page);
  await page.goto("/logs/new");
  await btn(page, "저녁 식사").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: "미리 알림" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(btn(page, "O")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.getByRole("heading", { level: 2, name: "식탁에 올 때" })).toBeFocused();
  // 이전 버튼으로 돌아가면 이미 고른 값이 눌린 채로 보인다
  await page.getByRole("button", { name: "이전", exact: true }).click();
  await expect(btn(page, "O")).toHaveAttribute("aria-pressed", "true");
});

test("기본 기록자는 이 기기에 기억된다", async ({ page }) => {
  await login(page);
  await page.goto("/logs/new");
  await saveMeal(page);
  await expect(page.getByRole("heading", { level: 2, name: "저장했어요" })).toBeVisible();
  await btn(page, "하나 더 기록하기").click();
  await answerMeal(page);
  await expect(btn(page, "엄마")).toHaveAttribute("aria-pressed", "true");
});

test("홈의 오늘 기록하기 -> 기록 입력 화면(/logs/new)", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "오늘 기록하기" }).click();
  await expect(page).toHaveURL(/\/logs\/new$/);
  await expect(btn(page, "저녁 식사")).toBeVisible();
});

test("손 뜯기: 손 상태 선택지는 「이상 없음」 으로 보이고 「정상」 은 어디에도 보이지 않는다", async ({
  page,
}) => {
  await login(page);
  await page.goto("/logs/new");
  await btn(page, "손 뜯기").click();
  await btn(page, "영상").click();
  await btn(page, "심심").click();
  await expect(page.getByRole("heading", { level: 2, name: "손 상태" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText("정상");
  await btn(page, "이상 없음").click();
  await btn(page, "건너뛰기").click();
  await expect(page.getByRole("heading", { level: 2, name: "손 뜯기 확인" })).toBeVisible();
  await expect(page.locator("main")).toContainText("이상 없음");
  await expect(page.locator("main")).not.toContainText("정상");
  await btn(page, "엄마").click();
  await btn(page, "저장").click();
  await expect(page.getByRole("heading", { level: 2, name: "저장했어요" })).toBeVisible();
  // 서버에는 저장 값 「정상」 으로 간다(기존 기록과 같은 값), 화면에는 「이상 없음」
  const items = (await (await page.request.get("/api/logs")).json()) as {
    items: { payload: Record<string, string> }[];
  };
  expect(items.items[0]?.payload.hand_state).toBe("정상");
  await page.goto("/logs");
  await expect(page.locator("article.log-card").first()).toContainText("손 상태 이상 없음");
  await expect(page.locator("main")).not.toContainText("정상");
});

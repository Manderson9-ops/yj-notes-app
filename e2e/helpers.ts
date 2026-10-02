import type { Page } from "@playwright/test";

/** 끝나는 전환·등장 모션이 지난 뒤로 기다린다(문자열 실행: e2e 의 tsconfig 에는 DOM 타입이 없다). */
export async function settle(page: Page) {
  await page.evaluate(
    "Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished))",
  );
}

/**
 * 같은 화면이면 같은 PNG 가 나오게 찍는다: 찍는 순간만 reduced-motion 으로 모든 애니메이션(흔들리는 잎 등)을
 * 정지시키고, 글꼴 로딩을 기다린 뒤 되돌린다. 모션 검사(theme.spec)와는 분리돼 있다.
 */
export async function stableShot(page: Page, path: string, fullPage = false) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await settle(page);
  await page.evaluate("document.fonts.ready.then(() => true)");
  await page.screenshot({ path, fullPage });
  await page.emulateMedia({ reducedMotion: null });
}

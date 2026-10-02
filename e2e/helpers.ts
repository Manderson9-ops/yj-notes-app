import { writeFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";

/** 끝나는 전환·등장 모션이 지난 뒤로 기다린다(문자열 실행: e2e 의 tsconfig 에는 DOM 타입이 없다). */
export async function settle(page: Page) {
  await page.evaluate(
    "Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished))",
  );
}

/**
 * 같은 화면이면 같은 PNG 가 나오게 찍는다: 찍는 순간만 reduced-motion 으로 모든 애니메이션(흔들리는 잎 등)을
 * 정지시키고, 글꼴 로딩을 기다린 뒤 되돌린다. 모션 검사(theme.spec)와는 분리돼 있다.
 *
 * name: 확장자 없는 파일 이름(예: "pin-crayon-light"). 저장·기준 위치는 e2e/__screenshots__/<name>.png.
 * CSS 마스크·border-image 의 data URI 이미지는 비동기로 디코드되므로, 연속 세 장이 같아질 때까지 다시 찍는다.
 * - 로컬 Windows(CI 아님): 커밋된 PNG 와 비교한다(시각 회귀 게이트, 픽셀 차이 비율 0.2% 이하, 픽셀별 색 차이 threshold 0.05 — playwright.config.ts).
 *   디자인을 일부러 바꿨다면 `npx playwright test --update-snapshots`.
 * - 그 밖(CI 의 linux 컨테이너 등): 렌더가 달라 비교하지 않고 파일로 저장만 한다.
 */
/** CSS 에 들어 있는 data URI 이미지(마스크·border-image)를 미리 불러와 디코드 완료를 기다린다. */
async function preloadCssImages(page: Page) {
  await page.evaluate(String.raw`(async () => {
    const urls = new Set();
    const scan = (rules) => {
      for (const r of rules) {
        if (r.cssRules) scan(r.cssRules);
        for (const m of (r.cssText || "").matchAll(/url\("(data:image[^"]+)"\)/g)) urls.add(m[1]);
      }
    };
    for (const s of document.styleSheets) {
      try { scan(s.cssRules); } catch { /* 교차 출처 시트는 건너뜀 */ }
    }
    await Promise.all([...urls].map((u) => new Promise((res) => {
      const i = new Image();
      i.onload = i.onerror = () => res(true);
      i.src = u;
    })));
    return urls.size;
  })()`);
}

export async function stableShot(page: Page, name: string, fullPage = false) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await settle(page);
  // 선언된 @font-face 를 전부 불러온다(ready 만으로는 "아직 요청 전" 인 장식 폰트를 놓쳐 레이아웃이 뒤늦게 바뀐다)
  await page.evaluate(
    "Promise.all([...document.fonts].map((f) => f.load().catch(() => null))).then(() => document.fonts.ready).then(() => true)",
  );
  await preloadCssImages(page);
  if (fullPage) {
    // sticky 탭바가 전체 페이지 캡처 중간에 찍히지 않게 흐름 안에 둔다(base.css .is-static-for-shot)
    await page.evaluate("document.querySelector('.tabbar')?.classList.add('is-static-for-shot')");
    // 화면 밖 층(마스크·필터)이 늦게 래스터되지 않도록 한 번 끝까지 훑는다
    await page.evaluate(
      "(async () => { for (let y = 0; y <= document.documentElement.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); } window.scrollTo(0, 0); })()",
    );
  }
  // 연속 세 장이 같아질 때까지 다시 찍는다
  let shot = await page.screenshot({ fullPage });
  let same = 0;
  for (let i = 0; i < 12 && same < 2; i++) {
    await page.waitForTimeout(250);
    const next = await page.screenshot({ fullPage });
    same = next.equals(shot) ? same + 1 : 0;
    shot = next;
  }
  if (process.platform === "win32" && !process.env.CI) {
    expect(shot).toMatchSnapshot(`${name}.png`);
  } else {
    await writeFile(`e2e/__screenshots__/${name}.png`, shot);
  }
  if (fullPage) {
    await page.evaluate(
      "document.querySelector('.tabbar')?.classList.remove('is-static-for-shot')",
    );
  }
  await page.emulateMedia({ reducedMotion: null });
}

import { writeFile } from "node:fs/promises";
import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 끝나는 전환·등장 모션이 지난 뒤로 기다린다(문자열 실행: e2e 의 tsconfig 에는 DOM 타입이 없다).
 * 실행 중(running)인 유한 모션만 기다리고, 최대 3초에서 끊는다: CI(linux) webkit 에서 `finished` 가
 * 끝내 풀리지 않는 애니메이션이 있어 테스트가 30초 제한에 걸렸다(PR #2 최초 CI).
 */
export async function settle(page: Page) {
  await page.evaluate(
    "Promise.race([Promise.all(document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, 3000))])",
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
  await page.evaluate(
    "Promise.all([...document.fonts].map((f) => f.load().catch(() => null))).then(() => true)",
  );
  await preloadCssImages(page);
  // 전체 페이지는 fullPage 캡처 대신 뷰포트를 페이지 높이만큼 키워 찍는다: position:fixed 배경 층(숲 워시·종이 결)이
  // 첫 화면 높이에서 끊겨 중간에 경계선이 생기는 캡처 산출물을 없앤다. sticky 탭바는 흐름 안에 둔다.
  const original = page.viewportSize();
  if (fullPage && original) {
    await page.evaluate("document.querySelector('.tabbar')?.classList.add('is-static-for-shot')");
    const height = Number(await page.evaluate("document.documentElement.scrollHeight"));
    await page.setViewportSize({ width: original.width, height });
    await page.waitForTimeout(300);
  }
  // 연속 세 장이 같아질 때까지 다시 찍는다
  let shot = await page.screenshot();
  let same = 0;
  for (let i = 0; i < 12 && same < 2; i++) {
    await page.waitForTimeout(250);
    const next = await page.screenshot();
    same = next.equals(shot) ? same + 1 : 0;
    shot = next;
  }
  if (process.platform === "win32" && !process.env.CI) {
    expect(shot).toMatchSnapshot(`${name}.png`);
  } else {
    await writeFile(`e2e/__screenshots__/${name}.png`, shot);
  }
  if (fullPage && original) {
    await page.setViewportSize(original);
    await page.evaluate(
      "document.querySelector('.tabbar')?.classList.remove('is-static-for-shot')",
    );
  }
  await page.emulateMedia({ reducedMotion: null });
}
/**
 * 작은 요소 하나만 찍어 비교한다(h2 띠·선택 칩·주 버튼 등). 전체 화면 비교는 면적이 커서 작은 요소의 미세한 색 변화를
 * 놓칠 수 있으므로, 요소 단위로 더 엄격하게(threshold 0.02) 본다. 저장·비교 위치와 규칙은 stableShot 과 같다.
 */
export async function stableElementShot(page: Page, target: Locator, name: string) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await settle(page);
  await page.evaluate(
    "Promise.all([...document.fonts].map((f) => f.load().catch(() => null))).then(() => true)",
  );
  await preloadCssImages(page);
  await target.scrollIntoViewIfNeeded();
  let shot = await target.screenshot();
  let same = 0;
  for (let i = 0; i < 12 && same < 2; i++) {
    await page.waitForTimeout(250);
    const next = await target.screenshot();
    same = next.equals(shot) ? same + 1 : 0;
    shot = next;
  }
  if (process.platform === "win32" && !process.env.CI) {
    expect(shot).toMatchSnapshot(`${name}.png`, { threshold: 0.02, maxDiffPixelRatio: 0.002 });
  } else {
    await writeFile(`e2e/__screenshots__/${name}.png`, shot);
  }
  await page.emulateMedia({ reducedMotion: null });
}

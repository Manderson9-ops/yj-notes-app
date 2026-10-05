import { describe, expect, it } from "vitest";
import { levelNearSuggestion, PERSISTENT, suggestLevel } from "./level-suggest.ts";

const none = { frequency: null, duration: null, impact: null, aggression: null };

describe("권장 단계(낮은 단계 안정화)", () => {
  it("지속되는 모습(늘·자꾸·계속·매일·가만히 못·하루에 N번)을 걱정하지만 영향이 없으면 3", () => {
    for (const body of [
      "아이가 가만히 못 있어요",
      "자꾸 손톱을 뜯어요",
      "늘 짜증을 내요",
      "계속 울어요",
      "매일 밥을 남겨요",
      "맨날 떼를 써요",
      "하루에 5번 던져요",
    ]) {
      expect(suggestLevel(body, none).level, body).toBe(3);
    }
  });
  it("한 번의 흔한 감정 표현(엄마 미워 등)은 2", () => {
    expect(suggestLevel("엄마 미워 라고 했어요", none)).toMatchObject({ level: 2 });
    expect(suggestLevel("화를 냈어요", none).level).toBe(2);
  });
  it("아무 신호도 없으면 2", () => {
    expect(suggestLevel("점심을 반만 먹었어요", none)).toEqual({
      level: 2,
      why: "빈도·지속·영향이 적혀 있지 않아요",
    });
    expect(suggestLevel("점심을 반만 먹었어요").level).toBe(2); // 확장 실패도 글만으로 계산
  });
  it("「오늘」처럼 늘이 들어간 낱말은 지속 신호가 아니다", () => {
    expect(PERSISTENT.test("오늘 점심을 남겼어요")).toBe(false);
    expect(suggestLevel("오늘 점심을 남겼어요", none).level).toBe(2);
  });
  it("확장이 뽑은 빈도·영향이 있으면 반영: 빈도+영향 4, 영향만 3, 빈도만 3", () => {
    expect(
      suggestLevel("밥을 안 먹어요", {
        ...none,
        frequency: "하루 세 끼",
        impact: "체중이 줄었어요",
      }).level,
    ).toBe(4);
    expect(suggestLevel("밥을 안 먹어요", { ...none, impact: "잠을 못 자요" }).level).toBe(3);
    expect(suggestLevel("밥을 안 먹어요", { ...none, frequency: "자주" }).level).toBe(3);
  });
  it("결정적이다(같은 질문은 늘 같은 값)", () => {
    const a = suggestLevel("엄마 미워 라고 했어요", none);
    for (let i = 0; i < 5; i++) expect(suggestLevel("엄마 미워 라고 했어요", none)).toEqual(a);
  });
  it("±1 안이거나 levelReason 이 기록·근거를 대면 통과, 아니면 불통과", () => {
    const s = { level: 2, why: "x" };
    expect(levelNearSuggestion(1, s, "아무 말", [])).toBe(true);
    expect(levelNearSuggestion(3, s, "아무 말", [])).toBe(true);
    expect(levelNearSuggestion(4, s, "아무 말", [])).toBe(false);
    expect(levelNearSuggestion(4, s, "알림장 기록에서 반복돼요", [])).toBe(true);
    expect(
      levelNearSuggestion(1, { level: 3, why: "x" }, "근거 NORM-FEED-01 에 따라", ["NORM-FEED-01"]),
    ).toBe(true);
    expect(levelNearSuggestion(1, { level: 3, why: "x" }, "그냥", ["NORM-FEED-01"])).toBe(false);
  });
});

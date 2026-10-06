import { describe, expect, it } from "vitest";
import {
  durationAtLeast4Weeks,
  levelNearSuggestion,
  levelProblem,
  PERSISTENT,
  suggestLevel,
} from "./level-suggest.ts";

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
  it("권장과 같으면 통과, ±1 은 특정 기록·근거를 댈 때만, 그 밖은 SOFT", () => {
    const s = { level: 3, why: "x" };
    expect(levelProblem(3, s, "아무 말")).toBeNull();
    expect(levelProblem(4, s, "아무 말")?.severity).toBe("soft");
    expect(levelProblem(4, s, "2020-03-02 알림장에서 반복돼요")).toBeNull();
    expect(levelProblem(2, s, "근거 기록에 따라")).toBeNull();
    expect(levelProblem(5, s, "알림장 기록에서 반복돼요")?.severity).toBe("soft"); // ±1 밖은 기록을 대도 SOFT
    expect(levelNearSuggestion(3, s, "x")).toBe(true);
  });
});

describe("권장 단계 보정(공격·4주 이상·퇴행·말 더듬)", () => {
  it("(a) 남에게 향한 공격 행동은 최소 4(교사·부모 보고 모두), HARD 최소선", () => {
    for (const b of [
      "선생님이 친구를 때린다고 하세요",
      "동생을 물어요",
      "엄마를 밀어요",
      "친구에게 장난감을 던져요",
    ]) {
      const s = suggestLevel(b, none);
      expect(s.level, b).toBeGreaterThanOrEqual(4);
      expect(s.min, b).toBe(4);
    }
    expect(suggestLevel("장난감을 던져요", none).min).toBeUndefined(); // 대상이 사람이 아님
    expect(suggestLevel("밥을 던져요", { ...none, aggression: "친구를 때려요" }).min).toBe(4);
    expect(levelProblem(3, suggestLevel("친구를 때려요", none), "")?.severity).toBe("hard");
    expect(levelProblem(4, suggestLevel("친구를 때려요", none), "")).toBeNull();
  });
  it("(b) 4주 이상(한 달·4주·몇 주째·N주째·몇 달)은 5, 영향이 적혔으면 6", () => {
    for (const b of [
      "한 달째 그래요",
      "4주째예요",
      "몇 주째 그래요",
      "6주 동안 그래요",
      "몇 달 됐어요",
      "2개월째예요",
    ]) {
      expect(suggestLevel(b, none).level, b).toBe(5);
    }
    expect(suggestLevel("한 달째 그래요", { ...none, impact: "잠을 못 자요" }).level).toBe(6);
    expect(suggestLevel("2주째 그래요", none).level).toBe(2);
    expect(suggestLevel("30개월인데 3주째 그래요", none).level).toBe(2);
    expect(durationAtLeast4Weeks("일주일째")).toBe(false);
    expect(suggestLevel("한 달째", { ...none, duration: "한 달" }).min).toBeUndefined();
  });
  it("(c) 하던 것을 못 함·퇴행은 9(8 아님), 8 이하는 HARD", () => {
    for (const b of ["말을 하다가 못 하게 됐어요", "퇴행한 것 같아요", "하던 말을 못 해요"]) {
      const s = suggestLevel(b, none);
      expect(s.level, b).toBe(9);
      expect(s.min).toBe(9);
    }
    // 확장 모델의 domain 추정만으로는 9 로 올리지 않는다(동생 생긴 뒤 아기처럼 구는 흔한 모습 오분류 방지).
    expect(suggestLevel("그냥 걱정돼요", none, ["skill_loss"]).level).toBeLessThan(9);
    expect(
      suggestLevel("동생 이야기를 꺼내면 아기처럼 말하고 안아달라고만 해요", none, ["skill_loss"])
        .level,
    ).toBeLessThan(9);
    expect(
      suggestLevel("예전엔 두 단어로 말하던 걸 요즘은 거의 안 하고 손짓만 해요", none).level,
    ).toBe(9);
    expect(suggestLevel("전에는 혼자 걷던 계단을 이제 안 해요", none).level).toBe(9);
    expect(levelProblem(8, suggestLevel("퇴행했어요", none), "")?.severity).toBe("hard");
    expect(levelProblem(9, suggestLevel("퇴행했어요", none), "")).toBeNull();
  });
  it("(d) 말 더듬 4주 이상은 5~6 이고 며칠 지켜보기 금지(noWait)", () => {
    const s = suggestLevel("말을 더듬어요 한 달 됐어요", none, ["fluency"]);
    expect(s).toMatchObject({ level: 5, noWait: true });
    expect(
      suggestLevel("말을 더듬어요 한 달 됐어요", { ...none, impact: "말을 안 하려 해요" }).level,
    ).toBe(6);
    expect(suggestLevel("말을 더듬어요", none).noWait).toBeUndefined();
  });
  it("가장 높은 규칙이 이긴다(퇴행+공격)", () => {
    const s = suggestLevel("친구를 때리고 하던 말을 못 해요", none);
    expect(s.level).toBe(9);
    expect(s.min).toBe(9);
  });
});

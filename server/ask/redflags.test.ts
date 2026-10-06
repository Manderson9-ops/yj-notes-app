import { describe, expect, it } from "vitest";
import { hasForbiddenWord } from "../../shared/ask-forbidden";
import { detectRedFlag, RED_FLAG_RULE_COUNT } from "./redflags";

// 합성 문장만 쓴다.
const POSITIVE = [
  "자다가 숨을 못 쉬는 것 같아요",
  "숨 쉬기 힘들어 보여요",
  "호흡곤란 같아요",
  "입술이 파랗게 변했어요",
  "얼굴이 파래졌어요",
  "의식이 없는 것 같아요",
  "깨워도 안 일어나요",
  "반응이 없어요",
  "경련을 했어요",
  "발작 같은 게 있었어요",
  "건전지를 삼켰어요",
  "작은 장난감을 삼킨 것 같아요",
  "세제를 마셨어요",
  "약을 잘못 먹었어요",
  "독을 먹었을까요",
  "심하게 다쳤어요",
  "피가 많이 나요",
  "피가 계속 나요",
  "머리를 부딪혔어요",
  "머리 세게 박았어요",
  "고열이 있어요",
  "열이 40도예요",
  "탈수 같아요",
  "소변을 안 봐요",
  "자해를 해요",
  "학대가 걱정돼요",
  "갑자기 못 걸어요",
  "갑자기 말을 안 해요",
  "숨 이 안 쉬어 져요", // 띄어쓰기 변형
];

const NEGATIVE = [
  "숨바꼭질 하다가 울었어요",
  "간식 시간에 자꾸 던져요",
  "낮잠을 안 자요",
  "친구A 와 장난감을 나눠요",
  "머리를 빗기 싫어해요",
  "약 먹이기 힘들어요",
  "밥을 천천히 삼켜요",
  "가끔 피곤해해요",
  "",
];

describe("detectRedFlag", () => {
  it.each(POSITIVE)("위급 신호: %s", (text) => {
    expect(detectRedFlag(text).redFlag).toBe(true);
  });
  it.each(NEGATIVE)("일상 질문은 아니다: %s", (text) => {
    expect(detectRedFlag(text).redFlag).toBe(false);
  });
  it("걸린 규칙 번호만 돌려주고 원문은 담지 않는다", () => {
    const r = detectRedFlag("입술이 파랗게 변했고 경련도 했어요");
    expect(r.rules.length).toBeGreaterThanOrEqual(2);
    expect(r.rules.every((n) => n >= 0 && n < RED_FLAG_RULE_COUNT)).toBe(true);
    expect(JSON.stringify(r)).not.toContain("입술");
  });
  it("전각 공백·영폭 공백이 섞여도 같다", () => {
    expect(detectRedFlag("경\u200b련").redFlag).toBe(true);
    expect(detectRedFlag("숨\u3000을\u3000못 쉬어요").redFlag).toBe(true);
  });
});

describe("hasForbiddenWord (판정 어휘)", () => {
  it.each([
    "정상이에요",
    "비정상 행동",
    "이상해 보여요",
    "이상 행동이 있어요",
    "발달 지연",
    "장애가 있어요",
    "문제아 같아요",
    "ADHD 같아요",
  ])("막는다: %s", (t) => {
    expect(hasForbiddenWord(t)).toBe(true);
  });
  it.each([
    "흔해요",
    "지켜봐요",
    "상담을 권해요",
    "1주 이상 기록해요",
    "하루 5번 이상이에요",
    "25분 이상 이어져요",
  ])("허용한다: %s", (t) => {
    expect(hasForbiddenWord(t)).toBe(false);
  });
});

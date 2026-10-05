// 전수 검색·작성자 표기·호칭·축 꼬리표·응급·전문 기관·kind 규칙의 결정적 검사.
import { describe, expect, it } from "vitest";
import {
  checkAnswer,
  packMeta,
  statedAuthor,
  statedPlace,
  stripAxisTags,
  type PackInfo,
} from "./checks.ts";
import { goodAnswer } from "./fixtures.ts";

const BASE_PACK =
  "## A. 아이 요약\n- 현재 월령: 30개월\n" +
  "- [ref: note:2020-03-02] [2020-03-02][작성자: 교사][장소: 어린이집][글 종류: 알림장 본문] 밥을 반만 먹었어요 (반 친구일 수 있음)\n" +
  "- [ref: note:2020-03-02] [2020-03-02][작성자: 부모][장소: 집][글 종류: 댓글] 집에서는 잘 먹어요\n" +
  "- [ref: note:2020-03-04] [2020-03-04][작성자: 부모][장소: 모름][글 종류: 댓글] 새벽에 깼어요\n" +
  "- [ref: SYN-IV-01] 실천";

const info = (over: Partial<PackInfo> = {}): PackInfo => ({
  pack: BASE_PACK,
  refs: ["note:2020-03-02", "note:2020-03-04", "SYN-IV-01", "INT-FLUENCY-01"],
  search: {
    total: 7,
    shown: 3,
    dates: ["2020-03-04", "2020-03-02"],
    keywords: { 밥: 7 },
    ints: ["INT-FEED-01"],
  },
  ...over,
});

const record = (date: string, what: string, link = "질문과 이어져요") => ({
  date,
  what,
  link,
  source: "알림장" as const,
});

describe("「기록이 없어요」 오류 주장 대조", () => {
  it("전수 검색에 걸린 낱말을 「기록이 없어요」라고 하면 건수·날짜와 함께 알린다", () => {
    const r = checkAnswer(goodAnswer({ limits: "밥 관련 기록이 없어요" }), info(), false);
    expect(r.ok).toBe(false);
    expect(r.issues).toContain("[ungrounded] 전수 검색에 7건이 있어요: 2020-03-04, 2020-03-02");
  });
  it("검색 낱말과 상관없는 한계 서술은 통과", () => {
    expect(
      checkAnswer(goodAnswer({ limits: "체중 변화는 확인되지 않아요" }), info(), false).ok,
    ).toBe(true);
  });
  it("전수 검색 결과가 0건이면 같은 말도 허용", () => {
    const zero = info({ search: { total: 0, shown: 0, dates: [], keywords: {}, ints: [] } });
    expect(checkAnswer(goodAnswer({ limits: "밥 관련 기록이 없어요" }), zero, false).ok).toBe(true);
  });
  it("실천 프로토콜(INT-*)이 있는데 「근거가 없어요」라고 하면 알린다", () => {
    const r = checkAnswer(goodAnswer({ limits: "이 행동에 대한 근거가 없어요" }), info(), false);
    expect(r.issues).toContain("[ungrounded] 근거 묶음에 실천 프로토콜이 있어요: INT-FEED-01");
  });
});

describe("작성자·장소 표기 대조(fromRecords)", () => {
  it("묶음 표시와 다른 작성자·장소를 지적한다", () => {
    const r = checkAnswer(
      goodAnswer({
        fromRecords: [
          record("2020-03-04", "선생님이 새벽에 깼다고 적었어요"), // 그날은 부모 글
          record("2020-03-02", "어린이집에서 밥을 반만 먹었어요"), // 맞음(교사/어린이집)
          record("2020-03-02", "엄마가 집에서 잘 먹는다고 했어요"), // 맞음(부모/집)
        ],
      }),
      info(),
      false,
    );
    expect(r.issues.filter((i) => i.includes("작성자 표기"))).toHaveLength(1);
    expect(r.issues.join()).toContain("2020-03-04: 작성자 표기(교사)");
  });
  it("교사 글을 가족이 쓴 것처럼 쓰면 지적", () => {
    const only = info({
      pack: "[2020-03-02][작성자: 교사][장소: 어린이집][글 종류: 알림장 본문] x",
    });
    const r = checkAnswer(
      goodAnswer({ fromRecords: [record("2020-03-02", "엄마가 집에서 지켜본 모습이에요")] }),
      only,
      false,
    );
    expect(r.issues.some((i) => i.includes("작성자 표기(부모)"))).toBe(true);
    expect(r.issues.some((i) => i.includes("장소 표기(집)"))).toBe(true);
  });
  it("장소가 모름이면 단정하지 않으므로 장소 불일치로 보지 않는다", () => {
    const r = checkAnswer(
      goodAnswer({ fromRecords: [record("2020-03-04", "집에서 새벽에 깼어요")] }),
      info(),
      false,
    );
    expect(r.issues.some((i) => i.includes("장소 표기"))).toBe(false);
  });
  it("표기가 없거나 모호하면 판단하지 않는다", () => {
    expect(statedAuthor("점심을 반만 먹었어요")).toBeNull();
    expect(statedAuthor("선생님과 엄마가 함께")).toBeNull();
    expect(statedPlace("어린이집에서 먹고 집에서도 먹어요")).toBeNull();
    expect(statedPlace("어린이집에서")).toBe("어린이집");
    expect(statedPlace("집에서")).toBe("집");
    expect(packMeta(BASE_PACK).get("2020-03-02")?.authors).toEqual(new Set(["교사", "부모"]));
  });
});

describe("호칭·축 꼬리표", () => {
  it("축 꼬리표는 자동으로 지워진다(재작성 불필요)", () => {
    const r = checkAnswer(
      goodAnswer({
        levelReason:
          "30개월(월령)이고 며칠째(지속) 반복돼요(빈도). 집(장소)에서도 (생활 지장) 없어요",
      }),
      info(),
      false,
    );
    expect(r.ok).toBe(true);
    expect(r.answer?.levelReason).toBe("30개월이고 며칠째 반복돼요. 집에서도 없어요");
    expect(stripAxisTags({ a: ["강도(강도)"] })).toEqual({ a: ["강도"] });
  });
  it("아버님·어머님·할머님·할아버님은 지적, 적힌 역할 그대로는 통과", () => {
    for (const bad of ["아버님께", "어머님께", "할머님께", "할아버님께"]) {
      const r = checkAnswer(goodAnswer({ forAsker: `${bad}: 오늘은 같이 앉아요` }), info(), false);
      expect(r.issues.join(), bad).toContain("호칭");
    }
    expect(
      checkAnswer(goodAnswer({ forAsker: "아빠께: 오늘은 같이 앉아요" }), info(), false).ok,
    ).toBe(true);
  });
});

describe("8단계 이상 전문 기관 이름 · 말 더듬", () => {
  it("8단계 이상은 upIf 에 전문 기관 이름이 있어야 한다", () => {
    const generic = goodAnswer({ level: 8, upIf: ["어린이집 선생님께 말해요"] });
    expect(checkAnswer(generic, info(), false).issues.join()).toContain("전문 기관");
    const named = goodAnswer({ level: 8, upIf: ["소아과에서 상담받아요"] });
    expect(checkAnswer(named, info(), false).ok).toBe(true);
  });
  it("INT-FLUENCY 를 썼고 DB 가 언어재활사를 가리키면 이름으로 적어야 한다", () => {
    const pack = `${BASE_PACK}\n- [ref: INT-FLUENCY-01] 금기: 언어재활사 상담`;
    const used = goodAnswer({
      level: 5,
      evidence: [{ ref: "INT-FLUENCY-01", point: "기다려 줘요" }],
    });
    expect(checkAnswer(used, info({ pack }), false).issues.join()).toContain("언어재활사");
    const ok = goodAnswer({
      level: 5,
      evidence: [{ ref: "INT-FLUENCY-01", point: "기다려 줘요" }],
      upIf: ["3개월 넘게 이어지면 언어재활사와 상담해요"],
    });
    expect(checkAnswer(ok, info({ pack }), false).ok).toBe(true);
  });
});

describe("응급 처치", () => {
  const emerg = info({ refs: ["note:2020-03-02", "EMERG-KDCA-2025", "EMERG-KDCA-CHOKE"] });
  const red = (tryNow: { action: string; basis: string }[]) =>
    goodAnswer({
      level: 10,
      tryNow,
      evidence: [{ ref: "EMERG-KDCA-2025", point: "먼저 행동하고 119는 동시에" }],
      upIf: ["119에 바로 전화해요"],
    });
  it("처치를 「119 안내에 따라」로 미루면 지적", () => {
    const r = checkAnswer(
      red([
        { action: "119에 전화하고 119 안내에 따라 해요", basis: "EMERG-KDCA-2025" },
        { action: "곁에서 지켜봐요", basis: "EMERG-KDCA-CHOKE" },
      ]),
      emerg,
      true,
    );
    expect(r.issues.join()).toContain("미루지 말고");
  });
  it("지금 할 처치를 먼저 적고 119 는 동시에면 통과(EMERG basis)", () => {
    const r = checkAnswer(
      red([
        {
          action: "등을 5회 세게 두드리고 옆 사람에게 119 신고를 부탁해요",
          basis: "EMERG-KDCA-2025",
        },
        {
          action: "안 나오면 복부를 밀어내고 휴대폰 스피커로 119 안내를 들어요",
          basis: "EMERG-KDCA-CHOKE",
        },
      ]),
      emerg,
      true,
    );
    expect(r.ok).toBe(true);
  });
  it("응급 틀이 묶음에 있는데 basis 가 EMERG 가 아니면 지적", () => {
    const r = checkAnswer(
      red([
        { action: "등을 두드려요", basis: "일반 권고" },
        { action: "119에 전화해요", basis: "일반 권고" },
      ]),
      emerg,
      true,
    );
    expect(r.issues.join()).toContain("EMERG-");
  });
});

describe("kind: not_behavior", () => {
  const nb = (over: object = {}) => ({
    kind: "not_behavior",
    level: 1,
    levelTitle: "x",
    levelReason: "이곳은 아이의 행동·발달 걱정을 묻는 곳이에요",
    summary: "아이와 상관없는 질문이에요",
    fromRecords: [],
    evidence: [],
    tryNow: [],
    avoid: [],
    upIf: [],
    downIf: [],
    forAsker: "엄마께: 아이 걱정을 적어 주세요",
    ...over,
  });
  it("사전 분류가 아니오이면 behavior 답을 지적, not_behavior 는 통과", () => {
    const off = info({ isBehavior: false });
    expect(checkAnswer(goodAnswer(), off, false).issues.join()).toContain("행동 질문이 아니에요");
    expect(checkAnswer(nb(), off, false).ok).toBe(true);
  });
  it("사전 분류가 예인데 not_behavior 면 지적(위급 아님)", () => {
    expect(checkAnswer(nb(), info({ isBehavior: true }), false).issues.join()).toContain(
      "행동 질문으로 분류",
    );
  });
  it("분류를 모르면(확장 실패) 어느 쪽도 막지 않는다", () => {
    expect(checkAnswer(nb(), info(), false).ok).toBe(true);
    expect(checkAnswer(goodAnswer(), info(), false).ok).toBe(true);
  });
  it("not_behavior 는 기록·검진·날짜를 보여 주지 않는다", () => {
    const r = checkAnswer(nb({ summary: "2020-03-02 알림장에 있어요" }), info(), false);
    expect(r.issues.join()).toContain("기록·검진·날짜");
  });
  it("위급 질문은 not_behavior 로 답할 수 없다", () => {
    const r = checkAnswer(nb(), info(), true);
    expect(r.issues.join()).toContain("kind");
    expect(r.issues.join()).toContain("level 10");
  });
});

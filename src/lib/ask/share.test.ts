import { describe, expect, it } from "vitest";
import type { Answer } from "../../../shared/ask-schema";
import { buildShareText, shareTitle, shareUrl, SHARE_MAX } from "./share";

// 합성 답(테스트아이). 실제 자료 없음.
const answer: Answer = {
  kind: "behavior",
  level: 5,
  levelTitle: "방법 바꾸며 1주 기록",
  levelReason: "30개월이고 며칠째 반복되지만 다른 활동에는 지장이 없어요.",
  summary: "테스트아이가 점심을 반만 먹는 일이 며칠째 이어져요.",
  fromRecords: [
    {
      date: "2020-03-02",
      what: "점심을 반만 먹었어요",
      link: "밥 먹는 양과 이어져요",
      source: "알림장",
    },
  ],
  evidence: [{ ref: "SYN-IV-01", point: "식사 시간을 일정하게 하면 도움이 돼요", grade: "B" }],
  tryNow: [
    { action: "식사 시간을 정해 두어요", say: "밥 먹고 놀자", basis: "SYN-IV-01" },
    { action: "간식 간격을 넉넉히 두어요", basis: "일반 권고" },
  ],
  avoid: ["억지로 먹이지 않아요", "식탁에서 영상 보여 주기"],
  observe: { what: "먹은 양", howLong: "1주", how: "끼니마다 적어요" },
  upIf: ["체중이 줄면 소아과에 물어봐요", "하루 5번 이상으로 늘어요"],
  downIf: ["이틀 이상 잘 먹어요"],
  forAsker: "엄마께: 오늘 저녁은 천천히 함께 앉아 먹어요",
  limits: "알림장만으로는 집 식사를 알 수 없어요",
};

const base = {
  id: 12,
  body: "점심에 밥을 자꾸 남겨요",
  askedBy: "아빠",
  createdAt: "2020-03-05T12:00:00.000Z",
  answer,
  level: 5,
  origin: "https://app.example.test/",
};

describe("shareUrl · shareTitle", () => {
  it("끝 슬래시를 떼고 /ask/<id>", () => {
    expect(shareUrl("https://app.example.test/", 12)).toBe("https://app.example.test/ask/12");
    expect(shareUrl("https://app.example.test", 3)).toBe("https://app.example.test/ask/3");
  });
  it("제목은 한국 날짜", () => {
    expect(shareTitle({ createdAt: "2020-03-05T20:00:00.000Z" })).toBe("물어보기 2020-03-06");
  });
});

describe("buildShareText 요약형", () => {
  const t = buildShareText(base);
  it("머리: 날짜(한국 시간)·질문자, 구분선, 질문, 단계", () => {
    const lines = t.split("\n");
    expect(lines[0]).toBe("📝 아이 물어보기 (2020-03-05 · 질문: 아빠)");
    expect(lines[1]).toBe("━━━━━━━━━━");
    expect(lines.slice(2, 5)).toEqual(["💬 질문", "점심에 밥을 자꾸 남겨요", "━━━━━━━━━━"]);
    expect(t).toContain("📊 단계 5 · 방법 바꾸며 1주 기록\n30개월이고");
  });
  it("해 볼 것은 번호·할 말(👉 「…」), 피할 것은 - 줄, 지켜볼 것, 상담", () => {
    expect(t).toContain(
      "✅ 지금 해 볼 것\n1. 식사 시간을 정해 두어요\n   👉 「밥 먹고 놀자」\n2. 간식 간격을 넉넉히 두어요",
    );
    expect(t).toContain("❌ 피할 것\n- 억지로 먹이지 않아요\n- 식탁에서 영상 보여 주기");
    expect(t).toContain("👀 지켜볼 것: 먹은 양 (1주)");
    // 연락처가 있는 것만
    expect(t).toContain("⬆️ 이럴 땐 상담: 체중이 줄면 소아과에 물어봐요");
    expect(t).not.toContain("하루 5번 이상으로 늘어요");
  });
  it("끝: 앱 링크와 PIN 안내, 요약형에는 기록·근거·한계 없음", () => {
    const lines = t.split("\n");
    expect(lines.at(-1)).toBe("앱에서 보기: https://app.example.test/ask/12 (가족 PIN 필요)");
    expect(lines.at(-2)).toBe("━━━━━━━━━━");
    for (const x of ["기록에서 본 것", "근거", "한계", "상황 요약", "질문하신 분께"]) {
      expect(t).not.toContain(x);
    }
  });
  it("줄바꿈은 \\n 만, 이모지가 있고 길이 상한 이하", () => {
    expect(t).not.toContain("\r");
    expect(t).toMatch(/📝|✅|❌/u);
    expect(t.length).toBeLessThanOrEqual(SHARE_MAX);
  });
});

describe("buildShareText 전체", () => {
  const t = buildShareText({ ...base, mode: "full" });
  it("상황 요약·기록·근거·질문하신 분께·한계가 더해진다", () => {
    expect(t).toContain("📌 상황 요약\n테스트아이가 점심을");
    expect(t).toContain(
      "📖 기록에서 본 것\n- 2020-03-02 점심을 반만 먹었어요 (밥 먹는 양과 이어져요)",
    );
    expect(t).toContain("🔎 근거\n- 식사 시간을 일정하게 하면 도움이 돼요");
    expect(t).toContain("🙋 질문하신 분께\n엄마께:");
    expect(t).toContain("ℹ️ 한계\n알림장만으로는");
    expect(t.length).toBeLessThanOrEqual(SHARE_MAX);
  });
  it("기록·한계가 없으면 그 구역은 없다", () => {
    const noLimits = structuredClone(answer);
    delete noLimits.limits;
    const x = buildShareText({ ...base, mode: "full", answer: { ...noLimits, fromRecords: [] } });
    expect(x).not.toContain("기록에서 본 것");
    expect(x).not.toContain("한계");
  });
});

describe("옵션 칸·특수 경우", () => {
  it("say 가 없고 observe·연락처가 없으면 그 줄이 없다", () => {
    const x = buildShareText({
      ...base,
      answer: { ...answer, observe: undefined, upIf: ["하루 5번 이상으로 늘어요"] },
    });
    expect(x).not.toContain("👀");
    expect(x).not.toContain("⬆️");
    expect(x).not.toContain("👉 「간식");
  });

  it("not_behavior: 질문·요약·안내만(단계·해 볼 것 없음)", () => {
    const nb: Answer = {
      kind: "not_behavior",
      level: 1,
      levelTitle: "",
      levelReason: "아이 행동 걱정을 묻는 곳이에요",
      summary: "행동 질문이 아니에요",
      fromRecords: [],
      evidence: [],
      tryNow: [],
      avoid: [],
      upIf: [],
      downIf: [],
      forAsker: "엄마께: 행동을 물어봐 주세요",
    };
    const x = buildShareText({ ...base, answer: nb, level: null, mode: "full" });
    expect(x).toContain("💬 질문\n점심에 밥을 자꾸 남겨요");
    expect(x).toContain("행동 질문이 아니에요\n아이 행동 걱정을 묻는 곳이에요");
    for (const s of ["📊", "✅", "❌", "👀", "⬆️", "🔎"]) expect(x).not.toContain(s);
    expect(x).toContain("앱에서 보기:");
  });

  it("redFlag: 맨 위에 「🚨 위급: 지금 바로 …」 줄", () => {
    const red = buildShareText({
      ...base,
      redFlag: true,
      level: 10,
      answer: {
        ...answer,
        level: 10,
        tryNow: [{ action: "119에 바로 전화해요", basis: "일반 권고" }],
      },
    });
    expect(red.split("\n")[0]).toBe("🚨 위급: 지금 바로 119에 바로 전화해요");
    expect(red.split("\n")[2]).toBe("📝 아이 물어보기 (2020-03-05 · 질문: 아빠)");
    expect(buildShareText(base)).not.toContain("🚨");
  });

  it("길이 상한 3,000자: 긴 답도 넘지 않고 링크 줄은 남는다", () => {
    const long: Answer = {
      ...answer,
      levelReason: "가".repeat(220),
      tryNow: Array.from({ length: 3 }, () => ({
        action: "나".repeat(160),
        say: "다".repeat(80),
        basis: "일반 권고",
      })),
      avoid: ["라".repeat(100), "라".repeat(100), "라".repeat(100)],
      evidence: Array.from({ length: 3 }, () => ({ ref: "SYN-IV-01", point: "마".repeat(200) })),
      fromRecords: Array.from({ length: 4 }, () => ({
        date: "2020-03-02",
        what: "바".repeat(140),
        link: "사".repeat(80),
        source: "알림장" as const,
      })),
      limits: "아".repeat(160),
    };
    for (const mode of ["summary", "full"] as const) {
      const x = buildShareText({ ...base, body: "질".repeat(1000), answer: long, mode });
      expect(x.length, mode).toBeLessThanOrEqual(SHARE_MAX);
      expect(x.split("\n").at(-1)).toBe(
        "앱에서 보기: https://app.example.test/ask/12 (가족 PIN 필요)",
      );
      expect(x).toContain("✅ 지금 해 볼 것");
    }
  });
});

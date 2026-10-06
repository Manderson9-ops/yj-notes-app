import { describe, expect, it } from "vitest";
import { hasForbiddenWord } from "../../shared/ask-forbidden.ts";
import { checkAnswer } from "./checks.ts";
import { goodAnswer, PACK } from "./fixtures.ts";
import { levelTitle } from "./levels.ts";

describe("공용 금지어(shared/ask-forbidden)", () => {
  it("판정 어휘를 잡는다", () => {
    for (const w of ["정상 범위예요", "비정상", "이상해요", "발달 지연", "자폐 같아요", "문제아"]) {
      expect(hasForbiddenWord(w), w).toBe(true);
    }
  });
  it("기간·횟수 뒤의 이상은 허용한다", () => {
    for (const w of ["2주 이상 이어지면", "38도 이상이면"])
      expect(hasForbiddenWord(w), w).toBe(false);
  });
});

describe("checkAnswer", () => {
  it("정상 답은 통과하고 levelTitle 을 정규 문구로 고정한다", () => {
    const r = checkAnswer(goodAnswer({ levelTitle: "내 맘대로" }), PACK, false);
    expect(r.ok).toBe(true);
    expect(r.answer?.levelTitle).toBe(levelTitle(4));
  });
  it("스키마 위반(추가 키, 길이, 필수 basis·link)", () => {
    expect(checkAnswer({ ...goodAnswer(), extra: 1 }, PACK, false).ok).toBe(false);
    expect(checkAnswer(goodAnswer({ summary: "가".repeat(121) }), PACK, false).ok).toBe(false);
    expect(checkAnswer(goodAnswer({ level: 11 }), PACK, false).ok).toBe(false);
    const noBasis = goodAnswer();
    expect(
      checkAnswer({ ...noBasis, tryNow: [{ action: "가" }, { action: "나" }] }, PACK, false).ok,
    ).toBe(false);
    const noLink = goodAnswer();
    expect(
      checkAnswer(
        { ...noLink, fromRecords: [{ date: "2020-03-02", what: "x", source: "알림장" }] },
        PACK,
        false,
      ).ok,
    ).toBe(false);
    expect(checkAnswer("x", PACK, false).answer).toBeNull();
  });
  it("redFlag 면 level 10 이어야 한다", () => {
    const bad = checkAnswer(goodAnswer({ level: 5 }), PACK, true);
    expect(bad.ok).toBe(false);
    expect(bad.issues.join()).toContain("level 10");
    expect(checkAnswer(goodAnswer({ level: 10 }), PACK, true).ok).toBe(true);
  });
  it("금지어를 어느 필드에서든 잡는다", () => {
    const r = checkAnswer(goodAnswer({ limits: "정상 범위로 보여요" }), PACK, false);
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toContain("금지어");
  });
  it("묶음에 없는 evidence.ref·날짜·basis 를 잡는다", () => {
    const base = goodAnswer();
    const r = checkAnswer(
      goodAnswer({
        evidence: [{ ref: "FAKE-1", point: "가짜" }],
        fromRecords: [{ date: "2020-12-31", what: "없는 기록", link: "x", source: "알림장" }],
        tryNow: [
          { action: "가", basis: "FAKE-2" },
          { action: "나", basis: base.tryNow[1]?.basis ?? "일반 권고" },
        ],
      }),
      PACK,
      false,
    );
    expect(r.issues.some((i) => i.includes("evidence.ref"))).toBe(true);
    expect(r.issues.some((i) => i.includes("날짜"))).toBe(true);
    expect(r.issues.some((i) => i.includes("tryNow.basis"))).toBe(true);
  });
  it("basis 는 묶음 ref 이거나 정확히 「일반 권고」", () => {
    const ok = goodAnswer({
      tryNow: [
        { action: "가", basis: "note:2020-03-02" },
        { action: "나", basis: "일반 권고" },
      ],
    });
    expect(checkAnswer(ok, PACK, false).ok).toBe(true);
    const near = goodAnswer({
      tryNow: [
        { action: "가", basis: "일반권고" },
        { action: "나", basis: "일반 권고" },
      ],
    });
    expect(checkAnswer(near, PACK, false).ok).toBe(false);
  });
  it("fromRecords 는 비어도 된다", () => {
    expect(checkAnswer(goodAnswer({ fromRecords: [] }), PACK, false).ok).toBe(true);
  });
});

describe("단계별 틀 검사(코드가 정확한 문장으로 알린다)", () => {
  it("4단계: tryNow 2개·3~4일·연락처", () => {
    expect(checkAnswer(goodAnswer({ level: 4 }), PACK, false).ok).toBe(true);
    const oneTry = goodAnswer({ level: 4, tryNow: [{ action: "가", basis: "일반 권고" }] });
    expect(checkAnswer(oneTry, PACK, false).issues).toContain(
      "단계 4 은 tryNow 가 2~2개여야 해요(지금 1개)",
    );
    const weekly = goodAnswer({
      level: 4,
      observe: { what: "양", howLong: "1주", how: "적어요" },
    });
    expect(checkAnswer(weekly, PACK, false).issues).toContain(
      "단계 4 의 observe.howLong 은 「3~4일」 이어야 해요",
    );
    const nobody = goodAnswer({ level: 4, upIf: ["체중이 줄어요"] });
    expect(checkAnswer(nobody, PACK, false).issues.join()).toContain("연락할 곳");
  });
  it("초과한 tryNow 는 틀의 최대 개수로 줄여 통과시킨다(재작성 한 번을 아낀다)", () => {
    const three = goodAnswer({
      level: 4,
      tryNow: [
        { action: "가", basis: "일반 권고" },
        { action: "나", basis: "일반 권고" },
        { action: "다", basis: "일반 권고" },
      ],
    });
    const r = checkAnswer(three, PACK, false);
    expect(r.ok).toBe(true);
    expect(r.answer?.tryNow).toHaveLength(2);
  });
  it("1~3단계는 연락처가 없어도 되지만 관찰 기간은 「며칠」", () => {
    const l1 = goodAnswer({ level: 1, upIf: ["늘어요"] });
    expect(checkAnswer(l1, PACK, false).ok).toBe(true);
    const bad = goodAnswer({ level: 2, observe: { what: "a", howLong: "2주", how: "b" } });
    expect(checkAnswer(bad, PACK, false).ok).toBe(false);
  });
  it("5단계 1주, 6~7단계 2주, 8~9단계 진료·상담 전까지, 10단계 지금", () => {
    for (const [level, howLong] of [
      [5, "1주"],
      [6, "2주"],
      [7, "2주"],
      [8, "진료·상담 전까지"],
      [9, "진료·상담 전까지"],
      [10, "지금"],
    ] as const) {
      expect(checkAnswer(goodAnswer({ level }), PACK, false).ok, String(level)).toBe(true);
      const wrong = goodAnswer({ level, observe: { what: "a", howLong: "3~4일", how: "b" } });
      expect(
        checkAnswer(wrong, PACK, false).issues.some((i) => i.includes(howLong)),
        String(level),
      ).toBe(true);
    }
  });
});

describe("가족 결과·다시 답변 검사(T-Q3)", () => {
  const famPack = { ...PACK, refs: [...PACK.refs, "FAMILY-Q12"] };
  const family = { refs: ["FAMILY-Q12"], failed: [{ id: 12, action: "식사 시간을 정해 두어요" }] };
  const base = goodAnswer(); // 해 볼 것 1: 「식사 시간을 정해 두어요」

  it("FAMILY-Q ref 는 묶음에 실려 있어야 한다(HARD): 있으면 통과, 없으면 막는다", () => {
    const ok = goodAnswer({
      tryNow: [
        { action: "간식 간격을 넉넉히 두어요", basis: "FAMILY-Q12" },
        { action: "식탁에서 영상은 끄고 함께 앉아요", basis: "일반 권고" },
      ],
    });
    expect(checkAnswer(ok, famPack, false).hard).toEqual([]);
    const missing = checkAnswer(ok, PACK, false); // 묶음에 FAMILY-Q12 가 없다
    expect(missing.hard.map((i) => i.text).join()).toContain(
      "FAMILY-Q ref 가 이번 가족 결과에 없어요",
    );
    const evi = goodAnswer({ evidence: [{ ref: "FAMILY-Q99", point: "합성" }] });
    expect(checkAnswer(evi, famPack, false).hard.some((i) => i.category === "factual")).toBe(true);
  });

  it("위급 질문에서도 없는 FAMILY-Q ref 는 막는다", () => {
    const a = goodAnswer({
      level: 10,
      tryNow: [{ action: "119에 바로 연락해요", basis: "FAMILY-Q5" }],
    });
    expect(
      checkAnswer(a, PACK, true)
        .hard.map((i) => i.text)
        .join(),
    ).toContain("FAMILY-Q ref");
  });

  it("가족에게 보이는 글에 FAMILY- 표지를 쓰면 막는다(HARD leak)", () => {
    const a = goodAnswer({ summary: "FAMILY-Q12 에서 해 보셨어요." });
    expect(checkAnswer(a, famPack, false).hard.some((i) => i.category === "leak")).toBe(true);
  });

  it("실패했다는 방법을 바꾼 점 없이 그대로 다시 권하면 SOFT ungrounded", () => {
    const r = checkAnswer(base, { ...famPack, family }, false);
    expect(r.hard).toEqual([]);
    expect(r.soft.some((i) => i.category === "ungrounded" && i.text.includes("잘 안 됐다고"))).toBe(
      true,
    );
  });

  it("바꾼 점을 밝히면(이번엔 …) 통과, 다른 방법이면 통과", () => {
    const changed = goodAnswer({
      tryNow: [
        { action: "이번엔 식사 시간을 정해 두되 간식을 줄여요", basis: "SYN-IV-01" },
        { action: "간식 간격을 넉넉히 두어요", basis: "일반 권고" },
      ],
    });
    expect(
      checkAnswer(changed, { ...famPack, family }, false).soft.map((i) => i.category),
    ).not.toContain("ungrounded");
    const other = goodAnswer({
      tryNow: [
        { action: "식탁에 앉는 순서를 아이가 고르게 해요", basis: "일반 권고" },
        { action: "간식 간격을 넉넉히 두어요", basis: "일반 권고" },
      ],
    });
    expect(
      checkAnswer(other, { ...famPack, family }, false).soft.map((i) => i.category),
    ).not.toContain("ungrounded");
  });

  it("다시 답변 「이미 해 봤어요」: 이전 해 볼 것과 같은 방법이면 SOFT template, 다른 방법이면 통과", () => {
    const reask = {
      choice: "이미 해 봤어요" as const,
      previousActions: ["식사 시간을 정해 두어요"],
    };
    const same = checkAnswer(base, { ...PACK, reask }, false);
    expect(
      same.soft.some((i) => i.category === "template" && i.text.includes("이미 해 봤어요")),
    ).toBe(true);
    const diff = goodAnswer({
      tryNow: [
        { action: "식탁에 앉는 순서를 아이가 고르게 해요", basis: "일반 권고" },
        { action: "간식 간격을 넉넉히 두어요", basis: "일반 권고" },
      ],
    });
    expect(
      checkAnswer(
        diff,
        { ...PACK, reask: { ...reask, previousActions: ["식사 시간을 정해 두어요"] } },
        false,
      ).soft.some((i) => i.text.includes("이미 해 봤어요")),
    ).toBe(false);
    // 다른 이유 선택지에서는 이 검사를 하지 않는다
    expect(
      checkAnswer(
        base,
        { ...PACK, reask: { ...reask, choice: "더 자세히 알고 싶어요" } },
        false,
      ).soft.some((i) => i.text.includes("이미 해 봤어요")),
    ).toBe(false);
  });
});

describe("다시 답변 단계 안정(T-Q3 2차)", () => {
  const rk = (freeText: string, previousLevel = 4) => ({
    choice: "너무 일반적이에요" as const,
    previousActions: [],
    previousLevel,
    freeText,
  });
  it("이전 단계와 같으면 통과", () => {
    const r = checkAnswer(goodAnswer({ level: 4 }), { ...PACK, reask: rk("") }, false);
    expect(r.soft.some((i) => i.text.includes("단계가 이전"))).toBe(false);
  });
  it("단계가 달라지고 새 심각도 말이 없으면 SOFT template", () => {
    const r = checkAnswer(
      goodAnswer({ level: 5 }),
      { ...PACK, reask: rk("더 알고 싶어요") },
      false,
    );
    expect(r.hard).toEqual([]);
    expect(
      r.soft.some((i) => i.category === "template" && i.text.includes("단계가 이전(4단계)")),
    ).toBe(true);
  });
  it("가족이 새 빈도·지속·영향·공격성을 적었으면 단계를 바꿔도 된다", () => {
    for (const t of ["요즘은 매일 그래요", "벌써 3주째예요", "밥을 못 먹어요", "친구를 때려요"]) {
      const r = checkAnswer(goodAnswer({ level: 5 }), { ...PACK, reask: rk(t) }, false);
      expect(
        r.soft.some((i) => i.text.includes("단계가 이전")),
        t,
      ).toBe(false);
    }
  });
  it("이전 답이 없으면(previousLevel 없음) 검사하지 않는다", () => {
    const r = checkAnswer(
      goodAnswer({ level: 5 }),
      { ...PACK, reask: { choice: null, previousActions: [], freeText: "" } },
      false,
    );
    expect(r.soft.some((i) => i.text.includes("단계가 이전"))).toBe(false);
  });
});

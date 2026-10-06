// 전수 검색·작성자 표기·호칭·축 꼬리표·응급·전문 기관·kind 규칙의 결정적 검사.
import { describe, expect, it } from "vitest";
import {
  checkAnswer,
  claimSubject,
  packMeta,
  statedAuthor,
  statedPlace,
  softToReviewIssues,
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

describe("「기록이 없어요」 오류 주장 대조(변별력 있는 낱말만)", () => {
  const stats = (
    over: Partial<NonNullable<PackInfo["search"]>> = {},
  ): NonNullable<PackInfo["search"]> => ({
    total: 428,
    shown: 25,
    dates: ["2020-03-04", "2020-03-02"],
    keywords: { 밥: 400, 손톱: 3 },
    ints: [],
    days: 100,
    keywordDays: { 밥: 90, 손톱: 3 }, // 밥은 흔한 낱말(90%), 손톱은 변별력 있는 낱말(3%)
    keywordDates: {
      밥: ["2020-03-04"],
      손톱: ["2020-03-04", "2020-03-02", "2020-02-20", "2020-02-11", "2020-01-30"],
    },
    multi: [],
    ...over,
  });
  const withStats = (over: Partial<NonNullable<PackInfo["search"]>> = {}) =>
    info({ search: stats(over) });

  it("흔한 낱말(밥 90%)의 건수로는 「기록이 없어요」를 반박하지 않는다(오탐 방지)", () => {
    const r = checkAnswer(goodAnswer({ limits: "밥 관련 기록이 없어요" }), withStats(), false);
    expect(r.items.some((i) => i.category === "ungrounded")).toBe(false);
  });
  it("변별력 있는 낱말(날짜 빈도 5% 미만)이 주장 대상과 겹치면 낱말 + 날짜 최대 4개를 알린다", () => {
    const r = checkAnswer(goodAnswer({ limits: "손톱 뜯기 기록이 없어요" }), withStats(), false);
    const issue = r.issues.find((i) => i.startsWith("[ungrounded]"));
    expect(issue).toContain("「손톱」");
    expect(issue).toContain("2020-03-04, 2020-03-02, 2020-02-20, 2020-02-11");
    expect(issue).not.toContain("2020-01-30"); // 4개까지만
    expect(issue).not.toMatch(/\d+건/); // 건수는 쓰지 않는다
    expect(r.soft.some((i) => i.category === "ungrounded")).toBe(true);
    expect(r.hard).toHaveLength(0); // SOFT: 막지 않는다
  });
  it("주장 대상과 겹치지 않는 낱말은 세지 않는다", () => {
    const r = checkAnswer(goodAnswer({ limits: "체중 변화 기록이 없어요" }), withStats(), false);
    expect(r.items.some((i) => i.category === "ungrounded")).toBe(false);
  });
  it("서로 다른 낱말 2개 이상이 한 글에 함께 걸리고 둘 다 주장 대상과 겹치면 반박한다", () => {
    const s = stats({
      keywordDays: { 밥: 90, 손톱: 30, 피부: 30 },
      multi: [{ date: "2020-02-01", keywords: ["손톱", "피부"] }],
    });
    const r = checkAnswer(
      goodAnswer({ limits: "손톱과 피부 관련 기록이 없어요" }),
      info({ search: s }),
      false,
    );
    expect(r.issues.join()).toContain("「손톱·피부」 기록이 있어요: 2020-02-01");
    const one = checkAnswer(
      goodAnswer({ limits: "피부 관련 기록이 없어요" }),
      info({ search: s }),
      false,
    );
    expect(one.items.some((i) => i.category === "ungrounded")).toBe(false); // 겹치는 낱말이 하나뿐
  });
  it("전수 검색 통계가 없으면(구버전 묶음) 낱말 대조는 건너뛴다", () => {
    const old = info({
      search: { total: 7, shown: 3, dates: ["2020-03-04"], keywords: { 밥: 7 }, ints: [] },
    });
    expect(checkAnswer(goodAnswer({ limits: "밥 관련 기록이 없어요" }), old, false).ok).toBe(true);
  });
  it("실천 프로토콜(INT-*)이 있는데 「근거가 없어요」라고 하면 알린다", () => {
    const r = checkAnswer(
      goodAnswer({ limits: "이 행동에 대한 근거가 없어요" }),
      withStats({ ints: ["INT-FEED-01"] }),
      false,
    );
    expect(r.issues).toContain("[ungrounded] 근거 묶음에 실천 프로토콜이 있어요: INT-FEED-01");
  });
  it("주장 대상 추출(앞 1~3 낱말)", () => {
    expect(claimSubject("손톱 뜯기에 대한 기록이 없어요")).toBe("손톱 뜯기");
    expect(claimSubject("피부 뜯는 모습 기록이 없어요")).toContain("뜯는 모습");
    expect(claimSubject("그냥 말이에요")).toBe("그냥 말이에요"); // 못 찾으면 문장 전체
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
    levelTitle: "",
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

describe("가족에게 보이는 글: 내부 규칙·검색 건수·말씨", () => {
  it("내부 규칙 표현과 검색 건수를 지적한다", () => {
    for (const bad of [
      "더 보수적인 쪽을 따랐어요",
      "더 일찍 확인을 권하는 쪽이에요",
      "월령 규준 경계라서요",
      "알림장에서 484건이 보였어요",
      "전수 검색 결과예요",
    ]) {
      const r = checkAnswer(goodAnswer({ limits: bad }), info(), false);
      expect(r.issues.join(), bad).toContain("내부 규칙");
    }
    expect(checkAnswer(goodAnswer({ limits: "집 상황은 알 수 없어요" }), info(), false).ok).toBe(
      true,
    );
  });
  it("질환·병은 위급이 아닐 때 summary·levelReason 에서 지적, 병원은 허용", () => {
    expect(
      checkAnswer(
        goodAnswer({ summary: "질환이 있는지 걱정하셨어요" }),
        info(),
        false,
      ).issues.join(),
    ).toContain("질환·병");
    expect(
      checkAnswer(goodAnswer({ levelReason: "큰 병일까 걱정돼요" }), info(), false).issues.join(),
    ).toContain("질환·병");
    expect(
      checkAnswer(goodAnswer({ summary: "병원에 가야 할지 물으셨어요" }), info(), false).ok,
    ).toBe(true);
    const red = goodAnswer({
      level: 10,
      summary: "병이 났을 수 있어 바로 119에 전화하세요",
      upIf: ["119"],
    });
    expect(checkAnswer(red, info(), true).issues.join()).not.toContain("질환·병");
  });
  it("summary 는 질문자를 3인칭으로 부르지 않는다(2인칭)", () => {
    const withAsker = info({ askedBy: "엄마" });
    expect(
      checkAnswer(
        goodAnswer({ summary: "엄마는 점심이 걱정이세요" }),
        withAsker,
        false,
      ).issues.join(),
    ).toContain("2인칭");
    expect(
      checkAnswer(
        goodAnswer({ summary: "엄마가 점심을 걱정하세요" }),
        withAsker,
        false,
      ).issues.join(),
    ).toContain("2인칭");
    expect(
      checkAnswer(goodAnswer({ summary: "점심을 반만 먹어서 걱정하셨어요" }), withAsker, false).ok,
    ).toBe(true);
    expect(checkAnswer(goodAnswer({ summary: "시엄마는 걱정하셨어요" }), withAsker, false).ok).toBe(
      true,
    ); // 부분 일치는 아님
    expect(checkAnswer(goodAnswer({ summary: "아빠가 밥을 먹여요" }), withAsker, false).ok).toBe(
      true,
    ); // 다른 사람
  });
});

describe("단계 보정(질문에 빈도·지속·영향이 있어야 4단계 이상)", () => {
  const none = { frequency: null, duration: null, impact: null, aggression: null };
  const two = { dates: ["2020-03-04", "2020-03-02"] };
  const withSearch = (severity: typeof none, dates: string[] = []) =>
    info({
      severity,
      search: { total: dates.length, shown: dates.length, dates, keywords: {}, ints: [] },
    });
  it("모두 null 이면 4단계 이상을 지적한다(기록 반복이 없을 때)", () => {
    const r = checkAnswer(goodAnswer({ level: 4 }), withSearch(none), false);
    expect(r.issues.join()).toContain("3 이하");
    expect(checkAnswer(goodAnswer({ level: 3 }), withSearch(none), false).ok).toBe(true);
    expect(checkAnswer(goodAnswer({ level: 5 }), withSearch(none), false).issues.join()).toContain(
      "3 이하",
    );
  });
  it("기록이 반복을 보이면 4단계는 허용(levelReason 에 기록 반복을 적을 때만), 5단계 이상은 불가", () => {
    const rep = withSearch(none, two.dates);
    const noMention = goodAnswer({ level: 4, levelReason: "30개월이고 잘 지내요" });
    expect(checkAnswer(noMention, rep, false).issues.join()).toContain("기록이 반복");
    const mention = goodAnswer({ level: 4, levelReason: "30개월이고 기록에서 반복돼요" });
    expect(checkAnswer(mention, rep, false).ok).toBe(true);
    expect(checkAnswer(goodAnswer({ level: 5 }), rep, false).issues.join()).toContain("3 이하");
  });
  it("질문에 빈도·지속·영향·공격성 중 하나라도 있으면 4단계 이상 허용", () => {
    for (const k of ["frequency", "duration", "impact", "aggression"] as const) {
      const sev = { ...none, [k]: "있음" };
      expect(checkAnswer(goodAnswer({ level: 5 }), withSearch(sev), false).ok, k).toBe(true);
    }
  });
  it("위급 질문과 확장 실패(severity 없음)에는 적용하지 않는다", () => {
    expect(checkAnswer(goodAnswer({ level: 10, upIf: ["119"] }), withSearch(none), true).ok).toBe(
      true,
    );
    expect(checkAnswer(goodAnswer({ level: 6 }), info(), false).ok).toBe(true);
  });
});

describe("근거–행동 주제 대조(basis)", () => {
  const withDomains = (domains: string[]) =>
    info({
      domains,
      refs: [
        "note:2020-03-02",
        "SYN-IV-01",
        "INT-FEED-01",
        "INT-FEAR-01",
        "NORM-MEDIA-01",
        "guide:05-식사#§3",
        "guide:04-퇴행#1",
      ],
    });
  const act = (action: string, basis: string) =>
    goodAnswer({
      tryNow: [
        { action, basis },
        { action: "둘째 행동이에요", basis: "일반 권고" },
      ],
    });
  it("질문 주제와 같은 주제 ref 는 통과", () => {
    expect(
      checkAnswer(act("정해진 자리에서 먹어요", "INT-FEED-01"), withDomains(["feeding"]), false).ok,
    ).toBe(true);
    expect(
      checkAnswer(act("가족 계획대로 해요", "guide:05-식사#§3"), withDomains(["feeding"]), false)
        .ok,
    ).toBe(true);
  });
  it("다른 주제 ref 를 끌어오면 over_interpretation 으로 지적", () => {
    const r = checkAnswer(act("밤에 안아 줘요", "INT-FEAR-01"), withDomains(["feeding"]), false);
    expect(
      r.issues.some((i) => i.startsWith("[over_interpretation] tryNow.basis INT-FEAR-01")),
    ).toBe(true);
    const media = checkAnswer(
      act("정해진 시간만 봐요", "NORM-MEDIA-01"),
      withDomains(["feeding"]),
      false,
    );
    expect(media.issues.join()).toContain("media 주제");
  });
  it("행동 글이 그 주제 낱말을 직접 담으면 통과", () => {
    const r = checkAnswer(
      act("영상은 식사 전에 꺼요", "NORM-MEDIA-01"),
      withDomains(["feeding"]),
      false,
    );
    expect(r.issues.some((i) => i.startsWith("[over_interpretation]"))).toBe(false);
  });
  it("주제를 모르는 ref(note·SYN)와 「일반 권고」, 확장 실패는 검사하지 않는다", () => {
    expect(checkAnswer(act("무엇이든", "SYN-IV-01"), withDomains(["feeding"]), false).ok).toBe(
      true,
    );
    expect(
      checkAnswer(
        act("밤에 안아 줘요", "INT-FEAR-01"),
        info({ refs: ["INT-FEAR-01", "SYN-IV-01", "note:2020-03-02", "note:2020-03-04"] }),
        false,
      ).ok,
    ).toBe(true);
  });
});

describe("관련 없는 기록 · 식사 가이드 기록", () => {
  it("link·what 에 「관련 없다」류가 있으면 항목을 빼라고 알린다", () => {
    for (const link of ["직접 관련은 없지만 참고해요", "관련 없어요", "관련이 적어요"]) {
      const r = checkAnswer(
        goodAnswer({ fromRecords: [{ date: "2020-03-02", what: "점심", link, source: "알림장" }] }),
        info(),
        false,
      );
      expect(r.issues.join(), link).toContain("관련 없는 기록은 빼요");
    }
  });
  it("가이드 §3-1 이 묶음에 있는 식사 질문은 기존 식사기록을 언급해야 한다", () => {
    const refs = ["note:2020-03-02", "SYN-IV-01", "guide:05-식사#§3-1"];
    const base = info({ domains: ["feeding"], refs });
    expect(checkAnswer(goodAnswer(), base, false).issues.join()).toContain("식사 기록표");
    const ok = goodAnswer({
      observe: {
        what: "먹은 양",
        howLong: "3~4일",
        how: "지금 쓰고 계신 2주 저녁 식사 기록표에 이어서 적어요",
      },
    });
    expect(checkAnswer(ok, base, false).ok).toBe(true);
    expect(checkAnswer(goodAnswer(), info({ domains: ["sleep"], refs }), false).ok).toBe(true);
  });
});

describe("not_behavior: levelTitle 빈 문자열", () => {
  it("levelTitle 이 비어 있어야 하고 정규화돼도 비어 있다", () => {
    const nb = {
      kind: "not_behavior",
      level: 1,
      levelTitle: "",
      levelReason: "이곳은 아이의 행동·발달 걱정을 묻는 곳이에요",
      summary: "아이와 상관없는 질문이에요",
      fromRecords: [],
      evidence: [],
      tryNow: [],
      avoid: [],
      upIf: [],
      downIf: [],
      forAsker: "엄마께: 아이 걱정을 적어 주세요",
    };
    const r = checkAnswer(nb, info(), false);
    expect(r.ok).toBe(true);
    expect(r.answer?.levelTitle).toBe("");
    expect(
      checkAnswer({ ...nb, levelTitle: "아주 흔한 발달 과정" }, info(), false).answer,
    ).toBeNull(); // 스키마 위반
  });
});

describe("위급 질문: 안전·응급 규칙만(주제·말씨·식사·단계 규칙은 적용하지 않는다)", () => {
  // 사탕을 먹다가 숨을 못 쉬고 파래진 질문: 주제가 「식사」로 읽혀도 식사기록·주제 규칙이 걸리면 안 된다
  const chokePack =
    "[ref: note:2020-03-02] [2020-03-02][작성자: 교사][장소: 어린이집][글 종류: 알림장 본문] 점심\n" +
    "[ref: EMERG-KDCA-CHOKE] [ref: EMERG-KDCA-2025] 등 두드리기";
  const chokeInfo = info({
    pack: chokePack,
    refs: [
      "note:2020-03-02",
      "EMERG-KDCA-CHOKE",
      "EMERG-KDCA-2025",
      "INT-FEAR-01",
      "guide:05-식사#§3-1",
    ],
    domains: ["feeding"],
    severity: { frequency: null, duration: null, impact: null, aggression: null },
    askedBy: "엄마",
    isBehavior: true,
    suggested: { level: 2, why: "x" },
    search: {
      total: 5,
      shown: 3,
      dates: ["2020-03-02"],
      keywords: { 먹다가: 5 },
      ints: [],
      days: 100,
      keywordDays: { 먹다가: 2 },
      keywordDates: { 먹다가: ["2020-03-02"] },
      multi: [],
    },
  });
  const choke = (over: Record<string, unknown> = {}) =>
    goodAnswer({
      level: 10,
      levelReason: "숨을 못 쉬는 병일 수 있어 바로 119예요",
      summary: "엄마가 사탕을 먹다가 숨을 못 쉬어요. 지금 등을 두드리세요",
      tryNow: [
        {
          action: "등을 5회 세게 두드리고 옆 사람에게 119 신고를 부탁해요",
          basis: "EMERG-KDCA-2025",
        },
        { action: "안 나오면 복부를 밀어내요", basis: "EMERG-KDCA-CHOKE" },
      ],
      evidence: [{ ref: "EMERG-KDCA-2025", point: "먼저 행동하고 119는 동시에" }],
      upIf: ["119에 바로 전화해요"],
      forAsker: "엄마께: 지금 바로 등을 두드려요",
      ...over,
    });
  it("식사기록·주제 불일치·3인칭·질환 낱말·단계 보정·권장 단계·호칭 규칙은 위급에 걸리지 않는다", () => {
    const r = checkAnswer(choke(), chokeInfo, true);
    expect(r.items).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it("같은 답을 위급이 아닌 질문으로 보면 식사 규칙·말씨 규칙이 걸린다(대조)", () => {
    const r = checkAnswer(
      choke({
        level: 4,
        upIf: ["소아과에 연락해요"],
        observe: { what: "a", howLong: "3~4일", how: "b" },
      }),
      chokeInfo,
      false,
    );
    expect(r.issues.join()).toContain("식사 기록표");
    expect(r.issues.join()).toContain("2인칭");
  });
  it("위급에서도 막는 것: 단계≠10, 금지어, 119 안내 미루기, 내부 규칙·건수 노출은 HARD", () => {
    expect(checkAnswer(choke({ level: 4 }), chokeInfo, true).hard.map((i) => i.category)).toContain(
      "redflag",
    );
    expect(
      checkAnswer(choke({ limits: "정상이에요" }), chokeInfo, true).hard.map((i) => i.category),
    ).toContain("forbidden");
    expect(
      checkAnswer(choke({ limits: "기록이 428건이에요" }), chokeInfo, true).hard.map(
        (i) => i.category,
      ),
    ).toContain("leak");
    const defer = choke({
      tryNow: [
        { action: "119에 전화하고 119 안내에 따라 해요", basis: "EMERG-KDCA-2025" },
        { action: "곁에서 지켜봐요", basis: "EMERG-KDCA-CHOKE" },
      ],
    });
    expect(checkAnswer(defer, chokeInfo, true).hard.map((i) => i.category)).toContain("emergency");
    expect(checkAnswer({ nope: 1 }, chokeInfo, true).hard.map((i) => i.category)).toContain(
      "schema",
    );
  });
  it("응급 basis·전문 기관 이름·ref 실재는 SOFT 안전 지적", () => {
    const r = checkAnswer(
      choke({
        tryNow: [{ action: "등을 두드려요", basis: "일반 권고" }],
        upIf: ["어린이집 선생님께 말해요"],
      }),
      chokeInfo,
      true,
    );
    expect(r.hard).toHaveLength(0);
    expect(r.soft.map((i) => i.category)).toEqual(["safety", "safety"]);
  });
});

describe("HARD / SOFT 분류", () => {
  it("SOFT 는 막지 않는다(hard 비어 있음)", () => {
    const r = checkAnswer(
      goodAnswer({ forAsker: "아버님께: 오늘은 같이 앉아요", summary: "질환이 걱정되셨어요" }),
      info(),
      false,
    );
    expect(r.hard).toHaveLength(0);
    expect(r.soft.map((i) => i.category)).toEqual(["style", "style"]);
    expect(r.ok).toBe(false); // 지적은 있다
  });
  it("kind 불일치(주입 질문에 behavior)는 HARD, 분류 반대는 SOFT", () => {
    const hard = checkAnswer(goodAnswer(), info({ isBehavior: false }), false);
    expect(hard.hard.map((i) => i.category)).toContain("kind");
    const nb = {
      kind: "not_behavior",
      level: 1,
      levelTitle: "",
      levelReason: "이곳은 아이의 행동·발달 걱정을 묻는 곳이에요",
      summary: "아이와 상관없는 질문이에요",
      fromRecords: [],
      evidence: [],
      tryNow: [],
      avoid: [],
      upIf: [],
      downIf: [],
      forAsker: "엄마께: 아이 걱정을 적어 주세요",
    };
    const soft = checkAnswer(nb, info({ isBehavior: true }), false);
    expect(soft.hard).toHaveLength(0);
    expect(soft.soft.map((i) => i.category)).toEqual(["template"]);
  });
  it("권장 단계 지적은 SOFT template", () => {
    const r = checkAnswer(
      goodAnswer({ level: 5, levelReason: "30개월이에요" }),
      info({ suggested: { level: 2, why: "한 번의 흔한 감정 표현이에요" } }),
      false,
    );
    expect(r.hard).toHaveLength(0);
    expect(r.items.find((i) => i.text.includes("권장 단계"))).toMatchObject({
      severity: "soft",
      category: "template",
    });
    const ok = checkAnswer(
      goodAnswer({ level: 3, levelReason: "알림장 기록에서 반복돼요" }),
      info({ suggested: { level: 2, why: "x" } }),
      false,
    );
    expect(ok.items.some((i) => i.text.includes("권장 단계"))).toBe(false);
  });
  it("softToReviewIssues: 감점 범주만 변환(HARD 범주는 제외)", () => {
    const r = checkAnswer(goodAnswer({ forAsker: "아버님께" }), info(), false);
    const issues = softToReviewIssues(r.items);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ category: "style", where: "코드 검사" });
    expect(issues[0]?.fix).toContain("호칭");
    expect(softToReviewIssues([{ severity: "hard", category: "forbidden", text: "x" }])).toEqual(
      [],
    );
  });
});

describe("교정 라운드: 권장 단계 HARD/SOFT, 내부 표지 누수, 식사 기록표, 오래된 기록, 모순", () => {
  const sg = (level: number, min?: number) => ({ level, why: "테스트", ...(min ? { min } : {}) });

  it("권장과 같으면 통과, 다르면 SOFT, 최소(공격 4·퇴행 9) 미만이면 HARD level", () => {
    expect(checkAnswer(goodAnswer({ level: 4 }), info({ suggested: sg(4, 4) }), false).ok).toBe(
      true,
    );
    const soft = checkAnswer(
      goodAnswer({ level: 4, levelReason: "30개월이에요" }),
      info({ suggested: sg(3) }),
      false,
    );
    expect(soft.hard).toHaveLength(0);
    expect(soft.soft.map((i) => i.category)).toContain("template");
    const hard = checkAnswer(goodAnswer({ level: 3 }), info({ suggested: sg(4, 4) }), false);
    expect(hard.hard.map((i) => i.category)).toEqual(["level"]);
    const skill = checkAnswer(goodAnswer({ level: 8 }), info({ suggested: sg(9, 9) }), false);
    expect(skill.hard.map((i) => i.category)).toContain("level");
    expect(
      checkAnswer(goodAnswer({ level: 9 }), info({ suggested: sg(9, 9) }), false).hard,
    ).toHaveLength(0);
  });
  it("말 더듬 4주 이상(noWait)은 「며칠 지켜보기」를 쓰면 SOFT", () => {
    const s = { level: 5, why: "x", noWait: true };
    const bad = goodAnswer({
      level: 5,
      observe: { what: "더듬는 횟수", howLong: "1주", how: "며칠 지켜봐요" },
      upIf: ["언어재활사에게 연락해요"],
    });
    expect(checkAnswer(bad, info({ suggested: s }), false).issues.join()).toContain(
      "며칠 지켜보기",
    );
  });
  it("단계 4 이상 권장이면 「질문에 빈도가 없으면 3 이하」 규칙을 건너뛴다", () => {
    const r = checkAnswer(
      goodAnswer({ level: 9 }),
      info({
        suggested: sg(9, 9),
        severity: { frequency: null, duration: null, impact: null, aggression: null },
      }),
      false,
    );
    expect(r.issues.join()).not.toContain("3 이하");
  });

  it("내부 표지·파일·ID 를 가족 글에 쓰면 HARD leak(ref 칸은 허용)", () => {
    for (const bad of [
      "권장보다 한 단계 높여요",
      "권장 단계가 3이에요",
      "어린이집(장소 모름) 기록이에요",
      "(반 친구일 수 있음) 이야기예요",
      "records/식사기록 에 적어요",
      "가이드 §3-1 을 따라요",
      "guide:05-식사#§3-1 참고",
      "묶음에 있어요",
      "전수 검색에서 봤어요",
      "INT-FEED-01 을 써요",
      "NORM-FEED-01 에 따라요",
    ]) {
      const r = checkAnswer(goodAnswer({ forAsker: `엄마께: ${bad}` }), info(), false);
      expect(
        r.hard.map((i) => i.category),
        bad,
      ).toContain("leak");
    }
    // 가족 글 칸마다
    for (const over of [
      { summary: "묶음 기준으로 봤어요" },
      { levelReason: "권장 단계예요" },
      { avoid: ["records/ 를 쓰지 않아요"] },
      { upIf: ["INT- 를 봐요 소아과에 물어봐요"] },
      { downIf: ["guide:05 를 봐요"] },
      { observe: { what: "a", howLong: "3~4일", how: "가이드 § 를 봐요" } },
      {
        tryNow: [
          { action: "NORM-1 대로 해요", basis: "일반 권고" },
          { action: "b", basis: "일반 권고" },
        ],
      },
      { fromRecords: [{ date: "2020-03-02", what: "(장소 모름)", link: "x", source: "알림장" }] },
    ] as Partial<ReturnType<typeof goodAnswer>>[]) {
      expect(
        checkAnswer(goodAnswer(over), info(), false).hard.map((i) => i.category),
        JSON.stringify(over),
      ).toContain("leak");
    }
    const ok = checkAnswer(
      goodAnswer({
        fromRecords: [
          {
            date: "2020-03-02",
            what: "선생님 알림장: 반 동생들 이야기일 수 있어요",
            link: "엄마 댓글과 이어져요",
            source: "알림장",
          },
        ],
      }),
      info(),
      false,
    );
    expect(ok.hard).toHaveLength(0);
    expect(
      checkAnswer(goodAnswer(), info({ refs: ["SYN-IV-01", "note:2020-03-02"] }), false).ok,
    ).toBe(true); // basis·evidence.ref 의 SYN-… 는 허용
  });
  it("위급 질문에서도 내부 표지는 HARD", () => {
    const r = checkAnswer(
      goodAnswer({ level: 10, upIf: ["119에 바로 전화해요"], summary: "묶음 기준" }),
      info(),
      true,
    );
    expect(r.hard.map((i) => i.category)).toContain("leak");
  });

  const dinnerPack =
    "## A-3. 가족 사실\n- 가족이 2020-03-02부터 2주 저녁 식사 기록표를 쓰고 있어요(가이드 05 §3-1)";
  it("식사 기록표 사실이 있는데 조건·부재로 말하면 SOFT ungrounded", () => {
    const base = info({ pack: `${BASE_PACK}\n${dinnerPack}` });
    for (const bad of [
      "식사 기록표가 있다면 이어서 써요",
      "저녁 식사 기록표를 쓰고 계시면 거기에 적어요",
      "식사 기록은 따로 없어요",
      "기록표가 있으시면 확인해요",
    ]) {
      const r = checkAnswer(goodAnswer({ forAsker: `엄마께: ${bad}` }), base, false);
      expect(
        r.soft.map((i) => i.category),
        bad,
      ).toContain("ungrounded");
    }
    const good = goodAnswer({
      forAsker: "엄마께: 지금 쓰고 계신 2주 저녁 식사 기록표에 이어서 적어요",
    });
    expect(checkAnswer(good, base, false).items.some((i) => i.category === "ungrounded")).toBe(
      false,
    );
    // 사실이 묶음에 없으면 검사하지 않는다
    const none = checkAnswer(
      goodAnswer({ forAsker: "엄마께: 식사 기록표가 있다면 써요" }),
      info(),
      false,
    );
    expect(none.items.some((i) => i.category === "ungrounded")).toBe(false);
  });

  it("12개월보다 오래된 기록은 link 에 변화 설명이 없으면 SOFT record_link, 최근은 통과", () => {
    const rec = (date: string, link: string) =>
      goodAnswer({ fromRecords: [{ date, what: "점심을 반만 먹었어요", link, source: "알림장" }] });
    const base = info({
      today: "2020-09-01",
      pack: `${BASE_PACK}\n[2019-05-01][작성자: 교사][장소: 어린이집]`,
    });
    const old = checkAnswer(rec("2019-05-01", "밥 먹는 일과 이어져요"), base, false);
    expect(old.soft.map((i) => i.category)).toContain("record_link");
    const explained = checkAnswer(
      rec("2019-05-01", "그때부터 지금까지 많이 달라졌는지 비교돼요"),
      base,
      false,
    );
    expect(explained.items.some((i) => i.text.includes("12개월"))).toBe(false);
    const recent = checkAnswer(rec("2020-03-02", "밥 먹는 일과 이어져요"), base, false);
    expect(recent.items.some((i) => i.text.includes("12개월"))).toBe(false);
    // 오늘 날짜가 없으면(합성 환경) 건너뛴다
    expect(
      checkAnswer(rec("2019-05-01", "이어져요"), info(), false).items.some((i) =>
        i.text.includes("12개월"),
      ),
    ).toBe(false);
  });
  it("「지금과는 달라요」를 인정하는 기록은 빼라고 알린다", () => {
    const r = checkAnswer(
      goodAnswer({
        fromRecords: [
          { date: "2020-03-02", what: "점심", link: "지금과는 달라요", source: "알림장" },
        ],
      }),
      info(),
      false,
    );
    expect(r.issues.join()).toContain("관련 없는 기록은 빼요");
  });

  it("단계 문구 모순(8단계 「다음 진료 때」 + 「기다리지 말고」)은 SOFT template", () => {
    const r = checkAnswer(
      goodAnswer({
        level: 8,
        tryNow: [
          { action: "다음 진료 때 말씀드려요", basis: "일반 권고" },
          { action: "기다리지 말고 상담을 예약해요", basis: "일반 권고" },
        ],
        upIf: ["소아과에 연락해요"],
        observe: { what: "a", howLong: "진료·상담 전까지", how: "b" },
      }),
      info(),
      false,
    );
    expect(r.issues.join()).toContain("앞뒤로 어긋나요");
    expect(r.hard).toHaveLength(0);
    expect(checkAnswer(goodAnswer(), info(), false).issues.join()).not.toContain("앞뒤로");
  });
});

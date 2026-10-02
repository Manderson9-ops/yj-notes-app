import { describe, expect, it } from "vitest";
import { displayTitles, referenceName } from "./format";

describe("displayTitles", () => {
  it("drops folder tails and a dash tail shared by three or more docs", () => {
    const m = displayTitles([
      { slug: "a", title: "가 — 테스트아이" },
      { slug: "b", title: "나 — 테스트아이" },
      { slug: "c", title: "다 — 테스트아이" },
      { slug: "d", title: "교육 (guide/)" },
      { slug: "e", title: "라 — 다른꼬리" },
    ]);
    expect(m.get("a")).toBe("가");
    expect(m.get("c")).toBe("다");
    expect(m.get("d")).toBe("교육");
    expect(m.get("e")).toBe("라 — 다른꼬리");
  });
  it("also drops a name tail with an age that other docs do not share (name from the shared tail)", () => {
    const m = displayTitles([
      { slug: "a", title: "가 — 김아무" },
      { slug: "b", title: "나 — 김아무" },
      { slug: "c", title: "다 — 김아무" },
      { slug: "d", title: "라 가이드 — 아무(만 3세)" },
      { slug: "e", title: "마 — 다른 설명" },
    ]);
    expect(m.get("d")).toBe("라 가이드");
    expect(m.get("e")).toBe("마 — 다른 설명"); // 이름이 없는 꼬리는 그대로
  });
  it("keeps titles when the dash tail is not shared", () => {
    expect(displayTitles([{ slug: "a", title: "가 — 나" }]).get("a")).toBe("가 — 나");
  });
});

describe("referenceName", () => {
  it("maps a known source id to a readable name and keeps unknown ids", () => {
    expect(referenceName("WHOGROWTH")).toBe("WHO 아동 성장 표준");
    expect(referenceName("SYNTH-LMS")).toBe("SYNTH-LMS");
  });
});

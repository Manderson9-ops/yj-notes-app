// 워커 API: 원자적 집기·리스 만료·시도 횟수·답 저장 검증. 합성 질문만.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  rows,
  sessionCall,
  syntheticAnswer,
  workerAnswerBody,
  workerCall,
} from "../test-utils/ask";
import { TEST_PIN, cookieFrom, createHarness, type Harness } from "../test-utils/harness";
import { LEASE_MS, MAX_ATTEMPTS } from "./worker";

let h: Harness;
let cookie: string;
beforeEach(async () => {
  h = await createHarness();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  cookie = cookieFrom(await h.login(TEST_PIN));
});
afterEach(() => {
  vi.restoreAllMocks();
});

const ask = async (body: string, askedBy = "엄마"): Promise<number> => {
  h.clock.t += 1000;
  const res = await sessionCall(h, cookie, "POST", "/api/ask", { body, askedBy });
  return (await res.json<{ id: number }>()).id;
};
const claim = () => workerCall(h, "POST", "/api/worker/ask/claim");
const claimed = async () => {
  const res = await claim();
  return res.status === 200
    ? (
        await res.json<{
          question: { id: number; body: string; askedBy: string; redFlag: boolean };
        }>()
      ).question
    : null;
};
const q = (id: number) =>
  rows<{
    status: string;
    attempts: number;
    lease_until: string | null;
    fail_code: string | null;
    claimed_at: string | null;
  }>(
    h,
    `SELECT status, attempts, lease_until, fail_code, claimed_at FROM ask_question WHERE id = ${String(id)}`,
  )[0];

describe("POST /api/worker/ask/claim", () => {
  it("대기 질문이 없으면 204", async () => {
    expect((await claim()).status).toBe(204);
  });

  it("가장 오래된 질문부터, 위급 신호 질문이 먼저", async () => {
    const a = await ask("합성 질문 A");
    const b = await ask("합성 질문 B");
    const c = await ask("합성 경련 질문 C");
    expect((await claimed())?.id).toBe(c); // red_flag 우선
    expect((await claimed())?.id).toBe(a);
    expect((await claimed())?.id).toBe(b);
    expect((await claim()).status).toBe(204);
  });

  it("질문·질문자·위급 여부·시각을 돌려주고 잡힌 상태로 바꾼다", async () => {
    const id = await ask("합성 질문", "할머니");
    const got = await claimed();
    expect(got).toMatchObject({ id, body: "합성 질문", askedBy: "할머니", redFlag: false });
    const row = q(id);
    expect(row?.status).toBe("claimed");
    expect(row?.attempts).toBe(1);
    expect(row?.lease_until).toBe(new Date(h.clock.t + LEASE_MS).toISOString());
  });

  it("원자적: 같은 질문은 동시에 불러도 한 번만 잡힌다", async () => {
    await ask("합성 질문");
    const results = await Promise.all(Array.from({ length: 8 }, () => claim()));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 204)).toHaveLength(7);
    expect(rows(h, "SELECT attempts FROM ask_question")).toEqual([{ attempts: 1 }]);
  });

  it("리스가 남아 있는 동안은 다시 집히지 않고, 만료되면 다시 집힌다(시도 +1)", async () => {
    const id = await ask("합성 질문");
    await claim();
    h.clock.t += LEASE_MS - 1000;
    expect((await claim()).status).toBe(204);
    h.clock.t += 2000;
    const again = await claimed();
    expect(again?.id).toBe(id);
    expect(q(id)?.attempts).toBe(2);
  });

  it("answering·reviewing 상태도 리스 만료 후 다시 집힌다", async () => {
    const id = await ask("합성 질문");
    await claim();
    await workerCall(h, "POST", `/api/worker/ask/${String(id)}/progress`, { status: "reviewing" });
    h.clock.t += LEASE_MS + 1000;
    expect((await claimed())?.id).toBe(id);
  });

  it("시도 3번 뒤 리스가 만료되면 failed(too_many_attempts), 더는 집히지 않는다", async () => {
    const id = await ask("합성 질문");
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect((await claimed())?.id).toBe(id);
      h.clock.t += LEASE_MS + 1000;
    }
    expect(q(id)?.attempts).toBe(MAX_ATTEMPTS);
    expect((await claim()).status).toBe(204);
    expect(q(id)).toMatchObject({
      status: "failed",
      fail_code: "too_many_attempts",
      lease_until: null,
    });
  });

  it("지운 질문은 집지 않는다", async () => {
    const id = await ask("합성 질문");
    await sessionCall(h, cookie, "DELETE", `/api/ask/${String(id)}`);
    expect((await claim()).status).toBe(204);
  });

  it("호출마다 워커 생존 표시를 갱신하되 쓰기는 60초에 한 번만", async () => {
    const seen = () =>
      rows<{ value: string }>(
        h,
        "SELECT value FROM app_setting WHERE key = 'ask_worker_seen_at'",
      )[0]?.value;
    expect(seen()).toBeUndefined();
    await claim();
    const first = seen();
    expect(first).toBe(new Date(h.clock.t).toISOString());
    h.clock.t += 30_000;
    await claim();
    expect(seen()).toBe(first); // 60초 안: 쓰지 않음
    h.clock.t += 31_000;
    await workerCall(h, "GET", "/api/worker/ping");
    expect(seen()).toBe(new Date(h.clock.t).toISOString());
  });
});

describe("progress", () => {
  it("상태를 바꾸고 리스를 5분 연장한다", async () => {
    const id = await ask("합성 질문");
    await claim();
    h.clock.t += 4 * 60_000;
    const res = await workerCall(h, "POST", `/api/worker/ask/${String(id)}/progress`, {
      status: "answering",
    });
    expect(res.status).toBe(204);
    expect(q(id)).toMatchObject({
      status: "answering",
      lease_until: new Date(h.clock.t + LEASE_MS).toISOString(),
    });
  });

  it("검증·상태 충돌: 잘못된 상태 422, 대기 중/완료/없는 번호는 409·404", async () => {
    const id = await ask("합성 질문");
    const path = `/api/worker/ask/${String(id)}/progress`;
    expect((await workerCall(h, "POST", path, { status: "done" })).status).toBe(422);
    expect((await workerCall(h, "POST", path, { status: "answering" })).status).toBe(409); // 아직 pending
    expect(
      (await workerCall(h, "POST", "/api/worker/ask/abc/progress", { status: "answering" })).status,
    ).toBe(404);
  });
});

describe("answer", () => {
  async function inProgress(body = "합성 질문"): Promise<number> {
    const id = await ask(body);
    await claim();
    await workerCall(h, "POST", `/api/worker/ask/${String(id)}/progress`, { status: "reviewing" });
    return id;
  }
  const post = (id: number, json: unknown) =>
    workerCall(h, "POST", `/api/worker/ask/${String(id)}/answer`, json);

  it("저장하고 done, 대기·소요 시간은 서버가 계산한다", async () => {
    const id = await ask("합성 질문"); // t0+1s
    h.clock.t += 20_000;
    await claim(); // 대기 20s
    h.clock.t += 70_000;
    const res = await post(id, workerAnswerBody(5));
    expect(res.status).toBe(200);
    const [a] = rows<{
      level: number;
      review_score: number;
      model: string;
      wait_ms: number;
      work_ms: number;
      total_ms: number;
      answer_json: string;
    }>(h, `SELECT * FROM ask_answer WHERE question_id = ${String(id)}`);
    expect(a).toMatchObject({
      level: 5,
      review_score: 9.6,
      model: "opus-synthetic",
      wait_ms: 20_000,
      work_ms: 42_000,
      total_ms: 90_000,
    });
    expect(JSON.parse(a?.answer_json ?? "{}")).toEqual(syntheticAnswer(5));
    expect(q(id)).toMatchObject({ status: "done", lease_until: null });
  });

  it("스키마 위반 422: 필드 누락·길이·배열 개수·모르는 키·수준 불일치", async () => {
    const id = await inProgress();
    const good = workerAnswerBody(5);
    const bad: unknown[] = [
      { ...good, answer: { ...good.answer, summary: undefined } },
      { ...good, answer: { ...good.answer, summary: "가".repeat(121) } },
      { ...good, answer: { ...good.answer, tryNow: [{ action: "하나" }] } },
      { ...good, answer: { ...good.answer, evidence: [] } },
      { ...good, answer: { ...good.answer, upIf: ["a", "b", "c", "d", "e"] } },
      { ...good, answer: { ...good.answer, extra: "x" } },
      {
        ...good,
        answer: {
          ...good.answer,
          fromRecords: [{ date: "2020/01/15", what: "x", source: "알림장" }],
        },
      },
      {
        ...good,
        answer: {
          ...good.answer,
          fromRecords: [{ date: "2020-01-15", what: "x", source: "기타" }],
        },
      },
      { ...good, level: 11 },
      { ...good, level: 0 },
      { ...good, level: 4 }, // answer.level 5 와 불일치
      { ...good, reviewScore: 11 },
      { ...good, workMs: -1 },
      { ...good, model: "" },
      "not an object",
    ];
    for (const b of bad)
      expect((await post(id, b)).status, JSON.stringify(b).slice(0, 60)).toBe(422);
    expect(q(id)?.status).toBe("reviewing");
    expect(rows(h, "SELECT 1 FROM ask_answer")).toHaveLength(0);
  });

  it("판정 어휘(금지어)가 있으면 422, 수량 「이상」 은 통과", async () => {
    const id = await inProgress();
    const forbidden = await post(id, workerAnswerBody(5, { summary: "발달이 정상 범위예요" }));
    expect(forbidden.status).toBe(422);
    const body = JSON.stringify(await forbidden.json());
    expect(body).not.toContain("정상");
    expect((await post(id, workerAnswerBody(5, { avoid: ["지연 이라고 말하기"] }))).status).toBe(
      422,
    );
    expect((await post(id, workerAnswerBody(5, { upIf: ["하루 5번 이상 늘어요"] }))).status).toBe(
      200,
    );
  });

  it("위급 신호 질문은 10단계만 받는다", async () => {
    const id = await inProgress("합성 경련 질문");
    expect((await post(id, workerAnswerBody(9))).status).toBe(422);
    expect(
      (await post(id, workerAnswerBody(10, { levelTitle: "지금 바로 진료·연락" }))).status,
    ).toBe(200);
  });

  it("스키마 최대 크기 답도 60KB 한도 안이다(서버 크기 검사는 방어용으로 남긴다)", async () => {
    const id = await inProgress();
    const max = syntheticAnswer(5, {
      levelReason: "가".repeat(220),
      summary: "가".repeat(120),
      fromRecords: Array.from({ length: 4 }, () => ({
        date: "2020-01-15",
        what: "가".repeat(140),
        link: "가".repeat(80),
        source: "알림장" as const,
      })),
      evidence: Array.from({ length: 3 }, () => ({
        ref: "가".repeat(120),
        point: "가".repeat(200),
        grade: "B",
      })),
      tryNow: Array.from({ length: 3 }, () => ({
        action: "가".repeat(160),
        say: "가".repeat(80),
        basis: "가".repeat(120),
      })),
      avoid: Array.from({ length: 3 }, () => "가".repeat(100)),
      upIf: Array.from({ length: 3 }, () => "가".repeat(120)),
      downIf: Array.from({ length: 3 }, () => "가".repeat(120)),
      observe: { what: "가".repeat(100), howLong: "가".repeat(40), how: "가".repeat(200) },
      forAsker: "가".repeat(160),
      limits: "가".repeat(160),
    });
    const bytes = new TextEncoder().encode(JSON.stringify(max)).byteLength;
    expect(bytes).toBeLessThan(60 * 1024);
    expect((await post(id, { ...workerAnswerBody(5), answer: max })).status).toBe(200);
  });

  it("not_behavior 답: DB 에는 level 1 로 두고 API(상세·목록)는 level 을 숨긴다, behavior 는 그대로", async () => {
    const nb = {
      kind: "not_behavior" as const,
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
    const id = await inProgress();
    expect((await post(id, { ...workerAnswerBody(1), level: 1, answer: nb })).status).toBe(200);
    expect(rows<{ level: number }>(h, "SELECT level FROM ask_answer")[0]?.level).toBe(1);
    const detail = await (
      await sessionCall(h, cookie, "GET", `/api/ask/${String(id)}`)
    ).json<{
      answer: { level: number | null; answer: { kind: string; levelTitle: string } };
    }>();
    expect(detail.answer.level).toBeNull();
    expect(detail.answer.answer).toMatchObject({ kind: "not_behavior", levelTitle: "" });
    const list = await (
      await sessionCall(h, cookie, "GET", "/api/ask")
    ).json<{
      items: { id: number; level?: number }[];
    }>();
    expect(list.items.find((x) => x.id === id)).not.toHaveProperty("level");
    const id2 = await inProgress("합성 두 번째 질문");
    expect((await post(id2, workerAnswerBody(5))).status).toBe(200);
    const list2 = await (
      await sessionCall(h, cookie, "GET", "/api/ask")
    ).json<{
      items: { id: number; level?: number }[];
    }>();
    expect(list2.items.find((x) => x.id === id2)?.level).toBe(5);
  });
  it("진행 중이 아니면 409 (대기·완료·지운 질문), 두 번 올려도 한 번만 저장", async () => {
    const pending = await ask("대기 질문");
    expect((await post(pending, workerAnswerBody(5))).status).toBe(409);
    await sessionCall(h, cookie, "DELETE", `/api/ask/${String(pending)}`);
    const id = await inProgress();
    expect((await post(id, workerAnswerBody(5))).status).toBe(200);
    expect((await post(id, workerAnswerBody(6))).status).toBe(409);
    expect(rows(h, "SELECT 1 FROM ask_answer")).toHaveLength(1);
    expect((await post(99_999, workerAnswerBody(5))).status).toBe(409);
    expect(
      (await workerCall(h, "POST", "/api/worker/ask/abc/answer", workerAnswerBody(5))).status,
    ).toBe(404);
  });
});

describe("fail", () => {
  const fail = (id: number, code = "claude_error") =>
    workerCall(h, "POST", `/api/worker/ask/${String(id)}/fail`, { code });

  it("시도가 남았으면 pending 으로 되돌려 다시 집히게 한다", async () => {
    const id = await ask("합성 질문");
    await claim();
    const res = await fail(id);
    expect((await res.json<{ status: string }>()).status).toBe("pending");
    expect(q(id)).toMatchObject({
      status: "pending",
      fail_code: "claude_error",
      lease_until: null,
    });
    expect((await claimed())?.id).toBe(id);
  });

  it("시도 3번째 실패는 failed", async () => {
    const id = await ask("합성 질문");
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await claim();
      const res = await fail(id);
      expect((await res.json<{ status: string }>()).status).toBe(
        i < MAX_ATTEMPTS - 1 ? "pending" : "failed",
      );
    }
    expect((await claim()).status).toBe(204);
  });

  it("코드 형식 검증(소문자·숫자·밑줄 40자), 진행 중이 아니면 409", async () => {
    const id = await ask("합성 질문");
    expect((await fail(id)).status).toBe(409);
    await claim();
    expect((await fail(id, "Bad Code")).status).toBe(422);
    expect((await fail(id, "a".repeat(41))).status).toBe(422);
    expect((await fail(id, "ok_code_1")).status).toBe(200);
  });
});

describe("민감 정보", () => {
  it("오류 응답과 서버 로그에 질문 글이 없다", async () => {
    const spy = vi.spyOn(console, "error");
    const id = await ask("아주 특이한 합성 문장 XYZ");
    await claim();
    h.fake.failWith(new Error("D1 boom"));
    const res = await workerCall(h, "POST", `/api/worker/ask/${String(id)}/progress`, {
      status: "answering",
    });
    h.fake.failWith(null);
    expect(res.status).toBe(500);
    const all = JSON.stringify(await res.json()) + JSON.stringify(spy.mock.calls);
    expect(all).not.toContain("XYZ");
  });
});

async function finishQuestion(body: string, askedBy = "엄마", level = 5, over = {}): Promise<number> {
  const id = await ask(body, askedBy);
  const got = await claimed();
  expect(got?.id).toBe(id);
  const res = await workerCall(h, "POST", `/api/worker/ask/${String(id)}/answer`, workerAnswerBody(level, over));
  expect(res.status).toBe(200);
  return id;
}

describe("claim: 다시 답변(reask) 덩어리", () => {
  it("처음 질문에는 reask 가 없고, 다시 답변 요청 뒤에는 이전 답·이유·횟수가 온다", async () => {
    const id = await finishQuestion("합성 질문");
    const first = await workerCall(h, "POST", "/api/worker/ask/claim");
    expect(first.status).toBe(204);
    await sessionCall(h, cookie, "POST", `/api/ask/${String(id)}/reask`, {
      by: "아빠",
      choice: "우리 상황과 달라요",
      text: "합성 사정이 있어요",
    });
    const res = await workerCall(h, "POST", "/api/worker/ask/claim");
    const j = await res.json<{
      question: { id: number };
      reask?: { count: number; reason: string; by: string; previousAnswer: { summary: string } | null };
    }>();
    expect(j.question.id).toBe(id);
    expect(j.reask).toMatchObject({ count: 1, reason: "우리 상황과 달라요 · 합성 사정이 있어요", by: "아빠" });
    expect(j.reask?.previousAnswer?.summary).toContain("합성 상황");
  });

  it("처음 답변 claim 응답에는 reask 키가 없다", async () => {
    await ask("합성 질문");
    const j = await (await workerCall(h, "POST", "/api/worker/ask/claim")).json<Record<string, unknown>>();
    expect(Object.keys(j)).toEqual(["question"]);
  });
});

describe("GET /api/worker/ask/history", () => {
  const history = (qs = "") => workerCall(h, "GET", `/api/worker/ask/history${qs}`);
  type Hist = {
    items: {
      id: number; body: string; askedBy: string; level: number; tryNowActions: string[];
      votes: { by: string; helpful: boolean; reason: string | null }[];
      notes: { by: string; note: string }[];
    }[];
  };

  it("토큰 없음·틀린 토큰 401, 세션 쿠키만으로도 401", async () => {
    expect((await workerCall(h, "GET", "/api/worker/ask/history", undefined, null)).status).toBe(401);
    expect((await workerCall(h, "GET", "/api/worker/ask/history", undefined, "wrong-token-0123456789abcdef")).status).toBe(401);
    const viaCookie = await h.handle(
      new Request("https://app.example.test/api/worker/ask/history", { headers: { Cookie: cookie } }),
    );
    expect(viaCookie.status).toBe(401);
  });

  it("세션 API 경로로는 Bearer 가 통하지 않는다(영역 분리)", async () => {
    const res = await workerCall(h, "GET", "/api/ask");
    expect(res.status).toBe(401);
  });

  it("끝난 행동 질문만 최신순: 본문·단계·권한 방법·표·메모", async () => {
    const a = await finishQuestion("합성 질문 첫째");
    const b = await finishQuestion("합성 질문 둘째", "아빠", 4);
    await ask("아직 대기 중 질문");
    await sessionCall(h, cookie, "PUT", `/api/ask/${String(a)}/vote`, { by: "엄마", helpful: true });
    await sessionCall(h, cookie, "PUT", `/api/ask/${String(a)}/vote`, { by: "할머니", helpful: false, reason: "안 됐어요" });
    await sessionCall(h, cookie, "POST", `/api/ask/${String(a)}/feedback`, { by: "엄마", note: "먼저 안아 줬어요" });
    const res = await history();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    const j = await res.json<Hist>();
    expect(j.items.map((i) => i.id)).toEqual([b, a]);
    expect(j.items[0]).toMatchObject({ body: "합성 질문 둘째", askedBy: "아빠", level: 4 });
    expect(j.items[1]?.tryNowActions).toEqual(["먼저 안아 주기", "잠시 쉬기"]);
    expect(j.items[1]?.votes).toEqual([
      { by: "엄마", helpful: true, reason: null },
      { by: "할머니", helpful: false, reason: "안 됐어요" },
    ]);
    expect(j.items[1]?.notes[0]).toMatchObject({ by: "엄마", note: "먼저 안아 줬어요" });
  });

  it("not_behavior·삭제된 질문은 빠진다", async () => {
    const nb = await ask("상관없는 글");
    await claimed();
    await workerCall(h, "POST", `/api/worker/ask/${String(nb)}/answer`, {
      level: 1,
      answer: {
        kind: "not_behavior", level: 1, levelTitle: "", levelReason: "도울 수 있는 일을 안내해요",
        summary: "행동 질문이 아니에요", fromRecords: [], evidence: [], tryNow: [], avoid: [],
        upIf: [], downIf: [], forAsker: "엄마께: 행동을 물어봐 주세요",
      },
      reviewScore: 9.6, model: "m", workMs: 1,
    });
    const gone = await finishQuestion("합성 삭제될 질문");
    await sessionCall(h, cookie, "DELETE", `/api/ask/${String(gone)}`);
    expect((await (await history()).json<Hist>()).items).toEqual([]);
  });

  it("limit: 기본 60, 범위 밖·숫자 아님 400, 작게 주면 그만큼", async () => {
    await finishQuestion("합성 하나");
    await finishQuestion("합성 둘");
    expect((await (await history("?limit=1")).json<Hist>()).items).toHaveLength(1);
    for (const bad of ["?limit=0", "?limit=101", "?limit=abc", "?limit=-1", "?limit=1.5"]) {
      expect((await history(bad)).status).toBe(400);
    }
  });

  it("응답 크기 200KB 상한: 오래된 것부터 버린다", async () => {
    const big = "가".repeat(480);
    for (let i = 0; i < 100; i++) {
      h.fake.sqlite
        .prepare("INSERT INTO ask_question (asked_by, body, status, created_at, updated_at) VALUES ('엄마', ?, 'done', '2030-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z')")
        .run(`${big}${String(i)}`);
      h.fake.sqlite
        .prepare("INSERT INTO ask_answer (question_id, level, answer_json, created_at) VALUES (?, 5, ?, '2030-01-01T00:00:00.000Z')")
        .run(i + 1, JSON.stringify(syntheticAnswer(5)));
      for (let k = 0; k < 10; k++) {
        h.fake.sqlite
          .prepare("INSERT INTO ask_feedback (question_id, by, note, created_at) VALUES (?, '엄마', ?, '2030-01-01T00:00:00.000Z')")
          .run(i + 1, "나".repeat(300));
      }
    }
    const res = await history("?limit=100");
    const text = await res.text();
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(200 * 1024);
    const j = JSON.parse(text) as Hist;
    expect(j.items.length).toBeGreaterThan(0);
    expect(j.items.length).toBeLessThan(100);
    expect(j.items[0]?.id).toBe(100); // 최신부터 남는다
  });

  it("로그에 본문을 남기지 않는다", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await finishQuestion("합성 비밀 본문");
    await history();
    const logged = JSON.stringify([...spy.mock.calls, ...vi.mocked(console.error).mock.calls]);
    expect(logged).not.toContain("합성 비밀 본문");
  });
});

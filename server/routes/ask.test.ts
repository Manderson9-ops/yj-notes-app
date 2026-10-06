import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  rows,
  sessionCall,
  syntheticAnswer,
  workerAnswerBody,
  workerCall,
} from "../test-utils/ask";
import { ASK_REASK_MAX, ASK_VOTERS_MAX } from "../../shared/ask-schema";
import { ORIGIN, TEST_PIN, cookieFrom, createHarness, type Harness } from "../test-utils/harness";
import { ASK_RATE } from "./ask";

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

const call = (method: string, path: string, json?: unknown) =>
  sessionCall(h, cookie, method, path, json);
const ask = (body: string, askedBy = "엄마") => call("POST", "/api/ask", { body, askedBy });

function seedNote(reportId: number, date: string, body: string) {
  h.fake.sqlite
    .prepare(
      "INSERT OR IGNORE INTO note_day (date, class_name, age_months, n_reports, n_images, n_comments, first_line) VALUES (?, '합성반', 30, 1, 0, 0, '')",
    )
    .run(date);
  h.fake.sqlite
    .prepare(
      "INSERT INTO note_item (report_id, date, author_role, direction, weather, posted_at, body) VALUES (?, ?, '교사', 'to_home', NULL, ?, ?)",
    )
    .run(reportId, date, `${date} 10:00`, body);
}

describe("POST /api/ask", () => {
  it("201: 접수 + 즉시 결과(알림장·자료 각 최대 5개)", async () => {
    for (let i = 1; i <= 7; i++)
      seedNote(
        i,
        `2020-01-${String(i).padStart(2, "0")}`,
        `테스트아이가 간식 시간에 친구A 와 놀았어요 ${String(i)}`,
      );
    seedNote(20, "2020-01-20", "산책을 다녀왔어요");
    h.fake.sqlite
      .prepare(
        "INSERT INTO report_doc (slug, title, kind, r2_key, generated_at, source_commit, verify_ok, sha256, summary) VALUES ('guide-01', '간식 가이드 예시', 'markdown', '', '2020-01-10', 'c', 1, 'x', '간식 이야기')",
      )
      .run();
    const res = await ask("간식 시간에 자꾸 던져요");
    expect(res.status).toBe(201);
    const j = await res.json<{
      id: number;
      status: string;
      redFlag: boolean;
      instant: {
        notes: { date: string; snippet: string; id: number }[];
        docs: { slug: string; title: string }[];
      };
    }>();
    expect(j.status).toBe("pending");
    expect(j.redFlag).toBe(false);
    expect(j.instant.notes).toHaveLength(5);
    expect(j.instant.notes[0]?.date).toBe("2020-01-07"); // 최신순
    expect(j.instant.notes[0]?.snippet).toContain("간식");
    expect(j.instant.docs).toEqual([{ slug: "guide-01", title: "간식 가이드 예시" }]);
    const [row] = rows<{ status: string; asked_by: string; red_flag: number }>(
      h,
      "SELECT status, asked_by, red_flag FROM ask_question",
    );
    expect(row).toEqual({ status: "pending", asked_by: "엄마", red_flag: 0 });
  });

  it("위급 신호 글이면 redFlag true 로 저장", async () => {
    const res = await ask("자다가 경련을 했어요");
    expect((await res.json<{ redFlag: boolean }>()).redFlag).toBe(true);
    expect(rows<{ red_flag: number }>(h, "SELECT red_flag FROM ask_question")[0]?.red_flag).toBe(1);
  });

  it("LIKE 와일드카드·따옴표가 있어도 안전하게 동작한다", async () => {
    seedNote(1, "2020-01-01", "100% 달라요");
    const res = await ask("100% '); DROP TABLE ask_question;-- 달라요");
    expect(res.status).toBe(201);
    expect(rows(h, "SELECT id FROM ask_question")).toHaveLength(1);
  });

  it("검증: 빈 글·1000자 초과·질문자 누락/13자 -> 422, 깨진 JSON -> 400", async () => {
    expect((await ask("   ")).status).toBe(422);
    expect((await ask("가".repeat(1001))).status).toBe(422);
    expect((await ask("가".repeat(1000))).status).toBe(201);
    expect((await call("POST", "/api/ask", { body: "합성" })).status).toBe(422);
    expect((await ask("합성", "가".repeat(13))).status).toBe(422);
    expect(
      (await call("POST", "/api/ask", { body: "합성", askedBy: "엄마", extra: 1 })).status,
    ).toBe(422);
    const bad = await h.handle(
      new Request("https://app.example.test/api/ask", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "https://app.example.test",
          "Content-Type": "application/json",
        },
        body: "{oops",
      }),
    );
    expect(bad.status).toBe(400);
  });

  it("세션 없이는 401, Origin 이 다르면 403", async () => {
    const noSession = await h.handle(
      new Request("https://app.example.test/api/ask", {
        method: "POST",
        headers: { Origin: "https://app.example.test", "Content-Type": "application/json" },
        body: JSON.stringify({ body: "합성", askedBy: "엄마" }),
      }),
    );
    expect(noSession.status).toBe(401);
    const bad = await h.handle(
      new Request("https://app.example.test/api/ask", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "https://evil.example",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ body: "합성", askedBy: "엄마" }),
      }),
    );
    expect(bad.status).toBe(403);
  });

  it("같은 사람이 10분 안 10건을 넘기면 429, 10분 뒤에는 다시 가능, 다른 사람은 영향 없음", async () => {
    for (let i = 0; i < ASK_RATE.max; i++)
      expect((await ask(`합성 질문 ${String(i)}`)).status).toBe(201);
    const limited = await ask("합성 질문 초과");
    expect(limited.status).toBe(429);
    expect(JSON.stringify(await limited.json())).not.toContain("초과");
    expect((await ask("다른 사람 질문", "아빠")).status).toBe(201);
    h.clock.t += ASK_RATE.windowMs + 1000;
    expect((await ask("10분 뒤 질문")).status).toBe(201);
  });
});

describe("GET /api/ask · /api/ask/:id", () => {
  it("목록: 최신순 20개 + 더 보기(before), 미리보기 80자", async () => {
    for (let i = 0; i < 22; i++) {
      h.clock.t += 60_000 * 11; // 비율 제한 회피
      await ask(i === 0 ? "가".repeat(120) : `합성 질문 ${String(i)}`);
    }
    const first = await (
      await call("GET", "/api/ask")
    ).json<{
      items: { id: number; bodyPreview: string; status: string }[];
      nextBefore: number | null;
    }>();
    expect(first.items).toHaveLength(20);
    expect(first.items[0]?.id).toBe(22);
    expect(first.nextBefore).toBe(3);
    const second = await (
      await call("GET", `/api/ask?before=${String(first.nextBefore)}`)
    ).json<{
      items: { id: number; bodyPreview: string }[];
      nextBefore: number | null;
    }>();
    expect(second.items.map((i) => i.id)).toEqual([2, 1]);
    expect(second.nextBefore).toBeNull();
    expect(second.items[1]?.bodyPreview).toBe(`${"가".repeat(80)}…`);
    expect((await call("GET", "/api/ask?before=abc")).status).toBe(400);
  });

  it("상세: 답 대기 중에는 answer 없음, 완료 후 답·단계 포함", async () => {
    const id = (await (await ask("합성 질문")).json<{ id: number }>()).id;
    const wait = await (
      await call("GET", `/api/ask/${String(id)}`)
    ).json<Record<string, unknown>>();
    expect(wait.status).toBe("pending");
    expect(wait.answer).toBeUndefined();
    expect((wait.question as { body: string }).body).toBe("합성 질문");

    await workerCall(h, "POST", "/api/worker/ask/claim");
    h.clock.t += 90_000;
    const done = await workerCall(
      h,
      "POST",
      `/api/worker/ask/${String(id)}/answer`,
      workerAnswerBody(5),
    );
    expect(done.status).toBe(200);
    const detail = await (
      await call("GET", `/api/ask/${String(id)}`)
    ).json<{
      status: string;
      answer: { level: number; totalMs: number; answer: { summary: string } };
    }>();
    expect(detail.status).toBe("done");
    expect(detail.answer.level).toBe(5);
    expect(detail.answer.totalMs).toBe(90_000);
    expect(detail.answer.answer.summary).toBe(syntheticAnswer().summary);
    const list = await (await call("GET", "/api/ask")).json<{ items: { level?: number }[] }>();
    expect(list.items[0]?.level).toBe(5);
  });

  it("손상된 답 JSON 은 answer 없이 돌려준다(오류 아님)", async () => {
    const id = (await (await ask("합성 질문")).json<{ id: number }>()).id;
    h.fake.sqlite
      .prepare(
        "INSERT INTO ask_answer (question_id, level, answer_json, created_at) VALUES (?, 3, '{broken', 'x')",
      )
      .run(id);
    const res = await call("GET", `/api/ask/${String(id)}`);
    expect(res.status).toBe(200);
    expect((await res.json<{ answer?: unknown }>()).answer).toBeUndefined();
  });

  it("없는 번호·형식이 틀린 번호·지운 질문은 404", async () => {
    expect((await call("GET", "/api/ask/999")).status).toBe(404);
    expect((await call("GET", "/api/ask/abc")).status).toBe(404);
    expect((await call("GET", "/api/ask/1abc")).status).toBe(404);
    const id = (await (await ask("합성 질문")).json<{ id: number }>()).id;
    expect((await call("DELETE", `/api/ask/${String(id)}`)).status).toBe(204);
    expect((await call("GET", `/api/ask/${String(id)}`)).status).toBe(404);
    expect((await call("DELETE", `/api/ask/${String(id)}`)).status).toBe(404);
    expect((await (await call("GET", "/api/ask")).json<{ items: unknown[] }>()).items).toHaveLength(
      0,
    );
    expect(rows(h, "SELECT id FROM ask_question WHERE deleted_at IS NOT NULL")).toHaveLength(1);
  });

  it("즉시 결과 다시 보기", async () => {
    seedNote(1, "2020-01-01", "합성 낮잠 이야기");
    const id = (await (await ask("낮잠 시간")).json<{ id: number }>()).id;
    const res = await call("GET", `/api/ask/${String(id)}/instant`);
    expect((await res.json<{ notes: unknown[] }>()).notes).toHaveLength(1);
    expect((await call("GET", "/api/ask/999/instant")).status).toBe(404);
  });
});

/** 질문 하나를 끝까지(접수 -> 워커가 집음 -> 답 게시) 만든다. */
async function doneQuestion(body = "합성 질문", askedBy = "엄마"): Promise<number> {
  h.clock.t += 1000;
  const id = (await (await ask(body, askedBy)).json<{ id: number }>()).id;
  const claim = await workerCall(h, "POST", "/api/worker/ask/claim");
  expect(claim.status).toBe(200);
  const res = await workerCall(
    h,
    "POST",
    `/api/worker/ask/${String(id)}/answer`,
    workerAnswerBody(5),
  );
  expect(res.status).toBe(200);
  return id;
}
interface Detail {
  status: string;
  feedback: { by: string; note: string }[];
  votes: { by: string; helpful: boolean; reason: string | null }[];
  history: { version: number; level: number | null; answer: { summary: string } }[];
  reask: { count: number; reason: string | null; by: string | null };
  answer?: { level: number };
}
const detail = async (id: number): Promise<Detail> =>
  (await call("GET", `/api/ask/${String(id)}`)).json<Detail>();

describe("POST /api/ask/:id/feedback (메모만)", () => {
  it("메모를 저장하고 상세에 보인다. helpful 은 거부", async () => {
    const id = (await (await ask("합성 질문")).json<{ id: number }>()).id;
    const p = `/api/ask/${String(id)}/feedback`;
    expect((await call("POST", p, { by: "할머니", note: "해 봤어요" })).status).toBe(201);
    expect((await call("POST", p, { by: "아빠", helpful: true })).status).toBe(422);
    expect((await call("POST", p, { by: "아빠", note: "x", helpful: true })).status).toBe(422);
    expect((await detail(id)).feedback.map((f) => [f.by, f.note])).toEqual([
      ["할머니", "해 봤어요"],
    ]);
  });

  it("검증: 메모 없음·501자·없는 질문", async () => {
    const id = (await (await ask("합성 질문")).json<{ id: number }>()).id;
    const p = `/api/ask/${String(id)}/feedback`;
    expect((await call("POST", p, { by: "아빠" })).status).toBe(422);
    expect((await call("POST", p, { by: "아빠", note: "가".repeat(501) })).status).toBe(422);
    expect((await call("POST", "/api/ask/999/feedback", { by: "아빠", note: "x" })).status).toBe(
      404,
    );
  });
});

describe("PUT /api/ask/:id/vote", () => {
  it("upsert: 처음 -> 바꾸기 -> 취소(null)", async () => {
    const id = await doneQuestion();
    const p = `/api/ask/${String(id)}/vote`;
    expect((await call("PUT", p, { by: "아빠", helpful: true })).status).toBe(200);
    let r = await (
      await call("PUT", p, { by: "할머니", helpful: false, reason: "너무 어려워요" })
    ).json<{
      votes: { by: string; helpful: boolean; reason: string | null }[];
    }>();
    expect(r.votes.map((v) => [v.by, v.helpful, v.reason])).toEqual([
      ["아빠", true, null],
      ["할머니", false, "너무 어려워요"],
    ]);
    // 바꾸기: 같은 사람의 표는 한 줄만
    r = await (await call("PUT", p, { by: "아빠", helpful: false })).json();
    expect(r.votes).toHaveLength(2);
    expect(r.votes.find((v) => v.by === "아빠")).toMatchObject({ helpful: false, reason: null });
    // 👍 로 바꾸면 이유는 지워진다
    r = await (await call("PUT", p, { by: "할머니", helpful: true })).json();
    expect(r.votes.find((v) => v.by === "할머니")).toMatchObject({ helpful: true, reason: null });
    // 취소
    r = await (await call("PUT", p, { by: "아빠", helpful: null })).json();
    expect(r.votes.map((v) => v.by)).toEqual(["할머니"]);
    expect((await call("PUT", p, { by: "아빠", helpful: null })).status).toBe(200); // 없는 표 취소도 안전
    expect((await detail(id)).votes).toHaveLength(1);
    expect(rows(h, "SELECT 1 FROM ask_vote")).toHaveLength(1);
  });

  it("검증: 이유는 👎 만·200자·모르는 필드·없는 질문·끝나기 전 질문", async () => {
    const id = await doneQuestion();
    const p = `/api/ask/${String(id)}/vote`;
    expect((await call("PUT", p, { by: "아빠", helpful: true, reason: "x" })).status).toBe(422);
    expect(
      (await call("PUT", p, { by: "아빠", helpful: false, reason: "가".repeat(201) })).status,
    ).toBe(422);
    expect((await call("PUT", p, { by: "아빠", helpful: "yes" })).status).toBe(422);
    expect((await call("PUT", p, { by: "아빠", helpful: true, extra: 1 })).status).toBe(422);
    expect((await call("PUT", p, { by: "", helpful: true })).status).toBe(422);
    expect((await call("PUT", "/api/ask/999/vote", { by: "아빠", helpful: true })).status).toBe(
      404,
    );
    expect((await call("PUT", "/api/ask/abc/vote", { by: "아빠", helpful: true })).status).toBe(
      404,
    );
    const pending = (await (await ask("대기 중 질문")).json<{ id: number }>()).id;
    expect(
      (await call("PUT", `/api/ask/${String(pending)}/vote`, { by: "아빠", helpful: true })).status,
    ).toBe(409);
  });

  it("서로 다른 사람 수 상한(12명)을 넘으면 429, 기존 사람은 바꿀 수 있다", async () => {
    const id = await doneQuestion();
    const p = `/api/ask/${String(id)}/vote`;
    for (let i = 0; i < ASK_VOTERS_MAX; i++) {
      expect((await call("PUT", p, { by: `사람${String(i)}`, helpful: true })).status).toBe(200);
    }
    expect((await call("PUT", p, { by: "새사람", helpful: true })).status).toBe(429);
    expect((await call("PUT", p, { by: "사람0", helpful: false })).status).toBe(200);
  });

  it("세션 없이·Origin 없이는 거절", async () => {
    const id = await doneQuestion();
    const res = await h.handle(
      new Request(`${ORIGIN}/api/ask/${String(id)}/vote`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Origin: ORIGIN },
        body: JSON.stringify({ by: "아빠", helpful: true }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("목록에 👍/👎 수", async () => {
    const id = await doneQuestion();
    await call("PUT", `/api/ask/${String(id)}/vote`, { by: "아빠", helpful: true });
    await call("PUT", `/api/ask/${String(id)}/vote`, { by: "엄마", helpful: true });
    await call("PUT", `/api/ask/${String(id)}/vote`, { by: "할머니", helpful: false });
    const list = await (
      await call("GET", "/api/ask")
    ).json<{
      items: { id: number; votes: { up: number; down: number } }[];
    }>();
    expect(list.items[0]?.votes).toEqual({ up: 2, down: 1 });
  });
});

describe("POST /api/ask/:id/reask", () => {
  const reask = (id: number, json: unknown) => call("POST", `/api/ask/${String(id)}/reask`, json);

  it("done 만: 현재 답을 이력 1 로 옮기고 대기로 돌린다", async () => {
    const id = await doneQuestion();
    const before = await detail(id);
    expect(before.answer?.level).toBe(5);
    const res = await reask(id, {
      by: "아빠",
      choice: "이미 해 봤어요",
      text: "안아 주기는 했어요",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "pending", reaskCount: 1 });
    const d = await detail(id);
    expect(d.status).toBe("pending");
    expect(d.answer).toBeUndefined();
    expect(d.history).toHaveLength(1);
    expect(d.history[0]).toMatchObject({ version: 1, level: 5 });
    expect(d.reask).toEqual({
      count: 1,
      reason: "이미 해 봤어요 · 안아 주기는 했어요",
      by: "아빠",
    });
    const [qrow] = rows<{ attempts: number; status: string }>(
      h,
      `SELECT attempts, status FROM ask_question WHERE id = ${String(id)}`,
    );
    expect(qrow).toEqual({ attempts: 0, status: "pending" });
    expect(rows(h, "SELECT 1 FROM ask_answer")).toHaveLength(0);
  });

  it("이력 버전이 쌓이고(1,2,3) 4번째는 429", async () => {
    const id = await doneQuestion();
    for (let n = 1; n <= ASK_REASK_MAX; n++) {
      h.clock.t += 1000;
      expect((await reask(id, { by: "엄마", choice: "너무 일반적이에요" })).status).toBe(200);
      const claim = await workerCall(h, "POST", "/api/worker/ask/claim");
      expect(claim.status).toBe(200);
      const body = workerAnswerBody(5, { summary: `합성 답변 ${String(n + 1)}번째예요` });
      expect(
        (await workerCall(h, "POST", `/api/worker/ask/${String(id)}/answer`, body)).status,
      ).toBe(200);
    }
    const d = await detail(id);
    expect(d.history.map((x) => x.version)).toEqual([1, 2, 3]);
    expect(d.history[2]?.answer.summary).toBe("합성 답변 3번째예요");
    expect(d.reask.count).toBe(3);
    expect((await reask(id, { by: "엄마", choice: "너무 일반적이에요" })).status).toBe(429);
    expect((await detail(id)).status).toBe("done");
  });

  it("답이 끝나기 전·실패·삭제된 질문은 409/404, 검증 오류는 422", async () => {
    const id = await doneQuestion();
    const pending = (await (await ask("대기 중")).json<{ id: number }>()).id;
    expect((await reask(pending, { by: "엄마", choice: "너무 일반적이에요" })).status).toBe(409);
    expect((await reask(id, { by: "엄마", choice: "아무 이유" })).status).toBe(422);
    expect((await reask(id, { by: "엄마" })).status).toBe(422);
    expect(
      (await reask(id, { by: "엄마", choice: "이미 해 봤어요", text: "가".repeat(281) })).status,
    ).toBe(422);
    expect((await reask(id, { by: "엄마", choice: "이미 해 봤어요", more: 1 })).status).toBe(422);
    expect((await reask(999, { by: "엄마", choice: "이미 해 봤어요" })).status).toBe(404);
    expect((await detail(id)).status).toBe("done"); // 검증 실패는 아무것도 바꾸지 않는다
    expect((await reask(id, { by: "엄마", choice: "이미 해 봤어요" })).status).toBe(200);
    // 이미 대기로 돌아간 질문에 또 누르면 409(중복 요청은 한 번만 먹는다)
    expect((await reask(id, { by: "아빠", choice: "이미 해 봤어요" })).status).toBe(409);
    expect((await detail(id)).reask.count).toBe(1);
    await call("DELETE", `/api/ask/${String(id)}`);
    expect((await reask(id, { by: "엄마", choice: "이미 해 봤어요" })).status).toBe(404);
  });

  it("다시 답변 뒤 소요 시간은 요청 시각부터 센다", async () => {
    const id = await doneQuestion();
    h.clock.t += 3 * 24 * 3600_000; // 사흘 뒤
    await reask(id, { by: "엄마", choice: "더 자세히 알고 싶어요" });
    h.clock.t += 20_000;
    await workerCall(h, "POST", "/api/worker/ask/claim");
    h.clock.t += 40_000;
    await workerCall(h, "POST", `/api/worker/ask/${String(id)}/answer`, workerAnswerBody(5));
    const [a] = rows<{ total_ms: number; wait_ms: number }>(
      h,
      "SELECT total_ms, wait_ms FROM ask_answer",
    );
    expect(a?.total_ms).toBe(60_000);
    expect(a?.wait_ms).toBe(20_000);
  });
});

describe("GET /api/overview ask", () => {
  it("대기 수·워커 상태·7일 중앙값", async () => {
    const empty = await (
      await call("GET", "/api/overview")
    ).json<{
      ask: {
        pending: number;
        worker: { online: boolean; seenAt: string | null };
        medianTotalMs7d: number | null;
        feedback7d: { up: number; down: number; notes: number };
      };
    }>();
    expect(empty.ask).toEqual({
      pending: 0,
      worker: { online: false, seenAt: null },
      medianTotalMs7d: null,
      feedback7d: { up: 0, down: 0, notes: 0 },
    });

    await ask("질문 하나");
    await ask("질문 둘");
    let ov = await (await call("GET", "/api/overview")).json<typeof empty>();
    expect(ov.ask.pending).toBe(2);

    await workerCall(h, "GET", "/api/worker/ping");
    ov = await (await call("GET", "/api/overview")).json<typeof empty>();
    expect(ov.ask.worker.online).toBe(true);
    h.clock.t += 121_000;
    ov = await (await call("GET", "/api/overview")).json<typeof empty>();
    expect(ov.ask.worker.online).toBe(false);
    expect(ov.ask.worker.seenAt).not.toBeNull();

    // 중앙값: 10s, 20s, 60s -> 20s ; 하나 더(100s) -> (20+60)/2
    h.fake.sqlite.exec("PRAGMA foreign_keys = OFF");
    const ins = h.fake.sqlite.prepare(
      "INSERT INTO ask_answer (question_id, level, answer_json, total_ms, created_at) VALUES (?, 2, '{}', ?, ?)",
    );
    const nowIso = new Date(h.clock.t).toISOString();
    [10_000, 20_000, 60_000].forEach((ms, i) => ins.run(i + 1, ms, nowIso));
    // 질문 행은 두 건뿐이라 외래키 검사를 끄고 합성 답 시간만 넣는다
    ov = await (await call("GET", "/api/overview")).json<typeof empty>();
    expect(ov.ask.medianTotalMs7d).toBe(20_000);
    ins.run(4, 100_000, nowIso);
    ov = await (await call("GET", "/api/overview")).json<typeof empty>();
    expect(ov.ask.medianTotalMs7d).toBe(40_000);
  });
});

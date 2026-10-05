import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  rows,
  sessionCall,
  syntheticAnswer,
  workerAnswerBody,
  workerCall,
} from "../test-utils/ask";
import { TEST_PIN, cookieFrom, createHarness, type Harness } from "../test-utils/harness";
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

describe("POST /api/ask/:id/feedback", () => {
  it("도움 여부·메모를 저장하고 상세에 보인다", async () => {
    const id = (await (await ask("합성 질문")).json<{ id: number }>()).id;
    const p = `/api/ask/${String(id)}/feedback`;
    expect((await call("POST", p, { by: "아빠", helpful: true })).status).toBe(201);
    expect((await call("POST", p, { by: "할머니", note: "해 봤어요" })).status).toBe(201);
    const detail = await (
      await call("GET", `/api/ask/${String(id)}`)
    ).json<{
      feedback: { by: string; helpful: boolean | null; note: string | null }[];
    }>();
    expect(detail.feedback.map((f) => [f.by, f.helpful, f.note])).toEqual([
      ["아빠", true, null],
      ["할머니", null, "해 봤어요"],
    ]);
  });

  it("검증: 둘 다 없음·메모 501자·없는 질문", async () => {
    const id = (await (await ask("합성 질문")).json<{ id: number }>()).id;
    const p = `/api/ask/${String(id)}/feedback`;
    expect((await call("POST", p, { by: "아빠" })).status).toBe(422);
    expect((await call("POST", p, { by: "아빠", note: "가".repeat(501) })).status).toBe(422);
    expect((await call("POST", p, { by: "아빠", helpful: false })).status).toBe(201);
    expect(
      (await call("POST", "/api/ask/999/feedback", { by: "아빠", helpful: true })).status,
    ).toBe(404);
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
      };
    }>();
    expect(empty.ask).toEqual({
      pending: 0,
      worker: { online: false, seenAt: null },
      medianTotalMs7d: null,
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

import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { detectRedFlag } from "../../server/ask/redflags.ts";
import type { MockContext, MockModule } from "./index.ts";

/**
 * FAKE 물어보기 API (`npm run dev:mock` / e2e 전용, 합성 자료만: 테스트아이 · 2020-01-15).
 * 질문마다 상태는 세션별 저장소에 둔다(병렬 e2e 가 서로 보지 않게). 시작 자료:
 *   1 완료(단계 5, 가족 표·메모 있음) · 2 완료(단계 1) · 3 완료(위급, 단계 10) · 4 대기 · 5 작성 중 · 6 다시 작성 중(이전 답 1개).
 * 표(PUT /vote)·다시 답변(POST /reask)·이력(history)은 세션별 저장소에서 실제처럼 동작한다(합성 자료).
 * 새 질문은 조회할 때마다 접수 → 작성 중 → 검토 중 → 완료(위급이면 단계 10, 아니면 5)로 넘어간다.
 */
interface Fb {
  id: number;
  by: string;
  note: string;
  createdAt: string;
}
interface Vote {
  by: string;
  helpful: boolean;
  reason: string | null;
  updatedAt: string;
}
interface Old {
  version: number;
  level: number;
  createdAt: string;
}
interface Q {
  id: number;
  askedBy: string;
  body: string;
  createdAt: string;
  redFlag: boolean;
  status: "pending" | "claimed" | "answering" | "reviewing" | "done" | "failed";
  level: number | null;
  polls: number;
  feedback: Fb[];
  votes: Vote[];
  history: Old[];
  reask: { count: number; reason: string | null; by: string | null };
  /** 지금 답이 게시된 시각(다시 답변이면 이전 답보다 늦다). */
  answerAt: string;
  deleted: boolean;
}

const COOKIE = "yj_mock_ask";
const STORES = new Map<string, Q[]>();

function answerFor(level: number, askedBy: string) {
  const reasons: Record<number, string> = {
    1: "이 또래에서 아주 흔한 모습이에요 (합성 예시)",
    5: "방법을 바꿔 보며 1주 적어 봐요 (합성 예시)",
    10: "지금 바로 연락이 필요해요 (합성 예시)",
  };
  return {
    kind: "behavior",
    level,
    levelTitle: "합성 예시",
    levelReason: reasons[level] ?? "합성 예시",
    summary: "테스트아이가 밥 먹을 때 숟가락을 던진다는 질문이에요 (합성 예시)",
    fromRecords: [
      {
        date: "2020-01-14",
        what: "간식 시간에 숟가락을 놓았어요 (합성)",
        link: "던지는 모습과 이어져요",
        source: "알림장",
      },
      {
        date: "2020-01-10",
        what: "식사 중 앉아 있는 시간이 길어졌어요 (합성)",
        link: "앉아 있는 힘이 늘고 있어요",
        source: "관찰",
      },
    ],
    evidence: [{ ref: "SYN-001", point: "이 또래에서 자주 보이는 행동이에요 (합성)", grade: "B" }],
    tryNow: [
      {
        action: "먹는 양보다 앉아 있는 시간을 칭찬해 주세요",
        say: "앉아서 잘 먹고 있네",
        basis: "SYN-001",
      },
      { action: "던지면 조용히 치우고 한 번 더 알려 주세요", basis: "일반 권고" },
    ],
    avoid: ["큰 소리로 혼내기 (합성)"],
    observe: { what: "던지는 횟수", howLong: "1주", how: "하루 한 번 적어 두기" },
    upIf: ["하루 5번 이상 던져요 (합성)"],
    downIf: ["일주일 동안 한 번도 없어요 (합성)"],
    forAsker: `${askedBy}께: 같이 앉아 주는 것만으로도 도움이 돼요 (합성)`,
    limits: "알림장에는 집 밖 모습만 있어요 (합성)",
  };
}

function seed(): Q[] {
  const mk = (
    id: number,
    body: string,
    status: Q["status"],
    level: number | null,
    red = false,
  ): Q => ({
    id,
    askedBy: id % 2 === 0 ? "아빠" : "엄마",
    body,
    createdAt: `2020-01-15T0${String(id)}:00:00.000Z`,
    redFlag: red,
    status,
    level,
    polls: 99,
    feedback: [],
    votes: [],
    history: [],
    reask: { count: 0, reason: null, by: null },
    answerAt: `2020-01-15T0${String(id)}:10:00.000Z`,
    deleted: false,
  });
  const first = mk(1, "밥 먹을 때 자꾸 숟가락을 던져요", "done", 5);
  first.votes = [
    { by: "엄마", helpful: true, reason: null, updatedAt: "2020-01-15T05:00:00.000Z" },
    {
      by: "할머니",
      helpful: false,
      reason: "너무 일반적이에요",
      updatedAt: "2020-01-15T05:30:00.000Z",
    },
  ];
  first.feedback = [
    {
      id: 1,
      by: "엄마",
      note: "안아 주니 금방 그쳤어요 (합성)",
      createdAt: "2020-01-15T06:00:00.000Z",
    },
  ];
  const redo = mk(6, "양치할 때 칫솔을 물고 안 놔요", "answering", null);
  redo.reask = { count: 1, reason: "이미 해 봤어요 · 노래를 불러 줬어요", by: "엄마" };
  redo.history = [{ version: 1, level: 5, createdAt: "2020-01-15T06:10:00.000Z" }];
  return [
    first,
    mk(2, "낮잠 자기 전에 인형을 꼭 안고 있어요", "done", 1),
    mk(3, "자다가 경련을 했어요 (합성 예시)", "done", 10, true),
    mk(4, "친구A 가 오면 숨어요", "pending", null),
    mk(5, "양치를 싫어해요", "answering", null),
    redo,
  ];
}

function storeOf(req: IncomingMessage): { store: Q[]; setCookie?: string } {
  const m = new RegExp(`${COOKIE}=([\\w-]+)`).exec(req.headers.cookie ?? "");
  const known = m?.[1] !== undefined ? STORES.get(m[1]) : undefined;
  if (known) return { store: known };
  const id = m?.[1] ?? randomUUID();
  const store = seed();
  STORES.set(id, store);
  return { store, setCookie: `${COOKIE}=${id}; Path=/; SameSite=Strict` };
}

const INSTANT = {
  notes: [
    { id: 1, date: "2020-01-14", snippet: "간식 시간에 숟가락을 놓았어요 (합성)" },
    { id: 2, date: "2020-01-10", snippet: "점심을 천천히 먹었어요 (합성)" },
  ],
  docs: [{ slug: "guide-01", title: "합성 가이드 예시" }],
};

/** 새 질문은 조회마다 한 단계씩 넘어간다. */
function advance(q: Q): void {
  if (q.polls >= 99) return;
  q.polls += 1;
  if (q.polls === 2) q.status = "answering";
  else if (q.polls === 3) q.status = "reviewing";
  else if (q.polls >= 4) {
    q.status = "done";
    q.level = q.redFlag ? 10 : 5;
  }
}

async function handle(req: IncomingMessage, ctx: MockContext): Promise<void> {
  const { store, setCookie } = storeOf(req);
  const h: Record<string, string> = setCookie ? { "Set-Cookie": setCookie } : {};
  const method = req.method ?? "GET";
  const [idRaw, action] = ctx.subPath.replace(/^\//, "").split("/");
  const live = () => store.filter((q) => !q.deleted);

  if (idRaw === undefined || idRaw === "") {
    if (method === "POST") {
      const b = (await ctx.readJson()) as { body?: unknown; askedBy?: unknown } | undefined;
      if (typeof b?.body !== "string" || b.body.trim() === "" || typeof b.askedBy !== "string") {
        ctx.send(422, { error: "validation_error", message: "입력을 확인해 주세요." }, h);
        return;
      }
      const id = Math.max(0, ...store.map((q) => q.id)) + 1;
      const red = detectRedFlag(b.body).redFlag;
      store.push({
        id,
        askedBy: b.askedBy,
        body: b.body.trim(),
        createdAt: new Date(Date.UTC(2020, 0, 15, 5, 0, 0)).toISOString(),
        redFlag: red,
        status: "pending",
        level: null,
        polls: 0,
        feedback: [],
        votes: [],
        history: [],
        reask: { count: 0, reason: null, by: null },
        answerAt: "2020-01-15T05:10:00.000Z",
        deleted: false,
      });
      ctx.send(201, { id, status: "pending", redFlag: red, instant: INSTANT }, h);
      return;
    }
    if (method === "GET") {
      const items = live()
        .sort((a, b) => b.id - a.id)
        .map((q) => ({
          id: q.id,
          askedBy: q.askedBy,
          bodyPreview: q.body.slice(0, 80),
          status: q.status,
          redFlag: q.redFlag,
          ...(q.level === null ? {} : { level: q.level }),
          createdAt: q.createdAt,
          votes: {
            up: q.votes.filter((v) => v.helpful).length,
            down: q.votes.filter((v) => !v.helpful).length,
          },
        }));
      ctx.send(200, { items, nextBefore: null }, h);
      return;
    }
  } else {
    const q = live().find((x) => x.id === Number(idRaw));
    if (!q) {
      ctx.send(404, { error: "not_found", message: "찾을 수 없어요." }, h);
      return;
    }
    if (action === undefined && method === "GET") {
      advance(q);
      ctx.send(
        200,
        {
          question: { id: q.id, askedBy: q.askedBy, body: q.body, createdAt: q.createdAt },
          status: q.status,
          redFlag: q.redFlag,
          ...(q.status === "done" && q.level !== null
            ? {
                answer: {
                  level: q.level,
                  answer: answerFor(q.level, q.askedBy),
                  createdAt: q.answerAt,
                  totalMs: 150_000,
                },
              }
            : {}),
          feedback: q.feedback,
          votes: q.votes,
          history: q.history.map((o) => ({
            version: o.version,
            level: o.level,
            createdAt: o.createdAt,
            answer: answerFor(o.level, q.askedBy),
          })),
          reask: q.reask,
        },
        h,
      );
      return;
    }
    if (action === "instant" && method === "GET") {
      ctx.send(200, INSTANT, h);
      return;
    }
    if (action === "feedback" && method === "POST") {
      const b = (await ctx.readJson()) as { by?: string; note?: string } | undefined;
      if (typeof b?.note !== "string" || b.note.trim() === "") {
        ctx.send(422, { error: "validation_error", message: "입력을 확인해 주세요." }, h);
        return;
      }
      const id = Math.max(0, ...q.feedback.map((f) => f.id)) + 1;
      q.feedback.push({
        id,
        by: b.by ?? "가족",
        note: b.note.trim(),
        createdAt: "2020-01-15T06:00:00.000Z",
      });
      ctx.send(201, { id }, h);
      return;
    }
    if (action === "vote" && method === "PUT") {
      const b = (await ctx.readJson()) as
        { by?: string; helpful?: boolean | null; reason?: string } | undefined;
      if (typeof b?.by !== "string" || b.helpful === undefined || q.status !== "done") {
        ctx.send(422, { error: "validation_error", message: "입력을 확인해 주세요." }, h);
        return;
      }
      q.votes = q.votes.filter((v) => v.by !== b.by);
      if (b.helpful !== null) {
        q.votes.push({
          by: b.by,
          helpful: b.helpful,
          reason: b.helpful ? null : (b.reason ?? null),
          // 다시 답변 전의 표는 12시, 다시 답변(18시 게시) 뒤의 표는 23시
          updatedAt:
            q.history.length === 0 ? "2020-01-15T12:00:00.000Z" : "2020-01-15T23:00:00.000Z",
        });
      }
      ctx.send(200, { votes: q.votes }, h);
      return;
    }
    if (action === "reask" && method === "POST") {
      const b = (await ctx.readJson()) as
        { by?: string; choice?: string; text?: string } | undefined;
      if (q.status !== "done" || q.level === null || typeof b?.choice !== "string") {
        ctx.send(409, { error: "conflict", message: "지금 상태에서는 할 수 없어요." }, h);
        return;
      }
      if (q.reask.count >= 3) {
        ctx.send(429, { error: "too_many", message: "다시 답변은 세 번까지 받을 수 있어요." }, h);
        return;
      }
      q.history.push({ version: q.history.length + 1, level: q.level, createdAt: q.answerAt });
      q.reask = {
        count: q.reask.count + 1,
        reason: b.text ? `${b.choice} · ${b.text}` : b.choice,
        by: b.by ?? "가족",
      };
      q.status = "pending";
      q.level = null;
      q.polls = 0;
      q.answerAt = "2020-01-15T18:00:00.000Z";
      ctx.send(200, { status: "pending", reaskCount: q.reask.count }, h);
      return;
    }
    if (action === undefined && method === "DELETE") {
      q.deleted = true;
      ctx.send(204, undefined, h);
      return;
    }
  }
  ctx.send(404, { error: "not_found", message: "찾을 수 없어요." }, h);
}

export const askModule: MockModule = {
  prefix: "/api/ask",
  handle: (req, _res, ctx) => handle(req, ctx),
};

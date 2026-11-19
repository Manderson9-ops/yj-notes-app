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
 *
 * T-Q5 대화(CONTRACT §3-1 모양): 상세에 turns·workerOnline·threadActive·redLock·cardUpdates·turnsUsed·originQuestionId 를 싣는다.
 * POST /turn(이어서 묻기)·POST /reask(새 뜻: 질문은 done 으로 남고 reask 턴만 생긴다)가 상태 있는 시나리오로 돈다:
 *   질문 → 답 카드 → 이어서 묻기 → 짧은 답 → 다시 묻기(카드 갱신 → 새 버전) → 짧은 답.
 * 턴은 상세를 조회할 때마다 한 단계씩 넘어간다: 짧은 답 만드는 중 → 짧은 답(카드가 필요하면 카드 정리 중) → 카드 새 버전.
 * 본문에 「심해」가 있으면 카드 갱신이 필요하다고 답한다(단계 +2). 다시 묻기(reask)는 카드를 새로 만든다(단계 -1).
 * 목록에는 나오지 않고 주소로만 여는 대화 변형 질문(합성): 7 대화 예시(카드 3번 갱신 · 한도 안내) · 8 후속 10번 한도 ·
 *   9 위급 후속 카드 실패 · 10 집 PC 꺼짐(활성 턴) · 11 카드 정리 중(멈춤).
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
type CardStatus = "none" | "pending" | "done" | "failed";
interface Turn {
  id: number;
  seq: number;
  kind: "followup" | "reask";
  askedBy: string;
  body: string;
  reaskReason: string | null;
  redFlag: boolean;
  status: "pending" | "claimed" | "answering" | "reviewing" | "done" | "failed";
  reply: unknown;
  cardStatus: CardStatus;
  cardNote: "limit" | "redlock" | null;
  cardVersion: number | null;
  createdAt: string;
  repliedAt: string | null;
  /** 조회로 넘어간 단계 수. frozen 이면 더 넘어가지 않는다(입력 잠금·오프라인 장면을 붙잡아 둔다). */
  step: number;
  frozen: boolean;
  /** 짧은 답이 끝나면 카드를 새로 만드는가. */
  cardWanted: boolean;
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
  turns: Turn[];
  /** 집 PC 켜짐(false 면 앱이 「집 PC가 켜지면 답변해요」를 보인다). */
  workerOnline: boolean;
  redLock: boolean;
  /** 실제로 갱신된 카드 수(한도 3). */
  cardUsed: number;
  origin: number | null;
  /** false 면 목록에 나오지 않는다(주소로만 연다). */
  listed: boolean;
}

const CARD_MAX = 3;
const TURN_MAX = 10;
const ACTIVE = ["pending", "claimed", "answering", "reviewing"];
const isActive = (t: Turn): boolean =>
  ACTIVE.includes(t.status) || (t.status === "done" && t.cardStatus === "pending");
const turnsUsed = (q: Q): number => q.turns.filter((t) => !t.redFlag).length;

const COOKIE = "yj_mock_ask";

function seedBlank(id: number, body: string, askedBy: string): Q {
  return {
    id,
    askedBy,
    body,
    createdAt: new Date(Date.UTC(2020, 0, 15, 5, 0, 0)).toISOString(),
    redFlag: false,
    status: "pending",
    level: null,
    polls: 0,
    feedback: [],
    votes: [],
    history: [],
    reask: { count: 0, reason: null, by: null },
    answerAt: "2020-01-15T05:10:00.000Z",
    deleted: false,
    turns: [],
    workerOnline: true,
    redLock: false,
    cardUsed: 0,
    origin: null,
    listed: true,
  };
}
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
    createdAt: `2020-01-15T${String(id).padStart(2, "0")}:00:00.000Z`,
    redFlag: red,
    status,
    level,
    polls: 99,
    feedback: [],
    votes: [],
    history: [],
    reask: { count: 0, reason: null, by: null },
    answerAt: `2020-01-15T${String(id).padStart(2, "0")}:10:00.000Z`,
    deleted: false,
    turns: [],
    workerOnline: true,
    redLock: red,
    cardUsed: 0,
    origin: null,
    listed: true,
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
  redo.cardUsed = 1; // 서버 이행: card_updates = reask_count
  return [
    first,
    mk(2, "낮잠 자기 전에 인형을 꼭 안고 있어요", "done", 1),
    mk(3, "자다가 경련을 했어요 (합성 예시)", "done", 10, true),
    mk(4, "친구A 가 오면 숨어요", "pending", null),
    mk(5, "양치를 싫어해요", "answering", null),
    redo,
    ...conversationSeeds(mk),
  ];
}

/** 시각을 2020-01-15 안의 분 단위로(합성). */
const at = (min: number): string =>
  new Date(Date.UTC(2020, 0, 15, 7, 0, 0) + min * 60_000).toISOString();

function replyFor(body: string, cardWanted: boolean) {
  return {
    reply: `「${body.slice(0, 20)}」에 대한 짧은 답이에요 (합성 예시)`,
    say: "지금은 같이 앉아 있어요",
    fromRecords: [
      {
        date: "2020-01-14",
        what: "간식 시간에 숟가락을 놓았어요 (합성)",
        link: "질문과 이어져요",
        source: "알림장",
      },
    ],
    evidence: [],
    cardUpdate: { needed: cardWanted, reason: cardWanted ? "단계를 다시 살펴요 (합성 예시)" : "" },
    limits: "알림장에는 집 밖 모습만 있어요 (합성)",
  };
}

function turnOf(q: Q, init: Partial<Turn> & Pick<Turn, "kind" | "askedBy" | "body">): Turn {
  const seq = Math.max(0, ...q.turns.map((t) => t.seq)) + 1;
  return {
    id: Math.max(0, ...q.turns.map((t) => t.id)) + 1,
    seq,
    reaskReason: null,
    redFlag: false,
    status: "pending",
    reply: null,
    cardStatus: "none",
    cardNote: null,
    cardVersion: null,
    createdAt: at(seq * 5),
    repliedAt: null,
    step: 0,
    frozen: false,
    cardWanted: false,
    ...init,
  };
}

/** 이미 끝난 턴(합성). */
function doneTurn(q: Q, init: Partial<Turn> & Pick<Turn, "kind" | "askedBy" | "body">): Turn {
  const t = turnOf(q, { status: "done", step: 9, ...init });
  if (t.kind === "followup" && !t.redFlag && t.reply === null)
    t.reply = replyFor(t.body, t.cardWanted);
  t.repliedAt = at(t.seq * 5 + 1);
  return t;
}

const addDone = (q: Q, init: Parameters<typeof doneTurn>[1]): void => {
  q.turns.push(doneTurn(q, init));
};
const addTurn = (q: Q, init: Parameters<typeof turnOf>[1]): void => {
  q.turns.push(turnOf(q, init));
};

type Mk = (id: number, body: string, status: Q["status"], level: number | null, red?: boolean) => Q;
function conversationSeeds(mk: Mk): Q[] {
  // 7 대화 예시: 카드 4개(이력 3개)·카드 갱신 3번(한도)·짧은 답에서 한도 안내
  const talk = mk(7, "식사 시간에 자꾸 자리에서 일어나요", "done", 5);
  talk.listed = false;
  talk.history = [
    { version: 1, level: 5, createdAt: at(1) },
    { version: 2, level: 7, createdAt: at(11) },
    { version: 3, level: 6, createdAt: at(21) },
  ];
  talk.answerAt = at(31);
  talk.cardUsed = 3;
  talk.reask = { count: 2, reason: "너무 일반적이에요", by: "할머니" };
  addDone(talk, { kind: "followup", askedBy: "엄마", body: "밤에도 같은 방법을 써도 될까요?" });
  addDone(talk, {
    kind: "followup",
    askedBy: "아빠",
    body: "요즘 더 심해져서 걱정돼요",
    cardWanted: true,
    cardStatus: "done",
    cardVersion: 2,
  });
  addDone(talk, {
    kind: "reask",
    askedBy: "할머니",
    body: "",
    reaskReason: "너무 일반적이에요",
    cardStatus: "done",
    cardVersion: 3,
  });
  addDone(talk, {
    kind: "reask",
    askedBy: "엄마",
    body: "우리 집은 다르게 해요",
    reaskReason: "우리 상황과 달라요 · 우리 집은 다르게 해요",
    cardStatus: "done",
    cardVersion: 4,
  });
  addDone(talk, {
    kind: "followup",
    askedBy: "아빠",
    body: "또 심해 보이면 어떻게 하나요?",
    cardWanted: true,
    cardNote: "limit",
  });
  // 8 후속 10번 한도
  const full = mk(8, "양치할 때 자꾸 도망가요", "done", 5);
  full.listed = false;
  for (let i = 0; i < TURN_MAX; i++)
    addDone(full, {
      kind: "followup",
      askedBy: i % 2 === 0 ? "엄마" : "아빠",
      body: `이어서 묻기 예시 ${String(i + 1)}번`,
    });
  // 9 위급 후속의 카드 실패: 이전 카드 위에 경고 고정
  const redFail = mk(9, "낮잠 시간에 자꾸 깨서 울어요", "done", 4);
  redFail.listed = false;
  redFail.redLock = true;
  addDone(redFail, { kind: "followup", askedBy: "엄마", body: "열이 조금 있는 것 같아요" });
  addDone(redFail, {
    kind: "followup",
    askedBy: "엄마",
    body: "숨을 쉬지 않아요 (합성 예시)",
    redFlag: true,
    cardStatus: "failed",
  });
  // 10 집 PC 꺼짐 + 활성 턴(멈춤)
  const off = mk(10, "손톱을 자꾸 물어요", "done", 3);
  off.listed = false;
  off.workerOnline = false;
  addTurn(off, { kind: "followup", askedBy: "엄마", body: "병원에 가 봐야 할까요?", frozen: true });
  // 11 카드 정리 중(멈춤): 짧은 답은 보였고 카드는 다시 정리하는 중
  const busy = mk(11, "장난감을 던져요", "done", 5);
  busy.listed = false;
  addDone(busy, {
    kind: "followup",
    askedBy: "아빠",
    body: "더 심해져서 걱정돼요",
    cardWanted: true,
    cardStatus: "pending",
    frozen: true,
  });
  return [talk, full, redFail, off, busy];
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
    q.polls = 99; // 끝났으면 더 넘기지 않는다(대화 중 카드 단계가 조회마다 5 로 돌아가지 않게)
  }
}

/** 카드를 새 버전으로: 지금 카드를 이력으로 옮기고 단계를 바꾼다(followup 카드 갱신 +2, 다시 답변 -1). */
function publishCard(q: Q, t: Turn): void {
  const prev = q.level ?? 5;
  q.history.push({ version: q.history.length + 1, level: prev, createdAt: q.answerAt });
  q.level = t.kind === "reask" ? Math.max(1, prev - 1) : Math.min(10, prev + 2);
  if (t.redFlag) q.level = 10;
  q.answerAt = "2020-01-15T18:00:00.000Z";
  t.cardStatus = "done";
  t.cardVersion = q.history.length + 1;
  if (!t.redFlag) q.cardUsed += 1;
}

/** 조회마다 턴을 한 단계씩 넘긴다(frozen 은 붙잡아 둔다). */
function advanceTurns(q: Q): void {
  for (const t of q.turns) {
    if (t.frozen || !isActive(t)) continue;
    t.step += 1;
    if (t.status !== "done") {
      // 짧은 답 단계: 1 작성 중 → 2 짧은 답(카드가 필요하면 카드 정리 중)
      if (t.step === 1) t.status = "answering";
      else {
        t.status = "done";
        t.repliedAt = "2020-01-15T07:30:00.000Z";
        t.reply = replyFor(t.body, t.cardWanted);
        if (t.cardWanted && q.cardUsed < CARD_MAX && !(q.redLock || q.redFlag)) {
          t.cardStatus = "pending";
        } else if (t.cardWanted) {
          t.cardNote = q.cardUsed >= CARD_MAX ? "limit" : "redlock";
        }
      }
    } else if (t.cardStatus === "pending" && t.step >= 2) {
      publishCard(q, t);
    }
  }
}

function serializeTurn(t: Turn) {
  return {
    id: t.id,
    seq: t.seq,
    kind: t.kind,
    askedBy: t.askedBy,
    body: t.body,
    reaskReason: t.reaskReason,
    redFlag: t.redFlag,
    status: t.status,
    reply: t.reply,
    reviewScore: t.status === "done" && t.kind === "followup" ? 9.6 : null,
    cardStatus: t.cardStatus,
    cardNote: t.cardNote,
    cardVersion: t.cardVersion,
    createdAt: t.createdAt,
    repliedAt: t.repliedAt,
  };
}

const RED_NEW_Q_BODY_LIMIT = 1000;

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
        turns: [],
        workerOnline: true,
        redLock: red,
        cardUsed: 0,
        origin: null,
        listed: true,
      });
      ctx.send(201, { id, status: "pending", redFlag: red, instant: INSTANT }, h);
      return;
    }
    if (method === "GET") {
      const items = live()
        .filter((q) => q.listed)
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
      if (q.status === "done") advanceTurns(q);
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
          workerOnline: q.workerOnline,
          threadActive: q.turns.some(isActive),
          redLock: q.redLock || q.redFlag,
          cardUpdates: { used: q.cardUsed, max: CARD_MAX },
          turnsUsed: turnsUsed(q),
          originQuestionId: q.origin,
          turns: [...q.turns].sort((a, b) => a.seq - b.seq).map(serializeTurn),
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
    if ((action === "turn" || action === "reask") && method === "POST") {
      const b = (await ctx.readJson()) as
        | { body?: unknown; askedBy?: unknown; by?: unknown; choice?: unknown; text?: unknown }
        | undefined;
      const isReask = action === "reask";
      const by = isReask ? b?.by : b?.askedBy;
      const text = isReask ? b?.text : b?.body;
      const body = typeof text === "string" ? text.trim() : "";
      if (
        typeof by !== "string" ||
        by.trim() === "" ||
        body.length > RED_NEW_Q_BODY_LIMIT ||
        (isReask ? typeof b?.choice !== "string" : body === "")
      ) {
        ctx.send(422, { error: "validation_error", message: "입력을 확인해 주세요." }, h);
        return;
      }
      // 위급 판정이 먼저(한도·잠금·진행 중 턴을 건너뛴다). reask 의 자유 글도 판정한다.
      const red = detectRedFlag(body).redFlag;
      if (red && q.status !== "done") {
        const id = Math.max(0, ...store.map((x) => x.id)) + 1;
        store.push({
          ...seedBlank(id, body, by),
          redFlag: true,
          redLock: true,
          origin: q.id,
        });
        ctx.send(201, { newQuestionId: id, redFlag: true }, h);
        return;
      }
      if (q.status !== "done") {
        ctx.send(409, { error: "question_busy", message: "답이 나온 뒤에 할 수 있어요." }, h);
        return;
      }
      if (red) {
        // 위급 후속: 한도·진행 중 턴 무시, 잠금을 켜고 대기 중인 일반 카드 작업을 정리한다.
        q.redLock = true;
        for (const t of q.turns)
          if (!t.redFlag && t.cardStatus === "pending") {
            t.cardStatus = "none";
            t.cardNote = "redlock";
          }
        const t = turnOf(q, {
          kind: "followup",
          askedBy: by,
          body,
          redFlag: true,
          status: "done",
          cardStatus: "pending",
        });
        q.turns.push(t);
        ctx.send(201, { id: t.id, seq: t.seq, redFlag: true }, h);
        return;
      }
      if (q.turns.some(isActive)) {
        ctx.send(409, { error: "turn_active", message: "진행 중인 턴이 있어요." }, h);
        return;
      }
      if (isReask && (q.redLock || q.redFlag)) {
        ctx.send(
          422,
          { error: "validation_error", code: "redflag_level", message: "위급 질문이에요." },
          h,
        );
        return;
      }
      if (turnsUsed(q) >= TURN_MAX) {
        ctx.send(429, { error: "turn_limit", message: "이어서 묻기는 10번까지예요." }, h);
        return;
      }
      if (isReask && q.cardUsed >= CARD_MAX) {
        ctx.send(429, { error: "card_limit", message: "카드는 3번까지 다시 만들 수 있어요." }, h);
        return;
      }
      if (isReask) {
        const choice = typeof b?.choice === "string" ? b.choice : "";
        const reason = body === "" ? choice : `${choice} · ${body}`;
        const t = turnOf(q, {
          kind: "reask",
          askedBy: by,
          body,
          reaskReason: reason,
          status: "done",
          cardStatus: "pending",
        });
        q.turns.push(t);
        q.reask = { count: q.reask.count + 1, reason, by };
        ctx.send(200, { status: "done", reaskCount: q.reask.count, id: t.id, seq: t.seq }, h);
        return;
      }
      const t = turnOf(q, {
        kind: "followup",
        askedBy: by,
        body,
        cardWanted: body.includes("심해"),
      });
      q.turns.push(t);
      ctx.send(201, { id: t.id, seq: t.seq, redFlag: false }, h);
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

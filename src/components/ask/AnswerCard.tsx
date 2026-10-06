// font-subset: skip (본문 글만: 장식 글꼴 대상이 아니다 — tools/fonts/collect.ts)
import type { ReactNode } from "react";
import { GENERAL_BASIS, type Answer } from "../../../shared/ask-schema";
import { LevelBadge } from "./LevelBadge";

/**
 * 답변 카드(S30·S91). 순서: 단계 배지 → 이유 → 요약 → 기록에서 본 것 → 근거 → 지금 해 볼 것(할 말 예시 강조)
 * → 피할 것 → 관찰 방법 → 올라가는/내려가는 신호 → 질문자 한 줄 → 한계. 판정 문구 없음(P1).
 * 본문 글은 서버가 검증한 답변 JSON 이다. 화면 고정 문구는 모두 짧게 나눠 둔다(G7).
 */
/** 품질 검사 기준(워커 목표 점수와 같다). 이보다 낮게 게시된 답에는 참고용 안내를 붙인다. */
export const ASK_QUALITY_TARGET = 9.5;

export function AnswerCard({
  level,
  answer,
  reviewScore,
  afterSummary,
}: {
  level: number;
  answer: Answer;
  reviewScore?: number | null | undefined;
  /** 상황 요약 바로 아래에 끼워 넣는 것(공유하기 버튼). */
  afterSummary?: ReactNode;
}) {
  if (answer.kind === "not_behavior") {
    // 행동 질문이 아닌 글: 단계 배지·기록·근거 없이 요약과 안내 한 줄만 보인다.
    return (
      <article className="card ask-answer" aria-label="답변" data-kind="not_behavior">
        <p>{answer.summary}</p>
        <p className="meta ask-guidance" data-testid="ask-guidance">
          {answer.levelReason}
        </p>
      </article>
    );
  }
  const observe = answer.observe;
  return (
    <article className="card ask-answer" aria-label="답변">
      <LevelBadge level={level} />
      {typeof reviewScore === "number" && reviewScore < ASK_QUALITY_TARGET ? (
        <p className="meta ask-lowq" data-testid="ask-lowq">
          품질 검사 기준보다 낮아 참고용이에요
        </p>
      ) : null}
      <p className="ask-reason">{answer.levelReason}</p>

      <h3>상황 요약</h3>
      <p>{answer.summary}</p>
      {afterSummary}

      {answer.fromRecords.length > 0 && (
        <>
          <h3>기록에서 본 것</h3>
          <ul className="ask-list">
            {answer.fromRecords.map((r, i) => (
              <li key={`${r.date}-${String(i)}`}>
                <span className="meta">
                  {r.date} · {r.source}
                </span>
                <br />
                {r.what}
                <br />
                <span className="meta ask-link">{r.link}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>근거</h3>
      <ul className="ask-list">
        {answer.evidence.map((e, i) => (
          <li key={`${e.ref}-${String(i)}`}>
            {e.point}
            <br />
            <span className="meta">
              {e.ref}
              {e.grade ? ` · 등급 ${e.grade}` : ""}
            </span>
          </li>
        ))}
      </ul>

      <h3>지금 해 볼 것</h3>
      <ol className="ask-list ask-steps-list">
        {answer.tryNow.map((t, i) => (
          <li key={String(i)}>
            {t.action}
            {t.basis === GENERAL_BASIS ? (
              <span className="meta ask-general" data-testid="ask-general">
                {" "}
                일반 권고
              </span>
            ) : null}
            {t.say ? <q className="ask-say">{t.say}</q> : null}
          </li>
        ))}
      </ol>

      <h3>피할 것</h3>
      <ul className="ask-list">
        {answer.avoid.map((a, i) => (
          <li key={String(i)}>{a}</li>
        ))}
      </ul>

      {observe ? (
        <>
          <h3>관찰 방법</h3>
          <dl className="kv">
            <dt>무엇을</dt>
            <dd>{observe.what}</dd>
            <dt>얼마나</dt>
            <dd>{observe.howLong}</dd>
            <dt>어떻게</dt>
            <dd>{observe.how}</dd>
          </dl>
        </>
      ) : null}

      <h3>단계가 올라가는 신호</h3>
      <ul className="ask-list">
        {answer.upIf.map((u, i) => (
          <li key={String(i)}>{u}</li>
        ))}
      </ul>

      <h3>단계가 내려가는 신호</h3>
      <ul className="ask-list">
        {answer.downIf.map((d, i) => (
          <li key={String(i)}>{d}</li>
        ))}
      </ul>

      {answer.forAsker ? (
        <>
          <h3>질문하신 분께</h3>
          <p>{answer.forAsker}</p>
        </>
      ) : null}

      {answer.limits ? (
        <>
          <h3>한계</h3>
          <p className="meta">{answer.limits}</p>
        </>
      ) : null}
    </article>
  );
}

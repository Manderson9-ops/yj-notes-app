import { useState } from "react";
import { Link } from "react-router-dom";
import { AnswerCard } from "../components/ask/AnswerCard";
import { LevelBadge } from "../components/ask/LevelBadge";
import { RedFlagCard } from "../components/ask/RedFlagCard";
import { Chip } from "../components/Chip";
import { Notice } from "../components/Notice";
import { ThemeDecor } from "../components/decor/ThemeDecor";
import { SchemePicker } from "../components/SchemePicker";
import { TextSettings } from "../components/TextSettings";
import { ThemePicker } from "../components/ThemePicker";
import "../styles/ask.css";
import { previewAnswer } from "./previewAnswer";

// S91 디자인 미리보기. 합성 자료만 쓴다: 이름은 테스트아이·교사A·친구A, 날짜는 2020-01-15 근처.
// 화면에 보이는 숫자는 시안임을 "예시"로 표시한다(P3: 실제 화면의 숫자는 API 값).

const CHOICES = ["많이", "보통", "조금", "안 먹음", "잘 모름"] as const;
const PERIODS = ["최근 1달", "최근 3달", "전체"] as const;

export function DesignPreview() {
  const [choice, setChoice] = useState<(typeof CHOICES)[number]>("보통");
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("최근 1달");

  return (
    <>
      <h1>디자인 미리보기</h1>
      <p className="muted">테마를 고르면 시안이 바뀝니다. 모두 예시예요.</p>
      <ThemePicker />
      <p>
        <strong>화면 밝기</strong>
      </p>
      <SchemePicker />
      <p>
        <strong>글자·선명도</strong>
      </p>
      <TextSettings />

      <section aria-labelledby="pv-home">
        <h2 id="pv-home">홈</h2>
        <button type="button" className="btn-primary btn-lg">
          오늘 기록하기
        </button>
        <div className="card-stack">
          <article className="card">
            <p className="meta">2020-01-15 · 예시</p>
            <p>
              <strong>테스트아이</strong> 오늘의 알림장 요약 (예시 문장)
            </p>
            <span className="badge">새 글 2건 (예시)</span>
          </article>
          <article className="card">
            <dl className="kv">
              <dt>마지막 동기화</dt>
              <dd>2020-01-15 09:00 (예시)</dd>
            </dl>
          </article>
        </div>
      </section>

      <section aria-labelledby="pv-log">
        <h2 id="pv-log">기록 입력</h2>
        <article className="card">
          <p>
            <strong>식사량</strong> · 점심 (예시 질문)
          </p>
          <div className="chip-row">
            {CHOICES.map((c) => (
              <Chip
                key={c}
                pressed={choice === c}
                onPress={() => {
                  setChoice(c);
                }}
              >
                {c}
              </Chip>
            ))}
          </div>
        </article>
      </section>

      <section aria-labelledby="pv-notes">
        <h2 id="pv-notes">알림장 검색</h2>
        <label className="sr-only" htmlFor="pv-search">
          검색어
        </label>
        <input id="pv-search" className="field" type="search" placeholder="검색어 (예시)" />
        <div className="chip-row">
          {PERIODS.map((p) => (
            <Chip
              key={p}
              pressed={period === p}
              onPress={() => {
                setPeriod(p);
              }}
            >
              {p}
            </Chip>
          ))}
        </div>
        <div className="card">
          <div className="list-row">
            <span>
              <span className="meta">2020-01-15</span>
              <br />
              <mark>간식</mark>을 친구A 와 나눠 먹었어요 (예시)
            </span>
          </div>
          <div className="list-row">
            <span>
              <span className="meta">2020-01-14</span>
              <br />
              교사A 와 <mark>간식</mark> 시간을 가졌어요 (예시)
            </span>
          </div>
          <div className="list-row">
            <span>
              <span className="meta">2020-01-13</span>
              <br />
              <mark>간식</mark> 뒤에 산책을 했어요 (예시)
            </span>
          </div>
        </div>
      </section>

      <section aria-labelledby="pv-lib">
        <h2 id="pv-lib">자료</h2>
        <div className="card-stack">
          <article className="card">
            <p>
              <strong>예시 보고서</strong>
            </p>
            <p className="meta">만든 날 2020-01-15</p>
            <span className="badge">확인함 (예시)</span>
          </article>
          <Link to="/settings" className="card">
            <p>
              <strong>예시 가이드</strong>
            </p>
            <p className="meta">만든 날 2020-01-10 (누르면 열려요)</p>
            <span className="badge">예시</span>
          </Link>
        </div>
      </section>

      <section aria-labelledby="pv-ask">
        <h2 id="pv-ask">물어보기</h2>
        <div className="card-stack">
          <div className="chip-row">
            {[1, 5, 10].map((n) => (
              <LevelBadge key={n} level={n} />
            ))}
          </div>
          <RedFlagCard />
          <AnswerCard level={1} answer={previewAnswer(1, "아주 흔한 모습이에요 (예시)")} />
          <AnswerCard
            level={5}
            answer={previewAnswer(5, "방법을 바꿔 보며 1주 적어 봐요 (예시)")}
          />
          <AnswerCard level={10} answer={previewAnswer(10, "지금 바로 연락이 필요해요 (예시)")} />
        </div>
      </section>

      <section aria-labelledby="pv-notice">
        <h2 id="pv-notice">안내 상자</h2>
        <div className="card-stack">
          <Notice tone="info">안내 상자 예시예요.</Notice>
          <Notice tone="ok">저장했어요 (예시)</Notice>
          <Notice tone="warn">확인이 필요해요 (예시)</Notice>
          <Notice tone="alert">연결이 안 돼요 (예시)</Notice>
        </div>
      </section>

      <section aria-labelledby="pv-checkup">
        <h2 id="pv-checkup">검진</h2>
        <article className="card" data-tone="serious">
          <p>
            <strong>검진 카드</strong> <span className="badge">예시</span>
          </p>
          <dl className="kv">
            <dt>검사일</dt>
            <dd>2020-01-15 (예시)</dd>
            <dt>항목 값</dt>
            <dd>예시 값</dd>
          </dl>
          <p className="muted">결과지 문구는 원문 그대로 보여 줘요.</p>
        </article>
      </section>

      <section aria-labelledby="pv-empty">
        <h2 id="pv-empty">빈 상태</h2>
        <div className="empty">
          <ThemeDecor slot="empty" />
          <p>아직 기록이 없어요 (예시)</p>
        </div>
      </section>

      <section aria-labelledby="pv-btn">
        <h2 id="pv-btn">버튼과 배지</h2>
        <div className="chip-row">
          <button type="button" className="btn-primary">
            주 버튼
          </button>
          <button type="button" className="btn">
            보조 버튼
          </button>
          <button type="button" className="btn" disabled>
            꺼진 버튼
          </button>
        </div>
        <div className="row-center">
          <span className="badge">배지</span>
          <Link className="link" to="/settings">
            설정으로 가기
          </Link>
        </div>
      </section>
    </>
  );
}

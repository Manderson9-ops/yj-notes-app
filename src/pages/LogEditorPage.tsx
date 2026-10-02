import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, useParams } from "react-router-dom";
import { Chip } from "../components/Chip";
import { LogTypeIcon } from "../components/LogTypeIcon";
import { Notice } from "../components/Notice";
import { ApiError, api } from "../lib/api";
import { useLogTypes } from "../lib/logs/hooks";
import { formatDate, formatValue, guideHref, todayKst, addDays } from "../lib/logs/format";
import {
  RECORDERS,
  deviceId,
  getDefaultRecorder,
  setDefaultRecorder,
  uuidv7,
} from "../lib/logs/ids";
import { getPending, loadQueue, submitLog, type SendOutcome } from "../lib/logs/queue";
import {
  logOneSchema,
  type Answers,
  type LogField,
  type LogItem,
  type LogType,
} from "../lib/logs/schemas";

interface Initial {
  id: string;
  type: string;
  occurredOn: string;
  recorder: string;
  answers: Answers;
  note: string;
}

type Step =
  | { kind: "type" }
  | { kind: "q"; index: number }
  | { kind: "review" }
  | { kind: "done"; outcome: SendOutcome };

function toAnswers(payload: Record<string, unknown>): Answers {
  const out: Answers = {};
  for (const [k, v] of Object.entries(payload)) {
    if ((typeof v === "string" && v !== "") || typeof v === "number") out[k] = v;
  }
  return out;
}

function fromItem(item: LogItem): Initial {
  return {
    id: item.id,
    type: item.type,
    occurredOn: item.occurredOn,
    recorder: item.recorder,
    answers: toAnswers(item.payload),
    note: item.note ?? "",
  };
}

async function loadInitial(id: string): Promise<Initial> {
  try {
    return fromItem((await api("GET", `/logs/${id}`, { schema: logOneSchema })).item);
  } catch (e) {
    // 아직 서버에 못 보낸 기록은 이 기기 대기열에 있다.
    if (e instanceof ApiError && (e.status === 404 || e.status === 0)) {
      await loadQueue();
      const p = getPending(id);
      if (p) {
        return {
          id,
          type: p.body.type,
          occurredOn: p.body.occurredOn,
          recorder: p.body.recorder,
          answers: toAnswers(p.body.payload),
          note: p.body.note ?? "",
        };
      }
    }
    throw e;
  }
}

/** S20 기록 입력·수정 (docs/06 §3 저녁 식사 흐름). 질문은 한 화면에 하나, 고르면 자동으로 다음. */
export function LogEditorPage() {
  const { id } = useParams();
  const types = useLogTypes();
  const initial = useQuery({
    queryKey: ["logs", "edit", id],
    enabled: id !== undefined,
    gcTime: 0,
    queryFn: () => loadInitial(id ?? ""),
  });

  const editing = id !== undefined;
  const title = editing ? "기록 고치기" : "기록하기";
  if (types.isPending || (editing && initial.isPending)) {
    return (
      <>
        <h1>{title}</h1>
        <p className="loading" role="status">
          불러오는 중
        </p>
      </>
    );
  }
  if (types.isError || (editing && initial.isError)) {
    const missing =
      initial.isError && initial.error instanceof ApiError && initial.error.status === 404;
    return (
      <>
        <h1>{title}</h1>
        <Notice tone="warn">
          {missing
            ? "기록을 찾지 못했어요. 목록에서 다시 골라 주세요."
            : "불러오지 못했어요. 연결을 확인하고 다시 해 주세요."}
        </Notice>
        <div className="actions">
          <Link className="btn" to="/logs">
            기록 목록
          </Link>
          {!missing && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                void types.refetch();
                void initial.refetch();
              }}
            >
              다시 해 보기
            </button>
          )}
        </div>
      </>
    );
  }
  return (
    <EditorForm
      key={initial.data?.id ?? "new"}
      title={title}
      types={types.data}
      {...(initial.data ? { initial: initial.data } : {})}
    />
  );
}

function EditorForm({
  title,
  types,
  initial,
}: {
  title: string;
  types: LogType[];
  initial?: Initial;
}) {
  const editing = initial !== undefined;
  const [id, setId] = useState(() => initial?.id ?? uuidv7());
  const [typeCode, setTypeCode] = useState<string | null>(initial?.type ?? null);
  const [answers, setAnswers] = useState<Answers>(initial?.answers ?? {});
  const [date, setDate] = useState(initial?.occurredOn ?? todayKst());
  const [recorder, setRecorder] = useState(initial?.recorder ?? getDefaultRecorder() ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [step, setStep] = useState<Step>(editing ? { kind: "review" } : { kind: "type" });
  const [fromReview, setFromReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);

  const type = types.find((t) => t.code === typeCode);
  const fields = type?.schema.fields ?? [];
  const today = todayKst();
  const stepKey = step.kind === "q" ? `q${String(step.index)}` : step.kind;

  // 화면이 바뀌면 제목으로 포커스를 옮긴다(키보드·스크린리더 사용자가 새 화면의 처음에서 시작).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [stepKey]);

  const goReviewOrNext = (index: number) => {
    if (fromReview || index + 1 >= fields.length) {
      setFromReview(false);
      setStep({ kind: "review" });
    } else {
      setStep({ kind: "q", index: index + 1 });
    }
  };
  const answer = (index: number, key: string, value: string | number) => {
    setAnswers((a) => ({ ...a, [key]: value }));
    goReviewOrNext(index);
  };
  const skip = (index: number, key: string) => {
    setAnswers((a) => Object.fromEntries(Object.entries(a).filter(([k]) => k !== key)));
    goReviewOrNext(index);
  };
  const back = (index: number) => {
    if (fromReview) {
      setFromReview(false);
      setStep({ kind: "review" });
    } else if (index > 0) {
      setStep({ kind: "q", index: index - 1 });
    } else if (!editing) {
      setStep({ kind: "type" });
    } else {
      setStep({ kind: "review" });
    }
  };

  const save = async () => {
    if (!type) return;
    const missing = fields.findIndex((f) => f.required && answers[f.key] === undefined);
    if (missing >= 0) {
      setStep({ kind: "q", index: missing });
      return;
    }
    if (recorder === "") return;
    setSaving(true);
    setErrors({});
    setFailure("");
    try {
      const payload: Record<string, unknown> = {};
      for (const f of fields) {
        const v = answers[f.key];
        if (v !== undefined) payload[f.key] = v;
      }
      const outcome = await submitLog(id, {
        type: type.code,
        occurredOn: date,
        recorder,
        payload,
        note: note.trim() === "" ? null : note.trim(),
        deviceId: deviceId(),
      });
      setDefaultRecorder(recorder);
      setStep({ kind: "done", outcome });
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        setErrors(e.fields ?? {});
        setFailure("입력을 확인해 주세요.");
      } else {
        setFailure("저장하지 못했어요. 잠시 후 다시 해 주세요.");
      }
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setId(uuidv7());
    setTypeCode(null);
    setAnswers({});
    setDate(todayKst());
    setNote("");
    setErrors({});
    setFailure("");
    setFromReview(false);
    setStep({ kind: "type" });
  };

  // ---- 화면들 ----
  if (step.kind === "type") {
    return (
      <>
        <h1>{title}</h1>
        <h2 ref={headingRef} tabIndex={-1}>
          무엇을 기록할까요?
        </h2>
        <div className="chip-grid" data-cols="1">
          {types.map((t) => (
            <Chip
              key={t.code}
              size="lg"
              pressed={typeCode === t.code}
              onPress={() => {
                setTypeCode(t.code);
                setAnswers({});
                setStep({ kind: "q", index: 0 });
              }}
            >
              <LogTypeIcon code={t.code} />
              {t.label}
            </Chip>
          ))}
        </div>
        <div className="actions">
          <Link className="btn" to="/logs">
            취소
          </Link>
        </div>
      </>
    );
  }

  if (step.kind === "q" && type) {
    const f = fields[step.index];
    if (f) {
      const prev = fromReview ? "돌아가기" : "이전";
      return (
        <>
          <h1>{title}</h1>
          <p className="step-meta">
            {type.label} · 질문 {step.index + 1} / {fields.length}
          </p>
          <Question
            key={f.key}
            field={f}
            value={answers[f.key]}
            headingRef={headingRef}
            onAnswer={(v) => {
              answer(step.index, f.key, v);
            }}
            onSkip={() => {
              skip(step.index, f.key);
            }}
          />
          <div className="actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                back(step.index);
              }}
            >
              {prev}
            </button>
          </div>
        </>
      );
    }
  }

  if (step.kind === "done") {
    return (
      <Done
        editing={editing}
        outcome={step.outcome}
        today={today}
        headingRef={headingRef}
        onAnother={reset}
      />
    );
  }

  // review
  const dateIsOther = date !== today && date !== addDays(today, -1);
  const fieldErrors = Object.entries(errors);
  return (
    <>
      <h1>{title}</h1>
      <h2 ref={headingRef} tabIndex={-1}>
        {type?.label ?? ""} 확인
      </h2>
      <ul className="review-list">
        {fields.map((f, i) => (
          <li key={f.key}>
            <button
              type="button"
              className="review-row"
              aria-label={`${f.label_ko} ${formatValue(f, answers[f.key])} 고치기`}
              onClick={() => {
                setFromReview(true);
                setStep({ kind: "q", index: i });
              }}
            >
              <span>{f.label_ko}</span>
              <span className="review-value">{formatValue(f, answers[f.key])}</span>
            </button>
          </li>
        ))}
      </ul>

      <h3 id="d-date">날짜</h3>
      <div className="chip-row" role="group" aria-labelledby="d-date">
        <Chip
          pressed={date === today}
          onPress={() => {
            setDate(today);
          }}
        >
          오늘
        </Chip>
        <Chip
          pressed={date === addDays(today, -1)}
          onPress={() => {
            setDate(addDays(today, -1));
          }}
        >
          어제
        </Chip>
      </div>
      <p className="field-row">
        <label htmlFor="log-date">다른 날</label>
        <input
          id="log-date"
          type="date"
          className="field"
          max={today}
          value={date}
          aria-describedby="log-date-text"
          onChange={(e) => {
            if (e.target.value !== "") setDate(e.target.value);
          }}
        />
      </p>
      <p id="log-date-text" className="meta" data-other={dateIsOther ? "1" : undefined}>
        {formatDate(date)}
      </p>

      <h3 id="d-rec">기록한 사람</h3>
      <div className="chip-row" role="group" aria-labelledby="d-rec">
        {RECORDERS.map((r) => (
          <Chip
            key={r}
            pressed={recorder === r}
            onPress={() => {
              setRecorder(r);
            }}
          >
            {r}
          </Chip>
        ))}
      </div>

      <h3>
        <label htmlFor="log-note">메모 (선택)</label>
      </h3>
      <textarea
        id="log-note"
        className="field field-area"
        maxLength={500}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
        }}
      />

      {failure !== "" && (
        <div role="alert">
          <Notice tone="alert">
            {failure}
            {fieldErrors.length > 0 && ` ${fieldErrors.map(([, v]) => v).join(" ")}`}
          </Notice>
        </div>
      )}
      {recorder === "" && <p className="meta">기록한 사람을 골라 주세요.</p>}
      <div className="actions">
        <button
          type="button"
          className="btn-primary btn-lg"
          disabled={saving || recorder === ""}
          onClick={() => {
            void save();
          }}
        >
          {saving ? "저장하는 중" : "저장"}
        </button>
      </div>
      <div className="actions">
        {!editing && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setStep({ kind: "q", index: Math.max(0, fields.length - 1) });
            }}
          >
            이전
          </button>
        )}
        <Link className="btn" to="/logs">
          취소
        </Link>
      </div>
    </>
  );
}

function presetsOf(f: Extract<LogField, { type: "int" }>): number[] {
  if (f.presets) return f.presets;
  if (f.max - f.min <= 10) return Array.from({ length: f.max - f.min + 1 }, (_, i) => f.min + i);
  return [f.min];
}

function Question({
  field,
  value,
  headingRef,
  onAnswer,
  onSkip,
}: {
  field: LogField;
  value: string | number | undefined;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onAnswer: (v: string | number) => void;
  onSkip: () => void;
}) {
  const heading = (
    <h2 ref={headingRef} tabIndex={-1}>
      {field.label_ko}
    </h2>
  );
  if (field.type === "enum") {
    return (
      <>
        {heading}
        <div className="chip-grid" role="group" aria-label={field.label_ko}>
          {field.options.map((o) => (
            <Chip
              key={o}
              size="lg"
              pressed={value === o}
              onPress={() => {
                onAnswer(o);
              }}
            >
              {o}
            </Chip>
          ))}
        </div>
      </>
    );
  }
  if (field.type === "int") {
    return <IntQuestion field={field} value={value} heading={heading} onAnswer={onAnswer} />;
  }
  return (
    <TextQuestion
      field={field}
      value={value}
      heading={heading}
      onAnswer={onAnswer}
      onSkip={onSkip}
    />
  );
}

function IntQuestion({
  field,
  value,
  heading,
  onAnswer,
}: {
  field: Extract<LogField, { type: "int" }>;
  value: string | number | undefined;
  heading: ReactNode;
  onAnswer: (v: number) => void;
}) {
  const presets = presetsOf(field);
  const isCustomValue = typeof value === "number" && !presets.includes(value);
  const [custom, setCustom] = useState(isCustomValue);
  const [text, setText] = useState(isCustomValue ? String(value) : "");
  const [error, setError] = useState("");
  const unit = field.unit ?? "";
  const submit = () => {
    const n = Number(text);
    if (text.trim() === "" || !Number.isInteger(n) || n < field.min || n > field.max) {
      setError(`${String(field.min)}부터 ${String(field.max)} 사이 숫자를 적어 주세요.`);
      return;
    }
    onAnswer(n);
  };
  return (
    <>
      {heading}
      <div className="chip-grid" role="group" aria-label={field.label_ko}>
        {presets.map((p) => (
          <Chip
            key={p}
            size="lg"
            pressed={value === p}
            onPress={() => {
              onAnswer(p);
            }}
          >
            {`${String(p)}${unit}`}
          </Chip>
        ))}
        <Chip
          size="lg"
          pressed={custom}
          onPress={() => {
            setCustom(true);
          }}
        >
          직접
        </Chip>
      </div>
      {custom && (
        <form
          className="field-row"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor="q-int">직접 입력{unit !== "" ? ` (${unit})` : ""}</label>
          <input
            id="q-int"
            className="field"
            type="number"
            inputMode="numeric"
            min={field.min}
            max={field.max}
            value={text}
            aria-describedby={error !== "" ? "q-int-err" : undefined}
            aria-invalid={error !== ""}
            onChange={(e) => {
              setText(e.target.value);
              setError("");
            }}
          />
          {error !== "" && (
            <p id="q-int-err" role="alert" className="field-error">
              {error}
            </p>
          )}
          <button type="submit" className="btn-primary">
            다음
          </button>
        </form>
      )}
    </>
  );
}

function TextQuestion({
  field,
  value,
  heading,
  onAnswer,
  onSkip,
}: {
  field: Extract<LogField, { type: "text" }>;
  value: string | number | undefined;
  heading: ReactNode;
  onAnswer: (v: string) => void;
  onSkip: () => void;
}) {
  const [text, setText] = useState(typeof value === "string" ? value : "");
  return (
    <>
      {heading}
      <form
        className="field-row"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() !== "") onAnswer(text.trim());
          else if (!field.required) onSkip();
        }}
      >
        <label htmlFor="q-text">
          {field.label_ko}
          {field.required ? "" : " (선택)"}
        </label>
        <input
          id="q-text"
          className="field"
          type="text"
          maxLength={field.max ?? 200}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
        <div className="actions">
          <button
            type="submit"
            className="btn-primary"
            disabled={field.required && text.trim() === ""}
          >
            다음
          </button>
          {!field.required && (
            <button type="button" className="btn" onClick={onSkip}>
              건너뛰기
            </button>
          )}
        </div>
      </form>
    </>
  );
}

function Done({
  editing,
  outcome,
  today,
  headingRef,
  onAnother,
}: {
  editing: boolean;
  outcome: SendOutcome;
  today: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onAnother: () => void;
}) {
  const sent = outcome.state === "sent" ? outcome.result : null;
  let fact = "";
  if (sent) {
    const inThisWeek = sent.week.start <= today && today <= sent.week.end;
    const n = String(sent.week.count);
    if (inThisWeek) fact = editing ? `이번 주 기록 ${n}건` : `이번 주 ${n}번째 기록`;
    else fact = `${formatDate(sent.week.start, false)}부터 한 주 기록 ${n}건`;
  }
  return (
    <>
      <h1>{editing ? "기록 고치기" : "기록하기"}</h1>
      <h2 ref={headingRef} tabIndex={-1}>
        {sent ? (editing ? "고쳤어요" : "저장했어요") : "기기에 저장했어요"}
      </h2>
      <div role="status">
        {sent ? (
          <p>{fact}</p>
        ) : (
          <Notice tone="info">연결되면 자동으로 보내요. 목록에는 그때 보여요.</Notice>
        )}
      </div>
      {sent?.alerts.map((a) => (
        <Notice key={a.field} tone="warn">
          {a.message}{" "}
          <Link className="link" to={guideHref(a.guide)}>
            도움 받을 때 기준 보기
          </Link>
        </Notice>
      ))}
      <div className="actions">
        <Link className="btn-primary" to="/logs">
          기록 목록
        </Link>
        {!editing && (
          <button type="button" className="btn" onClick={onAnother}>
            하나 더 기록하기
          </button>
        )}
      </div>
    </>
  );
}

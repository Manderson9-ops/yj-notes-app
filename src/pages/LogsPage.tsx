import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Chip } from "../components/Chip";
import { ThemeDecor } from "../components/decor/ThemeDecor";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Notice } from "../components/Notice";
import { ApiError } from "../lib/api";
import { useDeleteLog, useLogList, useLogSummary, useLogTypes } from "../lib/logs/hooks";
import {
  addDays,
  formatDate,
  formatDateShort,
  formatMonthDay,
  guideHref,
  summarizePayload,
  todayKst,
} from "../lib/logs/format";
import { discardFailed, listFailed, useQueueCounts } from "../lib/logs/queue";
import type { FieldStat, LogItem, LogType, LogsSummary } from "../lib/logs/schemas";

const PAGE = 30;
const RANGES = [
  { id: "2w", label: "최근 2주", days: 13 },
  { id: "4w", label: "최근 4주", days: 27 },
  { id: "all", label: "전체", days: null },
] as const;

/** S21 기록 목록·요약: 경고 목록, 주차 비교, 교차표, 최근 기록. 숫자는 전부 서버가 센 값이다(P3). */
export function LogsPage() {
  const types = useLogTypes();
  const [typeCode, setTypeCode] = useState<string | null>(null);
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("2w");
  const [limit, setLimit] = useState(PAGE);
  const today = todayKst();
  const days = RANGES.find((r) => r.id === range)?.days ?? null;
  const from = days === null ? null : addDays(today, -days);

  const list = useLogList(typeCode, limit);
  const summary = useLogSummary(typeCode, from);
  // 경고는 종류와 상관없이 모아서 보여 준다.
  const alertSummary = useLogSummary(null, from);

  const typeList = types.data ?? [];
  const typeOf = (code: string) => typeList.find((t) => t.code === code);
  const failed = listFailed();
  const { pending } = useQueueCounts();

  return (
    <>
      <h1>기록</h1>
      <Link className="btn-primary btn-lg" to="/logs/new">
        기록하기
      </Link>

      {pending > 0 && (
        <Notice tone="info">
          아직 보내지 못한 기록 {pending}건이 있어요. 연결되면 자동으로 보내요.
        </Notice>
      )}
      {failed.length > 0 && (
        <section aria-labelledby="lg-failed" className="card-stack">
          <h2 id="lg-failed">보내지 못한 기록</h2>
          {failed.map((f) => (
            <div key={f.id} className="card">
              <p>
                {typeOf(f.body.type)?.label ?? f.body.type} · {formatDateShort(f.body.occurredOn)}
              </p>
              <p className="meta">서버가 받지 않았어요. 지우고 다시 기록해 주세요.</p>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void discardFailed(f.id);
                }}
              >
                지우기
              </button>
            </div>
          ))}
        </section>
      )}

      <div className="chip-row" role="group" aria-label="기록 종류">
        <Chip
          pressed={typeCode === null}
          onPress={() => {
            setTypeCode(null);
            setLimit(PAGE);
          }}
        >
          전체
        </Chip>
        {typeList.map((t) => (
          <Chip
            key={t.code}
            pressed={typeCode === t.code}
            onPress={() => {
              setTypeCode(t.code);
              setLimit(PAGE);
            }}
          >
            {t.label}
          </Chip>
        ))}
      </div>
      <div className="chip-row" role="group" aria-label="기간">
        {RANGES.map((r) => (
          <Chip
            key={r.id}
            pressed={range === r.id}
            onPress={() => {
              setRange(r.id);
            }}
          >
            {r.label}
          </Chip>
        ))}
      </div>

      <AlertsSection summary={alertSummary.data} loading={alertSummary.isPending} typeOf={typeOf} />
      <WeeksSection
        type={typeCode === null ? undefined : typeOf(typeCode)}
        summary={summary.data}
        loading={summary.isPending}
        failed={summary.isError}
      />

      <section aria-labelledby="lg-recent">
        <h2 id="lg-recent">최근 기록</h2>
        {list.isPending && (
          <p className="loading" role="status">
            불러오는 중
          </p>
        )}
        {list.isError && (
          <Notice tone="warn">
            {list.error instanceof ApiError && list.error.status === 0
              ? "연결이 안 돼요. 연결되면 다시 열어 주세요."
              : "기록을 불러오지 못했어요. 잠시 후 다시 해 주세요."}
          </Notice>
        )}
        {list.data?.items.length === 0 && (
          <div className="empty">
            <ThemeDecor slot="empty" variant="logs" />
            <p>
              {typeCode === null ? "아직 기록이 없어요." : "이 종류의 기록이 아직 없어요."} 위의
              기록하기 버튼으로 시작해 보세요.
            </p>
          </div>
        )}
        {list.data && list.data.items.length > 0 && (
          <div className="card-stack">
            {list.data.items.map((item) => (
              <LogCard key={item.id} item={item} type={typeOf(item.type)} today={today} />
            ))}
          </div>
        )}
        {list.data && list.data.items.length >= limit && (
          <div className="actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setLimit((l) => l + PAGE);
              }}
            >
              더 보기
            </button>
          </div>
        )}
      </section>
    </>
  );
}

function AlertsSection({
  summary,
  loading,
  typeOf,
}: {
  summary: LogsSummary | undefined;
  loading: boolean;
  typeOf: (code: string) => LogType | undefined;
}) {
  if (loading || !summary || summary.alerts.length === 0) return null;
  return (
    <section aria-labelledby="lg-alerts">
      <h2 id="lg-alerts">도움 받을 때 기준에 해당한 기록 {summary.alertCount}건</h2>
      <div className="card-stack">
        {summary.alerts.map((a) => (
          <div key={`${a.logId}-${a.field}`} className="card">
            <p className="meta">
              {typeOf(a.type)?.label ?? a.type} · {formatDate(a.occurredOn)}
            </p>
            <p>{a.message}</p>
            <Link className="link" to={guideHref(a.guide)}>
              도움 받을 때 기준 보기
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}

/** 좁은 화면에서 가로로 스크롤되는 표 틀. 키보드로도 스크롤할 수 있게 포커스를 받는다(axe scrollable-region-focusable). */
function ScrollRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- 스크롤 영역은 키보드 접근이 필요하다
    <div className="log-table-wrap" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

function statLines(stat: FieldStat | undefined, unit: string): string[] {
  if (!stat) return ["-"];
  if (stat.kind === "int") {
    return stat.n === 0 || stat.avg === null || stat.max === null
      ? ["-"]
      : [`평균 ${String(stat.avg)}${unit}`, `최대 ${String(stat.max)}${unit}`];
  }
  const parts = Object.entries(stat.counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${String(n)}`);
  return parts.length === 0 ? ["-"] : parts;
}

function WeeksSection({
  type,
  summary,
  loading,
  failed,
}: {
  type: LogType | undefined;
  summary: LogsSummary | undefined;
  loading: boolean;
  failed: boolean;
}) {
  if (type === undefined) {
    return <p className="meta">종류를 고르면 주차 비교와 교차표가 보여요.</p>;
  }
  if (loading) {
    return (
      <p className="loading" role="status">
        불러오는 중
      </p>
    );
  }
  if (failed || !summary) {
    return <Notice tone="warn">요약을 불러오지 못했어요. 잠시 후 다시 해 주세요.</Notice>;
  }
  if (summary.weeks.length === 0 || summary.total === 0) {
    return (
      <section aria-labelledby="lg-weeks">
        <h2 id="lg-weeks">주차 비교</h2>
        <div className="empty">
          <p>기록이 없어요. 기간을 전체로 바꿔 보세요.</p>
        </div>
      </section>
    );
  }
  const keys =
    type.schema.summary?.highlight ??
    type.schema.fields.filter((f) => f.type !== "text").map((f) => f.key);
  const fields = keys
    .map((k) => type.schema.fields.find((f) => f.key === k))
    .filter((f): f is NonNullable<typeof f> => f !== undefined);
  return (
    <>
      <section aria-labelledby="lg-weeks">
        <h2 id="lg-weeks">주차 비교</h2>
        <ScrollRegion label={`${type.label} 주차 비교 표`}>
          <table className="log-table" data-kind="weeks">
            <caption className="sr-only">{type.label} 주차별 기록</caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">항목</span>
                </th>
                {summary.weeks.map((w) => (
                  <th key={w.index} scope="col">
                    {w.index}주차
                    <span className="meta">
                      {" "}
                      {formatMonthDay(w.start)}~{formatMonthDay(w.end)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">기록 수</th>
                {summary.weeks.map((w) => (
                  <td key={w.index}>{w.count}건</td>
                ))}
              </tr>
              {fields.map((f) => (
                <tr key={f.key}>
                  <th scope="row">{f.label_ko}</th>
                  {summary.weeks.map((w) => (
                    <td key={w.index}>
                      {statLines(w.fields[f.key], f.type === "int" ? (f.unit ?? "") : "").map(
                        (line) => (
                          <span key={line} className="cell-line">
                            {line}
                          </span>
                        ),
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      </section>
      {summary.crosstabs.map((x) => (
        <section key={`${x.rows}-${x.cols}`} aria-labelledby="lg-cross">
          <h2 id="lg-cross">
            {x.rowLabel} × {x.colLabel}
          </h2>
          <ScrollRegion label={`${x.rowLabel}별 ${x.colLabel} 표`}>
            <table className="log-table">
              <caption className="sr-only">
                {x.rowLabel}별 {x.colLabel} 기록 수
              </caption>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">{x.rowLabel}</span>
                  </th>
                  {x.colOptions.map((c) => (
                    <th key={c} scope="col">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {x.rowOptions.map((r, ri) => (
                  <tr key={r}>
                    <th scope="row">{r}</th>
                    {x.colOptions.map((c, ci) => (
                      <td key={c}>{String(x.cells[ri]?.[ci] ?? 0)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        </section>
      ))}
    </>
  );
}

function LogCard({
  item,
  type,
  today,
}: {
  item: LogItem;
  type: LogType | undefined;
  today: string;
}) {
  const [asking, setAsking] = useState(false);
  const del = useDeleteLog();
  const summaryText = type ? summarizePayload(type, item.payload) : "";
  const memo = item.note ?? "";
  const failed = del.isError;
  return (
    <article className="card log-card">
      <p className="log-card-head">
        <span className="badge">{type?.label ?? item.type}</span>
        <span>{formatDateShort(item.occurredOn, today)}</span>
        <span className="meta">{item.recorder}</span>
      </p>
      {summaryText !== "" && <p>{summaryText}</p>}
      {memo !== "" && <p className="meta">메모: {memo}</p>}
      <div className="actions">
        <Link
          className="btn"
          to={`/logs/${item.id}/edit`}
          aria-label={`${formatDate(item.occurredOn)} 기록 고치기`}
        >
          고치기
        </Link>
        <button
          type="button"
          className="btn"
          aria-label={`${formatDate(item.occurredOn)} 기록 지우기`}
          onClick={() => {
            setAsking(true);
          }}
        >
          지우기
        </button>
      </div>
      {asking && (
        <ConfirmDialog
          open
          title="이 기록을 지울까요?"
          confirmLabel="지우기"
          busy={del.isPending}
          onCancel={() => {
            setAsking(false);
            del.reset();
          }}
          onConfirm={() => {
            del.mutate(item.id, {
              onSuccess: () => {
                setAsking(false);
              },
            });
          }}
        >
          <p>
            {type?.label ?? item.type} · {formatDate(item.occurredOn)}
          </p>
          {summaryText !== "" && <p>{summaryText}</p>}
          <p className="meta">지운 기록은 목록과 요약에서 빠져요.</p>
          {failed && <p role="alert">지우지 못했어요. 연결을 확인하고 다시 해 주세요.</p>}
        </ConfirmDialog>
      )}
    </article>
  );
}

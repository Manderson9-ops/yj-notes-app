// S41 문서 보기: 마크다운은 안전 렌더 + 목차(h2) 점프, HTML 은 sandbox iframe 으로 /raw 를 연다.
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import "./library.css";
import { findHeadingId } from "./anchor";
import { useReportMeta, useReportRaw, useReports } from "./api";
import { stripInlineMarks } from "../../lib/docSummary";
import { displayTitles, formatKoDate } from "./format";
import { LoadError } from "./LoadError";
import { VerifyBadge } from "./VerifyBadge";
import { Markdown } from "./Markdown";
import { parseMarkdown, type Block } from "./mdParse";

/** 긴 글에서 이만큼 내려오면 「맨 위로」 단추를 보인다(px). */
const BACK_TOP_AFTER = 900;

function BackToTop() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      setShown(window.scrollY > BACK_TOP_AFTER);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, []);
  if (!shown) return null;
  return (
    <div className="back-top">
      <button
        type="button"
        className="btn"
        onClick={() => {
          window.scrollTo({ top: 0 });
          document.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
        }}
      >
        ↑ 맨 위로
      </button>
    </div>
  );
}

/** 목차는 큰 제목(##) 중심. 작은 제목(###)은 그 절에 열 개 이하일 때만 아래에 붙인다(논문 목록 같은 긴 나열은 뺀다). */
const TOC_SUB_MAX = 10;
interface TocItem {
  id: string;
  text: string;
  sub: boolean;
}
function tocOf(blocks: readonly Block[]): TocItem[] {
  const out: TocItem[] = [];
  let subs: TocItem[] = [];
  const flush = () => {
    if (subs.length > 0 && subs.length <= TOC_SUB_MAX) out.push(...subs);
    subs = [];
  };
  for (const b of blocks) {
    if (b.t !== "h") continue;
    const item = { id: b.id, text: stripInlineMarks(b.text), sub: b.level >= 3 };
    if (b.level <= 2) {
      flush();
      out.push(item);
    } else {
      subs.push(item);
    }
  }
  flush();
  return out;
}

function jumpTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ block: "start" });
  el.focus({ preventScroll: true });
}

export default function DocPage() {
  const { slug = "" } = useParams();
  const meta = useReportMeta(slug);
  const isMd = meta.data?.kind === "markdown";
  const raw = useReportRaw(slug, isMd);
  const reports = useReports();
  const titles = useMemo(() => displayTitles(reports.data?.items ?? []), [reports.data]);
  const title = titles.get(slug) ?? meta.data?.title ?? "";
  // `NN-이름.md` 같은 폴더 문서 링크는 같은 묶음의 `<묶음>-NN` 문서로 잇는다(목록에 있을 때만).
  const docHref = useMemo(() => {
    const prefix = slug.split(/[-_]/)[0] ?? "";
    const known = new Set(reports.data?.items.map((d) => d.slug) ?? []);
    return (file: string): string | null => {
      const n = /^(\d+)/.exec(file)?.[1];
      const target = n === undefined ? "" : `${prefix}-${n.padStart(2, "0")}`;
      return known.has(target) ? `/library/doc/${target}` : null;
    };
  }, [slug, reports.data]);

  const blocks = useMemo<Block[]>(() => {
    if (!raw.data) return [];
    const all = parseMarkdown(raw.data);
    // 맨 앞 `# 제목` 이 쪽 제목과 같으면 한 번만 보이게 뺀다.
    const first = all[0];
    return first?.t === "h" &&
      first.level === 1 &&
      (first.text === meta.data?.title || first.text === title)
      ? all.slice(1)
      : all;
  }, [raw.data, meta.data?.title, title]);
  const toc = useMemo(() => tocOf(blocks), [blocks]);

  // `#3-1` 처럼 절을 가리키는 주소(가족 기록 경고의 가이드 링크): 그 제목으로 이동. 없으면 처음부터 보여 주고 안내.
  const { hash } = useLocation();
  const anchorId = useMemo(() => (hash ? findHeadingId(blocks, hash) : null), [blocks, hash]);
  const anchorMissing = hash !== "" && blocks.length > 0 && anchorId === null;
  useEffect(() => {
    if (anchorId) jumpTo(anchorId);
  }, [anchorId]);

  return (
    <>
      <Link to="/library" className="link">
        ← 자료
      </Link>
      {meta.isPending ? (
        <p className="loading" role="status">
          불러오는 중
        </p>
      ) : meta.isError ? (
        <LoadError error={meta.error} onRetry={() => void meta.refetch()} />
      ) : (
        <>
          <h1 tabIndex={-1}>{title}</h1>
          <div className="row-center">
            <span className="meta">{formatKoDate(meta.data.generatedAt)}</span>
            <VerifyBadge doc={meta.data} />
          </div>

          {meta.data.kind === "html" ? (
            <>
              <p className="meta doc-note">이 문서는 보호된 창 안에서 열려요.</p>
              <p className="doc-note">
                <a
                  className="link"
                  href={`/api/reports/${encodeURIComponent(meta.data.slug)}/raw`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  크게 보기
                  <span className="sr-only"> (새 창)</span>
                </a>
              </p>
              <iframe
                title={title}
                src={`/api/reports/${encodeURIComponent(meta.data.slug)}/raw`}
                sandbox="allow-scripts"
                className="doc-frame"
              />
            </>
          ) : raw.isPending ? (
            <p className="loading" role="status">
              불러오는 중
            </p>
          ) : raw.isError ? (
            <LoadError error={raw.error} onRetry={() => void raw.refetch()} />
          ) : (
            <>
              {anchorMissing ? (
                <p className="meta doc-note" role="status">
                  가리킨 절이 없어요. 처음부터 보여요.
                </p>
              ) : null}
              {toc.length >= 2 ? (
                <details className="doc-toc">
                  <summary>목차 ({toc.length})</summary>
                  <ol>
                    {toc.map((b) => (
                      <li key={b.id} className={b.sub ? "doc-toc-sub" : undefined}>
                        <button
                          type="button"
                          className="toc-btn"
                          onClick={() => {
                            jumpTo(b.id);
                          }}
                        >
                          {b.text}
                        </button>
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
              <article className="doc-body">
                <Markdown blocks={blocks} docHref={docHref} />
              </article>
              <BackToTop />
            </>
          )}
        </>
      )}
    </>
  );
}

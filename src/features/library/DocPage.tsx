// S41 문서 보기: 마크다운은 안전 렌더 + 목차(h2) 점프, HTML 은 sandbox iframe 으로 /raw 를 연다.
import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import "./library.css";
import { useReportMeta, useReportRaw } from "./api";
import { formatKoDate } from "./format";
import { LoadError } from "./LoadError";
import { VerifyBadge } from "./VerifyBadge";
import { Markdown } from "./Markdown";
import { parseMarkdown, type Block } from "./mdParse";

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

  const blocks = useMemo<Block[]>(() => {
    if (!raw.data) return [];
    const all = parseMarkdown(raw.data);
    // 맨 앞 `# 제목` 이 쪽 제목과 같으면 한 번만 보이게 뺀다.
    const first = all[0];
    return first?.t === "h" && first.level === 1 && first.text === meta.data?.title
      ? all.slice(1)
      : all;
  }, [raw.data, meta.data?.title]);
  const toc = blocks.filter((b) => b.t === "h" && b.level <= 2);

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
          <h1>{meta.data.title}</h1>
          <div className="row-center">
            <span className="meta">{formatKoDate(meta.data.generatedAt)}</span>
            <VerifyBadge doc={meta.data} />
          </div>

          {meta.data.kind === "html" ? (
            <>
              <p className="meta doc-note">이 문서는 보호된 창 안에서 열려요.</p>
              <iframe
                title={meta.data.title}
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
              {toc.length >= 2 ? (
                <details className="doc-toc">
                  <summary>목차 ({toc.length})</summary>
                  <ol>
                    {toc.map((b) =>
                      b.t === "h" ? (
                        <li key={b.id}>
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
                      ) : null,
                    )}
                  </ol>
                </details>
              ) : null}
              <article className="doc-body">
                <Markdown blocks={blocks} />
              </article>
            </>
          )}
        </>
      )}
    </>
  );
}

import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { parseInline, type Block, type Inline, type ListBlock } from "./mdParse";
import { ScrollRegion } from "./ScrollRegion";

/** 문서 안 `NN-이름.md` 링크를 앱 안 주소로 바꾼다. 못 찾으면 null(글자로만 보인다). */
export type DocHref = (file: string) => string | null;

function Nodes({ nodes, docHref }: { nodes: Inline[]; docHref?: DocHref | undefined }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case "code":
            return <code key={i}>{n.text}</code>;
          case "br":
            return <br key={i} />;
          case "strong":
            return (
              <strong key={i}>
                <Nodes nodes={n.children} docHref={docHref} />
              </strong>
            );
          case "em":
            return (
              <em key={i}>
                <Nodes nodes={n.children} docHref={docHref} />
              </em>
            );
          case "del":
            return (
              <del key={i}>
                <Nodes nodes={n.children} docHref={docHref} />
              </del>
            );
          case "link":
            return (
              <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" className="link">
                <Nodes nodes={n.children} docHref={docHref} />
                <span className="sr-only"> (새 창)</span>
              </a>
            );
          case "doc": {
            const to = docHref?.(n.file) ?? null;
            return to ? (
              <Link key={i} to={to} className="link">
                <Nodes nodes={n.children} docHref={docHref} />
              </Link>
            ) : (
              <Nodes key={i} nodes={n.children} docHref={docHref} />
            );
          }
          default:
            return <Fragment key={i}>{n.text}</Fragment>;
        }
      })}
    </>
  );
}

function Inlines({ text, docHref }: { text: string; docHref?: DocHref | undefined }) {
  return <Nodes nodes={parseInline(text)} docHref={docHref} />;
}

function List({ b, docHref }: { b: ListBlock; docHref?: DocHref | undefined }) {
  const Tag = b.t;
  return (
    <Tag {...(b.t === "ol" && b.start !== 1 ? { start: b.start } : {})}>
      {b.items.map((it, j) => (
        <li key={j} className={it.check === null ? undefined : "md-task"}>
          {it.check === null ? null : (
            <>
              <span className="md-box" aria-hidden="true">
                {it.check ? "☑" : "☐"}
              </span>
              <span className="sr-only">{it.check ? "완료: " : "아직: "}</span>
            </>
          )}
          <Inlines text={it.text} docHref={docHref} />
          {it.sub.map((s, k) => (
            <List key={k} b={s} docHref={docHref} />
          ))}
        </li>
      ))}
    </Tag>
  );
}

/**
 * 열이 셋 이상인 표는 좁은 화면에서 가로로 밀어 읽어야 해서 칸이 잘린다.
 * 그래서 줄마다 「첫 칸 = 제목, 나머지 = 머리글: 값」 으로 쌓아 보인다(스크롤 없이 전부 읽힌다).
 */
const STACK_FROM_COLUMNS = 3;

function Table({
  head,
  rows,
  docHref,
}: {
  head: string[];
  rows: string[][];
  docHref?: DocHref | undefined;
}) {
  if (head.length >= STACK_FROM_COLUMNS) {
    return (
      <ul className="md-rows">
        {rows.map((r, j) => (
          <li key={j} className="md-row">
            <strong className="md-row-title">
              <Inlines text={r[0] ?? ""} docHref={docHref} />
            </strong>
            <dl className="md-row-cells">
              {head.slice(1).map((h, k) => {
                const cell = r[k + 1] ?? "";
                return cell === "" ? null : (
                  <Fragment key={k}>
                    <dt>
                      <Inlines text={h} docHref={docHref} />
                    </dt>
                    <dd>
                      <Inlines text={cell} docHref={docHref} />
                    </dd>
                  </Fragment>
                );
              })}
            </dl>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ScrollRegion label="표">
      <table className="data-table">
        <thead>
          <tr>
            {head.map((c, j) => (
              <th key={j} scope="col">
                <Inlines text={c} docHref={docHref} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, j) => (
            <tr key={j}>
              {r.map((c, k) => (
                <td key={k}>
                  <Inlines text={c} docHref={docHref} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

/** 마크다운 `#` 는 쪽 제목(h1)과 겹치지 않게 h2 로, 나머지는 한 단계씩 아래로 그린다. */
export function Markdown({
  blocks,
  docHref,
}: {
  blocks: Block[];
  docHref?: DocHref | undefined;
}): ReactNode {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "h": {
            const Tag = (b.level === 1 ? "h2" : `h${String(b.level)}`) as "h2" | "h3" | "h4";
            return (
              <Tag key={i} id={b.id} tabIndex={-1} className="md-heading">
                <Inlines text={b.text} docHref={docHref} />
              </Tag>
            );
          }
          case "p":
            return (
              <p key={i}>
                <Inlines text={b.text} docHref={docHref} />
              </p>
            );
          case "ul":
          case "ol":
            return <List key={i} b={b} docHref={docHref} />;
          case "quote":
            return (
              <blockquote key={i}>
                {b.paras.map((p, j) => (
                  <p key={j}>
                    <Inlines text={p} docHref={docHref} />
                  </p>
                ))}
              </blockquote>
            );
          case "code":
            return (
              <ScrollRegion key={i} label="코드">
                <pre>
                  <code>{b.text}</code>
                </pre>
              </ScrollRegion>
            );
          case "hr":
            return <hr key={i} />;
          case "table":
            return <Table key={i} head={b.head} rows={b.rows} docHref={docHref} />;
          case "details":
            return (
              <details key={i} className="md-details">
                <summary>
                  <Inlines text={b.summary} docHref={docHref} />
                </summary>
                <div className="md-details-body">
                  <Markdown blocks={b.blocks} docHref={docHref} />
                </div>
              </details>
            );
        }
      })}
    </>
  );
}

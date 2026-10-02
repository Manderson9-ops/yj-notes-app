import { Fragment, type ReactNode } from "react";
import { parseInline, type Block } from "./mdParse";
import { ScrollRegion } from "./ScrollRegion";

function Inlines({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((n, i) => {
        switch (n.t) {
          case "code":
            return <code key={i}>{n.text}</code>;
          case "strong":
            return <strong key={i}>{n.text}</strong>;
          case "em":
            return <em key={i}>{n.text}</em>;
          case "link":
            return (
              <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" className="link">
                {n.text}
                <span className="sr-only"> (새 창)</span>
              </a>
            );
          default:
            return <Fragment key={i}>{n.text}</Fragment>;
        }
      })}
    </>
  );
}

/** 마크다운 `#` 는 쪽 제목(h1)과 겹치지 않게 h2 로, 나머지는 한 단계씩 아래로 그린다. */
export function Markdown({ blocks }: { blocks: Block[] }): ReactNode {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "h": {
            const Tag = (b.level === 1 ? "h2" : `h${String(b.level)}`) as "h2" | "h3" | "h4";
            return (
              <Tag key={i} id={b.id} tabIndex={-1} className="md-heading">
                <Inlines text={b.text} />
              </Tag>
            );
          }
          case "p":
            return (
              <p key={i}>
                <Inlines text={b.text} />
              </p>
            );
          case "ul":
          case "ol": {
            const List = b.t;
            return (
              <List key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inlines text={it} />
                  </li>
                ))}
              </List>
            );
          }
          case "quote":
            return (
              <blockquote key={i}>
                <Inlines text={b.text} />
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
            return (
              <ScrollRegion key={i} label="표">
                <table className="data-table">
                  <thead>
                    <tr>
                      {b.head.map((c, j) => (
                        <th key={j} scope="col">
                          <Inlines text={c} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {r.map((c, k) => (
                          <td key={k}>
                            <Inlines text={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
            );
        }
      })}
    </>
  );
}

"""D1 백업(.sql)에서 '앱에만 있는' 표의 INSERT 만 뽑는다 (관리자 PC 전용, docs/09 R-04·O-06).

배경(2026-10-05 복구 연습): `wrangler d1 export` 는 report_doc 본문을 한 문장으로 써서
`wrangler d1 execute --file` 로 되넣으면 SQLITE_TOOBIG(문장 100KB 초과)으로 실패한다.
그러나 알림장·관측·문서·검진 표는 DATA_DIR 에서 `ingest upload` 로 언제든 다시 만들 수 있다.
되살려야 하는 것은 앱에서만 생기는 표(가족 기록·이력·설정)뿐이고, 그 행은 작다.

사용:
  python tools/admin/backup-extract.py <백업.sql> <출력.sql>
  -> 출력 파일을 `npx wrangler d1 execute DB --local|--remote --file <출력.sql>` 로 적용.
출력은 S1(가족 기록)을 담으므로 저장소 밖(DATA_DIR/backups 등)에 둔다. 내용은 화면에 출력하지 않는다.
"""

import sqlite3
import sys

APP_TABLES = ("family_log", "family_log_history", "app_setting")
MAX_STMT = 90_000  # D1 문장 한도(100KB)보다 작게


def quote(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def main(src: str, out: str) -> int:
    con = sqlite3.connect(":memory:")
    with open(src, encoding="utf-8") as f:
        con.executescript(f.read())
    lines = []
    counts = {}
    for t in APP_TABLES:
        cols = [r[1] for r in con.execute(f"PRAGMA table_info({t})")]
        if not cols:
            counts[t] = "없음"
            continue
        rows = con.execute(f"SELECT {', '.join(cols)} FROM {t}").fetchall()
        counts[t] = len(rows)
        for r in rows:
            stmt = (
                f"INSERT OR REPLACE INTO {t} ({', '.join(cols)}) VALUES ({', '.join(quote(v) for v in r)});"
            )
            if len(stmt.encode("utf-8")) > MAX_STMT:
                print(f"오류: {t} 한 행이 문장 한도를 넘는다(내용은 출력하지 않음)", file=sys.stderr)
                return 2
            lines.append(stmt)
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + ("\n" if lines else ""))
    print("추출 건수:", counts)
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    sys.exit(main(sys.argv[1], sys.argv[2]))

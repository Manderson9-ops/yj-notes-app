"""SQL 생성과 화이트리스트 검증. 문자열 리터럴 이스케이프는 여기에서만 한다.

D1 한도(문장 100KB, 행 2MB)를 넘지 않도록 긴 문자열 칸은 `UPDATE ... SET c = c || '...'` 로 나눠 붙인다.
upload 는 실행 전에 모든 문장을 `validate_sql` 로 다시 검사한다(허용 형태가 아니면 거부).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

# 문장 하나가 D1 100KB 한도를 넘지 않게: 칸 하나의 UTF-8 바이트 상한(이스케이프·나머지 칸 여유 포함)
CHUNK_BYTES = 40_000
# D1 행 한도 2MB(R1-5). 여유를 두고 한 행의 문자열 칸 합계가 이를 넘으면 적재 전에 멈춘다.
MAX_ROW_BYTES = 1_900_000
PART_MAX_BYTES = 200_000
PART_MAX_STATEMENTS = 400


@dataclass(frozen=True)
class TableSpec:
    name: str
    pk: str
    columns: tuple[str, ...]


# 적재 대상 화이트리스트(= docs/07). 삽입 순서(부모 먼저). 삭제는 역순.
# family_log·auth_attempt·app_setting·log_type·ingest_run 은 의도적으로 없다.
TABLES: tuple[TableSpec, ...] = (
    TableSpec(
        "note_day",
        "date",
        ("date", "class_name", "age_months", "n_reports", "n_images", "n_comments", "first_line"),
    ),
    TableSpec(
        "note_item",
        "report_id",
        ("report_id", "date", "author_role", "direction", "weather", "posted_at", "body"),
    ),
    TableSpec("note_comment", "id", ("id", "report_id", "who", "posted_at", "body")),
    TableSpec(
        "milestone",
        "evidence_id",
        ("evidence_id", "domain_ko", "age_month", "milestone_ko", "source_id"),
    ),
    TableSpec(
        "observation",
        "id",
        (
            "id",
            "evidence_id",
            "date",
            "age_months",
            "section",
            "confidence",
            "subject_near",
            "snippet",
        ),
    ),
    TableSpec(
        "growth_ref",
        "growth_id",
        ("growth_id", "source_id", "measure", "sex", "age_month", "l", "m", "s", "p3", "p50", "p97"),
    ),
    TableSpec(
        "checkup",
        "id",
        (
            "id",
            "round_label",
            "exam_date",
            "age_months",
            "overall",
            "remarks",
            "dev_result",
            "source_image_key",
        ),
    ),
    TableSpec(
        "measurement",
        "id",
        (
            "id",
            "checkup_id",
            "measured_on",
            "measure",
            "value",
            "sheet_percentile",
            "read_status",
            "condition_note",
        ),
    ),
    TableSpec(
        "report_doc",
        "slug",
        (
            "slug",
            "title",
            "kind",
            "r2_key",
            "generated_at",
            "source_commit",
            "verify_ok",
            "sha256",
            "body",
        ),
    ),
)
SPEC_BY_NAME = {t.name: t for t in TABLES}
INSERT_ORDER = tuple(t.name for t in TABLES)
DELETE_ORDER = tuple(reversed(INSERT_ORDER))
# 어떤 경우에도 적재가 건드리면 안 되는 테이블 (verify I-금지 테이블, 테스트에서 단언)
FORBIDDEN_TABLES = ("family_log", "auth_attempt", "app_setting", "log_type")

# 적재 후 SUM(LENGTH(칸)) 으로 긴 칸이 온전히 붙었는지 대조하는 칸
TEXT_COLUMNS = (
    ("note_item", "body"),
    ("note_comment", "body"),
    ("report_doc", "body"),
    ("observation", "snippet"),
)

Value = str | int | float | None


class SqlError(ValueError):
    pass


# 로컬 wrangler(`d1 execute --file`)는 파일 안에 `BEGIN TRANSACTION` 이 있으면 따옴표 안까지 훑어
# `BEGIN TRANSACTION;`·`COMMIT;` 글자를 지운다(node_modules/wrangler src/d1/trimmer.ts). 자료 값이 이 글자를 담으면
# 적재 결과가 조용히 달라지므로, 그런 값은 만들지 않고 멈춘다. 대소문자도 wrangler 와 같게 정확히 비교한다.
WRANGLER_STRIPPED = ("BEGIN TRANSACTION", "COMMIT;")


def _reject_wrangler_tokens(text: str, what: str) -> None:
    for token in WRANGLER_STRIPPED:
        if token in text:
            raise SqlError(
                f"{what}: wrangler 가 지우는 글자({token!r})가 있어 안전하게 적재할 수 없습니다. "
                "원본에서 그 글자를 바꾸거나, 이 도구의 적재 방식을 바꾸세요(값 내용은 출력하지 않습니다)"
            )


def sql_literal(v: Value) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        if not math.isfinite(v):
            raise SqlError("NaN/Infinity 는 적재할 수 없습니다")
        return repr(v)
    if "\x00" in v:
        raise SqlError("NUL 문자가 있어 SQL 문자열로 만들 수 없습니다")
    _reject_wrangler_tokens(v, "문자열 값")
    try:
        v.encode("utf-8")
    except UnicodeEncodeError as e:
        raise SqlError("UTF-8 로 인코딩할 수 없는 문자가 있습니다") from e
    return "'" + v.replace("'", "''") + "'"


def split_text(text: str, max_bytes: int = CHUNK_BYTES) -> list[str]:
    """UTF-8 바이트 기준으로 max_bytes 이하가 되게 문자 경계에서 나눈다."""
    if len(text.encode("utf-8")) <= max_bytes:
        return [text]
    out: list[str] = []
    cur: list[str] = []
    size = 0
    for ch in text:
        n = len(ch.encode("utf-8"))
        if size + n > max_bytes:
            out.append("".join(cur))
            cur, size = [], 0
        cur.append(ch)
        size += n
    if cur:
        out.append("".join(cur))
    return out


def row_statements(spec: TableSpec, row: dict[str, Value]) -> list[str]:
    extra = set(row) - set(spec.columns)
    if extra:
        raise SqlError(f"{spec.name}: 정의되지 않은 칸 {sorted(extra)}")
    # R1-5: D1 행 한도(2MB)를 넘는 행은 조각으로 나눠도 적재 중에 실패한다 -> 시작 전에 어느 표·칸인지만 알리고 멈춘다.
    sizes = {c: len(v.encode("utf-8")) for c, v in row.items() if isinstance(v, str)}
    total = sum(sizes.values())
    if total > MAX_ROW_BYTES:
        biggest = max(sizes, key=lambda c: sizes[c])
        raise SqlError(
            f"{spec.name}: 한 행이 {total:,}바이트로 D1 행 한도(2MB, 안전선 {MAX_ROW_BYTES:,})를 넘습니다. "
            f"가장 큰 칸은 {spec.name}.{biggest} ({sizes[biggest]:,}바이트). 원본 문서를 나누세요(값 내용은 출력하지 않습니다)"
        )
    first: list[str] = []
    appends: list[tuple[str, str]] = []
    for col in spec.columns:
        v = row.get(col)
        if isinstance(v, str):
            # 이 칸이 어느 표·칸인지 알려 주려고 여기서 먼저 검사한다(값은 말하지 않는다)
            _reject_wrangler_tokens(v, f"{spec.name}.{col}")
        if isinstance(v, str) and len(v.encode("utf-8")) > CHUNK_BYTES:
            chunks = split_text(v)
            first.append(sql_literal(chunks[0]))
            appends.extend((col, c) for c in chunks[1:])
        else:
            first.append(sql_literal(v))
    stmts = [f"INSERT INTO {spec.name} ({', '.join(spec.columns)}) VALUES ({', '.join(first)});"]
    pk = sql_literal(row[spec.pk])
    for col, chunk in appends:
        stmts.append(f"UPDATE {spec.name} SET {col} = {col} || {sql_literal(chunk)} WHERE {spec.pk} = {pk};")
    return stmts


def delete_statements() -> list[str]:
    return [f"DELETE FROM {name};" for name in DELETE_ORDER]


def render_parts(
    statements: list[str],
    max_bytes: int = PART_MAX_BYTES,
    max_statements: int = PART_MAX_STATEMENTS,
) -> list[str]:
    """문장 목록을 파일 하나당 max_bytes/max_statements 이하로 묶는다. 한 행의 UPDATE 는 INSERT 뒤에 이어진다."""
    parts: list[str] = []
    cur: list[str] = []
    size = 0
    for s in statements:
        n = len(s.encode("utf-8")) + 1
        if cur and (size + n > max_bytes or len(cur) >= max_statements):
            parts.append("\n".join(cur) + "\n")
            cur, size = [], 0
        cur.append(s)
        size += n
    if cur:
        parts.append("\n".join(cur) + "\n")
    return parts


# ───────────────────────── 검증 ─────────────────────────
def split_statements(text: str) -> list[str]:
    """따옴표 밖의 `;` 로 문장을 나눈다. 따옴표 밖 주석·닫히지 않은 따옴표는 오류."""
    out: list[str] = []
    start = 0
    i = 0
    n = len(text)
    in_q = False
    while i < n:
        c = text[i]
        if in_q:
            if c == "'":
                if i + 1 < n and text[i + 1] == "'":
                    i += 2
                    continue
                in_q = False
        elif c == "'":
            in_q = True
        elif c == ";":
            out.append(text[start : i + 1].strip())
            start = i + 1
        elif c == "-" and text.startswith("--", i):
            raise SqlError("따옴표 밖 주석(--)은 허용하지 않습니다")
        elif c == "/" and text.startswith("/*", i):
            raise SqlError("따옴표 밖 주석(/* */)은 허용하지 않습니다")
        i += 1
    if in_q:
        raise SqlError("닫히지 않은 문자열 리터럴")
    if text[start:].strip():
        raise SqlError("`;` 로 끝나지 않는 문장")
    return out


_LIT = r"(?:'[^']*(?:''[^']*)*'|-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|NULL)"
_IDENT = r"[a-z_][a-z0-9_]*"
_RE_DELETE = re.compile(rf"DELETE FROM ({_IDENT});")
_RE_INSERT = re.compile(
    rf"INSERT INTO ({_IDENT}) \(({_IDENT}(?:, {_IDENT})*)\) VALUES \(({_LIT}(?:, {_LIT})*)\);"
)
_RE_UPDATE = re.compile(
    rf"UPDATE ({_IDENT}) SET ({_IDENT}) = ({_IDENT}) \|\| ('[^']*(?:''[^']*)*') "
    rf"WHERE ({_IDENT}) = ({_LIT});"
)
_RE_FINALIZE = re.compile(r"UPDATE report_doc SET verify_ok = 1;")
_ALLOWED = set(INSERT_ORDER)


def validate_sql(text: str, allow_finalize: bool = False) -> list[tuple[str, str]]:
    """허용된 문장 형태·테이블만 있는지 검사하고 (연산, 테이블) 목록을 돌려준다. 위반 시 SqlError."""
    _reject_wrangler_tokens(text, "SQL 파일")
    out: list[tuple[str, str]] = []
    for st in split_statements(text):
        m = _RE_DELETE.fullmatch(st)
        if m:
            op, table = "DELETE", m.group(1)
        else:
            m = _RE_INSERT.fullmatch(st)
            if m:
                op, table = "INSERT", m.group(1)
                spec = SPEC_BY_NAME.get(table)
                if spec is not None and m.group(2) != ", ".join(spec.columns):
                    raise SqlError(f"{table}: 칸 목록이 정의와 다릅니다")
            else:
                m = _RE_UPDATE.fullmatch(st)
                if m:
                    op, table = "UPDATE", m.group(1)
                    spec = SPEC_BY_NAME.get(table)
                    if m.group(2) != m.group(3) or (spec and m.group(5) != spec.pk):
                        raise SqlError(f"{table}: UPDATE 형태가 허용되지 않습니다")
                elif allow_finalize and _RE_FINALIZE.fullmatch(st):
                    op, table = "UPDATE", "report_doc"
                else:
                    raise SqlError("허용되지 않는 SQL 문장 형태가 있습니다")
        if table not in _ALLOWED:
            raise SqlError(f"허용되지 않은 테이블: {table}")
        out.append((op, table))
    return out

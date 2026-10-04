"""문서 목록 카드용 한 줄 설명(summary). src/lib/docSummary.ts 와 같은 규칙의 파이썬 이식(R1-10).

적재 때 한 번 계산해 report_doc.summary 에 둔다 -> /api/reports 가 목록마다 본문 앞 30KB 를 읽지 않는다.
규칙을 바꾸면 TS 와 이 파일을 함께 고친다(test_summary.py 가 TS 테스트와 같은 사례로 맞춘다). 최대 60자 + '…'.
"""

from __future__ import annotations

import re

MAX_CHARS = 60
MIN_CHARS = 6
# API 가 예전에 읽던 앞부분 길이와 같다(같은 결과를 내려고)
HEAD_CHARS = {"html": 30_000, "markdown": 1_500}
SUMMARY_MAX = 200  # 열의 상한(실제로는 61자 이하)

_PATHLIKE = re.compile(
    r"^[`(\[]?[\w.-]*[/\\][\w./\\-]*|^[`(\[]?[\w-]+\.(md|html|py|ts|csv|json|xlsx)\b",
    re.IGNORECASE | re.ASCII,  # JS 의 \w·\b 는 ASCII 만
)
_QUOTE_LEAD = re.compile(r"^[\"'「『“‘<]")
_META_LEAD = re.compile(
    r"^(자동\s*생성|생성\s*(일|됨|도구)|갱신|마지막\s*(갱신|수정)|작성\s*(일|자)|수정\s*(일|됨)|버전|출처|기준\s*일|업데이트|※|참고\s*:|주의\s*:)"
)
_ENTITIES = {"amp": "&", "lt": "<", "gt": ">", "quot": '"', "#39": "'", "nbsp": " "}


def _squeeze(s: str) -> str:
    return re.sub(r"[\s\u00a0\u3000]+", " ", s).strip()


def _cut(text: str) -> str | None:
    t = _squeeze(text)
    if len(t) < MIN_CHARS:
        return None
    if len(t) <= MAX_CHARS:
        return t
    head = t[:MAX_CHARS]
    space = head.rfind(" ")
    return (head[:space] if space >= MAX_CHARS * 0.6 else head).rstrip() + "…"


def strip_inline_marks(s: str) -> str:
    s = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", s)
    s = re.sub(r"`([^`]*)`", r"\1", s)
    s = re.sub(r"(\*\*|__|~~)(.+?)\1", r"\2", s)
    s = re.sub(r"\*(?!\s)(.+?)\*", r"\1", s)
    return re.sub(r"<[^>]+>", "", s)


def is_descriptive(text: str) -> bool:
    t = text.strip()
    return not (_PATHLIKE.search(t) or _QUOTE_LEAD.search(t) or _META_LEAD.search(t))


def summary_of_markdown(src: str) -> str | None:
    lines = re.sub(r"<!--[\s\S]*?-->", "", src).replace("\r\n", "\n").replace("\r", "\n").split("\n")
    fence = False
    para: list[str] = []
    quote: str | None = None

    def flush() -> str | None:
        nonlocal para
        plain = strip_inline_marks(" ".join(para))
        out = _cut(plain) if para and is_descriptive(plain) else None
        para = []
        return out

    for raw in lines:
        line = raw.strip()
        if line.startswith("```"):
            fence = not fence
            continue
        if fence:
            continue
        if line == "":
            got = flush()
            if got:
                return got
            continue
        if line.startswith(">"):
            if quote is None:
                quote = _cut(strip_inline_marks(re.sub(r"^>\s?", "", line)))
            flush()
            continue
        skip = (
            re.match(r"#{1,6}\s", line)
            or re.match(r"(\||<)", line)
            or re.fullmatch(r"([-*_])(\s*\1){2,}", line)
            or re.match(r"([-*+]|\d+[.)])\s", line)
        )
        if skip:
            got = flush()
            if got:
                return got
            continue
        para.append(line)
    return flush() or quote


def summary_of_html(src: str) -> str | None:
    body = re.sub(r"<!--[\s\S]*?-->", "", src)
    body = re.sub(r"<(style|script|head)\b[\s\S]*?</\1>", "", body, flags=re.IGNORECASE)
    for m in re.finditer(r"<p\b[^>]*>([\s\S]*?)</p>", body, flags=re.IGNORECASE):
        text = re.sub(r"<[^>]+>", "", m.group(1))
        text = re.sub(r"&(amp|lt|gt|quot|#39|nbsp);", lambda k: _ENTITIES.get(k.group(1), ""), text)
        if not is_descriptive(text):
            continue
        got = _cut(text)
        if got:
            return got
    return None


def doc_summary(kind: str, text: str) -> str | None:
    """text: 문서 전체(앞부분만 쓴다). 설명이 없으면 None."""
    head = text[: HEAD_CHARS["html" if kind == "html" else "markdown"]]
    out = summary_of_html(head) if kind == "html" else summary_of_markdown(head)
    return out[:SUMMARY_MAX] if out else None

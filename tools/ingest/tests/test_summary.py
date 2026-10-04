"""R1-10: 적재 때 계산하는 summary. src/lib/docSummary.test.ts 와 같은 사례로 TS 규칙과 맞춘다."""

from __future__ import annotations

from pathlib import Path

from tools.ingest.summary import (
    SUMMARY_MAX,
    doc_summary,
    is_descriptive,
    summary_of_html,
    summary_of_markdown,
)

from .conftest import SqliteRunner


def test_markdown_first_descriptive_paragraph():
    src = "\n".join(
        [
            "# 제목",
            "",
            "| a | b |",
            "| --- | --- |",
            "",
            "- 목록",
            "",
            "```",
            "코드 안의 문단 같은 글",
            "```",
            "",
            "이 문서는 **합성** 설명이다.  긴 설명이 `이어진다`.",
        ]
    )
    assert summary_of_markdown(src) == "이 문서는 합성 설명이다. 긴 설명이 이어진다."


def test_markdown_quote_fallback_cut_and_null():
    assert summary_of_markdown("# 제목\n\n> 인용으로 시작하는 합성 문서") == "인용으로 시작하는 합성 문서"
    out = summary_of_markdown(" ".join(["단어"] * 40)) or ""
    assert out.endswith("…") and len(out) <= 61
    assert summary_of_markdown("# 제목\n\n| a | b |\n| --- | --- |") is None
    assert summary_of_markdown("") is None


def test_html_skips_style_and_short_paragraphs():
    html = (
        "<html><head><title>x</title><style>p{color:red}</style></head><body><script>var a=1</script>"
        "<p>짧음</p><p>본문 &amp; 설명이 이어진다</p></body></html>"
    )
    assert summary_of_html(html) == "본문 & 설명이 이어진다"
    assert doc_summary("html", html) == "본문 & 설명이 이어진다"
    assert doc_summary("markdown", "합성 설명 문단이다.") == "합성 설명 문단이다."


def test_non_descriptive_paragraphs_are_skipped():
    for bad in ("report/sample-file.html 에서 만든다", '"인용 조각으로 시작"', "생성일: 합성 날짜입니다"):
        assert not is_descriptive(bad)
    assert is_descriptive("한글/영어 섞인 설명 문단입니다")  # JS 의 \w 는 ASCII 만 -> 한글 경로 꼴 아님


def test_summary_is_capped_and_ingest_fills_it(verified: Path, tmp_path: Path):
    assert len(doc_summary("markdown", "가" * 500) or "") <= 61
    r = SqliteRunner(tmp_path / "d1.sqlite")
    from tools.ingest.upload import upload

    upload(verified, r, log=lambda _: None)
    rows = r.query("SELECT slug, summary FROM report_doc")
    assert rows and all(x["summary"] is None or len(x["summary"]) <= SUMMARY_MAX for x in rows)
    assert any(x["summary"] for x in rows)

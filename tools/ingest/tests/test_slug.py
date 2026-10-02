"""문서 slug 규칙(model.doc_slug): 서버 slug 형식을 만족하고, 가이드 링크(`guide/05`)와 맞는다."""

from __future__ import annotations

import re

from tools.ingest.model import doc_slug

SERVER_SLUG = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")


def _all(rels: list[str]) -> list[str]:
    used: set[str] = set()
    return [doc_slug(r, used) for r in rels]


def test_numbered_korean_name_uses_number_only():
    assert _all(["guide/05-합성-제목.md", "wiki/00-합성.md"]) == ["guide-05", "wiki-00"]


def test_english_name_and_folder_prefix():
    assert _all(["report/behavior-guide.html", "tracking/milestone_log.md"]) == [
        "report-behavior-guide",
        "tracking-milestone_log",
    ]


def test_same_stem_in_different_folders_and_cases_do_not_collide():
    slugs = _all(["guide/INDEX.md", "report/INDEX.html", "report/index.html", "wiki/INDEX.md"])
    assert slugs == ["guide-index", "report-index", "report-index-2", "wiki-index"]
    assert len({s.lower() for s in slugs}) == len(slugs)


def test_non_ascii_name_without_number_gets_hash_and_valid_format():
    slugs = _all(["wiki/합성이름.md", "wiki/다른이름.md"])
    assert all(SERVER_SLUG.fullmatch(s) for s in slugs)
    assert slugs[0] != slugs[1]


def test_long_name_is_cut_to_server_limit():
    (slug,) = _all(["guide/" + "a" * 200 + ".md"])
    assert SERVER_SLUG.fullmatch(slug)

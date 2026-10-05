"""context.py·context_search.py 테스트 — 합성 픽스처(테스트아이/2020)만 사용."""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import date
from pathlib import Path

import context
import context_search as cs
import fixture_builder
import pytest

HERE = Path(__file__).parent
TODAY = date(2020, 3, 6)  # 합성 픽스처의 가장 최근 알림장(2020-03-05) 바로 다음 날


@pytest.fixture
def env(tmp_path: Path) -> dict[str, Path]:
    paths = fixture_builder.build(tmp_path)
    return {"data": Path(paths["dataDir"]), "ingest": Path(paths["ingestRoot"]), "cache": tmp_path / "cache"}


def pack(env: dict[str, Path], q: str = "테스트아이가 밥을 안 먹어요", **kw):
    kw.setdefault("today", TODAY)
    return context.build_pack(env["data"], env["ingest"], env["cache"], q, **kw)


def test_pack_has_all_sections_and_refs(env):
    out = pack(env)
    text = out["pack"]
    for head in ("## A. 아이 요약", "## B-1. 키워드 전수 검색", "## B-2.", "## B-3."):
        assert head in text
    assert "현재 월령: 30개월" in text
    for ref in ("note:2020-03-02", "SYN-IV-01", "SYN-CL-01", "checkup:1", "SYN-MS-01"):
        assert ref in out["refs"]
        assert f"[ref: {ref}]" in text
    assert any(r.startswith("guide:01-합성#") for r in out["refs"])
    assert "말할 수 없는 것" in text
    assert out["runId"] == fixture_builder.RUN_ID


def test_refs_match_tags_in_pack(env):
    out = pack(env)
    assert set(context.REF_TAG.findall(out["pack"])) == set(out["refs"])


def test_budget_trims_from_the_tail(env):
    big = pack(env)
    assert big["tokens"] <= context.MAX_TOKENS
    small = pack(env, max_tokens=900)
    assert small["pack"].count("[ref:") < big["pack"].count("[ref:")


def test_caches_keyed_by_run(env):
    first = pack(env)
    assert first["cacheHit"] is False
    assert (env["cache"] / f"child-{fixture_builder.RUN_ID}.json").exists()
    assert (env["cache"] / f"texts-{fixture_builder.RUN_ID}.json").exists()
    assert pack(env)["cacheHit"] is True
    new_run = env["ingest"] / "20200401-000000-synth002"
    new_run.mkdir()
    (new_run / "manifest.json").write_text("{}", "utf-8")
    for f in (env["ingest"] / fixture_builder.RUN_ID).glob("*.sql"):
        (new_run / f.name).write_text(f.read_text("utf-8"), "utf-8")
    again = pack(env)
    assert again["cacheHit"] is False and again["runId"] == "20200401-000000-synth002"
    assert [p.name for p in env["cache"].glob("child-*.json")] == ["child-20200401-000000-synth002.json"]
    assert [p.name for p in env["cache"].glob("texts-*.json")] == ["texts-20200401-000000-synth002.json"]


def test_no_export_raises(tmp_path: Path):
    paths = fixture_builder.build(tmp_path)
    with pytest.raises(LookupError):
        context.build_pack(Path(paths["dataDir"]), tmp_path / "none", tmp_path / "c", "밥")


def test_read_only_no_writes_in_data_dir(env):
    before = sorted(p.relative_to(env["data"]) for p in env["data"].rglob("*"))
    pack(env)
    after = sorted(p.relative_to(env["data"]) for p in env["data"].rglob("*"))
    assert before == after


def test_unrelated_question_still_has_summary_and_zero_hits(env):
    out = pack(env, "zzzz qqqq")
    assert "## A. 아이 요약" in out["pack"]
    assert out["search"]["total"] == 0
    assert "걸린 낱말 없음" in out["pack"]
    assert not out["search"]["ints"]


def test_synonym_expansion_finds_note(env):
    out = pack(env, "편식이 걱정이에요")
    assert "note:2020-03-04" in out["refs"]


def test_fallback_without_query_behavior(env):
    (env["data"] / "evidence" / "query_behavior.py").unlink()
    assert "note:2020-03-02" in pack(env)["refs"]


def test_est_tokens_monotonic():
    assert context.est_tokens("가나다") > context.est_tokens("abc")
    assert context.est_tokens("") == 0


def test_cli_stdout_json_and_errors(env):
    base = [
        sys.executable,
        str(HERE / "context.py"),
        "--data-dir",
        str(env["data"]),
        "--ingest-root",
        str(env["ingest"]),
        "--cache-dir",
        str(env["cache"]),
        "--today",
        "2020-03-06",
    ]
    req = {
        "question": "밥을 안 먹어요",
        "expansion": {"keywords": ["밥"], "synonyms": ["점심"], "domains": ["feeding"]},
    }
    ok = subprocess.run(
        base, input=json.dumps(req), capture_output=True, text=True, encoding="utf-8", check=False
    )
    assert ok.returncode == 0
    out = json.loads(ok.stdout)
    assert out["refs"] and out["search"]["total"] >= 1 and out["topics"] == ["feeding"]
    bad = subprocess.run(
        base,
        input=json.dumps({"question": ""}),
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    assert bad.returncode == 2 and json.loads(bad.stdout) == {"error": "bad_input"}


# ───────────── 나이·월령 ─────────────


def test_months_between_and_age_sources():
    assert context.months_between(date(2017, 9, 1), date(2020, 3, 1)) == 30
    assert context.months_between(date(2017, 9, 2), date(2020, 3, 1)) == 29
    assert context.months_between(date(2020, 3, 1), date(2020, 1, 1)) == 0
    summary = {"ageMonths": 30, "latestNote": "2020-03-05"}
    assert context.current_age(summary, date(2020, 3, 6))[0] == 30
    assert context.current_age(summary, date(2020, 6, 5))[0] == 33
    assert context.current_age(summary, date(2020, 6, 5), date(2017, 9, 1))[0] == 33
    assert context.current_age({}, date(2020, 3, 6)) == (None, "")


def test_section_a_states_current_age_with_birth_date_or_notes(env):
    assert "현재 월령: 30개월" in pack(env)["pack"]
    out = pack(env, birth=date(2017, 12, 1))
    assert "현재 월령: 27개월" in out["pack"] and "생년월일로 계산" in out["pack"]
    assert "2017" not in out["pack"]


def test_cached_summary_does_not_freeze_age(env):
    pack(env)
    later = pack(env, today=date(2020, 6, 5))
    assert later["cacheHit"] is True
    assert "현재 월령: 33개월" in later["pack"]


def test_age_line_always_present(env):
    assert "현재 월령:" in pack(env, today=date(2030, 1, 1))["pack"]


def test_norm_band_rules():
    # 상한 이후에는 다음 연령대만: 36개월이면 18~36 은 쓰지 않는다
    assert context.norm_band(36, 18, 36, has_next=True) is None
    assert context.norm_band(36, 36, 60, has_next=False) == "in"
    assert context.norm_band(35, 18, 36, has_next=True) == "in"
    # 다음 연령대 시작 2개월 전(34~35개월)부터 이웃도 함께
    assert context.norm_band(34, 36, 60, has_next=False) == "upcoming"
    assert context.norm_band(35, 36, 60, has_next=False) == "upcoming"
    assert context.norm_band(33, 36, 60, has_next=False) is None
    # 마지막 연령대는 상한을 포함, 그 위는 쓰지 않는다
    assert context.norm_band(60, 36, 60, has_next=False) == "in"
    assert context.norm_band(61, 36, 60, has_next=False) is None
    assert context.norm_band(12, 18, 36, has_next=True) is None
    assert context.norm_band(None, 18, 36, has_next=True) == "in"


def test_age_brackets_use_only_the_band_containing_the_child(env):
    at36 = pack(env, age_hint=36)
    assert "NORM-FEED-02" in at36["refs"] and "NORM-FEED-01" not in at36["refs"]  # 36+ 는 36~60 만
    assert "[내부 규칙" not in at36["pack"]
    at40 = pack(env, age_hint=40)
    assert "NORM-FEED-02" in at40["refs"] and "NORM-FEED-01" not in at40["refs"]
    at30 = pack(env, age_hint=30)
    assert "NORM-FEED-01" in at30["refs"] and "NORM-FEED-02" not in at30["refs"]
    assert "[내부 규칙" not in at30["pack"]
    at33 = pack(env, age_hint=33)
    assert "NORM-FEED-02" not in at33["refs"]


def test_internal_rule_only_when_two_bands_are_really_included(env):
    for age in (34, 35):  # 36개월 직전 2개월: 두 규준이 함께 들어가고 내부 규칙이 붙는다
        out = pack(env, age_hint=age)
        assert {"NORM-FEED-01", "NORM-FEED-02"} <= set(out["refs"])
        assert out["pack"].count("[내부 규칙") == 1
        assert "더 보수적인" in out["pack"]
        assert "limits" in out["pack"]  # 적지 말라는 안내에서만 나온다
    assert "더 보수적인" not in pack(env, age_hint=36)["pack"]
    assert "더 보수적인" not in pack(env, age_hint=20)["pack"]


def test_severity_section_from_expansion(env):
    exp = {
        "keywords": ["밥"],
        "frequency": "하루 세 번",
        "duration": "일주일째",
        "impact": None,
        "aggression": "",
    }
    out = pack(env, expansion=exp)
    assert "## A-2. 질문에 나온 빈도·지속·영향" in out["pack"]
    assert "- 빈도: 하루 세 번" in out["pack"] and "- 지속: 일주일째" in out["pack"]
    assert "영향:" not in out["pack"]
    none = pack(env, expansion={"keywords": ["밥"]})
    assert "따로 적혀 있지 않아요" in none["pack"]
    assert "## A-2." not in pack(env)["pack"]  # 확장이 없으면 구역 자체가 없다


# ───────────── 근거 DB ─────────────


def test_interventions_first_same_domain_and_at_least_two(env):
    out = pack(env)
    text = out["pack"]
    iv = [r for r in out["refs"] if r.startswith(("SYN-IV-", "INT-"))]
    assert len(iv) >= 2
    assert {"SYN-IV-01", "SYN-IV-02", "INT-FEED-01"} <= set(iv)
    assert text.index("[ref: SYN-IV-01]") < text.index("[ref: SYN-IV-03]")
    assert text.index("[ref: SYN-IV-02]") < text.index("[ref: SYN-NM-01]")
    assert "실천(AVOID" in text and "금기" in text and "한계" in text
    assert out["search"]["ints"]


def test_topic_domains_pull_protocols_with_specialist_in_contraindication(env):
    out = pack(
        env, "말이 자꾸 막혀요", expansion={"keywords": ["막혀"], "synonyms": [], "domains": ["fluency"]}
    )
    assert "INT-FLUENCY-01" in out["refs"]
    assert "언어재활사" in out["pack"]
    fear = pack(env, "자꾸 무서워해요", expansion={"keywords": [], "synonyms": [], "domains": ["fear"]})
    assert "INT-FEAR-01" in fear["refs"]


def test_evidence_capped_at_eight(env):
    out = pack(
        env,
        "밥 식사 편식 수면 낮잠",
        expansion={"keywords": [], "synonyms": [], "domains": ["feeding", "sleep"]},
    )
    ev_refs = [r for r in out["refs"] if r.startswith(("SYN-IV", "INT-", "SYN-NM", "NORM-", "SYN-CL"))]
    assert len(ev_refs) <= 8


# ───────────── 주제 → 가이드 ─────────────


def test_feeding_topic_exposes_guide_05_sections_and_family_log_note(env):
    out = pack(env)
    assert "guide:05-식사#§3" in out["refs"] and "guide:05-식사#§3-1" in out["refs"]
    assert "저녁은 가족이 함께 앉아" in out["pack"]
    assert "records/식사기록" in out["pack"]
    assert "guide:05-식사#§4" not in out["refs"]  # 4절은 가져오지 않는다


def test_skill_loss_topic_exposes_guide_04_and_lost_skills_rule(env):
    out = pack(
        env,
        "예전엔 하던 말을 못 하게 됐어요",
        expansion={"keywords": ["못하게"], "synonyms": [], "domains": ["skill_loss"]},
    )
    assert any(r.startswith("guide:04-퇴행#") for r in out["refs"])
    assert "lost skills" in out["pack"]  # 주제 안내(CDC 규칙)
    assert out["topics"][0] == "skill_loss"


def test_topic_detection_from_question_words():
    assert cs.detect_topics("밥을 안 먹어요", [], []) == ["feeding"]
    assert cs.detect_topics("x", ["fluency", "bogus"], []) == ["fluency"]
    assert "media" in cs.detect_topics("유튜브를 너무 봐요", [], [])


def test_guide_section_number_matching(tmp_path: Path):
    g = tmp_path
    (g / "05-a.md").write_text(
        "# T\n\n## 3. 가\n본문 셋\n### 3-1. 나\n본문 셋하나\n## 30. 다\n서른\n## 4. 라\n넷\n", "utf-8"
    )
    got = dict(cs.guide_sections_by_number(g, "05", ["3", "3-1"]))
    assert "본문 셋하나" in got["guide:05-a#§3"] and "서른" not in got["guide:05-a#§3"]
    assert got["guide:05-a#§3-1"].startswith("### 3-1.")
    assert "guide:05-a#§30" not in got


# ───────────── 전수 검색 ─────────────


def test_texts_carry_author_place_kind_labels(env):
    out = pack(env)
    text = out["pack"]
    assert "[2020-03-02][작성자: 교사][장소: 어린이집][글 종류: 알림장 본문]" in text
    assert "[작성자: 부모][장소: 집][글 종류: 댓글]" in text  # 부모 댓글(집에서는 …)
    assert "[작성자: 교사][장소: 어린이집][글 종류: 댓글]" in text  # 교사 댓글
    assert (
        "[2020-03-04][작성자: 부모][장소: 집][글 종류: 알림장 본문]"
        in pack(env, "새벽에 깨서 울어요")["pack"]
    )


def test_classmate_flag_for_dongsaeng_in_daycare_context(env):
    text = pack(env, "동생들과 밥을 같이 먹어요")["pack"]
    line = next(x for x in text.splitlines() if "동생들과 함께 앉아서" in x)
    assert "(반 친구일 수 있음)" in line
    assert cs.classmate_flag("부모", "집", "동생이 울었어요") == ""


def test_place_and_author_heuristics():
    assert cs.author_of_item("원장", "to_home") == "교사"
    assert cs.author_of_item("엄마", "to_center") == "부모"
    assert cs.author_of_item("담임", "") == "교사"
    assert cs.place_of("교사", "집에서도 해 주세요") == "어린이집"  # 교사 글은 어린이집
    assert cs.place_of("부모", "밤에 깼어요") == "집"
    assert cs.place_of("부모", "하원 때 울었어요") == "어린이집"
    assert cs.place_of("부모", "그냥 그랬어요") == "모름"


def test_exhaustive_counts_all_hits_but_shows_at_most_25():
    texts = [
        [
            f"2020-01-{(i % 28) + 1:02d}",
            "부모" if i % 2 else "교사",
            "집",
            "댓글",
            f"테스트 단어 {i}번째 기록",
        ]
        for i in range(60)
    ]
    texts.append(["2020-02-01", "교사", "어린이집", "알림장 본문", "관련 없는 글"])
    res = cs.exhaustive_search(texts, ["단어"], [])
    assert res["total"] == 60  # 상위 N 이 아니라 전수 건수
    assert len(res["items"]) == cs.MAX_EXCERPTS == 25
    assert res["keywords"] == {"단어": 60}
    lines = cs.render_search_section(res)
    assert "서로 다른 60건" in lines[0][1] and "단어 60건" in lines[0][1]


def test_rare_core_keywords_outrank_common_ones():
    texts = [["2020-01-01", "교사", "어린이집", "댓글", "밥 밥 밥 오늘도 밥"] for _ in range(30)]
    texts.append(["2020-01-02", "교사", "어린이집", "댓글", "더듬는 말이 있었어요"])
    res = cs.exhaustive_search(texts, ["더듬", "밥"], [])
    assert res["items"][0]["excerpt"].startswith("더듬")


def test_all_dates_returned_for_checks(env):
    out = pack(env)
    assert "2020-03-02" in out["search"]["dates"]
    assert out["search"]["keywords"]
    assert out["search"]["shown"] >= 1


def test_exhaustive_search_day_stats_for_discriminative_checks():
    texts = []
    for d in range(1, 21):  # 흔한 낱말: 20일 모두
        texts.append([f"2020-01-{d:02d}", "교사", "어린이집", "알림장 본문", "오늘도 밥을 먹었어요"])
    texts.append(["2020-02-01", "부모", "집", "댓글", "손톱을 뜯고 피부를 자꾸 뜯어요"])
    texts.append(["2020-02-03", "교사", "어린이집", "알림장 본문", "손톱을 뜯어서 달랬어요"])
    texts.append(["2020-02-03", "교사", "어린이집", "댓글", "손톱 이야기"])
    res = cs.exhaustive_search(texts, ["밥", "손톱", "피부"], [])
    assert res["days"] == 22
    assert res["keywordDays"]["밥"] == 20  # 흔한 낱말(날짜 빈도 90%)
    assert res["keywordDays"]["손톱"] == 2  # 변별력 있는 낱말(날짜 빈도 약 9%)
    assert res["keywordDates"]["손톱"] == ["2020-02-03", "2020-02-01"]
    assert res["total"] == 23  # 건수는 그대로 센다(가족에게는 보이지 않는다)
    multi = {m["date"]: m["keywords"] for m in res["multi"]}
    assert set(multi["2020-02-01"]) == {"손톱", "피부"}  # 한 글에 서로 다른 낱말 둘
    assert "2020-02-03" not in multi


def test_search_summary_exposes_day_stats(env):
    out = pack(env)
    s = out["search"]
    assert s["days"] >= 3 and s["keywordDays"] and s["keywordDates"]
    assert all(len(v) <= 4 for v in s["keywordDates"].values())
    assert isinstance(s["multi"], list)

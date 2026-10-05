"""전수 검색·주제 지도·가이드 매핑 (context.py 보조). 읽기 전용, 자료 내용은 저장소에 없다.

- 알림장 전체(본문·교사 댓글·부모 댓글)를 export 구조에서 읽어 작성자·장소·글 종류를 붙인다.
- 질문 확장 낱말로 전 기간을 전수 검색해 건수와 대표 발췌(최대 25)를 낸다.
- 주제(식사·퇴행·말 더듬 등) → 가이드 절·근거 DB 항목 지도.
"""

from __future__ import annotations

import json
import math
import re
import sqlite3
from pathlib import Path

KEEP_SHORT = {"밥", "잠", "떼", "폰"}
MAX_EXCERPTS = 25
EXCERPT_CHARS = 200

# 주제 지도: words 는 질문·확장 낱말에서 주제를 알아보는 말, int/norm 은 근거 DB id 접두어,
# guide 는 (가이드 파일 번호 접두어, 절 번호 목록; None 이면 낱말로 고른다), dbwords 는 근거 DB 본문에서 더 찾을 말.
TOPICS: dict[str, dict] = {
    "feeding": {
        "label": "식사",
        "words": ["밥", "식사", "먹", "편식", "반찬", "간식", "급식", "우유", "숟가락", "뱉"],
        "int": ["INT-FEED", "INT-MEAL"],
        "norm": ["NORM-FEED", "NORM-MEAL"],
        "guide": [("05", ["3", "3-1"])],
        "note": "가족 저녁 식사 기록은 앱의 가족 기록(records/식사기록)에 있을 수 있어요. 이 묶음에는 없으니 있다고 단정하지 않고, 가이드의 기존 가족 계획을 먼저 보세요.",
    },
    "sleep": {
        "label": "수면",
        "words": ["잠", "수면", "낮잠", "밤잠", "깨", "재우", "새벽"],
        "int": ["INT-SLEEP"],
        "norm": ["NORM-SLEEP"],
        "guide": [],
        "note": "",
    },
    "tantrum": {
        "label": "떼쓰기",
        "words": ["떼", "울화", "고집", "짜증", "드러눕", "소리"],
        "int": ["INT-TANTRUM"],
        "norm": ["NORM-TANTRUM"],
        "guide": [],
        "note": "",
    },
    "fear": {
        "label": "무서움·불안",
        "words": ["무서", "겁", "불안", "낯가", "울음", "놀라"],
        "int": ["INT-FEAR"],
        "norm": ["NORM-FEAR"],
        "guide": [],
        "note": "",
    },
    "fluency": {
        "label": "말 더듬",
        "words": ["더듬", "말막", "말이막", "버벅", "반복해서말"],
        "int": ["INT-FLUENCY"],
        "norm": ["NORM-FLUENCY"],
        "guide": [],
        "note": "말 더듬은 근거 DB 의 금기·한계에 적힌 전문가(언어재활사)를 upIf 에 이름으로 적어요.",
    },
    "media": {
        "label": "영상·화면",
        "words": ["영상", "폰", "스마트폰", "유튜브", "tv", "태블릿", "화면"],
        "int": ["INT-MEDIA"],
        "norm": ["NORM-MEDIA"],
        "guide": [],
        "note": "",
    },
    "skill_loss": {
        "label": "하던 것을 못 함(퇴행)",
        "words": ["퇴행", "못하게", "못 하게", "잃", "예전엔", "하던", "안 하게"],
        "int": [],
        "norm": [],
        "guide": [("04", None)],
        "dbwords": ["lost skills", "퇴행", "잃", "기술을 잃"],
        "note": "하던 말·행동을 잃는 것은 CDC 「lost skills」 규칙과 가이드 04 로 다뤄요. 「일반 권고」가 아니라 이 묶음의 ref 를 basis 로 써요.",
    },
    "aggression": {
        "label": "공격 행동",
        "words": ["때리", "물기", "던지", "깨물", "밀"],
        "int": ["INT-AGGR"],
        "norm": [],
        "guide": [],
        "note": "",
    },
    "toileting": {
        "label": "배변",
        "words": ["배변", "기저귀", "변기", "오줌", "응가"],
        "int": ["INT-TOILET"],
        "norm": [],
        "guide": [],
        "note": "",
    },
    "separation": {
        "label": "헤어짐·분리",
        "words": ["분리", "등원", "헤어", "어린이집가기싫"],
        "int": ["INT-SEPAR"],
        "norm": [],
        "guide": [],
        "note": "",
    },
}


def detect_topics(question: str, domains: list[str], keywords: list[str]) -> list[str]:
    """확장이 준 domains 를 먼저, 부족하면 질문·낱말에서 주제를 알아본다."""
    found = [d for d in domains if d in TOPICS]
    blob = (question + " " + " ".join(keywords)).lower().replace(" ", "")
    for name, t in TOPICS.items():
        if name in found:
            continue
        if any(w.replace(" ", "") in blob for w in t["words"]):
            found.append(name)
    return found[:3]


# ───────────────────────── 알림장 전체 글 ─────────────────────────

_HOME = re.compile(r"집에서|집에|우리\s*집|밤|새벽|주말|저녁|아침에|퇴근")
_DAYCARE = re.compile(r"어린이집|하원|등원|선생님|원에서|급식")
_CLASSMATE = re.compile(r"동생|형님|형아|언니|오빠|누나")


def author_of_item(role: str, direction: str) -> str:
    if direction == "to_home":
        return "교사"
    if direction in ("to_center", "to_school", "from_home", "to_teacher"):
        return "부모"
    r = role or ""
    if re.search(r"교사|원장|선생|담임", r):
        return "교사"
    if re.search(r"엄마|아빠|부모|보호자|가족|맘|할머니|할아버지", r):
        return "부모"
    return "모름"


def place_of(author: str, text: str) -> str:
    if author == "교사":
        return "어린이집"
    if _HOME.search(text):
        return "집"
    if _DAYCARE.search(text):
        return "어린이집"
    return "모름"


def classmate_flag(author: str, place: str, text: str) -> str:
    """동생·형님·언니가 어린이집 반 친구일 수 있는 맥락이면 표시한다(형제로 읽지 않게)."""
    if _CLASSMATE.search(text) and (
        author == "교사" or place == "어린이집" or "친구" in text or "반" in text
    ):
        return " (반 친구일 수 있음)"
    return ""


def build_texts(conn: sqlite3.Connection) -> list[list[str]]:
    """[날짜, 작성자, 장소, 글 종류, 본문] 전부. export 의 note_item(본문)·note_comment(댓글)."""
    out: list[list[str]] = []
    dates: dict[int, str] = {}
    try:
        items = conn.execute(
            "SELECT report_id, date, author_role, direction, body FROM note_item ORDER BY date, report_id"
        ).fetchall()
    except sqlite3.Error:
        items = []
    for rid, d, role, direction, body in items:
        dates[rid] = str(d)
        text = str(body or "").strip()
        if not text:
            continue
        a = author_of_item(str(role or ""), str(direction or ""))
        out.append([str(d), a, place_of(a, text), "알림장 본문", text])
    try:
        comments = conn.execute(
            "SELECT report_id, who, posted_at, body FROM note_comment ORDER BY posted_at"
        ).fetchall()
    except sqlite3.Error:
        comments = []
    for rid, who, posted, body in comments:
        text = str(body or "").strip()
        if not text:
            continue
        d = dates.get(rid) or str(posted or "")[:10]
        a = "부모" if str(who) == "parent" else "교사"
        out.append([d, a, place_of(a, text), "댓글", text])
    return out


def load_texts(run_dir: Path, cache_dir: Path, loader) -> tuple[list[list[str]], bool]:
    """run id 별 캐시. loader() 는 export 연결을 돌려준다(캐시 미스일 때만 호출)."""
    cache = cache_dir / f"texts-{run_dir.name}.json"
    if cache.exists():
        try:
            return json.loads(cache.read_text("utf-8")), True
        except (OSError, ValueError):
            pass
    conn = loader(run_dir)
    try:
        texts = build_texts(conn)
    finally:
        conn.close()
    cache_dir.mkdir(parents=True, exist_ok=True)
    for old in cache_dir.glob("texts-*.json"):
        old.unlink(missing_ok=True)
    cache.write_text(json.dumps(texts, ensure_ascii=False), "utf-8")
    return texts, False


# ───────────────────────── 전수 검색 ─────────────────────────


def clean_keywords(core: list[str], extra: list[str]) -> tuple[list[str], set[str]]:
    seen: dict[str, None] = {}
    core_set: set[str] = set()
    for k in core:
        k = k.strip().lower()
        if (len(k) >= 2 or k in KEEP_SHORT) and k not in seen:
            seen[k] = None
            core_set.add(k)
    for k in extra:
        k = k.strip().lower()
        if (len(k) >= 2 or k in KEEP_SHORT) and k not in seen:
            seen[k] = None
    return list(seen)[:40], core_set


def _excerpt(text: str, kw: str) -> str:
    flat = re.sub(r"\s+", " ", text)
    i = flat.lower().find(kw)
    if i < 0:
        return flat[:EXCERPT_CHARS]
    start = max(0, i - EXCERPT_CHARS // 2)
    end = min(len(flat), start + EXCERPT_CHARS)
    s = ("…" if start > 0 else "") + flat[start:end] + ("…" if end < len(flat) else "")
    return s


def exhaustive_search(
    texts: list[list[str]], core: list[str], extra: list[str], limit: int = MAX_EXCERPTS
) -> dict:
    kws, core_set = clean_keywords(core, extra)
    n = len(texts)
    lows = [t[4].lower() for t in texts]
    df: dict[str, int] = {k: sum(1 for low in lows if k in low) for k in kws}
    hits: list[tuple[float, str, int, list[str]]] = []
    for i, low in enumerate(lows):
        matched = [k for k in kws if df[k] and k in low]
        if not matched:
            continue
        # 드문 낱말일수록, 질문 핵심 낱말일수록 무겁게(흔한 낱말이 순위를 휩쓸지 않게)
        score = sum(math.log((n + 1) / (df[k] + 1)) * (2.0 if k in core_set else 1.0) for k in matched)
        hits.append((score, texts[i][0], i, matched))
    # 점수 순, 같은 점수대(소수 첫째 자리)에서는 최근 글이 먼저
    hits.sort(key=lambda h: (-round(h[0], 1), -int(h[1].replace("-", "") or 0)))
    shown = hits[:limit]
    items = []
    for _score, _d, i, matched in shown:
        t = texts[i]
        best = max(matched, key=lambda k: (k in core_set, -df[k]))
        items.append(
            {
                "date": t[0],
                "author": t[1],
                "place": t[2],
                "kind": t[3],
                "excerpt": _excerpt(t[4], best) + classmate_flag(t[1], t[2], t[4]),
            }
        )
    return {
        "total": len(hits),
        "days": len({t[0] for t in texts}),
        "keywords": {k: df[k] for k in kws if df[k]},
        "dates": sorted({h[1] for h in hits}, reverse=True)[:60],
        "items": items,
        "texts": n,
    }


def render_search_section(res: dict) -> list[tuple[str, str]]:
    """(ref, 줄) 목록. 첫 항목은 머리말(ref 없음)."""
    counts = (
        ", ".join(f"{k} {v}건" for k, v in sorted(res["keywords"].items(), key=lambda kv: -kv[1])[:20])
        or "걸린 낱말 없음"
    )
    head = (
        f"알림장 전체 {res['days']}일, 글 {res['texts']}건(본문·교사 댓글·부모 댓글)을 낱말로 전수 검색했어요. "
        f"걸린 글은 서로 다른 {res['total']}건. 낱말별 건수: {counts}. "
        f"아래는 가장 관련 높은 {len(res['items'])}건이에요. 각 글의 [작성자][장소][글 종류] 표시 그대로만 써요"
        "(교사 글을 가족 글로, 어린이집 일을 집 일로 쓰지 않아요). 이 목록에 있는 주제를 「기록이 없어요」라고 하지 않아요."
    )
    lines: list[tuple[str, str]] = [("", head)]
    for it in res["items"]:
        lines.append(
            (
                f"note:{it['date']}",
                f"[{it['date']}][작성자: {it['author']}][장소: {it['place']}][글 종류: {it['kind']}] {it['excerpt']}",
            )
        )
    return lines


# ───────────────────────── 가이드 절 ─────────────────────────

_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")


def _heading_has_number(title: str, num: str) -> bool:
    t = title.strip()
    return (
        re.match(rf"(?:§\s*)?{re.escape(num)}(?!\d)", t) is not None
        or re.search(rf"§\s*{re.escape(num)}(?!\d)", t) is not None
    )


def guide_sections_by_number(guide_dir: Path, file_prefix: str, nums: list[str]) -> list[tuple[str, str]]:
    """가이드 파일(번호 접두어)에서 제목이 해당 절 번호로 시작하는 절 전체(하위 절 포함). (ref, 글)."""
    out: list[tuple[str, str]] = []
    for f in sorted(guide_dir.glob(f"{file_prefix}*.md")):
        lines = f.read_text("utf-8").splitlines()
        for num in nums:
            i = 0
            while i < len(lines):
                m = _HEADING.match(lines[i])
                if m and _heading_has_number(m.group(2), num):
                    level = len(m.group(1))
                    j = i + 1
                    while j < len(lines):
                        m2 = _HEADING.match(lines[j])
                        if m2 and len(m2.group(1)) <= level:
                            break
                        j += 1
                    body = " ".join(x.strip() for x in lines[i:j] if x.strip())
                    ref = f"guide:{f.stem}#§{num}"
                    if not any(r == ref for r, _ in out):
                        out.append((ref, body))
                    i = j
                else:
                    i += 1
    return out


def guide_top_sections(
    guide_dir: Path, file_prefix: str, kws: list[str], limit: int = 2
) -> list[tuple[str, str]]:
    """절 번호를 모를 때: 파일 안에서 낱말이 가장 많이 걸린 ## 절."""
    scored: list[tuple[int, str, str]] = []
    for f in sorted(guide_dir.glob(f"{file_prefix}*.md")):
        parts = re.split(r"(?m)^## ", f.read_text("utf-8"))
        for idx, sec in enumerate(parts[1:], 1):
            low = sec.lower()
            s = sum(1 for k in kws if k and k in low) or 1  # 낱말이 안 걸려도 주제 파일이면 앞 절을 보여 준다
            scored.append((s, f"guide:{f.stem}#{idx}", " ".join(sec.split())))
    scored.sort(key=lambda t: (-t[0], t[1]))
    return [(ref, txt) for _s, ref, txt in scored[:limit]]

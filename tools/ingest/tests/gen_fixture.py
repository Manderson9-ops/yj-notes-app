"""합성 DATA_DIR(fixtures/data_dir) 생성기. 실제 자료·실제 문장은 쓰지 않는다(AGENTS.md §0-1).

실행: python -m tools.ingest.tests.gen_fixture [출력 폴더]   (기본: fixtures/data_dir)
결과가 저장소에 커밋된 fixtures/data_dir 과 같은지는 test_fixture.py 가 확인한다.

실제 폴더 이름(alrimjang·records·_source)은 가드(G1)가 저장소 어디서든 막으므로 같은 구조를
다른 이름으로 두고 ingest.config.json 으로 가리킨다. 일자 md 는 실제 빌더와 같은 구조(frontmatter·제목·본문·댓글)이되, 장식 줄은 실제 문구와 20자 창이 겹치지 않게(가드 G5) 다르게 쓰고 원본 URL 줄은 뺐다.
"""

from __future__ import annotations

import json
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BIRTH = date(2020, 1, 15)
CHILD = "테스트아이"
TEACHER = "교사A"
WEATHER_KO = {"sunny": "맑음", "rain": "비", "overcast": "흐림", "mostly_cloudy": "구름많음", "": "미기재"}

CONFIG = {
    "reports_json": "source/synthetic_reports.json",
    "notes_dir": "notes",
    "observations_csv": "tracking/observations.csv",
    "milestones_csv": "evidence/milestones.csv",
    "growth_csv": "evidence/growth.csv",
    "checkup_glob": "checkups/*.csv",
    "docs": [
        {"dir": "guide", "glob": "*.md", "kind": "markdown"},
        {"dir": "wiki", "glob": "*.md", "kind": "markdown"},
        {"dir": "reports", "glob": "*.html", "kind": "html"},
    ],
    "docs_exclude": [],
}

SENTENCES = [
    "블록을 높이 쌓고 무너뜨리며 깔깔 웃었어요.",
    "점심에는 숟가락으로 혼자 국을 떠먹었습니다.",
    "친구A 옆에 앉아 그림책 장면을 손가락으로 짚었어요.",
    "낮잠 전에 자장가를 들으며 금방 눈을 감았어요.",
    "바깥 놀이터에서 미끄럼틀 계단을 천천히 올랐습니다.",
    "친구B가 울자 곁에 가서 등을 토닥여 주었어요.",
    "물감 놀이 시간에 손바닥 도장을 여러 번 찍었습니다.",
    "노래 시간에 손동작을 따라 하려고 애썼어요.",
    "신발을 혼자 신어 보겠다며 한참 낑낑거렸어요.",
    "모래 놀이에서 작은 삽으로 통을 가득 채웠습니다.",
    "교사A가 이름을 부르자 큰 소리로 대답했어요.",
    "정리 시간에 장난감을 바구니에 하나씩 넣었어요.",
]
COMMENTS_PARENT = [
    "알려 주셔서 감사합니다. 집에서도 비슷했어요.",
    "오늘 저녁에 이야기해 볼게요.",
    "내일 준비물 잘 챙기겠습니다.",
    "사진 잘 봤어요. 즐거워 보여요.",
]
COMMENTS_TEACHER = [
    "내일도 즐겁게 지내도록 돕겠습니다.",
    "말씀해 주신 부분 살펴보겠습니다.",
    "오늘 컨디션이 좋았어요.",
]


def _sentence(i: int, k: int) -> str:
    return SENTENCES[(i * 5 + k * 7) % len(SENTENCES)]


def _body(i: int) -> str:
    return "\n".join(
        f"{_sentence(i, 0)} {_sentence(i, 1)}" if k == 0 else _sentence(i, k + 1) for k in range(3)
    )


def _long_body() -> str:
    """UTF-8 약 60KB(한 칸이 D1 문장 한도 100KB 에 가깝다 -> 나눠 붙이기 경로를 지난다)."""
    lines = [f"{SENTENCES[n % len(SENTENCES)]} ({n + 1})" for n in range(1000)]
    return "\n".join(lines)


def _workdays(start: date, n: int) -> list[date]:
    out: list[date] = []
    d = start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


def _age_str(d: date) -> str:
    y = d.year - BIRTH.year
    m = d.month - BIRTH.month
    if d.day < BIRTH.day:
        m -= 1
    if m < 0:
        y -= 1
        m += 12
    return f"{y}년 {m}개월 (생후 {(d - BIRTH).days}일)"


def _utc(d: date, minute: int) -> str:
    return f"{d.isoformat()}T01:{minute:02d}:{(minute * 7) % 60:02d}Z"


def _kst(iso: str) -> str:
    t = datetime.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S") + timedelta(hours=9)
    return t.strftime("%Y-%m-%d %H:%M")


def build_reports() -> dict:  # type: ignore[type-arg]
    days = _workdays(date(2023, 3, 2), 30)
    reports: list[dict] = []  # type: ignore[type-arg]
    rid = 9_000_000_000
    comment_plan = {1: 3, 2: 2, 3: 5, 4: 1, 6: 4, 8: 2, 10: 3, 11: 1, 12: 2, 14: 3, 16: 2, 18: 1,
                    19: 2, 21: 3, 23: 2, 25: 1, 27: 2, 29: 1}  # fmt: skip
    n_cmt = 0
    for i, d in enumerate(days):
        count = 2 if i in (3, 19) else 1
        for j in range(count):
            rid += 1
            parent_note = count == 2 and j == 1
            content = _body(i * 3 + j)
            if i == 4:
                content = ""  # 빈 본문
            elif i == 6:
                content = (
                    "친구A와 함께 노래를 불렀어요 🎵😊 박수도 쳤어요 👏\n마지막에는 모두 손을 흔들었습니다 🌈"
                )
            elif i == 8:
                content = _long_body()
            elif i == 9:
                content = (
                    "첫 줄입니다.\r\n둘째 줄에는 'ㄱ' 소리를 알려 줬다는 작은따옴표가 있어요.\r\n  끝 줄 \n\n"
                )
            elif parent_note:
                content = "어제 저녁에는 잘 먹었고 아침에도 기분이 좋았어요. 오늘도 잘 부탁드립니다."
            comments = []
            planned = comment_plan.get(i, 0) if j == 0 else 0
            for c in range(planned):
                who = "parent" if c % 2 == 0 else "teacher"
                pool = COMMENTS_PARENT if who == "parent" else COMMENTS_TEACHER
                txt = pool[(i + c) % len(pool)]
                if i == 2 and c == 1:
                    txt = "첫 줄 댓글입니다.\n둘째 줄에는 이모지 😊 가 있어요."
                comments.append(
                    {
                        "t": _utc(d, 20 + c * 3),
                        "who": who,
                        "name": f"{CHILD} 엄마" if who == "parent" else TEACHER,
                        "txt": txt,
                    }
                )
            n_cmt += len(comments)
            weather = ["sunny", "rain", "overcast", "mostly_cloudy", ""][(i + j) % 5]
            reports.append(
                {
                    "id": rid,
                    "date": d.isoformat(),
                    "weather": weather,
                    "class_name": "해바라기반(1.2세)" if i < 15 else "민들레반(2.0세)",
                    "author": f"{CHILD} 엄마" if parent_note else TEACHER,
                    "author_name": f"{CHILD} 엄마" if parent_note else "해바라기반(1.2세) 교사",
                    "created": _utc(d, 5 + j * 11),
                    "modified": _utc(d, 6 + j * 11),
                    "n_images": (i + j) % 4,
                    "has_video": (i % 7 == 0),
                    "n_files": 0,
                    "content": content,
                    "comments": comments,
                }
            )
    assert n_cmt == 40, n_cmt
    return {
        "meta": {
            "child": CHILD,
            "child_id": 1,
            "birth": BIRTH.isoformat(),
            "exported": "2023-04-20T00:00:00.000Z",
            "n_reports": len(reports),
            "export_history": [{"exported": "2023-04-20T00:00:00.000Z", "n_reports": len(reports)}],
        },
        "reports": reports,
    }


def esc(s: str) -> str:
    return s.replace("\r\n", "\n").strip()


def render_md(ds: str, items: list[dict]) -> str:  # type: ignore[type-arg]
    d = date.fromisoformat(ds)
    dow = "월화수목금토일"[d.weekday()]
    head = items[0]

    def role(x: dict) -> str:  # type: ignore[type-arg]
        return x["author_name"].split()[-1]

    def home(x: dict) -> bool:
        return x["author_name"].endswith("엄마")

    lines = [
        "---",
        f"date: {ds}",
        f"weekday: {dow}요일",
        f"child: {CHILD}",
        f"age: {_age_str(d)}",
        f"class: {head['class_name']}",
        f"direction: {', '.join('가정→원' if home(x) else '원→가정' for x in items)}",
        f"reports: {len(items)}",
        f"images: {sum(x['n_images'] for x in items)}",
        f"videos: {sum(1 for x in items if x['has_video'])}",
        f"comments: {sum(len(x['comments']) for x in items)}",
        f"posted_at: {', '.join(_kst(x['created']) + ' KST' for x in items)}",
        "---",
        "",
        f"# 알림장 {ds} {dow}요일 ({CHILD})",
        "",
    ]
    for i, x in enumerate(items, 1):
        if len(items) > 1:
            lines += [f"## 알림장 {i}/{len(items)}", ""]
        lines += [
            f"> 정보 | 학급 {x['class_name']} | 작성자 {x['author']}/{role(x)} | 날씨 "
            f"{WEATHER_KO.get(x['weather'], x['weather'])} | 사진 {x['n_images']}",
            "",
            "### " + ("가정에서 원으로" if home(x) else "원에서 가정으로"),
            "",
            esc(x["content"]) or "_(본문 없음)_",
            "",
        ]
        if x["comments"]:
            lines += [f"### 댓글 ({len(x['comments'])})", ""]
            for c in sorted(x["comments"], key=lambda c: c["t"]):
                who = "부모" if c["who"] == "parent" else "교사"
                lines.append(f"- [{who}] {c['name']} @ {_kst(c['t'])} KST")
                for ln in esc(c["txt"]).split("\n"):
                    lines.append(f"  {ln}")
            lines.append("")
        lines += ["---", ""]
    lines += ["_출처: 합성 fixture (자동 생성)_", ""]
    return "\n".join(lines)


def _csv(rows: list[list[str]]) -> str:
    import csv
    import io

    buf = io.StringIO()
    csv.writer(buf, lineterminator="\n").writerows(rows)
    return buf.getvalue()


MILESTONES = [
    ("SYN-12M-GM-01", "SYN", "gross_motor", "대근육 운동", 12, "합성 이정표 1: 블록 쌓기"),
    ("SYN-12M-FM-01", "SYN", "fine_motor", "소근육 운동", 12, "합성 이정표 2: 숟가락 사용"),
    ("SYN-18M-LA-01", "SYN", "language", "언어·의사소통", 18, "합성 이정표 3: 이름을 부르면 대답"),
    ("SYN-18M-SE-01", "SYN", "social", "사회성·정서", 18, "합성 이정표 4: 친구 달래기"),
    ("SYN-24M-CG-01", "SYN", "cognitive", "인지", 24, "합성 이정표 5: 그림책 짚기"),
    ("SYN-24M-GM-02", "SYN", "gross_motor", "대근육 운동", 24, "합성 이정표 6: 계단 오르기"),
    ("SYN-30M-LA-02", "SYN", "language", "언어·의사소통", 30, "합성 이정표 7: 노래 따라 하기"),
    ("SYN-30M-SE-02", "SYN", "social", "사회성·정서", 30, "합성 이정표 8: 정리 돕기"),
    ("SYN-36M-CG-02", "SYN", "cognitive", "인지", 36, "합성 이정표 9: 모래 채우기"),
    ("SYN-36M-FM-02", "SYN", "fine_motor", "소근육 운동", 36, "합성 이정표 10: 신발 신기"),
]


def _reverse_columns(text: str) -> str:
    """열 순서를 뒤집는다(실제 자료 CSV 머리줄과 20자 창이 겹치지 않게 -- 가드 G5). 열 이름으로 읽으므로 무관."""
    import csv
    import io

    rows = [list(reversed(r)) for r in csv.reader(io.StringIO(text))]
    return _csv(rows)


def build_files() -> dict[str, str]:
    files: dict[str, str] = {}
    files["ingest.config.json"] = json.dumps(CONFIG, ensure_ascii=False, indent=2) + "\n"
    data = build_reports()
    files["source/synthetic_reports.json"] = json.dumps(data, ensure_ascii=False, indent=1) + "\n"
    by_date: dict[str, list[dict]] = {}  # type: ignore[type-arg]
    for r in data["reports"]:
        by_date.setdefault(r["date"], []).append(r)
    for ds, items in by_date.items():
        files[f"notes/{ds[:7]}/{ds}.md"] = render_md(ds, items)
    files["notes/INDEX.md"] = f"# {CHILD} 알림장 인덱스\n\n합성 fixture 입니다.\n"

    files["evidence/milestones.csv"] = _csv(
        [
            [
                "evidence_id",
                "source_id",
                "domain",
                "domain_ko",
                "age_month",
                "milestone_en",
                "milestone_ko",
                "label",
            ]
        ]
        + [[e, s, dm, dk, str(a), f"synthetic {e}", ko, "CONFIRMED"] for e, s, dm, dk, a, ko in MILESTONES]
    )
    # 관측: 일자 md 에서 잘라 낸 조각(본문 6건 + 댓글 머리줄 1건) + 서로 다른 날짜의 중복 이정표
    obs: list[list[str]] = [
        ["evidence_id", "date", "age_months", "section", "confidence", "subject_near", "pattern", "snippet"]
    ]
    days = list(by_date)
    picks = [(0, 0), (1, 1), (2, 2), (3, 3), (5, 4), (7, 5), (10, 6), (12, 7), (14, 8), (20, 9), (22, 0)]
    for k, (di, mi) in enumerate(picks):
        ds = days[di]
        md = render_md(ds, by_date[ds])
        body = esc(by_date[ds][0]["content"]).replace("\n", " ") or "x"
        snippet = body[: 40 + k]
        if k == 3:  # 댓글 머리줄(마크다운 기호 포함)
            snippet = next((ln.strip() for ln in md.split("\n") if ln.startswith("- [")), snippet)
        age = int(_age_str(date.fromisoformat(ds)).split("년")[0]) * 12 + int(
            _age_str(date.fromisoformat(ds)).split("년")[1].split("개월")[0]
        )
        obs.append(
            [
                MILESTONES[mi][0],
                ds,
                str(age),
                "본문",
                "HIGH" if k % 3 else "MED",
                "YES" if k % 2 else "NO",
                "합성패턴",
                snippet,
            ]
        )
    files["tracking/observations.csv"] = _csv(obs)

    growth = [
        [
            "growth_id",
            "source_id",
            "measure",
            "unit",
            "sex",
            "age_month",
            "L",
            "M",
            "S",
            "p3",
            "p5",
            "p50",
            "p95",
            "p97",
            "label",
        ]
    ]
    for n, age in enumerate(range(30, 36)):
        growth.append(
            [
                f"SYN-{age}M-HEIGHT_CM-F",
                "SYN",
                "height_cm",
                "cm",
                "F",
                str(age),
                "NA",
                "NA",
                "NA",
                f"{85 + n * 0.5}",
                "86",
                f"{93 + n * 0.5}",
                "100",
                f"{101 + n * 0.5}",
                "CONFIRMED",
            ]
        )
        growth.append(
            [
                f"SYN-{age}M-WEIGHT_KG-F",
                "SYN",
                "weight_kg",
                "kg",
                "F",
                str(age),
                "-0.3",
                f"{12.5 + n * 0.2:.1f}",
                "0.11",
                "10.5",
                "10.9",
                "12.5",
                "14.9",
                "15.4",
                "CONFIRMED",
            ]
        )
    files["evidence/growth.csv"] = _csv(growth)

    files["checkups/2022-12-20_synthetic.csv"] = _csv(
        [
            ["구분", "항목", "값", "단위", "백분위", "판정/체크", "판독상태", "근거·비고"],
            ["기본정보", "서식", "합성 결과통보서 (30~36개월용)", "", "", "", "CONFIRMED", "합성"],
            ["기본정보", "검진일", "2022-12-20", "", "", "", "CONFIRMED", ""],
            ["기본정보", "검진 시 월령", "35개월 (합성)", "개월", "", "", "CONFIRMED", ""],
            ["신체계측", "키", "94.0", "cm", "50", "합성 칸", "CONFIRMED", ""],
            ["신체계측", "몸무게", "13.0", "kg", "45", "합성 칸", "UNCERTAIN", "옷을 입고 측정(합성 메모)"],
            ["신체계측", "머리둘레", "49.0", "cm", "60", "합성 칸", "CONFIRMED", ""],
            [
                "신체계측",
                "체질량지수(BMI)",
                "14.7",
                "kg/m²",
                "",
                "합성 칸",
                "CONFIRMED",
                "13.0 / 0.94² 계산(합성)",
            ],
            ["종합", "종합판정", "결과지 문구 A", "", "", "", "CONFIRMED", ""],
            ["종합", "소견 및 조치사항", "합성 소견 문구", "", "", "", "CONFIRMED", ""],
            ["발달평가(K-DST)", "발달 평가 결과", "결과지 문구 B", "", "", "", "CONFIRMED", ""],
        ]
    )

    files["guide/01-sample-guide.md"] = (
        "# 합성 안내 문서\n\n이 문서는 테스트용입니다.\n\n- 항목 하나\n- 항목 둘 'quote' 포함\n"
    )
    files["wiki/01-sample-wiki.md"] = "# 합성 위키 문서\n\n본문 한 줄. 이모지 🌈 포함.\n"
    files["reports/sample-report.html"] = (
        '<!doctype html>\n<html lang="ko">\n<head><meta charset="utf-8">'
        "<title>합성 보고서 &amp; 제목</title></head>\n<body><h1>합성 보고서</h1>"
        "<p>테스트 본문입니다.</p></body>\n</html>\n"
    )
    for rel in ("evidence/milestones.csv", "tracking/observations.csv", "evidence/growth.csv"):
        files[rel] = _reverse_columns(files[rel])
    return files


def write_fixture(out: Path) -> None:
    for rel, text in build_files().items():
        p = out / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(text.encode("utf-8"))


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "fixtures" / "data_dir"
    write_fixture(target)
    print(f"fixture 생성: {target}")

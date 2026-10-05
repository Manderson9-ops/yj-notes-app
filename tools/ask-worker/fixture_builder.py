"""합성 DATA_DIR + ingest export 픽스처 생성기 (테스트·드라이런 전용).

실제 자료를 담지 않는다: 아이 "테스트아이", 날짜는 2020년 합성 값뿐.
실제 DATA_DIR 와 같은 형식(알림장 md, guide md, 근거 sqlite, ingest INSERT sql + manifest)을 흉내 낸다.
사용: python fixture_builder.py <빈 출력 폴더>   → 출력 {"dataDir": ..., "ingestRoot": ...}
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

RUN_ID = "20200301-000000-synth001"

QUERY_BEHAVIOR = """SYNONYM_MAP = {"밥": ["식사", "먹", "편식"], "안먹": ["편식", "거부"], "잠": ["수면", "낮잠"]}


def tokenize(query):
    toks = [t for t in (query or "").lower().split() if t]
    keys = set(toks)
    for t in toks:
        for k, syns in SYNONYM_MAP.items():
            if t in k or k in t:
                keys.update(syns)
    return list(keys)
"""

NOTES = {
    "2020-03-02": "오늘 점심에 밥을 반만 먹었어요. 반찬은 잘 먹었어요.",
    "2020-03-03": "낮잠을 1시간 잤어요. 친구와 블록 놀이를 했어요.",
    "2020-03-04": "점심 편식이 조금 있었지만 간식은 잘 먹었어요.",
    "2020-03-05": "산책을 다녀왔어요. 노래를 따라 불렀어요.",
}

GUIDE = """# 합성 가이드

## 식사 시간 지켜보기

밥을 잘 안 먹을 때는 식사 시간을 정하고 간식을 줄여 보세요. 편식은 흔한 과정이에요.

## 낮잠 정하기

낮잠 시간이 일정하면 밤잠에 도움이 돼요.
"""

SCHEMA = """
CREATE TABLE ref_behavior_domains (domain_id TEXT PRIMARY KEY, domain_ko TEXT NOT NULL, description_ko TEXT NOT NULL);
CREATE TABLE behavior_norms (norm_id TEXT PRIMARY KEY, domain_id TEXT, age_min_months INTEGER, age_max_months INTEGER,
  typical_behavior_ko TEXT, warning_sign_ko TEXT, rationale_ko TEXT, source_id TEXT, evidence_quote_en TEXT, label TEXT);
CREATE TABLE evidence_sources (source_id TEXT PRIMARY KEY, title TEXT, doi TEXT, url TEXT);
CREATE TABLE behavior_interventions (intervention_id TEXT PRIMARY KEY, domain_id TEXT, target_behavior TEXT, source_id TEXT,
  action_type TEXT, protocol_ko TEXT, rationale_ko TEXT, effect_size TEXT, grade TEXT, not_licensed_limits_ko TEXT,
  contraindications_ko TEXT, evidence_quote_en TEXT, label TEXT);
CREATE TABLE claims (claim_id TEXT PRIMARY KEY, paper_id TEXT, domain TEXT, claim_ko TEXT, effect_size TEXT, design TEXT,
  evidence_grade TEXT, observable_in_teacher_notes TEXT, not_licensed_ko TEXT, label TEXT);
CREATE VIEW v_behavior_guide AS SELECT i.intervention_id, d.domain_ko, i.target_behavior, i.action_type, i.protocol_ko,
  i.rationale_ko, i.grade, i.not_licensed_limits_ko AS limitations, i.contraindications_ko AS contraindications
  FROM behavior_interventions i JOIN ref_behavior_domains d ON i.domain_id = d.domain_id;
CREATE VIEW v_age_norms AS SELECT n.norm_id, d.domain_ko, n.age_min_months, n.age_max_months, n.typical_behavior_ko,
  n.warning_sign_ko FROM behavior_norms n JOIN ref_behavior_domains d ON n.domain_id = d.domain_id;
INSERT INTO ref_behavior_domains VALUES ('FEEDING', '식사', '합성');
INSERT INTO behavior_interventions VALUES ('SYN-IV-01', 'FEEDING', '밥 안 먹음', 'S1', 'DO',
  '식사 시간을 일정하게 하고 간식 간격을 늘려요', '합성 근거', 'n/a', 'MODERATE', '합성 한계', '강요 금지', 'q', 'CONFIRMED');
INSERT INTO behavior_norms VALUES ('SYN-NM-01', 'FEEDING', 24, 48, '편식이 흔하게 나타나요', '체중이 계속 줄면 상담', 'r', 'S1', 'q', 'CONFIRMED');
INSERT INTO claims VALUES ('SYN-CL-01', 'S1', 'FEEDING', '식사 시간 구조화는 편식 완화와 관련 있어요', 'n/a', 'RCT', 'B', 'Y',
  '개별 아이의 원인은 말할 수 없어요', 'CONFIRMED');
"""

EXPORT_SQL = {
    "10_note_day.001.sql": "\n".join(
        f"INSERT INTO note_day (date, class_name, age_months, n_reports, n_images, n_comments, first_line) "
        f"VALUES ('{d}', '합성반', 30, 1, 0, 0, '{t[:20]}');"
        for d, t in NOTES.items()
    ),
    "70_checkup.001.sql": "INSERT INTO checkup (id, round_label, exam_date, age_months, overall, remarks, dev_result, source_image_key) "
    "VALUES (1, '합성 검진', '2020-02-20', 29, '양호', '합성 메모', '양호', NULL);",
    "80_measurement.001.sql": "INSERT INTO measurement (id, checkup_id, measured_on, measure, value, sheet_percentile, read_status, condition_note) "
    "VALUES (1, 1, '2020-02-20', 'height_cm', 90.5, 50, 'CONFIRMED', NULL);",
    "40_milestone.001.sql": "INSERT INTO milestone (evidence_id, domain_ko, age_month, milestone_ko, source_id) "
    "VALUES ('SYN-MS-01', '언어', 30, '두 낱말을 이어 말한다', 'CDC');",
    "50_observation.001.sql": "INSERT INTO observation (id, evidence_id, date, age_months, section, confidence, subject_near, snippet) "
    "VALUES (1, 'SYN-MS-01', '2020-03-05', 30, '본문', 'MED', 1, '노래를 따라 불렀어요');",
}


def build(root: Path, run_id: str = RUN_ID) -> dict[str, str]:
    data = root / "data"
    (data / "alrimjang" / "2020-03").mkdir(parents=True)
    (data / "guide").mkdir()
    (data / "evidence").mkdir()
    for d, text in NOTES.items():
        front = (
            f"---\ndate: {d}\nchild: 테스트아이\nage: 2년 6개월\n---\n\n# {d}\n\n### 본문\n\n{text}\n\n---\n"
        )
        (data / "alrimjang" / "2020-03" / f"{d}.md").write_text(front, "utf-8")
    (data / "guide" / "01-합성.md").write_text(GUIDE, "utf-8")
    (data / "guide" / "INDEX.md").write_text("# 색인\n\n## 밥 색인\n", "utf-8")
    (data / "evidence" / "query_behavior.py").write_text(QUERY_BEHAVIOR, "utf-8")
    db = data / "evidence" / "ops_master_evidence.db"
    conn = sqlite3.connect(db)
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()
    ingest = root / "ingest"
    run = ingest / run_id
    run.mkdir(parents=True)
    (run / "manifest.json").write_text(json.dumps({"format": 1}), "utf-8")
    for name, sql in EXPORT_SQL.items():
        (run / name).write_text(sql + "\n", "utf-8")
    return {"dataDir": str(data), "ingestRoot": str(ingest)}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    print(json.dumps(build(Path(sys.argv[1])), ensure_ascii=False))

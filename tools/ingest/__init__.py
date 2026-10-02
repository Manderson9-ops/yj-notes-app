"""yj-notes 적재 도구: 비공개 자료 폴더(DATA_DIR) -> D1 SQL (export) -> 대조(verify) -> 적용(upload).

보안 경계(AGENTS.md §0-4). 실제 자료는 읽기만 하고, 출력은 저장소 밖(LOCALAPPDATA)에만 쓴다.
런타임 의존성 없음(표준 라이브러리만).
"""

__version__ = "1.0.0"

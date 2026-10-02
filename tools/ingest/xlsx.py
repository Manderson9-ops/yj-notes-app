"""최소 xlsx 읽기(표준 라이브러리만). 값만 읽고 서식·수식은 무시한다. 첫 시트 또는 이름 지정 시트."""

from __future__ import annotations

import re
import zipfile
from io import BytesIO
from xml.etree import ElementTree as ET

_NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pr": "http://schemas.openxmlformats.org/package/2006/relationships",
}
_MAX_PART_BYTES = 20 * 1024 * 1024


class XlsxError(ValueError):
    pass


def _part(z: zipfile.ZipFile, name: str) -> bytes:
    try:
        info = z.getinfo(name)
    except KeyError as e:
        raise XlsxError(f"xlsx 안에 {name} 가 없습니다") from e
    if info.file_size > _MAX_PART_BYTES:
        raise XlsxError(f"xlsx 부품이 너무 큽니다: {name}")
    return z.read(name)


def _col_index(ref: str) -> int:
    m = re.match(r"([A-Z]+)", ref)
    if not m:
        raise XlsxError("셀 주소를 읽을 수 없습니다")
    n = 0
    for ch in m.group(1):
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def _text(el: ET.Element) -> str:
    return "".join(t.text or "" for t in el.iter(f"{{{_NS['m']}}}t"))


def read_xlsx_rows(data: bytes, sheet_name: str | None = None) -> list[list[str]]:
    """시트의 모든 행을 문자열 목록으로. 빈 칸은 ''. 숫자는 저장된 값 문자열 그대로(예: '95.2')."""
    try:
        z = zipfile.ZipFile(BytesIO(data))
    except zipfile.BadZipFile as e:
        raise XlsxError("xlsx(zip) 형식이 아닙니다") from e
    with z:
        wb = ET.fromstring(_part(z, "xl/workbook.xml"))
        sheets = wb.findall("m:sheets/m:sheet", _NS)
        if not sheets:
            raise XlsxError("시트가 없습니다")
        chosen = sheets[0]
        if sheet_name is not None:
            for s in sheets:
                if s.get("name") == sheet_name:
                    chosen = s
                    break
        rid = chosen.get(f"{{{_NS['r']}}}id")
        rels = ET.fromstring(_part(z, "xl/_rels/workbook.xml.rels"))
        target = None
        for rel in rels.findall("pr:Relationship", _NS):
            if rel.get("Id") == rid:
                target = rel.get("Target")
        if not target:
            raise XlsxError("시트 연결 정보를 찾지 못했습니다")
        path = target.lstrip("/") if target.startswith("/") else f"xl/{target}"
        shared: list[str] = []
        if "xl/sharedStrings.xml" in z.namelist():
            sst = ET.fromstring(_part(z, "xl/sharedStrings.xml"))
            shared = [_text(si) for si in sst.findall("m:si", _NS)]
        sheet = ET.fromstring(_part(z, path))
        rows: list[list[str]] = []
        for row in sheet.iter(f"{{{_NS['m']}}}row"):
            cells: dict[int, str] = {}
            for c in row.findall("m:c", _NS):
                ref = c.get("r") or ""
                t = c.get("t")
                if t == "inlineStr":
                    val = _text(c)
                else:
                    v = c.find("m:v", _NS)
                    val = (v.text or "") if v is not None else ""
                    if t == "s" and val != "":
                        val = shared[int(val)]
                cells[_col_index(ref)] = val
            width = (max(cells) + 1) if cells else 0
            rows.append([cells.get(i, "") for i in range(width)])
        return rows

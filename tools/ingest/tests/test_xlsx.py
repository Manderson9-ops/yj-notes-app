from __future__ import annotations

import csv
import io
import zipfile
from pathlib import Path

import pytest

from tools.ingest.config import load_config
from tools.ingest.model import Sources, build_checkups
from tools.ingest.xlsx import XlsxError, read_xlsx_rows

NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
RNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def _col(i: int) -> str:
    return "ABCDEFGHIJ"[i]


def make_xlsx(rows: list[list[str]], *, shared: bool, sheet: str = "검진결과", numbers: bool = True) -> bytes:
    """테스트용 xlsx 를 코드로 만든다(바이너리를 저장소에 두지 않는다)."""
    sst: list[str] = []
    out_rows = []
    for r, row in enumerate(rows, 1):
        cells = []
        for c, v in enumerate(row):
            ref = f"{_col(c)}{r}"
            if v == "":
                continue
            is_num = numbers and r > 1 and c in (2, 4) and v.replace(".", "", 1).isdigit()
            if is_num:
                cells.append(f'<c r="{ref}" t="n"><v>{v}</v></c>')
            elif shared:
                sst.append(v)
                cells.append(f'<c r="{ref}" t="s"><v>{len(sst) - 1}</v></c>')
            else:
                esc = v.replace("&", "&amp;").replace("<", "&lt;")
                cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{esc}</t></is></c>')
        out_rows.append(f'<row r="{r}">{"".join(cells)}</row>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(
            "xl/workbook.xml",
            f'<workbook xmlns="{NS}" xmlns:r="{RNS}"><sheets>'
            f'<sheet name="다른시트" sheetId="2" r:id="rId9"/><sheet name="{sheet}" sheetId="1" r:id="rId1"/></sheets></workbook>',
        )
        z.writestr(
            "xl/_rels/workbook.xml.rels",
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>'
            '<Relationship Id="rId9" Target="worksheets/sheet2.xml"/></Relationships>',
        )
        z.writestr(
            "xl/worksheets/sheet1.xml",
            f'<worksheet xmlns="{NS}"><sheetData>{"".join(out_rows)}</sheetData></worksheet>',
        )
        z.writestr("xl/worksheets/sheet2.xml", f'<worksheet xmlns="{NS}"><sheetData/></worksheet>')
        if shared:
            items = "".join(f"<si><t>{s.replace('&', '&amp;').replace('<', '&lt;')}</t></si>" for s in sst)
            z.writestr("xl/sharedStrings.xml", f'<sst xmlns="{NS}">{items}</sst>')
    return buf.getvalue()


def _fixture_rows(fixture_dir: Path) -> list[list[str]]:
    text = (fixture_dir / "checkups" / "2022-12-20_synthetic.csv").read_text(encoding="utf-8")
    return list(csv.reader(io.StringIO(text)))


@pytest.mark.parametrize("shared", [False, True])
def test_reads_named_sheet_and_values(fixture_dir: Path, shared: bool):
    rows = _fixture_rows(fixture_dir)
    got = read_xlsx_rows(make_xlsx(rows, shared=shared), "검진결과")
    assert got[0][:3] == ["구분", "항목", "값"]
    assert got[4][2] == "94.0" and got[4][4] == "50"
    # 이름을 주지 않으면 첫 시트(다른시트, 비어 있음)
    assert read_xlsx_rows(make_xlsx(rows, shared=shared)) == []


@pytest.mark.parametrize("shared", [False, True])
def test_xlsx_and_csv_give_same_rows(fixture_dir: Path, data_copy: Path, shared: bool):
    cfg_csv = load_config(fixture_dir)
    want = build_checkups(Sources(fixture_dir), cfg_csv)
    # csv 를 xlsx 로 바꿔 둔다
    csv_path = data_copy / "checkups" / "2022-12-20_synthetic.csv"
    xlsx_path = csv_path.with_suffix(".xlsx")
    xlsx_path.write_bytes(make_xlsx(_fixture_rows(fixture_dir), shared=shared))
    csv_path.unlink()
    cfg = load_config(data_copy)
    cfg = type(cfg)(**{**cfg.__dict__, "checkup_glob": "checkups/*.xlsx"})
    assert build_checkups(Sources(data_copy), cfg) == want


def test_bad_inputs():
    with pytest.raises(XlsxError):
        read_xlsx_rows(b"not a zip")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("hello.txt", "x")
    with pytest.raises(XlsxError):
        read_xlsx_rows(buf.getvalue())

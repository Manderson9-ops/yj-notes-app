import { describe, expect, it } from "vitest";
import {
  DEFAULT_KEEP,
  backupFileName,
  backupPath,
  exportArgs,
  parseKeep,
  selectToDelete,
} from "./backup-helpers";

describe("backup-prod helpers", () => {
  it("builds the file name and path (paths with spaces stay one piece)", () => {
    const d = new Date("2030-02-03T10:00:00Z");
    expect(backupFileName(d)).toBe("yj-notes-db_2030-02-03.sql");
    const p = backupPath("/tmp/my data", d);
    expect(p.replaceAll("\\", "/")).toBe("/tmp/my data/backups/d1/yj-notes-db_2030-02-03.sql");
    const args = exportArgs(p);
    expect(args).toEqual(["d1", "export", "DB", "--remote", "--output", p]);
  });

  it("parseKeep: default 12, explicit N, invalid -> null", () => {
    expect(parseKeep([])).toBe(DEFAULT_KEEP);
    expect(DEFAULT_KEEP).toBe(12);
    expect(parseKeep(["--keep", "3"])).toBe(3);
    expect(parseKeep(["--keep"])).toBeNull();
    expect(parseKeep(["--keep", "0"])).toBeNull();
    expect(parseKeep(["--keep", "-1"])).toBeNull();
    expect(parseKeep(["--keep", "x"])).toBeNull();
  });

  it("selectToDelete: oldest beyond keep, only exact-pattern names", () => {
    const names = [
      "yj-notes-db_2030-01-03.sql",
      "yj-notes-db_2030-01-01.sql",
      "yj-notes-db_2030-01-02.sql",
      "yj-notes-db_2030-01-04.sql",
      "notes.txt",
      "yj-notes-db_2030-01-01.sql.bak",
      "my-yj-notes-db_2030-01-00.sql",
      "yj-notes-db_latest.sql",
    ];
    expect(selectToDelete(names, 2)).toEqual([
      "yj-notes-db_2030-01-01.sql",
      "yj-notes-db_2030-01-02.sql",
    ]);
    expect(selectToDelete(names, 4)).toEqual([]);
    expect(selectToDelete(names, 99)).toEqual([]);
    expect(selectToDelete([], 1)).toEqual([]);
  });
});

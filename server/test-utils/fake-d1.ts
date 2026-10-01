// 테스트 전용 D1 대역: node:sqlite 위에 D1Database 의 prepare/bind/first/all/run/batch/exec 를 구현.
// 실제 migrations/*.sql 을 그대로 적용한다. (선택 이유: @cloudflare/vitest-pool-workers 는 설치돼 있지 않고
// 추가 런타임·워크플로 의존성이 크다. node:sqlite 는 schema.test.ts 가 이미 쓰는 무의존 방식이다.)
// Test-only D1 fake built on node:sqlite. Not shipped.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

const MIGRATIONS = resolve(import.meta.dirname, "../../migrations");

interface FakeMeta {
  changes: number;
  last_row_id: number;
}
interface FakeResult {
  success: true;
  results: Record<string, unknown>[];
  meta: FakeMeta;
}

export interface FakeD1 {
  db: D1Database;
  sqlite: DatabaseSync;
  /** 이후 모든 쿼리가 이 오류를 던지게 한다 (null 이면 해제). */
  failWith: (error: Error | null) => void;
}

export function createFakeD1(): FakeD1 {
  const sqlite = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIGRATIONS)
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    sqlite.exec(readFileSync(resolve(MIGRATIONS, f), "utf8"));
  }
  let failure: Error | null = null;

  const exec = (sql: string, values: unknown[]): FakeResult => {
    if (failure) throw failure;
    const stmt = sqlite.prepare(sql);
    const input = values as SQLInputValue[];
    if (stmt.columns().length > 0) {
      return {
        success: true,
        results: stmt.all(...input),
        meta: { changes: 0, last_row_id: 0 },
      };
    }
    const r = stmt.run(...input);
    return {
      success: true,
      results: [],
      meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) },
    };
  };

  class Stmt {
    constructor(
      readonly sql: string,
      readonly values: unknown[] = [],
    ) {}
    bind(...values: unknown[]): Stmt {
      return new Stmt(this.sql, values);
    }
    run(): Promise<FakeResult> {
      return Promise.resolve().then(() => exec(this.sql, this.values));
    }
    all(): Promise<FakeResult> {
      return this.run();
    }
    first(): Promise<Record<string, unknown> | null> {
      return this.run().then((r) => r.results[0] ?? null);
    }
  }

  const db = {
    prepare: (sql: string) => new Stmt(sql),
    batch: (stmts: Stmt[]) =>
      Promise.resolve().then(() => {
        sqlite.exec("BEGIN");
        try {
          const out = stmts.map((s) => exec(s.sql, s.values));
          sqlite.exec("COMMIT");
          return out;
        } catch (e) {
          sqlite.exec("ROLLBACK");
          throw e;
        }
      }),
  };

  return {
    db: db as unknown as D1Database,
    sqlite,
    failWith: (e) => {
      failure = e;
    },
  };
}

/** auth_attempt 행 수 (테스트 단언용). `where` 는 테스트 코드가 쓰는 고정 문자열이다. */
export function countRows(sqlite: DatabaseSync, where = "1=1"): number {
  const row = sqlite.prepare(`SELECT COUNT(*) AS c FROM auth_attempt WHERE ${where}`).get();
  return typeof row?.c === "number" ? row.c : -1;
}

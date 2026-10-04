// R1-8: 배포 설정 불변식. 수동 배포는 main 에서만, 미리보기는 운영 D1 에 묶이지 않는다.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string =>
  readFileSync(resolve(import.meta.dirname, "../..", rel), "utf8");

describe("deploy.yml", () => {
  const yml = read(".github/workflows/deploy.yml");

  it("workflow_dispatch deploys only from refs/heads/main (job-level if)", () => {
    const ifLine = /^\s+if: (.+)$/m.exec(yml)?.[1] ?? "";
    expect(ifLine).toContain(
      "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'",
    );
    // 조건 없이 workflow_dispatch 를 통과시키는 옛 형태가 아니다
    expect(ifLine).not.toMatch(/^github\.event_name == 'workflow_dispatch' \|\|/);
  });

  it("keeps the workflow_run path (CI success on push)", () => {
    expect(yml).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(yml).toContain("github.event.workflow_run.event == 'push'");
  });
});

describe("wrangler.toml", () => {
  const toml = read("wrangler.toml");
  const prodId = /^\[\[d1_databases\]\][\s\S]*?^database_id = "([0-9a-f-]{36})"/m.exec(toml)?.[1];
  const previewId = /^\[\[env\.preview\.d1_databases\]\][\s\S]*?^database_id = "([^"]+)"/m.exec(
    toml,
  )?.[1];

  it("defines env.preview with a D1 id different from production", () => {
    expect(prodId).toBeTruthy();
    expect(previewId).toBeTruthy();
    expect(previewId).not.toBe(prodId);
    expect(toml).toMatch(/^\[env\.preview\]/m);
  });

  it("never reuses the production id anywhere in the preview section", () => {
    const preview = toml.slice(toml.indexOf("[env.preview]"));
    expect(preview).not.toContain(prodId ?? "unreachable");
  });
});

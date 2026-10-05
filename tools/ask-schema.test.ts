// 커밋된 워커용 JSON Schema 가 shared/ask-schema.ts 와 같은지 확인한다(다르면 `npm run ask:schema` 로 다시 만든다).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { answerJsonSchema } from "../shared/ask-schema.ts";

describe("tools/ask-worker/answer.schema.json", () => {
  it("shared/ask-schema.ts 에서 생성한 것과 정확히 같다", () => {
    const committed = readFileSync(
      new URL("./ask-worker/answer.schema.json", import.meta.url),
      "utf8",
    );
    expect(committed).toBe(`${JSON.stringify(answerJsonSchema(), null, 2)}\n`);
  });
});

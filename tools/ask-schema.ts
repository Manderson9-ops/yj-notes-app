// `npm run ask:schema`: shared/ask-schema.ts 의 답변·후속 짧은 답 스키마를 워커용 JSON Schema 파일로 내보낸다.
// 일치 확인: tools/ask-schema.test.ts
import { writeFileSync } from "node:fs";
import { answerJsonSchema, followupJsonSchema } from "../shared/ask-schema.ts";

writeFileSync(
  new URL("./ask-worker/answer.schema.json", import.meta.url),
  `${JSON.stringify(answerJsonSchema(), null, 2)}\n`,
);
writeFileSync(
  new URL("./ask-worker/followup.schema.json", import.meta.url),
  `${JSON.stringify(followupJsonSchema(), null, 2)}\n`,
);

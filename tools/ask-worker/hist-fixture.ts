// 테스트용 합성 가족 결과(테스트아이/2020). 실제 자료 없음.
import type { HistoryItem } from "../../shared/ask-schema.ts";

export function hist(over: Partial<HistoryItem> = {}): HistoryItem {
  return {
    id: 1,
    body: "테스트아이가 점심에 밥을 잘 안 먹어요",
    askedBy: "엄마",
    createdAt: "2020-03-01T00:00:00.000Z",
    level: 4,
    tryNowActions: ["식사 시간을 정해 두어요", "간식 간격을 넉넉히 두어요"],
    votes: [],
    notes: [],
    ...over,
  };
}

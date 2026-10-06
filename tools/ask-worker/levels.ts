// 10단계 이름의 단일 출처: shared/ask-levels.ts. levelTitle 은 이 문구로 정규화한다.
import { levelInfo } from "../../shared/ask-levels.ts";

export function levelTitle(level: number): string {
  return levelInfo(level).title;
}

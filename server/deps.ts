// 시간·지연 주입점 (테스트에서 시계와 400ms 지연을 바꾼다).
// Injectable clock and delay.
export interface Deps {
  /** epoch milliseconds */
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export const defaultDeps: Deps = {
  now: () => Date.now(),
  sleep: (ms) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }),
};

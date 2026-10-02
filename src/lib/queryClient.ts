import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";
import type { Session } from "./schemas";
import { sessionQueryKey } from "./session";

/** Any 401 from any call sends the app back to the PIN screen. */
export function createQueryClient(): QueryClient {
  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      handleUnauthorized(client);
    }
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return client;
}

export function handleUnauthorized(client: QueryClient): void {
  client.removeQueries({ predicate: (q) => q.queryKey[0] !== sessionQueryKey[0] });
  // pinLength 는 서버 설정이라 로그아웃·401 뒤에도 유지한다(잃으면 PIN 화면이 자동 전송 방식에서 '확인' 방식으로 바뀐다).
  client.setQueryData<Session>(sessionQueryKey, (old) =>
    old?.pinLength === undefined
      ? { authenticated: false }
      : { authenticated: false, pinLength: old.pinLength },
  );
}

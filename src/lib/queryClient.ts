import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";
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
  client.setQueryData(sessionQueryKey, { authenticated: false });
}

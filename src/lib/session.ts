import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { sessionSchema } from "./schemas";

export const sessionQueryKey = ["session"] as const;

export function useSession() {
  return useQuery({
    queryKey: sessionQueryKey,
    queryFn: () => api("GET", "/session", { schema: sessionSchema }),
  });
}

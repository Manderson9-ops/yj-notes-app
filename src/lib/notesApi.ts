import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { noteDaySchema, notesListSchema, overviewSchema } from "./notesSchemas";

const STALE_MS = 60_000;

export const overviewKey = ["overview"] as const;

export function useOverview() {
  return useQuery({
    queryKey: overviewKey,
    queryFn: () => api("GET", "/overview", { schema: overviewSchema }),
    staleTime: STALE_MS,
  });
}

export interface NotesFilter {
  q: string;
  from: string | null;
}

export function useNotesList(filter: NotesFilter, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["notes", "list", filter.q, filter.from],
    enabled,
    staleTime: STALE_MS,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const sp = new URLSearchParams();
      if (filter.q !== "") sp.set("q", filter.q);
      if (filter.from) sp.set("from", filter.from);
      if (pageParam) sp.set("cursor", pageParam);
      const qs = sp.toString();
      return api("GET", `/notes${qs ? `?${qs}` : ""}`, { schema: notesListSchema });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useNoteDay(date: string) {
  return useQuery({
    queryKey: ["notes", "day", date],
    queryFn: () => api("GET", `/notes/${date}`, { schema: noteDaySchema }),
    staleTime: STALE_MS,
  });
}

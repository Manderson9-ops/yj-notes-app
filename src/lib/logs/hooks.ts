import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../api";
import { logsKey, logTypesKey } from "./keys";
import {
  logListSchema,
  logOneSchema,
  logTypesSchema,
  summarySchema,
  type LogType,
} from "./schemas";

const TYPES_CACHE = "yj.logTypes";

/** 질문 정의는 개인 자료가 아니라서 기기에 한 벌 기억해 둔다: 끊긴 상태에서도 입력 화면이 열리게. */
function readTypesCache(): LogType[] | null {
  try {
    const raw = localStorage.getItem(TYPES_CACHE);
    const parsed = raw === null ? null : logTypesSchema.safeParse(JSON.parse(raw));
    return parsed?.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function useLogTypes() {
  return useQuery({
    queryKey: logTypesKey,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      try {
        const list = await api("GET", "/log-types", { schema: logTypesSchema });
        try {
          localStorage.setItem(TYPES_CACHE, JSON.stringify(list));
        } catch {
          /* 기억 못 해도 괜찮다 */
        }
        return list;
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) {
          const cached = readTypesCache();
          if (cached) return cached;
        }
        throw e;
      }
    },
  });
}

export function useLogList(type: string | null, limit: number) {
  return useQuery({
    queryKey: [...logsKey, "list", type, limit],
    queryFn: () => {
      const q = new URLSearchParams({ limit: String(limit) });
      if (type) q.set("type", type);
      return api("GET", `/logs?${q.toString()}`, { schema: logListSchema });
    },
  });
}

export function useLogOne(id: string | undefined) {
  return useQuery({
    queryKey: [...logsKey, "one", id],
    enabled: id !== undefined,
    queryFn: () => api("GET", `/logs/${id ?? ""}`, { schema: logOneSchema }),
  });
}

export function useLogSummary(type: string | null, from: string | null) {
  return useQuery({
    queryKey: [...logsKey, "summary", type, from],
    queryFn: () => {
      const q = new URLSearchParams();
      if (type) q.set("type", type);
      if (from) q.set("from", from);
      const qs = q.toString();
      return api("GET", `/logs/summary${qs ? `?${qs}` : ""}`, { schema: summarySchema });
    },
  });
}

export function useDeleteLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api("DELETE", `/logs/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: logsKey }),
  });
}

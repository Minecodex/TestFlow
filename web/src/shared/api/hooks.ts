import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getJson } from "./client";
import type { Operation, Page, Resource } from "./types";
export function useResources<T>(kind: string, params = "") {
  return useQuery({
    queryKey: ["resources", kind, params],
    queryFn: ({ signal }) =>
      getJson<Page<Resource<T>>>(
        `/${kind}${params ? "?" + params : ""}`,
        signal,
      ),
  });
}
export function useResource<T>(kind: string, id?: string, version?: string) {
  return useQuery({
    queryKey: ["resource", kind, id, version],
    queryFn: ({ signal }) =>
      getJson<Resource<T>>(
        `/${kind}/${id}${version ? "?version=" + version : ""}`,
        signal,
      ),
    enabled: !!id,
  });
}
export function useWrite<T, V>(fn: (value: V) => Promise<T>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries();
      window.dispatchEvent(new Event("testflow:submitted"));
    },
  });
}
export function useOperation(id?: string) {
  return useQuery({
    queryKey: ["operation", id],
    queryFn: () => getJson<Operation>(`/operations/${id}`),
    enabled: !!id,
    refetchInterval: (query) =>
      ["queued", "running"].includes(query.state.data?.state || "queued")
        ? 800
        : false,
  });
}
export function useLive() {
  const query = useQueryClient();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let stopped = false,
      socket: WebSocket | undefined,
      timer: number,
      cursor = 0,
      dirty = false;
    const refresh = window.setInterval(() => {
      if (dirty) {
        dirty = false;
        void query.invalidateQueries({
          predicate: (q) => q.queryKey[0] !== "session",
        });
      }
    }, 300);
    const open = () => {
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/v1/live?cursor=${cursor}`,
      );
      socket.onopen = () => setConnected(true);
      socket.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          if (event.id) {
            cursor = event.id;
            dirty = true;
          }
        } catch {
          /* Invalid frames do not trigger writes. */
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = (event) => {
        setConnected(false);
        if (event.code === 1008 && !stopped) {
          window.dispatchEvent(new Event("testflow:session-expired"));
          return;
        }
        if (!stopped) timer = window.setTimeout(open, 1500);
      };
    };
    open();
    return () => {
      stopped = true;
      clearInterval(refresh);
      clearTimeout(timer);
      socket?.close();
    };
  }, [query]);
  return connected;
}

/** Choice/palette queries include every visible resource, independently of list pagination. */
export function useResourceOptions<T>(kind: string) {
  return useQuery({
    queryKey: ["options", kind],
    queryFn: async ({ signal }) => {
      const values = new Map<string, Resource<T>>();
      let page = 1,
        total = 0;
      do {
        const result = await getJson<Page<Resource<T>>>(
          `/${kind}?page=${page++}&page_size=100`,
          signal,
        );
        total = result.total;
        result.items.forEach((item) => values.set(item.id, item));
        if (!result.items.length) break;
      } while ((page - 1) * 100 < total);
      return {
        items: [...values.values()],
        total,
        page: 1,
        page_size: values.size,
      };
    },
  });
}

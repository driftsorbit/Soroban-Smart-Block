// Issue #210: Real-time sub-invocation streaming via SSE and WebSocket
import { useEffect, useRef } from "react";
import type { SubInvocationExtended, SubInvocationFilter } from "../api";
import { api } from "../api";

type StreamMode = "sse" | "websocket";

interface UseSubInvocationStreamOptions {
  filter?: Pick<SubInvocationFilter, "contract" | "function">;
  mode?: StreamMode;
  onInvocation: (inv: SubInvocationExtended) => void;
  onError?: (err: Event | Error) => void;
  enabled?: boolean;
}

export function useSubInvocationStream({
  filter,
  mode = "sse",
  onInvocation,
  onError,
  enabled = true,
}: UseSubInvocationStreamOptions): { connected: boolean } {
  const onInvocationRef = useRef(onInvocation);
  const onErrorRef = useRef(onError);
  const connectedRef = useRef(false);

  useEffect(() => {
    onInvocationRef.current = onInvocation;
  }, [onInvocation]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const filterContract = filter?.contract;
  const filterFunction = filter?.function;

  useEffect(() => {
    if (!enabled) return;
    const streamFilter =
      filterContract === undefined && filterFunction === undefined
        ? undefined
        : { contract: filterContract, function: filterFunction };

    if (mode === "sse") {
      const url = api.subInvocationStreamUrl(streamFilter);
      const es = new EventSource(url);

      es.onopen = () => {
        connectedRef.current = true;
      };

      es.onmessage = (ev) => {
        try {
          const payload = JSON.parse(ev.data) as SubInvocationExtended;
          onInvocationRef.current(payload);
        } catch {
          // ignore malformed frames
        }
      };

      es.onerror = (ev) => {
        connectedRef.current = false;
        onErrorRef.current?.(ev);
      };

      return () => {
        es.close();
        connectedRef.current = false;
      };
    }

    // WebSocket mode
    const wsBase = api.subInvocationStreamUrl(streamFilter).replace(/^\/api/, "");
    const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/sub-invocations${wsBase ? `?${wsBase.split("?")[1] ?? ""}` : ""}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      connectedRef.current = true;
    };

    ws.onmessage = (ev) => {
      try {
        const frame = JSON.parse(ev.data as string) as { type: string; data: SubInvocationExtended };
        if (frame.type === "sub_invocation") {
          onInvocationRef.current(frame.data);
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.onerror = (ev) => {
      connectedRef.current = false;
      onErrorRef.current?.(ev);
    };

    ws.onclose = () => {
      connectedRef.current = false;
    };

    return () => {
      ws.close();
      connectedRef.current = false;
    };
  }, [enabled, mode, filterContract, filterFunction]);

  return { connected: connectedRef.current };
}

export function useSubInvocationLiveFeed(
  onInvocation: (inv: SubInvocationExtended) => void,
  filter?: Pick<SubInvocationFilter, "contract" | "function">,
): { connected: boolean } {
  return useSubInvocationStream({ filter, onInvocation, mode: "sse" });
}

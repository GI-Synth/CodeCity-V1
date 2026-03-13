import { useEffect, useRef, useState, useCallback } from "react";

export interface WSMessage {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export function useWebSocket(enabled = true) {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMessage = useCallback((msg: WSMessage) => {
    setLastMessage(msg);
  }, []);

  const connect = useCallback(() => {
    if (!enabled) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data) as WSMessage;
          if (msg.type === "batch" && Array.isArray(msg.payload)) {
            const msgs = msg.payload as WSMessage[];
            msgs.forEach((m, i) => {
              if (i === 0) {
                handleMessage(m);
              } else {
                setTimeout(() => handleMessage(m), i);
              }
            });
          } else {
            handleMessage(msg);
          }
        } catch { }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (enabled) {
          reconnectTimer.current = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch { }
  }, [enabled, handleMessage]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  return { connected, lastMessage };
}

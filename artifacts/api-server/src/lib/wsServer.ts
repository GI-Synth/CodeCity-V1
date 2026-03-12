import { WebSocketServer, WebSocket } from "ws";
import type http from "http";

export interface WSMessage {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

class WSServerManager {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();

  initialize(server: http.Server): void {
    this.wss = new WebSocketServer({ server, path: "/ws" });

    this.wss.on("connection", (ws: WebSocket) => {
      this.clients.add(ws);

      ws.on("close", () => {
        this.clients.delete(ws);
      });

      ws.on("error", () => {
        this.clients.delete(ws);
      });

      this.send(ws, { type: "connected", payload: { clientCount: this.clients.size }, timestamp: new Date().toISOString() });
    });

    console.log("[WSServer] WebSocket server initialized on /ws");
  }

  private send(ws: WebSocket, message: WSMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch { }
    }
  }

  broadcast(message: WSMessage): void {
    const data = JSON.stringify(message);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(data); } catch { }
      }
    }
  }

  broadcastNPCMove(npcId: string, targetBuilding: string, x: number, y: number): void {
    this.broadcast({
      type: "npc_move",
      payload: { npcId, targetBuilding, x, y },
      timestamp: new Date().toISOString(),
    });
  }

  broadcastBugFound(buildingId: string, severity: string, message: string): void {
    this.broadcast({
      type: "bug_found",
      payload: { buildingId, severity, message },
      timestamp: new Date().toISOString(),
    });
  }

  broadcastMetricUpdate(buildingId: string, metric: string, value: number): void {
    this.broadcast({
      type: "metric_update",
      payload: { buildingId, metric, value },
      timestamp: new Date().toISOString(),
    });
  }

  broadcastEscalation(npcId: string, building: string, fromCache: boolean, provider: string): void {
    this.broadcast({
      type: "escalation",
      payload: { npcId, building, fromCache, provider },
      timestamp: new Date().toISOString(),
    });
  }

  broadcastSeasonChange(season: string, score: number): void {
    this.broadcast({
      type: "season_change",
      payload: { season, score },
      timestamp: new Date().toISOString(),
    });
  }

  broadcastEventLog(type: string, message: string, severity: string): void {
    this.broadcast({
      type: "event_log",
      payload: { eventType: type, message, severity },
      timestamp: new Date().toISOString(),
    });
  }

  broadcastCityPatch(updatedBuilding: unknown, newHealthScore: number, newSeason: string): void {
    this.broadcast({
      type: "city_patch",
      payload: { updatedBuilding, newHealthScore, newSeason },
      timestamp: new Date().toISOString(),
    });
  }

  broadcastThought(npcId: string, thought: string, duration: number): void {
    const truncated = thought.length > 60 ? thought.slice(0, 57) + "…" : thought;
    this.broadcast({
      type: "npc_thought",
      payload: { npcId, thought: truncated, duration },
      timestamp: new Date().toISOString(),
    });
  }

  broadcastTestResult(buildingId: string, passed: number, failed: number, coverage: number | null): void {
    this.broadcast({
      type: "test_result",
      payload: { buildingId, passed, failed, coverage },
      timestamp: new Date().toISOString(),
    });
  }

  closeAll(): void {
    for (const ws of this.clients) {
      try { ws.close(); } catch { }
    }
    this.clients.clear();
    this.wss?.close();
  }

  get clientCount(): number {
    return this.clients.size;
  }
}

export const wsServer = new WSServerManager();

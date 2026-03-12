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

  get clientCount(): number {
    return this.clients.size;
  }
}

export const wsServer = new WSServerManager();

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
  private messageQueue: WSMessage[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

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

      this.sendDirect(ws, { type: "connected", payload: { clientCount: this.clients.size }, timestamp: new Date().toISOString() });
    });

    this.startFlushing();
    console.log("[WSServer] WebSocket server initialized on /ws");
  }

  private startFlushing(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flush(), 50);
  }

  private flush(): void {
    if (this.messageQueue.length === 0 || this.clients.size === 0) {
      this.messageQueue = [];
      return;
    }

    const dedupedQueue: WSMessage[] = [];
    const seenNpcMoves = new Map<string, number>();

    for (let i = 0; i < this.messageQueue.length; i++) {
      const msg = this.messageQueue[i];
      if (msg.type === "npc_move") {
        const npcId = msg.payload.npcId as string;
        seenNpcMoves.set(npcId, i);
      }
    }

    for (let i = 0; i < this.messageQueue.length; i++) {
      const msg = this.messageQueue[i];
      if (msg.type === "npc_move") {
        const npcId = msg.payload.npcId as string;
        if (seenNpcMoves.get(npcId) === i) {
          dedupedQueue.push(msg);
        }
      } else {
        dedupedQueue.push(msg);
      }
    }

    this.messageQueue = [];

    if (dedupedQueue.length === 0) return;

    const batchMsg = JSON.stringify({
      type: "batch",
      payload: dedupedQueue,
      timestamp: new Date().toISOString(),
    });

    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(batchMsg); } catch { }
      }
    }
  }

  private sendDirect(ws: WebSocket, message: WSMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch { }
    }
  }

  private enqueue(message: WSMessage): void {
    this.messageQueue.push(message);
  }

  broadcast(message: WSMessage): void {
    this.enqueue(message);
  }

  broadcastNPCMove(npcId: string, targetBuilding: string, x: number, y: number): void {
    this.enqueue({
      type: "npc_move",
      payload: { npcId, targetBuilding, x, y },
      timestamp: new Date().toISOString(),
    });
  }

  broadcastBugFound(buildingId: string, severity: string, message: string): void {
    this.enqueue({
      type: "bug_found",
      payload: { buildingId, severity, message },
      timestamp: new Date().toISOString(),
    });
  }

  broadcastMetricUpdate(buildingId: string, metric: string, value: number): void {
    this.enqueue({
      type: "metric_update",
      payload: { buildingId, metric, value },
      timestamp: new Date().toISOString(),
    });
  }

  broadcastEscalation(npcId: string, building: string, fromCache: boolean, provider: string): void {
    this.enqueue({
      type: "escalation",
      payload: { npcId, building, fromCache, provider },
      timestamp: new Date().toISOString(),
    });
  }

  broadcastSeasonChange(season: string, score: number): void {
    this.enqueue({
      type: "season_change",
      payload: { season, score },
      timestamp: new Date().toISOString(),
    });
  }

  broadcastEventLog(type: string, message: string, severity: string): void {
    this.enqueue({
      type: "event_log",
      payload: { eventType: type, message, severity },
      timestamp: new Date().toISOString(),
    });
  }

  broadcastCityPatch(updatedBuilding: unknown, newHealthScore: number, newSeason: string): void {
    this.enqueue({
      type: "city_patch",
      payload: { updatedBuilding, newHealthScore, newSeason },
      timestamp: new Date().toISOString(),
    });
  }

  broadcastThought(npcId: string, thought: string, duration: number): void {
    const truncated = thought.length > 60 ? thought.slice(0, 57) + "…" : thought;
    this.enqueue({
      type: "npc_thought",
      payload: { npcId, thought: truncated, duration },
      timestamp: new Date().toISOString(),
    });
  }

  broadcastTestResult(buildingId: string, passed: number, failed: number, coverage: number | null): void {
    this.enqueue({
      type: "test_result",
      payload: { buildingId, passed, failed, coverage },
      timestamp: new Date().toISOString(),
    });
  }

  broadcastAlchemistResult(payload: {
    id: number | null;
    command: string;
    status: string;
    exitCode: number | null;
    durationMs: number;
    reason?: string | null;
  }): void {
    this.enqueue({
      type: "alchemist_result",
      payload,
      timestamp: new Date().toISOString(),
    });
  }

  broadcastBuildingStatusUpdate(buildingId: string, status: string): void {
    this.enqueue({
      type: "building_status_update",
      payload: { buildingId, status },
      timestamp: new Date().toISOString(),
    });
  }

  closeAll(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.messageQueue = [];
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

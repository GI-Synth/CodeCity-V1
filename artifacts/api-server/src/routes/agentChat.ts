/**
 * Agent Chat routes — REST API for the Agent Message Bus.
 */

import { Router } from "express";
import {
  getRecentMessages,
  getMessagesInWindow,
  getMessagesForAgent,
  getVotesForFinding,
  publish,
} from "../lib/agentMessageBus";

const router = Router();

/** GET /api/agent-chat/recent?limit=50 — recent messages from in-memory buffer */
router.get("/recent", (_req, res) => {
  const limit = Math.min(200, Math.max(1, Number(_req.query.limit) || 50));
  const messages = getRecentMessages(limit);
  res.json({ ok: true, messages });
});

/** GET /api/agent-chat/history?windowMs=3600000&limit=100 — messages from DB in time window */
router.get("/history", async (_req, res) => {
  const windowMs = Math.max(60_000, Number(_req.query.windowMs) || 3_600_000);
  const limit = Math.min(500, Math.max(1, Number(_req.query.limit) || 100));
  const messages = await getMessagesInWindow(windowMs, limit);
  res.json({ ok: true, messages });
});

/** GET /api/agent-chat/agent/:agentId?limit=50 — messages for a specific agent */
router.get("/agent/:agentId", async (req, res) => {
  const { agentId } = req.params;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const messages = await getMessagesForAgent(agentId, limit);
  res.json({ ok: true, messages });
});

/** GET /api/agent-chat/votes/:findingId — vote tally for a finding */
router.get("/votes/:findingId", async (req, res) => {
  const votes = await getVotesForFinding(req.params.findingId);
  res.json({ ok: true, votes });
});

/** POST /api/agent-chat/send — send a message onto the bus (for Mayor Chat / UI integration) */
router.post("/send", async (req, res) => {
  const { fromAgent, toAgent, messageType, content, findingId } = req.body as Record<string, unknown>;
  if (!fromAgent || !content) {
    res.status(400).json({ ok: false, error: "fromAgent and content are required" });
    return;
  }
  const msg = await publish({
    fromAgent: String(fromAgent),
    toAgent: String(toAgent ?? "all"),
    messageType: (messageType as "finding" | "question" | "info") ?? "info",
    content: String(content),
    findingId: findingId ? String(findingId) : null,
    vote: null,
    metadata: {},
  });
  res.json({ ok: true, message: msg });
});

export default router;

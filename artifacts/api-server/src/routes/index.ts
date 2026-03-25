import { Router, type IRouter } from "express";

import healthRouter from "./health";
import repoRouter from "./repo";
import cityRouter from "./city";
import agentsRouter from "./agents";
import knowledgeRouter from "./knowledge";
import eventsRouter from "./events";
import assetsRouter from "./assets";
import ollamaRouter from "./ollama";
import watchRouter from "./watch";
import sharedRouter from "./shared";
import settingsRouter from "./settings";
import metricsRouter from "./metrics";
import reportRouter from "./report";
import orchestratorRouter from "./orchestrator";
import alchemistRouter from "./alchemist";
import debugRouter from "./debug";
import graphRouter from "./graph";
import agentChatRouter from "./agentChat";
import logsRouter from "./logs";
import mayorRouter from "./mayor";
import providersRouter from "./providers";

const router: IRouter = Router();


router.use(healthRouter);
router.use("/repo", repoRouter);
router.use("/repo/watch", watchRouter);
router.use("/repos", repoRouter);
router.use("/city", cityRouter);
router.use("/agents", agentsRouter);
router.use("/knowledge", knowledgeRouter);
router.use("/events", eventsRouter);
router.use("/assets", assetsRouter);
router.use("/ollama", ollamaRouter);
router.use("/city", sharedRouter);
router.use("/shared", sharedRouter);
router.use("/settings", settingsRouter);
router.use("/metrics", metricsRouter);
router.use("/city", reportRouter);
router.use("/orchestrator", orchestratorRouter);
router.use("/alchemist", alchemistRouter);
router.use("/debug", debugRouter);
router.use("/graph", graphRouter);
router.use("/agent-chat", agentChatRouter);
router.use("/logs", logsRouter);
router.use("/mayor", mayorRouter);
router.use("/providers", providersRouter);

export default router;

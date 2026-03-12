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

export default router;

import { Router, type IRouter } from "express";
import healthRouter from "./health";
import repoRouter from "./repo";
import cityRouter from "./city";
import agentsRouter from "./agents";
import knowledgeRouter from "./knowledge";
import eventsRouter from "./events";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/repo", repoRouter);
router.use("/city", cityRouter);
router.use("/agents", agentsRouter);
router.use("/knowledge", knowledgeRouter);
router.use("/events", eventsRouter);

export default router;

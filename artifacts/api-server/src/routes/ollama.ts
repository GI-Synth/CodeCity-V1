import { Router, type IRouter } from "express";
import { ollamaClient } from "../lib/ollamaClient";

const router: IRouter = Router();

router.get("/status", async (_req, res) => {
  try {
    const available = await ollamaClient.isAvailable();
    const models = available ? await ollamaClient.listModels() : [];

    res.json({
      available,
      models,
      recommended: {
        primary: "deepseek-coder-v2:16b",
        fast: "deepseek-coder:6.7b",
      },
    });
  } catch {
    res.json({
      available: false,
      models: [],
      recommended: { primary: "deepseek-coder-v2:16b", fast: "deepseek-coder:6.7b" },
    });
  }
});

export default router;

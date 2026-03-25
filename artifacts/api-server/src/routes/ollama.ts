import { Router, type IRouter } from "express";
import { ollamaClient } from "../lib/ollamaClient";

const router: IRouter = Router();

function parseModelSizeInBillions(model: string): number | null {
  const match = model.toLowerCase().match(/(\d+(?:\.\d+)?)\s*b\b/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function pickFastestModel(models: string[]): string {
  let fastest = models[0];
  let smallestSize = Number.POSITIVE_INFINITY;

  for (const model of models) {
    const size = parseModelSizeInBillions(model);
    if (size !== null && size < smallestSize) {
      smallestSize = size;
      fastest = model;
    }
  }

  return fastest;
}

function pickLargestModel(models: string[]): string {
  let largest = models[0];
  let largestSize = Number.NEGATIVE_INFINITY;

  for (const model of models) {
    const size = parseModelSizeInBillions(model);
    if (size !== null && size > largestSize) {
      largestSize = size;
      largest = model;
    }
  }

  return largest;
}

function buildRecommendation(host: string, reachable: boolean, models: string[]): string {
  if (reachable && models.length > 0) {
    const fastestModel = pickFastestModel(models);
    const largestModel = pickLargestModel(models);
    return `Ready. Use ${fastestModel} for dialogue, ${largestModel} for analysis.`;
  }

  if (reachable) {
    return "Connected but no models pulled. Run: ollama pull deepseek-coder:6.7b";
  }

  return `Cannot reach ${host}. Check that Ollama is running and OLLAMA_HOST is set correctly in your .env file.`;
}

router.get("/status", async (_req, res) => {
  try {
    const connection = await ollamaClient.testConnection();
    const models = connection.reachable ? connection.models : [];

    res.json({
      available: connection.reachable,
      models,
      recommended: {
        primary: models.length > 0 ? pickLargestModel(models) : "deepseek-coder-v2:16b",
        fast: models.length > 0 ? pickFastestModel(models) : "deepseek-coder:6.7b",
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

router.get("/test-connection", async (_req, res) => {
  const connection = await ollamaClient.testConnection();

  res.json({
    host: connection.host,
    reachable: connection.reachable,
    models: connection.models,
    latencyMs: connection.latencyMs,
    recommendation: buildRecommendation(connection.host, connection.reachable, connection.models),
  });
});

export default router;

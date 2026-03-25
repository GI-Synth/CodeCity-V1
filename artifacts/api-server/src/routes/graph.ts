import { Router } from "express";
import {
  buildCodeGraph,
  getNode,
  getNeighbors,
  getCircularDeps,
  getHighRiskFiles,
  getDeadCode,
  getGraphSummary,
} from "../lib/codeGraph";
import path from "path";

const router = Router();

router.post("/rebuild", async (_req, res) => {
  try {
    const projectRoot = path.resolve(process.cwd());
    const result = await buildCodeGraph(projectRoot);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[Graph] Rebuild failed:", err);
    res.status(500).json({ error: "Graph rebuild failed" });
  }
});

router.get("/summary", async (_req, res) => {
  try {
    const summary = await getGraphSummary();
    res.json(summary);
  } catch (err) {
    console.error("[Graph] Summary failed:", err);
    res.status(500).json({ error: "Failed to get graph summary" });
  }
});

router.get("/node/:filePath", async (req, res) => {
  try {
    const node = await getNode(req.params.filePath);
    if (!node) {
      res.status(404).json({ error: "Node not found" });
      return;
    }
    res.json(node);
  } catch (err) {
    res.status(500).json({ error: "Failed to get node" });
  }
});

router.get("/neighbors/:filePath", async (req, res) => {
  try {
    const neighbors = await getNeighbors(req.params.filePath);
    res.json(neighbors);
  } catch (err) {
    res.status(500).json({ error: "Failed to get neighbors" });
  }
});

router.get("/circular-deps", async (_req, res) => {
  try {
    const cycles = await getCircularDeps();
    res.json({ cycles, count: cycles.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to get circular deps" });
  }
});

router.get("/high-risk", async (_req, res) => {
  try {
    const files = await getHighRiskFiles();
    res.json({ files, count: files.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to get high risk files" });
  }
});

router.get("/dead-code", async (_req, res) => {
  try {
    const files = await getDeadCode();
    res.json({ files, count: files.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to get dead code" });
  }
});

export default router;

import { Router, type IRouter } from "express";
import { getHeroCitySVG, getLogoSVG } from "../lib/assetGenerator";

const router: IRouter = Router();

router.get("/hero", (_req, res) => {
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(getHeroCitySVG());
});

router.get("/logo", (_req, res) => {
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(getLogoSVG());
});

export default router;

import express, { type Express } from "express";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import router from "./routes";

const app: Express = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("[:date[iso]] :method :url :status :response-time ms"));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down" },
});

const heavyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests for this heavy operation" },
});

app.use("/api/", apiLimiter);
app.use("/api/repo/load", heavyLimiter);
app.use("/api/city/at-commit", heavyLimiter);

app.use("/api", router);

export default app;

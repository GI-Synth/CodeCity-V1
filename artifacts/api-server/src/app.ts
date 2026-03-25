import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import router from "./routes";

const app: Express = express();

// Security headers
app.use(helmet());

// CORS – restrict to known origins (default: localhost dev server)
const allowedOrigins = (process.env["ALLOWED_ORIGINS"] ?? "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, etc.)
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
  }),
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(morgan("[:date[iso]] :method :url :status :response-time ms"));

// Global request timeout (2 minutes)
app.use((_req, res, next) => {
  res.setTimeout(120_000, () => {
    if (!res.headersSent) {
      res.status(408).json({ error: "Request timed out" });
    }
  });
  next();
});

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

if (process.env.NODE_ENV === "production") {
  const publicDir = new URL("../../public", import.meta.url).pathname;
  app.use(express.static(publicDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path === "/ws") return next();
    res.sendFile(new URL("../../public/index.html", import.meta.url).pathname);
  });
}

export default app;

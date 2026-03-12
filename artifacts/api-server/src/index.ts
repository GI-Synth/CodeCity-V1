import http from "http";
import app from "./app";
import { wsServer } from "./lib/wsServer";
import { startAgentLoop } from "./lib/agentEngine";
import { validateEnv } from "./lib/envValidator";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);

wsServer.initialize(server);

async function startServer(): Promise<void> {
  await validateEnv();

  server.listen(port, () => {
    console.log(`Server listening on port ${port}`);
    startAgentLoop();
  });
}

function shutdown(signal: string): void {
  console.log(`\nSoftware City shutting down cleanly (${signal})`);
  wsServer.closeAll();
  server.close(() => {
    console.log("HTTP server closed. Goodbye.");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

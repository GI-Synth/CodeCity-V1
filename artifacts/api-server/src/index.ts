import http from "http";
import app from "./app";
import { wsServer } from "./lib/wsServer";
import { startAgentLoop } from "./lib/agentEngine";

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

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  startAgentLoop();
});

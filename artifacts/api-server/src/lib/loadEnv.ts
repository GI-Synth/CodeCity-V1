import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import dotenv from "dotenv";

let cachedEnvPath: string | null | undefined;

export function loadEnvFile(): string | null {
  if (cachedEnvPath !== undefined) {
    return cachedEnvPath;
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  const explicitEnvPath = process.env["ENV_PATH"];
  const candidates = [
    explicitEnvPath ? resolve(explicitEnvPath) : null,
    resolve(process.cwd(), ".env"),
    resolve(__dirname, "../../.env"),
    resolve(__dirname, "../../../../.env"),
  ];

  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) continue;

    dotenv.config({ path: candidate, quiet: true });
    cachedEnvPath = candidate;
    return cachedEnvPath;
  }

  // Fallback to dotenv defaults if no candidate file is found.
  dotenv.config({ quiet: true });
  cachedEnvPath = null;
  return cachedEnvPath;
}

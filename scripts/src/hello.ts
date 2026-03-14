import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..");
const DB_PATH = process.env.DB_PATH ?? join(REPO_ROOT, "artifacts/api-server/data/city.db");

console.log("Hello from @workspace/scripts", { repoRoot: REPO_ROOT, dbPath: DB_PATH });

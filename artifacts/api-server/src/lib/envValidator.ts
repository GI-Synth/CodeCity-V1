import { ollamaClient } from "./ollamaClient";
import path from "path";

export async function validateEnv(): Promise<void> {
  const dbPath = process.env["DB_PATH"] ?? "./data/city.db";
  const groqKey = process.env["GROQ_API_KEY"];
  const anthropicKey = process.env["ANTHROPIC_API_KEY"];

  const ollamaAvailable = await ollamaClient.isAvailable().catch(() => false);
  let ollamaModels = 0;
  if (ollamaAvailable) {
    try {
      const models = await ollamaClient.listModels();
      ollamaModels = models.length;
    } catch { }
  }

  const rows = [
    ["SQLite DB", `✓ ${path.resolve(dbPath)}`],
    ["Ollama", ollamaAvailable ? `✓ Available (${ollamaModels} model${ollamaModels !== 1 ? "s" : ""})` : "✗ Unavailable (agents will escalate)"],
    ["GROQ_API_KEY", groqKey ? "✓ Set" : "○ Not set (optional)"],
    ["ANTHROPIC_API_KEY", anthropicKey ? "✓ Set" : "○ Not set (optional)"],
    ["File Watcher", "Ready"],
  ];

  const maxLabel = Math.max(...rows.map(r => r[0].length));
  const maxVal = Math.max(...rows.map(r => r[1].length));
  const totalWidth = maxLabel + maxVal + 7;

  console.log("┌" + "─".repeat(totalWidth) + "┐");
  console.log("│" + " SOFTWARE CITY — Environment Check".padEnd(totalWidth) + "│");
  console.log("├" + "─".repeat(maxLabel + 2) + "┬" + "─".repeat(maxVal + 2) + "┤");
  for (const [label, value] of rows) {
    console.log(`│ ${label.padEnd(maxLabel)} │ ${value.padEnd(maxVal)} │`);
  }
  console.log("└" + "─".repeat(maxLabel + 2) + "┴" + "─".repeat(maxVal + 2) + "┘");
}

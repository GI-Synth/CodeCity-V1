import { ollamaClient } from "./ollamaClient";

export async function validateEnv(): Promise<void> {
  const dbUrl = process.env["DATABASE_URL"];
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
    ["DATABASE_URL", dbUrl ? "✓ Connected" : "✗ MISSING (required)"],
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

  if (!dbUrl) {
    console.error("[EnvValidator] FATAL: DATABASE_URL is required. Cannot start without a database connection.");
    process.exit(1);
  }
}

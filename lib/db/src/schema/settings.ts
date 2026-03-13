import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const settingsTable = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const DEFAULT_SETTINGS: Record<string, string> = {
  escalation_provider: "groq",
  escalation_enabled: "true",
  ollama_fast_model: "deepseek-coder:6.7b",
  ollama_primary_model: "deepseek-coder-v2:16b",
  groq_model: "llama-3.3-70b-versatile",
  mayor_name: "Mayor",
  openrouter_model: "openrouter/codellama-70b",
  anthropic_model: "claude-sonnet-4-6",
  orchestrator_model: "rule-based",
  agent_loop_interval_ms: "8000",
  max_concurrent_agents: "8",
  kb_similarity_threshold: "0.65",
  test_timeout_ms: "15000",
  theme: "dark",
  tour_complete: "false",
  file_ignore_patterns: "node_modules,.git,dist,build",
  max_file_size_kb: "500",
};

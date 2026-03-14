#!/usr/bin/env tsx
/**
 * Checks all AI tiers and reports what's available.
 * Run: npx tsx scripts/check-ai.ts
 */
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..");

dotenv.config({ path: join(REPO_ROOT, ".env"), quiet: true });

async function checkOllama() {
  try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) });
    const data = await res.json() as { models: { name: string }[] };
    return { available: true, models: data.models.map(m => m.name) };
  } catch {
    return { available: false, models: [] };
  }
}
async function checkGroq() {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { available: false, reason: 'No GROQ_API_KEY' };
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });
    return { available: res.ok, reason: res.ok ? 'OK' : `HTTP ${res.status}` };
  } catch (e) {
    return { available: false, reason: String(e) };
  }
}
async function checkAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { available: false, reason: 'No ANTHROPIC_API_KEY' };
  return { available: true, reason: 'Key set (not tested)' };
}
async function checkOpenRouter() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { available: false, reason: 'No OPENROUTER_API_KEY' };
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });
    return { available: res.ok, reason: res.ok ? 'OK' : `HTTP ${res.status}` };
  } catch (e) {
    return { available: false, reason: String(e) };
  }
}

const [ollama, groq, anthropic, openrouter] = await Promise.all([
  checkOllama(),
  checkGroq(),
  checkAnthropic(),
  checkOpenRouter(),
]);

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(' Software City — AI Tier Status');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`\nTier 0 — Local (Ollama)`);
console.log(` Status: ${ollama.available ? '✓ Running' : '✗ Not running'}`);
if (ollama.available) {
  ollama.models.forEach(m => console.log(` Model: ${m}`));
  if (ollama.models.length === 0) console.log(' ⚠ No models pulled yet');
} else {
  console.log(' Fix: ollama serve (or install from ollama.com)');
}
console.log(`\nTier 1 — Free Cloud`);
console.log(` Groq: ${groq.available ? '✓' : '✗'} ${groq.reason}`);
console.log(` OpenRouter: ${openrouter.available ? '✓' : '✗'} ${openrouter.reason}`);
if (!groq.available && !openrouter.available) {
  console.log(' Fix: add GROQ_API_KEY to .env (free at console.groq.com)');
}
console.log(`\nTier 2 — Paid Cloud`);
console.log(` Anthropic: ${anthropic.available ? '✓' : '✗'} ${anthropic.reason}`);
const anyAvailable = ollama.available || groq.available || openrouter.available;
console.log(`\n${anyAvailable ? '✓ At least one AI tier available — agents can run' : '✗ NO AI AVAILABLE — agents will idle. Add a free Groq key.'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
export {};

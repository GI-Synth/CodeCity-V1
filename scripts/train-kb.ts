#!/usr/bin/env tsx
/**
 * SOFTWARE CITY - Expert KB trainer
 *
 * Usage:
 *   pnpm train-kb
 *   pnpm train-kb --dry-run
 */
import fs from "fs";
import dotenv from "dotenv";
import { createClient } from "@libsql/client";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join, resolve } from "path";
import { ProviderCircuitBreaker } from "../artifacts/api-server/src/lib/providerCircuitBreaker";

type ProviderName = "groq" | "openrouter" | "cerebras" | "ollama-cloud" | "ollama-local" | "anthropic" | "static" | "expert-seed";
type Domain = "general" | "ui" | "audio" | "plugin" | "dsp" | "ai";
type RepoCategory = "general" | "audio" | "ui" | "ai";
type Confidence = "high" | "medium" | "low";

interface TargetRepo {
  slug: string;
  category: RepoCategory;
}

interface RepoTreeItem {
  path?: string;
  type?: string;
  size?: number;
}

interface RepoTreeResponse {
  tree?: RepoTreeItem[];
}

interface RepoMetaResponse {
  default_branch?: string;
}

interface FileCandidate {
  path: string;
  size: number;
  branch: string;
}

interface ProviderStatus {
  groqReady: boolean;
  groqStatusMessage: string;
  openRouterReady: boolean;
  openRouterStatusMessage: string;
  cerebrasReady: boolean;
  cerebrasStatusMessage: string;
  ollamaCloudReady: boolean;
  ollamaCloudStatusMessage: string;
  ollamaCloudModel: string | null;
  ollamaCloudModels: string[];
  ollamaLocalReady: boolean;
  ollamaLocalStatusMessage: string;
  ollamaLocalModels: string[];
  anthropicReady: boolean;
  anthropicStatusMessage: string;
}

interface PatternDraft {
  language: string;
  problemType: string;
  question: string;
  answer: string;
  confidence: Confidence;
  domain: Domain;
  patternTags: string[];
  actionItems: string[];
}

interface KnowledgeInsertRow {
  problemType: string;
  language: string;
  question: string;
  answer: string;
  codeSnippet: string;
  patternTags: string[];
  actionItems: string[];
  confidence: Confidence;
  provider: ProviderName;
  contextHash: string;
  qualityScore: number;
}

interface ProviderCallResult {
  ok: boolean;
  provider: ProviderName;
  patterns: PatternDraft[];
  model?: string;
  reason?: "no_key" | "rate_limit" | "unavailable" | "parse_error" | "network_error";
  message?: string;
}

interface RepoStats {
  filesProcessed: number;
  patternsAdded: number;
  duplicates: number;
}

interface TrainProgress {
  version: 1;
  startedAt: string;
  updatedAt: string;
  completedRepos: string[];
  seedsCompleted: boolean;
  providerUsage: Record<ProviderName, number>;
  domainCounts: Record<Domain, number>;
  added: number;
  duplicates: number;
  filesProcessed: number;
  repoStats: Record<string, RepoStats>;
}

interface TrainingSummary {
  general: number;
  ui: number;
  audio: number;
  plugin: number;
  dsp: number;
  ai: number;
  total: number;
  newThisRun: number;
  duplicates: number;
}

interface SeedSpec {
  language: "javascript" | "typescript" | "cpp" | "general";
  problemType: string;
  question: string;
  explanation: string;
  code: string;
  why: string;
  domain: Domain;
}

interface AnalyzeFileResult {
  provider: ProviderName;
  model?: string;
  patterns: PatternDraft[];
}

interface SmokeTestResult {
  ok: boolean;
  message: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..");

dotenv.config({ path: join(REPO_ROOT, ".env"), quiet: true, override: true });

const DB_PATH = (process.env.DB_PATH?.trim() ?? "") || join(REPO_ROOT, "artifacts/api-server/data/city.db");
const PROGRESS_PATH = join(REPO_ROOT, ".codecity/train-kb-progress.json");

const GROQ_API_KEY = process.env.GROQ_API_KEY?.trim() ?? "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim() ?? "";
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY?.trim() ?? "";
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY?.trim() ?? "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
const OLLAMA_HOST = (process.env.OLLAMA_HOST?.trim() ?? "") || "http://localhost:11434";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN?.trim() ?? "";

const DRY_RUN = process.argv.includes("--dry-run");

const MAX_FILES_PER_REPO = Math.max(1, Number(process.env.TRAIN_KB_MAX_FILES?.trim() || "12"));
const MAX_FILE_BYTES = 380_000;
const MAX_FILE_CHARS_FOR_PROMPT = 10_000;
const GITHUB_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 30_000;
const OLLAMA_LOCAL_TIMEOUT_MS = 60_000;
const OPENROUTER_TIMEOUT_MS = 45_000;

const OLLAMA_CLOUD_MODEL_HINT = (process.env.OLLAMA_CLOUD_MODEL?.trim() ?? "") || "qwen3:14b";
const OLLAMA_CLOUD_FALLBACK_MODELS = [
  "ministral-3:14b",
  "gemma3:12b",
  "gpt-oss:20b",
  "gpt-oss:120b",
  "nemotron-3-super",
  "devstral-small-2:24b",
];
const OPENROUTER_MODEL = (process.env.OPENROUTER_MODEL?.trim() ?? "") || "nvidia/nemotron-3-super-120b-a12b:free";
const OPENROUTER_FALLBACK_MODELS = [
  OPENROUTER_MODEL,
  "qwen/qwen3-coder:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemma-3-27b-it:free",
];
const OPENROUTER_MAX_TOKENS = Math.max(300, Number(process.env.OPENROUTER_MAX_TOKENS?.trim() || "1200") || 1200);
const CEREBRAS_MODEL = (process.env.CEREBRAS_MODEL?.trim() ?? "") || "llama3.1-8b";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const ANTHROPIC_MODEL = "claude-haiku-4-5";
const OPENROUTER_REFERER = "https://software-city.local";
const OPENROUTER_TITLE = "Software City";
const OLLAMA_LOCAL_ULTRALIGHT_MODELS = [
  "smollm2:135m",
  "qwen2.5:0.5b",
  "tinyllama:1.1b",
  "smollm2:360m",
  "qwen2.5:1.5b",
  "smollm2:1.7b",
  "qwen2.5:3b",
];

const TARGET_REPOS: TargetRepo[] = [
  { slug: "expressjs/express", category: "general" },
  { slug: "axios/axios", category: "general" },
  { slug: "lodash/lodash", category: "general" },
  { slug: "prisma/prisma", category: "general" },
  { slug: "vitejs/vite", category: "general" },
  { slug: "facebook/react", category: "general" },
  { slug: "vercel/next.js", category: "general" },
  { slug: "tailwindlabs/tailwindcss", category: "general" },
  { slug: "Tonejs/Tone.js", category: "audio" },
  { slug: "wavesurfer-js/wavesurfer.js", category: "audio" },
  { slug: "tambien/standardized-audio-context", category: "audio" },
  { slug: "djipco/webmidi", category: "audio" },
  { slug: "goldfire/howler.js", category: "audio" },
  { slug: "meyda/meyda", category: "audio" },
  { slug: "radix-ui/primitives", category: "ui" },
  { slug: "framer/motion", category: "ui" },
  { slug: "floating-ui/floating-ui", category: "ui" },
  { slug: "recharts/recharts", category: "ui" },
  { slug: "promptfoo/promptfoo", category: "ai" },
  { slug: "karpathy/nanoGPT", category: "ai" },
  { slug: "pbakaus/impeccable", category: "ai" },
  { slug: "microsoft/autogen", category: "ai" },
  { slug: "langchain-ai/langchainjs", category: "ai" },
];

const GENERAL_CODE_QUALITY_TOPICS = [
  "Async/await missing error handling",
  "Promise chain error propagation",
  "Missing null checks before property access",
  "Race conditions in async code",
  "Memory leak patterns (event listeners not removed)",
  "Circular dependency patterns",
  "Input validation missing on public APIs",
  "SQL/NoSQL injection patterns",
  "Missing rate limiting on endpoints",
  "Insecure direct object reference",
  "Dead code and unreachable branches",
  "Type coercion bugs (== vs ===)",
  "Off-by-one errors in loops",
  "Missing return values in async functions",
  "Unhandled edge cases in recursive functions",
];

const UI_UX_TOPICS = [
  "Missing loading states on async operations",
  "No error boundary around components",
  "Missing aria labels on interactive elements",
  "Focus trap not implemented in modals",
  "Missing keyboard navigation support",
  "Color contrast accessibility violations",
  "Missing skeleton screens for slow data",
  "Form validation only on submit not inline",
  "Missing empty state UI when list is empty",
  "No debounce on expensive search inputs",
  "Missing optimistic UI updates",
  "Scroll position not restored on navigation",
  "Missing responsive breakpoints",
  "Images without alt text",
  "Missing touch targets on mobile (under 44px)",
];

const ARCHITECTURE_TOPICS = [
  "God objects doing too many things",
  "Missing dependency injection",
  "Tight coupling between unrelated modules",
  "Missing abstraction layers",
  "Violation of single responsibility principle",
  "Missing interface definitions for external services",
  "Hard-coded configuration values",
  "Missing environment validation on startup",
  "No graceful shutdown handling",
  "Missing health check endpoints",
  "Synchronous operations blocking event loop",
  "Missing retry logic on network calls",
  "No circuit breaker pattern for external APIs",
  "Missing request timeout handling",
  "N+1 database query patterns",
];

const PERFORMANCE_TOPICS = [
  "Missing database indexes on frequent queries",
  "Fetching more data than needed",
  "Missing pagination on large datasets",
  "Expensive computation in render cycles",
  "Missing memoization on pure functions",
  "Bundle size not optimized",
  "Missing CDN for static assets",
  "Waterfall requests instead of parallel",
  "Large images not compressed or lazy loaded",
];

const SECURITY_TOPICS = [
  "Missing CSRF protection",
  "Missing Content Security Policy headers",
  "Sensitive data in URL parameters",
  "Missing HTTPS enforcement",
  "JWT stored in localStorage",
  "Missing input sanitization before DB write",
  "Stack traces exposed in production errors",
  "Missing brute force protection on auth",
  "Weak password requirements",
  "Missing audit logging for sensitive operations",
];

const AI_SYSTEM_TOPICS = [
  "LLM prompt not versioned or tracked",
  "Missing fallback when primary model unavailable",
  "No retry with exponential backoff on API timeout",
  "Prompt injection not sanitized from user input",
  "Missing token count estimation before API call",
  "Context window overflow not handled gracefully",
  "No evaluation harness for AI output quality",
  "Missing structured output validation after LLM call",
  "Hallucination not detected in factual responses",
  "Missing cost tracking per LLM call",
  "No caching layer for identical prompts",
  "System prompt leaking in error messages",
  "Missing rate limit handling across multiple keys",
  "No A/B testing framework for prompt variants",
  "Agent loop without max iteration limit",
  "Missing human-in-the-loop for high-stakes actions",
  "No observability or tracing for agent decisions",
  "Tool call results not validated before use",
  "Missing agent memory summarization for long runs",
  "Parallel agent calls not deduplicated",
];

const AUDIO_SOFTWARE_TOPICS = [
  "AudioContext not resumed after user gesture",
  "AudioNode connections not disconnected on cleanup",
  "Buffer underrun risks in real-time audio",
  "MIDI message handling without input validation",
  "Sample rate mismatch between nodes",
  "AudioWorklet thread communication errors",
  "ScriptProcessorNode not replaced with AudioWorklet",
  "Float32Array buffer reuse causing glitches",
  "AudioContext suspended state not handled",
  "Missing audio graph cleanup on component unmount",
  "GainNode value set directly causing clicking",
  "Missing linearRampToValueAtTime for smooth transitions",
  "AudioContext not closed after use",
  "ConvolverNode IR buffer too large",
  "AnalyserNode FFT size not power of 2",
  "Missing OfflineAudioContext for pre-rendering",
  "Web Audio timing using setTimeout instead of AudioContext.currentTime",
  "Missing crossfade between audio sources",
  "AudioBuffer not reused causing excessive allocation",
  "Missing audio worklet error handling",
];

const MUSIC_THEORY_TOPICS = [
  "Missing octave boundary checking in note calculations",
  "MIDI note number out of range not validated",
  "BPM not validated as positive number",
  "Time signature denominator must be power of 2",
  "Missing quantization rounding for note timing",
  "Chord voicing not normalized to same octave",
  "Scale degree calculation missing modulo wrap",
  "Missing enharmonic equivalence in note comparison",
  "Tempo changes not synced to audio clock",
  "Missing swing/groove quantization support",
  "Note duration not validated against time signature",
  "Missing polyphony limit causing voice stealing",
  "Pitch detection not handling harmonics",
  "Missing pitch class normalization mod 12",
  "Interval calculation not handling negatives",
];

const PLUGIN_TOPICS = [
  "Parameter automation without thread safety",
  "Memory allocation in audio callback",
  "Missing denormal number handling",
  "Plugin state not saved in getStateInformation",
  "Missing setStateInformation for recall",
  "MIDI channel filtering not implemented",
  "Latency compensation not reported to host",
  "Sample-accurate parameter changes not implemented",
  "Missing bypass processing path",
  "Audio tail not handled on plugin disable",
  "Missing prepareToPlay initialization",
  "Buffer size assumptions never assume fixed size",
  "Sample rate assumptions never assume 44100",
  "Missing thread-safe parameter smoothing",
  "GUI updates from audio thread causes crashes",
  "Missing MIDI learn functionality",
  "Preset system not implemented",
  "Missing undo/redo for parameter changes",
  "CPU usage not optimized for silence",
  "Missing oversampling for non-linear processing",
];

const SOUND_ENGINE_TOPICS = [
  "Missing audio engine abstraction layer",
  "Hard-coded sample rate in DSP algorithms",
  "Missing interpolation in wavetable lookup",
  "Aliasing artifacts in oscillator implementation",
  "Missing anti-aliasing for non-linear waveshaping",
  "Filter coefficient not updated on sample rate change",
  "Missing DC offset removal after distortion",
  "Delay buffer size assumes fixed block size",
  "Missing wet/dry mix control",
  "Reverb tail clipped on buffer boundary",
  "Envelope not smoothed causes zipper noise",
  "LFO not synced to host tempo",
  "Missing stereo width control",
  "Mono compatibility not checked",
  "Missing LUFS metering for loudness normalization",
];

const DSP_TOPICS = [
  "FFT size not power of 2",
  "Missing window function before FFT",
  "Spectral leakage not handled",
  "Phase vocoder artifacts not smoothed",
  "Missing overlap-add in STFT processing",
  "Convolution not using FFT for large kernels",
  "IIR filter instability at extreme settings",
  "Missing filter warmup for feedback filters",
  "Biquad coefficient overflow at low frequencies",
  "Missing saturation to prevent digital clipping",
  "RMS calculation window too short",
  "Peak detection missing hold time",
  "Compressor attack/release in samples not ms",
  "Missing soft knee in dynamics processing",
  "Limiter lookahead not implemented",
];

const ALL_EXTRACTION_TOPICS = [
  ...GENERAL_CODE_QUALITY_TOPICS,
  ...UI_UX_TOPICS,
  ...ARCHITECTURE_TOPICS,
  ...PERFORMANCE_TOPICS,
  ...SECURITY_TOPICS,
  ...AI_SYSTEM_TOPICS,
  ...AUDIO_SOFTWARE_TOPICS,
  ...MUSIC_THEORY_TOPICS,
  ...PLUGIN_TOPICS,
  ...SOUND_ENGINE_TOPICS,
  ...DSP_TOPICS,
];

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".php",
  ".cs",
  ".cpp",
  ".cc",
  ".cxx",
  ".c",
  ".h",
  ".hpp",
  ".swift",
  ".kt",
  ".scala",
  ".lua",
  ".sh",
  ".sql",
]);

const STATIC_RULES: Array<{
  problemType: string;
  domain: Domain;
  regex: RegExp;
  summary: string;
  fix: string;
  tags: string[];
  actions: string[];
}> = [
  {
    problemType: "async_without_error_handling",
    domain: "general",
    regex: /async\s+function|await\s+[A-Za-z_$]/,
    summary: "Async flow appears without visible try/catch or equivalent boundary handling.",
    fix: "Wrap async boundaries in try/catch and propagate structured failures.",
    tags: ["async", "error-handling"],
    actions: ["Add try/catch", "Add failure-path tests"],
  },
  {
    problemType: "promise_without_catch",
    domain: "general",
    regex: /\.then\(/,
    summary: "Promise chaining detected; verify rejection paths are handled for all branches.",
    fix: "Append catch handlers or migrate to await with explicit error handling.",
    tags: ["promise", "error-propagation"],
    actions: ["Add catch handlers", "Test rejection flow"],
  },
  {
    problemType: "type_coercion_equality",
    domain: "general",
    regex: /[^=!]==[^=]|[^=!]!=[^=]/,
    summary: "Loose equality can hide coercion-related edge cases.",
    fix: "Replace loose comparisons with strict equality operators.",
    tags: ["coercion", "equality"],
    actions: ["Replace ==/!= with ===/!==", "Add mixed-type tests"],
  },
  {
    problemType: "react_missing_error_boundary",
    domain: "ui",
    regex: /ReactDOM\.createRoot|function\s+[A-Z][A-Za-z0-9_]*\s*\(/,
    summary: "UI component flow detected; verify an error boundary guards key render surfaces.",
    fix: "Introduce an error boundary around major routed/subtree components.",
    tags: ["react", "ui", "error-boundary"],
    actions: ["Add boundary component", "Cover fallback UX in tests"],
  },
  {
    problemType: "a11y_missing_labels",
    domain: "ui",
    regex: /<button|<input|<select|<textarea/,
    summary: "Interactive elements detected; check ARIA labels and keyboard accessibility.",
    fix: "Provide accessible names, tab focus order, and keyboard interactions.",
    tags: ["a11y", "aria", "keyboard"],
    actions: ["Add aria-label/label", "Add keyboard nav tests"],
  },
  {
    problemType: "ai_prompt_injection_guard_missing",
    domain: "ai",
    regex: /prompt|system\s*prompt|llm|openai|anthropic|groq/i,
    summary: "AI orchestration hints detected; verify prompt-injection sanitization before model calls.",
    fix: "Sanitize user context, bound tool usage, and validate model outputs.",
    tags: ["ai", "prompt-injection", "validation"],
    actions: ["Add input sanitizer", "Validate structured outputs"],
  },
  {
    problemType: "audio_context_resume",
    domain: "audio",
    regex: /AudioContext|webkitAudioContext/,
    summary: "AudioContext usage detected; ensure resumed after user gesture and state transitions handled.",
    fix: "Resume on gesture and branch on suspended/running state.",
    tags: ["audio", "audiocontext"],
    actions: ["Resume on user gesture", "Handle suspended state"],
  },
  {
    problemType: "audio_scheduling_accuracy",
    domain: "audio",
    regex: /setTimeout\(|setInterval\(/,
    summary: "Timer-based scheduling can drift for audio timing critical paths.",
    fix: "Schedule to AudioContext.currentTime and use precise lookahead windows.",
    tags: ["audio", "timing"],
    actions: ["Use currentTime scheduling", "Add timing drift tests"],
  },
  {
    problemType: "plugin_audio_thread_allocation",
    domain: "plugin",
    regex: /processBlock|AudioProcessor|malloc|new\s+/,
    summary: "Plugin/DSP callback patterns detected; avoid allocations in real-time audio threads.",
    fix: "Pre-allocate buffers during init and keep callback branchless where possible.",
    tags: ["plugin", "real-time", "allocation"],
    actions: ["Move allocations out of callback", "Profile callback timing"],
  },
  {
    problemType: "dsp_fft_power_of_two",
    domain: "dsp",
    regex: /FFT|fft|analyser/i,
    summary: "FFT-related code found; validate FFT size and windowing assumptions.",
    fix: "Use power-of-two FFT sizes and apply an explicit window function.",
    tags: ["dsp", "fft", "windowing"],
    actions: ["Enforce FFT size constraints", "Apply Hann/Hamming window"],
  },
];

const db = createClient({ url: `file:${DB_PATH}` });

type TrainCircuitProvider = "groq" | "openrouter" | "cerebras" | "ollama-cloud" | "ollama-local" | "anthropic";

const trainProviderCircuit = new ProviderCircuitBreaker<TrainCircuitProvider>({
  groq: {
    failureThreshold: 2,
    baseCooldownMs: 60_000,
    maxCooldownMs: 30 * 60_000,
  },
  openrouter: {
    failureThreshold: 2,
    baseCooldownMs: 45_000,
    maxCooldownMs: 10 * 60_000,
  },
  cerebras: {
    failureThreshold: 2,
    baseCooldownMs: 45_000,
    maxCooldownMs: 10 * 60_000,
  },
  "ollama-cloud": {
    failureThreshold: 2,
    baseCooldownMs: 30_000,
    maxCooldownMs: 10 * 60_000,
  },
  "ollama-local": {
    failureThreshold: 2,
    baseCooldownMs: 15_000,
    maxCooldownMs: 3 * 60_000,
  },
  anthropic: {
    failureThreshold: 2,
    baseCooldownMs: 60_000,
    maxCooldownMs: 10 * 60_000,
  },
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactLogText(input: string, max = 240): string {
  return input.replace(/\s+/g, " ").trim().slice(0, max);
}

function isGroqHardQuotaMessage(message: string): boolean {
  return /\bTPD\b|tokens per day|rate limit reached for model/i.test(message);
}

function shouldCountAsCircuitFailure(reason: ProviderCallResult["reason"] | undefined): boolean {
  return reason !== "no_key";
}

function canAttemptTrainProvider(
  provider: TrainCircuitProvider,
  startupReady: boolean,
  startupMessage: string,
): { allowed: boolean; reason: string } {
  if (!startupReady) {
    return {
      allowed: false,
      reason: `provider unavailable from startup test: ${startupMessage}`,
    };
  }

  const gate = trainProviderCircuit.shouldAllow(provider);
  if (!gate.allowed) {
    return {
      allowed: false,
      reason: `circuit ${gate.state} (${gate.reason ?? "blocked"}) retry in ${gate.retryAfterMs}ms`,
    };
  }

  if (gate.state === "half-open") {
    console.log(`[${provider}] circuit half-open probe`);
  }

  return { allowed: true, reason: "" };
}

function markTrainProviderSuccess(provider: TrainCircuitProvider): void {
  const before = trainProviderCircuit.snapshot(provider);
  trainProviderCircuit.onSuccess(provider);
  const after = trainProviderCircuit.snapshot(provider);

  if (before.state !== "closed" || after.state !== "closed") {
    console.log(
      `[${provider}] circuit state=${after.state} failures=${after.consecutiveFailures} opened=${after.openedCount}`,
    );
  }
}

function markTrainProviderFailure(
  provider: TrainCircuitProvider,
  message: string,
  options: { forceOpen?: boolean; cooldownMs?: number } = {},
): void {
  trainProviderCircuit.onFailure(provider, message, options);
  const after = trainProviderCircuit.snapshot(provider);

  if (after.state === "open") {
    console.log(
      `[${provider}] circuit open retry_in=${after.remainingCooldownMs}ms reason=${compactLogText(message, 180)}`,
    );
  }
}

export function resetTrainProviderCircuitForTests(provider?: TrainCircuitProvider): void {
  trainProviderCircuit.reset(provider);
}

export function getTrainProviderCircuitSnapshotForTests(provider: TrainCircuitProvider) {
  return trainProviderCircuit.snapshot(provider);
}

export function canAttemptTrainProviderForTests(
  provider: TrainCircuitProvider,
  startupReady = true,
  startupMessage = "ready",
): { allowed: boolean; reason: string } {
  return canAttemptTrainProvider(provider, startupReady, startupMessage);
}

export function markTrainProviderFailureForTests(
  provider: TrainCircuitProvider,
  message: string,
  options: { forceOpen?: boolean; cooldownMs?: number } = {},
): void {
  markTrainProviderFailure(provider, message, options);
}

export function markTrainProviderSuccessForTests(provider: TrainCircuitProvider): void {
  markTrainProviderSuccess(provider);
}

function buildHttpErrorMessage(status: number, raw: string): string {
  const body = compactLogText(raw);
  if (status === 599) return body || "Network error";
  return body ? `HTTP ${status}: ${body}` : `HTTP ${status}`;
}

function textFromOpenAiContent(value: unknown): string {
  if (typeof value === "string") return value.trim();

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
          return String((item as { text?: unknown }).text);
        }
        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

function describeOpenRouterResponse(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {
      choices?: Array<{
        finish_reason?: unknown;
        message?: {
          content?: unknown;
          reasoning?: unknown;
        };
      }>;
    };

    const choice = parsed.choices?.[0];
    const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : "unknown";
    const content = choice?.message?.content;
    const reasoning = choice?.message?.reasoning;
    const contentType = Array.isArray(content) ? "array" : typeof content;
    const contentLen = textFromOpenAiContent(content).length;
    const reasoningLen = typeof reasoning === "string" ? reasoning.length : 0;

    return `finish_reason=${finishReason}, content_type=${contentType}, content_len=${contentLen}, reasoning_len=${reasoningLen}`;
  } catch {
    return "unparseable_response";
  }
}

function openRouterModelCandidates(): string[] {
  return Array.from(new Set(OPENROUTER_FALLBACK_MODELS.map((value) => value.trim()).filter(Boolean)));
}

function buildOpenRouterRequestBody(model: string, systemPrompt: string, userPrompt: string, maxTokens: number): Record<string, unknown> {
  return {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    // Disable reasoning traces so model output lands in message.content JSON.
    reasoning: { exclude: true },
  };
}

async function postOpenRouter(model: string, systemPrompt: string, userPrompt: string, maxTokens: number): Promise<{ ok: boolean; status: number; raw: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await (async (): Promise<{ ok: boolean; status: number; raw: string }> => {
      try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": OPENROUTER_REFERER,
            "X-Title": OPENROUTER_TITLE,
          },
          body: JSON.stringify(buildOpenRouterRequestBody(model, systemPrompt, userPrompt, maxTokens)),
          signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
        });

        return {
          ok: res.ok,
          status: res.status,
          raw: await res.text(),
        };
      } catch (error) {
        return { ok: false, status: 599, raw: String(error) };
      }
    })();

    const timeoutLike = response.status === 599 && /timeout|aborted/i.test(response.raw);
    const rateLimited = response.status === 429 || /rate limit|too many requests/i.test(response.raw);

    if ((timeoutLike || rateLimited) && attempt === 0) {
      await sleep(timeoutLike ? 1_500 : 3_000);
      continue;
    }

    return response;
  }

  return { ok: false, status: 599, raw: "OpenRouter request failed after retry" };
}

function shortFileName(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  return idx >= 0 ? filePath.slice(idx + 1) : filePath;
}

function hashText(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16);
}

function detectLanguage(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "javascript";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".cpp") || lower.endsWith(".cc") || lower.endsWith(".c") || lower.endsWith(".h") || lower.endsWith(".hpp")) return "cpp";
  if (lower.endsWith(".rs")) return "rust";
  if (lower.endsWith(".go")) return "go";
  if (lower.endsWith(".java")) return "java";
  return "general";
}

function countLoc(content: string): number {
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}

function estimateComplexity(content: string): number {
  if (!content) return 0;
  const tokenMatches = content.match(/\bif\b|\belse\s+if\b|\bfor\b|\bwhile\b|\bcase\b|\bcatch\b|&&|\|\||\?/g);
  return (tokenMatches?.length ?? 0) + 1;
}

function categoryToDomain(category: RepoCategory): Extract<Domain, "general" | "ui" | "audio" | "ai"> {
  if (category === "ui") return "ui";
  if (category === "audio") return "audio";
  if (category === "ai") return "ai";
  return "general";
}

function confidenceToScore(confidence: Confidence, provider: ProviderName): number {
  if (provider === "static") return 0.5;
  if (provider === "expert-seed") return 0.95;
  if (confidence === "high") return 0.9;
  if (confidence === "medium") return 0.72;
  return 0.6;
}

function normalizeConfidence(value: unknown): Confidence {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "medium";
}

function shouldAnalyzeFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  const ext = `.${lower.split(".").pop() ?? ""}`;

  if (!CODE_EXTENSIONS.has(ext)) return false;
  if (lower.includes("node_modules/")) return false;
  if (lower.includes("/dist/") || lower.startsWith("dist/")) return false;
  if (lower.includes("/build/") || lower.startsWith("build/")) return false;
  if (lower.includes("/.next/")) return false;
  if (lower.includes("/coverage/")) return false;
  if (lower.includes("/__tests__/")) return false;
  if (lower.includes("/tests/") || lower.startsWith("tests/")) return false;
  if (lower.includes("/test/") || lower.startsWith("test/")) return false;
  if (lower.endsWith(".spec.ts") || lower.endsWith(".spec.js") || lower.endsWith(".test.ts") || lower.endsWith(".test.js")) return false;
  return true;
}

function extractOwnerRepo(slug: string): { owner: string; repo: string } {
  const [owner, repo] = slug.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repo slug: ${slug}`);
  }
  return { owner, repo };
}

function toRawFileUrl(slug: string, branch: string, filePath: string): string {
  const { owner, repo } = extractOwnerRepo(slug);
  const encodedPath = filePath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encodedPath}`;
}

function renderProgressBar(current: number, total: number): string {
  const safeTotal = Math.max(1, total);
  const pct = Math.min(100, Math.round((current / safeTotal) * 100));
  const filled = Math.min(10, Math.max(0, Math.round((pct / 100) * 10)));
  const bar = `${"█".repeat(filled)}${"░".repeat(10 - filled)}`;
  return `[${bar}] ${pct}% — ${current}/${safeTotal} patterns`;
}

function emptyProviderUsage(): Record<ProviderName, number> {
  return {
    groq: 0,
    openrouter: 0,
    cerebras: 0,
    "ollama-cloud": 0,
    "ollama-local": 0,
    anthropic: 0,
    static: 0,
    "expert-seed": 0,
  };
}

function emptyDomainCounts(): Record<Domain, number> {
  return {
    general: 0,
    ui: 0,
    audio: 0,
    plugin: 0,
    dsp: 0,
    ai: 0,
  };
}

function createNewProgress(): TrainProgress {
  const now = new Date().toISOString();
  return {
    version: 1,
    startedAt: now,
    updatedAt: now,
    completedRepos: [],
    seedsCompleted: false,
    providerUsage: emptyProviderUsage(),
    domainCounts: emptyDomainCounts(),
    added: 0,
    duplicates: 0,
    filesProcessed: 0,
    repoStats: {},
  };
}

function loadProgress(): TrainProgress {
  if (!fs.existsSync(PROGRESS_PATH)) return createNewProgress();

  try {
    const raw = fs.readFileSync(PROGRESS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<TrainProgress>;
    const current = createNewProgress();
    return {
      ...current,
      ...parsed,
      providerUsage: { ...current.providerUsage, ...(parsed.providerUsage ?? {}) },
      domainCounts: { ...current.domainCounts, ...(parsed.domainCounts ?? {}) },
      completedRepos: Array.isArray(parsed.completedRepos) ? parsed.completedRepos : [],
      repoStats: parsed.repoStats ?? {},
      seedsCompleted: Boolean(parsed.seedsCompleted),
      version: 1,
      startedAt: parsed.startedAt || current.startedAt,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return createNewProgress();
  }
}

function saveProgress(progress: TrainProgress): void {
  if (DRY_RUN) return;
  fs.mkdirSync(dirname(PROGRESS_PATH), { recursive: true });
  const payload: TrainProgress = {
    ...progress,
    updatedAt: new Date().toISOString(),
    version: 1,
  };
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(payload, null, 2));
}

function buildExtractionTopicsText(): string {
  return ALL_EXTRACTION_TOPICS.map((topic) => `- ${topic}`).join("\n");
}

function estimateDryRunByDomain(): Record<Domain, number> {
  const estimate = emptyDomainCounts();
  const estimatedPerFile = 2;
  for (const repo of TARGET_REPOS) {
    const domain = categoryToDomain(repo.category);
    estimate[domain] += MAX_FILES_PER_REPO * estimatedPerFile;
  }
  // 50 direct expert seeds across domains.
  estimate.audio += 25;
  estimate.plugin += 10;
  estimate.dsp += 10;
  estimate.ai += 5;
  return estimate;
}

async function checkOllamaLocal(skipNetwork: boolean): Promise<{ ready: boolean; models: string[] }> {
  if (skipNetwork) return { ready: false, models: [] };

  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(2_500) });
    if (!res.ok) return { ready: false, models: [] };
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    const models = (data.models ?? [])
      .map((item) => (item.name ?? "").trim())
      .filter((name) => name.length > 0);
    return { ready: true, models };
  } catch {
    return { ready: false, models: [] };
  }
}

async function fetchOllamaCloudModels(): Promise<string[]> {
  if (!OLLAMA_API_KEY) return [];

  try {
    const res = await fetch("https://ollama.com/api/tags", {
      headers: {
        Authorization: `Bearer ${OLLAMA_API_KEY}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) return [];

    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    return Array.from(
      new Set(
        (data.models ?? [])
          .map((item) => (item.name ?? "").trim())
          .filter((name) => name.length > 0)
      )
    );
  } catch {
    return [];
  }
}

function chooseOllamaCloudModel(models: string[]): string | null {
  const normalized = Array.from(new Set(models.map((m) => m.trim()).filter(Boolean)));
  if (normalized.length === 0) return null;

  const lowerMap = new Map(normalized.map((model) => [model.toLowerCase(), model]));
  const pickExact = (needle: string): string | null => lowerMap.get(needle.toLowerCase()) ?? null;

  const preferred = [OLLAMA_CLOUD_MODEL_HINT, ...OLLAMA_CLOUD_FALLBACK_MODELS].filter((value) => value.trim().length > 0);
  for (const candidate of preferred) {
    const exact = pickExact(candidate);
    if (exact) return exact;
  }

  const hintBase = OLLAMA_CLOUD_MODEL_HINT.toLowerCase().split(":")[0];
  if (hintBase) {
    const familyMatch = normalized.find((model) => {
      const value = model.toLowerCase();
      return value === hintBase || value.startsWith(`${hintBase}:`) || value.startsWith(`${hintBase}-`) || value.startsWith(`${hintBase}.`);
    });
    if (familyMatch) return familyMatch;
  }

  return normalized[0];
}

async function printProviderStatus(): Promise<ProviderStatus> {
  const [local, ollamaCloudModels] = await Promise.all([checkOllamaLocal(false), fetchOllamaCloudModels()]);
  const ollamaCloudModel = chooseOllamaCloudModel(ollamaCloudModels);

  const [groqProbe, openRouterProbe, cerebrasProbe, ollamaCloudProbe, anthropicProbe, ollamaLocalProbe] = await Promise.all([
    smokeTestGroq(),
    smokeTestOpenRouter(),
    smokeTestCerebras(),
    smokeTestOllamaCloud(ollamaCloudModel),
    smokeTestAnthropic(),
    smokeTestOllamaLocal(local.models),
  ]);

  const ollamaLocalReady = local.ready && ollamaLocalProbe.ok;
  const ollamaLocalStatusMessage = ollamaLocalReady
    ? `Ready (${local.models.length} models)`
    : local.models.length > 0
      ? ollamaLocalProbe.message
      : "Unreachable";

  const status: ProviderStatus = {
    groqReady: groqProbe.ok,
    groqStatusMessage: groqProbe.ok ? "Ready" : groqProbe.message,
    openRouterReady: openRouterProbe.ok,
    openRouterStatusMessage: openRouterProbe.ok ? "Ready" : openRouterProbe.message,
    cerebrasReady: cerebrasProbe.ok,
    cerebrasStatusMessage: cerebrasProbe.ok ? "Ready" : cerebrasProbe.message,
    ollamaCloudReady: ollamaCloudProbe.ok,
    ollamaCloudStatusMessage: ollamaCloudProbe.ok ? "Ready" : ollamaCloudProbe.message,
    ollamaCloudModel,
    ollamaCloudModels,
    ollamaLocalReady,
    ollamaLocalStatusMessage,
    ollamaLocalModels: local.models,
    anthropicReady: anthropicProbe.ok,
    anthropicStatusMessage: anthropicProbe.ok ? "Ready" : anthropicProbe.message,
  };

  console.log("Checking providers...");
  console.log(`  Groq:         ${status.groqReady ? "✓ Ready" : `✗ ${status.groqStatusMessage}`}`);
  console.log(`  OpenRouter:   ${status.openRouterReady ? "✓ Ready" : `✗ ${status.openRouterStatusMessage}`}`);
  console.log(`  Cerebras:     ${status.cerebrasReady ? "✓ Ready" : `✗ ${status.cerebrasStatusMessage}`}`);
  console.log(
    `  Ollama Cloud: ${status.ollamaCloudReady ? `✓ Ready (${status.ollamaCloudModel ?? "unknown"})` : `✗ ${status.ollamaCloudStatusMessage}`}`
  );

  if (status.ollamaLocalReady) {
    console.log(`  Ollama Local: ✓ Ready (${status.ollamaLocalModels.length} models)`);
  } else {
    console.log(`  Ollama Local: ✗ ${status.ollamaLocalStatusMessage}`);
  }

  console.log(`  Anthropic:    ${status.anthropicReady ? "✓ Ready" : `✗ ${status.anthropicStatusMessage}`}`);
  console.log("  Static:       ✓ Always available");
  console.log("");
  console.log("Primary: groq → openrouter → cerebras → ollama-cloud → ollama-local → anthropic → static");

  return status;
}

function printHeader(): void {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  SOFTWARE CITY — Expert Training");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

async function smokeTestGroq(): Promise<SmokeTestResult> {
  if (!GROQ_API_KEY) return { ok: false, message: "No key" };

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: "user", content: "Reply with one word: hello" }],
        max_tokens: 32,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const raw = await res.text();
    if (!res.ok) {
      return { ok: false, message: buildHttpErrorMessage(res.status, raw) };
    }

    const content = parseOpenAiCompatContent(raw);
    if (!content) {
      return { ok: false, message: "Empty response body from provider" };
    }

    return { ok: true, message: compactLogText(content, 80) };
  } catch (error) {
    return { ok: false, message: compactLogText(String(error)) };
  }
}

async function smokeTestOpenRouter(): Promise<SmokeTestResult> {
  if (!OPENROUTER_API_KEY) return { ok: false, message: "No key" };

  const smokeSystemPrompt = buildSystemPrompt();
  const smokeUserPrompt = [
    "Repository: smoke/openrouter",
    "File: smoke.ts",
    "Language: javascript",
    "",
    "Code:",
    "async function handler(req) { return req.query.id; }",
  ].join("\n");

  const models = openRouterModelCandidates();
  const failures: string[] = [];
  let reachableWarning: string | null = null;

  for (const model of models) {
    const response = await postOpenRouter(model, smokeSystemPrompt, smokeUserPrompt, Math.min(OPENROUTER_MAX_TOKENS, 900));
    if (!response.ok) {
      failures.push(`${model}: ${buildHttpErrorMessage(response.status, response.raw)}`);
      continue;
    }

    const content = parseOpenAiCompatContent(response.raw);
    if (!content) {
      failures.push(`${model}: empty content (${describeOpenRouterResponse(response.raw)})`);
      continue;
    }

    const patterns = parseProviderPatterns(content, "javascript", "general");
    if (patterns.length > 0) {
      return { ok: true, message: `${model}: JSON probe ok` };
    }

    reachableWarning = `${model}: startup parse warning (${describeOpenRouterResponse(response.raw)})`;
  }

  if (reachableWarning) {
    // Reachability is enough to keep OpenRouter in the runtime cascade.
    return { ok: true, message: reachableWarning };
  }

  return {
    ok: false,
    message: failures[0] ?? "OpenRouter startup probe failed",
  };
}

async function smokeTestCerebras(): Promise<SmokeTestResult> {
  if (!CEREBRAS_API_KEY) return { ok: false, message: "No key" };

  try {
    const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CEREBRAS_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CEREBRAS_MODEL,
        messages: [{ role: "user", content: "Reply with one word: hello" }],
        max_tokens: 64,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const raw = await res.text();
    if (!res.ok) {
      return { ok: false, message: buildHttpErrorMessage(res.status, raw) };
    }

    const content = parseOpenAiCompatContent(raw);
    if (!content) {
      return { ok: false, message: "Empty response body from provider" };
    }

    return { ok: true, message: `${CEREBRAS_MODEL}: ${compactLogText(content, 80)}` };
  } catch (error) {
    return { ok: false, message: compactLogText(String(error)) };
  }
}

async function smokeTestOllamaCloud(model: string | null): Promise<SmokeTestResult> {
  if (!OLLAMA_API_KEY) return { ok: false, message: "No key" };
  if (!model) return { ok: false, message: "No model available from /api/tags" };

  try {
    const res = await fetch("https://ollama.com/api/chat", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OLLAMA_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with one word: hello" }],
        stream: false,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const raw = await res.text();
    if (!res.ok) {
      return { ok: false, message: buildHttpErrorMessage(res.status, raw) };
    }

    const content = parseOllamaChatContent(raw);
    if (!content) {
      return { ok: false, message: "Empty response body from provider" };
    }

    return { ok: true, message: `${model}: ${compactLogText(content, 80)}` };
  } catch (error) {
    return { ok: false, message: compactLogText(String(error)) };
  }
}

async function smokeTestOllamaLocal(models: string[]): Promise<SmokeTestResult> {
  if (models.length === 0) {
    return { ok: false, message: "Unreachable or no models" };
  }

  const orderedModels = chooseOllamaLocalModels(models);
  if (orderedModels.length === 0) {
    return { ok: false, message: "No supported local model" };
  }

  const model = orderedModels[0];
  const response = await callOllamaChat(
    `${OLLAMA_HOST.replace(/\/$/, "")}/api/chat`,
    model,
    "",
    "Reply with one word: hello",
    OLLAMA_LOCAL_TIMEOUT_MS,
    undefined,
    { userOnly: true }
  );

  if (!response.ok) {
    return { ok: false, message: buildHttpErrorMessage(response.status, response.raw) };
  }

  const content = parseOllamaChatContent(response.raw);
  if (!content) {
    return { ok: false, message: "Empty response body from provider" };
  }

  return { ok: true, message: `${model}: ${compactLogText(content, 60)}` };
}

async function smokeTestAnthropic(): Promise<SmokeTestResult> {
  if (!ANTHROPIC_API_KEY) return { ok: false, message: "No key" };

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 32,
        messages: [{ role: "user", content: "Reply with one word: hello" }],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const raw = await res.text();
    if (!res.ok) {
      return { ok: false, message: buildHttpErrorMessage(res.status, raw) };
    }

    let text = "";
    try {
      const parsed = JSON.parse(raw) as { content?: Array<{ type?: string; text?: string }> };
      text = (parsed.content ?? [])
        .filter((item) => item.type === "text" && typeof item.text === "string")
        .map((item) => item.text)
        .join("\n")
        .trim();
    } catch {
      text = "";
    }

    if (!text) {
      return { ok: false, message: "Empty response body from provider" };
    }

    return { ok: true, message: compactLogText(text, 80) };
  } catch (error) {
    return { ok: false, message: compactLogText(String(error)) };
  }
}

function printDryRunPlan(estimate: Record<Domain, number>): void {
  const totalEstimate = estimate.general + estimate.ui + estimate.audio + estimate.plugin + estimate.dsp + estimate.ai;
  const estimatedFiles = TARGET_REPOS.length * MAX_FILES_PER_REPO;
  const estimatedMinutes = Math.max(12, Math.round((estimatedFiles * 4.5) / 60 + TARGET_REPOS.length * 0.7));

  console.log("");
  console.log("[dry-run] No repositories will be fetched and no database writes will occur.");
  console.log(`[dry-run] Would analyze ${TARGET_REPOS.length} repos and up to ${estimatedFiles} files.`);
  console.log("[dry-run] Estimated pattern count per domain:");
  console.log(`  General patterns:    ${estimate.general}`);
  console.log(`  UI/UX patterns:      ${estimate.ui}`);
  console.log(`  Audio patterns:      ${estimate.audio}`);
  console.log(`  Plugin patterns:     ${estimate.plugin}`);
  console.log(`  DSP patterns:        ${estimate.dsp}`);
  console.log(`  AI system patterns:  ${estimate.ai}`);
  console.log(`  Total KB entries:    ${totalEstimate}`);
  console.log(`  Estimated runtime:   ~${estimatedMinutes} minutes`);
  console.log("");
  console.log("[dry-run] Target repos:");
  for (const repo of TARGET_REPOS) {
    console.log(`  - ${repo.slug} (${repo.category})`);
  }
}

function makeStaticPattern(
  base: {
    problemType: string;
    domain: Domain;
    summary: string;
    fix: string;
    tags: string[];
    actions: string[];
  },
  filePath: string,
  language: string
): PatternDraft {
  return {
    language,
    problemType: base.problemType,
    question: `${filePath}: ${base.summary}`,
    answer: `${base.fix}\n\nWhy it matters: deterministic static analysis provides a resilient fallback when external AI providers fail.`,
    confidence: "low",
    domain: base.domain,
    patternTags: base.tags,
    actionItems: base.actions,
  };
}

function buildStaticPatterns(filePath: string, content: string, language: string, defaultDomain: Domain): PatternDraft[] {
  const patterns: PatternDraft[] = [];

  for (const rule of STATIC_RULES) {
    if (rule.regex.test(content)) {
      patterns.push(makeStaticPattern(rule, filePath, language));
    }
  }

  const loc = countLoc(content);
  const complexity = estimateComplexity(content);

  if (loc > 500 || complexity > 80) {
    patterns.push({
      language,
      problemType: "high_complexity",
      question: `${filePath}: complexity appears high (loc=${loc}, complexity=${complexity}).`,
      answer: "Break the module into smaller responsibilities, extract pure helpers, and add branch-focused tests.\n\nWhy it matters: high complexity is a persistent source of regressions and slower incident response.",
      confidence: "low",
      domain: defaultDomain,
      patternTags: ["complexity", "maintainability"],
      actionItems: ["Split large functions", "Add edge-case tests"],
    });
  }

  if (patterns.length === 0) {
    patterns.push({
      language,
      problemType: "static_baseline_review",
      question: `${filePath}: baseline static review executed with no high-confidence regex match.`,
      answer: "Run targeted tests for input boundaries, async failure paths, and security-sensitive entry points.\n\nWhy it matters: static-only fallback ensures no file is skipped when AI providers are unavailable.",
      confidence: "low",
      domain: defaultDomain,
      patternTags: ["static", "baseline"],
      actionItems: ["Run focused tests", "Perform manual boundary review"],
    });
  }

  return patterns.slice(0, 4);
}

export function parseProviderPatterns(raw: string, fallbackLanguage: string, fallbackDomain: Domain): PatternDraft[] {
  const cleaned = raw.trim();
  if (!cleaned) return [];

  const tryParse = (text: string): unknown | null => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };

  const extractBalanced = (text: string, open: "{" | "[", close: "}" | "]"): string | null => {
    const start = text.indexOf(open);
    if (start < 0) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === open) depth += 1;
      if (ch === close) {
        depth -= 1;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }

    return null;
  };

  const jsonCandidates: string[] = [];
  const pushCandidate = (text: string | null | undefined): void => {
    const value = (text ?? "").trim();
    if (!value) return;
    if (!jsonCandidates.includes(value)) jsonCandidates.push(value);
  };

  pushCandidate(cleaned);

  const fencedBlocks = cleaned.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi);
  for (const match of fencedBlocks) {
    pushCandidate(match[1]);
  }

  const partialFence = cleaned.match(/```(?:json)?\s*([\s\S]*)$/i);
  if (partialFence) {
    const withoutTrailingFence = partialFence[1].replace(/```\s*$/g, "").trim();
    pushCandidate(withoutTrailingFence);
  }

  pushCandidate(extractBalanced(cleaned, "[", "]"));
  pushCandidate(extractBalanced(cleaned, "{", "}"));

  const collectEntries = (value: unknown): Record<string, unknown>[] => {
    if (!value) return [];

    if (Array.isArray(value)) {
      const output: Record<string, unknown>[] = [];

      for (const item of value) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;

        if (Array.isArray(record.patterns)) {
          output.push(...collectEntries(record.patterns));
          continue;
        }

        if (typeof record.question === "string" && typeof record.answer === "string") {
          output.push(record);
          continue;
        }

        if (Array.isArray(record.items)) output.push(...collectEntries(record.items));
        if (Array.isArray(record.results)) output.push(...collectEntries(record.results));
        if (Array.isArray(record.data)) output.push(...collectEntries(record.data));
      }

      return output;
    }

    if (typeof value === "object") {
      const record = value as Record<string, unknown>;

      if (Array.isArray(record.patterns)) return collectEntries(record.patterns);
      if (Array.isArray(record.items)) return collectEntries(record.items);
      if (Array.isArray(record.results)) return collectEntries(record.results);
      if (Array.isArray(record.data)) return collectEntries(record.data);

      if (typeof record.question === "string" && typeof record.answer === "string") {
        return [record];
      }
    }

    return [];
  };

  const normalizeEntries = (entries: Record<string, unknown>[]): PatternDraft[] => {
    const normalized: PatternDraft[] = [];

    for (const item of entries.slice(0, 8)) {
      const question = String(item.question ?? item.problem ?? item.issue ?? item.risk ?? item.title ?? "").trim();
      const answer = String(item.answer ?? item.fix ?? item.remediation ?? item.recommendation ?? item.resolution ?? "").trim();
      if (!question || !answer) continue;

      const domainCandidate = String(item.domain ?? fallbackDomain).toLowerCase();
      const domain: Domain =
        domainCandidate === "ui" ||
        domainCandidate === "audio" ||
        domainCandidate === "plugin" ||
        domainCandidate === "dsp" ||
        domainCandidate === "ai"
          ? (domainCandidate as Domain)
          : "general";

      const tagsSource = Array.isArray(item.patternTags)
        ? item.patternTags
        : Array.isArray(item.tags)
          ? item.tags
          : Array.isArray(item.labels)
            ? item.labels
            : [];
      const tags = Array.isArray(tagsSource)
        ? tagsSource.map((v) => String(v)).filter(Boolean)
        : [];

      const actionsSource = Array.isArray(item.actionItems)
        ? item.actionItems
        : Array.isArray(item.actions)
          ? item.actions
          : Array.isArray(item.nextSteps)
            ? item.nextSteps
            : [];
      const actions = Array.isArray(actionsSource)
        ? actionsSource.map((v) => String(v)).filter(Boolean)
        : [];

      normalized.push({
        language: String(item.language ?? fallbackLanguage) || fallbackLanguage,
        problemType: String(item.problemType ?? item.problem_type ?? item.issueType ?? item.type ?? "detected_pattern")
          .toLowerCase()
          .replace(/\s+/g, "_"),
        question,
        answer,
        confidence: normalizeConfidence(item.confidence),
        domain,
        patternTags: tags.length > 0 ? tags : ["ai-analysis"],
        actionItems: actions.length > 0 ? actions : ["Add targeted tests", "Harden guardrails"],
      });

      if (normalized.length >= 4) break;
    }

    return normalized;
  };

  for (const candidateText of jsonCandidates) {
    const parsed = tryParse(candidateText);
    if (!parsed) continue;

    if (typeof parsed === "string") {
      const nested = tryParse(parsed);
      if (!nested) continue;
      const normalizedNested = normalizeEntries(collectEntries(nested));
      if (normalizedNested.length > 0) return normalizedNested;
      continue;
    }

    const normalized = normalizeEntries(collectEntries(parsed));
    if (normalized.length > 0) return normalized;
  }

  // Some providers return near-JSON with small syntax damage (e.g. dropped key names).
  // Salvage key fields so training can still proceed through fallback providers.
  const decodeJsonLikeString = (value: string): string => {
    return value
      .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) => {
        const code = Number.parseInt(hex, 16);
        return Number.isFinite(code) ? String.fromCharCode(code) : "";
      })
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .trim();
  };

  const extractStringArray = (scope: string, key: string): string[] => {
    const fieldRegex = new RegExp(`"${key}"\\s*:\\s*\\[([\\s\\S]*?)\\]`, "i");
    const fieldMatch = scope.match(fieldRegex);
    if (!fieldMatch?.[1]) return [];

    return Array.from(fieldMatch[1].matchAll(/"((?:\\.|[^"\\])*)"/g))
      .map((match) => decodeJsonLikeString(match[1] ?? ""))
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 6);
  };

  const loosePatternRegex =
    /"language"\s*:\s*"((?:\\.|[^"\\])*)"[\s\S]{0,2400}?"problemType"\s*:\s*"((?:\\.|[^"\\])*)"[\s\S]{0,3200}?"question"\s*:\s*"((?:\\.|[^"\\])*)"[\s\S]{0,4200}?"answer"\s*:\s*"((?:\\.|[^"\\])*)"/gi;

  const loosePatterns: PatternDraft[] = [];
  for (const match of cleaned.matchAll(loosePatternRegex)) {
    if (loosePatterns.length >= 4) break;

    const language = decodeJsonLikeString(match[1] ?? "") || fallbackLanguage;
    const problemType = decodeJsonLikeString(match[2] ?? "") || "detected_pattern";
    const question = decodeJsonLikeString(match[3] ?? "");
    const answer = decodeJsonLikeString(match[4] ?? "");
    if (!question || !answer) continue;

    const scopeStart = Math.max(0, (match.index ?? 0) - 300);
    const scopeEnd = Math.min(cleaned.length, (match.index ?? 0) + match[0].length + 600);
    const scope = cleaned.slice(scopeStart, scopeEnd);

    const confidenceMatch = scope.match(/"confidence"\s*:\s*"(high|medium|low)"/i);
    const confidence = normalizeConfidence((confidenceMatch?.[1] ?? "medium").toLowerCase());

    const domainMatch = scope.match(/"domain"\s*:\s*"(general|ui|audio|plugin|dsp|ai)"/i);
    const domain = (domainMatch?.[1]?.toLowerCase() as Domain | undefined) ?? fallbackDomain;

    const patternTags = extractStringArray(scope, "patternTags");
    const actionItems = extractStringArray(scope, "actionItems");

    loosePatterns.push({
      language,
      problemType: problemType.toLowerCase().replace(/\s+/g, "_"),
      question,
      answer,
      confidence,
      domain,
      patternTags: patternTags.length > 0 ? patternTags : ["ai-analysis", "recovered-json"],
      actionItems: actionItems.length > 0 ? actionItems : ["Add targeted tests", "Harden validation guards"],
    });
  }

  if (loosePatterns.length > 0) return loosePatterns;

  return [];
}

function buildSystemPrompt(): string {
  return [
    "You are a principal software reviewer producing high-signal knowledge-base entries.",
    "Return strict JSON only. No markdown.",
    "Schema: {\"patterns\": [{\"language\": string, \"problemType\": string, \"question\": string, \"answer\": string, \"confidence\": \"high\"|\"medium\"|\"low\", \"domain\": \"general\"|\"ui\"|\"audio\"|\"plugin\"|\"dsp\"|\"ai\", \"patternTags\": string[], \"actionItems\": string[]}]}",
    "Output exactly 1-2 patterns.",
    "Keep each answer concise (max 320 chars), with no markdown fences and no extra keys.",
  ].join(" ");
}

function buildUserPrompt(repoSlug: string, filePath: string, language: string, content: string): string {
  const clipped = content.slice(0, MAX_FILE_CHARS_FOR_PROMPT);
  return [
    `Repository: ${repoSlug}`,
    `File: ${filePath}`,
    `Language: ${language}`,
    "",
    "Knowledge domains to consider:",
    buildExtractionTopicsText(),
    "",
    "Code:",
    clipped,
  ].join("\n");
}

async function resolveKnowledgeTableName(): Promise<"knowledge" | "knowledge_entries"> {
  const rows = await db.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('knowledge', 'knowledge_entries') ORDER BY CASE name WHEN 'knowledge' THEN 0 ELSE 1 END LIMIT 1"
  );
  const tableName = String(rows.rows[0]?.name ?? "knowledge");
  return tableName === "knowledge_entries" ? "knowledge_entries" : "knowledge";
}

async function countKnowledgeEntries(tableName: "knowledge" | "knowledge_entries"): Promise<number> {
  const rows = await db.execute(`SELECT COUNT(*) as count FROM ${tableName}`);
  const value = rows.rows[0]?.count;
  return Number(value ?? 0);
}

async function hasContextHash(tableName: "knowledge" | "knowledge_entries", contextHash: string): Promise<boolean> {
  const rows = await db.execute(`SELECT 1 as hit FROM ${tableName} WHERE context_hash = ? LIMIT 1`, [contextHash]);
  return rows.rows.length > 0;
}

async function insertKnowledgeRow(tableName: "knowledge" | "knowledge_entries", row: KnowledgeInsertRow): Promise<void> {
  await db.execute(
    `INSERT INTO ${tableName} (problem_type, language, framework, pattern_tags, file_type, question, context_hash, code_snippet, answer, action_items, confidence, provider, use_count, was_useful, produced_bugs, quality_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.problemType,
      row.language,
      null,
      JSON.stringify(row.patternTags),
      "source",
      row.question,
      row.contextHash,
      row.codeSnippet,
      row.answer,
      JSON.stringify(row.actionItems),
      row.confidence,
      row.provider,
      1,
      1,
      0,
      row.qualityScore,
    ]
  );
}

function buildKnowledgeRow(
  draft: PatternDraft,
  provider: ProviderName,
  repoSlug: string,
  filePath: string,
  codeSnippet: string
): KnowledgeInsertRow {
  const contextHash = hashText(`${repoSlug}:${filePath}:${draft.problemType}:${draft.question}`);
  return {
    problemType: draft.problemType,
    language: draft.language,
    question: draft.question,
    answer: draft.answer,
    codeSnippet: codeSnippet.slice(0, 1200),
    patternTags: draft.patternTags,
    actionItems: draft.actionItems,
    confidence: draft.confidence,
    provider,
    contextHash,
    qualityScore: confidenceToScore(draft.confidence, provider),
  };
}

let anthropicCostWarned = false;

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }
  return headers;
}

function isRateLimited(status: number, body: string, headers: Headers): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  const remaining = headers.get("x-ratelimit-remaining");
  if (remaining === "0") return true;
  return /rate limit|secondary rate limit|too many requests/i.test(body);
}

async function fetchGitHubJsonWithRateLimit(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });

    const raw = await res.text();

    if (isRateLimited(res.status, raw, res.headers) && attempt === 0) {
      console.log("Rate limited — waiting 60s and retrying...");
      await sleep(60_000);
      continue;
    }

    if (!res.ok) {
      throw new Error(`GitHub API ${res.status}: ${raw.slice(0, 220)}`);
    }

    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new Error(`GitHub API returned invalid JSON for ${url}`);
    }
  }

  throw new Error(`GitHub request failed after retry: ${url}`);
}

async function fetchDefaultBranch(slug: string): Promise<string> {
  const { owner, repo } = extractOwnerRepo(slug);
  const metaUrl = `https://api.github.com/repos/${owner}/${repo}`;

  try {
    const meta = (await fetchGitHubJsonWithRateLimit(metaUrl)) as RepoMetaResponse;
    return meta.default_branch?.trim() || "main";
  } catch {
    return "main";
  }
}

async function fetchRepoCandidates(target: TargetRepo): Promise<FileCandidate[]> {
  const { owner, repo } = extractOwnerRepo(target.slug);
  const defaultBranch = await fetchDefaultBranch(target.slug);
  const branchesToTry = Array.from(new Set([defaultBranch, "main", "master"]));

  for (const branch of branchesToTry) {
    try {
      const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
      const data = (await fetchGitHubJsonWithRateLimit(treeUrl)) as RepoTreeResponse;
      const tree = data.tree ?? [];

      const candidates: FileCandidate[] = tree
        .filter((item) => item.type === "blob" && Boolean(item.path) && typeof item.size === "number")
        .map((item) => ({
          path: String(item.path),
          size: Number(item.size),
          branch,
        }))
        .filter((item) => item.size <= MAX_FILE_BYTES && shouldAnalyzeFile(item.path))
        .sort((a, b) => b.size - a.size)
        .slice(0, MAX_FILES_PER_REPO);

      return candidates;
    } catch {
      // Try next branch.
    }
  }

  throw new Error(`Unable to fetch repo tree for ${target.slug}`);
}

async function fetchFileContent(slug: string, branch: string, filePath: string): Promise<{ content: string; unavailable: boolean }> {
  try {
    const rawUrl = toRawFileUrl(slug, branch, filePath);
    const res = await fetch(rawUrl, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) {
      return { content: "", unavailable: true };
    }
    const text = await res.text();
    return { content: text, unavailable: false };
  } catch {
    return { content: "", unavailable: true };
  }
}

function parseOpenAiCompatContent(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {
      output_text?: unknown;
      content?: unknown;
      choices?: Array<{
        text?: unknown;
        message?: {
          content?: unknown;
        };
      }>;
    };

    const choice = parsed.choices?.[0];
    const fromMessage = textFromOpenAiContent(choice?.message?.content);
    if (fromMessage) return fromMessage;

    const fromChoiceText = typeof choice?.text === "string" ? choice.text.trim() : "";
    if (fromChoiceText) return fromChoiceText;

    const fromOutputText = typeof parsed.output_text === "string" ? parsed.output_text.trim() : "";
    if (fromOutputText) return fromOutputText;

    const fromContent = textFromOpenAiContent(parsed.content);
    if (fromContent) return fromContent;

    return "";
  } catch {
    return "";
  }
}

async function postOpenAiCompat(
  endpoint: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  extraHeaders?: Record<string, string>,
  options?: {
    maxTokens?: number;
    userOnly?: boolean;
  }
): Promise<{ ok: boolean; status: number; raw: string }> {
  try {
    const userOnly = options?.userOnly ?? false;
    const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`.trim();
    const messages = userOnly
      ? [{ role: "user", content: combinedPrompt }]
      : [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ];

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(extraHeaders ?? {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: options?.maxTokens ?? 1400,
        messages,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const raw = await res.text();
    return { ok: res.ok, status: res.status, raw };
  } catch (error) {
    return { ok: false, status: 599, raw: String(error) };
  }
}

async function callGroqProvider(systemPrompt: string, userPrompt: string, fallbackLanguage: string, fallbackDomain: Domain): Promise<ProviderCallResult> {
  if (!GROQ_API_KEY) {
    return { ok: false, provider: "groq", patterns: [], reason: "no_key", message: "No GROQ_API_KEY" };
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await postOpenAiCompat(
      "https://api.groq.com/openai/v1/chat/completions",
      GROQ_API_KEY,
      GROQ_MODEL,
      systemPrompt,
      userPrompt
    );

    const isLimit = response.status === 429 || /rate limit|too many requests/i.test(response.raw);
    const errorMessage = buildHttpErrorMessage(response.status, response.raw);

    if (isLimit && attempt === 0) {
      await sleep(30_000);
      continue;
    }

    if (isLimit) {
      return { ok: false, provider: "groq", patterns: [], reason: "rate_limit", message: errorMessage };
    }

    if (!response.ok) {
      return { ok: false, provider: "groq", patterns: [], reason: "unavailable", message: errorMessage };
    }

    const content = parseOpenAiCompatContent(response.raw);
    const patterns = parseProviderPatterns(content, fallbackLanguage, fallbackDomain);
    if (patterns.length === 0) {
      return {
        ok: false,
        provider: "groq",
        patterns: [],
        reason: "parse_error",
        message: `Could not parse Groq response as JSON patterns: ${compactLogText(content || response.raw)}`,
      };
    }

    return { ok: true, provider: "groq", patterns, model: GROQ_MODEL, message: "success" };
  }

  return { ok: false, provider: "groq", patterns: [], reason: "unavailable", message: "Groq request failed after retry" };
}

async function callOpenRouterProvider(systemPrompt: string, userPrompt: string, fallbackLanguage: string, fallbackDomain: Domain): Promise<ProviderCallResult> {
  if (!OPENROUTER_API_KEY) {
    return { ok: false, provider: "openrouter", patterns: [], reason: "no_key", message: "No OPENROUTER_API_KEY" };
  }

  const models = openRouterModelCandidates();
  const errors: string[] = [];
  let sawRateLimit = false;

  for (const model of models) {
    const response = await postOpenRouter(model, systemPrompt, userPrompt, OPENROUTER_MAX_TOKENS);

    const isRateLimited = response.status === 429 || /rate limit|too many requests/i.test(response.raw);
    if (isRateLimited) {
      sawRateLimit = true;
    }

    if (!response.ok) {
      errors.push(`${model}: ${buildHttpErrorMessage(response.status, response.raw)}`);
      continue;
    }

    const content = parseOpenAiCompatContent(response.raw);
    if (!content) {
      errors.push(`${model}: empty content (${describeOpenRouterResponse(response.raw)})`);
      continue;
    }

    const patterns = parseProviderPatterns(content, fallbackLanguage, fallbackDomain);
    if (patterns.length > 0) {
      return { ok: true, provider: "openrouter", patterns, model, message: "success" };
    }

    errors.push(`${model}: parse_error (${describeOpenRouterResponse(response.raw)})`);
  }

  return {
    ok: false,
    provider: "openrouter",
    patterns: [],
    reason: sawRateLimit ? "rate_limit" : "parse_error",
    message: errors[0]
      ? `OpenRouter exhausted model fallbacks: ${errors.join(" | ")}`
      : "OpenRouter exhausted model fallbacks",
  };
}

async function callCerebrasProvider(systemPrompt: string, userPrompt: string, fallbackLanguage: string, fallbackDomain: Domain): Promise<ProviderCallResult> {
  if (!CEREBRAS_API_KEY) {
    return { ok: false, provider: "cerebras", patterns: [], reason: "no_key", message: "No CEREBRAS_API_KEY" };
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await postOpenAiCompat(
      "https://api.cerebras.ai/v1/chat/completions",
      CEREBRAS_API_KEY,
      CEREBRAS_MODEL,
      systemPrompt,
      userPrompt,
      undefined,
      { maxTokens: 1200 }
    );

    const isLimit = response.status === 429 || /rate limit|too many requests/i.test(response.raw);
    const errorMessage = buildHttpErrorMessage(response.status, response.raw);

    if (isLimit && attempt === 0) {
      await sleep(20_000);
      continue;
    }

    if (isLimit) {
      return { ok: false, provider: "cerebras", patterns: [], reason: "rate_limit", message: errorMessage };
    }

    if (!response.ok) {
      return { ok: false, provider: "cerebras", patterns: [], reason: "unavailable", message: errorMessage };
    }

    const content = parseOpenAiCompatContent(response.raw);
    const patterns = parseProviderPatterns(content, fallbackLanguage, fallbackDomain);
    if (patterns.length === 0) {
      return {
        ok: false,
        provider: "cerebras",
        patterns: [],
        reason: "parse_error",
        message: `Could not parse Cerebras response as JSON patterns: ${compactLogText(content || response.raw)}`,
      };
    }

    return { ok: true, provider: "cerebras", patterns, model: CEREBRAS_MODEL, message: "success" };
  }

  return { ok: false, provider: "cerebras", patterns: [], reason: "unavailable", message: "Cerebras request failed after retry" };
}

function parseOllamaChatContent(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {
      message?: {
        content?: string;
      };
    };
    return String(parsed.message?.content ?? "").trim();
  } catch {
    return "";
  }
}

async function callOllamaChat(
  endpoint: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs: number,
  headers?: Record<string, string>,
  options?: {
    userOnly?: boolean;
  }
): Promise<{ ok: boolean; status: number; raw: string }> {
  try {
    const userOnly = options?.userOnly ?? false;
    const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`.trim();
    const messages = userOnly
      ? [{ role: "user", content: combinedPrompt }]
      : [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ];

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(headers ?? {}),
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const raw = await res.text();
    return { ok: res.ok, status: res.status, raw };
  } catch (error) {
    return { ok: false, status: 599, raw: String(error) };
  }
}

async function callOllamaCloudProvider(
  systemPrompt: string,
  userPrompt: string,
  fallbackLanguage: string,
  fallbackDomain: Domain,
  model: string | null
): Promise<ProviderCallResult> {
  if (!OLLAMA_API_KEY) {
    return { ok: false, provider: "ollama-cloud", patterns: [], reason: "no_key", message: "No OLLAMA_API_KEY" };
  }

  if (!model) {
    return {
      ok: false,
      provider: "ollama-cloud",
      patterns: [],
      reason: "unavailable",
      message: "No model available from Ollama Cloud /api/tags",
    };
  }

  const response = await callOllamaChat(
    "https://ollama.com/api/chat",
    model,
    systemPrompt,
    userPrompt,
    REQUEST_TIMEOUT_MS,
    {
      Authorization: `Bearer ${OLLAMA_API_KEY}`,
      "Content-Type": "application/json",
    },
    { userOnly: true }
  );

  if (!response.ok) {
    return {
      ok: false,
      provider: "ollama-cloud",
      patterns: [],
      reason: "unavailable",
      message: buildHttpErrorMessage(response.status, response.raw),
    };
  }

  const content = parseOllamaChatContent(response.raw);
  const patterns = parseProviderPatterns(content, fallbackLanguage, fallbackDomain);
  if (patterns.length === 0) {
    return {
      ok: false,
      provider: "ollama-cloud",
      patterns: [],
      reason: "parse_error",
      message: `Could not parse Ollama Cloud response as JSON patterns: ${compactLogText(content || response.raw)}`,
    };
  }

  return {
    ok: true,
    provider: "ollama-cloud",
    patterns,
    model,
    message: "success",
  };
}

function chooseOllamaLocalModels(models: string[]): string[] {
  const normalized = Array.from(new Set(models.map((m) => m.trim()).filter(Boolean)));
  if (normalized.length === 0) return [];

  const findExact = (needle: string): string | null => {
    const match = normalized.find((m) => m.toLowerCase() === needle.toLowerCase());
    return match ?? null;
  };

  const best: string[] = [];
  for (const preferred of OLLAMA_LOCAL_ULTRALIGHT_MODELS) {
    const found = findExact(preferred);
    if (found && !best.includes(found)) best.push(found);
  }

  const legacyPreferred = ["deepseek-coder-v2:16b", "deepseek-coder:6.7b"];
  for (const preferred of legacyPreferred) {
    const found = findExact(preferred);
    if (found && !best.includes(found)) best.push(found);
  }

  const sizeScore = (model: string): number => {
    const match = model.toLowerCase().match(/:(\d+(?:\.\d+)?)([mb])/);
    if (!match) return Number.POSITIVE_INFINITY;
    const value = Number(match[1]);
    if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY;
    const unit = match[2];
    return unit === "m" ? value : value * 1000;
  };

  const remaining = normalized
    .filter((model) => !best.includes(model))
    .sort((a, b) => {
      const diff = sizeScore(a) - sizeScore(b);
      if (Number.isFinite(diff) && diff !== 0) return diff;
      return a.localeCompare(b);
    });

  return [...best, ...remaining];
}

async function callOllamaLocalProvider(
  systemPrompt: string,
  userPrompt: string,
  fallbackLanguage: string,
  fallbackDomain: Domain,
  models: string[]
): Promise<ProviderCallResult> {
  const orderedModels = chooseOllamaLocalModels(models);
  if (orderedModels.length === 0) {
    return { ok: false, provider: "ollama-local", patterns: [], reason: "unavailable", message: "No local models available" };
  }

  const errors: string[] = [];

  for (const model of orderedModels) {
    const response = await callOllamaChat(
      `${OLLAMA_HOST.replace(/\/$/, "")}/api/chat`,
      model,
      systemPrompt,
      userPrompt,
      OLLAMA_LOCAL_TIMEOUT_MS
    );

    if (!response.ok) {
      errors.push(`${model}: ${buildHttpErrorMessage(response.status, response.raw)}`);
      continue;
    }
    const content = parseOllamaChatContent(response.raw);
    const patterns = parseProviderPatterns(content, fallbackLanguage, fallbackDomain);
    if (patterns.length === 0) {
      errors.push(`${model}: Could not parse Ollama Local response as JSON patterns`);
      continue;
    }

    return {
      ok: true,
      provider: "ollama-local",
      patterns,
      model,
      message: "success",
    };
  }

  return {
    ok: false,
    provider: "ollama-local",
    patterns: [],
    reason: "unavailable",
    message: errors.length > 0 ? errors.join(" | ") : "No working local model",
  };
}

async function callAnthropicProvider(systemPrompt: string, userPrompt: string, fallbackLanguage: string, fallbackDomain: Domain): Promise<ProviderCallResult> {
  if (!ANTHROPIC_API_KEY) {
    return { ok: false, provider: "anthropic", patterns: [], reason: "no_key", message: "No ANTHROPIC_API_KEY" };
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        system: systemPrompt,
        max_tokens: 1400,
        temperature: 0,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const raw = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        provider: "anthropic",
        patterns: [],
        reason: "unavailable",
        message: buildHttpErrorMessage(res.status, raw),
      };
    }

    let content = "";
    try {
      const parsed = JSON.parse(raw) as { content?: Array<{ type?: string; text?: string }> };
      content = (parsed.content ?? [])
        .filter((item) => item.type === "text" && typeof item.text === "string")
        .map((item) => item.text)
        .join("\n")
        .trim();
    } catch {
      content = "";
    }

    const patterns = parseProviderPatterns(content, fallbackLanguage, fallbackDomain);
    if (patterns.length === 0) {
      return {
        ok: false,
        provider: "anthropic",
        patterns: [],
        reason: "parse_error",
        message: `Could not parse Anthropic response as JSON patterns: ${compactLogText(content || raw)}`,
      };
    }

    return {
      ok: true,
      provider: "anthropic",
      patterns,
      model: ANTHROPIC_MODEL,
      message: "success",
    };
  } catch (error) {
    return {
      ok: false,
      provider: "anthropic",
      patterns: [],
      reason: "network_error",
      message: compactLogText(String(error)),
    };
  }
}

async function analyzeFileWithProviderCascade(
  repo: TargetRepo,
  filePath: string,
  language: string,
  content: string,
  providerStatus: ProviderStatus
): Promise<AnalyzeFileResult> {
  const systemPrompt = buildSystemPrompt();
  const fallbackDomain = categoryToDomain(repo.category);
  const userPrompt = buildUserPrompt(repo.slug, filePath, language, content);

  const groqGate = canAttemptTrainProvider("groq", providerStatus.groqReady, providerStatus.groqStatusMessage);
  if (groqGate.allowed) {
    console.log(`[groq] ${repo.slug}: analyzing ${shortFileName(filePath)}`);
    const groqResult = await callGroqProvider(systemPrompt, userPrompt, language, fallbackDomain);
    if (groqResult.ok && groqResult.patterns.length > 0) {
      markTrainProviderSuccess("groq");
      return {
        provider: "groq",
        model: groqResult.model,
        patterns: groqResult.patterns,
      };
    }

    const groqFailureMessage = groqResult.message ?? groqResult.reason ?? "unknown Groq failure";

    if (shouldCountAsCircuitFailure(groqResult.reason)) {
      const hardQuota = groqResult.reason === "rate_limit" && isGroqHardQuotaMessage(groqFailureMessage);
      markTrainProviderFailure("groq", groqFailureMessage, {
        forceOpen: groqResult.reason === "rate_limit",
        cooldownMs: hardQuota ? 30 * 60_000 : undefined,
      });
    }

    console.log(`Groq failed: ${groqFailureMessage}`);
  } else {
    console.log(`Groq failed: ${groqGate.reason}`);
  }

  const openRouterGate = canAttemptTrainProvider(
    "openrouter",
    providerStatus.openRouterReady,
    providerStatus.openRouterStatusMessage,
  );

  if (openRouterGate.allowed) {
    console.log("Trying OpenRouter...");
    const openRouterResult = await callOpenRouterProvider(systemPrompt, userPrompt, language, fallbackDomain);

    if (openRouterResult.ok) {
      markTrainProviderSuccess("openrouter");
      console.log("OpenRouter result: success");
    } else {
      const openRouterFailure = openRouterResult.message ?? openRouterResult.reason ?? "unknown error";
      if (shouldCountAsCircuitFailure(openRouterResult.reason)) {
        markTrainProviderFailure("openrouter", openRouterFailure, {
          forceOpen: openRouterResult.reason === "rate_limit",
        });
      }
      console.log(`OpenRouter result: fail (${openRouterFailure})`);
    }

    if (openRouterResult.ok && openRouterResult.patterns.length > 0) {
      return {
        provider: "openrouter",
        model: openRouterResult.model,
        patterns: openRouterResult.patterns,
      };
    }
  } else {
    console.log(`OpenRouter result: fail (${openRouterGate.reason})`);
  }

  const cerebrasGate = canAttemptTrainProvider(
    "cerebras",
    providerStatus.cerebrasReady,
    providerStatus.cerebrasStatusMessage,
  );

  if (cerebrasGate.allowed) {
    console.log("Trying Cerebras...");
    const cerebrasResult = await callCerebrasProvider(systemPrompt, userPrompt, language, fallbackDomain);

    if (cerebrasResult.ok) {
      markTrainProviderSuccess("cerebras");
      console.log("Cerebras result: success");
    } else {
      const cerebrasFailure = cerebrasResult.message ?? cerebrasResult.reason ?? "unknown error";
      if (shouldCountAsCircuitFailure(cerebrasResult.reason)) {
        markTrainProviderFailure("cerebras", cerebrasFailure, {
          forceOpen: cerebrasResult.reason === "rate_limit",
        });
      }
      console.log(`Cerebras result: fail (${cerebrasFailure})`);
    }

    if (cerebrasResult.ok && cerebrasResult.patterns.length > 0) {
      return {
        provider: "cerebras",
        model: cerebrasResult.model,
        patterns: cerebrasResult.patterns,
      };
    }
  } else {
    console.log(`Cerebras result: fail (${cerebrasGate.reason})`);
  }

  const ollamaCloudGate = canAttemptTrainProvider(
    "ollama-cloud",
    providerStatus.ollamaCloudReady,
    providerStatus.ollamaCloudStatusMessage,
  );

  if (ollamaCloudGate.allowed) {
    console.log("Trying Ollama Cloud...");
    const cloudResult = await callOllamaCloudProvider(
      systemPrompt,
      userPrompt,
      language,
      fallbackDomain,
      providerStatus.ollamaCloudModel
    );

    if (cloudResult.ok) {
      markTrainProviderSuccess("ollama-cloud");
    } else {
      const cloudFailure = cloudResult.message ?? cloudResult.reason ?? "unknown error";
      if (shouldCountAsCircuitFailure(cloudResult.reason)) {
        markTrainProviderFailure("ollama-cloud", cloudFailure, {
          forceOpen: cloudResult.reason === "rate_limit",
        });
      }
      console.log(`Ollama Cloud result: fail (${cloudFailure})`);
    }

    if (cloudResult.ok && cloudResult.patterns.length > 0) {
      console.log(`[ollama-cloud:${cloudResult.model ?? "unknown"}] ${repo.slug}: cloud`);
      return {
        provider: "ollama-cloud",
        model: cloudResult.model,
        patterns: cloudResult.patterns,
      };
    }
  } else {
    console.log(`Ollama Cloud result: fail (${ollamaCloudGate.reason})`);
  }

  const ollamaLocalGate = canAttemptTrainProvider(
    "ollama-local",
    providerStatus.ollamaLocalReady,
    providerStatus.ollamaLocalStatusMessage,
  );

  if (ollamaLocalGate.allowed) {
    console.log("Trying Ollama Local...");
    const localResult = await callOllamaLocalProvider(systemPrompt, userPrompt, language, fallbackDomain, providerStatus.ollamaLocalModels);
    if (localResult.ok) {
      markTrainProviderSuccess("ollama-local");
    } else {
      const localFailure = localResult.message ?? localResult.reason ?? "unknown error";
      if (shouldCountAsCircuitFailure(localResult.reason)) {
        markTrainProviderFailure("ollama-local", localFailure, {
          forceOpen: localResult.reason === "rate_limit",
        });
      }
      console.log(`Ollama Local result: fail (${localFailure})`);
    }

    if (localResult.ok && localResult.patterns.length > 0) {
      console.log(`[ollama-local:${localResult.model ?? "unknown"}] ${repo.slug}: using local PC`);
      return {
        provider: "ollama-local",
        model: localResult.model,
        patterns: localResult.patterns,
      };
    }
  } else {
    console.log(`Ollama Local result: fail (${ollamaLocalGate.reason})`);
  }

  const anthropicGate = canAttemptTrainProvider(
    "anthropic",
    providerStatus.anthropicReady,
    providerStatus.anthropicStatusMessage,
  );

  if (anthropicGate.allowed) {
    if (!anthropicCostWarned) {
      console.log("[cost] Using Anthropic — small charges may apply");
      anthropicCostWarned = true;
    }
    console.log(`[anthropic] ${repo.slug}: all free tiers exhausted`);
    const anthropicResult = await callAnthropicProvider(systemPrompt, userPrompt, language, fallbackDomain);
    if (anthropicResult.ok) {
      markTrainProviderSuccess("anthropic");
    } else {
      const anthropicFailure = anthropicResult.message ?? anthropicResult.reason ?? "unknown error";
      if (shouldCountAsCircuitFailure(anthropicResult.reason)) {
        markTrainProviderFailure("anthropic", anthropicFailure, {
          forceOpen: anthropicResult.reason === "rate_limit",
        });
      }
      console.log(`Anthropic result: fail (${anthropicFailure})`);
    }

    if (anthropicResult.ok && anthropicResult.patterns.length > 0) {
      return {
        provider: "anthropic",
        model: anthropicResult.model,
        patterns: anthropicResult.patterns,
      };
    }
  } else {
    console.log(`Anthropic result: fail (${anthropicGate.reason})`);
  }

  console.log(`[static] ${repo.slug}: no AI available`);
  const staticPatterns = buildStaticPatterns(filePath, content, language, fallbackDomain);
  return {
    provider: "static",
    patterns: staticPatterns,
  };
}

async function persistPatterns(
  tableName: "knowledge" | "knowledge_entries",
  provider: ProviderName,
  repoSlug: string,
  filePath: string,
  content: string,
  patterns: PatternDraft[],
  progress: TrainProgress
): Promise<{ added: number; duplicates: number }> {
  let added = 0;
  let duplicates = 0;

  for (const pattern of patterns) {
    const row = buildKnowledgeRow(pattern, provider, repoSlug, filePath, content);

    try {
      const alreadyExists = await hasContextHash(tableName, row.contextHash);
      if (alreadyExists) {
        duplicates++;
        progress.duplicates += 1;
        continue;
      }

      await insertKnowledgeRow(tableName, row);
      added++;
      progress.added += 1;
      progress.providerUsage[provider] += 1;
      progress.domainCounts[pattern.domain] += 1;
    } catch {
      duplicates++;
      progress.duplicates += 1;
    }
  }

  return { added, duplicates };
}

async function analyzeRepo(
  tableName: "knowledge" | "knowledge_entries",
  repo: TargetRepo,
  providerStatus: ProviderStatus,
  progress: TrainProgress,
  estimatedPatternTotal: number
): Promise<void> {
  if (progress.completedRepos.includes(repo.slug)) {
    console.log(`[resume] ${repo.slug}: already completed, skipping`);
    return;
  }

  const repoStats: RepoStats = progress.repoStats[repo.slug] ?? {
    filesProcessed: 0,
    patternsAdded: 0,
    duplicates: 0,
  };

  let candidates: FileCandidate[] = [];
  try {
    candidates = await fetchRepoCandidates(repo);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`${repo.slug}: skipped (${message})`);
    return;
  }

  for (const file of candidates) {
    progress.filesProcessed += 1;
    repoStats.filesProcessed += 1;

    console.log(`[${repo.category}] ${repo.slug}: analyzing ${file.path}...`);

    const fetched = await fetchFileContent(repo.slug, file.branch, file.path);
    const content = fetched.unavailable
      ? "// content unavailable from remote source, fallback analysis only"
      : fetched.content;

    const language = detectLanguage(file.path);
    const analysis = await analyzeFileWithProviderCascade(repo, file.path, language, content, providerStatus);

    const saveResult = await persistPatterns(tableName, analysis.provider, repo.slug, file.path, content, analysis.patterns, progress);
    repoStats.patternsAdded += saveResult.added;
    repoStats.duplicates += saveResult.duplicates;

    progress.repoStats[repo.slug] = repoStats;
    saveProgress(progress);

    const currentPatterns = progress.added + progress.duplicates;
    console.log(renderProgressBar(currentPatterns, estimatedPatternTotal));
  }

  progress.completedRepos.push(repo.slug);
  progress.repoStats[repo.slug] = repoStats;
  saveProgress(progress);
  console.log(`${repo.slug}: added ${repoStats.patternsAdded}, duplicates ${repoStats.duplicates}`);
}

// SECTION_SEEDS
function makeSeed(spec: SeedSpec): SeedSpec {
  return spec;
}

function buildExpertSeedPatterns(): PatternDraft[] {
  const webAudio: SeedSpec[] = [
    makeSeed({
      language: "javascript",
      problemType: "audio_context_resume_after_gesture",
      question: "Audio engine boots before user interaction and remains suspended in autoplay-restricted browsers.",
      explanation: "Resume AudioContext from a trusted user gesture and guard against suspended state transitions.",
      code: "const ctx = new AudioContext();\nbutton.addEventListener('click', async () => {\n  if (ctx.state !== 'running') await ctx.resume();\n});",
      why: "Without resume-on-gesture handling, playback silently fails in production browsers.",
      domain: "audio",
    }),
    makeSeed({
      language: "typescript",
      problemType: "audionode_disconnect_cleanup",
      question: "Audio graph nodes are created but teardown does not disconnect edges during cleanup.",
      explanation: "Track AudioNode references and disconnect on lifecycle teardown to prevent leaked routing paths.",
      code: "const nodes: AudioNode[] = [osc, gain, analyser];\nreturn () => nodes.forEach((n) => n.disconnect());",
      why: "Leaked node connections increase CPU usage and create ghost audio paths.",
      domain: "audio",
    }),
    makeSeed({
      language: "typescript",
      problemType: "realtime_buffer_underrun_guard",
      question: "Real-time playback pipeline risks underruns because producer throughput is not monitored.",
      explanation: "Use ring buffers and guard minimum queued frames before rendering audio chunks.",
      code: "if (queuedFrames < MIN_FRAMES) {\n  scheduleSilenceFill();\n  return;\n}",
      why: "Underruns cause audible glitches and unstable interactive audio experiences.",
      domain: "audio",
    }),
    makeSeed({
      language: "javascript",
      problemType: "midi_input_validation",
      question: "MIDI message handling trusts status/data bytes without range validation.",
      explanation: "Validate MIDI status and data byte ranges before dispatching note or CC handlers.",
      code: "const [status, data1, data2] = event.data;\nif (status < 0x80 || status > 0xEF) return;\nif (data1 > 127 || data2 > 127) return;",
      why: "Unchecked MIDI bytes can trigger invalid note events and state corruption.",
      domain: "audio",
    }),
    makeSeed({
      language: "typescript",
      problemType: "sample_rate_mismatch_resample",
      question: "Audio buffers from mixed sources are scheduled without handling sample-rate mismatch.",
      explanation: "Normalize sources to a shared sample rate or resample before connecting nodes.",
      code: "if (buffer.sampleRate !== ctx.sampleRate) {\n  buffer = await resampleBuffer(buffer, ctx.sampleRate);\n}",
      why: "Sample-rate mismatch introduces pitch drift and timing artifacts.",
      domain: "audio",
    }),
    makeSeed({
      language: "javascript",
      problemType: "worklet_message_validation",
      question: "AudioWorklet message channel payloads are used without schema checks.",
      explanation: "Validate message shape and numeric bounds before applying processor updates.",
      code: "worklet.port.onmessage = ({ data }) => {\n  if (typeof data !== 'object' || typeof data.gain !== 'number') return;\n  targetGain = Math.max(0, Math.min(2, data.gain));\n};",
      why: "Invalid worklet messages can destabilize DSP state or crash processing loops.",
      domain: "audio",
    }),
    makeSeed({
      language: "typescript",
      problemType: "replace_script_processor_with_worklet",
      question: "Legacy ScriptProcessorNode is still used in latency-sensitive audio paths.",
      explanation: "Migrate legacy ScriptProcessorNode usage to AudioWorklet for modern stable timing.",
      code: "await ctx.audioWorklet.addModule('/processor.js');\nconst node = new AudioWorkletNode(ctx, 'processor');\nsource.connect(node).connect(ctx.destination);",
      why: "ScriptProcessorNode is deprecated and prone to glitches under load.",
      domain: "audio",
    }),
    makeSeed({
      language: "typescript",
      problemType: "float32array_reuse_safely",
      question: "Shared Float32Array buffers are reused across async processing boundaries.",
      explanation: "Use per-frame copies or strict ownership transfer before mutating audio sample arrays.",
      code: "const frame = new Float32Array(input.length);\nframe.set(input);\nprocessFrame(frame);",
      why: "Unsafe buffer reuse causes intermittent clicks and nondeterministic rendering bugs.",
      domain: "audio",
    }),
    makeSeed({
      language: "javascript",
      problemType: "audiocontext_suspended_state_handler",
      question: "Playback code assumes context is running and ignores suspended/interrupted states.",
      explanation: "Branch on context state before scheduling and resume when needed.",
      code: "if (ctx.state === 'suspended') await ctx.resume();\nif (ctx.state !== 'running') throw new Error('audio_not_ready');",
      why: "State-aware scheduling avoids silent failures after tab/background transitions.",
      domain: "audio",
    }),
    makeSeed({
      language: "typescript",
      problemType: "audio_graph_cleanup_unmount",
      question: "Component unmount leaves active oscillators and processors in the graph.",
      explanation: "Stop sources and disconnect graph links during component or session teardown.",
      code: "return () => {\n  osc.stop();\n  osc.disconnect();\n  gain.disconnect();\n};",
      why: "Unclean graph teardown leaks CPU and can produce phantom sound.",
      domain: "audio",
    }),
    makeSeed({
      language: "javascript",
      problemType: "gain_ramp_to_avoid_clicks",
      question: "Gain values are set immediately, causing discontinuities and audible clicks.",
      explanation: "Use scheduled ramps instead of hard value jumps on GainNode parameters.",
      code: "const now = ctx.currentTime;\ngain.gain.cancelScheduledValues(now);\ngain.gain.linearRampToValueAtTime(target, now + 0.02);",
      why: "Smoothing gain transitions removes zipper noise and click artifacts.",
      domain: "audio",
    }),
    makeSeed({
      language: "typescript",
      problemType: "smooth_transitions_linear_ramp",
      question: "Frequency and gain automation are updated directly per event without smoothing.",
      explanation: "Apply automation ramps over short windows for stable musical transitions.",
      code: "osc.frequency.setValueAtTime(osc.frequency.value, t);\nosc.frequency.linearRampToValueAtTime(nextFreq, t + 0.03);",
      why: "Unsmooth automation creates harsh artifacts in tonal material.",
      domain: "audio",
    }),
    makeSeed({
      language: "javascript",
      problemType: "close_audiocontext_on_shutdown",
      question: "AudioContext remains open after session completion and navigation.",
      explanation: "Close AudioContext explicitly on shutdown to release system audio resources.",
      code: "window.addEventListener('beforeunload', () => {\n  void ctx.close();\n});",
      why: "Closing contexts prevents leaked threads and device lock contention.",
      domain: "audio",
    }),
    makeSeed({
      language: "typescript",
      problemType: "convolver_ir_size_guard",
      question: "Impulse responses are loaded without size checks, risking heavy memory use.",
      explanation: "Guard IR duration/size and downsample or trim oversized convolution buffers.",
      code: "if (ir.length > ctx.sampleRate * 8) {\n  ir = trimIr(ir, ctx.sampleRate * 8);\n}",
      why: "Oversized IR buffers can spike memory and increase latency.",
      domain: "audio",
    }),
    makeSeed({
      language: "javascript",
      problemType: "schedule_with_current_time",
      question: "Audio events are timed with setTimeout rather than audio clock scheduling.",
      explanation: "Schedule events against AudioContext.currentTime with lookahead windows.",
      code: "const when = ctx.currentTime + 0.1;\nosc.start(when);\nosc.stop(when + 0.25);",
      why: "Audio-clock scheduling is required for stable rhythm and low jitter.",
      domain: "audio",
    }),
  ];

  const musicTheory: SeedSpec[] = [
    makeSeed({
      language: "typescript",
      problemType: "octave_boundary_validation",
      question: "Pitch math crosses octave boundaries without validating resulting note range.",
      explanation: "Clamp octave and note index when transposing intervals across octave transitions.",
      code: "const octave = Math.max(0, Math.min(8, note.octave + deltaOct));\nconst pc = ((note.pc + deltaPc) % 12 + 12) % 12;",
      why: "Range validation avoids invalid note generation and playback errors.",
      domain: "audio",
    }),
    makeSeed({
      language: "typescript",
      problemType: "midi_note_range_guard",
      question: "MIDI note numbers are computed but not constrained to 0..127.",
      explanation: "Validate MIDI note output range before sending to synth or MIDI device.",
      code: "if (note < 0 || note > 127) throw new Error('midi_note_out_of_range');",
      why: "Out-of-range notes break hardware compatibility and sequencing logic.",
      domain: "audio",
    }),
    makeSeed({
      language: "typescript",
      problemType: "bpm_positive_validation",
      question: "Tempo values can be zero or negative and are used directly for scheduling.",
      explanation: "Require BPM to be a positive finite number before transport changes.",
      code: "if (!Number.isFinite(bpm) || bpm <= 0) throw new Error('invalid_bpm');",
      why: "Invalid BPM values corrupt bar math and event timing.",
      domain: "audio",
    }),
    makeSeed({
      language: "typescript",
      problemType: "time_signature_denominator_power_of_two",
      question: "Time signature denominator is accepted without power-of-two validation.",
      explanation: "Enforce denominator values of 1,2,4,8,16... for valid metrical notation.",
      code: "const isPow2 = (n: number) => (n & (n - 1)) === 0;\nif (!isPow2(denominator)) throw new Error('invalid_denominator');",
      why: "Invalid signatures break quantization and bar-length calculations.",
      domain: "audio",
    }),
    makeSeed({
      language: "typescript",
      problemType: "quantization_rounding_guard",
      question: "Grid quantization truncates values instead of nearest-grid rounding.",
      explanation: "Round note timing to nearest subdivision and preserve offset for groove handling.",
      code: "const step = 60 / bpm / division;\nconst snapped = Math.round(time / step) * step;",
      why: "Correct quantization improves feel while keeping rhythm mathematically stable.",
      domain: "audio",
    }),
    makeSeed({
      language: "typescript",
      problemType: "chord_voicing_octave_normalization",
      question: "Chord tones are generated across random octaves and produce incoherent voicings.",
      explanation: "Normalize chord tones into a target octave window before arranging inversions.",
      code: "const baseOct = 4;\nconst tones = intervals.map((i) => normalizeToOctave(root + i, baseOct));",
      why: "Normalized voicing prevents unexpected leaps and muddy harmonic output.",
      domain: "audio",
    }),
    makeSeed({
      language: "typescript",
      problemType: "scale_degree_modulo_wrap",
      question: "Scale-degree navigation does not wrap correctly across octave boundaries.",
      explanation: "Use modulo arithmetic for degree wrapping while tracking octave carry.",
      code: "const nextDegree = ((degree % scale.length) + scale.length) % scale.length;\nconst octaveShift = Math.floor(degree / scale.length);",
      why: "Modulo wrapping prevents index overflow and missing notes in modal traversal.",
      domain: "audio",
    }),
    makeSeed({
      language: "general",
      problemType: "enharmonic_equivalence_normalization",
      question: "Pitch comparison treats enharmonic spellings as distinct values.",
      explanation: "Normalize note tokens to pitch class and accidental map before equality checks.",
      code: "const normalize = (n: string) => enharmonicMap[n] ?? n;\nif (normalize(a) === normalize(b)) { /* equal pitch */ }",
      why: "Enharmonic normalization prevents duplicate detection and transposition bugs.",
      domain: "audio",
    }),
    makeSeed({
      language: "typescript",
      problemType: "tempo_changes_sync_to_audio_clock",
      question: "Tempo changes are applied to UI state but not synchronized to transport audio time.",
      explanation: "Apply tempo changes at scheduled transport times to preserve alignment.",
      code: "const t = ctx.currentTime + 0.05;\ntransport.schedule(() => transport.setBpm(nextBpm), t);",
      why: "Clock-synced tempo updates avoid drift between UI and rendered audio.",
      domain: "audio",
    }),
    makeSeed({
      language: "typescript",
      problemType: "pitch_class_mod12_normalization",
      question: "Pitch arithmetic allows negative classes and values above 11.",
      explanation: "Normalize every pitch class to modulo-12 range before interval logic.",
      code: "const pc = ((rawPc % 12) + 12) % 12;",
      why: "Modulo normalization is essential for consistent interval and chord operations.",
      domain: "audio",
    }),
  ];

  const plugin: SeedSpec[] = [
    makeSeed({
      language: "cpp",
      problemType: "plugin_automation_thread_safety",
      question: "Parameter automation writes shared state without thread-safe coordination.",
      explanation: "Use atomics or lock-free parameter snapshots between UI and audio threads.",
      code: "std::atomic<float> gain { 1.0f };\nvoid setGain(float g) { gain.store(g, std::memory_order_relaxed); }",
      why: "Thread-safe automation prevents clicks, race conditions, and host instability.",
      domain: "plugin",
    }),
    makeSeed({
      language: "cpp",
      problemType: "no_alloc_in_audio_callback",
      question: "Audio callback allocates memory on the real-time thread.",
      explanation: "Pre-allocate all buffers during prepare stage and reuse in processBlock.",
      code: "void prepareToPlay(double sr, int maxBlock) { scratch.resize(maxBlock); }\nvoid processBlock(...) { /* no new/malloc */ }",
      why: "Allocation in callbacks can violate real-time guarantees and cause dropouts.",
      domain: "plugin",
    }),
    makeSeed({
      language: "cpp",
      problemType: "denormal_number_handling",
      question: "Low-level DSP code does not guard denormal floating-point values.",
      explanation: "Enable denormal suppression or add tiny DC offset to avoid CPU spikes.",
      code: "juce::ScopedNoDenormals noDenormals;\nfor (auto& s : samples) processSample(s);",
      why: "Denormals can cause dramatic CPU spikes in near-silence processing.",
      domain: "plugin",
    }),
    makeSeed({
      language: "cpp",
      problemType: "save_plugin_state_information",
      question: "Plugin parameters are not serialized in state save callback.",
      explanation: "Implement complete getStateInformation payload including all automatable parameters.",
      code: "void getStateInformation(juce::MemoryBlock& dest) override {\n  copyXmlToBinary(*state.createXml(), dest);\n}",
      why: "State serialization is required for reliable project recall in DAWs.",
      domain: "plugin",
    }),
    makeSeed({
      language: "cpp",
      problemType: "restore_plugin_state_information",
      question: "Plugin recall callback does not restore serialized parameter state.",
      explanation: "Parse persisted state and restore all parameters atomically.",
      code: "void setStateInformation(const void* data, int size) override {\n  if (auto xml = getXmlFromBinary(data, size)) state.replaceState(juce::ValueTree::fromXml(*xml));\n}",
      why: "Missing restore path causes broken sessions and inconsistent mixes.",
      domain: "plugin",
    }),
    makeSeed({
      language: "cpp",
      problemType: "midi_channel_filtering",
      question: "Incoming MIDI events are processed without channel filtering.",
      explanation: "Filter MIDI by enabled channel mask before dispatching note handlers.",
      code: "if (msg.isForChannel(targetChannel)) handleMessage(msg);",
      why: "Channel filtering avoids accidental triggers in multi-device setups.",
      domain: "plugin",
    }),
    makeSeed({
      language: "cpp",
      problemType: "report_latency_to_host",
      question: "DSP latency is introduced but not reported back to host.",
      explanation: "Compute and expose plugin latency samples so host can compensate timing.",
      code: "setLatencySamples(static_cast<int>(lookaheadSamples));",
      why: "Unreported latency leads to phase/timing errors in session playback.",
      domain: "plugin",
    }),
    makeSeed({
      language: "cpp",
      problemType: "sample_accurate_parameter_changes",
      question: "Parameters update per block only, causing zippering in fast automation.",
      explanation: "Interpolate parameter changes per sample or per small ramp segment.",
      code: "for (int i = 0; i < numSamples; ++i) {\n  auto g = smoother.getNextValue();\n  buffer.setSample(ch, i, buffer.getSample(ch, i) * g);\n}",
      why: "Sample-accurate updates are required for clean automation playback.",
      domain: "plugin",
    }),
    makeSeed({
      language: "cpp",
      problemType: "bypass_processing_path",
      question: "Bypass mode still executes full nonlinear processing path.",
      explanation: "Implement explicit bypass branch with optional latency-compensated passthrough.",
      code: "if (bypass) {\n  bypassCopy(input, output);\n  return;\n}",
      why: "Dedicated bypass improves CPU efficiency and expected host behavior.",
      domain: "plugin",
    }),
    makeSeed({
      language: "cpp",
      problemType: "prepare_to_play_initialization",
      question: "DSP state is not initialized in prepareToPlay with runtime sample-rate/buffer info.",
      explanation: "Initialize filters, smoothing constants, and buffers in prepareToPlay.",
      code: "void prepareToPlay(double sr, int maxBlock) override {\n  sampleRate = sr;\n  smoother.reset(sr, 0.02);\n  delay.prepare({ sr, static_cast<juce::uint32>(maxBlock), 2 });\n}",
      why: "Proper init prevents invalid coefficients and crashes when host settings change.",
      domain: "plugin",
    }),
  ];

  const dsp: SeedSpec[] = [
    makeSeed({
      language: "cpp",
      problemType: "fft_power_of_two_with_window",
      question: "FFT analysis path accepts arbitrary frame sizes and omits explicit windowing.",
      explanation: "Use power-of-two FFT sizes and apply a deterministic window before transform.",
      code: "jassert(isPowerOfTwo(fftSize));\nfor (int i = 0; i < fftSize; ++i) frame[i] *= hann[i];",
      why: "Correct FFT constraints and windowing reduce spectral distortion.",
      domain: "dsp",
    }),
    makeSeed({
      language: "general",
      problemType: "spectral_leakage_windowing",
      question: "Frequency estimation assumes rectangular windows and ignores leakage.",
      explanation: "Apply Hann/Hamming/Blackman windows for stable peak isolation.",
      code: "windowed[n] = input[n] * 0.5 * (1 - cos((2 * PI * n) / (N - 1)));",
      why: "Leakage control improves frequency-bin accuracy for analysis tools.",
      domain: "dsp",
    }),
    makeSeed({
      language: "general",
      problemType: "stft_overlap_add_required",
      question: "STFT synthesis path processes frames independently without overlap-add reconstruction.",
      explanation: "Apply overlap-add when inverse-transforming windowed frames.",
      code: "for (int n = 0; n < frameSize; n++) output[offset + n] += frame[n] * synthesisWindow[n];",
      why: "Overlap-add is required to avoid blocking artifacts in time-domain reconstruction.",
      domain: "dsp",
    }),
    makeSeed({
      language: "cpp",
      problemType: "convolution_fft_for_large_ir",
      question: "Long-kernel convolution is executed directly in time domain.",
      explanation: "Switch to partitioned FFT convolution for long impulse responses.",
      code: "if (irLength > 256) {\n  runPartitionedFftConvolution(input, ir, output);\n}",
      why: "FFT convolution scales better and keeps CPU stable for long IR processing.",
      domain: "dsp",
    }),
    makeSeed({
      language: "cpp",
      problemType: "iir_stability_guard",
      question: "IIR coefficient updates do not enforce stability bounds at extreme settings.",
      explanation: "Clamp pole radius and guard coefficient calculations for numerical stability.",
      code: "pole = std::clamp(pole, -0.999f, 0.999f);\na1 = -2.0f * pole * cosf(w0);",
      why: "Unstable filters can explode output and damage downstream processing.",
      domain: "dsp",
    }),
    makeSeed({
      language: "cpp",
      problemType: "biquad_coeff_overflow_guard",
      question: "Biquad coefficient calculation overflows near low-frequency edge cases.",
      explanation: "Guard denominator terms and clamp Q/gain ranges before coefficient solve.",
      code: "const float safeQ = std::max(0.1f, q);\nconst float alpha = sinW0 / (2.0f * safeQ);",
      why: "Coefficient guards prevent NaNs and unstable resonance behavior.",
      domain: "dsp",
    }),
    makeSeed({
      language: "general",
      problemType: "saturate_to_prevent_clipping",
      question: "Signal path applies nonlinear gain without post-stage saturation.",
      explanation: "Apply controlled soft clipping or limiter stage after nonlinear gain.",
      code: "float saturate(float x) { return tanhf(x); }",
      why: "Saturation prevents harsh digital clipping and speaker-threatening peaks.",
      domain: "dsp",
    }),
    makeSeed({
      language: "general",
      problemType: "compressor_attack_release_ms",
      question: "Compressor attack/release values are interpreted as samples, not milliseconds.",
      explanation: "Convert ms parameters to coefficients using sample rate.",
      code: "const float attackCoeff = expf(-1.0f / (0.001f * attackMs * sampleRate));",
      why: "Unit-correct dynamics tuning is essential for predictable behavior across sample rates.",
      domain: "dsp",
    }),
    makeSeed({
      language: "cpp",
      problemType: "limiter_lookahead_buffer",
      question: "Limiter stage has no lookahead and clips fast transients.",
      explanation: "Add a lookahead buffer and gain computer that anticipates upcoming peaks.",
      code: "lookahead.push(sample);\nconst env = detectPeak(lookahead.peek(delaySamples));\napplyGain(sample, env);",
      why: "Lookahead enables transparent limiting without transient distortion.",
      domain: "dsp",
    }),
    makeSeed({
      language: "cpp",
      problemType: "dc_offset_removal_highpass",
      question: "Distortion stage introduces DC offset and no corrective filter is present.",
      explanation: "Run a gentle high-pass (DC blocker) after nonlinear processing.",
      code: "y[n] = x[n] - x[n-1] + 0.995f * y[n-1];",
      why: "DC removal preserves headroom and prevents low-frequency drift.",
      domain: "dsp",
    }),
  ];

  const ai: SeedSpec[] = [
    makeSeed({
      language: "general",
      problemType: "prompt_versioning_and_tracking",
      question: "Production prompts are edited in place with no version tracking.",
      explanation: "Store prompts with semantic version identifiers and changelog metadata.",
      code: "const prompt = { id: 'summarizer', version: 'v3.2.0', text: PROMPT_TEXT };",
      why: "Versioned prompts enable rollback, evaluation, and reproducible incident debugging.",
      domain: "ai",
    }),
    makeSeed({
      language: "typescript",
      problemType: "model_fallback_chain",
      question: "Agent runtime has a single-model dependency with no contingency fallback.",
      explanation: "Implement ordered model fallback with deterministic provider switching.",
      code: "for (const provider of providers) {\n  const result = await provider.call(input);\n  if (result.ok) return result;\n}",
      why: "Fallback chains maintain uptime during provider outages or quota exhaustion.",
      domain: "ai",
    }),
    makeSeed({
      language: "typescript",
      problemType: "retry_with_exponential_backoff",
      question: "Model API timeout path retries immediately without backoff.",
      explanation: "Use exponential backoff with jitter for transient LLM/network failures.",
      code: "const delayMs = Math.min(30_000, 500 * 2 ** attempt + Math.random() * 250);\nawait sleep(delayMs);",
      why: "Backoff avoids thundering-herd retries and improves success probability.",
      domain: "ai",
    }),
    makeSeed({
      language: "typescript",
      problemType: "structured_output_validation",
      question: "LLM output is consumed directly without schema validation.",
      explanation: "Validate model JSON output with schema guards before downstream use.",
      code: "const parsed = schema.safeParse(JSON.parse(text));\nif (!parsed.success) throw new Error('invalid_model_output');",
      why: "Structured validation blocks hallucinated formats from propagating into tools.",
      domain: "ai",
    }),
    makeSeed({
      language: "typescript",
      problemType: "llm_cost_tracking",
      question: "LLM calls are issued without per-request token and cost telemetry.",
      explanation: "Track prompt/completion tokens and aggregate estimated spend per workflow.",
      code: "costTracker.add({ provider, model, promptTokens, completionTokens, usd });",
      why: "Cost observability enables budget controls and informed model routing decisions.",
      domain: "ai",
    }),
  ];

  const allSpecs = [...webAudio, ...musicTheory, ...plugin, ...dsp, ...ai];
  if (allSpecs.length !== 50) {
    throw new Error(`Expected exactly 50 expert seeds, found ${allSpecs.length}`);
  }

  return allSpecs.map((spec) => ({
    language: spec.language,
    problemType: spec.problemType,
    question: spec.question,
    answer: `${spec.explanation}\n\nCode example:\n${spec.code}\n\nWhy it matters: ${spec.why}`,
    confidence: "high",
    domain: spec.domain,
    patternTags: spec.problemType.split("_").slice(0, 4),
    actionItems: ["Implement the remediation", "Add regression tests"],
  }));
}

async function insertExpertSeeds(tableName: "knowledge" | "knowledge_entries", progress: TrainProgress): Promise<{ added: number; duplicates: number }> {
  if (progress.seedsCompleted) {
    return { added: 0, duplicates: 0 };
  }

  const seeds = buildExpertSeedPatterns();
  let added = 0;
  let duplicates = 0;

  for (const seed of seeds) {
    const result = await persistPatterns(
      tableName,
      "expert-seed",
      "expert-seed",
      `seed/${seed.problemType}`,
      seed.answer,
      [seed],
      progress
    );
    added += result.added;
    duplicates += result.duplicates;
  }

  progress.seedsCompleted = true;
  saveProgress(progress);
  return { added, duplicates };
}

function estimateRemainingPatternTotal(progress: TrainProgress): number {
  const completed = new Set(progress.completedRepos);
  const remainingRepos = TARGET_REPOS.filter((repo) => !completed.has(repo.slug));
  const remainingRepoEstimate = remainingRepos.length * MAX_FILES_PER_REPO * 2;
  const seedEstimate = progress.seedsCompleted ? 0 : 50;
  return Math.max(1, progress.added + progress.duplicates + remainingRepoEstimate + seedEstimate);
}

function summarizeRun(
  progress: TrainProgress,
  startAdded: number,
  startDuplicates: number,
  startDomains: Record<Domain, number>,
  startProviders: Record<ProviderName, number>
): {
  summary: TrainingSummary;
  runProviders: Record<ProviderName, number>;
} {
  const runProviders = emptyProviderUsage();
  (Object.keys(runProviders) as ProviderName[]).forEach((provider) => {
    runProviders[provider] = progress.providerUsage[provider] - startProviders[provider];
  });

  const summary: TrainingSummary = {
    general: progress.domainCounts.general - startDomains.general,
    ui: progress.domainCounts.ui - startDomains.ui,
    audio: progress.domainCounts.audio - startDomains.audio,
    plugin: progress.domainCounts.plugin - startDomains.plugin,
    dsp: progress.domainCounts.dsp - startDomains.dsp,
    ai: progress.domainCounts.ai - startDomains.ai,
    total:
      (progress.domainCounts.general - startDomains.general) +
      (progress.domainCounts.ui - startDomains.ui) +
      (progress.domainCounts.audio - startDomains.audio) +
      (progress.domainCounts.plugin - startDomains.plugin) +
      (progress.domainCounts.dsp - startDomains.dsp) +
      (progress.domainCounts.ai - startDomains.ai),
    newThisRun: progress.added - startAdded,
    duplicates: progress.duplicates - startDuplicates,
  };

  return { summary, runProviders };
}

function estimatedSavingsUsdPerThousand(runProviders: Record<ProviderName, number>, summary: TrainingSummary): number {
  const total = Math.max(1, summary.newThisRun + summary.duplicates);
  const paidRatio = runProviders.anthropic / total;
  const freeOrLocalRatio = 1 - paidRatio;
  return Math.max(0, freeOrLocalRatio * 6.25);
}

function printProviderUsage(runProviders: Record<ProviderName, number>): void {
  console.log("Provider usage this run:");
  console.log(`  Groq:         ${runProviders.groq} patterns`);
  console.log(`  OpenRouter:   ${runProviders.openrouter} patterns`);
  console.log(`  Cerebras:     ${runProviders.cerebras} patterns`);
  console.log(`  Ollama Cloud: ${runProviders["ollama-cloud"]} patterns`);
  console.log(`  Ollama Local: ${runProviders["ollama-local"]} patterns`);
  console.log(`  Anthropic:    ${runProviders.anthropic} patterns`);
  console.log(`  Static:       ${runProviders.static} patterns`);
}

function printFinalSummary(summary: TrainingSummary, totalKbEntries: number, savings: number): void {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Training Complete!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  General patterns:    ${summary.general}`);
  console.log(`  UI/UX patterns:      ${summary.ui}`);
  console.log(`  Audio patterns:      ${summary.audio}`);
  console.log(`  Plugin patterns:     ${summary.plugin}`);
  console.log(`  DSP patterns:        ${summary.dsp}`);
  console.log(`  AI system patterns:  ${summary.ai}`);
  console.log(`  Total KB entries:    ${totalKbEntries}`);
  console.log(`  New this run:        ${summary.newThisRun}`);
  console.log(`  Already known:       ${summary.duplicates} (skipped duplicates)`);
  console.log(`  Estimated savings:   $${savings.toFixed(2)} per 1000 analyses`);
  console.log("  Your agents are now expert-level.");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

// SECTION_MAIN
async function main(): Promise<void> {
  printHeader();

  const providerStatus = await printProviderStatus();

  if (DRY_RUN) {
    const estimate = estimateDryRunByDomain();
    printDryRunPlan(estimate);
    console.log("");
    console.log(`[dry-run] Resumable progress path: ${PROGRESS_PATH}`);
    console.log("[dry-run] Ctrl+C safety is enabled for real runs (state is saved after each file).\n");
    return;
  }

  const tableName = await resolveKnowledgeTableName();
  const totalBefore = await countKnowledgeEntries(tableName);
  const progress = loadProgress();

  const startAdded = progress.added;
  const startDuplicates = progress.duplicates;
  const startDomains = { ...progress.domainCounts };
  const startProviders = { ...progress.providerUsage };

  console.log(`Using DB: ${DB_PATH}`);
  console.log(`Target table: ${tableName}`);

  if (fs.existsSync(PROGRESS_PATH)) {
    console.log(`[resume] Loaded ${progress.completedRepos.length}/${TARGET_REPOS.length} completed repos from ${PROGRESS_PATH}`);
  }

  let shuttingDown = false;
  process.on("SIGINT", () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nInterrupted. Saving progress...");
    saveProgress(progress);
    process.exit(130);
  });

  const seedResult = await insertExpertSeeds(tableName, progress);
  if (seedResult.added > 0 || seedResult.duplicates > 0) {
    console.log(`[seed] inserted ${seedResult.added}, duplicates ${seedResult.duplicates}`);
  }

  let estimatedPatternTotal = estimateRemainingPatternTotal(progress);
  for (const repo of TARGET_REPOS) {
    await analyzeRepo(tableName, repo, providerStatus, progress, estimatedPatternTotal);
    estimatedPatternTotal = estimateRemainingPatternTotal(progress);
  }

  saveProgress(progress);
  const totalAfter = await countKnowledgeEntries(tableName);

  const { summary, runProviders } = summarizeRun(progress, startAdded, startDuplicates, startDomains, startProviders);
  const savings = estimatedSavingsUsdPerThousand(runProviders, summary);

  printFinalSummary(summary, totalAfter, savings);
  printProviderUsage(runProviders);
  console.log(`\nDB delta this run: ${totalAfter - totalBefore}`);
}

function isDirectExecution(): boolean {
  const entryPoint = process.argv[1];
  if (!entryPoint) return false;
  return import.meta.url === pathToFileURL(resolve(entryPoint)).href;
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

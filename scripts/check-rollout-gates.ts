#!/usr/bin/env tsx

type RolloutGate = {
  id: string;
  label: string;
  threshold: unknown;
  value: unknown;
  passed: boolean | null;
};

type RolloutGatePayload = {
  gateVersion: string;
  autoGatePass: boolean;
  gates: RolloutGate[];
};

const DEFAULT_API_BASE = "http://127.0.0.1:3000";
const REQUEST_TIMEOUT_MS = 8_000;

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function formatValue(value: unknown): string {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toString() : "NaN";
  }

  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return "null";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseHoursArg(argv: string[]): number {
  let raw = "24";

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token.startsWith("--hours=")) {
      raw = token.slice("--hours=".length);
      break;
    }

    if (token === "--hours" && argv[index + 1]) {
      raw = argv[index + 1] as string;
      break;
    }
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 24;
  return Math.min(168, Math.max(1, parsed));
}

async function fetchRolloutPayload(apiBase: string, hours: number): Promise<unknown> {
  const base = apiBase.endsWith("/") ? apiBase.slice(0, -1) : apiBase;
  const url = `${base}/api/metrics/rollout-gates?hours=${hours}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to reach rollout-gates endpoint at ${url}: ${message}`);
  }

  const rawBody = await response.text().catch(() => "");

  if (!response.ok) {
    const suffix = rawBody.trim().length > 0 ? ` :: ${rawBody.trim()}` : "";
    throw new Error(`Rollout-gates endpoint returned ${response.status} ${response.statusText}${suffix}`);
  }

  try {
    return rawBody.length > 0 ? JSON.parse(rawBody) : {};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Rollout-gates endpoint returned invalid JSON: ${message}`);
  }
}

function parseRolloutPayload(payload: unknown): RolloutGatePayload {
  const obj = asObject(payload);

  const gateVersion = String(obj.gateVersion ?? "").trim();
  if (!gateVersion) {
    throw new Error("Invalid rollout-gates payload: missing gateVersion");
  }

  const autoGatePassRaw = obj.autoGatePass;
  if (typeof autoGatePassRaw !== "boolean") {
    throw new Error("Invalid rollout-gates payload: autoGatePass must be boolean");
  }

  const gatesRaw = obj.gates;
  if (!Array.isArray(gatesRaw)) {
    throw new Error("Invalid rollout-gates payload: gates must be an array");
  }

  const gates: RolloutGate[] = gatesRaw.map((gateRaw, index) => {
    const gate = asObject(gateRaw);
    const id = String(gate.id ?? "").trim();
    const label = String(gate.label ?? "").trim();
    const passedRaw = gate.passed;

    if (!id) {
      throw new Error(`Invalid rollout-gates payload: gates[${index}] missing id`);
    }

    if (!label) {
      throw new Error(`Invalid rollout-gates payload: gates[${index}] missing label`);
    }

    if (passedRaw !== null && typeof passedRaw !== "boolean") {
      throw new Error(`Invalid rollout-gates payload: gates[${index}].passed must be boolean or null`);
    }

    return {
      id,
      label,
      threshold: gate.threshold ?? null,
      value: gate.value ?? null,
      passed: passedRaw,
    };
  });

  return {
    gateVersion,
    autoGatePass: autoGatePassRaw,
    gates,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const hours = parseHoursArg(argv);
  const apiBase = process.env.API_BASE?.trim() || DEFAULT_API_BASE;

  try {
    const rawPayload = await fetchRolloutPayload(apiBase, hours);
    const payload = parseRolloutPayload(rawPayload);

    console.log(`Rollout gates from ${apiBase} (hours=${hours})`);
    console.log(`Gate version: ${payload.gateVersion}`);

    for (const gate of payload.gates) {
      const status = gate.passed === true
        ? "PASS"
        : gate.passed === false
          ? "FAIL"
          : "MANUAL";

      console.log(
        `- [${status}] ${gate.id} (${gate.label}) threshold=${formatValue(gate.threshold)} value=${formatValue(gate.value)}`,
      );
    }

    console.log(`Auto gates: ${payload.autoGatePass ? "PASS" : "FAIL"}`);

    if (!payload.autoGatePass) {
      process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`check-rollout-gates failed: ${message}`);
    process.exitCode = 1;
  }
}

void main();

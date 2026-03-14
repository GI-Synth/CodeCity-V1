import crypto from "node:crypto";
import os from "node:os";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const GITHUB_TOKEN_SETTING_KEY = "github_token";
const ENCRYPTION_VERSION = "v1";
const TOKEN_HINT_LENGTH = 8;
const TOKEN_CACHE_TTL_MS = 60_000;

let cachedDbToken: { token: string | null; expiresAtMs: number } | null = null;

function deriveMachineKey(): Buffer {
  return crypto.createHash("sha256").update(os.hostname()).digest();
}

function normalizeToken(token: string | null | undefined): string {
  return (token ?? "").trim();
}

function fromEnvToken(): string {
  return normalizeToken(process.env["GITHUB_TOKEN"] ?? process.env["GH_TOKEN"]);
}

export function githubTokenHint(token: string): string {
  return normalizeToken(token).slice(0, TOKEN_HINT_LENGTH);
}

export function encryptGithubToken(token: string): string {
  const normalized = normalizeToken(token);
  if (!normalized) throw new Error("GitHub token cannot be empty");

  const iv = crypto.randomBytes(12);
  const key = deriveMachineKey();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(normalized, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    ENCRYPTION_VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptGithubToken(encoded: string): string | null {
  if (!encoded) return null;

  const parts = encoded.split(":");
  if (parts.length !== 4 || parts[0] !== ENCRYPTION_VERSION) return null;

  try {
    const iv = Buffer.from(parts[1], "base64url");
    const authTag = Buffer.from(parts[2], "base64url");
    const encrypted = Buffer.from(parts[3], "base64url");

    const decipher = crypto.createDecipheriv("aes-256-gcm", deriveMachineKey(), iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");

    return normalizeToken(decrypted) || null;
  } catch {
    return null;
  }
}

async function readEncryptedTokenFromDb(): Promise<string | null> {
  const rows = await db
    .select({ value: settingsTable.value })
    .from(settingsTable)
    .where(eq(settingsTable.key, GITHUB_TOKEN_SETTING_KEY))
    .limit(1);

  return rows[0]?.value ?? null;
}

async function readTokenFromDbCached(): Promise<string | null> {
  if (cachedDbToken && cachedDbToken.expiresAtMs > Date.now()) {
    return cachedDbToken.token;
  }

  const encrypted = await readEncryptedTokenFromDb();
  const token = encrypted ? decryptGithubToken(encrypted) : null;

  cachedDbToken = {
    token,
    expiresAtMs: Date.now() + TOKEN_CACHE_TTL_MS,
  };

  return token;
}

export async function saveGithubToken(token: string): Promise<{ tokenHint: string }> {
  const normalized = normalizeToken(token);
  if (!normalized) throw new Error("GitHub token cannot be empty");

  const encrypted = encryptGithubToken(normalized);
  await db.insert(settingsTable)
    .values({ key: GITHUB_TOKEN_SETTING_KEY, value: encrypted, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: encrypted, updatedAt: new Date().toISOString() },
    });

  cachedDbToken = {
    token: normalized,
    expiresAtMs: Date.now() + TOKEN_CACHE_TTL_MS,
  };

  return { tokenHint: githubTokenHint(normalized) };
}

export async function githubTokenStatus(): Promise<{ tokenOnFile: boolean; tokenHint: string | null }> {
  const dbToken = await readTokenFromDbCached();
  return {
    tokenOnFile: Boolean(dbToken),
    tokenHint: dbToken ? githubTokenHint(dbToken) : null,
  };
}

export async function resolveGithubTokenFromEnvOrDb(): Promise<string | null> {
  const envToken = fromEnvToken();
  if (envToken) return envToken;
  return await readTokenFromDbCached();
}

export async function resolveGithubToken(preferredToken?: string | null): Promise<string | null> {
  const explicit = normalizeToken(preferredToken);
  if (explicit) return explicit;
  return await resolveGithubTokenFromEnvOrDb();
}

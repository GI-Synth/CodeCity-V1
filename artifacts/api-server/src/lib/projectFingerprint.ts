import fs from "node:fs/promises";
import path from "node:path";
import type { FileInfo } from "./cityAnalyzer";

export interface ProjectFingerprint {
  type: string;
  language: string;
  framework: string[];
  hasTests: boolean;
  hasAuth: boolean;
  usesDB: boolean;
  isAudioProject: boolean;
  isPlugin: boolean;
  complexity: "low" | "medium" | "high";
  relevantDomains: string[];
}

type PackageJsonShape = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type FingerprintSignals = {
  filePaths: string[];
  fileContents: string[];
  dependencies: Record<string, string>;
};

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", "target"]);

function normalizeDependencyMap(pkg: PackageJsonShape | null): Record<string, string> {
  return {
    ...(pkg?.dependencies ?? {}),
    ...(pkg?.devDependencies ?? {}),
  };
}

function hasAnyDependency(deps: Record<string, string>, names: string[]): boolean {
  return names.some((name) => Object.prototype.hasOwnProperty.call(deps, name));
}

function detectFramework(deps: Record<string, string>): string[] {
  const framework: string[] = [];

  if (deps["express"]) framework.push("express");
  if (deps["react"]) framework.push("react");
  if (deps["vue"]) framework.push("vue");
  if (deps["next"] || deps["nextjs"]) framework.push("next");
  if (deps["fastify"]) framework.push("fastify");
  if (deps["nestjs"] || deps["@nestjs/core"]) framework.push("nestjs");
  if (deps["svelte"] || deps["@sveltejs/kit"]) framework.push("svelte");

  return framework;
}

function detectProjectType(deps: Record<string, string>, filePaths: string[], framework: string[]): string {
  const lowerPaths = filePaths.map((file) => file.toLowerCase());

  if (framework.includes("react") || framework.includes("next") || framework.includes("vue") || framework.includes("svelte")) {
    return "frontend-app";
  }

  if (framework.includes("express") || framework.includes("fastify") || framework.includes("nestjs")) {
    return "node-api";
  }

  if (lowerPaths.some((file) => file.endsWith("requirements.txt") || file.endsWith("pyproject.toml"))) {
    return "python-project";
  }

  if (hasAnyDependency(deps, ["vite", "webpack", "rollup"])) {
    return "web-app";
  }

  if (lowerPaths.some((file) => file.endsWith("package.json"))) {
    return "node-project";
  }

  return "generic-project";
}

function detectPrimaryLanguage(filePaths: string[]): string {
  const counts = new Map<string, number>();

  for (const filePath of filePaths) {
    const ext = path.extname(filePath).toLowerCase();
    if (!ext) continue;
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }

  const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const top = ranked[0]?.[0] ?? "";

  if (top === ".ts" || top === ".tsx") return "typescript";
  if (top === ".js" || top === ".jsx") return "javascript";
  if (top === ".py") return "python";
  if (top === ".go") return "go";
  if (top === ".rs") return "rust";

  return top ? top.replace(".", "") : "unknown";
}

function hasTestFiles(filePaths: string[]): boolean {
  return filePaths.some((filePath) => {
    const lower = filePath.toLowerCase();
    return (
      lower.includes("/test/") ||
      lower.includes("/tests/") ||
      lower.includes("/__tests__/") ||
      lower.endsWith(".test.ts") ||
      lower.endsWith(".test.js") ||
      lower.endsWith(".spec.ts") ||
      lower.endsWith(".spec.js") ||
      lower.startsWith("test/") ||
      lower.startsWith("tests/")
    );
  });
}

function detectAuth(deps: Record<string, string>, fileContents: string[]): boolean {
  if (hasAnyDependency(deps, ["passport", "jsonwebtoken", "next-auth", "auth0", "@supabase/supabase-js", "firebase-auth"])) {
    return true;
  }

  const sampled = fileContents.slice(0, 80).join("\n").toLowerCase();
  return sampled.includes("jwt") || sampled.includes("oauth") || sampled.includes("signin") || sampled.includes("authenticate");
}

function detectDB(deps: Record<string, string>, fileContents: string[]): boolean {
  if (hasAnyDependency(deps, ["drizzle-orm", "prisma", "sequelize", "typeorm", "mongoose", "pg", "mysql2", "sqlite3", "@libsql/client"])) {
    return true;
  }

  const sampled = fileContents.slice(0, 80).join("\n").toLowerCase();
  return sampled.includes("select ") || sampled.includes("insert into") || sampled.includes("database") || sampled.includes("migration");
}

function detectAudioProject(deps: Record<string, string>, fileContents: string[]): boolean {
  if (hasAnyDependency(deps, ["tone", "tonejs", "web-audio", "webmidi", "howler", "pizzicato", "wavesurfer"])) {
    return true;
  }

  const sampled = fileContents.slice(0, 120).join("\n").toLowerCase();
  return sampled.includes("audio context") || sampled.includes("webaudio") || sampled.includes("midi") || sampled.includes("oscillator");
}

function detectPluginProject(deps: Record<string, string>, filePaths: string[], fileContents: string[]): boolean {
  if (hasAnyDependency(deps, ["juce", "vst3", "audiounit", "clap"])) {
    return true;
  }

  const pathBlob = filePaths.join("\n").toLowerCase();
  if (pathBlob.includes("juce") || pathBlob.includes("vst") || pathBlob.includes("plugin")) {
    return true;
  }

  const sampled = fileContents.slice(0, 120).join("\n").toLowerCase();
  return sampled.includes("vst") || sampled.includes("audio unit") || sampled.includes("juce") || sampled.includes("pluginprocessor");
}

function detectComplexity(fileCount: number, dependencyCount: number): "low" | "medium" | "high" {
  if (fileCount > 500 || dependencyCount > 80) return "high";
  if (fileCount > 120 || dependencyCount > 25) return "medium";
  return "low";
}

function buildFingerprintFromSignals(signals: FingerprintSignals): ProjectFingerprint {
  const framework = detectFramework(signals.dependencies);
  const language = detectPrimaryLanguage(signals.filePaths);
  const isAudioProject = detectAudioProject(signals.dependencies, signals.fileContents);
  const isPlugin = detectPluginProject(signals.dependencies, signals.filePaths, signals.fileContents);

  const relevantDomains = ["general"];
  if (isAudioProject) relevantDomains.push("audio");
  if (isPlugin) relevantDomains.push("plugin");

  return {
    type: detectProjectType(signals.dependencies, signals.filePaths, framework),
    language,
    framework,
    hasTests: hasTestFiles(signals.filePaths),
    hasAuth: detectAuth(signals.dependencies, signals.fileContents),
    usesDB: detectDB(signals.dependencies, signals.fileContents),
    isAudioProject,
    isPlugin,
    complexity: detectComplexity(signals.filePaths.length, Object.keys(signals.dependencies).length),
    relevantDomains,
  };
}

async function readPackageJson(repoPath: string): Promise<PackageJsonShape | null> {
  const packageJsonPath = path.join(repoPath, "package.json");

  try {
    const raw = await fs.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as PackageJsonShape;
    return parsed;
  } catch {
    return null;
  }
}

async function collectFiles(repoPath: string, maxFiles = 1500): Promise<string[]> {
  const collected: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    if (collected.length >= maxFiles) return;

    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (collected.length >= maxFiles) break;

      const fullPath = path.join(currentPath, entry.name);
      const relative = path.relative(repoPath, fullPath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(fullPath);
        continue;
      }

      collected.push(relative);
    }
  }

  await walk(repoPath);
  return collected;
}

async function sampleFileContents(repoPath: string, filePaths: string[], maxFiles = 120): Promise<string[]> {
  const selected = filePaths.filter((filePath) => {
    const lower = filePath.toLowerCase();
    return lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".py") || lower.endsWith(".md") || lower.endsWith(".json");
  }).slice(0, maxFiles);

  const contents = await Promise.all(selected.map(async (relativePath) => {
    const absolutePath = path.join(repoPath, relativePath);
    try {
      const raw = await fs.readFile(absolutePath, "utf8");
      return raw.slice(0, 2000);
    } catch {
      return "";
    }
  }));

  return contents.filter(Boolean);
}

export async function fingerprintProject(repoPath: string): Promise<ProjectFingerprint> {
  const [pkg, filePaths] = await Promise.all([
    readPackageJson(repoPath),
    collectFiles(repoPath),
  ]);

  const fileContents = await sampleFileContents(repoPath, filePaths);

  return buildFingerprintFromSignals({
    filePaths,
    fileContents,
    dependencies: normalizeDependencyMap(pkg),
  });
}

export function fingerprintFromRepoFiles(files: FileInfo[]): ProjectFingerprint {
  const packageFile = files.find((file) => file.path.toLowerCase() === "package.json");
  let pkg: PackageJsonShape | null = null;

  if (packageFile?.content) {
    try {
      pkg = JSON.parse(packageFile.content) as PackageJsonShape;
    } catch {
      pkg = null;
    }
  }

  return buildFingerprintFromSignals({
    filePaths: files.map((file) => file.path),
    fileContents: files.map((file) => file.content.slice(0, 2000)),
    dependencies: normalizeDependencyMap(pkg),
  });
}

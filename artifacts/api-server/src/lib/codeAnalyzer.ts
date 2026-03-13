export type FileType = "source" | "test" | "config" | "api" | "database" | "style" | "class" | "function" | "entry" | "unknown";

export interface FileMetrics {
  loc: number;
  complexity: number;
  functions: string[];
  classes: string[];
  imports: string[];
  exports: string[];
  language: string;
  fileType: FileType;
}

interface CacheEntry {
  result: FileMetrics;
  hash: string;
  timestamp: number;
}

const MAX_CACHE_SIZE = 500;
const analysisCache = new Map<string, CacheEntry>();

function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash.toString(36);
}

function evictIfNeeded(): void {
  if (analysisCache.size <= MAX_CACHE_SIZE) return;
  let oldest = Infinity;
  let oldestKey = "";
  for (const [key, entry] of analysisCache) {
    if (entry.timestamp < oldest) {
      oldest = entry.timestamp;
      oldestKey = key;
    }
  }
  if (oldestKey) analysisCache.delete(oldestKey);
}

const EXT_LANG: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript",
  ".js": "javascript", ".jsx": "javascript",
  ".py": "python", ".go": "go", ".rs": "rust",
  ".java": "java", ".cs": "csharp", ".rb": "ruby",
  ".php": "php", ".swift": "swift", ".kt": "kotlin",
  ".scala": "scala", ".cpp": "cpp", ".c": "c",
  ".sh": "bash", ".css": "css", ".scss": "css",
  ".html": "html", ".yaml": "yaml", ".yml": "yaml",
  ".json": "json", ".toml": "toml", ".md": "markdown",
  ".sql": "sql", ".env": "env",
};

export class CodeAnalyzer {
  detectLanguage(filename: string): string {
    const ext = "." + (filename.split(".").pop()?.toLowerCase() ?? "");
    return EXT_LANG[ext] ?? "plaintext";
  }

  detectFileType(filename: string, content: string): FileType {
    const lower = filename.toLowerCase();
    const pathParts = lower.replace(/\\/g, "/");

    if (pathParts.includes("/test/") || pathParts.includes("/spec/") || pathParts.includes("/tests/") || pathParts.includes("/__tests__/")) return "test";
    if (lower.endsWith(".test.ts") || lower.endsWith(".test.js") || lower.endsWith(".spec.ts") || lower.endsWith(".spec.js") ||
        lower.endsWith(".test.tsx") || lower.endsWith(".spec.tsx")) return "test";
    if (pathParts.includes("/api/") || content.includes("@app.route") || content.includes("router.get") ||
        content.includes("router.post") || content.includes("app.get(") || content.includes("app.post(")) return "api";
    if (pathParts.includes("/db/") || pathParts.includes("/database/") || pathParts.includes("/models/") ||
        pathParts.includes("/schema/") || pathParts.includes("/migration") || lower.endsWith(".sql")) return "database";
    if (lower.startsWith("config.") || lower.includes(".config.") || lower.startsWith(".env") || lower === "package.json" ||
        lower.startsWith("tsconfig") || lower.endsWith(".yaml") || lower.endsWith(".yml") || lower.endsWith(".toml") ||
        lower.endsWith(".env")) return "config";
    if (lower.endsWith(".css") || lower.endsWith(".scss") || lower.endsWith(".sass") || lower.endsWith(".less")) return "style";
    return "source";
  }

  computeLOC(content: string): number {
    const lines = content.split("\n");
    return lines.filter(line => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return false;
      if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*") ||
          trimmed.startsWith("*") || trimmed.startsWith("-->") || trimmed.startsWith("<!--")) return false;
      return true;
    }).length;
  }

  computeComplexity(content: string, language: string): number {
    let count = 1;

    if (language === "python") {
      const pyPatterns = [/\bif\b/g, /\belif\b/g, /\belse\b/g, /\bfor\b/g, /\bwhile\b/g, /\bexcept\b/g, /\band\b/g, /\bor\b/g];
      for (const pat of pyPatterns) count += (content.match(pat) ?? []).length;
    } else {
      const jsPatterns = [
        /\bif\b/g, /\belse\b/g, /\bfor\b/g, /\bwhile\b/g, /\bswitch\b/g,
        /\bcatch\b/g, /\bcase\b/g, /&&/g, /\|\|/g, /\?\?/g, /\?\./g,
      ];
      for (const pat of jsPatterns) count += (content.match(pat) ?? []).length;
      const ternary = content.match(/[^?]\?[^?:.]/g) ?? [];
      count += ternary.length;
    }

    return Math.min(50, count);
  }

  extractImports(content: string, language: string): string[] {
    const imports: string[] = [];

    if (language === "python") {
      const importRe = /^(?:from\s+([\w.]+)\s+import|import\s+([\w.,\s]+))/gm;
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(content)) !== null) {
        const mod = (m[1] ?? m[2] ?? "").trim().split(",")[0].trim();
        if (mod) imports.push(mod);
      }
    } else {
      const esImport = /import\s+(?:[\w\s{},*]+\s+from\s+)?['"]([^'"]+)['"]/g;
      const require_ = /require\(['"]([^'"]+)['"]\)/g;
      let m: RegExpExecArray | null;
      while ((m = esImport.exec(content)) !== null) imports.push(m[1]);
      while ((m = require_.exec(content)) !== null) imports.push(m[1]);
    }

    return [...new Set(imports)];
  }

  extractExports(content: string, language: string): string[] {
    const exports_: string[] = [];

    if (language === "typescript" || language === "javascript") {
      const namedExport = /export\s+(?:const|function|class|interface|type|enum|async\s+function)\s+([\w$]+)/g;
      const defaultExport = /export\s+default\s+(?:function\s+)?([\w$]+)/g;
      let m: RegExpExecArray | null;
      while ((m = namedExport.exec(content)) !== null) exports_.push(m[1]);
      while ((m = defaultExport.exec(content)) !== null) exports_.push(`default:${m[1]}`);
    } else if (language === "python") {
      const topLevel = /^(?:def|class)\s+([\w_]+)/gm;
      let m: RegExpExecArray | null;
      while ((m = topLevel.exec(content)) !== null) exports_.push(m[1]);
    }

    return exports_;
  }

  extractFunctions(content: string, language: string): string[] {
    const fns: string[] = [];

    if (language === "typescript" || language === "javascript") {
      const patterns = [
        /(?:function|async\s+function)\s+([\w$]+)\s*\(/g,
        /(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s+)?\(/g,
        /(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s+)?function/g,
        /([\w$]+)\s*\(.*\)\s*(?::\s*\w+)?\s*\{/g,
      ];
      const seen = new Set<string>();
      for (const pat of patterns) {
        let m: RegExpExecArray | null;
        while ((m = pat.exec(content)) !== null) {
          const name = m[1];
          if (name && !seen.has(name) && name !== "if" && name !== "for" && name !== "while" && name !== "switch") {
            seen.add(name);
            fns.push(name);
          }
        }
      }
    } else if (language === "python") {
      const re = /^def\s+([\w_]+)\s*\(/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) fns.push(m[1]);
    }

    return fns.slice(0, 20);
  }

  extractClasses(content: string, language: string): string[] {
    const classes: string[] = [];

    const re = /\bclass\s+([\w$]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) classes.push(m[1]);

    return classes;
  }

  analyzeFile(filename: string, content: string): FileMetrics {
    const contentHash = djb2(filename + content);
    const cacheKey = filename;
    const cached = analysisCache.get(cacheKey);
    if (cached && cached.hash === contentHash) {
      cached.timestamp = Date.now();
      return cached.result;
    }

    const language = this.detectLanguage(filename);
    const fileType = this.detectFileType(filename, content);
    const loc = this.computeLOC(content);
    const complexity = this.computeComplexity(content, language);
    const imports = this.extractImports(content, language);
    const exports = this.extractExports(content, language);
    const functions = this.extractFunctions(content, language);
    const classes = this.extractClasses(content, language);

    const result: FileMetrics = { loc, complexity, functions, classes, imports, exports, language, fileType };

    evictIfNeeded();
    analysisCache.set(cacheKey, { result, hash: contentHash, timestamp: Date.now() });

    return result;
  }
}

export const codeAnalyzer = new CodeAnalyzer();

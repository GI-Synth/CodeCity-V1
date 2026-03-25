import { getLanguage, type FileInfo } from "./cityAnalyzer";
import { resolveGithubTokenFromEnvOrDb } from "./githubTokenStore";

type GithubRepoMeta = {
  default_branch?: string;
};

async function getDefaultBranch(
  owner: string,
  repo: string,
  headers: Record<string, string>,
): Promise<string> {
  const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;
  const repoRes = await fetch(repoUrl, { headers });

  if (!repoRes.ok) {
    if (repoRes.status === 404) {
      throw new Error(
        `Repository '${owner}/${repo}' not found. If it's private, make sure your token has 'repo' scope.`,
      );
    }
    if (repoRes.status === 401) {
      throw new Error("Invalid GitHub token. Check that your Personal Access Token is correct and has 'repo' scope.");
    }
    if (repoRes.status === 403) {
      throw new Error("GitHub API rate limit exceeded, or your token lacks permission. Try again later.");
    }
    throw new Error(`GitHub API error while loading repo metadata: ${repoRes.status}`);
  }

  const meta = (await repoRes.json()) as GithubRepoMeta;
  return meta.default_branch && meta.default_branch.trim() !== ""
    ? meta.default_branch
    : "main";
}

export async function fetchGithubRepo(repoUrl: string, branch?: string, token?: string): Promise<{ files: FileInfo[]; repoName: string }> {
  // Parse and validate GitHub URL (SSRF prevention — only github.com allowed)
  let parsed: URL;
  try {
    parsed = new URL(repoUrl);
  } catch {
    throw new Error("Invalid GitHub URL. Expected format: https://github.com/owner/repo");
  }

  if (parsed.hostname !== "github.com") {
    throw new Error("Only github.com repositories are supported");
  }

  const pathParts = parsed.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
  if (pathParts.length < 2) {
    throw new Error("Invalid GitHub URL. Expected format: https://github.com/owner/repo");
  }

  const [owner, repo] = pathParts;
  const repoName = `${owner}/${repo}`;

  const baseHeaders: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const resolvedToken = token?.trim() || await resolveGithubTokenFromEnvOrDb();
  if (resolvedToken) baseHeaders["Authorization"] = `Bearer ${resolvedToken}`;

  const resolvedBranch = branch?.trim() || await getDefaultBranch(owner, repo, baseHeaders);

  // Fetch file tree from GitHub API
  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${resolvedBranch}?recursive=1`;
  const treeRes = await fetch(treeUrl, { headers: baseHeaders });

  if (!treeRes.ok) {
    if (treeRes.status === 404) {
      throw new Error(
        `Repository '${repoName}' not found on branch '${resolvedBranch}'. Try providing the correct branch explicitly.`,
      );
    }
    if (treeRes.status === 401) throw new Error("Invalid GitHub token. Check that your Personal Access Token is correct and has 'repo' scope.");
    if (treeRes.status === 403) throw new Error("GitHub API rate limit exceeded, or your token lacks permission. Try again later.");
    throw new Error(`GitHub API error: ${treeRes.status}`);
  }

  const tree = (await treeRes.json()) as { tree: Array<{ path: string; type: string; size?: number }> };

  // Filter to code files, skip node_modules, .git, etc.
  const SKIP_PATTERNS = [
    "node_modules", ".git", "dist", "build", "__pycache__", ".next",
    "vendor", "coverage", ".cache", "target", "bin", "obj",
  ];

  const CODE_EXTENSIONS = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".rb",
    ".php", ".cs", ".cpp", ".c", ".swift", ".kt", ".scala", ".sh",
    ".yaml", ".yml", ".json", ".toml", ".md", ".css", ".html", ".sql",
  ]);

  const filteredFiles = tree.tree.filter((item) => {
    if (item.type !== "blob") return false;
    if (SKIP_PATTERNS.some((p) => item.path.includes(p))) return false;
    const ext = "." + item.path.split(".").pop()?.toLowerCase();
    return CODE_EXTENSIONS.has(ext);
  }).slice(0, 500); // Limit to 500 files

  // Fetch file contents in parallel batches
  const files: FileInfo[] = [];
  const BATCH_SIZE = 20;

  for (let i = 0; i < filteredFiles.length; i += BATCH_SIZE) {
    const batch = filteredFiles.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (item) => {
        const contentUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${item.path}?ref=${resolvedBranch}`;
        const res = await fetch(contentUrl, { headers: baseHeaders });
        if (!res.ok) return null;
        const data = (await res.json()) as { content?: string };
        const content = data.content ? Buffer.from(data.content, "base64").toString("utf8") : "";
        const linesOfCode = content.split("\n").filter((l) => l.trim()).length;
        const pathParts = item.path.split("/");
        const name = pathParts.pop() || item.path;
        const folder = pathParts.join("/") || "root";

        return {
          path: item.path,
          name,
          content,
          linesOfCode,
          language: getLanguage(name),
          folder,
        } as FileInfo;
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        files.push(result.value);
      }
    }

    // Small delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < filteredFiles.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return { files, repoName };
}

export function generateDemoRepo(): { files: FileInfo[]; repoName: string } {
  const repoName = "demo/software-city-example";

  const demoStructure: Array<{ path: string; linesOfCode: number }> = [
    // Source files
    { path: "src/app.ts", linesOfCode: 85 },
    { path: "src/index.ts", linesOfCode: 25 },
    { path: "src/types.ts", linesOfCode: 120 },
    { path: "src/utils.ts", linesOfCode: 180 },
    { path: "src/helpers.ts", linesOfCode: 95 },
    // Components
    { path: "src/components/Button.tsx", linesOfCode: 65 },
    { path: "src/components/Modal.tsx", linesOfCode: 140 },
    { path: "src/components/Table.tsx", linesOfCode: 220 },
    { path: "src/components/Form.tsx", linesOfCode: 175 },
    { path: "src/components/Chart.tsx", linesOfCode: 310 },
    { path: "src/components/Header.tsx", linesOfCode: 90 },
    { path: "src/components/Sidebar.tsx", linesOfCode: 145 },
    // API
    { path: "src/api/userController.ts", linesOfCode: 280 },
    { path: "src/api/authController.ts", linesOfCode: 320 },
    { path: "src/api/productController.ts", linesOfCode: 240 },
    { path: "src/api/orderController.ts", linesOfCode: 195 },
    { path: "src/api/analyticsController.ts", linesOfCode: 380 },
    { path: "src/api/router.ts", linesOfCode: 80 },
    // Database
    { path: "src/db/schema.ts", linesOfCode: 210 },
    { path: "src/db/migrations/001_init.sql", linesOfCode: 95 },
    { path: "src/db/migrations/002_users.sql", linesOfCode: 60 },
    { path: "src/db/models/User.ts", linesOfCode: 130 },
    { path: "src/db/models/Product.ts", linesOfCode: 95 },
    { path: "src/db/models/Order.ts", linesOfCode: 160 },
    // Tests
    { path: "tests/unit/utils.test.ts", linesOfCode: 145 },
    { path: "tests/unit/auth.test.ts", linesOfCode: 210 },
    { path: "tests/integration/api.test.ts", linesOfCode: 380 },
    { path: "tests/e2e/checkout.spec.ts", linesOfCode: 265 },
    { path: "tests/e2e/auth.spec.ts", linesOfCode: 190 },
    // Config
    { path: "package.json", linesOfCode: 45 },
    { path: "tsconfig.json", linesOfCode: 30 },
    { path: ".env.example", linesOfCode: 20 },
    { path: "docker-compose.yml", linesOfCode: 55 },
    { path: "vite.config.ts", linesOfCode: 35 },
    // Docs
    { path: "docs/README.md", linesOfCode: 120 },
    { path: "docs/API.md", linesOfCode: 280 },
    { path: "docs/ARCHITECTURE.md", linesOfCode: 95 },
  ];

  const files: FileInfo[] = demoStructure.map(({ path, linesOfCode }) => {
    const pathParts = path.split("/");
    const name = pathParts.pop() || path;
    const folder = pathParts.join("/") || "root";
    return {
      path,
      name,
      content: "// demo content",
      linesOfCode,
      language: getLanguage(name),
      folder,
    };
  });

  return { files, repoName };
}

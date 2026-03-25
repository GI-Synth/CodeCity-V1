/**
 * githubIssues.ts
 *
 * Creates GitHub issues for confirmed HIGH/CRITICAL findings.
 * Gated behind ENABLE_GITHUB_ISSUES=true environment variable.
 * Uses the GitHub token stored via githubTokenStore (env or DB).
 *
 * Security: token is read from the encrypted store, never logged.
 * Rate-limit: one create call per finding, sequential (no bursts).
 */
import { resolveGithubTokenFromEnvOrDb } from "./githubTokenStore";

export interface GitHubIssueParams {
  repoOwner: string;
  repoName: string;
  title: string;
  body: string;
  labels?: string[];
}

export interface GitHubIssueResult {
  number: number;
  url: string;
}

/**
 * Returns true when GitHub issue creation is enabled and the required
 * GITHUB_REPO env var is present (format: "owner/repo").
 */
export function isGitHubIssuesEnabled(): boolean {
  if ((process.env["ENABLE_GITHUB_ISSUES"] ?? "").toLowerCase() !== "true") return false;
  const repo = (process.env["GITHUB_REPO"] ?? "").trim();
  return repo.includes("/");
}

/**
 * Creates a GitHub issue. Returns null on any failure (non-throwing).
 */
export async function createGitHubIssue(params: GitHubIssueParams): Promise<GitHubIssueResult | null> {
  const token = await resolveGithubTokenFromEnvOrDb();
  if (!token) {
    console.warn("[GitHubIssues] No token available — skipping issue creation");
    return null;
  }

  const url = `https://api.github.com/repos/${params.repoOwner}/${params.repoName}/issues`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        title: params.title.slice(0, 256),
        body: params.body.slice(0, 65536),
        labels: params.labels ?? [],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn(`[GitHubIssues] Failed to create issue: HTTP ${res.status} — ${text.slice(0, 200)}`);
      return null;
    }

    const data = await res.json() as { number: number; html_url: string };
    return { number: data.number, url: data.html_url };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[GitHubIssues] Error creating issue: ${msg}`);
    return null;
  }
}

/**
 * Builds and fires a GitHub issue for a confirmed finding.
 * Resolves the owner/repo from GITHUB_REPO env var ("owner/repo").
 * Non-throwing — any failure is logged and ignored.
 */
export async function fileGitHubIssueForFinding(params: {
  filePath: string;
  findingText: string;
  severity: string;
  agentName: string;
  suggestedFix?: string | null;
  codeReference?: string | null;
}): Promise<void> {
  if (!isGitHubIssuesEnabled()) return;

  const repoStr = (process.env["GITHUB_REPO"] ?? "").trim();
  const [repoOwner, repoName] = repoStr.split("/");
  if (!repoOwner || !repoName) return;

  const title = `[CodeCity ${params.severity}] ${params.filePath.split("/").pop() ?? params.filePath}: ${params.findingText.slice(0, 80)}`;

  const bodyLines = [
    `**Severity:** ${params.severity}`,
    `**File:** \`${params.filePath}\``,
    `**Agent:** ${params.agentName}`,
    "",
    "### Finding",
    params.findingText,
    "",
  ];

  if (params.codeReference) {
    bodyLines.push("### Code Reference", `\`${params.codeReference}\``, "");
  }

  if (params.suggestedFix) {
    bodyLines.push("### Suggested Fix", params.suggestedFix, "");
  }

  bodyLines.push("---", "*Created automatically by CodeCity agent analysis.*");

  const labels = ["codecity", params.severity.toLowerCase()];

  const result = await createGitHubIssue({
    repoOwner,
    repoName,
    title,
    body: bodyLines.join("\n"),
    labels,
  });

  if (result) {
    console.log(`[GitHubIssues] Created issue #${result.number}: ${result.url}`);
  }
}

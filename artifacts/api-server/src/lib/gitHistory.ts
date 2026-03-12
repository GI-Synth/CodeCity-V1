import simpleGit from "simple-git";

export interface CommitSummary {
  hash: string;
  date: string;
  message: string;
  author: string;
}

export async function getCommitHistory(repoPath: string, limit = 50): Promise<CommitSummary[]> {
  try {
    const git = simpleGit(repoPath);
    const log = await git.log([`-${limit}`, "--format=%H|%ai|%s|%an"]);

    return (log.all ?? []).map(entry => ({
      hash: entry.hash,
      date: entry.date,
      message: entry.message,
      author: entry.author_name,
    }));
  } catch (err) {
    console.warn("[gitHistory] Failed to get commit history:", err);
    return [];
  }
}

export async function getFilesChangedInCommit(repoPath: string, hash: string): Promise<string[]> {
  try {
    const git = simpleGit(repoPath);
    const diff = await git.diff([`${hash}^`, hash, "--name-only"]);
    return diff.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

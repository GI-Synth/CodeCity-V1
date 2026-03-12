import chokidar from "chokidar";
import { codeAnalyzer } from "./codeAnalyzer";
import { computeHealthScore } from "./healthScorer";
import { wsServer } from "./wsServer";
import { readFileSync } from "fs";
import type { Building } from "./types";

class FileWatcher {
  private watcher: ReturnType<typeof chokidar.watch> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private watchedPath: string = "";
  private DEBOUNCE_MS = 500;
  private cityBuildings: Building[] = [];

  start(repoPath: string, buildings: Building[]): void {
    this.stop();
    this.watchedPath = repoPath;
    this.cityBuildings = buildings;

    this.watcher = chokidar.watch(repoPath, {
      ignoreInitial: true,
      ignored: [/(node_modules|\.git|__pycache__|\.venv|dist|\.cache)/],
      persistent: true,
    });

    const handler = (changedFile: string) => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this._handleChange(changedFile), this.DEBOUNCE_MS);
    };

    this.watcher.on("add", handler);
    this.watcher.on("change", handler);
    this.watcher.on("unlink", handler);

    console.log(`[FileWatcher] Watching ${repoPath}`);
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close().catch(() => {});
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.watchedPath = "";
    console.log("[FileWatcher] Stopped");
  }

  private async _handleChange(changedFile: string): Promise<void> {
    try {
      let content = "";
      try { content = readFileSync(changedFile, "utf-8"); } catch { return; }

      const filename = changedFile.split("/").pop() ?? changedFile;
      const metrics = codeAnalyzer.analyzeFile(filename, content);

      const buildingId = `building-${changedFile.replace(/[^a-z0-9]/gi, "-")}`;
      const existingIdx = this.cityBuildings.findIndex(b => b.id === buildingId || b.filePath === changedFile);

      if (existingIdx >= 0) {
        const b = this.cityBuildings[existingIdx];
        const updated: Building = {
          ...b,
          linesOfCode: metrics.loc,
          complexity: metrics.complexity,
          floors: Math.min(10, Math.max(1, Math.ceil(metrics.loc / 50))),
          width: Math.min(6, Math.floor(metrics.complexity / 4) + 2) * 6,
          dependencies: metrics.imports,
        };
        this.cityBuildings[existingIdx] = updated;

        const { score, season } = computeHealthScore(this.cityBuildings);
        wsServer.broadcastCityPatch(updated, score, season);
        console.log(`[FileWatcher] Patched building ${filename} → LOC ${metrics.loc}, CC ${metrics.complexity}`);
      }
    } catch (err) {
      console.error("[FileWatcher] Error handling change:", err);
    }
  }

  isWatching(): boolean {
    return this.watcher !== null;
  }

  getWatchedPath(): string {
    return this.watchedPath;
  }

  updateBuildings(buildings: Building[]): void {
    this.cityBuildings = buildings;
  }
}

export const fileWatcher = new FileWatcher();

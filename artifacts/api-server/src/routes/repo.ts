import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { reposTable } from "@workspace/db/schema";
import { fetchGithubRepo, generateDemoRepo } from "../lib/githubFetcher";
import { githubTokenHint, githubTokenStatus, resolveGithubToken, saveGithubToken } from "../lib/githubTokenStore";
import { buildCityLayout } from "../lib/cityAnalyzer";
import { fingerprintFromRepoFiles, type ProjectFingerprint } from "../lib/projectFingerprint";
import { setPreferredDomains } from "../lib/vectorSearch";
import { desc, eq, ne } from "drizzle-orm";

const router: IRouter = Router();

function applyFingerprintDomains(fingerprint: ProjectFingerprint | null): void {
  if (!fingerprint) {
    setPreferredDomains(["general"]);
    return;
  }

  setPreferredDomains(fingerprint.relevantDomains);

  if (fingerprint.isAudioProject || fingerprint.isPlugin) {
    const domains = fingerprint.relevantDomains.filter((domain) => domain !== "general").join(" + ");
    console.log(`[Fingerprint] ${fingerprint.type} project detected, loading ${domains || "general"} KB domains`);
  }
}

function parseStoredFingerprint(raw: string | null): ProjectFingerprint | null {
  if (!raw) return null;

  try {
    return JSON.parse(raw) as ProjectFingerprint;
  } catch {
    return null;
  }
}

function isDemoRepoEnabled(): boolean {
  const raw = process.env["ENABLE_DEMO_REPO"];
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function generateSlug(repoUrl: string): string {
  const url = repoUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "");
  const parts = url.split("/").filter(Boolean);
  const last2 = parts.slice(-2).join("-");
  return last2.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 60);
}

async function setActive(repoId: number): Promise<void> {
  await db.update(reposTable).set({ isActive: false }).where(ne(reposTable.id, repoId));
  await db.update(reposTable).set({ isActive: true }).where(eq(reposTable.id, repoId));
}

router.get("/list", async (_req, res) => {
  try {
    const repos = (await db.select().from(reposTable).orderBy(desc(reposTable.createdAt)))
      .filter(r => !(r.repoUrl ?? "").startsWith("demo://"));
    res.json({
      repos: repos.map(r => ({
        id: r.id,
        slug: r.slug ?? String(r.id),
        repoName: r.repoName,
        repoUrl: r.repoUrl,
        githubTokenHint: r.githubTokenHint,
        hasTokenOnFile: Boolean(r.githubTokenHint),
        fileCount: r.fileCount,
        healthScore: r.healthScore,
        season: r.season,
        isActive: r.isActive,
        loadedAt: r.createdAt,
        analysisTime: r.analysisTime,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "REPOS_ERROR", message });
  }
});

router.get("/token-status", async (_req, res) => {
  try {
    const status = await githubTokenStatus();
    res.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "TOKEN_STATUS_ERROR", message });
  }
});

router.post("/load", async (req, res): Promise<void> => {
  const { repoUrl, branch, githubToken, rememberGithubToken } = req.body;

  if (!repoUrl || typeof repoUrl !== "string") {
    res.status(400).json({ error: "INVALID_URL", message: "repoUrl is required" });
    return;
  }

  const startTime = Date.now();
  try {
    const typedToken = typeof githubToken === "string" ? githubToken.trim() : "";
    const shouldRememberToken = rememberGithubToken !== false;
    const resolvedToken = await resolveGithubToken(typedToken || null);

    let tokenSaved = false;
    let tokenHint: string | null = resolvedToken ? githubTokenHint(resolvedToken) : null;

    if (typedToken && shouldRememberToken) {
      const saved = await saveGithubToken(typedToken);
      tokenSaved = true;
      tokenHint = saved.tokenHint;
    }

    const { files, repoName } = await fetchGithubRepo(repoUrl, branch, resolvedToken || undefined);
    const fingerprint = fingerprintFromRepoFiles(files);
    applyFingerprintDomains(fingerprint);

    if (files.length === 0) {
      res.status(400).json({
        error: "NO_CODE_FILES",
        message: "No supported source files were found in this repository. Try a different repository or include files with common code extensions.",
      });
      return;
    }

    const layout = buildCityLayout(files, repoName);
    const analysisTime = (Date.now() - startTime) / 1000;
    const slug = generateSlug(repoUrl);

    const existing = await db.select().from(reposTable).where(eq(reposTable.repoUrl, repoUrl));
    let repoId: number;

    if (existing.length > 0) {
      await db.update(reposTable).set({
        repoName, branch, fileCount: files.length, districtCount: layout.districts.length,
        healthScore: layout.healthScore, season: layout.season, layoutData: JSON.stringify(layout),
        analysisTime, slug, githubTokenHint: tokenHint,
        projectFingerprint: JSON.stringify(fingerprint),
        updatedAt: new Date().toISOString(),
      }).where(eq(reposTable.id, existing[0].id));
      repoId = existing[0].id;
    } else {
      const inserted = await db.insert(reposTable).values({
        repoUrl, repoName, branch, slug, isActive: false,
        githubTokenHint: tokenHint,
        projectFingerprint: JSON.stringify(fingerprint),
        fileCount: files.length, districtCount: layout.districts.length,
        healthScore: layout.healthScore, season: layout.season,
        layoutData: JSON.stringify(layout), analysisTime,
      }).returning({ id: reposTable.id });
      repoId = inserted[0].id;
    }

    await setActive(repoId);

    res.json({
      success: true, slug, repoName, fileCount: files.length,
      districtCount: layout.districts.length, analysisTime,
      projectFingerprint: fingerprint,
      tokenSaved,
      message: `Successfully loaded ${repoName} — ${files.length} files analyzed`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ error: "LOAD_FAILED", message });
  }
});

router.post("/demo", async (_req, res) => {
  if (!isDemoRepoEnabled()) {
    res.status(410).json({
      error: "DEMO_DISABLED",
      message: "Demo repository generation is disabled in real-data mode. Set ENABLE_DEMO_REPO=true to re-enable it.",
    });
    return;
  }

  const startTime = Date.now();
  try {
    const { files, repoName } = generateDemoRepo();
    const fingerprint = fingerprintFromRepoFiles(files);
    applyFingerprintDomains(fingerprint);
    const layout = buildCityLayout(files, repoName);
    const analysisTime = (Date.now() - startTime) / 1000;

    const existing = await db.select().from(reposTable).where(eq(reposTable.repoUrl, "demo://software-city-example"));
    let repoId: number;

    if (existing.length === 0) {
      const inserted = await db.insert(reposTable).values({
        repoUrl: "demo://software-city-example",
        repoName, branch: "main", slug: "demo-software-city",
        isActive: false, fileCount: files.length,
        projectFingerprint: JSON.stringify(fingerprint),
        districtCount: layout.districts.length, healthScore: layout.healthScore,
        season: layout.season, layoutData: JSON.stringify(layout), analysisTime,
      }).returning({ id: reposTable.id });
      repoId = inserted[0].id;
    } else {
      await db.update(reposTable).set({
        projectFingerprint: JSON.stringify(fingerprint),
        updatedAt: new Date().toISOString(),
      }).where(eq(reposTable.id, existing[0].id));
      repoId = existing[0].id;
    }

    await setActive(repoId);

    res.json({
      success: true, slug: "demo-software-city", repoName, fileCount: files.length,
      districtCount: layout.districts.length, analysisTime,
      message: `Demo city loaded — ${files.length} files in ${layout.districts.length} districts`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ error: "DEMO_FAILED", message });
  }
});

router.post("/:slug/activate", async (req, res): Promise<void> => {
  const { slug } = req.params;
  try {
    const repos = await db.select().from(reposTable).where(eq(reposTable.slug, slug));
    if (repos.length === 0) {
      res.status(404).json({ error: "NOT_FOUND", message: `Repo slug '${slug}' not found` });
      return;
    }
    await setActive(repos[0].id);
    applyFingerprintDomains(parseStoredFingerprint(repos[0].projectFingerprint));
    res.json({ success: true, slug, repoName: repos[0].repoName });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "ACTIVATE_ERROR", message });
  }
});

router.get("/:slug/layout", async (req, res): Promise<void> => {
  const { slug } = req.params;
  try {
    const repos = await db.select().from(reposTable).where(eq(reposTable.slug, slug));
    if (repos.length === 0) {
      res.status(404).json({ error: "NOT_FOUND", message: `Repo slug '${slug}' not found` });
      return;
    }
    if (!repos[0].layoutData) {
      res.status(404).json({ error: "NO_LAYOUT", message: "Layout not available" });
      return;
    }
    res.json(JSON.parse(repos[0].layoutData));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "LAYOUT_ERROR", message });
  }
});

router.delete("/:slug", async (req, res): Promise<void> => {
  const { slug } = req.params;
  try {
    const repos = await db.select().from(reposTable).where(eq(reposTable.slug, slug));
    if (repos.length === 0) {
      res.status(404).json({ error: "NOT_FOUND", message: "Repo not found" });
      return;
    }
    const wasActive = repos[0].isActive;
    await db.delete(reposTable).where(eq(reposTable.id, repos[0].id));

    if (wasActive) {
      const remaining = await db.select().from(reposTable).orderBy(desc(reposTable.createdAt)).limit(1);
      if (remaining.length > 0) {
        await db.update(reposTable).set({ isActive: true }).where(eq(reposTable.id, remaining[0].id));
      }
    }

    res.json({ success: true, slug });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "DELETE_ERROR", message });
  }
});

export default router;

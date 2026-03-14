import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { settingsTable, DEFAULT_SETTINGS } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";

const router: IRouter = Router();

async function ensureDefaults() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.insert(settingsTable).values({ key, value }).onConflictDoNothing();
  }
}

async function getAllSettings(): Promise<Record<string, string>> {
  await ensureDefaults();
  const rows = await db.select().from(settingsTable);
  const result: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

router.get("/", async (_req, res) => {
  try {
    const settings = await getAllSettings();
    res.json(settings);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "SETTINGS_ERROR", message });
  }
});

router.put("/", async (req, res): Promise<void> => {
  const { key, value } = req.body as { key: string; value: unknown };
  if (!key || value === undefined) {
    res.status(400).json({ error: "INVALID_INPUT", message: "key and value are required" });
    return;
  }
  try {
    await ensureDefaults();
    const strValue = String(value);
    await db.insert(settingsTable)
      .values({ key, value: strValue, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { value: strValue, updatedAt: new Date().toISOString() },
      });
    const settings = await getAllSettings();
    res.json(settings);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "SETTINGS_UPDATE_ERROR", message });
  }
});

router.delete("/", async (req, res): Promise<void> => {
  const { confirm } = req.body as { confirm?: string };
  if (confirm !== "CLEAR_ALL") {
    res.status(400).json({ error: "CONFIRM_REQUIRED", message: "Send { confirm: 'CLEAR_ALL' }" });
    return;
  }
  try {
    await db.delete(settingsTable);
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await db.insert(settingsTable).values({ key, value });
    }
    res.json({ success: true, message: "Settings reset to defaults" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "SETTINGS_RESET_ERROR", message });
  }
});

export { getAllSettings };
export default router;

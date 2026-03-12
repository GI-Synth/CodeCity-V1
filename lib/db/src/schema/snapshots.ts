import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const snapshotsTable = sqliteTable("shared_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  token: text("token").unique().notNull(),
  repoSlug: text("repo_slug").notNull(),
  repoName: text("repo_name").notNull(),
  snapshotData: text("snapshot_data").notNull(),
  viewCount: integer("view_count").default(0).notNull(),
  createdAt: text("created_at").default(sql`(datetime('now'))`).notNull(),
});

export const insertSnapshotSchema = createInsertSchema(snapshotsTable).omit({ id: true, createdAt: true });
export type InsertSnapshot = z.infer<typeof insertSnapshotSchema>;
export type Snapshot = typeof snapshotsTable.$inferSelect;

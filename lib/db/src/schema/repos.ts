import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const reposTable = sqliteTable("repos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  repoUrl: text("repo_url").notNull(),
  repoName: text("repo_name").notNull(),
  branch: text("branch").default("main").notNull(),
  slug: text("slug").unique(),
  isActive: integer("is_active", { mode: "boolean" }).default(false).notNull(),
  fileCount: integer("file_count").default(0).notNull(),
  districtCount: integer("district_count").default(0).notNull(),
  healthScore: real("health_score").default(50).notNull(),
  season: text("season").default("spring").notNull(),
  layoutData: text("layout_data"),
  analysisTime: real("analysis_time").default(0).notNull(),
  createdAt: text("created_at").default(sql`(datetime('now'))`).notNull(),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`).notNull(),
});

export const insertRepoSchema = createInsertSchema(reposTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRepo = z.infer<typeof insertRepoSchema>;
export type Repo = typeof reposTable.$inferSelect;

import { pgTable, text, serial, integer, real, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const reposTable = pgTable("repos", {
  id: serial("id").primaryKey(),
  repoUrl: text("repo_url").notNull(),
  repoName: text("repo_name").notNull(),
  branch: text("branch").default("main").notNull(),
  fileCount: integer("file_count").default(0).notNull(),
  districtCount: integer("district_count").default(0).notNull(),
  healthScore: real("health_score").default(50).notNull(),
  season: text("season").default("spring").notNull(),
  layoutData: text("layout_data"),
  analysisTime: real("analysis_time").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertRepoSchema = createInsertSchema(reposTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRepo = z.infer<typeof insertRepoSchema>;
export type Repo = typeof reposTable.$inferSelect;

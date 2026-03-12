import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const eventsTable = sqliteTable("city_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  buildingId: text("building_id"),
  buildingName: text("building_name"),
  agentId: text("agent_id"),
  agentName: text("agent_name"),
  message: text("message").notNull(),
  severity: text("severity").default("info").notNull(),
  timestamp: text("timestamp").default(sql`(datetime('now'))`).notNull(),
});

export const insertEventSchema = createInsertSchema(eventsTable).omit({});
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type CityEvent = typeof eventsTable.$inferSelect;

import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const eventsTable = pgTable("city_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  buildingId: text("building_id"),
  buildingName: text("building_name"),
  agentId: text("agent_id"),
  agentName: text("agent_name"),
  message: text("message").notNull(),
  severity: text("severity").default("info").notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export const insertEventSchema = createInsertSchema(eventsTable).omit({});
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type CityEvent = typeof eventsTable.$inferSelect;

import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const codeGraphNodesTable = sqliteTable("code_graph_nodes", {
  id: text("id").primaryKey(),
  nodeType: text("node_type").notNull(),
  name: text("name").notNull(),
  filePath: text("file_path").notNull(),
  lineStart: integer("line_start"),
  lineEnd: integer("line_end"),
  complexityScore: integer("complexity_score").default(0).notNull(),
  cognitiveComplexity: integer("cognitive_complexity").default(0).notNull(),
  loc: integer("loc").default(0).notNull(),
  testCoveragePct: real("test_coverage_pct"),
  isDeadCode: integer("is_dead_code").default(0).notNull(),
  hasCircularDep: integer("has_circular_dep").default(0).notNull(),
  importCount: integer("import_count").default(0).notNull(),
  exportCount: integer("export_count").default(0).notNull(),
  lastAnalyzedAt: integer("last_analyzed_at").notNull(),
  metadata: text("metadata").default("{}").notNull(),
});

export const codeGraphEdgesTable = sqliteTable("code_graph_edges", {
  id: text("id").primaryKey(),
  fromNode: text("from_node").notNull(),
  toNode: text("to_node").notNull(),
  edgeType: text("edge_type").notNull(),
  weight: integer("weight").default(1).notNull(),
  isCircular: integer("is_circular").default(0).notNull(),
});

export const insertCodeGraphNodeSchema = createInsertSchema(codeGraphNodesTable);
export type InsertCodeGraphNode = z.infer<typeof insertCodeGraphNodeSchema>;
export type CodeGraphNode = typeof codeGraphNodesTable.$inferSelect;

export const insertCodeGraphEdgeSchema = createInsertSchema(codeGraphEdgesTable);
export type InsertCodeGraphEdge = z.infer<typeof insertCodeGraphEdgeSchema>;
export type CodeGraphEdge = typeof codeGraphEdgesTable.$inferSelect;

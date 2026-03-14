import { extname } from "node:path";

const SOURCE_FILE_EXTENSIONS = new Set([
  ".ts",
  ".js",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".cpp",
  ".c",
]);

const NON_SOURCE_FILE_EXTENSIONS = new Set([
  ".md",
  ".html",
  ".txt",
  ".yaml",
  ".yml",
  ".json",
]);

function normalizeForExtension(filePath: string): string {
  return filePath.trim().toLowerCase().split("?")[0].split("#")[0];
}

export function getFileExtension(filePath: string): string {
  return extname(normalizeForExtension(filePath));
}

export function isSourceFile(filePath: string): boolean {
  return SOURCE_FILE_EXTENSIONS.has(getFileExtension(filePath));
}

export function isExplicitNonSourceFile(filePath: string): boolean {
  return NON_SOURCE_FILE_EXTENSIONS.has(getFileExtension(filePath));
}

import type { District, Building, Road, CityLayout } from "./types";
import { codeAnalyzer } from "./codeAnalyzer";
import { computeHealthScore, computeDistrictHealth } from "./healthScorer";

const DISTRICT_COLORS: Record<string, string> = {
  source: "#1a2a4a",
  test: "#0d3322",
  config: "#2a2a0d",
  api: "#2a1a0d",
  database: "#1a0d2a",
  docs: "#1a1a2a",
  assets: "#0d2a2a",
  root: "#1a1a1a",
};

const BUILDING_COLORS: Record<string, string> = {
  class: "#2a5cb8",
  function: "#1a8c5a",
  api: "#d4692a",
  database: "#8c2ab8",
  config: "#b8a02a",
  test: "#2ab87a",
  entry: "#e84040",
  source: "#1a8c5a",
  style: "#4a5568",
  unknown: "#4a5568",
};

function detectDistrictType(folderName: string): District["type"] {
  const lower = folderName.toLowerCase();
  if (lower.includes("test") || lower.includes("spec") || lower === "__tests__") return "test";
  if (lower.includes("config") || lower === "settings") return "config";
  if (lower.includes("api") || lower.includes("route") || lower.includes("controller") || lower.includes("handler")) return "api";
  if (lower.includes("db") || lower.includes("database") || lower.includes("model") || lower.includes("schema") || lower.includes("migration")) return "database";
  if (lower.includes("doc") || lower.includes("docs") || lower.includes("readme")) return "docs";
  if (lower.includes("asset") || lower.includes("static") || lower.includes("public") || lower.includes("media")) return "assets";
  return "source";
}

export function getLanguage(filename: string): string {
  return codeAnalyzer.detectLanguage(filename);
}

export interface FileInfo {
  path: string;
  name: string;
  content: string;
  linesOfCode: number;
  language: string;
  folder: string;
}

export function buildCityLayout(files: FileInfo[], repoName: string): CityLayout {
  const folderMap = new Map<string, FileInfo[]>();
  for (const file of files) {
    const folder = file.folder || "root";
    if (!folderMap.has(folder)) folderMap.set(folder, []);
    folderMap.get(folder)!.push(file);
  }

  const districts: District[] = [];
  const buildings: Building[] = [];
  const roads: Road[] = [];
  const buildingMap = new Map<string, Building>();
  const importGraph = new Map<string, string[]>();

  let districtX = 20;
  let districtY = 20;
  const maxPerRow = 3;
  let col = 0;
  let rowMaxHeight = 0;
  let folderIndex = 0;

  for (const [folder, folderFiles] of folderMap.entries()) {
    const districtType = detectDistrictType(folder.split("/").pop() || folder);
    const cols = Math.ceil(Math.sqrt(folderFiles.length));
    const rows = Math.ceil(folderFiles.length / cols);
    const districtWidth = Math.max(160, cols * 56 + 40);
    const districtHeight = Math.max(120, rows * 56 + 50);

    if (col >= maxPerRow) {
      col = 0;
      districtX = 20;
      districtY += rowMaxHeight + 30;
      rowMaxHeight = 0;
    }

    rowMaxHeight = Math.max(rowMaxHeight, districtHeight);

    const districtBuildings: Building[] = [];

    let bx = districtX + 20;
    let by = districtY + 30;
    let bCol = 0;

    for (let i = 0; i < folderFiles.length; i++) {
      const file = folderFiles[i];
      const metrics = codeAnalyzer.analyzeFile(file.name, file.content);

      const realLoc = metrics.loc > 0 ? metrics.loc : file.linesOfCode;
      const floors = Math.min(10, Math.max(1, Math.ceil(realLoc / 50)));
      const complexity = metrics.complexity;
      const bWidth = Math.min(6, Math.floor(complexity / 4) + 2) * 9;

      const fileType = metrics.fileType as Building["fileType"];
      const isTestFile = fileType === "test" || file.name.includes(".test.") || file.name.includes(".spec.");
      const hasTests = isTestFile;
      const testCoverage = isTestFile ? 0.85 + Math.random() * 0.15 : (hasTests ? 0.4 + Math.random() * 0.4 : 0.05 + Math.random() * 0.15);
      const commitCount = Math.floor(realLoc / 15) + Math.floor(Math.random() * 20) + 1;
      const age: Building["age"] = commitCount > 80 ? "ancient" : commitCount > 40 ? "aged" : commitCount > 15 ? "modern" : "new";

      let status: Building["status"] = "healthy";
      if (testCoverage < 0.1) status = "dark";
      else if (testCoverage > 0.8 && complexity < 8) status = "glowing";
      else if (complexity > 15) status = "warning";
      else if (complexity > 25 && testCoverage < 0.3) status = "fire";
      else if (complexity > 20) status = "error";

      let activeEvent: Building["activeEvent"] = null;
      if (status === "fire") activeEvent = "fire";
      else if (status === "error") activeEvent = "alarm";
      else if (status === "glowing") activeEvent = "sparkle";

      const buildingHeight = 20 + floors * 8;

      if (bCol >= cols) {
        bCol = 0;
        bx = districtX + 20;
        by += buildingHeight + 14;
      }

      const mappedType = (["class", "function", "api", "database", "config", "test", "entry", "unknown"] as const)
        .includes(fileType as any) ? fileType as Building["fileType"] : "function";

      const building: Building = {
        id: `building-${file.path.replace(/[^a-z0-9]/gi, "-")}`,
        name: file.name,
        filePath: file.path,
        fileType: mappedType,
        floors,
        complexity,
        x: bx,
        y: by,
        width: Math.max(bWidth, 28),
        height: buildingHeight,
        status,
        hasTests,
        testCoverage,
        commitCount,
        age,
        language: metrics.language || file.language,
        linesOfCode: realLoc,
        dependencies: metrics.imports,
        activeEvent,
      };

      buildings.push(building);
      districtBuildings.push(building);
      buildingMap.set(file.path, building);
      if (metrics.imports.length > 0) {
        importGraph.set(file.path, metrics.imports);
      }

      bx += Math.max(bWidth, 28) + 12;
      bCol++;
    }

    const district: District = {
      id: `district-${folderIndex}`,
      name: folder === "root" ? repoName : folder,
      path: folder,
      type: districtType,
      x: districtX,
      y: districtY,
      width: districtWidth,
      height: districtHeight,
      color: DISTRICT_COLORS[districtType] || DISTRICT_COLORS.source,
      buildings: districtBuildings,
      healthScore: computeDistrictHealth(districtBuildings),
    };

    districts.push(district);
    districtX += districtWidth + 30;
    col++;
    folderIndex++;
  }

  let roadIndex = 0;
  for (const [fromPath, imports] of importGraph.entries()) {
    const fromBuilding = buildingMap.get(fromPath);
    if (!fromBuilding) continue;
    for (const imp of imports) {
      for (const [toPath, toBuilding] of buildingMap.entries()) {
        if (toPath !== fromPath && (toPath.endsWith(imp) || toBuilding.name.replace(/\.(ts|js|tsx|jsx)$/, "") === imp.split("/").pop())) {
          roads.push({
            id: `road-${roadIndex++}`,
            fromBuilding: fromBuilding.id,
            toBuilding: toBuilding.id,
            type: toBuilding.fileType === "api" ? "api" : toBuilding.fileType === "database" ? "database" : "import",
          });
          break;
        }
      }
    }
  }

  if (roads.length < 5 && buildings.length > 1) {
    const ba = Array.from(buildingMap.values());
    for (let i = 0; i < Math.min(ba.length - 1, 20); i++) {
      if (roads.length > 25) break;
      const to = ba[Math.floor(Math.random() * ba.length)];
      if (ba[i].id !== to.id && !roads.find(r => r.fromBuilding === ba[i].id && r.toBuilding === to.id)) {
        roads.push({
          id: `road-${roadIndex++}`,
          fromBuilding: ba[i].id,
          toBuilding: to.id,
          type: "import",
        });
      }
    }
  }

  const { score: healthScore, season } = computeHealthScore(buildings);

  return {
    districts,
    roads,
    repoName,
    totalFiles: files.length,
    season: season as CityLayout["season"],
    healthScore,
    generatedAt: new Date().toISOString(),
  };
}

import type { District, Building, Road, CityLayout } from "./types";

const FILE_EXTENSIONS: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript", ".js": "javascript", ".jsx": "javascript",
  ".py": "python", ".go": "go", ".rs": "rust", ".java": "java", ".rb": "ruby",
  ".php": "php", ".cs": "csharp", ".cpp": "cpp", ".c": "c", ".swift": "swift",
  ".kt": "kotlin", ".scala": "scala", ".sh": "bash", ".yaml": "yaml", ".yml": "yaml",
  ".json": "json", ".toml": "toml", ".md": "markdown", ".css": "css", ".html": "html",
  ".sql": "sql", ".env": "env",
};

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
  unknown: "#4a5568",
};

function detectFileType(filename: string, content: string): Building["fileType"] {
  const lower = filename.toLowerCase();
  if (lower.includes("test") || lower.includes("spec") || lower.includes(".test.") || lower.includes(".spec.")) return "test";
  if (lower.includes("config") || lower.endsWith(".json") || lower.endsWith(".yaml") || lower.endsWith(".toml") || lower.endsWith(".env")) return "config";
  if (lower.includes("router") || lower.includes("route") || lower.includes("endpoint") || lower.includes("controller")) return "api";
  if (lower.includes("database") || lower.includes("schema") || lower.includes("model") || lower.includes("migration") || lower.endsWith(".sql")) return "database";
  if (lower === "index.ts" || lower === "index.js" || lower === "main.ts" || lower === "main.py" || lower === "app.ts" || lower === "app.js") return "entry";
  if (content.includes("class ")) return "class";
  return "function";
}

function detectDistrictType(folderName: string): District["type"] {
  const lower = folderName.toLowerCase();
  if (lower.includes("test") || lower.includes("spec") || lower === "__tests__") return "test";
  if (lower.includes("config") || lower === "settings") return "config";
  if (lower.includes("api") || lower.includes("route") || lower.includes("controller") || lower.includes("handler")) return "api";
  if (lower.includes("db") || lower.includes("database") || lower.includes("model") || lower.includes("schema") || lower.includes("migration")) return "database";
  if (lower.includes("doc") || lower.includes("docs") || lower.includes("readme")) return "docs";
  if (lower.includes("asset") || lower.includes("static") || lower.includes("public") || lower.includes("media")) return "assets";
  if (lower === "src" || lower === "lib" || lower === "source" || lower.includes("component")) return "source";
  return "source";
}

export function getLanguage(filename: string): string {
  const ext = "." + filename.split(".").pop()?.toLowerCase();
  return FILE_EXTENSIONS[ext] || "unknown";
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
  // Group files into districts by folder
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
    const districtWidth = Math.max(160, cols * 50 + 40);
    const districtHeight = Math.max(120, rows * 50 + 50);

    if (col >= maxPerRow) {
      col = 0;
      districtX = 20;
      districtY += rowMaxHeight + 30;
      rowMaxHeight = 0;
    }

    rowMaxHeight = Math.max(rowMaxHeight, districtHeight);

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
      buildings: [],
      healthScore: 50 + Math.random() * 50,
    };

    let bx = districtX + 20;
    let by = districtY + 30;
    let bCol = 0;

    for (let i = 0; i < folderFiles.length; i++) {
      const file = folderFiles[i];
      const fileType = detectFileType(file.name, file.content);
      const floors = Math.min(10, Math.max(1, Math.ceil(file.linesOfCode / 50)));
      const complexity = Math.min(20, Math.max(1, Math.floor(Math.random() * 8) + 1));
      const hasTests = fileType === "test" || Math.random() > 0.6;
      const testCoverage = hasTests ? Math.random() * 0.8 + 0.2 : Math.random() * 0.2;
      const commitCount = Math.floor(Math.random() * 100) + 1;
      const age: Building["age"] = commitCount > 80 ? "ancient" : commitCount > 40 ? "aged" : commitCount > 15 ? "modern" : "new";

      let status: Building["status"] = "healthy";
      if (testCoverage < 0.1) status = "dark";
      else if (testCoverage > 0.8 && complexity < 5) status = "glowing";
      else if (complexity > 10) status = "warning";
      else if (Math.random() < 0.08) status = "fire";
      else if (Math.random() < 0.06) status = "error";

      let activeEvent: Building["activeEvent"] = null;
      if (status === "fire") activeEvent = "fire";
      else if (status === "error") activeEvent = "alarm";
      else if (status === "dark") activeEvent = null;
      else if (status === "glowing") activeEvent = "sparkle";

      const buildingWidth = 36;
      const buildingHeight = 20 + floors * 8;

      if (bCol >= cols) {
        bCol = 0;
        bx = districtX + 20;
        by += buildingHeight + 12;
      }

      const building: Building = {
        id: `building-${file.path.replace(/[^a-z0-9]/gi, "-")}`,
        name: file.name,
        filePath: file.path,
        fileType,
        floors,
        complexity,
        x: bx,
        y: by,
        width: buildingWidth,
        height: buildingHeight,
        status,
        hasTests,
        testCoverage,
        commitCount,
        age,
        language: file.language,
        linesOfCode: file.linesOfCode,
        dependencies: [],
        activeEvent,
      };

      buildings.push(building);
      district.buildings.push(building);
      buildingMap.set(file.path, building);

      bx += buildingWidth + 14;
      bCol++;
    }

    districts.push(district);
    districtX += districtWidth + 30;
    col++;
    folderIndex++;
  }

  // Add some sample roads between buildings
  const buildingArray = Array.from(buildingMap.values());
  for (let i = 0; i < Math.min(buildingArray.length - 1, 30); i++) {
    if (Math.random() > 0.5) {
      const from = buildingArray[i];
      const to = buildingArray[Math.floor(Math.random() * buildingArray.length)];
      if (from.id !== to.id) {
        roads.push({
          id: `road-${i}`,
          fromBuilding: from.id,
          toBuilding: to.id,
          type: "import",
        });
      }
    }
  }

  const totalFiles = files.length;
  const avgCoverage = buildings.reduce((s, b) => s + b.testCoverage, 0) / (buildings.length || 1);
  const cleanRatio = buildings.filter(b => b.status === "healthy" || b.status === "glowing").length / (buildings.length || 1);
  const avgComplexity = buildings.reduce((s, b) => s + b.complexity, 0) / (buildings.length || 1);

  const healthScore = Math.round(
    avgCoverage * 40 + cleanRatio * 30 + Math.max(0, (20 - avgComplexity) / 20) * 20 + 10
  );

  const season: CityLayout["season"] =
    healthScore >= 80 ? "summer" : healthScore >= 60 ? "spring" : healthScore >= 40 ? "autumn" : "winter";

  return {
    districts,
    roads,
    repoName,
    totalFiles,
    season,
    healthScore,
    generatedAt: new Date().toISOString(),
  };
}

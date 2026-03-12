export interface Building {
  id: string;
  name: string;
  filePath: string;
  fileType: "class" | "function" | "api" | "database" | "config" | "test" | "entry" | "unknown";
  floors: number;
  complexity: number;
  x: number;
  y: number;
  width: number;
  height: number;
  status: "healthy" | "warning" | "error" | "fire" | "dark" | "glowing";
  hasTests: boolean;
  testCoverage: number;
  commitCount: number;
  age: "new" | "modern" | "aged" | "ancient";
  language: string;
  linesOfCode: number;
  dependencies: string[];
  activeEvent?: "fire" | "flood" | "smoke" | "alarm" | "sparkle" | "collapse" | null;
}

export interface District {
  id: string;
  name: string;
  path: string;
  type: "source" | "test" | "config" | "api" | "database" | "docs" | "assets" | "root";
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  buildings: Building[];
  healthScore: number;
}

export interface Road {
  id: string;
  fromBuilding: string;
  toBuilding: string;
  type: "import" | "api" | "database" | "config";
}

export interface CityLayout {
  districts: District[];
  roads: Road[];
  repoName: string;
  totalFiles: number;
  season: "summer" | "spring" | "autumn" | "winter";
  healthScore: number;
  generatedAt: string;
}

export interface NpcAgent {
  id: string;
  name: string;
  role: "qa_inspector" | "api_fuzzer" | "load_tester" | "edge_explorer" | "ui_navigator";
  status: "idle" | "working" | "escalating" | "reporting" | "waiting";
  currentBuilding: string | null;
  currentTask: string | null;
  bugsFound: number;
  testsGenerated: number;
  escalations: number;
  accuracy: number;
  level: number;
  dialogue: string;
  x: number;
  y: number;
  color: string;
}

import { useMemo, useState, useRef, useCallback, useEffect, Suspense } from "react";
import { Canvas, useFrame, useThree, ThreeEvent } from "@react-three/fiber";
import { MapControls, useGLTF, Sky } from "@react-three/drei";
import { useSpring, animated } from "@react-spring/three";
import * as THREE from "three";
import type { CityLayout, Agent, Building, District } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CityMapProps {
  layout: CityLayout;
  agents: Agent[];
  activeBuildings: Set<string>;
  activeBuildingColors?: Map<string, string>;
  selectedBuildingId: string | null;
  onSelectBuilding: (id: string) => void;
  highlightDistrictId?: string | null;
  flashedBuildings?: Set<string>;
  npcThoughts?: Map<string, string>;
  onVisibleCountChange?: (visible: number, total: number) => void;
}

type VisualZone = "COMMERCIAL" | "INDUSTRIAL" | "SUBURBAN" | "UTILITY" | "CIVIC";

interface DistrictPos {
  worldX: number;
  worldZ: number;
  worldW: number;
  worldD: number;
}

interface PlacedBuilding {
  building: Building;
  worldX: number;
  worldZ: number;
}

interface RoadTile {
  worldX: number;
  worldZ: number;
  type: "straight" | "bend" | "crossroad" | "T-junction" | "end" | "bridge";
  rotation: number;
  direction?: "horizontal" | "vertical";
  isElevated?: boolean;
}

interface PropInstance {
  modelKey: string;
  worldX: number;
  worldZ: number;
  rotation: number;
  scale: number;
  scaleY?: number;
}

type LOD = "full" | "med" | "low" | "mini";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TILE_SIZE = 2;
const MODEL_SCALE = 3.0;
const TREE_SCALE = 2.5;
const PROP_SCALE = 2.0;
const CAR_SCALE = 0.9;

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 20;

const CELL_SIZE = 24;
const GAP = 4;
const ROAD_MARGIN = 2;
const BUILDING_GAP = 0.3;

const MAX_CARS_TOTAL = 15;

const ASSET_BASE = "/assets/kenney/packs";

const BUILDING_MODELS: Record<string, string> = {
  "commercial-skyscraper": `${ASSET_BASE}/city-kit-commercial/Models/GLB format/building-skyscraper-a.glb`,
  "commercial-landmark": `${ASSET_BASE}/city-kit-commercial/Models/GLB format/building-skyscraper-b.glb`,
  "commercial-tall-c": `${ASSET_BASE}/city-kit-commercial/Models/GLB format/building-skyscraper-c.glb`,
  "commercial-tall-d": `${ASSET_BASE}/city-kit-commercial/Models/GLB format/building-skyscraper-d.glb`,
  "commercial-tall-e": `${ASSET_BASE}/city-kit-commercial/Models/GLB format/building-skyscraper-e.glb`,
  "commercial-large": `${ASSET_BASE}/city-kit-commercial/Models/GLB format/building-b.glb`,
  "commercial-medium": `${ASSET_BASE}/city-kit-commercial/Models/GLB format/building-c.glb`,
  "commercial-glass": `${ASSET_BASE}/city-kit-commercial/Models/GLB format/building-d.glb`,
  "commercial-corner": `${ASSET_BASE}/city-kit-commercial/Models/GLB format/building-f.glb`,
  "commercial-small": `${ASSET_BASE}/city-kit-commercial/Models/GLB format/building-g.glb`,
  "commercial-h": `${ASSET_BASE}/city-kit-commercial/Models/GLB format/building-h.glb`,
  "commercial-wide-a": `${ASSET_BASE}/city-kit-commercial/Models/GLB format/building-a.glb`,

  "industrial-large": `${ASSET_BASE}/city-kit-industrial/Models/GLB format/building-a.glb`,
  "industrial-factory": `${ASSET_BASE}/city-kit-industrial/Models/GLB format/building-b.glb`,
  "industrial-warehouse": `${ASSET_BASE}/city-kit-industrial/Models/GLB format/building-c.glb`,
  "industrial-small": `${ASSET_BASE}/city-kit-industrial/Models/GLB format/building-d.glb`,
  "industrial-e": `${ASSET_BASE}/city-kit-industrial/Models/GLB format/building-e.glb`,
  "industrial-f": `${ASSET_BASE}/city-kit-industrial/Models/GLB format/building-f.glb`,

  "suburban-campus": `${ASSET_BASE}/city-kit-suburban/Models/GLB format/building-type-c.glb`,
  "suburban-large": `${ASSET_BASE}/city-kit-suburban/Models/GLB format/building-type-a.glb`,
  "suburban-medium": `${ASSET_BASE}/city-kit-suburban/Models/GLB format/building-type-b.glb`,
  "suburban-small": `${ASSET_BASE}/city-kit-suburban/Models/GLB format/building-type-d.glb`,
  "suburban-corner": `${ASSET_BASE}/city-kit-suburban/Models/GLB format/building-type-f.glb`,
  "suburban-e": `${ASSET_BASE}/city-kit-suburban/Models/GLB format/building-type-e.glb`,
  "suburban-g": `${ASSET_BASE}/city-kit-suburban/Models/GLB format/building-type-g.glb`,
  "suburban-h": `${ASSET_BASE}/city-kit-suburban/Models/GLB format/building-type-h.glb`,
};

const ROAD_MODELS: Record<string, string> = {
  straight: `${ASSET_BASE}/city-kit-roads/Models/GLB format/road-straight.glb`,
  bend: `${ASSET_BASE}/city-kit-roads/Models/GLB format/road-bend.glb`,
  crossroad: `${ASSET_BASE}/city-kit-roads/Models/GLB format/road-crossroad.glb`,
  "T-junction": `${ASSET_BASE}/city-kit-roads/Models/GLB format/road-intersection.glb`,
  end: `${ASSET_BASE}/city-kit-roads/Models/GLB format/road-end.glb`,
  bridge: `${ASSET_BASE}/city-kit-roads/Models/GLB format/road-bridge.glb`,
};

const PROP_MODELS: Record<string, string> = {
  "tree-cone": `${ASSET_BASE}/nature-kit/Models/GLTF format/tree_cone.glb`,
  "tree-round": `${ASSET_BASE}/nature-kit/Models/GLTF format/tree_default.glb`,
  "tree-oak": `${ASSET_BASE}/nature-kit/Models/GLTF format/tree_oak.glb`,
  "tree-suburban-large": `${ASSET_BASE}/city-kit-suburban/Models/GLB format/tree-large.glb`,
  "tree-suburban-small": `${ASSET_BASE}/city-kit-suburban/Models/GLB format/tree-small.glb`,
  bush: `${ASSET_BASE}/nature-kit/Models/GLTF format/plant_bush.glb`,
  smokestack: `${ASSET_BASE}/city-kit-industrial/Models/GLB format/chimney-large.glb`,
  "smokestack-medium": `${ASSET_BASE}/city-kit-industrial/Models/GLB format/chimney-medium.glb`,
  "storage-tank": `${ASSET_BASE}/city-kit-industrial/Models/GLB format/detail-tank.glb`,
  "street-lamp": `${ASSET_BASE}/city-kit-roads/Models/GLB format/light-square.glb`,
  sign: `${ASSET_BASE}/city-kit-roads/Models/GLB format/sign-highway.glb`,
  "car-sedan": `${ASSET_BASE}/car-kit/Models/GLB format/sedan-sports.glb`,
  "car-sedan-basic": `${ASSET_BASE}/car-kit/Models/GLB format/sedan.glb`,
  "car-truck": `${ASSET_BASE}/car-kit/Models/GLB format/truck.glb`,
  "car-delivery": `${ASSET_BASE}/car-kit/Models/GLB format/delivery.glb`,
  barrier: `${ASSET_BASE}/city-kit-roads/Models/GLB format/construction-barrier.glb`,
  cone: `${ASSET_BASE}/city-kit-roads/Models/GLB format/construction-cone.glb`,
  "bridge-pillar": `${ASSET_BASE}/city-kit-roads/Models/GLB format/bridge-pillar.glb`,
};

const ZONE_WALL_COLORS: Record<VisualZone, number> = {
  COMMERCIAL: 0xffffff,
  INDUSTRIAL: 0x4a5568,
  SUBURBAN: 0xffffff,
  UTILITY: 0x8a9ba8,
  CIVIC: 0xf0ede0,
};

const ZONE_ROOF_COLORS: Record<VisualZone, number> = {
  COMMERCIAL: 0x2a3a4a,
  INDUSTRIAL: 0x2d3748,
  SUBURBAN: 0x4caf50,
  UTILITY: 0x5a6a78,
  CIVIC: 0x6b8e23,
};

// ---------------------------------------------------------------------------
// Shared Materials — factory so they can be re-created after WebGL context exists
// ---------------------------------------------------------------------------

function createSharedMaterials() {
  return {
    COMMERCIAL_wall: new THREE.MeshStandardMaterial({ color: new THREE.Color(1, 1, 1), roughness: 0.6, metalness: 0.1 }),
    COMMERCIAL_roof: new THREE.MeshStandardMaterial({ color: new THREE.Color('#2A3A4A'), roughness: 0.8 }),
    INDUSTRIAL_wall: new THREE.MeshStandardMaterial({ color: new THREE.Color('#4A5568'), roughness: 0.7 }),
    INDUSTRIAL_roof: new THREE.MeshStandardMaterial({ color: new THREE.Color('#1A2028'), roughness: 0.9 }),
    SUBURBAN_wall:   new THREE.MeshStandardMaterial({ color: new THREE.Color(1, 1, 1), roughness: 0.6 }),
    SUBURBAN_roof:   new THREE.MeshStandardMaterial({ color: new THREE.Color('#4CAF50'), roughness: 0.8 }),
    UTILITY_wall:    new THREE.MeshStandardMaterial({ color: new THREE.Color('#8A9BA8'), roughness: 0.7 }),
    UTILITY_roof:    new THREE.MeshStandardMaterial({ color: new THREE.Color('#5A6A78'), roughness: 0.9 }),
    CIVIC_wall:      new THREE.MeshStandardMaterial({ color: new THREE.Color('#F0EDE0'), roughness: 0.6 }),
    CIVIC_roof:      new THREE.MeshStandardMaterial({ color: new THREE.Color('#6B8E23'), roughness: 0.8 }),
    road:            new THREE.MeshStandardMaterial({ color: new THREE.Color('#555566'), roughness: 0.9 }),
    ground:          new THREE.MeshStandardMaterial({ color: new THREE.Color('#5A8A5A'), roughness: 0.95 }),
    fallback:        new THREE.MeshStandardMaterial({ color: new THREE.Color('#888888'), roughness: 0.7 }),
  } as const;
}
let SHARED_MATERIALS = createSharedMaterials();

// Shared geometry — ONE boxGeometry for all buildings
const SHARED_BOX_GEO = new THREE.BoxGeometry(1, 1, 1);

function createStatusMaterials() {
  return {
    fire:    new THREE.MeshStandardMaterial({ color: new THREE.Color('#FF2200'), emissive: new THREE.Color('#FF2200'), emissiveIntensity: 0.5 }),
    error:   new THREE.MeshStandardMaterial({ color: new THREE.Color('#FF6600'), emissive: new THREE.Color('#FF6600'), emissiveIntensity: 0.3 }),
    warning: new THREE.MeshStandardMaterial({ color: new THREE.Color('#FFAA00'), emissive: new THREE.Color('#FFAA00'), emissiveIntensity: 0.2 }),
    glowing: new THREE.MeshStandardMaterial({ color: new THREE.Color('#00FF88'), emissive: new THREE.Color('#00FF88'), emissiveIntensity: 0.15 }),
    dark:    new THREE.MeshStandardMaterial({ color: new THREE.Color('#2A2A2A'), roughness: 0.9 }),
  } as const;
}
let STATUS_MATERIALS = createStatusMaterials();

// ---------------------------------------------------------------------------
// Shallow Clone — shares geometry & material (zero GPU cost), only clones graph nodes
// ---------------------------------------------------------------------------

function shallowCloneScene(source: THREE.Object3D): THREE.Object3D {
  if (source instanceof THREE.Mesh) {
    const clone = new THREE.Mesh(source.geometry, source.material);
    clone.castShadow = source.castShadow;
    clone.receiveShadow = source.receiveShadow;
    clone.position.copy(source.position);
    clone.quaternion.copy(source.quaternion);
    clone.scale.copy(source.scale);
    clone.name = source.name;
    for (const child of source.children) {
      clone.add(shallowCloneScene(child));
    }
    return clone;
  }
  const clone = new THREE.Group();
  clone.position.copy(source.position);
  clone.quaternion.copy(source.quaternion);
  clone.scale.copy(source.scale);
  clone.name = source.name;
  for (const child of source.children) {
    clone.add(shallowCloneScene(child));
  }
  return clone;
}

const DISTRICT_PAD_COLORS: Record<VisualZone, string> = {
  COMMERCIAL: "#7A8A9A",
  INDUSTRIAL: "#4A5058",
  SUBURBAN: "#6A9A6A",
  UTILITY: "#5A6068",
  CIVIC: "#7A9A7A",
};

const DISTRICT_PAD_MATERIALS: Record<VisualZone, THREE.MeshStandardMaterial> = {
  COMMERCIAL: new THREE.MeshStandardMaterial({ color: "#7A8A9A", roughness: 0.95 }),
  INDUSTRIAL: new THREE.MeshStandardMaterial({ color: "#4A5058", roughness: 0.95 }),
  SUBURBAN: new THREE.MeshStandardMaterial({ color: "#6A9A6A", roughness: 0.95 }),
  UTILITY: new THREE.MeshStandardMaterial({ color: "#5A6068", roughness: 0.95 }),
  CIVIC: new THREE.MeshStandardMaterial({ color: "#7A9A7A", roughness: 0.95 }),
};

const HIGHLIGHT_MATERIAL = new THREE.MeshBasicMaterial({
  color: "#00fff7",
  transparent: true,
  opacity: 0.8,
  side: THREE.DoubleSide,
});

const SEASON_AMBIENT: Record<string, string> = {
  summer: "#D4E8F5",
  spring: "#D4EFD4",
  autumn: "#EFD4A0",
  winter: "#C8D8E8",
};

const SEASON_BGS: Record<string, string> = {
  summer: "#0a0e1a",
  spring: "#0a1515",
  autumn: "#1a100a",
  winter: "#151515",
};

const TYPE_COLORS: Record<string, string> = {
  class: "#00fff7",
  function: "#00ff00",
  api: "#ff9900",
  database: "#b026ff",
  config: "#ffff00",
  test: "#ff00ff",
  entry: "#ffffff",
  unknown: "#888888",
};

const DISTRICT_COLORS: Record<string, string> = {
  source: "rgba(0, 255, 247, 0.1)",
  test: "rgba(255, 0, 255, 0.1)",
  config: "rgba(255, 255, 0, 0.1)",
  api: "rgba(255, 153, 0, 0.1)",
  database: "rgba(176, 38, 255, 0.1)",
  docs: "rgba(255, 255, 255, 0.1)",
  assets: "rgba(0, 255, 0, 0.1)",
  root: "rgba(136, 136, 136, 0.1)",
};

const MAX_CARS_PER_DISTRICT: Record<VisualZone, number> = {
  COMMERCIAL: 3,
  INDUSTRIAL: 2,
  SUBURBAN: 1,
  UTILITY: 0,
  CIVIC: 0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSeededRandom(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// ---------------------------------------------------------------------------
// Zone Classification
// ---------------------------------------------------------------------------

function getVisualZone(district: District): VisualZone {
  const buildingCount = district.buildings.length;
  switch (district.type) {
    case "api":
      return "COMMERCIAL";
    case "database":
      return "INDUSTRIAL";
    case "config":
      return "UTILITY";
    case "test":
      return "SUBURBAN";
    case "docs":
      return "CIVIC";
    case "assets":
      return "CIVIC";
    case "root":
      return "COMMERCIAL";
    case "source":
      return buildingCount > 10 ? "COMMERCIAL" : "SUBURBAN";
    default:
      return buildingCount > 10 ? "COMMERCIAL" : "SUBURBAN";
  }
}

// ---------------------------------------------------------------------------
// Reflow Districts into Square Grid
// ---------------------------------------------------------------------------

function reflowDistrictsToGrid(
  districts: District[]
): Map<string, DistrictPos> {
  const positions = new Map<string, DistrictPos>();
  if (!districts || districts.length === 0) return positions;

  const sorted = [...districts].sort(
    (a, b) => b.buildings.length - a.buildings.length
  );

  const cols = Math.ceil(Math.sqrt(sorted.length * 1.4));

  let col = 0;
  let row = 0;
  const rowHeights: number[] = [];
  let currentRowMaxD = 0;

  for (const district of sorted) {
    const buildingCount = district.buildings.length;
    let cellW = 1;
    let cellD = 1;
    if (buildingCount > 15) {
      cellW = 2;
      cellD = 2;
    } else if (buildingCount > 6) {
      cellW = 2;
      cellD = 1;
    }

    if (col + cellW > cols) {
      rowHeights.push(currentRowMaxD);
      col = 0;
      row++;
      currentRowMaxD = 0;
    }

    currentRowMaxD = Math.max(currentRowMaxD, cellD);

    const rowOffset = rowHeights.reduce((sum, h) => sum + h * (CELL_SIZE + GAP), 0);

    const worldX = col * (CELL_SIZE + GAP);
    const worldZ = rowOffset;
    const worldW = cellW * CELL_SIZE + (cellW > 1 ? (cellW - 1) * GAP : 0);
    const worldD = cellD * CELL_SIZE + (cellD > 1 ? (cellD - 1) * GAP : 0);

    positions.set(district.id, { worldX, worldZ, worldW, worldD });
    col += cellW;
  }

  return positions;
}

// ---------------------------------------------------------------------------
// Building Placement Within District
// ---------------------------------------------------------------------------

function placeBuildings(
  district: District,
  districtPos: DistrictPos,
  _zone: VisualZone
): PlacedBuilding[] {
  const { worldX, worldZ, worldW, worldD } = districtPos;
  const buildings = district.buildings;
  if (buildings.length === 0) return [];

  const usableW = worldW - ROAD_MARGIN * 2;
  const usableD = worldD - ROAD_MARGIN * 2;

  // Sort buildings by floors descending for center placement
  const sorted = [...buildings].sort((a, b) => b.floors - a.floors);

  const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
  const rows = Math.max(1, Math.ceil(sorted.length / cols));
  const cellW = usableW / cols;
  const cellD = usableD / rows;

  return sorted.map((b, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    return {
      building: b,
      worldX: worldX + ROAD_MARGIN + c * cellW + cellW / 2,
      worldZ: worldZ + ROAD_MARGIN + r * cellD + cellD / 2,
    };
  });
}

// ---------------------------------------------------------------------------
// City Bounds from Reflowed Grid
// ---------------------------------------------------------------------------

function computeCityBounds(
  districtPositions: Map<string, DistrictPos>
): {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  totalW: number;
  totalD: number;
  centerX: number;
  centerZ: number;
} {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  districtPositions.forEach((pos) => {
    minX = Math.min(minX, pos.worldX);
    minZ = Math.min(minZ, pos.worldZ);
    maxX = Math.max(maxX, pos.worldX + pos.worldW);
    maxZ = Math.max(maxZ, pos.worldZ + pos.worldD);
  });
  if (!isFinite(minX)) {
    return {
      minX: 0,
      minZ: 0,
      maxX: 48,
      maxZ: 48,
      totalW: 48,
      totalD: 48,
      centerX: 24,
      centerZ: 24,
    };
  }
  const totalW = maxX - minX;
  const totalD = maxZ - minZ;
  return {
    minX,
    minZ,
    maxX,
    maxZ,
    totalW,
    totalD,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
  };
}

// ---------------------------------------------------------------------------
// Model Selection per Zone
// ---------------------------------------------------------------------------

function getCommercialModelKey(building: Building): string {
  if (building.floors >= 8) return "commercial-skyscraper";
  if (building.floors >= 6) return "commercial-landmark";
  if (building.floors >= 5) return "commercial-large";
  if (building.floors >= 3 && building.fileType === "api") return "commercial-glass";
  if (building.floors >= 3 && building.fileType === "entry") return "commercial-tall-c";
  if (building.floors <= 2 && building.fileType === "config") return "commercial-small";
  return "commercial-medium";
}

function getIndustrialModelKey(building: Building): string {
  if (building.complexity >= 40) return "industrial-large";
  if (building.complexity >= 20) return "industrial-factory";
  if (building.complexity >= 10) return "industrial-warehouse";
  return "industrial-small";
}

function getSuburbanModelKey(building: Building): string {
  if (building.fileType === "test") return "suburban-campus";
  if (building.floors >= 4) return "suburban-large";
  if (building.floors >= 2) return "suburban-medium";
  return "suburban-small";
}

function getModelKeyForZone(building: Building, zone: VisualZone): string {
  switch (zone) {
    case "COMMERCIAL":
      return getCommercialModelKey(building);
    case "INDUSTRIAL":
      return getIndustrialModelKey(building);
    case "SUBURBAN":
    case "CIVIC":
      return getSuburbanModelKey(building);
    case "UTILITY":
      return getIndustrialModelKey(building);
    default:
      return "commercial-medium";
  }
}

function getBuildingFootprint(building: Building): { w: number; d: number } {
  if (building.complexity >= 40) return { w: 2, d: 2 };
  if (building.complexity >= 20) return { w: 2, d: 1 };
  return { w: 1, d: 1 };
}

// ---------------------------------------------------------------------------
// Zone Material Override — shared materials, Y-centroid sorting
// ---------------------------------------------------------------------------

function applyZoneMaterials(
  sourceScene: THREE.Group,
  zone: VisualZone,
  status: Building["status"],
  _testCoverage: number,
  _opacity: number,
  _buildingIndex: number = 0
): THREE.Group {
  const cloned = shallowCloneScene(sourceScene) as THREE.Group;

  // Pick shared materials based on status, falling back to zone defaults
  const hasStatus = status === "fire" || status === "error" || status === "warning" || status === "glowing" || status === "dark";
  const wallKey = `${zone}_wall` as keyof typeof SHARED_MATERIALS;
  const roofKey = `${zone}_roof` as keyof typeof SHARED_MATERIALS;
  const wallMat = hasStatus && status in STATUS_MATERIALS
    ? STATUS_MATERIALS[status as keyof typeof STATUS_MATERIALS]
    : (SHARED_MATERIALS[wallKey] ?? SHARED_MATERIALS.COMMERCIAL_wall);
  const roofMat = SHARED_MATERIALS[roofKey] ?? SHARED_MATERIALS.COMMERCIAL_roof;

  const meshes: THREE.Mesh[] = [];
  cloned.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      meshes.push(child);
    }
  });

  // Sort by Y centroid: bottom meshes = wall, top meshes = roof
  meshes.sort((a, b) => {
    const ay = new THREE.Box3().setFromObject(a).getCenter(new THREE.Vector3()).y;
    const by = new THREE.Box3().setFromObject(b).getCenter(new THREE.Vector3()).y;
    return ay - by;
  });

  const roofStart = Math.floor(meshes.length * 0.6);
  meshes.forEach((mesh, i) => {
    mesh.material = i >= roofStart ? roofMat : wallMat;
  });

  // Ground contact: offset so min Y = 0
  const box = new THREE.Box3().setFromObject(cloned);
  cloned.position.y = -box.min.y;

  return cloned;
}

// ---------------------------------------------------------------------------
// Status Emissive (for fallback boxes)
// ---------------------------------------------------------------------------

function getStatusEmissive(
  building: Building,
  isFlashing: boolean,
  isActive: boolean,
  activeColor: string
): { color: THREE.Color; intensity: number } {
  if (isFlashing) return { color: new THREE.Color(0xff0000), intensity: 0.6 };
  if (building.status === "fire" || building.activeEvent === "fire")
    return { color: new THREE.Color(0xff2200), intensity: 0.5 };
  if (building.status === "error")
    return { color: new THREE.Color(0xff6600), intensity: 0.3 };
  if (building.status === "warning")
    return { color: new THREE.Color(0xffaa00), intensity: 0.2 };
  if (building.status === "glowing")
    return { color: new THREE.Color(0x00ff88), intensity: 0.15 };
  if (isActive)
    return { color: new THREE.Color(activeColor), intensity: 0.15 };
  return { color: new THREE.Color(0x000000), intensity: 0 };
}

function getLOD(zoom: number): LOD {
  // LOD switching disabled — always "low" to avoid GLB uniform overflow
  if (zoom > 0.4) return "low";
  return "mini";
}

function getRoofOpacity(_building: Building, _isDimmed: boolean): number {
  // All buildings are fully opaque now — no more glass box look
  return 1.0;
}

// ---------------------------------------------------------------------------
// Collision Detection
// ---------------------------------------------------------------------------

function isPositionClear(
  worldX: number,
  worldZ: number,
  radius: number,
  placedBuildings: PlacedBuilding[],
  roadTiles: RoadTile[]
): boolean {
  for (const pb of placedBuildings) {
    const fp = getBuildingFootprint(pb.building);
    const halfW = (fp.w * TILE_SIZE) / 2 + radius;
    const halfD = (fp.d * TILE_SIZE) / 2 + radius;
    if (
      Math.abs(worldX - pb.worldX) < halfW &&
      Math.abs(worldZ - pb.worldZ) < halfD
    )
      return false;
  }
  for (const rt of roadTiles) {
    if (
      Math.abs(worldX - rt.worldX) < 1.5 &&
      Math.abs(worldZ - rt.worldZ) < 1.5
    ) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Road Tile Generation — perimeter only, NOT filling interiors
// ---------------------------------------------------------------------------

function generateRoadNetwork(
  districtPositions: Map<string, DistrictPos>
): RoadTile[] {
  const roadMap = new Map<string, RoadTile>();
  const TILE = TILE_SIZE;
  const keyFn = (x: number, z: number) =>
    `${Math.round(x * 10)},${Math.round(z * 10)}`;

  // Track which tiles are forced horizontal vs vertical by district edges.
  // Tiles that get claimed by BOTH orientations are true intersections.
  const horzSet = new Set<string>();
  const vertSet = new Set<string>();

  districtPositions.forEach((pos) => {
    const { worldX, worldZ, worldW, worldD } = pos;

    // North road (one tile north of district) — runs along X → horizontal
    const northZ = worldZ - TILE;
    for (let x = worldX; x <= worldX + worldW - TILE; x += TILE) {
      const k = keyFn(x, northZ);
      horzSet.add(k);
      if (!roadMap.has(k)) {
        roadMap.set(k, {
          worldX: x,
          worldZ: northZ,
          type: "straight",
          direction: "horizontal",
          rotation: Math.PI / 2,
        });
      }
    }

    // South road — runs along X → horizontal
    const southZ = worldZ + worldD;
    for (let x = worldX; x <= worldX + worldW - TILE; x += TILE) {
      const k = keyFn(x, southZ);
      horzSet.add(k);
      if (!roadMap.has(k)) {
        roadMap.set(k, {
          worldX: x,
          worldZ: southZ,
          type: "straight",
          direction: "horizontal",
          rotation: Math.PI / 2,
        });
      }
    }

    // West road — runs along Z → vertical
    const westX = worldX - TILE;
    for (let z = worldZ; z <= worldZ + worldD - TILE; z += TILE) {
      const k = keyFn(westX, z);
      vertSet.add(k);
      if (!roadMap.has(k)) {
        roadMap.set(k, {
          worldX: westX,
          worldZ: z,
          type: "straight",
          direction: "vertical",
          rotation: 0,
        });
      }
    }

    // East road — runs along Z → vertical
    const eastX = worldX + worldW;
    for (let z = worldZ; z <= worldZ + worldD - TILE; z += TILE) {
      const k = keyFn(eastX, z);
      vertSet.add(k);
      if (!roadMap.has(k)) {
        roadMap.set(k, {
          worldX: eastX,
          worldZ: z,
          type: "straight",
          direction: "vertical",
          rotation: 0,
        });
      }
    }

    // Corner tiles where horizontal and vertical edges meet
    const corners: [number, number][] = [
      [worldX - TILE, worldZ - TILE],
      [worldX + worldW, worldZ - TILE],
      [worldX - TILE, worldZ + worldD],
      [worldX + worldW, worldZ + worldD],
    ];
    for (const [cx, cz] of corners) {
      const k = keyFn(cx, cz);
      horzSet.add(k);
      vertSet.add(k);
      if (!roadMap.has(k)) {
        roadMap.set(k, {
          worldX: cx,
          worldZ: cz,
          type: "straight",
          direction: "horizontal",
          rotation: 0,
        });
      }
    }
  });

  // Classify intersections based on actual neighbors
  const tiles = Array.from(roadMap.values());
  return classifyRoadTiles(tiles, roadMap, keyFn, TILE);
}

function classifyRoadTiles(
  tiles: RoadTile[],
  roadMap: Map<string, RoadTile>,
  keyFn: (x: number, z: number) => string,
  step: number
): RoadTile[] {
  return tiles.map((tile) => {
    const n = roadMap.has(keyFn(tile.worldX, tile.worldZ - step));
    const s = roadMap.has(keyFn(tile.worldX, tile.worldZ + step));
    const e = roadMap.has(keyFn(tile.worldX + step, tile.worldZ));
    const w = roadMap.has(keyFn(tile.worldX - step, tile.worldZ));
    const count = +n + +s + +e + +w;

    if (count >= 4)
      return { ...tile, type: "crossroad" as const, rotation: 0 };
    if (count === 3) {
      if (!n)
        return { ...tile, type: "T-junction" as const, rotation: Math.PI };
      if (!s) return { ...tile, type: "T-junction" as const, rotation: 0 };
      if (!e)
        return {
          ...tile,
          type: "T-junction" as const,
          rotation: -Math.PI / 2,
        };
      return {
        ...tile,
        type: "T-junction" as const,
        rotation: Math.PI / 2,
      };
    }
    if (count === 2) {
      if (n && s)
        return {
          ...tile,
          type: "straight" as const,
          direction: "vertical" as const,
          rotation: 0,
        };
      if (e && w)
        return {
          ...tile,
          type: "straight" as const,
          direction: "horizontal" as const,
          rotation: Math.PI / 2,
        };
      if (n && e) return { ...tile, type: "bend" as const, rotation: 0 };
      if (n && w)
        return { ...tile, type: "bend" as const, rotation: -Math.PI / 2 };
      if (s && e)
        return { ...tile, type: "bend" as const, rotation: Math.PI / 2 };
      if (s && w)
        return { ...tile, type: "bend" as const, rotation: Math.PI };
    }
    if (count === 1) {
      if (n) return { ...tile, type: "end" as const, rotation: 0 };
      if (s) return { ...tile, type: "end" as const, rotation: Math.PI };
      if (e)
        return { ...tile, type: "end" as const, rotation: Math.PI / 2 };
      return { ...tile, type: "end" as const, rotation: -Math.PI / 2 };
    }
    return tile;
  });
}

// ---------------------------------------------------------------------------
// Street Lamps at Intersections
// ---------------------------------------------------------------------------

function generateStreetLamps(roadTiles: RoadTile[]): PropInstance[] {
  return roadTiles
    .filter((t) => t.type === "crossroad" || t.type === "T-junction")
    .map((t) => ({
      modelKey: "street-lamp",
      worldX: t.worldX + 1.2,
      worldZ: t.worldZ + 1.2,
      rotation: 0,
      scale: PROP_SCALE,
    }));
}

// ---------------------------------------------------------------------------
// Props Generation
// ---------------------------------------------------------------------------

function placeAllProps(
  districts: District[],
  districtPositions: Map<string, DistrictPos>,
  allPlacedBuildings: PlacedBuilding[],
  roadTiles: RoadTile[]
): PropInstance[] {
  const allProps: PropInstance[] = [];
  let totalCars = 0;

  // Street lamps at intersections
  allProps.push(...generateStreetLamps(roadTiles));

  for (const district of districts) {
    const pos = districtPositions.get(district.id);
    if (!pos) continue;
    const zone = getVisualZone(district);
    const rng = createSeededRandom(hashString(district.id));
    const rngChoice = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];

    const districtBuildings = allPlacedBuildings.filter((pb) =>
      district.buildings.some((b) => b.id === pb.building.id)
    );

    // Find road tiles adjacent to this district for car placement
    const districtRoadTiles = roadTiles.filter((rt) => {
      const dx = rt.worldX - (pos.worldX + pos.worldW / 2);
      const dz = rt.worldZ - (pos.worldZ + pos.worldD / 2);
      return (
        Math.abs(dx) < pos.worldW / 2 + TILE_SIZE * 2 &&
        Math.abs(dz) < pos.worldD / 2 + TILE_SIZE * 2
      );
    });

    // --- Cars on road shoulders only ---
    const maxCars = MAX_CARS_PER_DISTRICT[zone];
    let districtCarCount = 0;

    if (maxCars > 0 && totalCars < MAX_CARS_TOTAL && districtRoadTiles.length > 0) {
      const straightRoads = districtRoadTiles.filter(
        (rt) => rt.type === "straight"
      );
      const roadsToUse =
        straightRoads.length > 0 ? straightRoads : districtRoadTiles;

      for (let i = 0; i < maxCars && totalCars < MAX_CARS_TOTAL; i++) {
        if (districtCarCount >= maxCars) break;
        const roadTile = roadsToUse[Math.floor(rng() * roadsToUse.length)];
        if (!roadTile) break;

        const SHOULDER_OFFSET = 0.9;
        const isHoriz = roadTile.direction === "horizontal";
        const side = rng() < 0.5 ? -1 : 1;
        const cx = isHoriz
          ? roadTile.worldX
          : roadTile.worldX + side * SHOULDER_OFFSET;
        const cz = isHoriz
          ? roadTile.worldZ + side * SHOULDER_OFFSET
          : roadTile.worldZ;
        const crot = isHoriz ? Math.PI / 2 : 0;

        if (isPositionClear(cx, cz, 0.6, districtBuildings, [])) {
          const carModel =
            zone === "INDUSTRIAL"
              ? rngChoice(["car-truck", "car-delivery"])
              : rngChoice(["car-sedan", "car-sedan-basic"]);
          allProps.push({
            modelKey: carModel,
            worldX: cx,
            worldZ: cz,
            rotation: crot + (rng() - 0.5) * 0.1,
            scale: CAR_SCALE,
          });
          districtCarCount++;
          totalCars++;
        }
      }
    }

    // --- Trees (zone-aware) ---
    if (zone === "INDUSTRIAL") {
      // Zero trees inside industrial
    } else if (zone === "COMMERCIAL") {
      // Max 2 trees at outer corners only
      let treeCount = 0;
      const corners = [
        [pos.worldX + 1, pos.worldZ + 1],
        [pos.worldX + pos.worldW - 1, pos.worldZ + 1],
        [pos.worldX + 1, pos.worldZ + pos.worldD - 1],
        [pos.worldX + pos.worldW - 1, pos.worldZ + pos.worldD - 1],
      ];
      for (const [cx, cz] of corners) {
        if (treeCount >= 2) break;
        if (isPositionClear(cx, cz, 1.0, districtBuildings, roadTiles)) {
          allProps.push({
            modelKey: rngChoice(["tree-cone", "tree-round"]),
            worldX: cx,
            worldZ: cz,
            rotation: rng() * Math.PI * 2,
            scale: TREE_SCALE,
          });
          treeCount++;
        }
      }
    } else if (zone === "SUBURBAN" || zone === "CIVIC") {
      // Trees in front garden per building
      for (const pb of districtBuildings) {
        const treeCount = Math.floor(rng() * 3) + 1;
        for (let t = 0; t < treeCount; t++) {
          const tx = pb.worldX + (rng() - 0.5) * TILE_SIZE * 1.2;
          const tz = pb.worldZ - TILE_SIZE * 0.6 - rng() * TILE_SIZE * 0.4;
          if (isPositionClear(tx, tz, 1.0, districtBuildings, roadTiles)) {
            allProps.push({
              modelKey: rngChoice([
                "tree-suburban-large",
                "tree-suburban-small",
                "tree-cone",
                "tree-round",
              ]),
              worldX: tx,
              worldZ: tz,
              rotation: rng() * Math.PI * 2,
              scale: TREE_SCALE,
            });
          }
        }
        if (rng() < 0.4) {
          const bx = pb.worldX + TILE_SIZE * 0.7;
          const bz = pb.worldZ + TILE_SIZE * 0.3;
          if (isPositionClear(bx, bz, 0.5, districtBuildings, roadTiles)) {
            allProps.push({
              modelKey: "bush",
              worldX: bx,
              worldZ: bz,
              rotation: rng() * Math.PI * 2,
              scale: TREE_SCALE * 0.8,
            });
          }
        }
      }
    }

    // --- Smokestacks & tanks for industrial ---
    if (zone === "INDUSTRIAL") {
      // Sort by complexity descending, place smokestacks at top 30%
      const sortedByComplexity = [...districtBuildings].sort(
        (a, b) => b.building.complexity - a.building.complexity
      );
      const topCount = Math.max(
        1,
        Math.ceil(sortedByComplexity.length * 0.3)
      );
      let smokestackCount = 0;

      for (let i = 0; i < topCount && smokestackCount < 3; i++) {
        const pb = sortedByComplexity[i];
        if (!pb) break;
        const fp = getBuildingFootprint(pb.building);
        const sx = pb.worldX + (fp.w * TILE_SIZE) / 2 + 0.5;
        const sz = pb.worldZ - 1;
        if (isPositionClear(sx, sz, 0.5, districtBuildings, roadTiles)) {
          allProps.push({
            modelKey: "smokestack",
            worldX: sx,
            worldZ: sz,
            rotation: 0,
            scale: MODEL_SCALE * 0.5,
            scaleY: MODEL_SCALE * 1.8,
          });
          smokestackCount++;
        }
      }

      // Guarantee at least 1 smokestack
      if (smokestackCount === 0 && districtBuildings.length > 0) {
        const firstB = districtBuildings[0];
        allProps.push({
          modelKey: "smokestack",
          worldX: firstB.worldX + 2,
          worldZ: firstB.worldZ - 1.5,
          rotation: 0,
          scale: MODEL_SCALE * 0.5,
          scaleY: MODEL_SCALE * 1.8,
        });
      }

      // Storage tanks for database buildings
      for (const pb of districtBuildings) {
        if (pb.building.fileType === "database") {
          const tx = pb.worldX - TILE_SIZE;
          const tz = pb.worldZ;
          if (isPositionClear(tx, tz, 0.6, districtBuildings, roadTiles)) {
            allProps.push({
              modelKey: "storage-tank",
              worldX: tx,
              worldZ: tz,
              rotation: rng() * Math.PI,
              scale: MODEL_SCALE,
            });
          }
        }
      }

      // Barriers/cones for aged buildings
      for (const pb of districtBuildings) {
        if (
          pb.building.status === "warning" ||
          pb.building.age === "aged" ||
          pb.building.age === "ancient"
        ) {
          allProps.push({
            modelKey: "barrier",
            worldX: pb.worldX - 0.5,
            worldZ: pb.worldZ + 1,
            rotation: 0,
            scale: PROP_SCALE,
          });
          if (pb.building.age === "ancient") {
            allProps.push({
              modelKey: "cone",
              worldX: pb.worldX + 0.5,
              worldZ: pb.worldZ + 1.2,
              rotation: 0,
              scale: PROP_SCALE,
            });
          }
        }
      }
    }
  }

  return allProps;
}

// ---------------------------------------------------------------------------
// Agent Snapping to Road
// ---------------------------------------------------------------------------

function snapAgentToNearestRoad(
  agent: Agent,
  roadTiles: RoadTile[],
  districtPositions: Map<string, DistrictPos>,
  districts: District[]
): [number, number] {
  if (agent.currentBuilding) {
    for (const d of districts) {
      const bldg = d.buildings.find((b) => b.id === agent.currentBuilding);
      if (bldg) {
        const dpos = districtPositions.get(d.id);
        if (dpos) {
          return [dpos.worldX + dpos.worldW / 2, dpos.worldZ];
        }
      }
    }
  }

  if (roadTiles.length > 0) {
    const idx = Math.abs(hashString(agent.id)) % roadTiles.length;
    const tile = roadTiles[idx];
    return [tile.worldX, tile.worldZ];
  }

  return [24, 24];
}

// ---------------------------------------------------------------------------
// Camera Fit — 30° elevation, ~45° azimuth, city fills 75%+ of viewport
// ---------------------------------------------------------------------------

function computeInitialCameraSetup(
  districtPositions: Map<string, DistrictPos>
): {
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
  near: number;
  far: number;
  cityW: number;
  cityD: number;
} {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  districtPositions.forEach(pos => {
    minX = Math.min(minX, pos.worldX);
    minZ = Math.min(minZ, pos.worldZ);
    maxX = Math.max(maxX, pos.worldX + pos.worldW);
    maxZ = Math.max(maxZ, pos.worldZ + pos.worldD);
  });
  if (!isFinite(minX)) {
    minX = 0; minZ = 0; maxX = 48; maxZ = 48;
  }
  const cityW = Math.max(maxX - minX, 1);
  const cityD = Math.max(maxZ - minZ, 1);
  const maxExtent = Math.max(cityW, cityD);
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;

  const D = maxExtent * 0.6;
  const H = maxExtent * 0.4;

  // Initial zoom is a rough guess — CameraController will recompute using actual viewport size
  const zoom = 4;

  return {
    position: [centerX + D, H, centerZ + D] as [number, number, number],
    target: [centerX, 0, centerZ] as [number, number, number],
    zoom,
    near: 0.01,
    far: maxExtent * 10,
    cityW,
    cityD,
  };
}

// ---------------------------------------------------------------------------
// Shadow Camera Size
// ---------------------------------------------------------------------------

function getShadowCameraSize(
  cityBounds: ReturnType<typeof computeCityBounds>
): number {
  return Math.max(cityBounds.totalW, cityBounds.totalD) * 0.8;
}

// ---------------------------------------------------------------------------
// GLB Model Component
// ---------------------------------------------------------------------------

function GLBModel({
  url,
  position,
  rotation,
  scale,
  castShadow: castShadowProp = true,
  receiveShadow: receiveShadowProp = true,
  zone,
  buildingStatus,
  testCoverage,
  opacity,
  emissiveColor,
  emissiveIntensity,
  buildingIndex,
  isRoadTile,
  isTreeProp,
  isLampProp,
  onClick,
  onPointerOver,
  onPointerOut,
}: {
  url: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  castShadow?: boolean;
  receiveShadow?: boolean;
  zone?: VisualZone;
  buildingStatus?: Building["status"];
  testCoverage?: number;
  opacity?: number;
  emissiveColor?: THREE.Color;
  emissiveIntensity?: number;
  buildingIndex?: number;
  isRoadTile?: boolean;
  isTreeProp?: boolean;
  isLampProp?: boolean;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
  onPointerOver?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerOut?: (e: ThreeEvent<PointerEvent>) => void;
}) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => {
    if (zone && buildingStatus !== undefined && testCoverage !== undefined) {
      return applyZoneMaterials(
        scene,
        zone,
        buildingStatus,
        testCoverage,
        1.0,
        buildingIndex ?? 0
      );
    }
    const c = shallowCloneScene(scene) as THREE.Group;
    c.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mesh = child;
      mesh.castShadow = castShadowProp;
      mesh.receiveShadow = receiveShadowProp;
      // Use shared road material for road tiles, keep original for others
      if (isRoadTile) {
        mesh.material = SHARED_MATERIALS.road;
      }
    });
    return c;
  }, [
    scene,
    zone,
    buildingStatus,
    testCoverage,
    castShadowProp,
    receiveShadowProp,
    buildingIndex,
    isRoadTile,
  ]);

  return (
    <primitive
      object={cloned}
      position={position}
      rotation={rotation}
      scale={scale}
      onClick={onClick}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    />
  );
}

function FallbackBox({
  position,
  scale,
  material,
  onClick,
  onPointerOver,
  onPointerOut,
}: {
  position: [number, number, number];
  scale: [number, number, number];
  material: THREE.Material;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
  onPointerOver?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerOut?: (e: ThreeEvent<PointerEvent>) => void;
}) {
  return (
    <mesh
      position={position}
      scale={scale}
      castShadow
      receiveShadow
      onClick={onClick}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
      geometry={SHARED_BOX_GEO}
      material={material}
    />
  );
}

// ---------------------------------------------------------------------------
// Building Mesh Component
// ---------------------------------------------------------------------------

function BuildingMesh({
  building,
  worldX,
  worldZ,
  zone,
  lod,
  isSelected,
  isConnected,
  isDimmed,
  isFlashing,
  isActive,
  activeColor,
  isDragging,
  onSelectBuilding,
  onHover,
  onUnhover,
  buildingIndex = 0,
}: {
  building: Building;
  worldX: number;
  worldZ: number;
  zone: VisualZone;
  lod: LOD;
  isSelected: boolean;
  isConnected: boolean;
  isDimmed: boolean;
  isFlashing: boolean;
  isActive: boolean;
  activeColor: string;
  isDragging: React.MutableRefObject<boolean>;
  onSelectBuilding: (id: string) => void;
  onHover: (b: Building) => void;
  onUnhover: () => void;
  buildingIndex?: number;
}) {
  const footprint = getBuildingFootprint(building);

  // Height variety based on floors
  let scaleY = MODEL_SCALE;
  if (zone === "COMMERCIAL") {
    if (building.floors >= 8) scaleY = MODEL_SCALE * 1.0;
    else if (building.floors >= 5) scaleY = MODEL_SCALE * 0.75;
    else if (building.floors >= 3) scaleY = MODEL_SCALE * 0.55;
    else scaleY = MODEL_SCALE * 0.35;
  } else if (zone === "INDUSTRIAL") {
    scaleY = MODEL_SCALE * 0.6;
  } else if (zone === "SUBURBAN" || zone === "CIVIC") {
    scaleY = MODEL_SCALE * 0.4;
  }

  // Pick shared wall material — status overrides zone color
  const hasStatus = building.status === "fire" || building.status === "error" || building.status === "warning" || building.status === "glowing" || building.status === "dark";
  const wallMat = hasStatus && building.status && building.status in STATUS_MATERIALS
    ? STATUS_MATERIALS[building.status as keyof typeof STATUS_MATERIALS]
    : SHARED_MATERIALS[`${zone}_wall` as keyof typeof SHARED_MATERIALS] ?? SHARED_MATERIALS.COMMERCIAL_wall;

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (!isDragging.current) {
        onSelectBuilding(building.id);
      }
    },
    [building.id, isDragging, onSelectBuilding]
  );

  const handlePointerOver = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      onHover(building);
    },
    [building, onHover]
  );

  const handlePointerOut = useCallback(() => {
    onUnhover();
  }, [onUnhover]);

  const modelKey = getModelKeyForZone(building, zone);
  const modelUrl = BUILDING_MODELS[modelKey] ?? BUILDING_MODELS["commercial-medium"];

  return (
    <group position={[worldX, 0, worldZ]}>
      <Suspense
        fallback={
          <FallbackBox
            position={[0, scaleY * 0.5, 0]}
            scale={[footprint.w * MODEL_SCALE, scaleY, footprint.d * MODEL_SCALE]}
            material={wallMat}
            onClick={handleClick}
            onPointerOver={handlePointerOver}
            onPointerOut={handlePointerOut}
          />
        }
      >
        <GLBModel
          url={modelUrl}
          position={[0, 0, 0]}
          rotation={[0, 0, 0]}
          scale={[MODEL_SCALE, scaleY, MODEL_SCALE]}
          zone={zone}
          buildingStatus={building.status}
          testCoverage={building.testCoverage ?? 0}
          buildingIndex={buildingIndex}
          onClick={handleClick}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
        />
      </Suspense>

      {isSelected && (
        <mesh position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[MODEL_SCALE * 0.85, 0.15, 8, 32]} />
          <meshBasicMaterial
            color="#ffffff"
            transparent
            opacity={0.9}
          />
        </mesh>
      )}

      {isConnected && !isSelected && (
        <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[MODEL_SCALE * 0.7, MODEL_SCALE * 0.85, 32]} />
          <meshBasicMaterial
            color="#00ff88"
            transparent
            opacity={0.7}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {isActive && <ActiveRing color={activeColor} />}
      {isFlashing && <FlashRing />}

      {(building.activeEvent === "fire" || building.status === "fire") && (
        <FireEffect />
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Ring Effects
// ---------------------------------------------------------------------------

function ActiveRing({ color }: { color: string }) {
  const ringRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ringRef.current) {
      const s =
        1.0 + 0.15 * Math.sin(clock.elapsedTime * 1.5 * Math.PI * 2);
      ringRef.current.scale.set(s, s, 1);
    }
  });
  return (
    <mesh
      ref={ringRef}
      position={[0, 0.06, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <ringGeometry args={[MODEL_SCALE * 0.6, MODEL_SCALE * 0.75, 32]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.6}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function FlashRing() {
  const ringRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ringRef.current) {
      const s =
        1.0 + 0.3 * Math.sin(clock.elapsedTime * 3 * Math.PI * 2);
      ringRef.current.scale.set(s, s, 1);
    }
  });
  return (
    <mesh
      ref={ringRef}
      position={[0, 0.07, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <ringGeometry args={[MODEL_SCALE * 0.85, MODEL_SCALE * 1.05, 32]} />
      <meshBasicMaterial
        color="#ff0000"
        transparent
        opacity={0.5}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Fire Effect
// ---------------------------------------------------------------------------

function FireEffect() {
  const groupRef = useRef<THREE.Group>(null);
  const particles = useMemo(() => {
    const arr: { x: number; z: number; speed: number; phase: number }[] = [];
    const rng = createSeededRandom(42);
    for (let i = 0; i < 20; i++) {
      arr.push({
        x: (rng() - 0.5) * 1.5,
        z: (rng() - 0.5) * 1.5,
        speed: 0.5 + rng() * 1.5,
        phase: rng() * Math.PI * 2,
      });
    }
    return arr;
  }, []);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    groupRef.current.children.forEach((child, i) => {
      const p = particles[i];
      if (!p) return;
      const t = clock.elapsedTime;
      child.position.y = ((t * p.speed + p.phase) % 4) + 1;
      child.position.x = p.x + Math.sin(t * 2 + p.phase) * 0.2;
      child.position.z = p.z + Math.cos(t * 2 + p.phase) * 0.2;
    });
  });

  return (
    <group ref={groupRef}>
      {particles.map((_, i) => (
        <mesh key={i} scale={[0.08, 0.08, 0.08]}>
          <boxGeometry />
          <meshBasicMaterial
            color={
              i % 3 === 0 ? "#ff2200" : i % 3 === 1 ? "#ff6600" : "#ffaa00"
            }
          />
        </mesh>
      ))}
      <pointLight
        position={[0, 4, 0]}
        color={0xff4400}
        intensity={2}
        distance={8}
      />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Season Particles
// ---------------------------------------------------------------------------

function SeasonParticles({
  season,
  cityBounds,
}: {
  season: string;
  cityBounds: ReturnType<typeof computeCityBounds>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const particleCount =
    season === "winter" ? 50 : season === "autumn" ? 30 : season === "spring" ? 20 : 0;

  const { centerX, centerZ, totalW, totalD } = cityBounds;
  const spreadW = Math.max(totalW, 40);
  const spreadD = Math.max(totalD, 40);

  const particleData = useMemo(() => {
    const rng = createSeededRandom(12345);
    return Array.from({ length: particleCount }, () => ({
      x: centerX + (rng() - 0.5) * spreadW,
      y: rng() * 40,
      z: centerZ + (rng() - 0.5) * spreadD,
      speed: 0.3 + rng() * 0.5,
      drift: (rng() - 0.5) * 0.5,
      phase: rng() * Math.PI * 2,
    }));
  }, [particleCount, centerX, centerZ, spreadW, spreadD]);

  const color =
    season === "winter"
      ? "#ffffff"
      : season === "autumn"
        ? "#cc8844"
        : "#ffaacc";
  const direction = season === "spring" ? 1 : -1;

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.elapsedTime;
    groupRef.current.children.forEach((child, i) => {
      const p = particleData[i];
      if (!p) return;
      child.position.y =
        (((p.y + direction * t * p.speed * 2 + p.phase * 10) % 40) + 40) % 40;
      child.position.x = p.x + Math.sin(t * 0.5 + p.phase) * p.drift * 5;
      child.position.z = p.z + Math.cos(t * 0.3 + p.phase) * p.drift * 5;
    });
  });

  if (particleCount === 0) return null;

  return (
    <group ref={groupRef}>
      {particleData.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, p.z]} scale={[0.1, 0.1, 0.01]}>
          <planeGeometry />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.5}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Agent NPC
// ---------------------------------------------------------------------------

function AgentNPC({
  agent,
  roadTiles,
  districtPositions,
  districts,
  lod,
  thought,
}: {
  agent: Agent;
  roadTiles: RoadTile[];
  districtPositions: Map<string, DistrictPos>;
  districts: District[];
  lod: LOD;
  thought?: string;
}) {
  const [wx, wz] = useMemo(
    () => snapAgentToNearestRoad(agent, roadTiles, districtPositions, districts),
    [agent, roadTiles, districtPositions, districts]
  );

  const spring = useSpring({
    position: [wx, 0.4, wz] as [number, number, number],
    config: { mass: 1, tension: 50, friction: 10 },
  });

  const ringRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ringRef.current) {
      const freq = agent.status === "escalating" ? 3 : 1.5;
      const amp = agent.status === "escalating" ? 0.3 : 0.2;
      const s = 1.0 + amp * Math.sin(clock.elapsedTime * freq * Math.PI * 2);
      ringRef.current.scale.set(s, s, 1);
    }
  });

  const ringColor =
    agent.status === "escalating" ? "#ff8800" : agent.color || "#00fff7";
  const showRing = agent.status === "working" || agent.status === "escalating";
  const showLabel = lod === "full" || lod === "med";

  return (
    <animated.group
      position={spring.position as unknown as THREE.Vector3}
    >
      <mesh castShadow>
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshStandardMaterial color={agent.color || "#00fff7"} />
      </mesh>

      <pointLight
        color={agent.color || "#00fff7"}
        intensity={0.5}
        distance={4}
      />

      {showRing && (
        <mesh
          ref={ringRef}
          position={[0, -0.25, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.4, 0.55, 24]} />
          <meshBasicMaterial
            color={ringColor}
            transparent
            opacity={0.4}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {showLabel && agent.name && (
        <sprite position={[0, 0.8, 0]} scale={[2, 0.5, 1]}>
          <spriteMaterial color="#ffffff" transparent opacity={0.8} />
        </sprite>
      )}

      {showLabel && thought && (
        <sprite position={[0, 1.5, 0]} scale={[3, 0.6, 1]}>
          <spriteMaterial color="#00fff7" transparent opacity={0.6} />
        </sprite>
      )}
    </animated.group>
  );
}

// ---------------------------------------------------------------------------
// Road Network Component
// ---------------------------------------------------------------------------

function RoadNetwork({ tiles, lod }: { tiles: RoadTile[]; lod: LOD }) {
  if (lod === "mini") return null;

  return (
    <group>
      {tiles.map((tile, i) => {
        const modelUrl =
          tile.type === "bridge"
            ? ROAD_MODELS.bridge
            : ROAD_MODELS[tile.type] || ROAD_MODELS.straight;

        const y = tile.isElevated ? 3 : 0.02;

        return (
          <group key={i}>
            <Suspense fallback={null}>
              <GLBModel
                url={modelUrl}
                position={[tile.worldX, y, tile.worldZ]}
                rotation={[0, tile.rotation, 0]}
                scale={[MODEL_SCALE, MODEL_SCALE, MODEL_SCALE]}
                castShadow={false}
                receiveShadow={true}
                isRoadTile={true}
              />
            </Suspense>
            {tile.isElevated && (
              <Suspense fallback={null}>
                <GLBModel
                  url={PROP_MODELS["bridge-pillar"]}
                  position={[tile.worldX, 0, tile.worldZ]}
                  rotation={[0, tile.rotation, 0]}
                  scale={[MODEL_SCALE, MODEL_SCALE, MODEL_SCALE]}
                  castShadow={true}
                  receiveShadow={true}
                />
              </Suspense>
            )}
          </group>
        );
      })}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Props Renderer
// ---------------------------------------------------------------------------

function PropsRenderer({ props, lod }: { props: PropInstance[]; lod: LOD }) {
  if (lod === "mini" || lod === "low") return null;
  const visible =
    lod === "full"
      ? props
      : props.filter((p) => !p.modelKey.startsWith("car-"));

  return (
    <group>
      {visible.map((p, i) => {
        const modelUrl = PROP_MODELS[p.modelKey];
        if (!modelUrl) return null;
        const sy = p.scaleY ?? p.scale;
        const isTree = p.modelKey.startsWith("tree-");
        const isLamp = p.modelKey === "street-lamp";
        const lampScale = isLamp ? PROP_SCALE * 0.6 : p.scale;
        const lampScaleY = isLamp ? PROP_SCALE * 0.6 : sy;
        return (
          <Suspense key={i} fallback={null}>
            <GLBModel
              url={modelUrl}
              position={[p.worldX, 0, p.worldZ]}
              rotation={[0, p.rotation, 0]}
              scale={[lampScale, lampScaleY, lampScale]}
              castShadow={true}
              receiveShadow={false}
              isTreeProp={isTree}
              isLampProp={isLamp}
            />
            {isLamp && (
              <pointLight
                position={[p.worldX, 3.5, p.worldZ]}
                color="#FFEE88"
                intensity={0.8}
                distance={6}
              />
            )}
          </Suspense>
        );
      })}
    </group>
  );
}

// ---------------------------------------------------------------------------
// District Ground Pad
// ---------------------------------------------------------------------------

function DistrictPad({
  zone,
  pos,
  isHighlighted,
}: {
  zone: VisualZone;
  pos: DistrictPos;
  isHighlighted: boolean;
}) {
  const cx = pos.worldX + pos.worldW / 2;
  const cz = pos.worldZ + pos.worldD / 2;

  return (
    <group>
      <mesh position={[cx, 0.005, cz]} receiveShadow material={DISTRICT_PAD_MATERIALS[zone]}>
        <boxGeometry args={[pos.worldW + 2, 0.01, pos.worldD + 2]} />
      </mesh>
      {isHighlighted && (
        <mesh position={[cx, 0.012, cz]} rotation={[-Math.PI / 2, 0, 0]} material={HIGHLIGHT_MATERIAL}>
          <ringGeometry
            args={[
              Math.max(pos.worldW, pos.worldD) * 0.48,
              Math.max(pos.worldW, pos.worldD) * 0.5,
              4,
            ]}
          />
        </mesh>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Camera Controller
// ---------------------------------------------------------------------------

function CameraController({
  targetPosition,
  targetZoom,
  onZoomChange,
  initialSetup,
}: {
  targetPosition: React.MutableRefObject<{ x: number; z: number } | null>;
  targetZoom: React.MutableRefObject<number | null>;
  onZoomChange: (zoom: number) => void;
  initialSetup: {
    position: [number, number, number];
    target: [number, number, number];
    zoom: number;
    near: number;
    far: number;
    cityW: number;
    cityD: number;
  };
}) {
  const { camera, size } = useThree();
  const initialized = useRef(false);

  // Compute correct zoom using the actual R3F viewport size
  const computedZoom = useMemo(() => {
    const maxCity = Math.max(initialSetup.cityW, initialSetup.cityD, 1);
    const z = (size.height * 0.65) / maxCity;
    return Math.max(z, 0.5);
  }, [size.width, size.height, initialSetup.cityW, initialSetup.cityD]);

  // Apply camera setup exactly ONCE on mount — after that MapControls owns the camera
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const oc = camera as THREE.OrthographicCamera;
    oc.position.set(...initialSetup.position);
    oc.zoom = computedZoom;
    oc.near = initialSetup.near;
    oc.far = initialSetup.far;
    oc.lookAt(...initialSetup.target);
    oc.updateProjectionMatrix();
  }, [camera, initialSetup, computedZoom]);

  useFrame(() => {
    const oc = camera as THREE.OrthographicCamera;

    if (targetPosition.current) {
      const tx = targetPosition.current.x;
      const tz = targetPosition.current.z;
      const speed = 0.08;
      const offsetD = Math.max(
        10,
        initialSetup.position[0] - initialSetup.target[0]
      );
      oc.position.x += (tx + offsetD - oc.position.x) * speed;
      oc.position.z += (tz + offsetD - oc.position.z) * speed;

      const dist =
        Math.abs(oc.position.x - (tx + offsetD)) +
        Math.abs(oc.position.z - (tz + offsetD));
      if (dist < 0.5) {
        targetPosition.current = null;
      }
    }

    if (targetZoom.current !== null) {
      const diff = targetZoom.current - oc.zoom;
      if (Math.abs(diff) < 0.01) {
        oc.zoom = targetZoom.current;
        targetZoom.current = null;
      } else {
        oc.zoom += diff * 0.1;
      }
      oc.updateProjectionMatrix();
    }

    onZoomChange(oc.zoom);
  });

  return null;
}

// ---------------------------------------------------------------------------
// Visible Count Tracker
// ---------------------------------------------------------------------------

function VisibleCountTracker({
  layout,
  onVisibleCountChange,
}: {
  layout: CityLayout;
  onVisibleCountChange?: (visible: number, total: number) => void;
}) {
  useFrame(() => {
    if (!onVisibleCountChange) return;
    let total = 0;
    let visible = 0;
    layout.districts?.forEach((d) => {
      d.buildings.forEach(() => {
        total++;
        visible++;
      });
    });
    onVisibleCountChange(visible, total);
  });

  return null;
}

// ---------------------------------------------------------------------------
// Material Initializer — re-creates materials after WebGL context is available
// ---------------------------------------------------------------------------

function MaterialInitializer() {
  const { gl } = useThree();
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    Object.assign(SHARED_MATERIALS, createSharedMaterials());
    Object.assign(STATUS_MATERIALS, createStatusMaterials());
  }, [gl]);
  return null;
}

// ---------------------------------------------------------------------------
// Main Scene
// ---------------------------------------------------------------------------

function CityScene({
  layout,
  agents,
  activeBuildings,
  activeBuildingColors,
  selectedBuildingId,
  onSelectBuilding,
  highlightDistrictId,
  flashedBuildings,
  npcThoughts,
  onVisibleCountChange,
  isDragging,
  onHoverBuilding,
  onUnhoverBuilding,
  targetPosition,
  targetZoom,
  onZoomChange,
}: CityMapProps & {
  isDragging: React.MutableRefObject<boolean>;
  onHoverBuilding: (b: Building) => void;
  onUnhoverBuilding: () => void;
  targetPosition: React.MutableRefObject<{ x: number; z: number } | null>;
  targetZoom: React.MutableRefObject<number | null>;
  onZoomChange: (zoom: number) => void;
}) {
  const [zoom, setZoomState] = useState(1);
  const lod = getLOD(zoom);

  const handleZoomChange = useCallback(
    (z: number) => {
      setZoomState(z);
      onZoomChange(z);
    },
    [onZoomChange]
  );

  const districtPositions = useMemo(
    () => reflowDistrictsToGrid(layout.districts || []),
    [layout.districts]
  );

  const cityBounds = useMemo(
    () => computeCityBounds(districtPositions),
    [districtPositions]
  );

  const initialSetup = useMemo(
    () => computeInitialCameraSetup(districtPositions),
    [districtPositions]
  );

  const shadowSize = useMemo(
    () => getShadowCameraSize(cityBounds),
    [cityBounds]
  );

  const allPlacedBuildings = useMemo(() => {
    const result: PlacedBuilding[] = [];
    for (const district of layout.districts || []) {
      const pos = districtPositions.get(district.id);
      if (!pos) continue;
      const zone = getVisualZone(district);
      result.push(...placeBuildings(district, pos, zone));
    }
    return result;
  }, [layout.districts, districtPositions]);

  const buildingPositionMap = useMemo(() => {
    const map = new Map<string, PlacedBuilding>();
    for (const pb of allPlacedBuildings) {
      map.set(pb.building.id, pb);
    }
    return map;
  }, [allPlacedBuildings]);

  const roadTiles = useMemo(
    () => generateRoadNetwork(districtPositions),
    [districtPositions]
  );

  const allProps = useMemo(
    () =>
      placeAllProps(
        layout.districts || [],
        districtPositions,
        allPlacedBuildings,
        roadTiles
      ),
    [layout.districts, districtPositions, allPlacedBuildings, roadTiles]
  );

  const fallbackActiveBuildingColors = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents) {
      const buildingId =
        agent.currentBuilding ??
        (agent as Agent & { currentBuildingId?: string | null })
          .currentBuildingId ??
        null;
      if (agent.status !== "working" || !buildingId || map.has(buildingId))
        continue;
      map.set(buildingId, agent.color || "#00fff7");
    }
    return map;
  }, [agents]);

  const resolvedColors =
    activeBuildingColors && activeBuildingColors.size > 0
      ? activeBuildingColors
      : fallbackActiveBuildingColors;

  const connectedBuildingIds = useMemo(() => {
    if (!selectedBuildingId) return new Set<string>();
    const ids = new Set<string>();
    layout.roads?.forEach((road) => {
      if (road.fromBuilding === selectedBuildingId) ids.add(road.toBuilding);
      if (road.toBuilding === selectedBuildingId)
        ids.add(road.fromBuilding);
    });
    return ids;
  }, [selectedBuildingId, layout.roads]);

  const seasonKey = (layout.season as string) || "summer";

  const groundW = cityBounds.totalW + 20;
  const groundD = cityBounds.totalD + 20;

  return (
    <>
      <MaterialInitializer />
      {/* Blue sky background — NO fog */}
      <color attach="background" args={["#87CEEB"]} />

      <Sky
        distance={450000}
        sunPosition={[1, 0.4, 0.8]}
        inclination={0}
        azimuth={0.25}
        rayleigh={0.05}
      />

      <ambientLight
        intensity={0.6}
        color={SEASON_AMBIENT[seasonKey] || SEASON_AMBIENT.summer}
      />

      <directionalLight
        position={[
          cityBounds.centerX + shadowSize,
          shadowSize * 1.2,
          cityBounds.centerZ + shadowSize * 0.4,
        ]}
        intensity={1.4}
        color="#FFF5E0"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={shadowSize * 6}
        shadow-camera-left={-shadowSize}
        shadow-camera-right={shadowSize}
        shadow-camera-top={shadowSize}
        shadow-camera-bottom={-shadowSize}
        shadow-bias={-0.0005}
      />
      <hemisphereLight color="#87CEEB" groundColor="#3A7A3A" intensity={0.4} />

      {/* Ground plane */}
      <mesh
        position={[cityBounds.centerX, -0.05, cityBounds.centerZ]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        material={SHARED_MATERIALS.ground}
      >
        <planeGeometry args={[groundW, groundD]} />
      </mesh>

      {/* District pads + buildings */}
      {(layout.districts || []).map((district) => {
        const zone = getVisualZone(district);
        const pos = districtPositions.get(district.id);
        if (!pos) return null;
        const isHighlighted = highlightDistrictId === district.id;

        return (
          <group key={district.id}>
            <DistrictPad
              zone={zone}
              pos={pos}
              isHighlighted={isHighlighted}
            />

            {district.buildings.map((building, bIdx) => {
              const placed = buildingPositionMap.get(building.id);
              if (!placed) return null;
              const isSelected = selectedBuildingId === building.id;
              const isConnected = connectedBuildingIds.has(building.id);
              const isDimmedB =
                !!selectedBuildingId && !isSelected && !isConnected;
              const isFlashing =
                flashedBuildings?.has(building.id) ?? false;
              const isActive = activeBuildings.has(building.id);
              const activeColor =
                resolvedColors.get(building.id) || "#00fff7";

              return (
                <BuildingMesh
                  key={building.id}
                  building={building}
                  worldX={placed.worldX}
                  worldZ={placed.worldZ}
                  zone={zone}
                  lod={lod}
                  isSelected={isSelected}
                  isConnected={isConnected}
                  isDimmed={isDimmedB}
                  isFlashing={isFlashing}
                  isActive={isActive}
                  activeColor={activeColor}
                  isDragging={isDragging}
                  onSelectBuilding={onSelectBuilding}
                  onHover={onHoverBuilding}
                  onUnhover={onUnhoverBuilding}
                  buildingIndex={bIdx}
                />
              );
            })}
          </group>
        );
      })}

      <RoadNetwork tiles={roadTiles} lod={lod} />
      <PropsRenderer props={allProps} lod={lod} />

      {(agents || []).map((agent) => (
        <AgentNPC
          key={agent.id}
          agent={agent}
          roadTiles={roadTiles}
          districtPositions={districtPositions}
          districts={layout.districts || []}
          lod={lod}
          thought={npcThoughts?.get(agent.id)}
        />
      ))}

      <SeasonParticles season={seasonKey} cityBounds={cityBounds} />

      <CameraController
        targetPosition={targetPosition}
        targetZoom={targetZoom}
        onZoomChange={handleZoomChange}
        initialSetup={initialSetup}
      />

      <VisibleCountTracker
        layout={layout}
        onVisibleCountChange={onVisibleCountChange}
      />

      <MapControls
        enableRotate={false}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        makeDefault
        target={initialSetup.target}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Exported CityMap Component
// ---------------------------------------------------------------------------

export function CityMap({
  layout,
  agents,
  activeBuildings,
  activeBuildingColors,
  selectedBuildingId,
  onSelectBuilding,
  highlightDistrictId,
  flashedBuildings,
  npcThoughts,
  onVisibleCountChange,
}: CityMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const [hoveredBuilding, setHoveredBuilding] = useState<Building | null>(
    null
  );
  const hideTooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showMinimap, setShowMinimap] = useState(true);
  const [currentZoom, setCurrentZoom] = useState(1);

  const targetPosition = useRef<{ x: number; z: number } | null>(null);
  const targetZoom = useRef<number | null>(null);

  const districtPositions = useMemo(
    () => reflowDistrictsToGrid(layout.districts || []),
    [layout.districts]
  );

  const cityBounds = useMemo(
    () => computeCityBounds(districtPositions),
    [districtPositions]
  );

  const initialSetup = useMemo(
    () => computeInitialCameraSetup(districtPositions),
    [districtPositions]
  );

  const seasonKey = ((layout.season as string) || "summer") as keyof typeof SEASON_BGS;
  const seasonBackground = SEASON_BGS[seasonKey] || SEASON_BGS.summer;

  const lod = getLOD(currentZoom);
  const isLowLod = lod === "mini" || lod === "low";
  const isHighLod = lod === "full";

  const onHoverBuilding = useCallback((b: Building) => {
    if (hideTooltipTimer.current) clearTimeout(hideTooltipTimer.current);
    setHoveredBuilding(b);
  }, []);

  const onUnhoverBuilding = useCallback(() => {
    hideTooltipTimer.current = setTimeout(
      () => setHoveredBuilding(null),
      200
    );
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    isDragging.current = false;
    dragStart.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) isDragging.current = true;
  }, []);

  const handlePointerUp = useCallback(() => {
    dragStart.current = null;
  }, []);

  const handleZoomIn = useCallback(() => {
    targetZoom.current = Math.min(MAX_ZOOM, currentZoom * 1.4);
  }, [currentZoom]);

  const handleZoomOut = useCallback(() => {
    targetZoom.current = Math.max(MIN_ZOOM, currentZoom * 0.7);
  }, [currentZoom]);

  const handleFit = useCallback(() => {
    // Compute fit zoom from container size (same formula as CameraController)
    const h = containerRef.current?.clientHeight ?? window.innerHeight;
    const maxCity = Math.max(initialSetup.cityW, initialSetup.cityD, 1);
    targetZoom.current = Math.max((h * 0.65) / maxCity, 0.5);
    targetPosition.current = {
      x: initialSetup.target[0],
      z: initialSetup.target[2],
    };
  }, [initialSetup]);

  const handleDistrictClick = useCallback(
    (district: District) => {
      const pos = districtPositions.get(district.id);
      if (pos) {
        targetPosition.current = {
          x: pos.worldX + pos.worldW / 2,
          z: pos.worldZ + pos.worldD / 2,
        };
        targetZoom.current = 2;
      }
      if (district.buildings?.[0]?.id) {
        onSelectBuilding(district.buildings[0].id);
      }
    },
    [districtPositions, onSelectBuilding]
  );

  const onZoomChange = useCallback((z: number) => {
    setCurrentZoom(z);
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative overflow-hidden bg-background transition-colors duration-1000"
      style={{ backgroundColor: seasonBackground }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <Canvas
        orthographic
        camera={{
          position: initialSetup.position,
          zoom: initialSetup.zoom,
          near: initialSetup.near,
          far: initialSetup.far,
        }}
        shadows={{ type: THREE.PCFShadowMap }}
        gl={{ antialias: true }}
        style={{ width: "100%", height: "100%" }}
      >
        <Suspense fallback={null}>
          <CityScene
            layout={layout}
            agents={agents}
            activeBuildings={activeBuildings}
            activeBuildingColors={activeBuildingColors}
            selectedBuildingId={selectedBuildingId}
            onSelectBuilding={onSelectBuilding}
            highlightDistrictId={highlightDistrictId}
            flashedBuildings={flashedBuildings}
            npcThoughts={npcThoughts}
            onVisibleCountChange={onVisibleCountChange}
            isDragging={isDragging}
            onHoverBuilding={onHoverBuilding}
            onUnhoverBuilding={onUnhoverBuilding}
            targetPosition={targetPosition}
            targetZoom={targetZoom}
            onZoomChange={onZoomChange}
          />
        </Suspense>
      </Canvas>

      {/* Zoom controls */}
      <div className="absolute top-4 left-4 z-20 flex flex-col gap-1">
        <button
          onClick={handleZoomIn}
          className="w-8 h-8 glass-panel border border-primary/30 rounded text-primary font-mono text-lg hover:bg-primary/10 transition-colors flex items-center justify-center"
        >
          +
        </button>
        <button
          onClick={handleFit}
          className="w-8 h-8 glass-panel border border-primary/30 rounded text-primary font-mono text-[10px] hover:bg-primary/10 transition-colors flex items-center justify-center"
        >
          fit
        </button>
        <button
          onClick={handleZoomOut}
          className="w-8 h-8 glass-panel border border-primary/30 rounded text-primary font-mono text-lg hover:bg-primary/10 transition-colors flex items-center justify-center"
        >
          −
        </button>
      </div>

      {/* Hover Tooltip */}
      {hoveredBuilding && !isLowLod && (
        <div
          className="absolute pointer-events-none glass-panel p-3 rounded border border-primary z-50"
          style={{ left: "50%", top: "20px", transform: "translateX(-50%)" }}
        >
          <div className="font-mono font-bold text-primary">
            {hoveredBuilding.name}
          </div>
          <div className="text-xs text-muted-foreground">
            {hoveredBuilding.filePath}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <span className="text-foreground">Type:</span>
            <span style={{ color: TYPE_COLORS[hoveredBuilding.fileType] }}>
              {hoveredBuilding.fileType}
            </span>
            <span className="text-foreground">LOC:</span>
            <span className="text-primary">
              {hoveredBuilding.linesOfCode}
            </span>
            <span className="text-foreground">Coverage:</span>
            <span
              className={
                hoveredBuilding.testCoverage > 0.8
                  ? "text-green-400"
                  : "text-red-400"
              }
            >
              {Math.round(hoveredBuilding.testCoverage * 100)}%
            </span>
          </div>
        </div>
      )}

      {/* Dependency Legend */}
      {selectedBuildingId && !isLowLod && (
        <div className="absolute bottom-4 left-16 glass-panel p-3 rounded-lg border border-primary/30 z-20 text-xs font-mono space-y-1.5">
          <div className="text-muted-foreground uppercase tracking-wider text-[10px] mb-2">
            Dependency Links
          </div>
          <div className="flex items-center gap-2">
            <span className="w-6 h-0.5 bg-green-400 block" />
            <span className="text-foreground">Import</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-6 h-0.5 bg-yellow-400 block" />
            <span className="text-foreground">High Coupling</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-6 h-0.5 bg-red-400 block" />
            <span className="text-foreground">Circular</span>
          </div>
        </div>
      )}

      {/* Zoom indicator */}
      <div className="absolute bottom-4 left-4 text-[10px] font-mono text-muted-foreground/50 pointer-events-none">
        {Math.round(currentZoom * 100)}%{" "}
        {isLowLod ? "· overview" : isHighLod ? "· detailed" : ""}
      </div>

      {/* Minimap */}
      {showMinimap && layout.districts && layout.districts.length > 0 && (
        <div className="absolute bottom-4 right-4 z-20 glass-panel rounded-lg border border-primary/30 overflow-hidden">
          <div
            className="flex items-center justify-between px-2 py-1 border-b border-primary/20 cursor-pointer"
            onClick={() => setShowMinimap(false)}
          >
            <span className="text-[10px] font-mono text-primary uppercase tracking-widest">
              Districts
            </span>
            <span className="text-[10px] text-muted-foreground">×</span>
          </div>
          <div className="p-1.5 max-h-48 overflow-y-auto space-y-1">
            {layout.districts.map((d) => (
              <button
                key={d.id}
                className="w-full text-left px-2 py-1 rounded text-[11px] font-mono hover:bg-primary/10 flex items-center justify-between gap-3 transition-colors"
                onClick={() => handleDistrictClick(d)}
              >
                <span
                  className="truncate text-foreground"
                  style={{
                    color:
                      DISTRICT_COLORS[d.type]
                        ?.replace("rgba(", "")
                        .replace(",0.1)", "") || "#888",
                  }}
                >
                  /{d.name}
                </span>
                <span className="text-muted-foreground shrink-0">
                  {d.buildings?.length ?? 0}b
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {!showMinimap && (
        <button
          className="absolute bottom-4 right-4 z-20 glass-panel px-3 py-1.5 rounded-lg border border-primary/30 text-[10px] font-mono text-primary uppercase tracking-widest hover:bg-primary/10"
          onClick={() => setShowMinimap(true)}
        >
          Map
        </button>
      )}
    </div>
  );
}

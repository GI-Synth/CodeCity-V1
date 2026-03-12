import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { CityLayout, Agent, Building, District } from "@workspace/api-client-react";

interface CityMapProps {
  layout: CityLayout;
  agents: Agent[];
  selectedBuildingId: string | null;
  onSelectBuilding: (id: string) => void;
  highlightDistrictId?: string | null;
}

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

const SEASON_BGS = {
  summer: "#0a0e1a",
  spring: "#0a1515",
  autumn: "#1a100a",
  winter: "#151515",
};

const AGENT_TASK_ICONS: Record<string, string> = {
  analyze_bug: "🔥",
  generate_tests: "🔬",
  fuzz_test: "🧪",
  api_test: "🌐",
  load_test: "📊",
  working: "⚙️",
  idle: "",
  escalating: "⚠️",
};

function getRoadColor(road: any, isHighlighted: boolean, selectedBuildingId: string | null): { stroke: string; width: number } {
  if (!isHighlighted) return { stroke: "rgba(0, 255, 247, 0.12)", width: 1.5 };
  if (road.type === "circular") return { stroke: "#ff3333", width: 4 };
  if (road.coupling === "high") return { stroke: "#ffcc00", width: 3.5 };
  return { stroke: "#00ff88", width: 3 };
}

export function CityMap({ layout, agents, selectedBuildingId, onSelectBuilding, highlightDistrictId }: CityMapProps) {
  const bounds = useMemo(() => {
    if (!layout.districts || layout.districts.length === 0) {
      return { minX: 0, minY: 0, width: 1000, height: 1000 };
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    layout.districts.forEach(d => {
      if (d.x < minX) minX = d.x;
      if (d.y < minY) minY = d.y;
      if (d.x + d.width > maxX) maxX = d.x + d.width;
      if (d.y + d.height > maxY) maxY = d.y + d.height;
    });
    const padding = 100;
    return {
      minX: minX - padding,
      minY: minY - padding,
      width: (maxX - minX) + padding * 2,
      height: (maxY - minY) + padding * 2
    };
  }, [layout]);

  const [hoveredBuilding, setHoveredBuilding] = useState<Building | null>(null);
  const [showMinimap, setShowMinimap] = useState(true);

  const allBuildings = useMemo(() => {
    const map = new Map<string, Building>();
    layout.districts?.forEach(d => d.buildings.forEach(b => map.set(b.id, b)));
    return map;
  }, [layout]);

  const connectedBuildingIds = useMemo(() => {
    if (!selectedBuildingId) return new Set<string>();
    const ids = new Set<string>();
    layout.roads?.forEach(road => {
      if (road.fromBuilding === selectedBuildingId) ids.add(road.toBuilding);
      if (road.toBuilding === selectedBuildingId) ids.add(road.fromBuilding);
    });
    return ids;
  }, [selectedBuildingId, layout.roads]);

  return (
    <div
      className="w-full h-full relative overflow-hidden bg-background transition-colors duration-1000"
      style={{ backgroundColor: SEASON_BGS[(layout.season as keyof typeof SEASON_BGS) || 'summer'] }}
    >
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(to right, #00fff7 1px, transparent 1px), linear-gradient(to bottom, #00fff7 1px, transparent 1px)`,
          backgroundSize: '40px 40px'
        }}
      />

      <svg
        className="w-full h-full cursor-grab active:cursor-grabbing"
        viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Roads */}
        <g className="roads">
          {layout.roads?.map(road => {
            const from = allBuildings.get(road.fromBuilding);
            const to = allBuildings.get(road.toBuilding);
            if (!from || !to) return null;
            const isHighlighted = selectedBuildingId === from.id || selectedBuildingId === to.id;
            const { stroke, width } = getRoadColor(road, isHighlighted, selectedBuildingId);
            return (
              <line
                key={road.id}
                x1={from.x + from.width / 2}
                y1={from.y + from.height / 2}
                x2={to.x + to.width / 2}
                y2={to.y + to.height / 2}
                stroke={stroke}
                strokeWidth={width}
                strokeDasharray={road.type === 'import' ? "none" : "5,5"}
                className="transition-all duration-300"
                opacity={selectedBuildingId && !isHighlighted ? 0.3 : 1}
              />
            );
          })}
        </g>

        {/* Districts and Buildings */}
        {layout.districts?.map(district => {
          const isHighlightedDistrict = highlightDistrictId === district.id;
          return (
            <g key={district.id} className="district">
              <rect
                x={district.x}
                y={district.y}
                width={district.width}
                height={district.height}
                fill={DISTRICT_COLORS[district.type] || "rgba(255,255,255,0.05)"}
                stroke={isHighlightedDistrict ? "rgba(0,255,247,0.9)" : "rgba(0, 255, 247, 0.3)"}
                strokeWidth={isHighlightedDistrict ? 3 : 2}
                rx="8"
                className="transition-all duration-500"
              />
              <text
                x={district.x + 10}
                y={district.y + 20}
                fill="rgba(0, 255, 247, 0.6)"
                fontFamily="JetBrains Mono"
                fontSize="16"
                fontWeight="bold"
                className="uppercase tracking-widest pointer-events-none"
              >
                /{district.name}
              </text>

              {district.buildings?.map(building => {
                const color = TYPE_COLORS[building.fileType] || TYPE_COLORS.unknown;
                const isSelected = selectedBuildingId === building.id;
                const isConnected = connectedBuildingIds.has(building.id);
                const isDimmed = selectedBuildingId && !isSelected && !isConnected;
                let opacity = 1;
                if (building.age === 'aged') opacity = 0.75;
                if (building.age === 'ancient') opacity = 0.45;
                if (isDimmed) opacity = Math.min(opacity, 0.3);

                return (
                  <g
                    key={building.id}
                    transform={`translate(${building.x}, ${building.y})`}
                    onClick={() => onSelectBuilding(building.id)}
                    onMouseEnter={() => setHoveredBuilding(building)}
                    onMouseLeave={() => setHoveredBuilding(null)}
                    className="cursor-pointer"
                    style={{ transition: "opacity 0.3s" }}
                    opacity={opacity}
                  >
                    {(isSelected || building.status === 'glowing') && (
                      <rect
                        x="-6" y="-6"
                        width={building.width + 12}
                        height={building.height + 12}
                        fill="none"
                        stroke={color}
                        strokeWidth="3"
                        filter="url(#glow)"
                        className="animate-pulse"
                      />
                    )}
                    {isConnected && !isSelected && (
                      <rect
                        x="-3" y="-3"
                        width={building.width + 6}
                        height={building.height + 6}
                        fill="none"
                        stroke="rgba(0,255,136,0.7)"
                        strokeWidth="2"
                        rx="6"
                      />
                    )}
                    <rect
                      width={building.width}
                      height={building.height}
                      fill={color}
                      fillOpacity={1}
                      stroke={isSelected ? "#fff" : "rgba(0,0,0,0.5)"}
                      strokeWidth={isSelected ? 3 : 1}
                      rx="4"
                    />
                    <rect
                      x="2" y="2"
                      width={building.width - 4}
                      height={building.height - 4}
                      fill="transparent"
                      stroke="rgba(0,0,0,0.3)"
                      strokeWidth="1"
                      strokeDasharray="2 2"
                    />
                    <g transform={`translate(${building.width / 2}, ${building.height / 2})`} className="pointer-events-none">
                      {building.activeEvent === 'fire' && <text x="-12" y="8" fontSize="22" className="animate-bounce">🔥</text>}
                      {building.activeEvent === 'sparkle' && <text x="-12" y="8" fontSize="22" className="animate-pulse">✨</text>}
                      {building.activeEvent === 'alarm' && <text x="-12" y="8" fontSize="22" className="animate-pulse">🚨</text>}
                      {building.activeEvent === 'flood' && <text x="-12" y="8" fontSize="22">🌊</text>}
                      {building.activeEvent === 'smoke' && <text x="-12" y="8" fontSize="22">💨</text>}
                      {!building.activeEvent && building.status === 'error' && <text x="-12" y="8" fontSize="22">❌</text>}
                    </g>
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* Agents */}
        <AnimatePresence>
          {agents?.map(agent => {
            const taskIcon = AGENT_TASK_ICONS[agent.currentTask as string] || AGENT_TASK_ICONS[agent.status] || "";
            return (
              <motion.g
                key={agent.id}
                initial={false}
                animate={{ x: agent.x, y: agent.y }}
                transition={{ type: "spring", stiffness: 50, damping: 10 }}
                className="pointer-events-none"
              >
                {agent.status === 'working' && (
                  <circle r="14" fill="none" stroke={agent.color} strokeWidth="1" opacity="0.4" className="animate-ping" />
                )}
                <circle r="8" fill={agent.color} opacity="0.6" className="animate-ping" />
                <circle r="6" fill={agent.color} stroke="#fff" strokeWidth="2" />
                <text y="-14" textAnchor="middle" fill="#fff" fontSize="11" fontFamily="JetBrains Mono" className="drop-shadow-md">
                  {agent.name}
                </text>
                {taskIcon && (
                  <text y="-26" textAnchor="middle" fontSize="14">
                    {taskIcon}
                  </text>
                )}
              </motion.g>
            );
          })}
        </AnimatePresence>

        <defs>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
      </svg>

      {/* Hover Tooltip */}
      {hoveredBuilding && (
        <div
          className="absolute pointer-events-none glass-panel p-3 rounded border border-primary z-50"
          style={{ left: '50%', top: '20px', transform: 'translateX(-50%)' }}
        >
          <div className="font-mono font-bold text-primary">{hoveredBuilding.name}</div>
          <div className="text-xs text-muted-foreground">{hoveredBuilding.filePath}</div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <span className="text-foreground">Type:</span>
            <span style={{ color: TYPE_COLORS[hoveredBuilding.fileType] }}>{hoveredBuilding.fileType}</span>
            <span className="text-foreground">LOC:</span>
            <span className="text-primary">{hoveredBuilding.linesOfCode}</span>
            <span className="text-foreground">Coverage:</span>
            <span className={hoveredBuilding.testCoverage > 0.8 ? "text-green-400" : "text-red-400"}>
              {Math.round(hoveredBuilding.testCoverage * 100)}%
            </span>
          </div>
        </div>
      )}

      {/* Dependency Legend (only when a building is selected) */}
      {selectedBuildingId && (
        <div className="absolute bottom-4 left-4 glass-panel p-3 rounded-lg border border-primary/30 z-20 text-xs font-mono space-y-1.5">
          <div className="text-muted-foreground uppercase tracking-wider text-[10px] mb-2">Dependency Links</div>
          <div className="flex items-center gap-2"><span className="w-6 h-0.5 bg-green-400 block"/><span className="text-foreground">Import</span></div>
          <div className="flex items-center gap-2"><span className="w-6 h-0.5 bg-yellow-400 block"/><span className="text-foreground">High Coupling</span></div>
          <div className="flex items-center gap-2"><span className="w-6 h-0.5 bg-red-400 block"/><span className="text-foreground">Circular</span></div>
        </div>
      )}

      {/* Minimap */}
      {showMinimap && layout.districts && layout.districts.length > 0 && (
        <div className="absolute bottom-4 right-4 z-20 glass-panel rounded-lg border border-primary/30 overflow-hidden">
          <div
            className="flex items-center justify-between px-2 py-1 border-b border-primary/20 cursor-pointer"
            onClick={() => setShowMinimap(false)}
          >
            <span className="text-[10px] font-mono text-primary uppercase tracking-widest">Districts</span>
            <span className="text-[10px] text-muted-foreground">×</span>
          </div>
          <div className="p-1.5 max-h-48 overflow-y-auto space-y-1">
            {layout.districts.map(d => (
              <button
                key={d.id}
                className="w-full text-left px-2 py-1 rounded text-[11px] font-mono hover:bg-primary/10 flex items-center justify-between gap-3 transition-colors"
                onClick={() => onSelectBuilding(d.buildings?.[0]?.id ?? "")}
              >
                <span
                  className="truncate text-foreground"
                  style={{ color: DISTRICT_COLORS[d.type]?.replace("rgba(", "").replace(",0.1)", "") || "#888" }}
                >
                  /{d.name}
                </span>
                <span className="text-muted-foreground shrink-0">{d.buildings?.length ?? 0}b</span>
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

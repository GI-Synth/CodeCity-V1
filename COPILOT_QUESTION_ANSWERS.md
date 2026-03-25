# Copilot/Codex Answers

Date: 2026-03-16

## Questions 1-4 (Renderer and Runtime)

### 1) Current rendering technology and full CityMap.tsx

Answer: The current city renderer is React + SVG. Evidence includes SVG element usage and SVG export logic in the frontend.

CityMap.tsx (full):

~~~tsx
import { useMemo, useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { CityLayout, Agent, Building } from "@workspace/api-client-react";

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

function getBuildingColor(building: Building): string {
  if (building.status === "fire") return "#ff3b1f";
  if (building.status === "error") return "#ff7a1a";
  if (building.status === "warning") return "#ffb020";
  if (building.status === "dark") return "#5a6370";
  return TYPE_COLORS[building.fileType] || TYPE_COLORS.unknown;
}

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

const SEASON_TINTS: Record<string, string> = {
  summer: "rgb(126 190 118)",
  spring: "rgb(142 214 150)",
  autumn: "rgb(214 145 84)",
  winter: "rgb(118 158 207)",
};

const SEASON_PARTICLES: Record<string, { emoji: string; count: number }> = {
  winter: { emoji: "❄", count: 12 },
  autumn: { emoji: "🍂", count: 8 },
  spring: { emoji: "🌸", count: 6 },
  summer: { emoji: "", count: 0 },
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

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const LOD_LOW = 0.4;
const LOD_HIGH = 1.5;

function getRoadColor(road: any, isHighlighted: boolean): { stroke: string; width: number } {
  if (!isHighlighted) return { stroke: "rgba(0, 255, 247, 0.12)", width: 1.5 };
  if (road.type === "circular") return { stroke: "#ff3333", width: 4 };
  if (road.coupling === "high") return { stroke: "#ffcc00", width: 3.5 };
  return { stroke: "#00ff88", width: 3 };
}

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
  const svgRef = useRef<SVGSVGElement>(null);
  const isDragging = useRef(false);
  const dragStart = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);

  const bounds = useMemo(() => {
    if (!layout.districts || layout.districts.length === 0) {
      return { minX: 0, minY: 0, width: 1000, height: 1000, cx: 500, cy: 500 };
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    layout.districts.forEach(d => {
      if (d.x < minX) minX = d.x;
      if (d.y < minY) minY = d.y;
      if (d.x + d.width > maxX) maxX = d.x + d.width;
      if (d.y + d.height > maxY) maxY = d.y + d.height;
    });
    const padding = 100;
    const w = (maxX - minX) + padding * 2;
    const h = (maxY - minY) + padding * 2;
    return {
      minX: minX - padding,
      minY: minY - padding,
      width: w,
      height: h,
      cx: minX - padding + w / 2,
      cy: minY - padding + h / 2,
    };
  }, [layout]);

  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: bounds.cx, y: bounds.cy });
  const [hoveredBuilding, setHoveredBuilding] = useState<Building | null>(null);
  const hideTooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showMinimap, setShowMinimap] = useState(true);

  const fallbackActiveBuildingColors = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents) {
      const buildingId =
        agent.currentBuilding ??
        (agent as Agent & { currentBuildingId?: string | null }).currentBuildingId ??
        null;
      if (agent.status !== "working" || !buildingId || map.has(buildingId)) continue;
      map.set(buildingId, agent.color || "#00fff7");
    }
    return map;
  }, [agents]);

  const resolvedActiveBuildingColors = activeBuildingColors && activeBuildingColors.size > 0
    ? activeBuildingColors
    : fallbackActiveBuildingColors;

  const seasonKey = ((layout.season as keyof typeof SEASON_BGS) || "summer") as keyof typeof SEASON_BGS;
  const seasonBackground = SEASON_BGS[seasonKey] || SEASON_BGS.summer;
  const seasonTint = SEASON_TINTS[seasonKey] || SEASON_TINTS.summer;

  useEffect(() => {
    setCenter({ x: bounds.cx, y: bounds.cy });
    setZoom(1);
  }, [bounds.cx, bounds.cy]);

  const viewW = bounds.width / zoom;
  const viewH = bounds.height / zoom;
  const viewBox = `${center.x - viewW / 2} ${center.y - viewH / 2} ${viewW} ${viewH}`;

  const vLeft = center.x - viewW / 2;
  const vRight = center.x + viewW / 2;
  const vTop = center.y - viewH / 2;
  const vBottom = center.y + viewH / 2;

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

  const isBuildingVisible = useCallback((b: Building) =>
    b.x + b.width > vLeft && b.x < vRight && b.y + b.height > vTop && b.y < vBottom,
  [vLeft, vRight, vTop, vBottom]);

  const totalBuildings = useMemo(() =>
    layout.districts?.reduce((s, d) => s + d.buildings.length, 0) ?? 0,
  [layout.districts]);

  const visibleBuildings = useMemo(() =>
    layout.districts?.reduce((s, d) => s + d.buildings.filter(isBuildingVisible).length, 0) ?? 0,
  [layout.districts, isBuildingVisible]);

  useEffect(() => {
    onVisibleCountChange?.(visibleBuildings, totalBuildings);
  }, [visibleBuildings, totalBuildings, onVisibleCountChange]);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const svgX = center.x - viewW / 2 + (mouseX / rect.width) * viewW;
    const svgY = center.y - viewH / 2 + (mouseY / rect.height) * viewH;

    const delta = e.deltaY > 0 ? 0.85 : 1.18;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * delta));

    const newViewW = bounds.width / newZoom;
    const newViewH = bounds.height / newZoom;
    const fracX = mouseX / rect.width;
    const fracY = mouseY / rect.height;
    const newCx = svgX - (fracX - 0.5) * newViewW;
    const newCy = svgY - (fracY - 0.5) * newViewH;

    setZoom(newZoom);
    setCenter({ x: newCx, y: newCy });
  }, [zoom, center, viewW, viewH, bounds]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const svgToClient = useCallback((svgX: number, svgY: number) => {
    const el = containerRef.current;
    if (!el) return { cx: 0, cy: 0 };
    const rect = el.getBoundingClientRect();
    return {
      cx: ((svgX - (center.x - viewW / 2)) / viewW) * rect.width,
      cy: ((svgY - (center.y - viewH / 2)) / viewH) * rect.height,
    };
  }, [center, viewW, viewH]);

  const handlePointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    isDragging.current = false;
    dragStart.current = { x: e.clientX, y: e.clientY, cx: center.x, cy: center.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }, [center]);

  const handlePointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) isDragging.current = true;
    if (!isDragging.current) return;

    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const dsvgX = (dx / rect.width) * viewW;
    const dsvgY = (dy / rect.height) * viewH;

    setCenter({
      x: dragStart.current.cx - dsvgX,
      y: dragStart.current.cy - dsvgY,
    });
  }, [viewW, viewH]);

  const handlePointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    dragStart.current = null;
  }, []);

  const isLowLod = zoom < LOD_LOW;
  const isHighLod = zoom > LOD_HIGH;

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative overflow-hidden bg-background transition-colors duration-1000"
      style={{
        backgroundColor: seasonBackground,
        "--season-tint": seasonTint,
      } as React.CSSProperties & { "--season-tint": string }}
    >
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(to right, #00fff7 1px, transparent 1px), linear-gradient(to bottom, #00fff7 1px, transparent 1px)`,
          backgroundSize: '40px 40px'
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "var(--season-tint)",
          opacity: 0.06,
          transition: "background 2s ease",
        }}
      />

      <svg
        ref={svgRef}
        data-city-map=""
        className={`w-full h-full ${isDragging.current ? "cursor-grabbing" : "cursor-grab"}`}
        viewBox={viewBox}
        preserveAspectRatio="none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* Roads — culled: only when both buildings are visible or selected */}
        {!isLowLod && (
          <g className="roads">
            {layout.roads?.map(road => {
              const from = allBuildings.get(road.fromBuilding);
              const to = allBuildings.get(road.toBuilding);
              if (!from || !to) return null;
              const fromVisible = isBuildingVisible(from);
              const toVisible = isBuildingVisible(to);
              if (!fromVisible && !toVisible) return null;
              const isHighlighted = selectedBuildingId === from.id || selectedBuildingId === to.id;
              const { stroke, width } = getRoadColor(road, isHighlighted);
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
        )}

        {/* Districts and Buildings */}
        {layout.districts?.map(district => {
          const districtVisible =
            district.x + district.width > vLeft && district.x < vRight &&
            district.y + district.height > vTop && district.y < vBottom;
          if (!districtVisible) return null;

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
              {!isLowLod && (
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
              )}

              {district.buildings?.map(building => {
                if (!isBuildingVisible(building)) return null;

                const color = getBuildingColor(building);
                const isSelected = selectedBuildingId === building.id;
                const isConnected = connectedBuildingIds.has(building.id);
                const isDimmed = selectedBuildingId && !isSelected && !isConnected;
                let opacity = 1;
                if (building.age === 'aged') opacity = 0.75;
                if (building.age === 'ancient') opacity = 0.45;
                if (isDimmed) opacity = Math.min(opacity, 0.3);

                const isFlashing = flashedBuildings?.has(building.id) ?? false;
                const isActiveBuilding = activeBuildings.has(building.id);
                const activeBuildingColor = resolvedActiveBuildingColors.get(building.id) || "#00fff7";

                if (isLowLod) {
                  return (
                    <g key={building.id} onClick={() => onSelectBuilding(building.id)} className="cursor-pointer">
                      {isActiveBuilding && (
                        <rect
                          x={building.x - 2}
                          y={building.y - 2}
                          width={building.width + 4}
                          height={building.height + 4}
                          fill="none"
                          stroke={activeBuildingColor}
                          strokeWidth={1.5}
                          rx="3"
                          className="city-active-building-ring"
                          style={{ filter: `drop-shadow(0 0 4px ${activeBuildingColor})` }}
                        />
                      )}
                      <rect
                        x={building.x}
                        y={building.y}
                        width={building.width}
                        height={building.height}
                        fill={color}
                        fillOpacity={opacity}
                        stroke={isSelected ? "#fff" : "rgba(0,0,0,0.3)"}
                        strokeWidth={isSelected ? 2 : 0.5}
                        rx="2"
                      />
                    </g>
                  );
                }

                return (
                  <g
                    key={building.id}
                    transform={`translate(${building.x}, ${building.y})`}
                    onClick={() => !isDragging.current && onSelectBuilding(building.id)}
                    onMouseEnter={() => {
                      if (hideTooltipTimer.current) clearTimeout(hideTooltipTimer.current);
                      setHoveredBuilding(building);
                    }}
                    onMouseLeave={() => {
                      hideTooltipTimer.current = setTimeout(() => setHoveredBuilding(null), 200);
                    }}
                    className="cursor-pointer"
                    style={{ transition: "opacity 0.3s" }}
                    opacity={opacity}
                  >
                    {isFlashing && (
                      <rect
                        x="-8" y="-8"
                        width={building.width + 16}
                        height={building.height + 16}
                        fill="rgba(255,0,0,0.35)"
                        stroke="#ff0000"
                        strokeWidth="3"
                        rx="6"
                        className="animate-ping"
                      />
                    )}
                    {isActiveBuilding && (
                      <rect
                        x="-4"
                        y="-4"
                        width={building.width + 8}
                        height={building.height + 8}
                        fill="none"
                        stroke={activeBuildingColor}
                        strokeWidth="2"
                        rx="6"
                        className="city-active-building-ring"
                        style={{ filter: `drop-shadow(0 0 5px ${activeBuildingColor})` }}
                      />
                    )}
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

                    {/* Coverage bar */}
                    <rect x="0" y={building.height + 2} width={building.width} height={3} fill="rgba(0,0,0,0.5)" rx="1" />
                    <rect
                      x="0" y={building.height + 2}
                      width={building.width * Math.max(0, Math.min(1, building.testCoverage ?? 0))}
                      height={3}
                      fill={building.testCoverage >= 0.8 ? "#00ff88" : building.testCoverage >= 0.5 ? "#ffcc00" : "#ff3333"}
                      rx="1"
                    />

                    {/* Event icons */}
                    <g transform={`translate(${building.width / 2}, ${building.height / 2})`} className="pointer-events-none">
                      {building.activeEvent === 'fire' && (
                        <g transform="translate(-10,-18)">
                          <ellipse cx="10" cy="12" rx="7" ry="9" fill="#ff4400">
                            <animate attributeName="ry" values="9;12;8;11;9" dur="0.5s" repeatCount="indefinite" />
                            <animate attributeName="cy" values="12;9;13;10;12" dur="0.5s" repeatCount="indefinite" />
                          </ellipse>
                          <ellipse cx="10" cy="8" rx="4" ry="6" fill="#ff9900">
                            <animate attributeName="ry" values="6;8;5;7;6" dur="0.4s" repeatCount="indefinite" />
                          </ellipse>
                          <ellipse cx="10" cy="5" rx="2" ry="3" fill="#ffee00">
                            <animate attributeName="ry" values="3;4;2;3" dur="0.3s" repeatCount="indefinite" />
                          </ellipse>
                        </g>
                      )}
                      {building.activeEvent === 'sparkle' && (
                        <g>
                          {[0, 60, 120, 180, 240, 300].map(angle => (
                            <line
                              key={angle}
                              x1="0" y1="0"
                              x2={Math.cos(angle * Math.PI / 180) * 10}
                              y2={Math.sin(angle * Math.PI / 180) * 10}
                              stroke="#00fff7"
                              strokeWidth="1.5"
                            >
                              <animate attributeName="opacity" values="1;0;1" dur={`${0.5 + angle / 300}s`} repeatCount="indefinite" />
                            </line>
                          ))}
                          <circle cx="0" cy="0" r="3" fill="#ffffff">
                            <animate attributeName="r" values="3;4;3" dur="0.6s" repeatCount="indefinite" />
                          </circle>
                        </g>
                      )}
                      {building.activeEvent === 'alarm' && <text x="-12" y="8" fontSize="22"><animate attributeName="opacity" values="1;0;1" dur="0.5s" repeatCount="indefinite" />🚨</text>}
                      {building.activeEvent === 'flood' && <text x="-12" y="8" fontSize="22">🌊</text>}
                      {building.activeEvent === 'smoke' && <text x="-12" y="8" fontSize="22">💨</text>}
                      {!building.activeEvent && building.status === 'error' && <text x="-12" y="8" fontSize="22">❌</text>}
                    </g>

                    {/* High LOD: building name label */}
                    {isHighLod && (
                      <text
                        x={building.width / 2}
                        y={-6}
                        textAnchor="middle"
                        fill="rgba(255,255,255,0.8)"
                        fontSize="8"
                        fontFamily="JetBrains Mono"
                        className="pointer-events-none"
                      >
                        {building.name.length > 14 ? building.name.slice(0, 14) + "…" : building.name}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* Season particles */}
        {layout.season && SEASON_PARTICLES[layout.season]?.count > 0 && !isLowLod && (
          <g className="pointer-events-none">
            {Array.from({ length: SEASON_PARTICLES[layout.season].count }).map((_, i) => {
              const px = (center.x - viewW / 2) + ((i * 137.5) % 1) * viewW + (i / SEASON_PARTICLES[layout.season].count) * viewW;
              const py = (center.y - viewH / 2) + ((i * 89.7) % 1) * viewH;
              const dur = 3 + (i % 4);
              return (
                <text key={i} x={px} y={py} fontSize={viewW * 0.015} textAnchor="middle" opacity="0.5">
                  {SEASON_PARTICLES[layout.season].emoji}
                  <animateTransform
                    attributeName="transform"
                    type="translate"
                    values={`0,0; ${i % 2 === 0 ? 5 : -5},${viewH * 0.05}; 0,${viewH * 0.1}`}
                    dur={`${dur}s`}
                    repeatCount="indefinite"
                  />
                  <animate attributeName="opacity" values="0.5;0.2;0" dur={`${dur}s`} repeatCount="indefinite" />
                </text>
              );
            })}
          </g>
        )}

        {/* Agents */}
        <AnimatePresence>
          {agents?.map(agent => {
            const taskIcon = AGENT_TASK_ICONS[agent.currentTask as string] || AGENT_TASK_ICONS[agent.status] || "";
            const thought = npcThoughts?.get(agent.id);
            const thoughtWords = thought ? thought.slice(0, 40) : "";
            return (
              <motion.g
                key={agent.id}
                initial={false}
                animate={{ x: agent.x, y: agent.y }}
                transition={{ type: "spring", stiffness: 50, damping: 10 }}
                className="pointer-events-none"
              >
                {thought && !isLowLod && (
                  <g transform="translate(0, -60)">
                    <rect
                      x={-thoughtWords.length * 3.2}
                      y="-12"
                      width={thoughtWords.length * 6.4 + 12}
                      height="22"
                      rx="6"
                      fill="rgba(0,0,0,0.75)"
                      stroke="rgba(0,255,247,0.5)"
                      strokeWidth="1"
                    />
                    <text x="0" y="4" textAnchor="middle" fill="#00fff7" fontSize="9" fontFamily="JetBrains Mono">
                      {thoughtWords}
                    </text>
                    <circle cx="0" cy="14" r="2" fill="rgba(0,255,247,0.4)" />
                    <circle cx="0" cy="22" r="1.5" fill="rgba(0,255,247,0.3)" />
                  </g>
                )}
                {agent.status === 'working' && !isLowLod && (
                  <circle r="14" fill="none" stroke={agent.color} strokeWidth="1" opacity="0.4" className="animate-ping" />
                )}
                <circle r="8" fill={agent.color} opacity="0.6" className="animate-ping" />
                <circle r="6" fill={agent.color} stroke="#fff" strokeWidth="2" />
                {!isLowLod && (
                  <text y="-14" textAnchor="middle" fill="#fff" fontSize="11" fontFamily="JetBrains Mono" className="drop-shadow-md">
                    {agent.name}
                  </text>
                )}
                {taskIcon && !isLowLod && (
                  <text y="-26" textAnchor="middle" fontSize="14">{taskIcon}</text>
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

      {/* Zoom controls */}
      <div className="absolute top-4 left-4 z-20 flex flex-col gap-1">
        <button
          onClick={() => setZoom(z => Math.min(MAX_ZOOM, z * 1.4))}
          className="w-8 h-8 glass-panel border border-primary/30 rounded text-primary font-mono text-lg hover:bg-primary/10 transition-colors flex items-center justify-center"
        >+</button>
        <button
          onClick={() => { setZoom(1); setCenter({ x: bounds.cx, y: bounds.cy }); }}
          className="w-8 h-8 glass-panel border border-primary/30 rounded text-primary font-mono text-[10px] hover:bg-primary/10 transition-colors flex items-center justify-center"
        >fit</button>
        <button
          onClick={() => setZoom(z => Math.max(MIN_ZOOM, z * 0.7))}
          className="w-8 h-8 glass-panel border border-primary/30 rounded text-primary font-mono text-lg hover:bg-primary/10 transition-colors flex items-center justify-center"
        >−</button>
      </div>

      {/* Hover Tooltip */}
      {hoveredBuilding && !isLowLod && (
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

      {/* Dependency Legend */}
      {selectedBuildingId && !isLowLod && (
        <div className="absolute bottom-4 left-16 glass-panel p-3 rounded-lg border border-primary/30 z-20 text-xs font-mono space-y-1.5">
          <div className="text-muted-foreground uppercase tracking-wider text-[10px] mb-2">Dependency Links</div>
          <div className="flex items-center gap-2"><span className="w-6 h-0.5 bg-green-400 block"/><span className="text-foreground">Import</span></div>
          <div className="flex items-center gap-2"><span className="w-6 h-0.5 bg-yellow-400 block"/><span className="text-foreground">High Coupling</span></div>
          <div className="flex items-center gap-2"><span className="w-6 h-0.5 bg-red-400 block"/><span className="text-foreground">Circular</span></div>
        </div>
      )}

      {/* Zoom indicator */}
      <div className="absolute bottom-4 left-4 text-[10px] font-mono text-muted-foreground/50 pointer-events-none">
        {Math.round(zoom * 100)}% {isLowLod ? "· overview" : isHighLod ? "· detailed" : ""}
      </div>

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
                onClick={() => {
                  const cx = d.x + d.width / 2;
                  const cy = d.y + d.height / 2;
                  setCenter({ x: cx, y: cy });
                  setZoom(2);
                  onSelectBuilding(d.buildings?.[0]?.id ?? "");
                }}
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

~~~

### 2) Three.js version in project (if any) and full artifacts/software-city/package.json

Answer: No three dependency is declared in this package.json.

Command output (cat artifacts/software-city/package.json):

~~~json
{
  "name": "@workspace/software-city",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "PORT=${PORT:-5173} BASE_PATH=${BASE_PATH:-/} vite --config vite.config.ts --host 0.0.0.0",
    "build": "PORT=${PORT:-5173} BASE_PATH=${BASE_PATH:-/} vite build --config vite.config.ts",
    "serve": "PORT=${PORT:-5173} BASE_PATH=${BASE_PATH:-/} vite preview --config vite.config.ts --host 0.0.0.0",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@hookform/resolvers": "^3.10.0",
    "@radix-ui/react-accordion": "^1.2.4",
    "@radix-ui/react-alert-dialog": "^1.1.7",
    "@radix-ui/react-aspect-ratio": "^1.1.3",
    "@radix-ui/react-avatar": "^1.1.4",
    "@radix-ui/react-checkbox": "^1.1.5",
    "@radix-ui/react-collapsible": "^1.1.4",
    "@radix-ui/react-context-menu": "^2.2.7",
    "@radix-ui/react-dialog": "^1.1.7",
    "@radix-ui/react-dropdown-menu": "^2.1.7",
    "@radix-ui/react-hover-card": "^1.1.7",
    "@radix-ui/react-label": "^2.1.3",
    "@radix-ui/react-menubar": "^1.1.7",
    "@radix-ui/react-navigation-menu": "^1.2.6",
    "@radix-ui/react-popover": "^1.1.7",
    "@radix-ui/react-progress": "^1.1.3",
    "@radix-ui/react-radio-group": "^1.2.4",
    "@radix-ui/react-scroll-area": "^1.2.4",
    "@radix-ui/react-select": "^2.1.7",
    "@radix-ui/react-separator": "^1.1.3",
    "@radix-ui/react-slider": "^1.2.4",
    "@radix-ui/react-slot": "^1.2.0",
    "@radix-ui/react-switch": "^1.1.4",
    "@radix-ui/react-tabs": "^1.1.4",
    "@radix-ui/react-toast": "^1.2.7",
    "@radix-ui/react-toggle": "^1.1.3",
    "@radix-ui/react-toggle-group": "^1.1.3",
    "@radix-ui/react-tooltip": "^1.2.0",
    "@tanstack/react-query": "catalog:",
    "@workspace/api-client-react": "workspace:*",
    "class-variance-authority": "catalog:",
    "clsx": "catalog:",
    "cmdk": "^1.1.1",
    "date-fns": "^3.6.0",
    "diff2html": "^3.4.56",
    "embla-carousel-react": "^8.6.0",
    "framer-motion": "catalog:",
    "input-otp": "^1.4.2",
    "lucide-react": "catalog:",
    "next-themes": "^0.4.6",
    "react": "catalog:",
    "react-day-picker": "^9.11.1",
    "react-dom": "catalog:",
    "react-hook-form": "^7.55.0",
    "react-icons": "^5.4.0",
    "react-resizable-panels": "^2.1.7",
    "recharts": "^2.15.4",
    "sonner": "^2.0.7",
    "tailwind-merge": "catalog:",
    "tw-animate-css": "^1.4.0",
    "vaul": "^1.1.2",
    "wouter": "^3.3.5",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@replit/vite-plugin-cartographer": "catalog:",
    "@replit/vite-plugin-dev-banner": "catalog:",
    "@replit/vite-plugin-runtime-error-modal": "catalog:",
    "@tailwindcss/typography": "^0.5.15",
    "@tailwindcss/vite": "catalog:",
    "@types/node": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "@vitejs/plugin-react": "catalog:",
    "tailwindcss": "catalog:",
    "vite": "catalog:"
  }
}

~~~

### 3) Existing 3D or isometric rendering code search

Answer: Search results only show incidental text matches (for example ISO/date strings and words containing three), not actual Three.js/Pixi/Babylon renderer code.

Search output for three|isometric|iso|pixi|babylon across source-like files:

~~~text
./artifacts/api-server/tests/orchestratorImportReview.test.ts:198:  it("persists learning updates and adjusts matching agent confidence in isolated DB", async () => {
./artifacts/api-server/src/app.ts:12:app.use(morgan("[:date[iso]] :method :url :status :response-time ms"));
./artifacts/api-server/src/lib/findingQuality.ts:110:  const isoLike = value.includes("T") ? value : value.replace(" ", "T");
./artifacts/api-server/src/lib/findingQuality.ts:111:  const withZone = isoLike.endsWith("Z") ? isoLike : `${isoLike}Z`;
./artifacts/api-server/src/routes/orchestrator.ts:444:    .map(entry => `${entry.role}:${normalizeReplyForComparison(entry.content)}`)
./artifacts/api-server/src/routes/orchestrator.ts:546:      .map(entry => normalizeReplyForComparison(entry.content))
./artifacts/api-server/src/routes/orchestrator.ts:549:  const unseen = lines.find(line => !priorAssistantLines.has(normalizeReplyForComparison(line)));
./artifacts/api-server/src/routes/orchestrator.ts:648:function normalizeReplyForComparison(reply: string): string {
./artifacts/api-server/src/routes/orchestrator.ts:661:      .map(item => normalizeReplyForComparison(item.content))
./artifacts/api-server/src/routes/orchestrator.ts:664:  const normalizedReply = normalizeReplyForComparison(params.reply);
./artifacts/api-server/src/routes/orchestrator.ts:1804:  const isoLike = value.includes("T") ? value : value.replace(" ", "T");
./artifacts/api-server/src/routes/orchestrator.ts:1805:  const withZone = isoLike.endsWith("Z") ? isoLike : `${isoLike}Z`;
./artifacts/api-server/src/routes/orchestrator.ts:2901:  return normalizeReplyForComparison(text);
./scripts/train-kb.ts:369:  "Missing enharmonic equivalence in note comparison",
./scripts/train-kb.ts:512:    fix: "Replace loose comparisons with strict equality operators.",
./scripts/train-kb.ts:2973:      question: "Pitch comparison treats enharmonic spellings as distinct values.",
./scripts/train-kb.ts:3106:      explanation: "Apply Hann/Hamming/Blackman windows for stable peak isolation.",
./scripts/seed-knowledge.ts:181:    question: "Control flow exceeds three nested conditional levels and obscures intent.",

~~~

### 4) Runtime city data structure from GET /api/city/layout

Answer: Full live JSON response from running server is below.

GET /api/city/layout response:

~~~json
{
  "districts": [
    {
      "id": "district-0",
      "name": "GI-Synth/CodeCity-V1",
      "path": "root",
      "type": "source",
      "x": 20,
      "y": 20,
      "width": 376,
      "height": 330,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-COMPLETE-HANDOFF-md",
          "name": "COMPLETE_HANDOFF.md",
          "filePath": "COMPLETE_HANDOFF.md",
          "fileType": "function",
          "floors": 7,
          "complexity": 32,
          "x": 40,
          "y": 50,
          "width": 54,
          "height": 76,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 15,
          "age": "new",
          "language": "markdown",
          "linesOfCode": 316,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-CONTRIBUTING-md",
          "name": "CONTRIBUTING.md",
          "filePath": "CONTRIBUTING.md",
          "fileType": "function",
          "floors": 1,
          "complexity": 2,
          "x": 106,
          "y": 50,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 2,
          "age": "new",
          "language": "markdown",
          "linesOfCode": 43,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-DEMO-md",
          "name": "DEMO.md",
          "filePath": "DEMO.md",
          "fileType": "function",
          "floors": 1,
          "complexity": 4,
          "x": 146,
          "y": 50,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 2,
          "age": "new",
          "language": "markdown",
          "linesOfCode": 40,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-FIX-HANDOFF-md",
          "name": "FIX_HANDOFF.md",
          "filePath": "FIX_HANDOFF.md",
          "fileType": "function",
          "floors": 2,
          "complexity": 3,
          "x": 186,
          "y": 50,
          "width": 28,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 4,
          "age": "new",
          "language": "markdown",
          "linesOfCode": 83,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-HEALING-LOOP-HANDOFF-md",
          "name": "HEALING_LOOP_HANDOFF.md",
          "filePath": "HEALING_LOOP_HANDOFF.md",
          "fileType": "function",
          "floors": 3,
          "complexity": 7,
          "x": 226,
          "y": 50,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 6,
          "age": "new",
          "language": "markdown",
          "linesOfCode": 128,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-MAYOR-HANDOFF-md",
          "name": "MAYOR_HANDOFF.md",
          "filePath": "MAYOR_HANDOFF.md",
          "fileType": "function",
          "floors": 1,
          "complexity": 3,
          "x": 266,
          "y": 50,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "markdown",
          "linesOfCode": 24,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-MIGRATION-REPORT-md",
          "name": "MIGRATION_REPORT.md",
          "filePath": "MIGRATION_REPORT.md",
          "fileType": "function",
          "floors": 3,
          "complexity": 9,
          "x": 40,
          "y": 108,
          "width": 36,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 5,
          "age": "new",
          "language": "markdown",
          "linesOfCode": 114,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-PHASE4-HANDOFF-md",
          "name": "PHASE4_HANDOFF.md",
          "filePath": "PHASE4_HANDOFF.md",
          "fileType": "function",
          "floors": 1,
          "complexity": 7,
          "x": 88,
          "y": 108,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 2,
          "age": "new",
          "language": "markdown",
          "linesOfCode": 43,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-PHASE6-HANDOFF-md",
          "name": "PHASE6_HANDOFF.md",
          "filePath": "PHASE6_HANDOFF.md",
          "fileType": "function",
          "floors": 5,
          "complexity": 14,
          "x": 128,
          "y": 108,
          "width": 45,
          "height": 60,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 10,
          "age": "new",
          "language": "markdown",
          "linesOfCode": 218,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-PHASE7-HANDOFF-md",
          "name": "PHASE7_HANDOFF.md",
          "filePath": "PHASE7_HANDOFF.md",
          "fileType": "function",
          "floors": 1,
          "complexity": 2,
          "x": 185,
          "y": 108,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "markdown",
          "linesOfCode": 21,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-PHASE8-HANDOFF-md",
          "name": "PHASE8_HANDOFF.md",
          "filePath": "PHASE8_HANDOFF.md",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 225,
          "y": 108,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 2,
          "age": "new",
          "language": "markdown",
          "linesOfCode": 44,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-PHASE9-HANDOFF-md",
          "name": "PHASE9_HANDOFF.md",
          "filePath": "PHASE9_HANDOFF.md",
          "fileType": "function",
          "floors": 3,
          "complexity": 7,
          "x": 265,
          "y": 108,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 6,
          "age": "new",
          "language": "markdown",
          "linesOfCode": 121,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-PROGRESS-md",
          "name": "PROGRESS.md",
          "filePath": "PROGRESS.md",
          "fileType": "function",
          "floors": 1,
          "complexity": 7,
          "x": 40,
          "y": 150,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 2,
          "age": "new",
          "language": "markdown",
          "linesOfCode": 41,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-README-md",
          "name": "README.md",
          "filePath": "README.md",
          "fileType": "function",
          "floors": 2,
          "complexity": 2,
          "x": 80,
          "y": 150,
          "width": 28,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 2,
          "age": "new",
          "language": "markdown",
          "linesOfCode": 55,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-REVIEW-SYSTEM-HANDOFF-md",
          "name": "REVIEW_SYSTEM_HANDOFF.md",
          "filePath": "REVIEW_SYSTEM_HANDOFF.md",
          "fileType": "function",
          "floors": 2,
          "complexity": 14,
          "x": 120,
          "y": 150,
          "width": 45,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 3,
          "age": "new",
          "language": "markdown",
          "linesOfCode": 69,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-SMART-AGENTS-HANDOFF-md",
          "name": "SMART_AGENTS_HANDOFF.md",
          "filePath": "SMART_AGENTS_HANDOFF.md",
          "fileType": "function",
          "floors": 2,
          "complexity": 2,
          "x": 177,
          "y": 150,
          "width": 28,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 3,
          "age": "new",
          "language": "markdown",
          "linesOfCode": 67,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-SYSTEM-STATUS-md",
          "name": "SYSTEM_STATUS.md",
          "filePath": "SYSTEM_STATUS.md",
          "fileType": "function",
          "floors": 2,
          "complexity": 5,
          "x": 217,
          "y": 150,
          "width": 28,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 3,
          "age": "new",
          "language": "markdown",
          "linesOfCode": 74,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-VECTOR-SEARCH-HANDOFF-md",
          "name": "VECTOR_SEARCH_HANDOFF.md",
          "filePath": "VECTOR_SEARCH_HANDOFF.md",
          "fileType": "function",
          "floors": 2,
          "complexity": 5,
          "x": 257,
          "y": 150,
          "width": 28,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 2,
          "age": "new",
          "language": "markdown",
          "linesOfCode": 58,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-VSCODE-COPILOT-HANDOFF-PROMPT-md",
          "name": "VSCODE_COPILOT_HANDOFF_PROMPT.md",
          "filePath": "VSCODE_COPILOT_HANDOFF_PROMPT.md",
          "fileType": "function",
          "floors": 5,
          "complexity": 20,
          "x": 40,
          "y": 224,
          "width": 54,
          "height": 60,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 11,
          "age": "new",
          "language": "markdown",
          "linesOfCode": 234,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-docker-compose-yml",
          "name": "docker-compose.yml",
          "filePath": "docker-compose.yml",
          "fileType": "config",
          "floors": 1,
          "complexity": 1,
          "x": 106,
          "y": 224,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "yaml",
          "linesOfCode": 18,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-package-json",
          "name": "package.json",
          "filePath": "package.json",
          "fileType": "config",
          "floors": 1,
          "complexity": 5,
          "x": 146,
          "y": 224,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "json",
          "linesOfCode": 29,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-pnpm-lock-yaml",
          "name": "pnpm-lock.yaml",
          "filePath": "pnpm-lock.yaml",
          "fileType": "config",
          "floors": 10,
          "complexity": 50,
          "x": 186,
          "y": 224,
          "width": 54,
          "height": 100,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 270,
          "age": "ancient",
          "language": "yaml",
          "linesOfCode": 5415,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-pnpm-workspace-yaml",
          "name": "pnpm-workspace.yaml",
          "filePath": "pnpm-workspace.yaml",
          "fileType": "config",
          "floors": 3,
          "complexity": 1,
          "x": 252,
          "y": 224,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 5,
          "age": "new",
          "language": "yaml",
          "linesOfCode": 117,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-replit-md",
          "name": "replit.md",
          "filePath": "replit.md",
          "fileType": "function",
          "floors": 3,
          "complexity": 2,
          "x": 292,
          "y": 224,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 7,
          "age": "new",
          "language": "markdown",
          "linesOfCode": 150,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-tsconfig-base-json",
          "name": "tsconfig.base.json",
          "filePath": "tsconfig.base.json",
          "fileType": "config",
          "floors": 1,
          "complexity": 1,
          "x": 40,
          "y": 266,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "json",
          "linesOfCode": 25,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-tsconfig-json",
          "name": "tsconfig.json",
          "filePath": "tsconfig.json",
          "fileType": "config",
          "floors": 1,
          "complexity": 1,
          "x": 80,
          "y": 266,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "json",
          "linesOfCode": 16,
          "dependencies": [],
          "activeEvent": null
        }
      ],
      "healthScore": 20
    },
    {
      "id": "district-1",
      "name": "artifacts/api-server/.replit-artifact",
      "path": "artifacts/api-server/.replit-artifact",
      "type": "source",
      "x": 426,
      "y": 20,
      "width": 160,
      "height": 120,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-artifacts-api-server--replit-artifact-artifact-toml",
          "name": "artifact.toml",
          "filePath": "artifacts/api-server/.replit-artifact/artifact.toml",
          "fileType": "config",
          "floors": 1,
          "complexity": 1,
          "x": 446,
          "y": 50,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "toml",
          "linesOfCode": 19,
          "dependencies": [],
          "activeEvent": null
        }
      ],
      "healthScore": 24
    },
    {
      "id": "district-2",
      "name": "artifacts/api-server",
      "path": "artifacts/api-server",
      "type": "api",
      "x": 616,
      "y": 20,
      "width": 160,
      "height": 120,
      "color": "#2a1a0d",
      "buildings": [
        {
          "id": "building-artifacts-api-server-package-json",
          "name": "package.json",
          "filePath": "artifacts/api-server/package.json",
          "fileType": "config",
          "floors": 1,
          "complexity": 1,
          "x": 636,
          "y": 50,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "json",
          "linesOfCode": 36,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-tsconfig-json",
          "name": "tsconfig.json",
          "filePath": "artifacts/api-server/tsconfig.json",
          "fileType": "config",
          "floors": 1,
          "complexity": 1,
          "x": 676,
          "y": 50,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "json",
          "linesOfCode": 17,
          "dependencies": [],
          "activeEvent": null
        }
      ],
      "healthScore": 24
    },
    {
      "id": "district-3",
      "name": "artifacts/api-server/src",
      "path": "artifacts/api-server/src",
      "type": "source",
      "x": 20,
      "y": 380,
      "width": 160,
      "height": 120,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-artifacts-api-server-src-app-ts",
          "name": "app.ts",
          "filePath": "artifacts/api-server/src/app.ts",
          "fileType": "api",
          "floors": 1,
          "complexity": 5,
          "x": 40,
          "y": 410,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 11,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 37,
          "dependencies": [
            "express",
            "cors",
            "morgan",
            "express-rate-limit",
            "./routes"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-index-ts",
          "name": "index.ts",
          "filePath": "artifacts/api-server/src/index.ts",
          "fileType": "function",
          "floors": 4,
          "complexity": 28,
          "x": 80,
          "y": 410,
          "width": 54,
          "height": 52,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 33,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 159,
          "dependencies": [
            "http",
            "./app",
            "./lib/wsServer",
            "./lib/agentEngine",
            "./lib/envValidator",
            "./routes/metrics",
            "@workspace/db",
            "@workspace/db/schema",
            "drizzle-orm",
            "./lib/loadEnv",
            "./lib/embeddings",
            "./lib/vectorSearch",
            "./lib/knowledgeCleanup"
          ],
          "activeEvent": null
        }
      ],
      "healthScore": 14
    },
    {
      "id": "district-4",
      "name": "artifacts/api-server/src/lib",
      "path": "artifacts/api-server/src/lib",
      "type": "source",
      "x": 210,
      "y": 380,
      "width": 376,
      "height": 330,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-artifacts-api-server-src-lib-agentEngine-ts",
          "name": "agentEngine.ts",
          "filePath": "artifacts/api-server/src/lib/agentEngine.ts",
          "fileType": "function",
          "floors": 10,
          "complexity": 50,
          "x": 230,
          "y": 410,
          "width": 54,
          "height": 100,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 41,
          "age": "aged",
          "language": "typescript",
          "linesOfCode": 501,
          "dependencies": [
            "./types",
            "@workspace/db",
            "@workspace/db/schema",
            "./wsServer",
            "drizzle-orm",
            "./smartAgentWorkflow",
            "./smartAgents",
            "./findingQuality"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-alchemistExecutor-ts",
          "name": "alchemistExecutor.ts",
          "filePath": "artifacts/api-server/src/lib/alchemistExecutor.ts",
          "fileType": "function",
          "floors": 4,
          "complexity": 33,
          "x": 296,
          "y": 410,
          "width": 54,
          "height": 52,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 11,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 194,
          "dependencies": [
            "node:child_process"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-anonymize-ts",
          "name": "anonymize.ts",
          "filePath": "artifacts/api-server/src/lib/anonymize.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 2,
          "x": 362,
          "y": 410,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 14,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-assetGenerator-ts",
          "name": "assetGenerator.ts",
          "filePath": "artifacts/api-server/src/lib/assetGenerator.ts",
          "fileType": "function",
          "floors": 3,
          "complexity": 9,
          "x": 402,
          "y": 410,
          "width": 36,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 5,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 101,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-cityAnalyzer-ts",
          "name": "cityAnalyzer.ts",
          "filePath": "artifacts/api-server/src/lib/cityAnalyzer.ts",
          "fileType": "function",
          "floors": 5,
          "complexity": 50,
          "x": 450,
          "y": 410,
          "width": 54,
          "height": 60,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 17,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 231,
          "dependencies": [
            "./types",
            "./codeAnalyzer",
            "./healthScorer"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-codeAnalyzer-ts",
          "name": "codeAnalyzer.ts",
          "filePath": "artifacts/api-server/src/lib/codeAnalyzer.ts",
          "fileType": "api",
          "floors": 4,
          "complexity": 50,
          "x": 516,
          "y": 410,
          "width": 54,
          "height": 52,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 9,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 187,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-embeddings-ts",
          "name": "embeddings.ts",
          "filePath": "artifacts/api-server/src/lib/embeddings.ts",
          "fileType": "function",
          "floors": 3,
          "complexity": 16,
          "x": 230,
          "y": 468,
          "width": 54,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 13,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 108,
          "dependencies": [
            "node:path",
            "@workspace/db",
            "@workspace/db/schema",
            "drizzle-orm"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-envValidator-ts",
          "name": "envValidator.ts",
          "filePath": "artifacts/api-server/src/lib/envValidator.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 10,
          "x": 296,
          "y": 468,
          "width": 36,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 5,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 32,
          "dependencies": [
            "./ollamaClient",
            "path"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-escalationEngine-ts",
          "name": "escalationEngine.ts",
          "filePath": "artifacts/api-server/src/lib/escalationEngine.ts",
          "fileType": "function",
          "floors": 10,
          "complexity": 50,
          "x": 344,
          "y": 468,
          "width": 54,
          "height": 100,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 52,
          "age": "aged",
          "language": "typescript",
          "linesOfCode": 656,
          "dependencies": [
            "@workspace/db",
            "@workspace/db/schema",
            "drizzle-orm",
            "./ollamaPrompts",
            "./ollamaClient",
            "./anonymize",
            "./sessionStats",
            "./vectorSearch",
            "./embeddings",
            "./smartAgents"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-fileWatcher-ts",
          "name": "fileWatcher.ts",
          "filePath": "artifacts/api-server/src/lib/fileWatcher.ts",
          "fileType": "function",
          "floors": 2,
          "complexity": 10,
          "x": 410,
          "y": 468,
          "width": 36,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 16,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 80,
          "dependencies": [
            "chokidar",
            "./codeAnalyzer",
            "./healthScorer",
            "./wsServer",
            "fs",
            "./types"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-findingQuality-ts",
          "name": "findingQuality.ts",
          "filePath": "artifacts/api-server/src/lib/findingQuality.ts",
          "fileType": "function",
          "floors": 6,
          "complexity": 50,
          "x": 458,
          "y": 468,
          "width": 54,
          "height": 68,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 26,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 294,
          "dependencies": [
            "@workspace/db",
            "@workspace/db/schema",
            "drizzle-orm",
            "node:path",
            "./escalationEngine",
            "./smartAgents"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-gitHistory-ts",
          "name": "gitHistory.ts",
          "filePath": "artifacts/api-server/src/lib/gitHistory.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 4,
          "x": 524,
          "y": 468,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 3,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 31,
          "dependencies": [
            "simple-git"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-githubFetcher-ts",
          "name": "githubFetcher.ts",
          "filePath": "artifacts/api-server/src/lib/githubFetcher.ts",
          "fileType": "function",
          "floors": 4,
          "complexity": 36,
          "x": 230,
          "y": 534,
          "width": 54,
          "height": 52,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 12,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 163,
          "dependencies": [
            "./cityAnalyzer",
            "./githubTokenStore"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-githubTokenStore-ts",
          "name": "githubTokenStore.ts",
          "filePath": "artifacts/api-server/src/lib/githubTokenStore.ts",
          "fileType": "function",
          "floors": 3,
          "complexity": 18,
          "x": 296,
          "y": 534,
          "width": 54,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 15,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 112,
          "dependencies": [
            "node:crypto",
            "node:os",
            "@workspace/db",
            "@workspace/db/schema",
            "drizzle-orm"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-healthScorer-ts",
          "name": "healthScorer.ts",
          "filePath": "artifacts/api-server/src/lib/healthScorer.ts",
          "fileType": "function",
          "floors": 2,
          "complexity": 20,
          "x": 362,
          "y": 534,
          "width": 54,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 4,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 56,
          "dependencies": [
            "./types"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-knowledgeCleanup-ts",
          "name": "knowledgeCleanup.ts",
          "filePath": "artifacts/api-server/src/lib/knowledgeCleanup.ts",
          "fileType": "function",
          "floors": 3,
          "complexity": 29,
          "x": 428,
          "y": 534,
          "width": 54,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 17,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 147,
          "dependencies": [
            "@workspace/db",
            "@workspace/db/schema",
            "drizzle-orm",
            "./types",
            "./sourceFiles"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-loadEnv-ts",
          "name": "loadEnv.ts",
          "filePath": "artifacts/api-server/src/lib/loadEnv.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 7,
          "x": 494,
          "y": 534,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 9,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 28,
          "dependencies": [
            "node:fs",
            "node:url",
            "node:path",
            "dotenv"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-ollamaClient-ts",
          "name": "ollamaClient.ts",
          "filePath": "artifacts/api-server/src/lib/ollamaClient.ts",
          "fileType": "function",
          "floors": 2,
          "complexity": 17,
          "x": 534,
          "y": 534,
          "width": 54,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 4,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 80,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-ollamaPrompts-ts",
          "name": "ollamaPrompts.ts",
          "filePath": "artifacts/api-server/src/lib/ollamaPrompts.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 2,
          "x": 230,
          "y": 576,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 38,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-orchestrator-ts",
          "name": "orchestrator.ts",
          "filePath": "artifacts/api-server/src/lib/orchestrator.ts",
          "fileType": "function",
          "floors": 6,
          "complexity": 50,
          "x": 270,
          "y": 576,
          "width": 54,
          "height": 68,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 25,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 264,
          "dependencies": [
            "./wsServer",
            "@workspace/db",
            "@workspace/db/schema",
            "./orchestratorPrompts",
            "drizzle-orm",
            "./ollamaClient"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-orchestratorPrompts-ts",
          "name": "orchestratorPrompts.ts",
          "filePath": "artifacts/api-server/src/lib/orchestratorPrompts.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 5,
          "x": 336,
          "y": 576,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 14,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-projectFingerprint-ts",
          "name": "projectFingerprint.ts",
          "filePath": "artifacts/api-server/src/lib/projectFingerprint.ts",
          "fileType": "function",
          "floors": 5,
          "complexity": 50,
          "x": 376,
          "y": 576,
          "width": 54,
          "height": 60,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 17,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 228,
          "dependencies": [
            "node:fs/promises",
            "node:path",
            "./cityAnalyzer"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-sessionStats-ts",
          "name": "sessionStats.ts",
          "filePath": "artifacts/api-server/src/lib/sessionStats.ts",
          "fileType": "function",
          "floors": 2,
          "complexity": 7,
          "x": 442,
          "y": 576,
          "width": 28,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 3,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 71,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-smartAgentWorkflow-ts",
          "name": "smartAgentWorkflow.ts",
          "filePath": "artifacts/api-server/src/lib/smartAgentWorkflow.ts",
          "fileType": "function",
          "floors": 10,
          "complexity": 50,
          "x": 482,
          "y": 576,
          "width": 54,
          "height": 100,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 44,
          "age": "aged",
          "language": "typescript",
          "linesOfCode": 560,
          "dependencies": [
            "@workspace/db",
            "@workspace/db/schema",
            "drizzle-orm",
            "./alchemistExecutor",
            "./escalationEngine",
            "./types",
            "./findingQuality",
            "./smartAgents"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-smartAgents-ts",
          "name": "smartAgents.ts",
          "filePath": "artifacts/api-server/src/lib/smartAgents.ts",
          "fileType": "function",
          "floors": 10,
          "complexity": 50,
          "x": 230,
          "y": 690,
          "width": 54,
          "height": 100,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 33,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 636,
          "dependencies": [
            "node:path"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-sourceFiles-ts",
          "name": "sourceFiles.ts",
          "filePath": "artifacts/api-server/src/lib/sourceFiles.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 2,
          "x": 296,
          "y": 690,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 3,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 31,
          "dependencies": [
            "node:path"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-testExecutor-ts",
          "name": "testExecutor.ts",
          "filePath": "artifacts/api-server/src/lib/testExecutor.ts",
          "fileType": "function",
          "floors": 4,
          "complexity": 50,
          "x": 336,
          "y": 690,
          "width": 54,
          "height": 52,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 21,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 188,
          "dependencies": [
            "child_process",
            "fs/promises",
            "fs",
            "path",
            "crypto",
            "${importPath}"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-types-ts",
          "name": "types.ts",
          "filePath": "artifacts/api-server/src/lib/types.ts",
          "fileType": "function",
          "floors": 2,
          "complexity": 1,
          "x": 402,
          "y": 690,
          "width": 28,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 3,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 68,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-vectorSearch-ts",
          "name": "vectorSearch.ts",
          "filePath": "artifacts/api-server/src/lib/vectorSearch.ts",
          "fileType": "function",
          "floors": 5,
          "complexity": 44,
          "x": 442,
          "y": 690,
          "width": 54,
          "height": 60,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 18,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 207,
          "dependencies": [
            "@workspace/db",
            "@workspace/db/schema",
            "drizzle-orm",
            "./embeddings"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-lib-wsServer-ts",
          "name": "wsServer.ts",
          "filePath": "artifacts/api-server/src/lib/wsServer.ts",
          "fileType": "function",
          "floors": 4,
          "complexity": 21,
          "x": 508,
          "y": 690,
          "width": 54,
          "height": 52,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 12,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 177,
          "dependencies": [
            "ws",
            "http"
          ],
          "activeEvent": null
        }
      ],
      "healthScore": 7
    },
    {
      "id": "district-5",
      "name": "artifacts/api-server/src/routes",
      "path": "artifacts/api-server/src/routes",
      "type": "api",
      "x": 616,
      "y": 380,
      "width": 320,
      "height": 274,
      "color": "#2a1a0d",
      "buildings": [
        {
          "id": "building-artifacts-api-server-src-routes-agents-ts",
          "name": "agents.ts",
          "filePath": "artifacts/api-server/src/routes/agents.ts",
          "fileType": "api",
          "floors": 10,
          "complexity": 50,
          "x": 636,
          "y": 410,
          "width": 54,
          "height": 100,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 79,
          "age": "aged",
          "language": "typescript",
          "linesOfCode": 873,
          "dependencies": [
            "express",
            "@workspace/db",
            "@workspace/db/schema",
            "drizzle-orm",
            "../lib/agentEngine",
            "../lib/escalationEngine",
            "../lib/testExecutor",
            "../lib/ollamaPrompts",
            "../lib/ollamaClient",
            "../lib/wsServer",
            "node:crypto",
            "node:path",
            "../lib/types",
            "../lib/sourceFiles",
            "../lib/smartAgentWorkflow",
            "../lib/smartAgents",
            "../lib/findingQuality",
            "assert"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-routes-alchemist-ts",
          "name": "alchemist.ts",
          "filePath": "artifacts/api-server/src/routes/alchemist.ts",
          "fileType": "api",
          "floors": 3,
          "complexity": 33,
          "x": 702,
          "y": 410,
          "width": 54,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 17,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 115,
          "dependencies": [
            "express",
            "@workspace/db",
            "@workspace/db/schema",
            "drizzle-orm",
            "../lib/alchemistExecutor",
            "../lib/wsServer"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-routes-assets-ts",
          "name": "assets.ts",
          "filePath": "artifacts/api-server/src/routes/assets.ts",
          "fileType": "api",
          "floors": 1,
          "complexity": 1,
          "x": 768,
          "y": 410,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 4,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 14,
          "dependencies": [
            "express",
            "../lib/assetGenerator"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-routes-city-ts",
          "name": "city.ts",
          "filePath": "artifacts/api-server/src/routes/city.ts",
          "fileType": "api",
          "floors": 6,
          "complexity": 50,
          "x": 808,
          "y": 410,
          "width": 54,
          "height": 68,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 28,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 281,
          "dependencies": [
            "express",
            "@workspace/db",
            "@workspace/db/schema",
            "drizzle-orm",
            "../lib/cityAnalyzer",
            "../lib/healthScorer",
            "../lib/types"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-routes-debug-ts",
          "name": "debug.ts",
          "filePath": "artifacts/api-server/src/routes/debug.ts",
          "fileType": "api",
          "floors": 2,
          "complexity": 21,
          "x": 874,
          "y": 410,
          "width": 54,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 11,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 69,
          "dependencies": [
            "express",
            "@workspace/db",
            "@workspace/db/schema",
            "drizzle-orm"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-routes-events-ts",
          "name": "events.ts",
          "filePath": "artifacts/api-server/src/routes/events.ts",
          "fileType": "api",
          "floors": 1,
          "complexity": 9,
          "x": 636,
          "y": 452,
          "width": 36,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 10,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 47,
          "dependencies": [
            "express",
            "@workspace/db",
            "@workspace/db/schema",
            "drizzle-orm"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-routes-health-ts",
          "name": "health.ts",
          "filePath": "artifacts/api-server/src/routes/health.ts",
          "fileType": "api",
          "floors": 1,
          "complexity": 1,
          "x": 684,
          "y": 452,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 4,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 8,
          "dependencies": [
            "express",
            "@workspace/api-zod"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-routes-index-ts",
          "name": "index.ts",
          "filePath": "artifacts/api-server/src/routes/index.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 724,
          "y": 452,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 35,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 37,
          "dependencies": [
            "express",
            "./health",
            "./repo",
            "./city",
            "./agents",
            "./knowledge",
            "./events",
            "./assets",
            "./ollama",
            "./watch",
            "./shared",
            "./settings",
            "./metrics",
            "./report",
            "./orchestrator",
            "./alchemist",
            "./debug"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-routes-knowledge-ts",
          "name": "knowledge.ts",
          "filePath": "artifacts/api-server/src/routes/knowledge.ts",
          "fileType": "api",
          "floors": 5,
          "complexity": 50,
          "x": 764,
          "y": 452,
          "width": 54,
          "height": 60,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 24,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 204,
          "dependencies": [
            "express",
            "@workspace/db",
            "@workspace/db/schema",
            "drizzle-orm",
            "../lib/sessionStats",
            "../lib/vectorSearch",
            "../lib/embeddings"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-routes-metrics-ts",
          "name": "metrics.ts",
          "filePath": "artifacts/api-server/src/routes/metrics.ts",
          "fileType": "api",
          "floors": 2,
          "complexity": 13,
          "x": 830,
          "y": 452,
          "width": 45,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 11,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 63,
          "dependencies": [
            "express",
            "@workspace/db",
            "@workspace/db/schema",
            "drizzle-orm"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-routes-ollama-ts",
          "name": "ollama.ts",
          "filePath": "artifacts/api-server/src/routes/ollama.ts",
          "fileType": "api",
          "floors": 1,
          "complexity": 3,
          "x": 636,
          "y": 494,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 5,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 24,
          "dependencies": [
            "express",
            "../lib/ollamaClient"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-routes-orchestrator-ts",
          "name": "orchestrator.ts",
          "filePath": "artifacts/api-server/src/routes/orchestrator.ts",
          "fileType": "api",
          "floors": 10,
          "complexity": 50,
          "x": 676,
          "y": 494,
          "width": 54,
          "height": 100,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 210,
          "age": "ancient",
          "language": "typescript",
          "linesOfCode": 3619,
          "dependencies": [
            "express",
            "@workspace/db",
            "@workspace/db/schema",
            "drizzle-orm",
            "node:fs/promises",
            "node:path",
            "node:url",
            "../lib/fileWatcher",
            "../lib/healthScorer",
            "../lib/knowledgeCleanup",
            "../lib/orchestrator",
            "../lib/githubTokenStore",
            "../lib/sessionStats",
            "../lib/wsServer",
            "../lib/types"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-routes-repo-ts",
          "name": "repo.ts",
          "filePath": "artifacts/api-server/src/routes/repo.ts",
          "fileType": "api",
          "floors": 5,
          "complexity": 47,
          "x": 742,
          "y": 494,
          "width": 54,
          "height": 60,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 30,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 247,
          "dependencies": [
            "express",
            "@workspace/db",
            "@workspace/db/schema",
            "../lib/githubFetcher",
            "../lib/githubTokenStore",
            "../lib/cityAnalyzer",
            "../lib/projectFingerprint",
            "../lib/vectorSearch",
            "drizzle-orm"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-routes-report-ts",
          "name": "report.ts",
          "filePath": "artifacts/api-server/src/routes/report.ts",
          "fileType": "api",
          "floors": 2,
          "complexity": 13,
          "x": 808,
          "y": 494,
          "width": 45,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 10,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 54,
          "dependencies": [
            "express",
            "@workspace/db",
            "@workspace/db/schema",
            "drizzle-orm"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-routes-settings-ts",
          "name": "settings.ts",
          "filePath": "artifacts/api-server/src/routes/settings.ts",
          "fileType": "api",
          "floors": 2,
          "complexity": 13,
          "x": 865,
          "y": 494,
          "width": 45,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 11,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 69,
          "dependencies": [
            "express",
            "@workspace/db",
            "@workspace/db/schema",
            "drizzle-orm"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-routes-shared-ts",
          "name": "shared.ts",
          "filePath": "artifacts/api-server/src/routes/shared.ts",
          "fileType": "api",
          "floors": 2,
          "complexity": 14,
          "x": 636,
          "y": 544,
          "width": 45,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 15,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 64,
          "dependencies": [
            "express",
            "@workspace/db",
            "@workspace/db/schema",
            "drizzle-orm",
            "../lib/healthScorer",
            "../lib/types"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-api-server-src-routes-watch-ts",
          "name": "watch.ts",
          "filePath": "artifacts/api-server/src/routes/watch.ts",
          "fileType": "api",
          "floors": 1,
          "complexity": 8,
          "x": 693,
          "y": 544,
          "width": 36,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 16,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 44,
          "dependencies": [
            "express",
            "../lib/fileWatcher",
            "@workspace/db",
            "@workspace/db/schema",
            "drizzle-orm",
            "../lib/cityAnalyzer",
            "../lib/types"
          ],
          "activeEvent": null
        }
      ],
      "healthScore": 10
    },
    {
      "id": "district-6",
      "name": "artifacts/mockup-sandbox/.replit-artifact",
      "path": "artifacts/mockup-sandbox/.replit-artifact",
      "type": "source",
      "x": 20,
      "y": 740,
      "width": 160,
      "height": 120,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-artifacts-mockup-sandbox--replit-artifact-artifact-toml",
          "name": "artifact.toml",
          "filePath": "artifacts/mockup-sandbox/.replit-artifact/artifact.toml",
          "fileType": "config",
          "floors": 1,
          "complexity": 1,
          "x": 40,
          "y": 770,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "toml",
          "linesOfCode": 14,
          "dependencies": [],
          "activeEvent": null
        }
      ],
      "healthScore": 24
    },
    {
      "id": "district-7",
      "name": "artifacts/mockup-sandbox",
      "path": "artifacts/mockup-sandbox",
      "type": "database",
      "x": 210,
      "y": 740,
      "width": 208,
      "height": 162,
      "color": "#1a0d2a",
      "buildings": [
        {
          "id": "building-artifacts-mockup-sandbox-components-json",
          "name": "components.json",
          "filePath": "artifacts/mockup-sandbox/components.json",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 230,
          "y": 770,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "json",
          "linesOfCode": 21,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-index-html",
          "name": "index.html",
          "filePath": "artifacts/mockup-sandbox/index.html",
          "fileType": "function",
          "floors": 1,
          "complexity": 4,
          "x": 270,
          "y": 770,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "html",
          "linesOfCode": 26,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-mockupPreviewPlugin-ts",
          "name": "mockupPreviewPlugin.ts",
          "filePath": "artifacts/mockup-sandbox/mockupPreviewPlugin.ts",
          "fileType": "function",
          "floors": 3,
          "complexity": 15,
          "x": 310,
          "y": 770,
          "width": 45,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 17,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 150,
          "dependencies": [
            "fs",
            "path",
            "fast-glob",
            "chokidar",
            "vite"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-package-json",
          "name": "package.json",
          "filePath": "artifacts/mockup-sandbox/package.json",
          "fileType": "config",
          "floors": 2,
          "complexity": 2,
          "x": 230,
          "y": 820,
          "width": 28,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 3,
          "age": "new",
          "language": "json",
          "linesOfCode": 76,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-tsconfig-json",
          "name": "tsconfig.json",
          "filePath": "artifacts/mockup-sandbox/tsconfig.json",
          "fileType": "config",
          "floors": 1,
          "complexity": 1,
          "x": 270,
          "y": 820,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "json",
          "linesOfCode": 16,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-vite-config-ts",
          "name": "vite.config.ts",
          "filePath": "artifacts/mockup-sandbox/vite.config.ts",
          "fileType": "config",
          "floors": 2,
          "complexity": 7,
          "x": 310,
          "y": 820,
          "width": 28,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 15,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 65,
          "dependencies": [
            "vite",
            "@vitejs/plugin-react",
            "@tailwindcss/vite",
            "path",
            "@replit/vite-plugin-runtime-error-modal",
            "./mockupPreviewPlugin"
          ],
          "activeEvent": null
        }
      ],
      "healthScore": 22
    },
    {
      "id": "district-8",
      "name": "artifacts/mockup-sandbox/src/.generated",
      "path": "artifacts/mockup-sandbox/src/.generated",
      "type": "source",
      "x": 448,
      "y": 740,
      "width": 160,
      "height": 120,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-artifacts-mockup-sandbox-src--generated-mockup-components-ts",
          "name": "mockup-components.ts",
          "filePath": "artifacts/mockup-sandbox/src/.generated/mockup-components.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 468,
          "y": 770,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 3,
          "dependencies": [],
          "activeEvent": null
        }
      ],
      "healthScore": 24
    },
    {
      "id": "district-9",
      "name": "artifacts/mockup-sandbox/src",
      "path": "artifacts/mockup-sandbox/src",
      "type": "source",
      "x": 20,
      "y": 932,
      "width": 160,
      "height": 162,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-artifacts-mockup-sandbox-src-App-tsx",
          "name": "App.tsx",
          "filePath": "artifacts/mockup-sandbox/src/App.tsx",
          "fileType": "function",
          "floors": 3,
          "complexity": 18,
          "x": 40,
          "y": 962,
          "width": 54,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 10,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 124,
          "dependencies": [
            "react",
            "./.generated/mockup-components"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-index-css",
          "name": "index.css",
          "filePath": "artifacts/mockup-sandbox/src/index.css",
          "fileType": "function",
          "floors": 3,
          "complexity": 2,
          "x": 106,
          "y": 962,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 11,
          "age": "new",
          "language": "css",
          "linesOfCode": 141,
          "dependencies": [
            "tailwindcss",
            "tw-animate-css"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-main-tsx",
          "name": "main.tsx",
          "filePath": "artifacts/mockup-sandbox/src/main.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 40,
          "y": 1004,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 6,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 4,
          "dependencies": [
            "react-dom/client",
            "./App",
            "./index.css"
          ],
          "activeEvent": null
        }
      ],
      "healthScore": 20
    },
    {
      "id": "district-10",
      "name": "artifacts/mockup-sandbox/src/components/ui",
      "path": "artifacts/mockup-sandbox/src/components/ui",
      "type": "source",
      "x": 210,
      "y": 932,
      "width": 488,
      "height": 442,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-accordion-tsx",
          "name": "accordion.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/accordion.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 230,
          "y": 962,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 10,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 49,
          "dependencies": [
            "react",
            "@radix-ui/react-accordion",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-alert-dialog-tsx",
          "name": "alert-dialog.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/alert-dialog.tsx",
          "fileType": "function",
          "floors": 3,
          "complexity": 1,
          "x": 270,
          "y": 962,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 14,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 126,
          "dependencies": [
            "react",
            "@radix-ui/react-alert-dialog",
            "@/lib/utils",
            "@/components/ui/button"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-alert-tsx",
          "name": "alert.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/alert.tsx",
          "fileType": "function",
          "floors": 2,
          "complexity": 1,
          "x": 310,
          "y": 962,
          "width": 28,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 8,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 53,
          "dependencies": [
            "react",
            "class-variance-authority",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-aspect-ratio-tsx",
          "name": "aspect-ratio.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/aspect-ratio.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 350,
          "y": 962,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 2,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 3,
          "dependencies": [
            "@radix-ui/react-aspect-ratio"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-avatar-tsx",
          "name": "avatar.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/avatar.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 390,
          "y": 962,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 8,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 44,
          "dependencies": [
            "react",
            "@radix-ui/react-avatar",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-badge-tsx",
          "name": "badge.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/badge.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 430,
          "y": 962,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 7,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 32,
          "dependencies": [
            "react",
            "class-variance-authority",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-breadcrumb-tsx",
          "name": "breadcrumb.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/breadcrumb.tsx",
          "fileType": "function",
          "floors": 3,
          "complexity": 3,
          "x": 470,
          "y": 962,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 13,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 105,
          "dependencies": [
            "react",
            "@radix-ui/react-slot",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-button-group-tsx",
          "name": "button-group.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/button-group.tsx",
          "fileType": "function",
          "floors": 2,
          "complexity": 2,
          "x": 510,
          "y": 962,
          "width": 28,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 11,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 76,
          "dependencies": [
            "@radix-ui/react-slot",
            "class-variance-authority",
            "@/lib/utils",
            "@/components/ui/separator"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-button-tsx",
          "name": "button.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/button.tsx",
          "fileType": "function",
          "floors": 2,
          "complexity": 2,
          "x": 230,
          "y": 1012,
          "width": 28,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 10,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 53,
          "dependencies": [
            "react",
            "@radix-ui/react-slot",
            "class-variance-authority",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-calendar-tsx",
          "name": "calendar.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/calendar.tsx",
          "fileType": "function",
          "floors": 5,
          "complexity": 9,
          "x": 270,
          "y": 1012,
          "width": 36,
          "height": 60,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 20,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 203,
          "dependencies": [
            "react",
            "lucide-react",
            "react-day-picker",
            "@/lib/utils",
            "@/components/ui/button"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-card-tsx",
          "name": "card.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/card.tsx",
          "fileType": "function",
          "floors": 2,
          "complexity": 1,
          "x": 318,
          "y": 1012,
          "width": 28,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 7,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 68,
          "dependencies": [
            "react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-carousel-tsx",
          "name": "carousel.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/carousel.tsx",
          "fileType": "function",
          "floors": 5,
          "complexity": 20,
          "x": 358,
          "y": 1012,
          "width": 54,
          "height": 60,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 21,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 231,
          "dependencies": [
            "react",
            "embla-carousel-react",
            "lucide-react",
            "@/lib/utils",
            "@/components/ui/button"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-chart-tsx",
          "name": "chart.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/chart.tsx",
          "fileType": "function",
          "floors": 7,
          "complexity": 50,
          "x": 424,
          "y": 1012,
          "width": 54,
          "height": 76,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 22,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 330,
          "dependencies": [
            "react",
            "recharts",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-checkbox-tsx",
          "name": "checkbox.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/checkbox.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 490,
          "y": 1012,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 9,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 25,
          "dependencies": [
            "react",
            "@radix-ui/react-checkbox",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-collapsible-tsx",
          "name": "collapsible.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/collapsible.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 530,
          "y": 1012,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 2,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 6,
          "dependencies": [
            "@radix-ui/react-collapsible"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-command-tsx",
          "name": "command.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/command.tsx",
          "fileType": "function",
          "floors": 3,
          "complexity": 1,
          "x": 570,
          "y": 1012,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 18,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 136,
          "dependencies": [
            "react",
            "@radix-ui/react-dialog",
            "cmdk",
            "lucide-react",
            "@/lib/utils",
            "@/components/ui/dialog"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-context-menu-tsx",
          "name": "context-menu.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/context-menu.tsx",
          "fileType": "function",
          "floors": 4,
          "complexity": 4,
          "x": 230,
          "y": 1078,
          "width": 28,
          "height": 52,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 17,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 181,
          "dependencies": [
            "react",
            "@radix-ui/react-context-menu",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-dialog-tsx",
          "name": "dialog.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/dialog.tsx",
          "fileType": "function",
          "floors": 3,
          "complexity": 1,
          "x": 270,
          "y": 1078,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 13,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 108,
          "dependencies": [
            "react",
            "@radix-ui/react-dialog",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-drawer-tsx",
          "name": "drawer.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/drawer.tsx",
          "fileType": "function",
          "floors": 3,
          "complexity": 1,
          "x": 310,
          "y": 1078,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 11,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 104,
          "dependencies": [
            "react",
            "vaul",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-dropdown-menu-tsx",
          "name": "dropdown-menu.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/dropdown-menu.tsx",
          "fileType": "function",
          "floors": 4,
          "complexity": 4,
          "x": 350,
          "y": 1078,
          "width": 28,
          "height": 52,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 17,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 183,
          "dependencies": [
            "react",
            "@radix-ui/react-dropdown-menu",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-empty-tsx",
          "name": "empty.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/empty.tsx",
          "fileType": "function",
          "floors": 2,
          "complexity": 1,
          "x": 390,
          "y": 1078,
          "width": 28,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 8,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 95,
          "dependencies": [
            "class-variance-authority",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-field-tsx",
          "name": "field.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/field.tsx",
          "fileType": "function",
          "floors": 5,
          "complexity": 11,
          "x": 430,
          "y": 1078,
          "width": 36,
          "height": 60,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 21,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 225,
          "dependencies": [
            "react",
            "class-variance-authority",
            "@/lib/utils",
            "@/components/ui/label",
            "@/components/ui/separator"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-form-tsx",
          "name": "form.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/form.tsx",
          "fileType": "function",
          "floors": 4,
          "complexity": 9,
          "x": 478,
          "y": 1078,
          "width": 36,
          "height": 52,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 19,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 151,
          "dependencies": [
            "react",
            "@radix-ui/react-label",
            "@radix-ui/react-slot",
            "react-hook-form",
            "@/lib/utils",
            "@/components/ui/label"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-hover-card-tsx",
          "name": "hover-card.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/hover-card.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 526,
          "y": 1078,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 7,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 22,
          "dependencies": [
            "react",
            "@radix-ui/react-hover-card",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-input-group-tsx",
          "name": "input-group.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/input-group.tsx",
          "fileType": "function",
          "floors": 4,
          "complexity": 4,
          "x": 230,
          "y": 1144,
          "width": 28,
          "height": 52,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 19,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 151,
          "dependencies": [
            "react",
            "class-variance-authority",
            "@/lib/utils",
            "@/components/ui/button",
            "@/components/ui/input",
            "@/components/ui/textarea"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-input-otp-tsx",
          "name": "input-otp.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/input-otp.tsx",
          "fileType": "function",
          "floors": 2,
          "complexity": 3,
          "x": 270,
          "y": 1144,
          "width": 28,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 11,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 62,
          "dependencies": [
            "react",
            "input-otp",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-input-tsx",
          "name": "input.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/input.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 310,
          "y": 1144,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 4,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 19,
          "dependencies": [
            "react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-item-tsx",
          "name": "item.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/item.tsx",
          "fileType": "function",
          "floors": 4,
          "complexity": 2,
          "x": 350,
          "y": 1144,
          "width": 28,
          "height": 52,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 18,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 179,
          "dependencies": [
            "react",
            "@radix-ui/react-slot",
            "class-variance-authority",
            "@/lib/utils",
            "@/components/ui/separator"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-kbd-tsx",
          "name": "kbd.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/kbd.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 390,
          "y": 1144,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 3,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 25,
          "dependencies": [
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-label-tsx",
          "name": "label.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/label.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 430,
          "y": 1144,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 9,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 21,
          "dependencies": [
            "react",
            "@radix-ui/react-label",
            "class-variance-authority",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-menubar-tsx",
          "name": "menubar.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/menubar.tsx",
          "fileType": "function",
          "floors": 5,
          "complexity": 4,
          "x": 470,
          "y": 1144,
          "width": 28,
          "height": 60,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 19,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 236,
          "dependencies": [
            "react",
            "@radix-ui/react-menubar",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-navigation-menu-tsx",
          "name": "navigation-menu.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/navigation-menu.tsx",
          "fileType": "function",
          "floors": 3,
          "complexity": 1,
          "x": 510,
          "y": 1144,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 15,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 117,
          "dependencies": [
            "react",
            "@radix-ui/react-navigation-menu",
            "class-variance-authority",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-pagination-tsx",
          "name": "pagination.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/pagination.tsx",
          "fileType": "function",
          "floors": 3,
          "complexity": 3,
          "x": 230,
          "y": 1202,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 13,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 107,
          "dependencies": [
            "react",
            "lucide-react",
            "@/lib/utils",
            "@/components/ui/button"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-popover-tsx",
          "name": "popover.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/popover.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 270,
          "y": 1202,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 7,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 25,
          "dependencies": [
            "react",
            "@radix-ui/react-popover",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-progress-tsx",
          "name": "progress.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/progress.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 2,
          "x": 310,
          "y": 1202,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 7,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 24,
          "dependencies": [
            "react",
            "@radix-ui/react-progress",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-radio-group-tsx",
          "name": "radio-group.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/radio-group.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 350,
          "y": 1202,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 9,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 38,
          "dependencies": [
            "react",
            "@radix-ui/react-radio-group",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-resizable-tsx",
          "name": "resizable.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/resizable.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 2,
          "x": 390,
          "y": 1202,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 7,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 39,
          "dependencies": [
            "lucide-react",
            "react-resizable-panels",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-scroll-area-tsx",
          "name": "scroll-area.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/scroll-area.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 3,
          "x": 430,
          "y": 1202,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 8,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 42,
          "dependencies": [
            "react",
            "@radix-ui/react-scroll-area",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-select-tsx",
          "name": "select.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/select.tsx",
          "fileType": "function",
          "floors": 3,
          "complexity": 3,
          "x": 470,
          "y": 1202,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 15,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 146,
          "dependencies": [
            "react",
            "@radix-ui/react-select",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-separator-tsx",
          "name": "separator.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/separator.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 2,
          "x": 510,
          "y": 1202,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 7,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 26,
          "dependencies": [
            "react",
            "@radix-ui/react-separator",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-sheet-tsx",
          "name": "sheet.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/sheet.tsx",
          "fileType": "function",
          "floors": 3,
          "complexity": 1,
          "x": 230,
          "y": 1260,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 16,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 125,
          "dependencies": [
            "react",
            "@radix-ui/react-dialog",
            "class-variance-authority",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-sidebar-tsx",
          "name": "sidebar.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/sidebar.tsx",
          "fileType": "function",
          "floors": 10,
          "complexity": 32,
          "x": 270,
          "y": 1260,
          "width": 54,
          "height": 100,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 57,
          "age": "aged",
          "language": "typescript",
          "linesOfCode": 660,
          "dependencies": [
            "react",
            "@radix-ui/react-slot",
            "class-variance-authority",
            "lucide-react",
            "@/hooks/use-mobile",
            "@/lib/utils",
            "@/components/ui/button",
            "@/components/ui/input",
            "@/components/ui/separator",
            "@/components/ui/sheet",
            "@/components/ui/skeleton",
            "@/components/ui/tooltip"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-skeleton-tsx",
          "name": "skeleton.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/skeleton.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 336,
          "y": 1260,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 2,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 13,
          "dependencies": [
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-slider-tsx",
          "name": "slider.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/slider.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 376,
          "y": 1260,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 7,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 23,
          "dependencies": [
            "react",
            "@radix-ui/react-slider",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-sonner-tsx",
          "name": "sonner.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/sonner.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 416,
          "y": 1260,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 5,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 26,
          "dependencies": [
            "next-themes",
            "sonner"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-spinner-tsx",
          "name": "spinner.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/spinner.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 456,
          "y": 1260,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 4,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 13,
          "dependencies": [
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-switch-tsx",
          "name": "switch.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/switch.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 2,
          "x": 496,
          "y": 1260,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 7,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 24,
          "dependencies": [
            "react",
            "@radix-ui/react-switch",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-table-tsx",
          "name": "table.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/table.tsx",
          "fileType": "function",
          "floors": 3,
          "complexity": 1,
          "x": 536,
          "y": 1260,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 9,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 110,
          "dependencies": [
            "react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-tabs-tsx",
          "name": "tabs.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/tabs.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 230,
          "y": 1302,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 8,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 47,
          "dependencies": [
            "react",
            "@radix-ui/react-tabs",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-textarea-tsx",
          "name": "textarea.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/textarea.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 270,
          "y": 1302,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 4,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 19,
          "dependencies": [
            "react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-toast-tsx",
          "name": "toast.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/toast.tsx",
          "fileType": "function",
          "floors": 3,
          "complexity": 1,
          "x": 310,
          "y": 1302,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 15,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 115,
          "dependencies": [
            "react",
            "@radix-ui/react-toast",
            "class-variance-authority",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-toaster-tsx",
          "name": "toaster.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/toaster.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 3,
          "x": 350,
          "y": 1302,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 5,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 31,
          "dependencies": [
            "@/hooks/use-toast",
            "@/components/ui/toast"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-toggle-group-tsx",
          "name": "toggle-group.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/toggle-group.tsx",
          "fileType": "function",
          "floors": 2,
          "complexity": 3,
          "x": 390,
          "y": 1302,
          "width": 28,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 12,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 52,
          "dependencies": [
            "react",
            "@radix-ui/react-toggle-group",
            "class-variance-authority",
            "@/lib/utils",
            "@/components/ui/toggle"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-toggle-tsx",
          "name": "toggle.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/toggle.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 430,
          "y": 1302,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 9,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 38,
          "dependencies": [
            "react",
            "@radix-ui/react-toggle",
            "class-variance-authority",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-components-ui-tooltip-tsx",
          "name": "tooltip.tsx",
          "filePath": "artifacts/mockup-sandbox/src/components/ui/tooltip.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 470,
          "y": 1302,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 7,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 25,
          "dependencies": [
            "react",
            "@radix-ui/react-tooltip",
            "@/lib/utils"
          ],
          "activeEvent": null
        }
      ],
      "healthScore": 22
    },
    {
      "id": "district-11",
      "name": "artifacts/mockup-sandbox/src/hooks",
      "path": "artifacts/mockup-sandbox/src/hooks",
      "type": "source",
      "x": 728,
      "y": 932,
      "width": 160,
      "height": 120,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-artifacts-mockup-sandbox-src-hooks-use-mobile-tsx",
          "name": "use-mobile.tsx",
          "filePath": "artifacts/mockup-sandbox/src/hooks/use-mobile.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 748,
          "y": 962,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 2,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 15,
          "dependencies": [
            "react"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-mockup-sandbox-src-hooks-use-toast-ts",
          "name": "use-toast.ts",
          "filePath": "artifacts/mockup-sandbox/src/hooks/use-toast.ts",
          "fileType": "function",
          "floors": 4,
          "complexity": 15,
          "x": 788,
          "y": 962,
          "width": 45,
          "height": 52,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 11,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 159,
          "dependencies": [
            "react",
            "@/components/ui/toast"
          ],
          "activeEvent": null
        }
      ],
      "healthScore": 20
    },
    {
      "id": "district-12",
      "name": "artifacts/mockup-sandbox/src/lib",
      "path": "artifacts/mockup-sandbox/src/lib",
      "type": "source",
      "x": 20,
      "y": 1404,
      "width": 160,
      "height": 120,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
          "name": "utils.ts",
          "filePath": "artifacts/mockup-sandbox/src/lib/utils.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 40,
          "y": 1434,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 4,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 5,
          "dependencies": [
            "clsx",
            "tailwind-merge"
          ],
          "activeEvent": null
        }
      ],
      "healthScore": 24
    },
    {
      "id": "district-13",
      "name": "artifacts/software-city/.replit-artifact",
      "path": "artifacts/software-city/.replit-artifact",
      "type": "source",
      "x": 210,
      "y": 1404,
      "width": 160,
      "height": 120,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-artifacts-software-city--replit-artifact-artifact-toml",
          "name": "artifact.toml",
          "filePath": "artifacts/software-city/.replit-artifact/artifact.toml",
          "fileType": "config",
          "floors": 1,
          "complexity": 1,
          "x": 230,
          "y": 1434,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "toml",
          "linesOfCode": 25,
          "dependencies": [],
          "activeEvent": null
        }
      ],
      "healthScore": 24
    },
    {
      "id": "district-14",
      "name": "artifacts/software-city",
      "path": "artifacts/software-city",
      "type": "source",
      "x": 400,
      "y": 1404,
      "width": 208,
      "height": 162,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-artifacts-software-city-components-json",
          "name": "components.json",
          "filePath": "artifacts/software-city/components.json",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 420,
          "y": 1434,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "json",
          "linesOfCode": 20,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-index-html",
          "name": "index.html",
          "filePath": "artifacts/software-city/index.html",
          "fileType": "function",
          "floors": 1,
          "complexity": 2,
          "x": 460,
          "y": 1434,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "html",
          "linesOfCode": 15,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-package-json",
          "name": "package.json",
          "filePath": "artifacts/software-city/package.json",
          "fileType": "config",
          "floors": 2,
          "complexity": 2,
          "x": 500,
          "y": 1434,
          "width": 28,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 4,
          "age": "new",
          "language": "json",
          "linesOfCode": 80,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-requirements-yaml",
          "name": "requirements.yaml",
          "filePath": "artifacts/software-city/requirements.yaml",
          "fileType": "config",
          "floors": 1,
          "complexity": 5,
          "x": 420,
          "y": 1476,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "yaml",
          "linesOfCode": 16,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-tsconfig-json",
          "name": "tsconfig.json",
          "filePath": "artifacts/software-city/tsconfig.json",
          "fileType": "config",
          "floors": 1,
          "complexity": 1,
          "x": 460,
          "y": 1476,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "json",
          "linesOfCode": 22,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-vite-config-ts",
          "name": "vite.config.ts",
          "filePath": "artifacts/software-city/vite.config.ts",
          "fileType": "config",
          "floors": 2,
          "complexity": 10,
          "x": 500,
          "y": 1476,
          "width": 36,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 14,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 85,
          "dependencies": [
            "vite",
            "@vitejs/plugin-react",
            "@tailwindcss/vite",
            "path",
            "@replit/vite-plugin-runtime-error-modal"
          ],
          "activeEvent": null
        }
      ],
      "healthScore": 23
    },
    {
      "id": "district-15",
      "name": "artifacts/software-city/src",
      "path": "artifacts/software-city/src",
      "type": "source",
      "x": 20,
      "y": 1596,
      "width": 160,
      "height": 162,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-artifacts-software-city-src-App-tsx",
          "name": "App.tsx",
          "filePath": "artifacts/software-city/src/App.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 40,
          "y": 1626,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 28,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 49,
          "dependencies": [
            "wouter",
            "@tanstack/react-query",
            "@/components/ui/toaster",
            "@/components/ui/tooltip",
            "@/pages/not-found",
            "@/pages/Landing",
            "@/pages/CityView",
            "@/pages/Agents",
            "@/pages/KnowledgeBase",
            "@/pages/SharedCity",
            "@/pages/Leaderboard",
            "@/pages/Metrics",
            "@/pages/Settings"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-index-css",
          "name": "index.css",
          "filePath": "artifacts/software-city/src/index.css",
          "fileType": "function",
          "floors": 4,
          "complexity": 3,
          "x": 80,
          "y": 1626,
          "width": 28,
          "height": 52,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 11,
          "age": "new",
          "language": "css",
          "linesOfCode": 152,
          "dependencies": [
            "tailwindcss",
            "tw-animate-css"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-main-tsx",
          "name": "main.tsx",
          "filePath": "artifacts/software-city/src/main.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 40,
          "y": 1668,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 6,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 4,
          "dependencies": [
            "react-dom/client",
            "./App",
            "./index.css"
          ],
          "activeEvent": null
        }
      ],
      "healthScore": 24
    },
    {
      "id": "district-16",
      "name": "artifacts/software-city/src/components",
      "path": "artifacts/software-city/src/components",
      "type": "source",
      "x": 210,
      "y": 1596,
      "width": 160,
      "height": 120,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-artifacts-software-city-src-components-GuidedTour-tsx",
          "name": "GuidedTour.tsx",
          "filePath": "artifacts/software-city/src/components/GuidedTour.tsx",
          "fileType": "function",
          "floors": 5,
          "complexity": 25,
          "x": 230,
          "y": 1626,
          "width": 54,
          "height": 60,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 16,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 211,
          "dependencies": [
            "react",
            "framer-motion",
            "lucide-react"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ShortcutsPanel-tsx",
          "name": "ShortcutsPanel.tsx",
          "filePath": "artifacts/software-city/src/components/ShortcutsPanel.tsx",
          "fileType": "function",
          "floors": 2,
          "complexity": 4,
          "x": 296,
          "y": 1626,
          "width": 28,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 8,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 80,
          "dependencies": [
            "framer-motion",
            "lucide-react"
          ],
          "activeEvent": null
        }
      ],
      "healthScore": 15
    },
    {
      "id": "district-17",
      "name": "artifacts/software-city/src/components/city",
      "path": "artifacts/software-city/src/components/city",
      "type": "source",
      "x": 400,
      "y": 1596,
      "width": 160,
      "height": 162,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-artifacts-software-city-src-components-city-BuildingInspector-tsx",
          "name": "BuildingInspector.tsx",
          "filePath": "artifacts/software-city/src/components/city/BuildingInspector.tsx",
          "fileType": "function",
          "floors": 10,
          "complexity": 50,
          "x": 420,
          "y": 1626,
          "width": 54,
          "height": 100,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 38,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 482,
          "dependencies": [
            "react",
            "@workspace/api-client-react",
            "@/components/ui/button",
            "@/lib/utils",
            "lucide-react",
            "@/hooks/use-toast",
            "@/components/ui/dialog"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-city-CityMap-tsx",
          "name": "CityMap.tsx",
          "filePath": "artifacts/software-city/src/components/city/CityMap.tsx",
          "fileType": "function",
          "floors": 10,
          "complexity": 50,
          "x": 486,
          "y": 1626,
          "width": 54,
          "height": 100,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 41,
          "age": "aged",
          "language": "typescript",
          "linesOfCode": 710,
          "dependencies": [
            "react",
            "framer-motion",
            "@workspace/api-client-react"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-city-HUD-tsx",
          "name": "HUD.tsx",
          "filePath": "artifacts/software-city/src/components/city/HUD.tsx",
          "fileType": "function",
          "floors": 5,
          "complexity": 50,
          "x": 420,
          "y": 1700,
          "width": 54,
          "height": 60,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 19,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 228,
          "dependencies": [
            "@workspace/api-client-react",
            "lucide-react",
            "@/lib/utils",
            "react"
          ],
          "activeEvent": null
        }
      ],
      "healthScore": 5
    },
    {
      "id": "district-18",
      "name": "artifacts/software-city/src/components/layout",
      "path": "artifacts/software-city/src/components/layout",
      "type": "source",
      "x": 20,
      "y": 1788,
      "width": 160,
      "height": 120,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-artifacts-software-city-src-components-layout-AppLayout-tsx",
          "name": "AppLayout.tsx",
          "filePath": "artifacts/software-city/src/components/layout/AppLayout.tsx",
          "fileType": "function",
          "floors": 5,
          "complexity": 46,
          "x": 40,
          "y": 1818,
          "width": 54,
          "height": 60,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 24,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 209,
          "dependencies": [
            "wouter",
            "lucide-react",
            "react",
            "@/lib/utils",
            "@workspace/api-client-react",
            "date-fns",
            "@/hooks/useWebSocket"
          ],
          "activeEvent": null
        }
      ],
      "healthScore": 5
    },
    {
      "id": "district-19",
      "name": "artifacts/software-city/src/components/ui",
      "path": "artifacts/software-city/src/components/ui",
      "type": "source",
      "x": 210,
      "y": 1788,
      "width": 488,
      "height": 442,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-artifacts-software-city-src-components-ui-accordion-tsx",
          "name": "accordion.tsx",
          "filePath": "artifacts/software-city/src/components/ui/accordion.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 230,
          "y": 1818,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 10,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 49,
          "dependencies": [
            "react",
            "@radix-ui/react-accordion",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-alert-dialog-tsx",
          "name": "alert-dialog.tsx",
          "filePath": "artifacts/software-city/src/components/ui/alert-dialog.tsx",
          "fileType": "function",
          "floors": 3,
          "complexity": 1,
          "x": 270,
          "y": 1818,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 14,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 126,
          "dependencies": [
            "react",
            "@radix-ui/react-alert-dialog",
            "@/lib/utils",
            "@/components/ui/button"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-alert-tsx",
          "name": "alert.tsx",
          "filePath": "artifacts/software-city/src/components/ui/alert.tsx",
          "fileType": "function",
          "floors": 2,
          "complexity": 1,
          "x": 310,
          "y": 1818,
          "width": 28,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 8,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 53,
          "dependencies": [
            "react",
            "class-variance-authority",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-aspect-ratio-tsx",
          "name": "aspect-ratio.tsx",
          "filePath": "artifacts/software-city/src/components/ui/aspect-ratio.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 350,
          "y": 1818,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 2,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 3,
          "dependencies": [
            "@radix-ui/react-aspect-ratio"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-avatar-tsx",
          "name": "avatar.tsx",
          "filePath": "artifacts/software-city/src/components/ui/avatar.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 390,
          "y": 1818,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 8,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 44,
          "dependencies": [
            "react",
            "@radix-ui/react-avatar",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-badge-tsx",
          "name": "badge.tsx",
          "filePath": "artifacts/software-city/src/components/ui/badge.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 430,
          "y": 1818,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 7,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 32,
          "dependencies": [
            "react",
            "class-variance-authority",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-breadcrumb-tsx",
          "name": "breadcrumb.tsx",
          "filePath": "artifacts/software-city/src/components/ui/breadcrumb.tsx",
          "fileType": "function",
          "floors": 3,
          "complexity": 3,
          "x": 470,
          "y": 1818,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 13,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 105,
          "dependencies": [
            "react",
            "@radix-ui/react-slot",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-button-group-tsx",
          "name": "button-group.tsx",
          "filePath": "artifacts/software-city/src/components/ui/button-group.tsx",
          "fileType": "function",
          "floors": 2,
          "complexity": 2,
          "x": 510,
          "y": 1818,
          "width": 28,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 11,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 76,
          "dependencies": [
            "@radix-ui/react-slot",
            "class-variance-authority",
            "@/lib/utils",
            "@/components/ui/separator"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-button-tsx",
          "name": "button.tsx",
          "filePath": "artifacts/software-city/src/components/ui/button.tsx",
          "fileType": "function",
          "floors": 2,
          "complexity": 2,
          "x": 230,
          "y": 1868,
          "width": 28,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 10,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 53,
          "dependencies": [
            "react",
            "@radix-ui/react-slot",
            "class-variance-authority",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-calendar-tsx",
          "name": "calendar.tsx",
          "filePath": "artifacts/software-city/src/components/ui/calendar.tsx",
          "fileType": "function",
          "floors": 5,
          "complexity": 9,
          "x": 270,
          "y": 1868,
          "width": 36,
          "height": 60,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 20,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 203,
          "dependencies": [
            "react",
            "lucide-react",
            "react-day-picker",
            "@/lib/utils",
            "@/components/ui/button"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-card-tsx",
          "name": "card.tsx",
          "filePath": "artifacts/software-city/src/components/ui/card.tsx",
          "fileType": "function",
          "floors": 2,
          "complexity": 1,
          "x": 318,
          "y": 1868,
          "width": 28,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 7,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 68,
          "dependencies": [
            "react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-carousel-tsx",
          "name": "carousel.tsx",
          "filePath": "artifacts/software-city/src/components/ui/carousel.tsx",
          "fileType": "function",
          "floors": 5,
          "complexity": 20,
          "x": 358,
          "y": 1868,
          "width": 54,
          "height": 60,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 21,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 231,
          "dependencies": [
            "react",
            "embla-carousel-react",
            "lucide-react",
            "@/lib/utils",
            "@/components/ui/button"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-chart-tsx",
          "name": "chart.tsx",
          "filePath": "artifacts/software-city/src/components/ui/chart.tsx",
          "fileType": "function",
          "floors": 7,
          "complexity": 50,
          "x": 424,
          "y": 1868,
          "width": 54,
          "height": 76,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 22,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 330,
          "dependencies": [
            "react",
            "recharts",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-checkbox-tsx",
          "name": "checkbox.tsx",
          "filePath": "artifacts/software-city/src/components/ui/checkbox.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 490,
          "y": 1868,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 9,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 25,
          "dependencies": [
            "react",
            "@radix-ui/react-checkbox",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-collapsible-tsx",
          "name": "collapsible.tsx",
          "filePath": "artifacts/software-city/src/components/ui/collapsible.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 530,
          "y": 1868,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 2,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 6,
          "dependencies": [
            "@radix-ui/react-collapsible"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-command-tsx",
          "name": "command.tsx",
          "filePath": "artifacts/software-city/src/components/ui/command.tsx",
          "fileType": "function",
          "floors": 3,
          "complexity": 1,
          "x": 570,
          "y": 1868,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 18,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 136,
          "dependencies": [
            "react",
            "@radix-ui/react-dialog",
            "cmdk",
            "lucide-react",
            "@/lib/utils",
            "@/components/ui/dialog"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-context-menu-tsx",
          "name": "context-menu.tsx",
          "filePath": "artifacts/software-city/src/components/ui/context-menu.tsx",
          "fileType": "function",
          "floors": 4,
          "complexity": 4,
          "x": 230,
          "y": 1934,
          "width": 28,
          "height": 52,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 17,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 181,
          "dependencies": [
            "react",
            "@radix-ui/react-context-menu",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-dialog-tsx",
          "name": "dialog.tsx",
          "filePath": "artifacts/software-city/src/components/ui/dialog.tsx",
          "fileType": "function",
          "floors": 3,
          "complexity": 1,
          "x": 270,
          "y": 1934,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 13,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 108,
          "dependencies": [
            "react",
            "@radix-ui/react-dialog",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-drawer-tsx",
          "name": "drawer.tsx",
          "filePath": "artifacts/software-city/src/components/ui/drawer.tsx",
          "fileType": "function",
          "floors": 3,
          "complexity": 1,
          "x": 310,
          "y": 1934,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 11,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 104,
          "dependencies": [
            "react",
            "vaul",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-dropdown-menu-tsx",
          "name": "dropdown-menu.tsx",
          "filePath": "artifacts/software-city/src/components/ui/dropdown-menu.tsx",
          "fileType": "function",
          "floors": 4,
          "complexity": 4,
          "x": 350,
          "y": 1934,
          "width": 28,
          "height": 52,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 17,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 183,
          "dependencies": [
            "react",
            "@radix-ui/react-dropdown-menu",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-empty-tsx",
          "name": "empty.tsx",
          "filePath": "artifacts/software-city/src/components/ui/empty.tsx",
          "fileType": "function",
          "floors": 2,
          "complexity": 1,
          "x": 390,
          "y": 1934,
          "width": 28,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 8,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 95,
          "dependencies": [
            "class-variance-authority",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-field-tsx",
          "name": "field.tsx",
          "filePath": "artifacts/software-city/src/components/ui/field.tsx",
          "fileType": "function",
          "floors": 5,
          "complexity": 11,
          "x": 430,
          "y": 1934,
          "width": 36,
          "height": 60,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 21,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 225,
          "dependencies": [
            "react",
            "class-variance-authority",
            "@/lib/utils",
            "@/components/ui/label",
            "@/components/ui/separator"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-form-tsx",
          "name": "form.tsx",
          "filePath": "artifacts/software-city/src/components/ui/form.tsx",
          "fileType": "function",
          "floors": 4,
          "complexity": 9,
          "x": 478,
          "y": 1934,
          "width": 36,
          "height": 52,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 19,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 151,
          "dependencies": [
            "react",
            "@radix-ui/react-label",
            "@radix-ui/react-slot",
            "react-hook-form",
            "@/lib/utils",
            "@/components/ui/label"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-hover-card-tsx",
          "name": "hover-card.tsx",
          "filePath": "artifacts/software-city/src/components/ui/hover-card.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 526,
          "y": 1934,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 7,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 22,
          "dependencies": [
            "react",
            "@radix-ui/react-hover-card",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-input-group-tsx",
          "name": "input-group.tsx",
          "filePath": "artifacts/software-city/src/components/ui/input-group.tsx",
          "fileType": "function",
          "floors": 4,
          "complexity": 4,
          "x": 230,
          "y": 2000,
          "width": 28,
          "height": 52,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 19,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 151,
          "dependencies": [
            "react",
            "class-variance-authority",
            "@/lib/utils",
            "@/components/ui/button",
            "@/components/ui/input",
            "@/components/ui/textarea"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-input-otp-tsx",
          "name": "input-otp.tsx",
          "filePath": "artifacts/software-city/src/components/ui/input-otp.tsx",
          "fileType": "function",
          "floors": 2,
          "complexity": 3,
          "x": 270,
          "y": 2000,
          "width": 28,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 11,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 62,
          "dependencies": [
            "react",
            "input-otp",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-input-tsx",
          "name": "input.tsx",
          "filePath": "artifacts/software-city/src/components/ui/input.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 310,
          "y": 2000,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 4,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 19,
          "dependencies": [
            "react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-item-tsx",
          "name": "item.tsx",
          "filePath": "artifacts/software-city/src/components/ui/item.tsx",
          "fileType": "function",
          "floors": 4,
          "complexity": 2,
          "x": 350,
          "y": 2000,
          "width": 28,
          "height": 52,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 18,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 179,
          "dependencies": [
            "react",
            "@radix-ui/react-slot",
            "class-variance-authority",
            "@/lib/utils",
            "@/components/ui/separator"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-kbd-tsx",
          "name": "kbd.tsx",
          "filePath": "artifacts/software-city/src/components/ui/kbd.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 390,
          "y": 2000,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 3,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 25,
          "dependencies": [
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-label-tsx",
          "name": "label.tsx",
          "filePath": "artifacts/software-city/src/components/ui/label.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 430,
          "y": 2000,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 9,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 21,
          "dependencies": [
            "react",
            "@radix-ui/react-label",
            "class-variance-authority",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-menubar-tsx",
          "name": "menubar.tsx",
          "filePath": "artifacts/software-city/src/components/ui/menubar.tsx",
          "fileType": "function",
          "floors": 5,
          "complexity": 4,
          "x": 470,
          "y": 2000,
          "width": 28,
          "height": 60,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 19,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 236,
          "dependencies": [
            "react",
            "@radix-ui/react-menubar",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-navigation-menu-tsx",
          "name": "navigation-menu.tsx",
          "filePath": "artifacts/software-city/src/components/ui/navigation-menu.tsx",
          "fileType": "function",
          "floors": 3,
          "complexity": 1,
          "x": 510,
          "y": 2000,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 15,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 117,
          "dependencies": [
            "react",
            "@radix-ui/react-navigation-menu",
            "class-variance-authority",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-pagination-tsx",
          "name": "pagination.tsx",
          "filePath": "artifacts/software-city/src/components/ui/pagination.tsx",
          "fileType": "function",
          "floors": 3,
          "complexity": 3,
          "x": 230,
          "y": 2058,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 13,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 107,
          "dependencies": [
            "react",
            "lucide-react",
            "@/lib/utils",
            "@/components/ui/button"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-popover-tsx",
          "name": "popover.tsx",
          "filePath": "artifacts/software-city/src/components/ui/popover.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 270,
          "y": 2058,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 7,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 25,
          "dependencies": [
            "react",
            "@radix-ui/react-popover",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-progress-tsx",
          "name": "progress.tsx",
          "filePath": "artifacts/software-city/src/components/ui/progress.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 2,
          "x": 310,
          "y": 2058,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 7,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 24,
          "dependencies": [
            "react",
            "@radix-ui/react-progress",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-radio-group-tsx",
          "name": "radio-group.tsx",
          "filePath": "artifacts/software-city/src/components/ui/radio-group.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 350,
          "y": 2058,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 9,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 38,
          "dependencies": [
            "react",
            "@radix-ui/react-radio-group",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-resizable-tsx",
          "name": "resizable.tsx",
          "filePath": "artifacts/software-city/src/components/ui/resizable.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 2,
          "x": 390,
          "y": 2058,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 7,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 39,
          "dependencies": [
            "lucide-react",
            "react-resizable-panels",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-scroll-area-tsx",
          "name": "scroll-area.tsx",
          "filePath": "artifacts/software-city/src/components/ui/scroll-area.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 3,
          "x": 430,
          "y": 2058,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 8,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 42,
          "dependencies": [
            "react",
            "@radix-ui/react-scroll-area",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-select-tsx",
          "name": "select.tsx",
          "filePath": "artifacts/software-city/src/components/ui/select.tsx",
          "fileType": "function",
          "floors": 3,
          "complexity": 3,
          "x": 470,
          "y": 2058,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 15,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 146,
          "dependencies": [
            "react",
            "@radix-ui/react-select",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-separator-tsx",
          "name": "separator.tsx",
          "filePath": "artifacts/software-city/src/components/ui/separator.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 2,
          "x": 510,
          "y": 2058,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 7,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 26,
          "dependencies": [
            "react",
            "@radix-ui/react-separator",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-sheet-tsx",
          "name": "sheet.tsx",
          "filePath": "artifacts/software-city/src/components/ui/sheet.tsx",
          "fileType": "function",
          "floors": 3,
          "complexity": 1,
          "x": 230,
          "y": 2116,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 16,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 125,
          "dependencies": [
            "react",
            "@radix-ui/react-dialog",
            "class-variance-authority",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-sidebar-tsx",
          "name": "sidebar.tsx",
          "filePath": "artifacts/software-city/src/components/ui/sidebar.tsx",
          "fileType": "function",
          "floors": 10,
          "complexity": 34,
          "x": 270,
          "y": 2116,
          "width": 54,
          "height": 100,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 57,
          "age": "aged",
          "language": "typescript",
          "linesOfCode": 661,
          "dependencies": [
            "react",
            "@radix-ui/react-slot",
            "class-variance-authority",
            "lucide-react",
            "@/hooks/use-mobile",
            "@/lib/utils",
            "@/components/ui/button",
            "@/components/ui/input",
            "@/components/ui/separator",
            "@/components/ui/sheet",
            "@/components/ui/skeleton",
            "@/components/ui/tooltip"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-skeleton-tsx",
          "name": "skeleton.tsx",
          "filePath": "artifacts/software-city/src/components/ui/skeleton.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 336,
          "y": 2116,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 2,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 13,
          "dependencies": [
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-slider-tsx",
          "name": "slider.tsx",
          "filePath": "artifacts/software-city/src/components/ui/slider.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 376,
          "y": 2116,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 7,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 23,
          "dependencies": [
            "react",
            "@radix-ui/react-slider",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-sonner-tsx",
          "name": "sonner.tsx",
          "filePath": "artifacts/software-city/src/components/ui/sonner.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 416,
          "y": 2116,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 5,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 26,
          "dependencies": [
            "next-themes",
            "sonner"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-spinner-tsx",
          "name": "spinner.tsx",
          "filePath": "artifacts/software-city/src/components/ui/spinner.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 456,
          "y": 2116,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 4,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 13,
          "dependencies": [
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-switch-tsx",
          "name": "switch.tsx",
          "filePath": "artifacts/software-city/src/components/ui/switch.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 2,
          "x": 496,
          "y": 2116,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 7,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 24,
          "dependencies": [
            "react",
            "@radix-ui/react-switch",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-table-tsx",
          "name": "table.tsx",
          "filePath": "artifacts/software-city/src/components/ui/table.tsx",
          "fileType": "function",
          "floors": 3,
          "complexity": 1,
          "x": 536,
          "y": 2116,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 9,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 110,
          "dependencies": [
            "react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-tabs-tsx",
          "name": "tabs.tsx",
          "filePath": "artifacts/software-city/src/components/ui/tabs.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 230,
          "y": 2158,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 8,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 47,
          "dependencies": [
            "react",
            "@radix-ui/react-tabs",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-textarea-tsx",
          "name": "textarea.tsx",
          "filePath": "artifacts/software-city/src/components/ui/textarea.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 270,
          "y": 2158,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 4,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 19,
          "dependencies": [
            "react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-toast-tsx",
          "name": "toast.tsx",
          "filePath": "artifacts/software-city/src/components/ui/toast.tsx",
          "fileType": "function",
          "floors": 3,
          "complexity": 1,
          "x": 310,
          "y": 2158,
          "width": 28,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 15,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 115,
          "dependencies": [
            "react",
            "@radix-ui/react-toast",
            "class-variance-authority",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-toaster-tsx",
          "name": "toaster.tsx",
          "filePath": "artifacts/software-city/src/components/ui/toaster.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 3,
          "x": 350,
          "y": 2158,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 5,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 31,
          "dependencies": [
            "@/hooks/use-toast",
            "@/components/ui/toast"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-toggle-group-tsx",
          "name": "toggle-group.tsx",
          "filePath": "artifacts/software-city/src/components/ui/toggle-group.tsx",
          "fileType": "function",
          "floors": 2,
          "complexity": 3,
          "x": 390,
          "y": 2158,
          "width": 28,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 12,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 52,
          "dependencies": [
            "react",
            "@radix-ui/react-toggle-group",
            "class-variance-authority",
            "@/lib/utils",
            "@/components/ui/toggle"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-toggle-tsx",
          "name": "toggle.tsx",
          "filePath": "artifacts/software-city/src/components/ui/toggle.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 430,
          "y": 2158,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 9,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 38,
          "dependencies": [
            "react",
            "@radix-ui/react-toggle",
            "class-variance-authority",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-components-ui-tooltip-tsx",
          "name": "tooltip.tsx",
          "filePath": "artifacts/software-city/src/components/ui/tooltip.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 470,
          "y": 2158,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 7,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 25,
          "dependencies": [
            "react",
            "@radix-ui/react-tooltip",
            "@/lib/utils"
          ],
          "activeEvent": null
        }
      ],
      "healthScore": 22
    },
    {
      "id": "district-20",
      "name": "artifacts/software-city/src/hooks",
      "path": "artifacts/software-city/src/hooks",
      "type": "source",
      "x": 728,
      "y": 1788,
      "width": 160,
      "height": 162,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-artifacts-software-city-src-hooks-use-mobile-tsx",
          "name": "use-mobile.tsx",
          "filePath": "artifacts/software-city/src/hooks/use-mobile.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 748,
          "y": 1818,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 2,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 15,
          "dependencies": [
            "react"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-hooks-use-toast-ts",
          "name": "use-toast.ts",
          "filePath": "artifacts/software-city/src/hooks/use-toast.ts",
          "fileType": "function",
          "floors": 4,
          "complexity": 16,
          "x": 788,
          "y": 1818,
          "width": 54,
          "height": 52,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 11,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 159,
          "dependencies": [
            "react",
            "@/components/ui/toast"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-hooks-useWebSocket-ts",
          "name": "useWebSocket.ts",
          "filePath": "artifacts/software-city/src/hooks/useWebSocket.ts",
          "fileType": "function",
          "floors": 2,
          "complexity": 15,
          "x": 748,
          "y": 1868,
          "width": 45,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 5,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 66,
          "dependencies": [
            "react"
          ],
          "activeEvent": null
        }
      ],
      "healthScore": 18
    },
    {
      "id": "district-21",
      "name": "artifacts/software-city/src/lib",
      "path": "artifacts/software-city/src/lib",
      "type": "source",
      "x": 20,
      "y": 2260,
      "width": 160,
      "height": 120,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-artifacts-software-city-src-lib-utils-ts",
          "name": "utils.ts",
          "filePath": "artifacts/software-city/src/lib/utils.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 40,
          "y": 2290,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 4,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 5,
          "dependencies": [
            "clsx",
            "tailwind-merge"
          ],
          "activeEvent": null
        }
      ],
      "healthScore": 24
    },
    {
      "id": "district-22",
      "name": "artifacts/software-city/src/pages",
      "path": "artifacts/software-city/src/pages",
      "type": "source",
      "x": 210,
      "y": 2260,
      "width": 208,
      "height": 218,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-artifacts-software-city-src-pages-Agents-tsx",
          "name": "Agents.tsx",
          "filePath": "artifacts/software-city/src/pages/Agents.tsx",
          "fileType": "function",
          "floors": 5,
          "complexity": 36,
          "x": 230,
          "y": 2290,
          "width": 54,
          "height": 60,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 28,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 248,
          "dependencies": [
            "react",
            "@/components/layout/AppLayout",
            "@workspace/api-client-react",
            "@/components/ui/button",
            "lucide-react",
            "@/hooks/use-toast",
            "@/lib/utils",
            "@/components/ui/dialog"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-pages-CityView-tsx",
          "name": "CityView.tsx",
          "filePath": "artifacts/software-city/src/pages/CityView.tsx",
          "fileType": "function",
          "floors": 10,
          "complexity": 50,
          "x": 296,
          "y": 2290,
          "width": 54,
          "height": 100,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 120,
          "age": "ancient",
          "language": "typescript",
          "linesOfCode": 1777,
          "dependencies": [
            "react",
            "wouter",
            "@/components/layout/AppLayout",
            "@/components/city/CityMap",
            "@/components/city/BuildingInspector",
            "@/components/city/HUD",
            "@/components/GuidedTour",
            "@/components/ShortcutsPanel",
            "@workspace/api-client-react",
            "lucide-react",
            "@/lib/utils",
            "@/hooks/useWebSocket",
            "@/components/ui/button",
            "@/hooks/use-toast",
            "@/components/ui/dropdown-menu",
            "@/components/ui/dialog"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-pages-KnowledgeBase-tsx",
          "name": "KnowledgeBase.tsx",
          "filePath": "artifacts/software-city/src/pages/KnowledgeBase.tsx",
          "fileType": "function",
          "floors": 7,
          "complexity": 50,
          "x": 362,
          "y": 2290,
          "width": 54,
          "height": 76,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 36,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 332,
          "dependencies": [
            "react",
            "@/components/layout/AppLayout",
            "@workspace/api-client-react",
            "lucide-react",
            "date-fns",
            "@/components/ui/input",
            "@/components/ui/button",
            "@/components/ui/table",
            "@/hooks/use-toast",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-pages-Landing-tsx",
          "name": "Landing.tsx",
          "filePath": "artifacts/software-city/src/pages/Landing.tsx",
          "fileType": "function",
          "floors": 10,
          "complexity": 50,
          "x": 230,
          "y": 2404,
          "width": 54,
          "height": 100,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 46,
          "age": "aged",
          "language": "typescript",
          "linesOfCode": 536,
          "dependencies": [
            "react",
            "wouter",
            "@workspace/api-client-react",
            "@/components/ui/button",
            "@/components/ui/input",
            "lucide-react",
            "@/hooks/use-toast",
            "framer-motion",
            "@tanstack/react-query",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-pages-Leaderboard-tsx",
          "name": "Leaderboard.tsx",
          "filePath": "artifacts/software-city/src/pages/Leaderboard.tsx",
          "fileType": "function",
          "floors": 3,
          "complexity": 15,
          "x": 296,
          "y": 2404,
          "width": 45,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 15,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 143,
          "dependencies": [
            "@/components/layout/AppLayout",
            "@tanstack/react-query",
            "lucide-react",
            "@/lib/utils"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-pages-Metrics-tsx",
          "name": "Metrics.tsx",
          "filePath": "artifacts/software-city/src/pages/Metrics.tsx",
          "fileType": "function",
          "floors": 9,
          "complexity": 50,
          "x": 353,
          "y": 2404,
          "width": 54,
          "height": 92,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 32,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 402,
          "dependencies": [
            "@tanstack/react-query",
            "@/components/layout/AppLayout",
            "@/lib/utils",
            "lucide-react",
            "date-fns",
            "react"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-pages-Settings-tsx",
          "name": "Settings.tsx",
          "filePath": "artifacts/software-city/src/pages/Settings.tsx",
          "fileType": "function",
          "floors": 9,
          "complexity": 28,
          "x": 230,
          "y": 2510,
          "width": 54,
          "height": 92,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 31,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 436,
          "dependencies": [
            "@tanstack/react-query",
            "@/components/layout/AppLayout",
            "@/lib/utils",
            "react",
            "lucide-react"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-pages-SharedCity-tsx",
          "name": "SharedCity.tsx",
          "filePath": "artifacts/software-city/src/pages/SharedCity.tsx",
          "fileType": "function",
          "floors": 3,
          "complexity": 12,
          "x": 296,
          "y": 2510,
          "width": 45,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 15,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 108,
          "dependencies": [
            "react",
            "@/components/city/CityMap",
            "wouter",
            "lucide-react",
            "@workspace/api-client-react"
          ],
          "activeEvent": null
        },
        {
          "id": "building-artifacts-software-city-src-pages-not-found-tsx",
          "name": "not-found.tsx",
          "filePath": "artifacts/software-city/src/pages/not-found.tsx",
          "fileType": "function",
          "floors": 1,
          "complexity": 2,
          "x": 353,
          "y": 2510,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 4,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 19,
          "dependencies": [
            "@/components/ui/card",
            "lucide-react"
          ],
          "activeEvent": null
        }
      ],
      "healthScore": 5
    },
    {
      "id": "district-23",
      "name": "lib/api-client-react",
      "path": "lib/api-client-react",
      "type": "api",
      "x": 448,
      "y": 2260,
      "width": 160,
      "height": 120,
      "color": "#2a1a0d",
      "buildings": [
        {
          "id": "building-lib-api-client-react-package-json",
          "name": "package.json",
          "filePath": "lib/api-client-react/package.json",
          "fileType": "config",
          "floors": 1,
          "complexity": 1,
          "x": 468,
          "y": 2290,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "json",
          "linesOfCode": 15,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-client-react-tsconfig-json",
          "name": "tsconfig.json",
          "filePath": "lib/api-client-react/tsconfig.json",
          "fileType": "config",
          "floors": 1,
          "complexity": 1,
          "x": 508,
          "y": 2290,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "json",
          "linesOfCode": 12,
          "dependencies": [],
          "activeEvent": null
        }
      ],
      "healthScore": 24
    },
    {
      "id": "district-24",
      "name": "lib/api-client-react/src",
      "path": "lib/api-client-react/src",
      "type": "source",
      "x": 20,
      "y": 2508,
      "width": 160,
      "height": 120,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-lib-api-client-react-src-custom-fetch-ts",
          "name": "custom-fetch.ts",
          "filePath": "lib/api-client-react/src/custom-fetch.ts",
          "fileType": "function",
          "floors": 5,
          "complexity": 50,
          "x": 40,
          "y": 2538,
          "width": 54,
          "height": 60,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 12,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 247,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-client-react-src-index-ts",
          "name": "index.ts",
          "filePath": "lib/api-client-react/src/index.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 106,
          "y": 2538,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 2,
          "dependencies": [],
          "activeEvent": null
        }
      ],
      "healthScore": 8
    },
    {
      "id": "district-25",
      "name": "lib/api-client-react/src/generated",
      "path": "lib/api-client-react/src/generated",
      "type": "source",
      "x": 210,
      "y": 2508,
      "width": 160,
      "height": 120,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-lib-api-client-react-src-generated-api-schemas-ts",
          "name": "api.schemas.ts",
          "filePath": "lib/api-client-react/src/generated/api.schemas.ts",
          "fileType": "function",
          "floors": 7,
          "complexity": 2,
          "x": 230,
          "y": 2538,
          "width": 28,
          "height": 76,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 16,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 322,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-client-react-src-generated-api-ts",
          "name": "api.ts",
          "filePath": "lib/api-client-react/src/generated/api.ts",
          "fileType": "function",
          "floors": 10,
          "complexity": 50,
          "x": 270,
          "y": 2538,
          "width": 54,
          "height": 100,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 48,
          "age": "aged",
          "language": "typescript",
          "linesOfCode": 845,
          "dependencies": [
            "@tanstack/react-query",
            "./api.schemas",
            "../custom-fetch"
          ],
          "activeEvent": null
        }
      ],
      "healthScore": 8
    },
    {
      "id": "district-26",
      "name": "lib/api-spec",
      "path": "lib/api-spec",
      "type": "test",
      "x": 400,
      "y": 2508,
      "width": 160,
      "height": 162,
      "color": "#0d3322",
      "buildings": [
        {
          "id": "building-lib-api-spec-openapi-yaml",
          "name": "openapi.yaml",
          "filePath": "lib/api-spec/openapi.yaml",
          "fileType": "config",
          "floors": 10,
          "complexity": 3,
          "x": 420,
          "y": 2538,
          "width": 28,
          "height": 100,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 38,
          "age": "modern",
          "language": "yaml",
          "linesOfCode": 769,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-spec-orval-config-ts",
          "name": "orval.config.ts",
          "filePath": "lib/api-spec/orval.config.ts",
          "fileType": "config",
          "floors": 2,
          "complexity": 2,
          "x": 460,
          "y": 2538,
          "width": 28,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 7,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 64,
          "dependencies": [
            "orval",
            "path"
          ],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-spec-package-json",
          "name": "package.json",
          "filePath": "lib/api-spec/package.json",
          "fileType": "config",
          "floors": 1,
          "complexity": 1,
          "x": 420,
          "y": 2580,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "json",
          "linesOfCode": 11,
          "dependencies": [],
          "activeEvent": null
        }
      ],
      "healthScore": 24
    },
    {
      "id": "district-27",
      "name": "lib/api-zod",
      "path": "lib/api-zod",
      "type": "api",
      "x": 20,
      "y": 2700,
      "width": 160,
      "height": 120,
      "color": "#2a1a0d",
      "buildings": [
        {
          "id": "building-lib-api-zod-package-json",
          "name": "package.json",
          "filePath": "lib/api-zod/package.json",
          "fileType": "config",
          "floors": 1,
          "complexity": 1,
          "x": 40,
          "y": 2730,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "json",
          "linesOfCode": 12,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-tsconfig-json",
          "name": "tsconfig.json",
          "filePath": "lib/api-zod/tsconfig.json",
          "fileType": "config",
          "floors": 1,
          "complexity": 1,
          "x": 80,
          "y": 2730,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "json",
          "linesOfCode": 11,
          "dependencies": [],
          "activeEvent": null
        }
      ],
      "healthScore": 24
    },
    {
      "id": "district-28",
      "name": "lib/api-zod/src/generated",
      "path": "lib/api-zod/src/generated",
      "type": "source",
      "x": 210,
      "y": 2700,
      "width": 160,
      "height": 120,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-lib-api-zod-src-generated-api-ts",
          "name": "api.ts",
          "filePath": "lib/api-zod/src/generated/api.ts",
          "fileType": "function",
          "floors": 6,
          "complexity": 2,
          "x": 230,
          "y": 2730,
          "width": 28,
          "height": 68,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 16,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 294,
          "dependencies": [
            "zod"
          ],
          "activeEvent": null
        }
      ],
      "healthScore": 24
    },
    {
      "id": "district-29",
      "name": "lib/api-zod/src/generated/types",
      "path": "lib/api-zod/src/generated/types",
      "type": "source",
      "x": 400,
      "y": 2700,
      "width": 376,
      "height": 386,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-lib-api-zod-src-generated-types-agent-ts",
          "name": "agent.ts",
          "filePath": "lib/api-zod/src/generated/types/agent.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 420,
          "y": 2730,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 4,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 19,
          "dependencies": [
            "./agentRole",
            "./agentStatus"
          ],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-agentList-ts",
          "name": "agentList.ts",
          "filePath": "lib/api-zod/src/generated/types/agentList.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 460,
          "y": 2730,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 2,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 5,
          "dependencies": [
            "./agent"
          ],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-agentRole-ts",
          "name": "agentRole.ts",
          "filePath": "lib/api-zod/src/generated/types/agentRole.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 500,
          "y": 2730,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 8,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-agentStatus-ts",
          "name": "agentStatus.ts",
          "filePath": "lib/api-zod/src/generated/types/agentStatus.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 540,
          "y": 2730,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 10,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-agentTaskRequest-ts",
          "name": "agentTaskRequest.ts",
          "filePath": "lib/api-zod/src/generated/types/agentTaskRequest.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 580,
          "y": 2730,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 2,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 6,
          "dependencies": [
            "./agentTaskRequestTaskType"
          ],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-agentTaskRequestTaskType-ts",
          "name": "agentTaskRequestTaskType.ts",
          "filePath": "lib/api-zod/src/generated/types/agentTaskRequestTaskType.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 620,
          "y": 2730,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 9,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-agentTaskResult-ts",
          "name": "agentTaskResult.ts",
          "filePath": "lib/api-zod/src/generated/types/agentTaskResult.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 420,
          "y": 2772,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 10,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-chatRequest-ts",
          "name": "chatRequest.ts",
          "filePath": "lib/api-zod/src/generated/types/chatRequest.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 460,
          "y": 2772,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 4,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-chatResponse-ts",
          "name": "chatResponse.ts",
          "filePath": "lib/api-zod/src/generated/types/chatResponse.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 500,
          "y": 2772,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 8,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-cityEvent-ts",
          "name": "cityEvent.ts",
          "filePath": "lib/api-zod/src/generated/types/cityEvent.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 540,
          "y": 2772,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 4,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 13,
          "dependencies": [
            "./cityEventSeverity",
            "./cityEventType"
          ],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-cityEventList-ts",
          "name": "cityEventList.ts",
          "filePath": "lib/api-zod/src/generated/types/cityEventList.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 580,
          "y": 2772,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 2,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 5,
          "dependencies": [
            "./cityEvent"
          ],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-cityEventSeverity-ts",
          "name": "cityEventSeverity.ts",
          "filePath": "lib/api-zod/src/generated/types/cityEventSeverity.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 620,
          "y": 2772,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 8,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-cityEventType-ts",
          "name": "cityEventType.ts",
          "filePath": "lib/api-zod/src/generated/types/cityEventType.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 420,
          "y": 2814,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 11,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-cityHealth-ts",
          "name": "cityHealth.ts",
          "filePath": "lib/api-zod/src/generated/types/cityHealth.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 460,
          "y": 2814,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 4,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 11,
          "dependencies": [
            "./cityHealthBreakdown",
            "./cityHealthSeason"
          ],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-cityHealthBreakdown-ts",
          "name": "cityHealthBreakdown.ts",
          "filePath": "lib/api-zod/src/generated/types/cityHealthBreakdown.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 500,
          "y": 2814,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 6,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-cityHealthSeason-ts",
          "name": "cityHealthSeason.ts",
          "filePath": "lib/api-zod/src/generated/types/cityHealthSeason.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 540,
          "y": 2814,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 8,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-cityLayout-ts",
          "name": "cityLayout.ts",
          "filePath": "lib/api-zod/src/generated/types/cityLayout.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 580,
          "y": 2814,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 6,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 12,
          "dependencies": [
            "./cityLayoutSeason",
            "./district",
            "./road"
          ],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-cityLayoutSeason-ts",
          "name": "cityLayoutSeason.ts",
          "filePath": "lib/api-zod/src/generated/types/cityLayoutSeason.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 620,
          "y": 2814,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 8,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-errorResponse-ts",
          "name": "errorResponse.ts",
          "filePath": "lib/api-zod/src/generated/types/errorResponse.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 420,
          "y": 2856,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 4,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-healthStatus-ts",
          "name": "healthStatus.ts",
          "filePath": "lib/api-zod/src/generated/types/healthStatus.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 460,
          "y": 2856,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 3,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-index-ts",
          "name": "index.ts",
          "filePath": "lib/api-zod/src/generated/types/index.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 500,
          "y": 2856,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 38,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-knowledgeEntry-ts",
          "name": "knowledgeEntry.ts",
          "filePath": "lib/api-zod/src/generated/types/knowledgeEntry.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 540,
          "y": 2856,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 11,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-knowledgeEntryList-ts",
          "name": "knowledgeEntryList.ts",
          "filePath": "lib/api-zod/src/generated/types/knowledgeEntryList.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 580,
          "y": 2856,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 2,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 5,
          "dependencies": [
            "./knowledgeEntry"
          ],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-knowledgeStats-ts",
          "name": "knowledgeStats.ts",
          "filePath": "lib/api-zod/src/generated/types/knowledgeStats.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 620,
          "y": 2856,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 2,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 8,
          "dependencies": [
            "./knowledgeStatsTopProblemsItem"
          ],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-knowledgeStatsTopProblemsItem-ts",
          "name": "knowledgeStatsTopProblemsItem.ts",
          "filePath": "lib/api-zod/src/generated/types/knowledgeStatsTopProblemsItem.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 420,
          "y": 2898,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 4,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-liveMetrics-ts",
          "name": "liveMetrics.ts",
          "filePath": "lib/api-zod/src/generated/types/liveMetrics.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 460,
          "y": 2898,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 10,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-loadRepoRequest-ts",
          "name": "loadRepoRequest.ts",
          "filePath": "lib/api-zod/src/generated/types/loadRepoRequest.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 500,
          "y": 2898,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 4,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-loadRepoResponse-ts",
          "name": "loadRepoResponse.ts",
          "filePath": "lib/api-zod/src/generated/types/loadRepoResponse.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 540,
          "y": 2898,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 8,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-road-ts",
          "name": "road.ts",
          "filePath": "lib/api-zod/src/generated/types/road.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 580,
          "y": 2898,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 2,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 7,
          "dependencies": [
            "./roadType"
          ],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-roadType-ts",
          "name": "roadType.ts",
          "filePath": "lib/api-zod/src/generated/types/roadType.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 620,
          "y": 2898,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 7,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-spawnAgentRequest-ts",
          "name": "spawnAgentRequest.ts",
          "filePath": "lib/api-zod/src/generated/types/spawnAgentRequest.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 420,
          "y": 2940,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 2,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 5,
          "dependencies": [
            "./spawnAgentRequestRole"
          ],
          "activeEvent": null
        },
        {
          "id": "building-lib-api-zod-src-generated-types-spawnAgentRequestRole-ts",
          "name": "spawnAgentRequestRole.ts",
          "filePath": "lib/api-zod/src/generated/types/spawnAgentRequestRole.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 460,
          "y": 2940,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 9,
          "dependencies": [],
          "activeEvent": null
        }
      ],
      "healthScore": 24
    },
    {
      "id": "district-30",
      "name": "lib/api-zod/src",
      "path": "lib/api-zod/src",
      "type": "source",
      "x": 20,
      "y": 3116,
      "width": 160,
      "height": 120,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-lib-api-zod-src-index-ts",
          "name": "index.ts",
          "filePath": "lib/api-zod/src/index.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 40,
          "y": 3146,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 1,
          "dependencies": [],
          "activeEvent": null
        }
      ],
      "healthScore": 24
    },
    {
      "id": "district-31",
      "name": "lib/db",
      "path": "lib/db",
      "type": "database",
      "x": 210,
      "y": 3116,
      "width": 160,
      "height": 162,
      "color": "#1a0d2a",
      "buildings": [
        {
          "id": "building-lib-db-drizzle-config-ts",
          "name": "drizzle.config.ts",
          "filePath": "lib/db/drizzle.config.ts",
          "fileType": "config",
          "floors": 1,
          "complexity": 3,
          "x": 230,
          "y": 3146,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 6,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 17,
          "dependencies": [
            "drizzle-kit",
            "path",
            "fs"
          ],
          "activeEvent": null
        },
        {
          "id": "building-lib-db-package-json",
          "name": "package.json",
          "filePath": "lib/db/package.json",
          "fileType": "config",
          "floors": 1,
          "complexity": 1,
          "x": 270,
          "y": 3146,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "json",
          "linesOfCode": 24,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-db-tsconfig-json",
          "name": "tsconfig.json",
          "filePath": "lib/db/tsconfig.json",
          "fileType": "config",
          "floors": 1,
          "complexity": 1,
          "x": 230,
          "y": 3188,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "json",
          "linesOfCode": 12,
          "dependencies": [],
          "activeEvent": null
        }
      ],
      "healthScore": 24
    },
    {
      "id": "district-32",
      "name": "lib/db/src",
      "path": "lib/db/src",
      "type": "source",
      "x": 400,
      "y": 3116,
      "width": 160,
      "height": 120,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-lib-db-src-index-ts",
          "name": "index.ts",
          "filePath": "lib/db/src/index.ts",
          "fileType": "function",
          "floors": 3,
          "complexity": 12,
          "x": 420,
          "y": 3146,
          "width": 45,
          "height": 44,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 15,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 105,
          "dependencies": [
            "drizzle-orm/libsql",
            "@libsql/client",
            "./schema",
            "path",
            "fs"
          ],
          "activeEvent": null
        }
      ],
      "healthScore": 17
    },
    {
      "id": "district-33",
      "name": "lib/db/src/schema",
      "path": "lib/db/src/schema",
      "type": "database",
      "x": 20,
      "y": 3308,
      "width": 264,
      "height": 218,
      "color": "#1a0d2a",
      "buildings": [
        {
          "id": "building-lib-db-src-schema-agents-ts",
          "name": "agents.ts",
          "filePath": "lib/db/src/schema/agents.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 40,
          "y": 3338,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 9,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 36,
          "dependencies": [
            "drizzle-orm/sqlite-core",
            "drizzle-orm",
            "drizzle-zod",
            "zod/v4"
          ],
          "activeEvent": null
        },
        {
          "id": "building-lib-db-src-schema-events-ts",
          "name": "events.ts",
          "filePath": "lib/db/src/schema/events.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 80,
          "y": 3338,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 9,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 25,
          "dependencies": [
            "drizzle-orm/sqlite-core",
            "drizzle-orm",
            "drizzle-zod",
            "zod/v4"
          ],
          "activeEvent": null
        },
        {
          "id": "building-lib-db-src-schema-executionResults-ts",
          "name": "executionResults.ts",
          "filePath": "lib/db/src/schema/executionResults.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 120,
          "y": 3338,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 4,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 15,
          "dependencies": [
            "drizzle-orm/sqlite-core",
            "drizzle-orm"
          ],
          "activeEvent": null
        },
        {
          "id": "building-lib-db-src-schema-findings-ts",
          "name": "findings.ts",
          "filePath": "lib/db/src/schema/findings.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 160,
          "y": 3338,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 9,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 31,
          "dependencies": [
            "drizzle-orm/sqlite-core",
            "drizzle-orm",
            "drizzle-zod",
            "zod/v4"
          ],
          "activeEvent": null
        },
        {
          "id": "building-lib-db-src-schema-index-ts",
          "name": "index.ts",
          "filePath": "lib/db/src/schema/index.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 40,
          "y": 3380,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 9,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-lib-db-src-schema-knowledge-ts",
          "name": "knowledge.ts",
          "filePath": "lib/db/src/schema/knowledge.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 80,
          "y": 3380,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 9,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 30,
          "dependencies": [
            "drizzle-orm/sqlite-core",
            "drizzle-orm",
            "drizzle-zod",
            "zod/v4"
          ],
          "activeEvent": null
        },
        {
          "id": "building-lib-db-src-schema-metrics-ts",
          "name": "metrics.ts",
          "filePath": "lib/db/src/schema/metrics.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 120,
          "y": 3380,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 4,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 16,
          "dependencies": [
            "drizzle-orm/sqlite-core",
            "drizzle-orm"
          ],
          "activeEvent": null
        },
        {
          "id": "building-lib-db-src-schema-repos-ts",
          "name": "repos.ts",
          "filePath": "lib/db/src/schema/repos.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 160,
          "y": 3380,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 9,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 25,
          "dependencies": [
            "drizzle-orm/sqlite-core",
            "drizzle-orm",
            "drizzle-zod",
            "zod/v4"
          ],
          "activeEvent": null
        },
        {
          "id": "building-lib-db-src-schema-settings-ts",
          "name": "settings.ts",
          "filePath": "lib/db/src/schema/settings.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 40,
          "y": 3422,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 5,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 27,
          "dependencies": [
            "drizzle-orm/sqlite-core",
            "drizzle-orm"
          ],
          "activeEvent": null
        },
        {
          "id": "building-lib-db-src-schema-snapshots-ts",
          "name": "snapshots.ts",
          "filePath": "lib/db/src/schema/snapshots.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 80,
          "y": 3422,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 8,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 16,
          "dependencies": [
            "drizzle-orm/sqlite-core",
            "drizzle-orm",
            "drizzle-zod",
            "zod/v4"
          ],
          "activeEvent": null
        }
      ],
      "healthScore": 24
    },
    {
      "id": "district-34",
      "name": "scripts",
      "path": "scripts",
      "type": "source",
      "x": 314,
      "y": 3308,
      "width": 264,
      "height": 218,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-scripts-analyze-repo-ts",
          "name": "analyze-repo.ts",
          "filePath": "scripts/analyze-repo.ts",
          "fileType": "function",
          "floors": 2,
          "complexity": 21,
          "x": 334,
          "y": 3338,
          "width": 54,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 9,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 66,
          "dependencies": [
            "@libsql/client",
            "url",
            "path"
          ],
          "activeEvent": null
        },
        {
          "id": "building-scripts-check-ai-ts",
          "name": "check-ai.ts",
          "filePath": "scripts/check-ai.ts",
          "fileType": "function",
          "floors": 2,
          "complexity": 21,
          "x": 400,
          "y": 3338,
          "width": 54,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 9,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 76,
          "dependencies": [
            "dotenv",
            "url",
            "path"
          ],
          "activeEvent": null
        },
        {
          "id": "building-scripts-export-for-local-sh",
          "name": "export-for-local.sh",
          "filePath": "scripts/export-for-local.sh",
          "fileType": "function",
          "floors": 1,
          "complexity": 4,
          "x": 466,
          "y": 3338,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "bash",
          "linesOfCode": 15,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-scripts-package-json",
          "name": "package.json",
          "filePath": "scripts/package.json",
          "fileType": "config",
          "floors": 1,
          "complexity": 1,
          "x": 506,
          "y": 3338,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "json",
          "linesOfCode": 15,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-scripts-post-merge-sh",
          "name": "post-merge.sh",
          "filePath": "scripts/post-merge.sh",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 334,
          "y": 3380,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "bash",
          "linesOfCode": 3,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-scripts-seed-knowledge-ts",
          "name": "seed-knowledge.ts",
          "filePath": "scripts/seed-knowledge.ts",
          "fileType": "function",
          "floors": 6,
          "complexity": 50,
          "x": 374,
          "y": 3380,
          "width": 54,
          "height": 68,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 24,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 292,
          "dependencies": [
            "fs",
            "@libsql/client",
            "url",
            "path",
            "node:fs/promises"
          ],
          "activeEvent": null
        },
        {
          "id": "building-scripts-setup-ollama-sh",
          "name": "setup-ollama.sh",
          "filePath": "scripts/setup-ollama.sh",
          "fileType": "function",
          "floors": 1,
          "complexity": 8,
          "x": 440,
          "y": 3380,
          "width": 36,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "bash",
          "linesOfCode": 31,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-scripts-train-kb-ts",
          "name": "train-kb.ts",
          "filePath": "scripts/train-kb.ts",
          "fileType": "function",
          "floors": 6,
          "complexity": 50,
          "x": 488,
          "y": 3380,
          "width": 54,
          "height": 68,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 20,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 299,
          "dependencies": [
            "@libsql/client",
            "url",
            "path"
          ],
          "activeEvent": null
        },
        {
          "id": "building-scripts-tsconfig-json",
          "name": "tsconfig.json",
          "filePath": "scripts/tsconfig.json",
          "fileType": "config",
          "floors": 1,
          "complexity": 1,
          "x": 334,
          "y": 3422,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "json",
          "linesOfCode": 9,
          "dependencies": [],
          "activeEvent": null
        },
        {
          "id": "building-scripts-validate-loop-ts",
          "name": "validate-loop.ts",
          "filePath": "scripts/validate-loop.ts",
          "fileType": "function",
          "floors": 6,
          "complexity": 50,
          "x": 374,
          "y": 3422,
          "width": 54,
          "height": 68,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 22,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 286,
          "dependencies": [
            "node:child_process",
            "node:events",
            "node:url",
            "node:path"
          ],
          "activeEvent": null
        }
      ],
      "healthScore": 11
    },
    {
      "id": "district-35",
      "name": "scripts/src",
      "path": "scripts/src",
      "type": "source",
      "x": 608,
      "y": 3308,
      "width": 160,
      "height": 162,
      "color": "#1a2a4a",
      "buildings": [
        {
          "id": "building-scripts-src-analyze-repo-ts",
          "name": "analyze-repo.ts",
          "filePath": "scripts/src/analyze-repo.ts",
          "fileType": "function",
          "floors": 2,
          "complexity": 21,
          "x": 628,
          "y": 3338,
          "width": 54,
          "height": 36,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 9,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 66,
          "dependencies": [
            "@libsql/client",
            "url",
            "path"
          ],
          "activeEvent": null
        },
        {
          "id": "building-scripts-src-hello-ts",
          "name": "hello.ts",
          "filePath": "scripts/src/hello.ts",
          "fileType": "function",
          "floors": 1,
          "complexity": 2,
          "x": 694,
          "y": 3338,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 4,
          "age": "new",
          "language": "typescript",
          "linesOfCode": 7,
          "dependencies": [
            "url",
            "path"
          ],
          "activeEvent": null
        },
        {
          "id": "building-scripts-src-seed-knowledge-ts",
          "name": "seed-knowledge.ts",
          "filePath": "scripts/src/seed-knowledge.ts",
          "fileType": "function",
          "floors": 4,
          "complexity": 50,
          "x": 628,
          "y": 3404,
          "width": 54,
          "height": 52,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 16,
          "age": "modern",
          "language": "typescript",
          "linesOfCode": 162,
          "dependencies": [
            "fs",
            "@libsql/client",
            "url",
            "path"
          ],
          "activeEvent": null
        }
      ],
      "healthScore": 9
    },
    {
      "id": "district-36",
      "name": "test-results",
      "path": "test-results",
      "type": "test",
      "x": 20,
      "y": 3556,
      "width": 160,
      "height": 120,
      "color": "#0d3322",
      "buildings": [
        {
          "id": "building-test-results--last-run-json",
          "name": ".last-run.json",
          "filePath": "test-results/.last-run.json",
          "fileType": "function",
          "floors": 1,
          "complexity": 1,
          "x": 40,
          "y": 3586,
          "width": 28,
          "height": 28,
          "status": "dark",
          "hasTests": false,
          "testCoverage": 0,
          "commitCount": 1,
          "age": "new",
          "language": "json",
          "linesOfCode": 4,
          "dependencies": [],
          "activeEvent": null
        }
      ],
      "healthScore": 24
    }
  ],
  "roads": [
    {
      "id": "road-0",
      "fromBuilding": "building-artifacts-api-server-src-index-ts",
      "toBuilding": "building-artifacts-api-server-src-app-ts",
      "type": "api"
    },
    {
      "id": "road-1",
      "fromBuilding": "building-artifacts-api-server-src-index-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-wsServer-ts",
      "type": "import"
    },
    {
      "id": "road-2",
      "fromBuilding": "building-artifacts-api-server-src-index-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-agentEngine-ts",
      "type": "import"
    },
    {
      "id": "road-3",
      "fromBuilding": "building-artifacts-api-server-src-index-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-envValidator-ts",
      "type": "import"
    },
    {
      "id": "road-4",
      "fromBuilding": "building-artifacts-api-server-src-index-ts",
      "toBuilding": "building-artifacts-api-server-src-routes-metrics-ts",
      "type": "api"
    },
    {
      "id": "road-5",
      "fromBuilding": "building-artifacts-api-server-src-index-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-loadEnv-ts",
      "type": "import"
    },
    {
      "id": "road-6",
      "fromBuilding": "building-artifacts-api-server-src-index-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-embeddings-ts",
      "type": "import"
    },
    {
      "id": "road-7",
      "fromBuilding": "building-artifacts-api-server-src-index-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-vectorSearch-ts",
      "type": "import"
    },
    {
      "id": "road-8",
      "fromBuilding": "building-artifacts-api-server-src-index-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-knowledgeCleanup-ts",
      "type": "import"
    },
    {
      "id": "road-9",
      "fromBuilding": "building-artifacts-api-server-src-lib-agentEngine-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-types-ts",
      "type": "import"
    },
    {
      "id": "road-10",
      "fromBuilding": "building-artifacts-api-server-src-lib-agentEngine-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-wsServer-ts",
      "type": "import"
    },
    {
      "id": "road-11",
      "fromBuilding": "building-artifacts-api-server-src-lib-agentEngine-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-smartAgentWorkflow-ts",
      "type": "import"
    },
    {
      "id": "road-12",
      "fromBuilding": "building-artifacts-api-server-src-lib-agentEngine-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-smartAgents-ts",
      "type": "import"
    },
    {
      "id": "road-13",
      "fromBuilding": "building-artifacts-api-server-src-lib-agentEngine-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-findingQuality-ts",
      "type": "import"
    },
    {
      "id": "road-14",
      "fromBuilding": "building-artifacts-api-server-src-lib-cityAnalyzer-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-types-ts",
      "type": "import"
    },
    {
      "id": "road-15",
      "fromBuilding": "building-artifacts-api-server-src-lib-cityAnalyzer-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-codeAnalyzer-ts",
      "type": "api"
    },
    {
      "id": "road-16",
      "fromBuilding": "building-artifacts-api-server-src-lib-cityAnalyzer-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-healthScorer-ts",
      "type": "import"
    },
    {
      "id": "road-17",
      "fromBuilding": "building-artifacts-api-server-src-lib-envValidator-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-ollamaClient-ts",
      "type": "import"
    },
    {
      "id": "road-18",
      "fromBuilding": "building-artifacts-api-server-src-lib-escalationEngine-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-ollamaPrompts-ts",
      "type": "import"
    },
    {
      "id": "road-19",
      "fromBuilding": "building-artifacts-api-server-src-lib-escalationEngine-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-ollamaClient-ts",
      "type": "import"
    },
    {
      "id": "road-20",
      "fromBuilding": "building-artifacts-api-server-src-lib-escalationEngine-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-anonymize-ts",
      "type": "import"
    },
    {
      "id": "road-21",
      "fromBuilding": "building-artifacts-api-server-src-lib-escalationEngine-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-sessionStats-ts",
      "type": "import"
    },
    {
      "id": "road-22",
      "fromBuilding": "building-artifacts-api-server-src-lib-escalationEngine-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-vectorSearch-ts",
      "type": "import"
    },
    {
      "id": "road-23",
      "fromBuilding": "building-artifacts-api-server-src-lib-escalationEngine-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-embeddings-ts",
      "type": "import"
    },
    {
      "id": "road-24",
      "fromBuilding": "building-artifacts-api-server-src-lib-escalationEngine-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-smartAgents-ts",
      "type": "import"
    },
    {
      "id": "road-25",
      "fromBuilding": "building-artifacts-api-server-src-lib-fileWatcher-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-codeAnalyzer-ts",
      "type": "api"
    },
    {
      "id": "road-26",
      "fromBuilding": "building-artifacts-api-server-src-lib-fileWatcher-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-healthScorer-ts",
      "type": "import"
    },
    {
      "id": "road-27",
      "fromBuilding": "building-artifacts-api-server-src-lib-fileWatcher-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-wsServer-ts",
      "type": "import"
    },
    {
      "id": "road-28",
      "fromBuilding": "building-artifacts-api-server-src-lib-fileWatcher-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-types-ts",
      "type": "import"
    },
    {
      "id": "road-29",
      "fromBuilding": "building-artifacts-api-server-src-lib-findingQuality-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-escalationEngine-ts",
      "type": "import"
    },
    {
      "id": "road-30",
      "fromBuilding": "building-artifacts-api-server-src-lib-findingQuality-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-smartAgents-ts",
      "type": "import"
    },
    {
      "id": "road-31",
      "fromBuilding": "building-artifacts-api-server-src-lib-githubFetcher-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-cityAnalyzer-ts",
      "type": "import"
    },
    {
      "id": "road-32",
      "fromBuilding": "building-artifacts-api-server-src-lib-githubFetcher-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-githubTokenStore-ts",
      "type": "import"
    },
    {
      "id": "road-33",
      "fromBuilding": "building-artifacts-api-server-src-lib-healthScorer-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-types-ts",
      "type": "import"
    },
    {
      "id": "road-34",
      "fromBuilding": "building-artifacts-api-server-src-lib-knowledgeCleanup-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-types-ts",
      "type": "import"
    },
    {
      "id": "road-35",
      "fromBuilding": "building-artifacts-api-server-src-lib-knowledgeCleanup-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-sourceFiles-ts",
      "type": "import"
    },
    {
      "id": "road-36",
      "fromBuilding": "building-artifacts-api-server-src-lib-orchestrator-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-wsServer-ts",
      "type": "import"
    },
    {
      "id": "road-37",
      "fromBuilding": "building-artifacts-api-server-src-lib-orchestrator-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-orchestratorPrompts-ts",
      "type": "import"
    },
    {
      "id": "road-38",
      "fromBuilding": "building-artifacts-api-server-src-lib-orchestrator-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-ollamaClient-ts",
      "type": "import"
    },
    {
      "id": "road-39",
      "fromBuilding": "building-artifacts-api-server-src-lib-projectFingerprint-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-cityAnalyzer-ts",
      "type": "import"
    },
    {
      "id": "road-40",
      "fromBuilding": "building-artifacts-api-server-src-lib-smartAgentWorkflow-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-alchemistExecutor-ts",
      "type": "import"
    },
    {
      "id": "road-41",
      "fromBuilding": "building-artifacts-api-server-src-lib-smartAgentWorkflow-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-escalationEngine-ts",
      "type": "import"
    },
    {
      "id": "road-42",
      "fromBuilding": "building-artifacts-api-server-src-lib-smartAgentWorkflow-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-types-ts",
      "type": "import"
    },
    {
      "id": "road-43",
      "fromBuilding": "building-artifacts-api-server-src-lib-smartAgentWorkflow-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-findingQuality-ts",
      "type": "import"
    },
    {
      "id": "road-44",
      "fromBuilding": "building-artifacts-api-server-src-lib-smartAgentWorkflow-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-smartAgents-ts",
      "type": "import"
    },
    {
      "id": "road-45",
      "fromBuilding": "building-artifacts-api-server-src-lib-vectorSearch-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-embeddings-ts",
      "type": "import"
    },
    {
      "id": "road-46",
      "fromBuilding": "building-artifacts-api-server-src-routes-agents-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-agentEngine-ts",
      "type": "import"
    },
    {
      "id": "road-47",
      "fromBuilding": "building-artifacts-api-server-src-routes-agents-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-escalationEngine-ts",
      "type": "import"
    },
    {
      "id": "road-48",
      "fromBuilding": "building-artifacts-api-server-src-routes-agents-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-testExecutor-ts",
      "type": "import"
    },
    {
      "id": "road-49",
      "fromBuilding": "building-artifacts-api-server-src-routes-agents-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-ollamaPrompts-ts",
      "type": "import"
    },
    {
      "id": "road-50",
      "fromBuilding": "building-artifacts-api-server-src-routes-agents-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-ollamaClient-ts",
      "type": "import"
    },
    {
      "id": "road-51",
      "fromBuilding": "building-artifacts-api-server-src-routes-agents-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-wsServer-ts",
      "type": "import"
    },
    {
      "id": "road-52",
      "fromBuilding": "building-artifacts-api-server-src-routes-agents-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-types-ts",
      "type": "import"
    },
    {
      "id": "road-53",
      "fromBuilding": "building-artifacts-api-server-src-routes-agents-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-sourceFiles-ts",
      "type": "import"
    },
    {
      "id": "road-54",
      "fromBuilding": "building-artifacts-api-server-src-routes-agents-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-smartAgentWorkflow-ts",
      "type": "import"
    },
    {
      "id": "road-55",
      "fromBuilding": "building-artifacts-api-server-src-routes-agents-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-smartAgents-ts",
      "type": "import"
    },
    {
      "id": "road-56",
      "fromBuilding": "building-artifacts-api-server-src-routes-agents-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-findingQuality-ts",
      "type": "import"
    },
    {
      "id": "road-57",
      "fromBuilding": "building-artifacts-api-server-src-routes-alchemist-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-alchemistExecutor-ts",
      "type": "import"
    },
    {
      "id": "road-58",
      "fromBuilding": "building-artifacts-api-server-src-routes-alchemist-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-wsServer-ts",
      "type": "import"
    },
    {
      "id": "road-59",
      "fromBuilding": "building-artifacts-api-server-src-routes-assets-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-assetGenerator-ts",
      "type": "import"
    },
    {
      "id": "road-60",
      "fromBuilding": "building-artifacts-api-server-src-routes-city-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-cityAnalyzer-ts",
      "type": "import"
    },
    {
      "id": "road-61",
      "fromBuilding": "building-artifacts-api-server-src-routes-city-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-healthScorer-ts",
      "type": "import"
    },
    {
      "id": "road-62",
      "fromBuilding": "building-artifacts-api-server-src-routes-city-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-types-ts",
      "type": "import"
    },
    {
      "id": "road-63",
      "fromBuilding": "building-artifacts-api-server-src-routes-index-ts",
      "toBuilding": "building-artifacts-api-server-src-routes-health-ts",
      "type": "api"
    },
    {
      "id": "road-64",
      "fromBuilding": "building-artifacts-api-server-src-routes-index-ts",
      "toBuilding": "building-artifacts-api-server-src-routes-repo-ts",
      "type": "api"
    },
    {
      "id": "road-65",
      "fromBuilding": "building-artifacts-api-server-src-routes-index-ts",
      "toBuilding": "building-artifacts-api-server-src-routes-city-ts",
      "type": "api"
    },
    {
      "id": "road-66",
      "fromBuilding": "building-artifacts-api-server-src-routes-index-ts",
      "toBuilding": "building-artifacts-api-server-src-routes-agents-ts",
      "type": "api"
    },
    {
      "id": "road-67",
      "fromBuilding": "building-artifacts-api-server-src-routes-index-ts",
      "toBuilding": "building-artifacts-api-server-src-routes-knowledge-ts",
      "type": "api"
    },
    {
      "id": "road-68",
      "fromBuilding": "building-artifacts-api-server-src-routes-index-ts",
      "toBuilding": "building-artifacts-api-server-src-routes-events-ts",
      "type": "api"
    },
    {
      "id": "road-69",
      "fromBuilding": "building-artifacts-api-server-src-routes-index-ts",
      "toBuilding": "building-artifacts-api-server-src-routes-assets-ts",
      "type": "api"
    },
    {
      "id": "road-70",
      "fromBuilding": "building-artifacts-api-server-src-routes-index-ts",
      "toBuilding": "building-artifacts-api-server-src-routes-ollama-ts",
      "type": "api"
    },
    {
      "id": "road-71",
      "fromBuilding": "building-artifacts-api-server-src-routes-index-ts",
      "toBuilding": "building-artifacts-api-server-src-routes-watch-ts",
      "type": "api"
    },
    {
      "id": "road-72",
      "fromBuilding": "building-artifacts-api-server-src-routes-index-ts",
      "toBuilding": "building-artifacts-api-server-src-routes-shared-ts",
      "type": "api"
    },
    {
      "id": "road-73",
      "fromBuilding": "building-artifacts-api-server-src-routes-index-ts",
      "toBuilding": "building-artifacts-api-server-src-routes-settings-ts",
      "type": "api"
    },
    {
      "id": "road-74",
      "fromBuilding": "building-artifacts-api-server-src-routes-index-ts",
      "toBuilding": "building-artifacts-api-server-src-routes-metrics-ts",
      "type": "api"
    },
    {
      "id": "road-75",
      "fromBuilding": "building-artifacts-api-server-src-routes-index-ts",
      "toBuilding": "building-artifacts-api-server-src-routes-report-ts",
      "type": "api"
    },
    {
      "id": "road-76",
      "fromBuilding": "building-artifacts-api-server-src-routes-index-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-orchestrator-ts",
      "type": "import"
    },
    {
      "id": "road-77",
      "fromBuilding": "building-artifacts-api-server-src-routes-index-ts",
      "toBuilding": "building-artifacts-api-server-src-routes-alchemist-ts",
      "type": "api"
    },
    {
      "id": "road-78",
      "fromBuilding": "building-artifacts-api-server-src-routes-index-ts",
      "toBuilding": "building-artifacts-api-server-src-routes-debug-ts",
      "type": "api"
    },
    {
      "id": "road-79",
      "fromBuilding": "building-artifacts-api-server-src-routes-knowledge-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-sessionStats-ts",
      "type": "import"
    },
    {
      "id": "road-80",
      "fromBuilding": "building-artifacts-api-server-src-routes-knowledge-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-vectorSearch-ts",
      "type": "import"
    },
    {
      "id": "road-81",
      "fromBuilding": "building-artifacts-api-server-src-routes-knowledge-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-embeddings-ts",
      "type": "import"
    },
    {
      "id": "road-82",
      "fromBuilding": "building-artifacts-api-server-src-routes-ollama-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-ollamaClient-ts",
      "type": "import"
    },
    {
      "id": "road-83",
      "fromBuilding": "building-artifacts-api-server-src-routes-orchestrator-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-fileWatcher-ts",
      "type": "import"
    },
    {
      "id": "road-84",
      "fromBuilding": "building-artifacts-api-server-src-routes-orchestrator-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-healthScorer-ts",
      "type": "import"
    },
    {
      "id": "road-85",
      "fromBuilding": "building-artifacts-api-server-src-routes-orchestrator-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-knowledgeCleanup-ts",
      "type": "import"
    },
    {
      "id": "road-86",
      "fromBuilding": "building-artifacts-api-server-src-routes-orchestrator-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-orchestrator-ts",
      "type": "import"
    },
    {
      "id": "road-87",
      "fromBuilding": "building-artifacts-api-server-src-routes-orchestrator-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-githubTokenStore-ts",
      "type": "import"
    },
    {
      "id": "road-88",
      "fromBuilding": "building-artifacts-api-server-src-routes-orchestrator-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-sessionStats-ts",
      "type": "import"
    },
    {
      "id": "road-89",
      "fromBuilding": "building-artifacts-api-server-src-routes-orchestrator-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-wsServer-ts",
      "type": "import"
    },
    {
      "id": "road-90",
      "fromBuilding": "building-artifacts-api-server-src-routes-orchestrator-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-types-ts",
      "type": "import"
    },
    {
      "id": "road-91",
      "fromBuilding": "building-artifacts-api-server-src-routes-repo-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-githubFetcher-ts",
      "type": "import"
    },
    {
      "id": "road-92",
      "fromBuilding": "building-artifacts-api-server-src-routes-repo-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-githubTokenStore-ts",
      "type": "import"
    },
    {
      "id": "road-93",
      "fromBuilding": "building-artifacts-api-server-src-routes-repo-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-cityAnalyzer-ts",
      "type": "import"
    },
    {
      "id": "road-94",
      "fromBuilding": "building-artifacts-api-server-src-routes-repo-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-projectFingerprint-ts",
      "type": "import"
    },
    {
      "id": "road-95",
      "fromBuilding": "building-artifacts-api-server-src-routes-repo-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-vectorSearch-ts",
      "type": "import"
    },
    {
      "id": "road-96",
      "fromBuilding": "building-artifacts-api-server-src-routes-shared-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-healthScorer-ts",
      "type": "import"
    },
    {
      "id": "road-97",
      "fromBuilding": "building-artifacts-api-server-src-routes-shared-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-types-ts",
      "type": "import"
    },
    {
      "id": "road-98",
      "fromBuilding": "building-artifacts-api-server-src-routes-watch-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-fileWatcher-ts",
      "type": "import"
    },
    {
      "id": "road-99",
      "fromBuilding": "building-artifacts-api-server-src-routes-watch-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-cityAnalyzer-ts",
      "type": "import"
    },
    {
      "id": "road-100",
      "fromBuilding": "building-artifacts-api-server-src-routes-watch-ts",
      "toBuilding": "building-artifacts-api-server-src-lib-types-ts",
      "type": "import"
    },
    {
      "id": "road-101",
      "fromBuilding": "building-artifacts-mockup-sandbox-vite-config-ts",
      "toBuilding": "building-artifacts-mockup-sandbox-mockupPreviewPlugin-ts",
      "type": "import"
    },
    {
      "id": "road-102",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-App-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src--generated-mockup-components-ts",
      "type": "import"
    },
    {
      "id": "road-103",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-main-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-App-tsx",
      "type": "import"
    },
    {
      "id": "road-104",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-main-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-index-css",
      "type": "import"
    },
    {
      "id": "road-105",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-accordion-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-106",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-alert-dialog-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-107",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-alert-dialog-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-button-tsx",
      "type": "import"
    },
    {
      "id": "road-108",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-alert-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-109",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-avatar-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-110",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-badge-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-111",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-breadcrumb-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-112",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-button-group-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-113",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-button-group-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-separator-tsx",
      "type": "import"
    },
    {
      "id": "road-114",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-button-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-115",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-calendar-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-116",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-calendar-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-button-tsx",
      "type": "import"
    },
    {
      "id": "road-117",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-card-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-118",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-carousel-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-119",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-carousel-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-button-tsx",
      "type": "import"
    },
    {
      "id": "road-120",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-chart-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-121",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-checkbox-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-122",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-command-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-123",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-command-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-dialog-tsx",
      "type": "import"
    },
    {
      "id": "road-124",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-context-menu-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-125",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-dialog-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-126",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-drawer-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-127",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-dropdown-menu-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-128",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-empty-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-129",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-field-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-130",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-field-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-label-tsx",
      "type": "import"
    },
    {
      "id": "road-131",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-field-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-separator-tsx",
      "type": "import"
    },
    {
      "id": "road-132",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-form-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-133",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-form-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-label-tsx",
      "type": "import"
    },
    {
      "id": "road-134",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-hover-card-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-135",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-input-group-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-136",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-input-group-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-button-tsx",
      "type": "import"
    },
    {
      "id": "road-137",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-input-group-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-input-tsx",
      "type": "import"
    },
    {
      "id": "road-138",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-input-group-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-textarea-tsx",
      "type": "import"
    },
    {
      "id": "road-139",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-input-otp-tsx",
      "toBuilding": "building-artifacts-software-city-src-components-ui-input-otp-tsx",
      "type": "import"
    },
    {
      "id": "road-140",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-input-otp-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-141",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-input-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-142",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-item-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-143",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-item-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-separator-tsx",
      "type": "import"
    },
    {
      "id": "road-144",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-kbd-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-145",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-label-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-146",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-menubar-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-147",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-navigation-menu-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-148",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-pagination-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-149",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-pagination-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-button-tsx",
      "type": "import"
    },
    {
      "id": "road-150",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-popover-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-151",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-progress-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-152",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-radio-group-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-153",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-resizable-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-154",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-scroll-area-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-155",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-select-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-156",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-separator-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-157",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-sheet-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-158",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-sidebar-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-hooks-use-mobile-tsx",
      "type": "import"
    },
    {
      "id": "road-159",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-sidebar-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-160",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-sidebar-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-button-tsx",
      "type": "import"
    },
    {
      "id": "road-161",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-sidebar-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-input-tsx",
      "type": "import"
    },
    {
      "id": "road-162",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-sidebar-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-separator-tsx",
      "type": "import"
    },
    {
      "id": "road-163",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-sidebar-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-sheet-tsx",
      "type": "import"
    },
    {
      "id": "road-164",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-sidebar-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-skeleton-tsx",
      "type": "import"
    },
    {
      "id": "road-165",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-sidebar-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-tooltip-tsx",
      "type": "import"
    },
    {
      "id": "road-166",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-skeleton-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-167",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-slider-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-168",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-sonner-tsx",
      "toBuilding": "building-artifacts-software-city-src-components-ui-sonner-tsx",
      "type": "import"
    },
    {
      "id": "road-169",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-spinner-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-170",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-switch-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-171",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-table-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-172",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-tabs-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-173",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-textarea-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-174",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-toast-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-175",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-toaster-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-hooks-use-toast-ts",
      "type": "import"
    },
    {
      "id": "road-176",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-toaster-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-toast-tsx",
      "type": "import"
    },
    {
      "id": "road-177",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-toggle-group-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-178",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-toggle-group-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-toggle-tsx",
      "type": "import"
    },
    {
      "id": "road-179",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-toggle-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-180",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-components-ui-tooltip-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-181",
      "fromBuilding": "building-artifacts-mockup-sandbox-src-hooks-use-toast-ts",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-toast-tsx",
      "type": "import"
    },
    {
      "id": "road-182",
      "fromBuilding": "building-artifacts-software-city-src-App-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-toaster-tsx",
      "type": "import"
    },
    {
      "id": "road-183",
      "fromBuilding": "building-artifacts-software-city-src-App-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-tooltip-tsx",
      "type": "import"
    },
    {
      "id": "road-184",
      "fromBuilding": "building-artifacts-software-city-src-App-tsx",
      "toBuilding": "building-artifacts-software-city-src-pages-not-found-tsx",
      "type": "import"
    },
    {
      "id": "road-185",
      "fromBuilding": "building-artifacts-software-city-src-App-tsx",
      "toBuilding": "building-artifacts-software-city-src-pages-Landing-tsx",
      "type": "import"
    },
    {
      "id": "road-186",
      "fromBuilding": "building-artifacts-software-city-src-App-tsx",
      "toBuilding": "building-artifacts-software-city-src-pages-CityView-tsx",
      "type": "import"
    },
    {
      "id": "road-187",
      "fromBuilding": "building-artifacts-software-city-src-App-tsx",
      "toBuilding": "building-artifacts-software-city-src-pages-Agents-tsx",
      "type": "import"
    },
    {
      "id": "road-188",
      "fromBuilding": "building-artifacts-software-city-src-App-tsx",
      "toBuilding": "building-artifacts-software-city-src-pages-KnowledgeBase-tsx",
      "type": "import"
    },
    {
      "id": "road-189",
      "fromBuilding": "building-artifacts-software-city-src-App-tsx",
      "toBuilding": "building-artifacts-software-city-src-pages-SharedCity-tsx",
      "type": "import"
    },
    {
      "id": "road-190",
      "fromBuilding": "building-artifacts-software-city-src-App-tsx",
      "toBuilding": "building-artifacts-software-city-src-pages-Leaderboard-tsx",
      "type": "import"
    },
    {
      "id": "road-191",
      "fromBuilding": "building-artifacts-software-city-src-App-tsx",
      "toBuilding": "building-artifacts-software-city-src-pages-Metrics-tsx",
      "type": "import"
    },
    {
      "id": "road-192",
      "fromBuilding": "building-artifacts-software-city-src-App-tsx",
      "toBuilding": "building-artifacts-software-city-src-pages-Settings-tsx",
      "type": "import"
    },
    {
      "id": "road-193",
      "fromBuilding": "building-artifacts-software-city-src-main-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-App-tsx",
      "type": "import"
    },
    {
      "id": "road-194",
      "fromBuilding": "building-artifacts-software-city-src-main-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-index-css",
      "type": "import"
    },
    {
      "id": "road-195",
      "fromBuilding": "building-artifacts-software-city-src-components-city-BuildingInspector-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-button-tsx",
      "type": "import"
    },
    {
      "id": "road-196",
      "fromBuilding": "building-artifacts-software-city-src-components-city-BuildingInspector-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-197",
      "fromBuilding": "building-artifacts-software-city-src-components-city-BuildingInspector-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-hooks-use-toast-ts",
      "type": "import"
    },
    {
      "id": "road-198",
      "fromBuilding": "building-artifacts-software-city-src-components-city-BuildingInspector-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-dialog-tsx",
      "type": "import"
    },
    {
      "id": "road-199",
      "fromBuilding": "building-artifacts-software-city-src-components-city-HUD-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-200",
      "fromBuilding": "building-artifacts-software-city-src-components-layout-AppLayout-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-201",
      "fromBuilding": "building-artifacts-software-city-src-components-layout-AppLayout-tsx",
      "toBuilding": "building-artifacts-software-city-src-hooks-useWebSocket-ts",
      "type": "import"
    },
    {
      "id": "road-202",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-accordion-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-203",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-alert-dialog-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-204",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-alert-dialog-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-button-tsx",
      "type": "import"
    },
    {
      "id": "road-205",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-alert-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-206",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-avatar-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-207",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-badge-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-208",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-breadcrumb-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-209",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-button-group-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-210",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-button-group-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-separator-tsx",
      "type": "import"
    },
    {
      "id": "road-211",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-button-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-212",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-calendar-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-213",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-calendar-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-button-tsx",
      "type": "import"
    },
    {
      "id": "road-214",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-card-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-215",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-carousel-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-216",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-carousel-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-button-tsx",
      "type": "import"
    },
    {
      "id": "road-217",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-chart-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-218",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-checkbox-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-219",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-command-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-220",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-command-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-dialog-tsx",
      "type": "import"
    },
    {
      "id": "road-221",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-context-menu-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-222",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-dialog-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-223",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-drawer-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-224",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-dropdown-menu-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-225",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-empty-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-226",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-field-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-227",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-field-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-label-tsx",
      "type": "import"
    },
    {
      "id": "road-228",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-field-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-separator-tsx",
      "type": "import"
    },
    {
      "id": "road-229",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-form-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-230",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-form-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-label-tsx",
      "type": "import"
    },
    {
      "id": "road-231",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-hover-card-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-232",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-input-group-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-233",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-input-group-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-button-tsx",
      "type": "import"
    },
    {
      "id": "road-234",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-input-group-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-input-tsx",
      "type": "import"
    },
    {
      "id": "road-235",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-input-group-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-textarea-tsx",
      "type": "import"
    },
    {
      "id": "road-236",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-input-otp-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-input-otp-tsx",
      "type": "import"
    },
    {
      "id": "road-237",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-input-otp-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-238",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-input-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-239",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-item-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-240",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-item-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-separator-tsx",
      "type": "import"
    },
    {
      "id": "road-241",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-kbd-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-242",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-label-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-243",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-menubar-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-244",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-navigation-menu-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-245",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-pagination-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-246",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-pagination-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-button-tsx",
      "type": "import"
    },
    {
      "id": "road-247",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-popover-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-248",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-progress-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-249",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-radio-group-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-250",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-resizable-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-251",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-scroll-area-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-252",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-select-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-253",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-separator-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-254",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-sheet-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-255",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-sidebar-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-hooks-use-mobile-tsx",
      "type": "import"
    },
    {
      "id": "road-256",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-sidebar-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-257",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-sidebar-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-button-tsx",
      "type": "import"
    },
    {
      "id": "road-258",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-sidebar-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-input-tsx",
      "type": "import"
    },
    {
      "id": "road-259",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-sidebar-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-separator-tsx",
      "type": "import"
    },
    {
      "id": "road-260",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-sidebar-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-sheet-tsx",
      "type": "import"
    },
    {
      "id": "road-261",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-sidebar-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-skeleton-tsx",
      "type": "import"
    },
    {
      "id": "road-262",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-sidebar-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-tooltip-tsx",
      "type": "import"
    },
    {
      "id": "road-263",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-skeleton-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-264",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-slider-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-265",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-sonner-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-sonner-tsx",
      "type": "import"
    },
    {
      "id": "road-266",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-spinner-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-267",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-switch-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-268",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-table-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-269",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-tabs-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-270",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-textarea-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-271",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-toast-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-272",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-toaster-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-hooks-use-toast-ts",
      "type": "import"
    },
    {
      "id": "road-273",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-toaster-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-toast-tsx",
      "type": "import"
    },
    {
      "id": "road-274",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-toggle-group-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-275",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-toggle-group-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-toggle-tsx",
      "type": "import"
    },
    {
      "id": "road-276",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-toggle-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-277",
      "fromBuilding": "building-artifacts-software-city-src-components-ui-tooltip-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-278",
      "fromBuilding": "building-artifacts-software-city-src-hooks-use-toast-ts",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-toast-tsx",
      "type": "import"
    },
    {
      "id": "road-279",
      "fromBuilding": "building-artifacts-software-city-src-pages-Agents-tsx",
      "toBuilding": "building-artifacts-software-city-src-components-layout-AppLayout-tsx",
      "type": "import"
    },
    {
      "id": "road-280",
      "fromBuilding": "building-artifacts-software-city-src-pages-Agents-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-button-tsx",
      "type": "import"
    },
    {
      "id": "road-281",
      "fromBuilding": "building-artifacts-software-city-src-pages-Agents-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-hooks-use-toast-ts",
      "type": "import"
    },
    {
      "id": "road-282",
      "fromBuilding": "building-artifacts-software-city-src-pages-Agents-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-283",
      "fromBuilding": "building-artifacts-software-city-src-pages-Agents-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-dialog-tsx",
      "type": "import"
    },
    {
      "id": "road-284",
      "fromBuilding": "building-artifacts-software-city-src-pages-CityView-tsx",
      "toBuilding": "building-artifacts-software-city-src-components-layout-AppLayout-tsx",
      "type": "import"
    },
    {
      "id": "road-285",
      "fromBuilding": "building-artifacts-software-city-src-pages-CityView-tsx",
      "toBuilding": "building-artifacts-software-city-src-components-city-CityMap-tsx",
      "type": "import"
    },
    {
      "id": "road-286",
      "fromBuilding": "building-artifacts-software-city-src-pages-CityView-tsx",
      "toBuilding": "building-artifacts-software-city-src-components-city-BuildingInspector-tsx",
      "type": "import"
    },
    {
      "id": "road-287",
      "fromBuilding": "building-artifacts-software-city-src-pages-CityView-tsx",
      "toBuilding": "building-artifacts-software-city-src-components-city-HUD-tsx",
      "type": "import"
    },
    {
      "id": "road-288",
      "fromBuilding": "building-artifacts-software-city-src-pages-CityView-tsx",
      "toBuilding": "building-artifacts-software-city-src-components-GuidedTour-tsx",
      "type": "import"
    },
    {
      "id": "road-289",
      "fromBuilding": "building-artifacts-software-city-src-pages-CityView-tsx",
      "toBuilding": "building-artifacts-software-city-src-components-ShortcutsPanel-tsx",
      "type": "import"
    },
    {
      "id": "road-290",
      "fromBuilding": "building-artifacts-software-city-src-pages-CityView-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-291",
      "fromBuilding": "building-artifacts-software-city-src-pages-CityView-tsx",
      "toBuilding": "building-artifacts-software-city-src-hooks-useWebSocket-ts",
      "type": "import"
    },
    {
      "id": "road-292",
      "fromBuilding": "building-artifacts-software-city-src-pages-CityView-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-button-tsx",
      "type": "import"
    },
    {
      "id": "road-293",
      "fromBuilding": "building-artifacts-software-city-src-pages-CityView-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-hooks-use-toast-ts",
      "type": "import"
    },
    {
      "id": "road-294",
      "fromBuilding": "building-artifacts-software-city-src-pages-CityView-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-dropdown-menu-tsx",
      "type": "import"
    },
    {
      "id": "road-295",
      "fromBuilding": "building-artifacts-software-city-src-pages-CityView-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-dialog-tsx",
      "type": "import"
    },
    {
      "id": "road-296",
      "fromBuilding": "building-artifacts-software-city-src-pages-KnowledgeBase-tsx",
      "toBuilding": "building-artifacts-software-city-src-components-layout-AppLayout-tsx",
      "type": "import"
    },
    {
      "id": "road-297",
      "fromBuilding": "building-artifacts-software-city-src-pages-KnowledgeBase-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-input-tsx",
      "type": "import"
    },
    {
      "id": "road-298",
      "fromBuilding": "building-artifacts-software-city-src-pages-KnowledgeBase-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-button-tsx",
      "type": "import"
    },
    {
      "id": "road-299",
      "fromBuilding": "building-artifacts-software-city-src-pages-KnowledgeBase-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-table-tsx",
      "type": "import"
    },
    {
      "id": "road-300",
      "fromBuilding": "building-artifacts-software-city-src-pages-KnowledgeBase-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-hooks-use-toast-ts",
      "type": "import"
    },
    {
      "id": "road-301",
      "fromBuilding": "building-artifacts-software-city-src-pages-KnowledgeBase-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-302",
      "fromBuilding": "building-artifacts-software-city-src-pages-Landing-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-button-tsx",
      "type": "import"
    },
    {
      "id": "road-303",
      "fromBuilding": "building-artifacts-software-city-src-pages-Landing-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-input-tsx",
      "type": "import"
    },
    {
      "id": "road-304",
      "fromBuilding": "building-artifacts-software-city-src-pages-Landing-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-hooks-use-toast-ts",
      "type": "import"
    },
    {
      "id": "road-305",
      "fromBuilding": "building-artifacts-software-city-src-pages-Landing-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-306",
      "fromBuilding": "building-artifacts-software-city-src-pages-Leaderboard-tsx",
      "toBuilding": "building-artifacts-software-city-src-components-layout-AppLayout-tsx",
      "type": "import"
    },
    {
      "id": "road-307",
      "fromBuilding": "building-artifacts-software-city-src-pages-Leaderboard-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-308",
      "fromBuilding": "building-artifacts-software-city-src-pages-Metrics-tsx",
      "toBuilding": "building-artifacts-software-city-src-components-layout-AppLayout-tsx",
      "type": "import"
    },
    {
      "id": "road-309",
      "fromBuilding": "building-artifacts-software-city-src-pages-Metrics-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-310",
      "fromBuilding": "building-artifacts-software-city-src-pages-Settings-tsx",
      "toBuilding": "building-artifacts-software-city-src-components-layout-AppLayout-tsx",
      "type": "import"
    },
    {
      "id": "road-311",
      "fromBuilding": "building-artifacts-software-city-src-pages-Settings-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-lib-utils-ts",
      "type": "import"
    },
    {
      "id": "road-312",
      "fromBuilding": "building-artifacts-software-city-src-pages-SharedCity-tsx",
      "toBuilding": "building-artifacts-software-city-src-components-city-CityMap-tsx",
      "type": "import"
    },
    {
      "id": "road-313",
      "fromBuilding": "building-artifacts-software-city-src-pages-not-found-tsx",
      "toBuilding": "building-artifacts-mockup-sandbox-src-components-ui-card-tsx",
      "type": "import"
    },
    {
      "id": "road-314",
      "fromBuilding": "building-lib-api-client-react-src-generated-api-ts",
      "toBuilding": "building-lib-api-client-react-src-generated-api-schemas-ts",
      "type": "import"
    },
    {
      "id": "road-315",
      "fromBuilding": "building-lib-api-client-react-src-generated-api-ts",
      "toBuilding": "building-lib-api-client-react-src-custom-fetch-ts",
      "type": "import"
    },
    {
      "id": "road-316",
      "fromBuilding": "building-lib-api-zod-src-generated-types-agent-ts",
      "toBuilding": "building-lib-api-zod-src-generated-types-agentRole-ts",
      "type": "import"
    },
    {
      "id": "road-317",
      "fromBuilding": "building-lib-api-zod-src-generated-types-agent-ts",
      "toBuilding": "building-lib-api-zod-src-generated-types-agentStatus-ts",
      "type": "import"
    },
    {
      "id": "road-318",
      "fromBuilding": "building-lib-api-zod-src-generated-types-agentList-ts",
      "toBuilding": "building-lib-api-zod-src-generated-types-agent-ts",
      "type": "import"
    },
    {
      "id": "road-319",
      "fromBuilding": "building-lib-api-zod-src-generated-types-agentTaskRequest-ts",
      "toBuilding": "building-lib-api-zod-src-generated-types-agentTaskRequestTaskType-ts",
      "type": "import"
    },
    {
      "id": "road-320",
      "fromBuilding": "building-lib-api-zod-src-generated-types-cityEvent-ts",
      "toBuilding": "building-lib-api-zod-src-generated-types-cityEventSeverity-ts",
      "type": "import"
    },
    {
      "id": "road-321",
      "fromBuilding": "building-lib-api-zod-src-generated-types-cityEvent-ts",
      "toBuilding": "building-lib-api-zod-src-generated-types-cityEventType-ts",
      "type": "import"
    },
    {
      "id": "road-322",
      "fromBuilding": "building-lib-api-zod-src-generated-types-cityEventList-ts",
      "toBuilding": "building-lib-api-zod-src-generated-types-cityEvent-ts",
      "type": "import"
    },
    {
      "id": "road-323",
      "fromBuilding": "building-lib-api-zod-src-generated-types-cityHealth-ts",
      "toBuilding": "building-lib-api-zod-src-generated-types-cityHealthBreakdown-ts",
      "type": "import"
    },
    {
      "id": "road-324",
      "fromBuilding": "building-lib-api-zod-src-generated-types-cityHealth-ts",
      "toBuilding": "building-lib-api-zod-src-generated-types-cityHealthSeason-ts",
      "type": "import"
    },
    {
      "id": "road-325",
      "fromBuilding": "building-lib-api-zod-src-generated-types-cityLayout-ts",
      "toBuilding": "building-lib-api-zod-src-generated-types-cityLayoutSeason-ts",
      "type": "import"
    },
    {
      "id": "road-326",
      "fromBuilding": "building-lib-api-zod-src-generated-types-cityLayout-ts",
      "toBuilding": "building-lib-api-zod-src-generated-types-road-ts",
      "type": "import"
    },
    {
      "id": "road-327",
      "fromBuilding": "building-lib-api-zod-src-generated-types-knowledgeEntryList-ts",
      "toBuilding": "building-lib-api-zod-src-generated-types-knowledgeEntry-ts",
      "type": "import"
    },
    {
      "id": "road-328",
      "fromBuilding": "building-lib-api-zod-src-generated-types-knowledgeStats-ts",
      "toBuilding": "building-lib-api-zod-src-generated-types-knowledgeStatsTopProblemsItem-ts",
      "type": "import"
    },
    {
      "id": "road-329",
      "fromBuilding": "building-lib-api-zod-src-generated-types-road-ts",
      "toBuilding": "building-lib-api-zod-src-generated-types-roadType-ts",
      "type": "import"
    },
    {
      "id": "road-330",
      "fromBuilding": "building-lib-api-zod-src-generated-types-spawnAgentRequest-ts",
      "toBuilding": "building-lib-api-zod-src-generated-types-spawnAgentRequestRole-ts",
      "type": "import"
    }
  ],
  "repoName": "GI-Synth/CodeCity-V1",
  "totalFiles": 304,
  "season": "winter",
  "healthScore": 19,
  "generatedAt": "2026-03-14T22:25:39.190Z"
}
~~~

## Questions 5-8 (Asset Pipeline Part 1)

### 5) Full cityAnalyzer.ts output

cityAnalyzer.ts (full):

~~~ts
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

function normalizeStem(filePath: string): string {
  return filePath
    .replace(/\\/g, "/")
    .toLowerCase()
    .replace(/\.(test|spec|e2e|unit|integration)(?=\.)/g, "")
    .replace(/\.[^.\/]+$/, "");
}

function isTestLikePath(filePath: string): boolean {
  const lower = filePath.replace(/\\/g, "/").toLowerCase();
  return /(^|\/)(__tests__|tests|test|spec)(\/|$)/.test(lower)
    || /\.(test|spec)\.[^.\/]+$/.test(lower);
}

function estimateCoverage(isTestFile: boolean, hasTests: boolean, complexity: number, realLoc: number): number {
  if (isTestFile) return 1;
  if (!hasTests) return 0;

  const base = 0.72;
  const complexityPenalty = Math.min(0.28, complexity / 100);
  const locPenalty = Math.min(0.18, realLoc / 1800);
  return Math.max(0, Math.min(1, base - complexityPenalty - locPenalty));
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
  const testStemSet = new Set<string>();

  for (const file of files) {
    const folder = file.folder || "root";
    if (!folderMap.has(folder)) folderMap.set(folder, []);
    folderMap.get(folder)!.push(file);

    if (isTestLikePath(file.path)) {
      testStemSet.add(normalizeStem(file.path));
    }
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
      const normalizedStem = normalizeStem(file.path);
      const hasTests = isTestFile || testStemSet.has(normalizedStem);
      const testCoverage = estimateCoverage(isTestFile, hasTests, complexity, realLoc);
      const commitCount = Math.max(1, Math.floor(realLoc / 20) + metrics.imports.length * 2 + (hasTests ? 4 : 0));
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
    const orderedBuildings = Array.from(buildingMap.values())
      .sort((a, b) => a.filePath.localeCompare(b.filePath));

    for (let i = 0; i < orderedBuildings.length - 1; i++) {
      if (roads.length > 25) break;

      const from = orderedBuildings[i];
      const to = orderedBuildings[i + 1];
      if (!roads.find(r => r.fromBuilding === from.id && r.toBuilding === to.id)) {
        roads.push({
          id: `road-${roadIndex++}`,
          fromBuilding: from.id,
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

~~~

### 6) Extracted Kenney packs on disk

Command output (ls artifacts/software-city/public/assets/kenney/packs/):

~~~text
3d-road-tiles
car-kit
city-kit-commercial
city-kit-industrial
city-kit-roads
city-kit-suburban
conveyor-kit
isometric-roads-water
modular-buildings
nature-kit
train-kit

~~~

### 7) Example GLB file path from city-kit-commercial

Command output (find ... city-kit-commercial -name "*.glb" | head -5):

~~~text
artifacts/software-city/public/assets/kenney/packs/city-kit-commercial/Models/GLB format/building-a.glb
artifacts/software-city/public/assets/kenney/packs/city-kit-commercial/Models/GLB format/building-c.glb
artifacts/software-city/public/assets/kenney/packs/city-kit-commercial/Models/GLB format/building-b.glb
artifacts/software-city/public/assets/kenney/packs/city-kit-commercial/Models/GLB format/building-f.glb
artifacts/software-city/public/assets/kenney/packs/city-kit-commercial/Models/GLB format/building-g.glb

~~~

### 8) Full roads-pieces.txt

roads-pieces.txt:

~~~text
bridge-pillar-wide.fbx
bridge-pillar-wide.obj
bridge-pillar.fbx
bridge-pillar.obj
construction-barrier.fbx
construction-barrier.obj
construction-cone.fbx
construction-cone.obj
construction-light.fbx
construction-light.obj
light-curved-cross.fbx
light-curved-cross.obj
light-curved-double.fbx
light-curved-double.obj
light-curved.fbx
light-curved.obj
light-square-cross.fbx
light-square-cross.obj
light-square-double.fbx
light-square-double.obj
light-square.fbx
light-square.obj
road-bend-barrier.fbx
road-bend-barrier.obj
road-bend-sidewalk.fbx
road-bend-sidewalk.obj
road-bend-square-barrier.fbx
road-bend-square-barrier.obj
road-bend-square.fbx
road-bend-square.obj
road-bend.fbx
road-bend.obj
road-bridge.fbx
road-bridge.obj
road-crossing.fbx
road-crossing.obj
road-crossroad-barrier.fbx
road-crossroad-barrier.obj
road-crossroad-line.fbx
road-crossroad-line.obj
road-crossroad-path.fbx
road-crossroad-path.obj
road-crossroad.fbx
road-crossroad.obj
road-curve-barrier.fbx
road-curve-barrier.obj
road-curve-intersection-barrier.fbx
road-curve-intersection-barrier.obj
road-curve-intersection.fbx
road-curve-intersection.obj
road-curve-pavement.fbx
road-curve-pavement.obj
road-curve.fbx
road-curve.obj
road-driveway-double-barrier.fbx
road-driveway-double-barrier.obj
road-driveway-double.fbx
road-driveway-double.obj
road-driveway-single-barrier.fbx
road-driveway-single-barrier.obj
road-driveway-single.fbx
road-driveway-single.obj
road-end-barrier.fbx
road-end-barrier.obj
road-end-round-barrier.fbx
road-end-round-barrier.obj
road-end-round.fbx
road-end-round.obj
road-end.fbx
road-end.obj
road-intersection-barrier.fbx
road-intersection-barrier.obj
road-intersection-line.fbx
road-intersection-line.obj
road-intersection-path.fbx
road-intersection-path.obj
road-intersection.fbx
road-intersection.obj
road-roundabout-barrier.fbx
road-roundabout-barrier.obj
road-roundabout.fbx
road-roundabout.obj
road-side-barrier.fbx
road-side-barrier.obj
road-side-entry-barrier.fbx
road-side-entry-barrier.obj
road-side-entry.fbx
road-side-entry.obj
road-side-exit-barrier.fbx
road-side-exit-barrier.obj
road-side-exit.fbx
road-side-exit.obj
road-side.fbx
road-side.obj
road-slant-barrier.fbx
road-slant-barrier.obj
road-slant-curve-barrier.fbx
road-slant-curve-barrier.obj
road-slant-curve.fbx
road-slant-curve.obj
road-slant-flat-curve.fbx
road-slant-flat-curve.obj
road-slant-flat-high.fbx
road-slant-flat-high.obj
road-slant-flat.fbx
road-slant-flat.obj
road-slant-high-barrier.fbx
road-slant-high-barrier.obj
road-slant-high.fbx
road-slant-high.obj
road-slant.fbx
road-slant.obj
road-split-barrier.fbx
road-split-barrier.obj
road-split.fbx
road-split.obj
road-square-barrier.fbx
road-square-barrier.obj
road-square.fbx
road-square.obj
road-straight-barrier-end.fbx
road-straight-barrier-end.obj
road-straight-barrier-half.fbx
road-straight-barrier-half.obj
road-straight-barrier.fbx
road-straight-barrier.obj
road-straight-half.fbx
road-straight-half.obj
road-straight.fbx
road-straight.obj
sign-highway-detailed.fbx
sign-highway-detailed.obj
sign-highway-wide.fbx
sign-highway-wide.obj
sign-highway.fbx
sign-highway.obj
tile-high.fbx
tile-high.obj
tile-low.fbx
tile-low.obj
tile-slant.fbx
tile-slant.obj
tile-slantHigh.fbx
tile-slantHigh.obj

~~~

## Questions 9-12 (Asset Pipeline Part 2 and Frontend Architecture)

### 9) Kenney road tile size and pack readme/txt contents

Pack docs content (from city-kit-roads md/txt files):

~~~text
	

	City Kit Roads (2.0)

	Created/distributed by Kenney (www.kenney.nl)
	Creation date: 13-03-2025 12:18
	
			------------------------------

	License: (Creative Commons Zero, CC0)
	http://creativecommons.org/publicdomain/zero/1.0/

	You can use this content for personal, educational, and commercial purposes.

	Support by crediting 'Kenney' or 'www.kenney.nl' (this is not a requirement)

			------------------------------

	• Website : www.kenney.nl
	• Donate  : www.kenney.nl/donate

	• Patreon : patreon.com/kenney
	
	Follow on social media for updates:

	• Twitter:   twitter.com/KenneyNL
	• Instagram: instagram.com/kenney_nl
	• Mastodon:  mastodon.gamedev.place/@kenney
~~~

Measured sample road tile from road-straight.glb by parsing GLB accessor bounds:

~~~json
{
  "file": "artifacts/software-city/public/assets/kenney/packs/city-kit-roads/Models/GLB format/road-straight.glb",
  "primitiveCount": 1,
  "maxPrimitiveDimensions": [1, 0.02, 1],
  "note": "Units are glTF units (typically meters)"
}
~~~

### 10) Frontend framework version with full artifacts/software-city/package.json

Answer: Frontend is a Vite React app using react/react-dom from workspace catalog versions.

package.json (full):

~~~json
{
  "name": "@workspace/software-city",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "PORT=${PORT:-5173} BASE_PATH=${BASE_PATH:-/} vite --config vite.config.ts --host 0.0.0.0",
    "build": "PORT=${PORT:-5173} BASE_PATH=${BASE_PATH:-/} vite build --config vite.config.ts",
    "serve": "PORT=${PORT:-5173} BASE_PATH=${BASE_PATH:-/} vite preview --config vite.config.ts --host 0.0.0.0",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@hookform/resolvers": "^3.10.0",
    "@radix-ui/react-accordion": "^1.2.4",
    "@radix-ui/react-alert-dialog": "^1.1.7",
    "@radix-ui/react-aspect-ratio": "^1.1.3",
    "@radix-ui/react-avatar": "^1.1.4",
    "@radix-ui/react-checkbox": "^1.1.5",
    "@radix-ui/react-collapsible": "^1.1.4",
    "@radix-ui/react-context-menu": "^2.2.7",
    "@radix-ui/react-dialog": "^1.1.7",
    "@radix-ui/react-dropdown-menu": "^2.1.7",
    "@radix-ui/react-hover-card": "^1.1.7",
    "@radix-ui/react-label": "^2.1.3",
    "@radix-ui/react-menubar": "^1.1.7",
    "@radix-ui/react-navigation-menu": "^1.2.6",
    "@radix-ui/react-popover": "^1.1.7",
    "@radix-ui/react-progress": "^1.1.3",
    "@radix-ui/react-radio-group": "^1.2.4",
    "@radix-ui/react-scroll-area": "^1.2.4",
    "@radix-ui/react-select": "^2.1.7",
    "@radix-ui/react-separator": "^1.1.3",
    "@radix-ui/react-slider": "^1.2.4",
    "@radix-ui/react-slot": "^1.2.0",
    "@radix-ui/react-switch": "^1.1.4",
    "@radix-ui/react-tabs": "^1.1.4",
    "@radix-ui/react-toast": "^1.2.7",
    "@radix-ui/react-toggle": "^1.1.3",
    "@radix-ui/react-toggle-group": "^1.1.3",
    "@radix-ui/react-tooltip": "^1.2.0",
    "@tanstack/react-query": "catalog:",
    "@workspace/api-client-react": "workspace:*",
    "class-variance-authority": "catalog:",
    "clsx": "catalog:",
    "cmdk": "^1.1.1",
    "date-fns": "^3.6.0",
    "diff2html": "^3.4.56",
    "embla-carousel-react": "^8.6.0",
    "framer-motion": "catalog:",
    "input-otp": "^1.4.2",
    "lucide-react": "catalog:",
    "next-themes": "^0.4.6",
    "react": "catalog:",
    "react-day-picker": "^9.11.1",
    "react-dom": "catalog:",
    "react-hook-form": "^7.55.0",
    "react-icons": "^5.4.0",
    "react-resizable-panels": "^2.1.7",
    "recharts": "^2.15.4",
    "sonner": "^2.0.7",
    "tailwind-merge": "catalog:",
    "tw-animate-css": "^1.4.0",
    "vaul": "^1.1.2",
    "wouter": "^3.3.5",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@replit/vite-plugin-cartographer": "catalog:",
    "@replit/vite-plugin-dev-banner": "catalog:",
    "@replit/vite-plugin-runtime-error-modal": "catalog:",
    "@tailwindcss/typography": "^0.5.15",
    "@tailwindcss/vite": "catalog:",
    "@types/node": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "@vitejs/plugin-react": "catalog:",
    "tailwindcss": "catalog:",
    "vite": "catalog:"
  }
}

~~~

### 11) Full vite.config.ts

vite.config.ts (full):

~~~ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

const rawApiPort = process.env.API_PORT ?? "3000";
const apiPort = Number(rawApiPort);

if (Number.isNaN(apiPort) || apiPort <= 0) {
  throw new Error(`Invalid API_PORT value: "${rawApiPort}"`);
}

const apiTarget = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
      "/ws": {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
      },
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});

~~~

### 12) Existing Three.js / React Three Fiber / Drei imports

Command output (grep -r "three\|@react-three\|fiber\|drei" artifacts/software-city/src --include="*.ts" --include="*.tsx" -l):

~~~text
(no matches)
~~~

## Questions 13-17 (Performance Baseline and Constraints)

### 13) Current buildings/districts rendered and typical FPS

Answer: Live layout currently contains 37 districts and 304 buildings (computed from GET /api/city/layout response).

FPS baseline: no recorded numeric benchmark for the demo dataset was found in repo docs. The system includes an F3 debug HUD that displays browser FPS live, but there is no committed "typical FPS" value.

### 14) Target device and FPS requirement

Answer: Documentation states the UI is desktop-only right now (mobile responsive layout listed as missing/work in progress). No hard repo-level requirement was found declaring 60 FPS or 30 FPS as mandatory for city rendering.

### 15) Deployment target and asset serving size limits

Answer: Repo docs repeatedly reference Replit-hosted development/deployment context. I did not find evidence of an active Vercel deployment in this workspace. I also did not find an explicit configured asset size limit; only a frontend bundle size warning is documented.

### 16) React as hard constraint vs plain canvas/WebGL mounted in React

Answer: Current frontend is React + Vite and current renderer is SVG. There is no explicit hard technical constraint in this repo that would prevent mounting a plain Canvas/WebGL renderer inside a React component.

### 17) Existing Three.js experiments/spike branches with git branch -a and git log --oneline -20

git branch -a:

~~~text
* main
  remotes/origin/HEAD -> origin/main
  remotes/origin/main

~~~

git log --oneline -20:

~~~text
03c70bb Agent brain files, visual improvements, mayor fixes
e608919 remove env.template from tracking
9972161 Smart agents, vector search, healing loop, mayor personality
35c52e7 feat: implement mayor advisor phases A-E
ceec140 Update the city's database file with new information
c6375ff Update the city database file with new information
0eb3311 first commit
ed5656a Enhance the software city application with new features and stability improvements
df5c4a3 Add agent pausing, knowledge base search, and map interactivity
de85e19 Migrate database to SQLite and improve API performance
a4fabfa Add ability to save repository URL and GitHub token
44782a9 Add real test execution, code coverage, and agent leaderboard
0378fb9 Enhance software city analysis with real-time data and agent interactions
f5208a1 Update development prompt and asset files for Software City Phase 2
85ea04a Create a comprehensive handoff document detailing the software city project
b1ea3ab Update project documentation with all current features and details
285ae62 Add ability to load private GitHub repositories
e8a2283 Add interactive city map, debug HUD, and knowledge base search
db9b128 Update documentation for final system polish and migration preparation
03d6b32 Add the ability to visualize code repositories as interactive cities

~~~

import { useMemo, useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { CityLayout, Agent, Building } from "@workspace/api-client-react";

interface CityMapProps {
  layout: CityLayout;
  agents: Agent[];
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

const SEASON_OVERLAY: Record<string, string> = {
  summer: "rgba(123, 198, 126, 0.04)",
  spring: "rgba(168, 216, 168, 0.03)",
  autumn: "rgba(212, 145, 90, 0.05)",
  winter: "rgba(139, 184, 212, 0.08)",
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

                if (isLowLod) {
                  return (
                    <rect
                      key={building.id}
                      x={building.x}
                      y={building.y}
                      width={building.width}
                      height={building.height}
                      fill={color}
                      fillOpacity={opacity}
                      stroke={isSelected ? "#fff" : "rgba(0,0,0,0.3)"}
                      strokeWidth={isSelected ? 2 : 0.5}
                      rx="2"
                      onClick={() => onSelectBuilding(building.id)}
                      className="cursor-pointer"
                    />
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

        {/* Season overlay tint */}
        {layout.season && SEASON_OVERLAY[layout.season] && (
          <rect
            x={center.x - viewW / 2}
            y={center.y - viewH / 2}
            width={viewW}
            height={viewH}
            fill={SEASON_OVERLAY[layout.season]}
            className="pointer-events-none"
          />
        )}

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

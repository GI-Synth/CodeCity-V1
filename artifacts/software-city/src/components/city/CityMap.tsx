import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { CityLayout, Agent, Building, District } from "@workspace/api-client-react";
import { Bug, ShieldCheck, Flame, ShieldAlert, Zap } from "lucide-react";

interface CityMapProps {
  layout: CityLayout;
  agents: Agent[];
  selectedBuildingId: string | null;
  onSelectBuilding: (id: string) => void;
}

// Map file types to neon colors
const TYPE_COLORS: Record<string, string> = {
  class: "#00fff7",      // Cyan
  function: "#00ff00",   // Green
  api: "#ff9900",        // Orange
  database: "#b026ff",   // Purple
  config: "#ffff00",     // Yellow
  test: "#ff00ff",       // Magenta
  entry: "#ffffff",      // White
  unknown: "#888888",    // Gray
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
  summer: "#0a0e1a", // Deep night
  spring: "#0a1515", // Slight green tint
  autumn: "#1a100a", // Slight orange tint
  winter: "#151515", // Dark gray
};

export function CityMap({ layout, agents, selectedBuildingId, onSelectBuilding }: CityMapProps) {
  // Calculate bounding box for SVG viewBox
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

    // Add padding
    const padding = 100;
    return {
      minX: minX - padding,
      minY: minY - padding,
      width: (maxX - minX) + padding * 2,
      height: (maxY - minY) + padding * 2
    };
  }, [layout]);

  const [hoveredBuilding, setHoveredBuilding] = useState<Building | null>(null);

  // Extract all buildings for easy mapping
  const allBuildings = useMemo(() => {
    const map = new Map<string, Building>();
    layout.districts?.forEach(d => d.buildings.forEach(b => map.set(b.id, b)));
    return map;
  }, [layout]);

  return (
    <div 
      className="w-full h-full relative overflow-hidden bg-background transition-colors duration-1000"
      style={{ backgroundColor: SEASON_BGS[layout.season || 'summer'] }}
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
        {/* Draw Roads (Dependencies) */}
        <g className="roads">
          {layout.roads?.map(road => {
            const from = allBuildings.get(road.fromBuilding);
            const to = allBuildings.get(road.toBuilding);
            if (!from || !to) return null;
            
            const isHighlighted = selectedBuildingId === from.id || selectedBuildingId === to.id;
            
            return (
              <line
                key={road.id}
                x1={from.x + from.width / 2}
                y1={from.y + from.height / 2}
                x2={to.x + to.width / 2}
                y2={to.y + to.height / 2}
                stroke={isHighlighted ? "#00fff7" : "rgba(0, 255, 247, 0.15)"}
                strokeWidth={isHighlighted ? 4 : 2}
                strokeDasharray={road.type === 'import' ? "none" : "5,5"}
                className="transition-all duration-300"
              />
            );
          })}
        </g>

        {/* Draw Districts */}
        {layout.districts?.map(district => (
          <g key={district.id} className="district">
            <rect
              x={district.x}
              y={district.y}
              width={district.width}
              height={district.height}
              fill={DISTRICT_COLORS[district.type] || "rgba(255,255,255,0.05)"}
              stroke="rgba(0, 255, 247, 0.3)"
              strokeWidth="2"
              rx="8"
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

            {/* Draw Buildings in District */}
            {district.buildings?.map(building => {
              const color = TYPE_COLORS[building.fileType] || TYPE_COLORS.unknown;
              const isSelected = selectedBuildingId === building.id;
              const isHovered = hoveredBuilding?.id === building.id;
              
              // Age affects opacity
              let opacity = 1;
              if (building.age === 'aged') opacity = 0.7;
              if (building.age === 'ancient') opacity = 0.4;

              return (
                <g 
                  key={building.id} 
                  transform={`translate(${building.x}, ${building.y})`}
                  onClick={() => onSelectBuilding(building.id)}
                  onMouseEnter={() => setHoveredBuilding(building)}
                  onMouseLeave={() => setHoveredBuilding(null)}
                  className="cursor-pointer transition-transform duration-200 hover:scale-[1.02] transform-origin-center"
                  style={{ transformOrigin: `${building.width/2}px ${building.height/2}px` }}
                >
                  {/* Glow effect if selected or high coverage */}
                  {(isSelected || building.status === 'glowing') && (
                    <rect
                      x="-5" y="-5"
                      width={building.width + 10}
                      height={building.height + 10}
                      fill="none"
                      stroke={color}
                      strokeWidth="3"
                      filter="url(#glow)"
                      className="animate-pulse"
                    />
                  )}
                  
                  {/* Building Block */}
                  <rect
                    width={building.width}
                    height={building.height}
                    fill={color}
                    fillOpacity={opacity}
                    stroke={isSelected ? "#fff" : "rgba(0,0,0,0.5)"}
                    strokeWidth={isSelected ? 3 : 1}
                    rx="4"
                  />
                  
                  {/* Inner details (floors representation) */}
                  <rect
                    x="2" y="2"
                    width={building.width - 4}
                    height={building.height - 4}
                    fill="transparent"
                    stroke="rgba(0,0,0,0.3)"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                  />

                  {/* Status Overlays */}
                  <g transform={`translate(${building.width/2}, ${building.height/2})`} className="pointer-events-none">
                    {building.activeEvent === 'fire' && <text x="-12" y="8" fontSize="24" className="animate-bounce">🔥</text>}
                    {building.activeEvent === 'sparkle' && <text x="-12" y="8" fontSize="24" className="animate-pulse">✨</text>}
                    {building.activeEvent === 'alarm' && <text x="-12" y="8" fontSize="24" className="animate-pulse">🚨</text>}
                    {building.activeEvent === 'flood' && <text x="-12" y="8" fontSize="24">🌊</text>}
                    {building.activeEvent === 'smoke' && <text x="-12" y="8" fontSize="24">💨</text>}
                    
                    {/* Fallback to status if no active event */}
                    {!building.activeEvent && building.status === 'error' && <text x="-12" y="8" fontSize="24">❌</text>}
                  </g>
                </g>
              );
            })}
          </g>
        ))}

        {/* Draw Agents */}
        <AnimatePresence>
          {agents?.map(agent => (
            <motion.g
              key={agent.id}
              initial={false}
              animate={{ x: agent.x, y: agent.y }}
              transition={{ type: "spring", stiffness: 50, damping: 10 }}
              className="pointer-events-none"
            >
              <circle r="8" fill={agent.color} className="animate-ping opacity-75" />
              <circle r="6" fill={agent.color} stroke="#fff" strokeWidth="2" />
              <text y="-12" textAnchor="middle" fill="#fff" fontSize="12" fontFamily="JetBrains Mono" className="drop-shadow-md">
                {agent.name}
              </text>
            </motion.g>
          ))}
        </AnimatePresence>

        {/* SVG Filters */}
        <defs>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
      </svg>

      {/* Floating Tooltip */}
      {hoveredBuilding && (
        <div 
          className="absolute pointer-events-none glass-panel p-3 rounded border border-primary z-50 transition-opacity"
          style={{ 
            left: '50%', top: '20px', transform: 'translateX(-50%)'
          }}
        >
          <div className="font-mono font-bold text-primary">{hoveredBuilding.name}</div>
          <div className="text-xs text-muted-foreground">{hoveredBuilding.filePath}</div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <span className="text-foreground">Type:</span> <span style={{ color: TYPE_COLORS[hoveredBuilding.fileType] }}>{hoveredBuilding.fileType}</span>
            <span className="text-foreground">LOC:</span> <span className="text-primary">{hoveredBuilding.linesOfCode}</span>
            <span className="text-foreground">Coverage:</span> <span className={hoveredBuilding.testCoverage > 0.8 ? "text-green-400" : "text-red-400"}>{Math.round(hoveredBuilding.testCoverage * 100)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

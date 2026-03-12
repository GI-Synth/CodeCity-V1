import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { CityMap } from "@/components/city/CityMap";
import { BuildingInspector } from "@/components/city/BuildingInspector";
import { HUD } from "@/components/city/HUD";
import { useGetCityLayout, useGetCityHealth, useGetLiveMetrics, useListAgents } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";

export function CityView() {
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);

  // Poll data
  const { data: layout, isLoading: layoutLoading } = useGetCityLayout({ query: { refetchInterval: 5000 }});
  const { data: health } = useGetCityHealth({ query: { refetchInterval: 5000 }});
  const { data: metrics } = useGetLiveMetrics({ query: { refetchInterval: 2000 }});
  const { data: agentsData } = useListAgents({ query: { refetchInterval: 2000 }});

  const selectedBuilding = layout?.districts
    ?.flatMap(d => d.buildings)
    .find(b => b.id === selectedBuildingId);

  if (layoutLoading) {
    return (
      <AppLayout>
        <div className="flex-1 flex flex-col items-center justify-center bg-background text-primary font-mono">
          <Loader2 size={48} className="animate-spin mb-4" />
          <div className="text-glow">INITIALIZING CITY GRID...</div>
        </div>
      </AppLayout>
    );
  }

  if (!layout) {
    return (
      <AppLayout>
        <div className="flex-1 flex items-center justify-center bg-background text-destructive font-mono">
          FAILED TO LOAD CITY LAYOUT
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="relative w-full h-full flex">
        {/* Main Canvas Area */}
        <div className="flex-1 relative">
          <HUD health={health} metrics={metrics} />
          
          <CityMap 
            layout={layout} 
            agents={agentsData?.agents || []} 
            selectedBuildingId={selectedBuildingId}
            onSelectBuilding={setSelectedBuildingId}
          />
        </div>

        {/* Right Sidebar Inspector */}
        {selectedBuilding && (
          <BuildingInspector 
            building={selectedBuilding} 
            onClose={() => setSelectedBuildingId(null)} 
          />
        )}
      </div>
    </AppLayout>
  );
}

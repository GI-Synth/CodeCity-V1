import { useEffect, useState } from "react";
import { CityMap } from "@/components/city/CityMap";
import { useParams, useLocation } from "wouter";
import { Loader2, Eye, Heart, TreePine } from "lucide-react";
import type { CityLayout } from "@workspace/api-client-react";

interface SnapshotData {
  layout: CityLayout;
  score: number;
  season: string;
  totalBugs: number;
  repoName: string;
  repoSlug: string;
  createdAt: string;
}

interface SharedResponse {
  token: string;
  viewCount: number;
  repoSlug: string;
  repoName: string;
  snapshotData: SnapshotData;
}

export function SharedCity() {
  const params = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const [data, setData] = useState<SharedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params.token) return;
    fetch(`/api/shared/${params.token}`)
      .then(r => r.ok ? r.json() as Promise<SharedResponse> : Promise.reject(new Error("Not found")))
      .then(d => setData(d))
      .catch(() => setError("Snapshot not found or expired."))
      .finally(() => setLoading(false));
  }, [params.token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center font-mono text-[#00fff7]">
        <div className="text-center">
          <Loader2 size={48} className="animate-spin mx-auto mb-4" />
          <div>Loading city snapshot…</div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center font-mono text-red-400">
        <div className="text-center glass-panel p-10 rounded-xl border border-red-500/30">
          <div className="text-2xl mb-4">⚠ Not Found</div>
          <div className="text-muted-foreground mb-6">{error}</div>
          <button
            onClick={() => setLocation("/")}
            className="px-6 py-2 rounded border border-[#00fff7]/30 text-[#00fff7] hover:bg-[#00fff7]/10 text-sm"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  const snap = data.snapshotData;
  const scoreColor = snap.score >= 80 ? "#00ff88" : snap.score >= 50 ? "#ffcc00" : "#ff3333";

  return (
    <div className="min-h-screen bg-[#0a0e1a] flex flex-col font-mono">
      {/* Header */}
      <div className="border-b border-[#00fff7]/20 bg-black/60 px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Software City — Shared Snapshot</div>
          <h1 className="text-xl font-bold text-[#00fff7]">{snap.repoName || data.repoName}</h1>
        </div>
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Eye size={14} />
            <span>{data.viewCount} views</span>
          </div>
          <div className="flex items-center gap-1.5" style={{ color: scoreColor }}>
            <Heart size={14} />
            <span>Health {snap.score}%</span>
          </div>
          <div className="flex items-center gap-1.5 text-blue-400 capitalize">
            <TreePine size={14} />
            <span>{snap.season}</span>
          </div>
          <div className="text-muted-foreground text-xs">
            {snap.createdAt ? new Date(snap.createdAt).toLocaleDateString() : ""}
          </div>
        </div>
      </div>

      {/* City */}
      <div className="flex-1" style={{ minHeight: "calc(100vh - 80px)" }}>
        {snap.layout ? (
          <CityMap
            layout={snap.layout}
            agents={[]}
            selectedBuildingId={null}
            onSelectBuilding={() => {}}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            No city layout data available.
          </div>
        )}
      </div>
    </div>
  );
}

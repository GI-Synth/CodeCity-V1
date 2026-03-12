import { AppLayout } from "@/components/layout/AppLayout";
import { useGetKnowledgeStats, useGetKnowledgeEntries } from "@workspace/api-client-react";
import { Brain, DatabaseZap, ShieldAlert, BookOpen } from "lucide-react";
import { format } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function KnowledgeBase() {
  const { data: stats } = useGetKnowledgeStats({ query: { refetchInterval: 10000 }});
  const { data: entriesData } = useGetKnowledgeEntries({ query: { refetchInterval: 10000 }});

  return (
    <AppLayout>
      <div className="p-8 h-full overflow-y-auto max-w-7xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-mono font-bold text-secondary text-glow mb-2 flex items-center gap-3">
            <Brain className="text-secondary" /> Knowledge Base
          </h1>
          <p className="text-muted-foreground font-mono text-sm">
            The collective memory of all agents. Escalations are saved here to improve future performance.
          </p>
        </div>

        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <StatCard title="Total Entries" value={stats.totalEntries} icon={BookOpen} color="text-primary" />
            <StatCard title="Cache Hits" value={stats.totalCacheHits} icon={DatabaseZap} color="text-success" />
            <StatCard title="Escalation Rate" value={`${Math.round(stats.escalationRate * 100)}%`} icon={ShieldAlert} color="text-warning" />
            <StatCard title="Avg Bugs/Entry" value={stats.avgBugsPerEntry.toFixed(2)} icon={Brain} color="text-secondary" />
          </div>
        )}

        <div className="glass-panel rounded-xl overflow-hidden border border-border/50">
          <div className="p-4 border-b border-border/50 bg-black/40">
            <h3 className="font-mono text-lg font-bold text-foreground">Recent Learnings</h3>
          </div>
          <Table>
            <TableHeader className="bg-black/60 font-mono">
              <TableRow className="border-border/30 hover:bg-transparent">
                <TableHead className="text-muted-foreground">Pattern</TableHead>
                <TableHead className="text-muted-foreground">Language</TableHead>
                <TableHead className="text-muted-foreground max-w-[300px]">Question</TableHead>
                <TableHead className="text-muted-foreground">Confidence</TableHead>
                <TableHead className="text-muted-foreground text-right">Uses</TableHead>
                <TableHead className="text-muted-foreground text-right">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="font-mono text-sm">
              {entriesData?.entries.map((entry) => (
                <TableRow key={entry.id} className="border-border/20 hover:bg-primary/5 transition-colors">
                  <TableCell className="font-medium text-secondary">{entry.problemType}</TableCell>
                  <TableCell className="text-foreground/80">{entry.language}</TableCell>
                  <TableCell className="max-w-[300px] truncate text-muted-foreground" title={entry.question}>
                    {entry.question}
                  </TableCell>
                  <TableCell>
                    <span className={`px-2 py-1 rounded text-xs ${
                      entry.confidence === 'high' ? 'bg-success/20 text-success' : 
                      entry.confidence === 'medium' ? 'bg-warning/20 text-warning' : 
                      'bg-destructive/20 text-destructive'
                    }`}>
                      {entry.confidence}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-bold text-primary">{entry.useCount}</TableCell>
                  <TableCell className="text-right text-muted-foreground text-xs">
                    {format(new Date(entry.createdAt), "MMM d, HH:mm")}
                  </TableCell>
                </TableRow>
              ))}
              {!entriesData?.entries?.length && (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No entries in knowledge base yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </AppLayout>
  );
}

function StatCard({ title, value, icon: Icon, color }: any) {
  return (
    <div className="glass-card p-6 rounded-xl flex items-center justify-between group">
      <div>
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-2">{title}</div>
        <div className="text-3xl font-mono font-bold text-foreground group-hover:text-glow transition-all">{value}</div>
      </div>
      <div className={`p-4 rounded-full bg-black/40 border border-border/50 ${color}`}>
        <Icon size={24} />
      </div>
    </div>
  );
}

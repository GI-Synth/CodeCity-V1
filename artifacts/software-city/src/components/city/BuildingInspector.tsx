import { useState } from "react";
import { Building, useAssignAgentTask, useChatWithAgent } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Terminal, Shield, Flame, Activity, GitCommit, FileCode, MessageSquare, Send, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function BuildingInspector({ building, onClose }: { building: Building, onClose: () => void }) {
  const { toast } = useToast();
  const [chatMsg, setChatMsg] = useState("");
  const [chatLog, setChatLog] = useState<{sender: string, text: string}[]>([]);

  const assignTaskMutation = useAssignAgentTask({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: "Task Assigned",
          description: `${data.taskType} completed. Found ${data.bugsFound} bugs.`,
          variant: data.success ? "default" : "destructive",
        });
      }
    }
  });

  const chatMutation = useChatWithAgent({
    mutation: {
      onSuccess: (data) => {
        setChatLog(prev => [...prev, { sender: data.agentName, text: data.message }]);
      }
    }
  });

  const handleTask = (type: any) => {
    // In a real app, we'd select an agent first. Mocking agent ID for now.
    const mockAgentId = "agent-1"; 
    assignTaskMutation.mutate({
      agentId: mockAgentId,
      data: {
        taskType: type,
        buildingId: building.id,
        context: "Perform analysis on " + building.name
      }
    });
  };

  const handleChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMsg.trim()) return;
    
    setChatLog(prev => [...prev, { sender: "You", text: chatMsg }]);
    chatMutation.mutate({
      agentId: "agent-1", // mock
      data: {
        message: chatMsg,
        buildingContext: building.id
      }
    });
    setChatMsg("");
  };

  return (
    <div className="w-96 flex flex-col h-full glass-panel border-l border-primary/30 z-10 shadow-2xl relative animate-in slide-in-from-right">
      {/* Header */}
      <div className="p-4 border-b border-primary/20 bg-primary/5 flex justify-between items-start">
        <div>
          <h2 className="font-mono text-xl font-bold text-primary flex items-center gap-2">
            <FileCode size={20} />
            {building.name}
          </h2>
          <p className="text-xs text-muted-foreground font-mono mt-1 break-all">{building.filePath}</p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-primary">
          <Terminal size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Core Stats */}
        <div className="grid grid-cols-2 gap-4">
          <StatBox label="Language" value={building.language} />
          <StatBox label="Age" value={building.age} />
          <StatBox label="Lines of Code" value={building.linesOfCode.toString()} />
          <StatBox label="Complexity" value={building.complexity.toString()} />
        </div>

        {/* Health / Coverage */}
        <div className="space-y-2 bg-black/40 p-3 rounded border border-border/50">
          <div className="flex justify-between items-center text-sm font-mono">
            <span className="text-muted-foreground flex items-center gap-2"><Shield size={14}/> Test Coverage</span>
            <span className={building.testCoverage > 80 ? "text-success" : "text-warning"}>{building.testCoverage}%</span>
          </div>
          <div className="h-2 bg-background rounded-full overflow-hidden">
            <div 
              className={cn("h-full transition-all", building.testCoverage > 80 ? "bg-success" : "bg-warning")}
              style={{ width: `${building.testCoverage}%` }}
            />
          </div>
        </div>

        {/* Events / Status */}
        <div className="space-y-2">
          <h3 className="font-mono text-xs uppercase text-muted-foreground tracking-wider">Current Status</h3>
          <div className="flex gap-2 flex-wrap">
            {building.activeEvent ? (
              <span className="px-3 py-1 rounded bg-destructive/20 border border-destructive text-destructive font-mono text-xs animate-pulse flex items-center gap-2">
                <Flame size={14} /> ACTIVE {building.activeEvent.toUpperCase()}
              </span>
            ) : (
              <span className="px-3 py-1 rounded bg-success/20 border border-success text-success font-mono text-xs flex items-center gap-2">
                <ShieldCheck size={14} /> HEALTHY
              </span>
            )}
            <span className="px-3 py-1 rounded bg-primary/10 border border-primary/30 text-primary font-mono text-xs flex items-center gap-2">
              <GitCommit size={14} /> {building.commitCount} Commits
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-2">
          <h3 className="font-mono text-xs uppercase text-muted-foreground tracking-wider">Agent Actions</h3>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" onClick={() => handleTask('analyze_bug')} disabled={assignTaskMutation.isPending}>
              <Activity size={14} className="mr-2" /> Analyze
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleTask('generate_tests')} disabled={assignTaskMutation.isPending}>
              <Shield size={14} className="mr-2" /> Write Tests
            </Button>
          </div>
        </div>

        {/* Agent Chat */}
        <div className="border border-primary/20 rounded-lg overflow-hidden flex flex-col h-64 bg-black/40">
          <div className="bg-primary/10 p-2 border-b border-primary/20 text-xs font-mono text-primary flex items-center gap-2">
            <MessageSquare size={14} /> Inspector Chat
          </div>
          
          <div className="flex-1 overflow-y-auto p-2 space-y-2 text-xs font-mono">
            {chatLog.length === 0 ? (
              <div className="text-muted-foreground/50 text-center mt-10">Assign an agent or ask a question to begin.</div>
            ) : (
              chatLog.map((msg, i) => (
                <div key={i} className={cn("p-2 rounded", msg.sender === 'You' ? "bg-primary/10 ml-4" : "bg-muted mr-4")}>
                  <div className="text-[10px] text-muted-foreground mb-1">{msg.sender}</div>
                  <div className="text-foreground">{msg.text}</div>
                </div>
              ))
            )}
            {chatMutation.isPending && <div className="text-primary animate-pulse ml-4">Agent typing...</div>}
          </div>

          <form onSubmit={handleChat} className="p-2 border-t border-primary/20 flex gap-2">
            <input 
              type="text" 
              value={chatMsg}
              onChange={e => setChatMsg(e.target.value)}
              placeholder="Ask agent..." 
              className="flex-1 bg-background border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-primary text-foreground"
            />
            <Button type="submit" size="icon" variant="ghost" className="h-7 w-7 text-primary hover:bg-primary/20" disabled={chatMutation.isPending}>
              <Send size={14} />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string, value: string }) {
  return (
    <div className="bg-black/40 p-3 rounded border border-border/50">
      <div className="text-[10px] uppercase text-muted-foreground font-mono tracking-wider mb-1">{label}</div>
      <div className="font-mono text-lg text-foreground">{value}</div>
    </div>
  );
}

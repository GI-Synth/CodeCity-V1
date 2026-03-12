import { useState } from "react";
import { useLocation } from "wouter";
import { useLoadRepo, useLoadDemoRepo } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Github, Play, Terminal, ChevronDown, ChevronUp, KeyRound, ExternalLink, FolderOpen, Eye } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";

export function Landing() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [repoUrl, setRepoUrl] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [localPath, setLocalPath] = useState("");
  const [watchStatus, setWatchStatus] = useState<"idle" | "watching">("idle");

  const loadMutation = useLoadRepo({
    mutation: {
      onSuccess: () => setLocation("/city"),
      onError: (err: any) => toast({
        title: "Failed to load repository",
        description: err.message || "Could not fetch repo. Check the URL and token.",
        variant: "destructive",
      }),
    },
  });

  const demoMutation = useLoadDemoRepo({
    mutation: {
      onSuccess: () => setLocation("/city"),
      onError: () => toast({ title: "Error", description: "Failed to load demo", variant: "destructive" }),
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl) return;
    loadMutation.mutate({
      data: {
        repoUrl,
        ...(githubToken ? { githubToken } : {}),
      },
    });
  };

  const handleWatchLocal = async () => {
    if (!localPath) return;
    try {
      const res = await fetch("/api/repo/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ localPath }),
      });
      if (!res.ok) throw new Error("Watch failed");
      setWatchStatus("watching");
      toast({ title: "Watching local folder", description: localPath });
      setLocation("/city");
    } catch {
      toast({ title: "Failed to watch folder", variant: "destructive" });
    }
  };

  const isLoading = loadMutation.isPending;

  return (
    <div className="min-h-screen w-full bg-background relative flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 z-0">
        <img
          src="/api/assets/hero"
          alt="Cyberpunk City"
          className="w-full h-full object-cover opacity-30 object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/60 to-background" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="z-10 w-full max-w-2xl px-6"
      >
        <div className="text-center mb-10">
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", bounce: 0.5, delay: 0.2 }}
            className="w-24 h-24 mx-auto mb-6 relative"
          >
            <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
            <img src="/api/assets/logo" alt="Logo" className="w-full h-full relative z-10 rounded-xl" />
          </motion.div>

          <h1 className="text-5xl md:text-7xl font-mono font-bold text-white mb-4 tracking-tighter text-glow">
            SOFTWARE <span className="text-primary">CITY</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground font-mono max-w-xl mx-auto leading-relaxed">
            A living, breathing visualization of your codebase.
            Watch AI agents patrol your architecture, find bugs, and maintain city health.
          </p>
        </div>

        <div className="glass-panel p-8 rounded-2xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="text-xs font-mono text-primary uppercase tracking-widest flex items-center gap-2">
                <Terminal size={14} /> Initialize Repository
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1 group">
                  <Github className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" size={20} />
                  <Input
                    placeholder="https://github.com/user/repo"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    className="pl-10 h-12 bg-black/50 border-primary/30 focus-visible:ring-primary font-mono text-sm text-white placeholder:text-muted-foreground/50"
                  />
                </div>
                <Button type="submit" size="lg" className="h-12 w-32 font-bold" disabled={isLoading || !repoUrl}>
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-white animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-2 h-2 rounded-full bg-white animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-2 h-2 rounded-full bg-white animate-bounce" style={{ animationDelay: "300ms" }} />
                    </span>
                  ) : "LOAD CITY"}
                </Button>
              </div>
            </div>

            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced(v => !v)}
                className="flex items-center gap-2 text-xs font-mono text-muted-foreground hover:text-primary transition-colors"
              >
                {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {showAdvanced ? "Hide" : "Private repo?"} — add GitHub token
              </button>

              <AnimatePresence>
                {showAdvanced && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 p-4 rounded-lg border border-primary/20 bg-black/30 space-y-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-mono text-primary/80 uppercase tracking-widest flex items-center gap-2">
                          <KeyRound size={12} /> GitHub Personal Access Token
                        </label>
                        <div className="relative group">
                          <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" size={16} />
                          <Input
                            type="password"
                            placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                            value={githubToken}
                            onChange={(e) => setGithubToken(e.target.value)}
                            className="pl-9 h-10 bg-black/50 border-primary/20 focus-visible:ring-primary font-mono text-sm text-white placeholder:text-muted-foreground/40"
                          />
                        </div>
                      </div>
                      <div className="text-[11px] font-mono text-muted-foreground/70 space-y-1 leading-relaxed">
                        <p>Your token is sent directly to the server and never stored. Used only for this request.</p>
                        <p>
                          <a
                            href="https://github.com/settings/tokens/new?scopes=repo&description=SoftwareCity"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary/70 hover:text-primary underline flex items-center gap-1 w-fit"
                          >
                            <ExternalLink size={11} /> Generate a token (needs "repo" scope)
                          </a>
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="relative flex items-center py-1">
              <div className="flex-grow border-t border-border/50"></div>
              <span className="flex-shrink-0 mx-4 text-muted-foreground font-mono text-xs uppercase">or</span>
              <div className="flex-grow border-t border-border/50"></div>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full h-12 group hover:bg-primary/5 border-primary/30"
              onClick={() => demoMutation.mutate()}
              disabled={demoMutation.isPending}
            >
              <Play size={16} className="mr-2 text-primary group-hover:text-primary animate-pulse" />
              <span className="text-foreground">Run Demo Simulation</span>
            </Button>

            <div className="relative flex items-center py-1">
              <div className="flex-grow border-t border-border/50"></div>
              <span className="flex-shrink-0 mx-4 text-muted-foreground font-mono text-xs uppercase">or watch local</span>
              <div className="flex-grow border-t border-border/50"></div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-mono text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                <FolderOpen size={14} /> Watch a Local Folder
              </label>
              <div className="flex gap-2">
                <Input
                  placeholder="C:\projects\myapp or /home/user/myapp"
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                  className="flex-1 h-10 bg-black/50 border-border/30 font-mono text-xs text-white placeholder:text-muted-foreground/40"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-10 px-4 border-border/30"
                  onClick={handleWatchLocal}
                  disabled={!localPath || watchStatus === "watching"}
                >
                  <Eye size={14} className="mr-2" />
                  {watchStatus === "watching" ? "Watching" : "Watch"}
                </Button>
              </div>
              <p className="text-[11px] font-mono text-muted-foreground/50">
                Live re-analysis on file changes via WebSocket. Only works when the server has filesystem access to this path.
              </p>
            </div>
          </form>
        </div>

        <div className="mt-8 flex justify-center gap-8 text-xs font-mono text-muted-foreground/60">
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-success animate-pulse" /> Live Metrics</div>
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-warning animate-pulse" /> Auto-Scaling</div>
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-primary animate-pulse" /> AI Agents</div>
        </div>
      </motion.div>
    </div>
  );
}

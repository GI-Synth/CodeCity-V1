import { useState } from "react";
import { useLocation } from "wouter";
import { useLoadRepo, useLoadDemoRepo } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Github, Play, Terminal, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";

export function Landing() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [repoUrl, setRepoUrl] = useState("");

  const loadMutation = useLoadRepo({
    mutation: {
      onSuccess: () => setLocation("/city"),
      onError: (err) => toast({ title: "Error", description: err.message || "Failed to load repo", variant: "destructive" })
    }
  });

  const demoMutation = useLoadDemoRepo({
    mutation: {
      onSuccess: () => setLocation("/city"),
      onError: () => toast({ title: "Error", description: "Failed to load demo", variant: "destructive" })
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl) return;
    loadMutation.mutate({ data: { repoUrl } });
  };

  return (
    <div className="min-h-screen w-full bg-background relative flex items-center justify-center overflow-hidden">
      {/* Background Image & Overlay */}
      <div className="absolute inset-0 z-0">
        <img 
          src={`${import.meta.env.BASE_URL}images/hero-city.png`} 
          alt="Cyberpunk City" 
          className="w-full h-full object-cover opacity-30 object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/60 to-background" />
        {/* Animated grid overlay */}
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
            <img src={`${import.meta.env.BASE_URL}images/logo.png`} alt="Logo" className="w-full h-full relative z-10" />
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
          <form onSubmit={handleSubmit} className="space-y-6">
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
                <Button 
                  type="submit" 
                  size="lg" 
                  className="h-12 w-32 font-bold"
                  disabled={loadMutation.isPending || !repoUrl}
                >
                  {loadMutation.isPending ? "SCANNING..." : "LOAD CITY"}
                </Button>
              </div>
            </div>

            <div className="relative flex items-center py-2">
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
          </form>
        </div>

        <div className="mt-8 flex justify-center gap-8 text-xs font-mono text-muted-foreground/60">
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-success animate-pulse"/> Live Metrics</div>
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-warning animate-pulse"/> Auto-Scaling</div>
          <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-primary animate-pulse"/> AI Agents</div>
        </div>
      </motion.div>
    </div>
  );
}

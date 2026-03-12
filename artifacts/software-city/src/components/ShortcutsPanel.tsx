import { motion, AnimatePresence } from "framer-motion";
import { X, Keyboard } from "lucide-react";

interface Shortcut {
  key: string;
  description: string;
  category: string;
}

const SHORTCUTS: Shortcut[] = [
  { key: "F3", description: "Toggle debug metrics HUD", category: "View" },
  { key: "?", description: "Toggle this shortcuts panel", category: "View" },
  { key: "T", description: "Start guided tour", category: "View" },
  { key: "Esc", description: "Close inspector / close panels", category: "Navigation" },
  { key: "K", description: "Go to Knowledge Base", category: "Navigation" },
  { key: "A", description: "Go to Agents Dashboard", category: "Navigation" },
  { key: "G", description: "Go to City View", category: "Navigation" },
  { key: "L", description: "Go to Leaderboard", category: "Navigation" },
  { key: "Scroll", description: "Zoom in / out on city map", category: "City Map" },
  { key: "Drag", description: "Pan the city map", category: "City Map" },
];

const categories = [...new Set(SHORTCUTS.map(s => s.category))];

interface ShortcutsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsPanel({ open, onClose }: ShortcutsPanelProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[8000] bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.18 }}
            className="fixed z-[8001] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] glass-panel border border-primary/40 rounded-2xl shadow-2xl p-6"
          >
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Keyboard size={18} className="text-primary" />
                <h2 className="font-mono font-bold text-lg text-primary">Keyboard Shortcuts</h2>
              </div>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-5">
              {categories.map(cat => (
                <div key={cat}>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2 border-b border-border/30 pb-1">
                    {cat}
                  </div>
                  <div className="space-y-2">
                    {SHORTCUTS.filter(s => s.category === cat).map(s => (
                      <div key={s.key} className="flex items-center justify-between">
                        <span className="text-sm font-mono text-muted-foreground">{s.description}</span>
                        <kbd className="px-2 py-0.5 rounded bg-black/60 border border-border/60 text-xs font-mono text-primary min-w-[36px] text-center">
                          {s.key}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 pt-4 border-t border-border/30 text-center text-[11px] font-mono text-muted-foreground/50">
              Press <kbd className="px-1 rounded bg-black/40 border border-border/40 text-primary text-[11px]">?</kbd> or <kbd className="px-1 rounded bg-black/40 border border-border/40 text-primary text-[11px]">Esc</kbd> to close
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

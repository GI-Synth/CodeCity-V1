import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { Landing } from "@/pages/Landing";
import { CityView } from "@/pages/CityView";
import { Agents } from "@/pages/Agents";
import { KnowledgeBase } from "@/pages/KnowledgeBase";
import { SharedCity } from "@/pages/SharedCity";
import { Leaderboard } from "@/pages/Leaderboard";
import { Metrics } from "@/pages/Metrics";
import { Settings } from "@/pages/Settings";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/city" component={CityView} />
      <Route path="/agents" component={Agents} />
      <Route path="/knowledge" component={KnowledgeBase} />
      <Route path="/leaderboard" component={Leaderboard} />
      <Route path="/metrics" component={Metrics} />
      <Route path="/settings" component={Settings} />
      <Route path="/shared/:token" component={SharedCity} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

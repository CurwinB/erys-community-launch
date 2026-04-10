import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import Navbar from "@/components/Navbar";
import Index from "./pages/Index";
import LaunchPage from "./pages/LaunchPage";
import SchedulePage from "./pages/SchedulePage";
import DashboardPage from "./pages/DashboardPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const solanaConnectors = toSolanaWalletConnectors();

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID || "placeholder";

const App = () => (
  <PrivyProvider
    appId={PRIVY_APP_ID}
    config={{
      appearance: {
        theme: "dark",
        accentColor: "#00D4FF",
        walletChainType: "solana-only",
      },
      externalWallets: {
        solana: { connectors: solanaConnectors },
      },
    }}
  >
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Navbar />
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/launch/:id" element={<LaunchPage />} />
            <Route path="/schedule" element={<SchedulePage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </PrivyProvider>
);

export default App;

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DynamicContextProvider } from "@dynamic-labs/sdk-react-core";
import { SolanaWalletConnectors } from "@dynamic-labs/solana";
import Navbar from "@/components/Navbar";
import Index from "./pages/Index";
import LaunchPage from "./pages/LaunchPage";
import SchedulePage from "./pages/SchedulePage";
import DashboardPage from "./pages/DashboardPage";
import AdminPage from "./pages/AdminPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <HelmetProvider>
    <DynamicContextProvider
    settings={{
      environmentId: import.meta.env.VITE_DYNAMIC_ENVIRONMENT_ID || "placeholder",
      walletConnectors: [SolanaWalletConnectors],
      embeddedWallets: {
        createOnLogin: 'users-without-wallets',
      },
    } as any}
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
            <Route path="/admin" element={<AdminPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
    </DynamicContextProvider>
  </HelmetProvider>
);

export default App;

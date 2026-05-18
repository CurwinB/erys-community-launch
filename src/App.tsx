import { Component, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DynamicContextProvider } from "@dynamic-labs/sdk-react-core";
import { SolanaWalletConnectors } from "@dynamic-labs/solana";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Index from "./pages/Index";
import LaunchPage from "./pages/LaunchPage";
import SchedulePage from "./pages/SchedulePage";
import DashboardPage from "./pages/DashboardPage";
import AdminPage from "./pages/AdminPage";
import SponsoredPage from "./pages/SponsoredPage";
import TermsPage from "./pages/TermsPage";
import PrivacyPage from "./pages/PrivacyPage";
import RiskPage from "./pages/RiskPage";
import ContactPage from "./pages/ContactPage";
import HowItWorksPage from "./pages/HowItWorksPage";
import AntiSniperPage from "./pages/AntiSniperPage";
import FairLaunchPage from "./pages/FairLaunchPage";
import FaqPage from "./pages/FaqPage";
import NotFound from "./pages/NotFound";
import { useLocation } from "react-router-dom";

const ConditionalNavbar = () => {
  const location = useLocation();
  if (location.pathname.startsWith("/admin")) return null;
  if (location.pathname.startsWith("/sponsored")) return null;
  return <Navbar />;
};

const ConditionalFooter = () => {
  const location = useLocation();
  if (location.pathname.startsWith("/admin")) return null;
  if (location.pathname.startsWith("/sponsored")) return null;
  return <Footer />;
};

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: unknown) {
    console.error("[ErrorBoundary]", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
          <h2 className="mb-2 text-xl font-bold text-foreground">Something went wrong</h2>
          <p className="mb-6 max-w-md text-center text-sm text-muted-foreground">
            {this.state.error.message || "An unexpected error occurred."}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-sm border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-muted"
          >
            Reload
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

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
          <ConditionalNavbar />
          <ErrorBoundary>
            <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/launch/:id" element={<LaunchPage />} />
            <Route path="/schedule" element={<SchedulePage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/sponsored/:linkToken" element={<SponsoredPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/risk" element={<RiskPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/how-it-works" element={<HowItWorksPage />} />
            <Route path="/anti-sniper" element={<AntiSniperPage />} />
            <Route path="/fair-launch" element={<FairLaunchPage />} />
            <Route path="/faq" element={<FaqPage />} />
            <Route path="*" element={<NotFound />} />
            </Routes>
          </ErrorBoundary>
          <ConditionalFooter />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
    </DynamicContextProvider>
  </HelmetProvider>
);

export default App;

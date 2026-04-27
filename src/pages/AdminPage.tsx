import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Seo from "@/components/Seo";
import AdminGate from "@/components/admin/AdminGate";
import AdminNavbar from "@/components/admin/AdminNavbar";
import MetricCards from "@/components/admin/MetricCards";
import LaunchesTab from "@/components/admin/LaunchesTab";
import ContributorsTab from "@/components/admin/ContributorsTab";
import PlatformRevenueTab from "@/components/admin/PlatformRevenueTab";
import RefundsTab from "@/components/admin/RefundsTab";
import RecoveryTab from "@/components/admin/RecoveryTab";
import AccountingTab from "@/components/admin/AccountingTab";
import SponsoredTab from "@/components/admin/SponsoredTab";
import { lamportsToSol } from "@/lib/adminFormat";
import { LAUNCH_PUBLIC_COLUMNS } from "@/lib/constants";
import { useIsAdmin } from "@/hooks/useIsAdmin";

const ACTIVE_STATUSES = new Set(["scheduled", "executing"]);

const AdminPage = () => {
  const { isAdmin } = useIsAdmin();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-dashboard"],
    enabled: isAdmin,
    queryFn: async () => {
      const [launchesRes, contributionsRes, claimsRes] = await Promise.all([
        supabase
          .from("launches")
          .select(LAUNCH_PUBLIC_COLUMNS)
          .order("launch_datetime", { ascending: false })
          .limit(1000),
        supabase
          .from("contributions")
          .select("*")
          .order("contributed_at", { ascending: false })
          .limit(1000),
        supabase
          .from("platform_fee_claims")
          .select("*")
          .order("claimed_at", { ascending: false })
          .limit(1000),
      ]);

      if (launchesRes.error) throw launchesRes.error;
      if (contributionsRes.error) throw contributionsRes.error;
      if (claimsRes.error) throw claimsRes.error;

      return {
        launches: launchesRes.data ?? [],
        contributions: contributionsRes.data ?? [],
        claims: claimsRes.data ?? [],
      };
    },
  });

  if (!isAdmin) {
    return (
      <>
        <Seo title="Admin · erys" description="Admin dashboard" />
        <AdminGate onAuthenticated={() => { /* hook re-renders automatically */ }} />
      </>
    );
  }

  const launches = data?.launches ?? [];
  const contributions = data?.contributions ?? [];
  const claims = data?.claims ?? [];

  const totalLaunches = launches.length;
  const activeLaunches = launches.filter((l) =>
    ACTIVE_STATUSES.has(l.status as string),
  ).length;
  const uniqueContributors = new Set(
    contributions
      .filter((c) => !c.refund_tx_signature)
      .map((c) => c.wallet_address),
  ).size;

  const bagsRevenueSol = lamportsToSol(
    claims.reduce((sum, c) => sum + Number(c.amount_lamports), 0),
  );
  // Pump.fun: Erys takes 100% of creator fees.
  const pumpErysRevenueSol = launches
    .filter((l) => l.platform === "pumpfun")
    .reduce(
      (sum, l) =>
        sum + lamportsToSol(Number(l.pumpfun_fees_claimed_total ?? 0)),
      0,
    );
  const totalRevenueSol = bagsRevenueSol + pumpErysRevenueSol;

  return (
    <div className="min-h-screen bg-background">
      <Seo title="Admin · erys" description="Admin dashboard" />
      <AdminNavbar />
      <div className="container mx-auto px-4 py-6 space-y-6">
        <MetricCards
          totalRevenueSol={totalRevenueSol}
          totalLaunches={totalLaunches}
          activeLaunches={activeLaunches}
          totalContributors={uniqueContributors}
          loading={isLoading}
        />

        <Tabs defaultValue="launches" className="w-full">
          <TabsList className="rounded-none bg-card border border-border h-auto p-0 flex flex-wrap">
            <TabsTrigger
              value="launches"
              className="rounded-none data-[state=active]:bg-background data-[state=active]:text-primary px-4 py-2 font-mono text-xs uppercase tracking-widest"
            >
              Launches
            </TabsTrigger>
            <TabsTrigger
              value="contributors"
              className="rounded-none data-[state=active]:bg-background data-[state=active]:text-primary px-4 py-2 font-mono text-xs uppercase tracking-widest"
            >
              Contributors
            </TabsTrigger>
            <TabsTrigger
              value="revenue"
              className="rounded-none data-[state=active]:bg-background data-[state=active]:text-primary px-4 py-2 font-mono text-xs uppercase tracking-widest"
            >
              Platform Revenue
            </TabsTrigger>
            <TabsTrigger
              value="accounting"
              className="rounded-none data-[state=active]:bg-background data-[state=active]:text-primary px-4 py-2 font-mono text-xs uppercase tracking-widest"
            >
              Accounting
            </TabsTrigger>
            <TabsTrigger
              value="refunds"
              className="rounded-none data-[state=active]:bg-background data-[state=active]:text-primary px-4 py-2 font-mono text-xs uppercase tracking-widest"
            >
              Refunds
            </TabsTrigger>
            <TabsTrigger
              value="recovery"
              className="rounded-none data-[state=active]:bg-background data-[state=active]:text-destructive px-4 py-2 font-mono text-xs uppercase tracking-widest"
            >
              Recovery
            </TabsTrigger>
            <TabsTrigger
              value="sponsored"
              className="rounded-none data-[state=active]:bg-background data-[state=active]:text-primary px-4 py-2 font-mono text-xs uppercase tracking-widest"
            >
              Sponsored
            </TabsTrigger>
          </TabsList>

          <TabsContent value="launches" className="mt-4">
            <LaunchesTab launches={launches} contributions={contributions} />
          </TabsContent>
          <TabsContent value="contributors" className="mt-4">
            <ContributorsTab
              contributions={contributions}
              launches={launches}
            />
          </TabsContent>
          <TabsContent value="revenue" className="mt-4">
            <PlatformRevenueTab bagsClaims={claims} launches={launches} />
          </TabsContent>
          <TabsContent value="accounting" className="mt-4">
            <AccountingTab
              launches={launches as any}
              contributions={contributions as any}
              claims={claims as any}
            />
          </TabsContent>
          <TabsContent value="refunds" className="mt-4">
            <RefundsTab contributions={contributions} launches={launches} />
          </TabsContent>
          <TabsContent value="recovery" className="mt-4">
            <RecoveryTab launches={launches as any} contributions={contributions as any} />
          </TabsContent>
          <TabsContent value="sponsored" className="mt-4">
            <SponsoredTab launches={launches as any} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default AdminPage;
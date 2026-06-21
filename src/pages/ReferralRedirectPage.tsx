import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { storeReferralCode } from "@/hooks/useReferralCapture";
import { toast } from "sonner";
import Seo from "@/components/Seo";

const ReferralRedirectPage = () => {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cleanCode = (code ?? "").toUpperCase().trim();
      if (!cleanCode || !/^[A-Z0-9]{4,32}$/.test(cleanCode)) {
        if (!cancelled) navigate("/", { replace: true });
        return;
      }
      try {
        const { data, error } = await supabase.rpc("resolve_referral_code" as any, {
          p_code: cleanCode,
        } as any);
        const row = Array.isArray(data) ? data[0] : data;
        if (error || !row || row.status !== "active") {
          if (!cancelled) {
            toast.message("Referral link not active", {
              description: "Continuing without a referral.",
            });
            navigate("/", { replace: true });
          }
          return;
        }
        storeReferralCode(cleanCode);
        if (!cancelled) {
          toast.success("Referral applied", {
            description: "Connect a wallet to complete signup.",
          });
          navigate("/", { replace: true });
        }
      } catch {
        if (!cancelled) navigate("/", { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, navigate]);

  return (
    <>
      <Seo title="Referral · erys" description="Applying your referral code." />
      <main className="flex min-h-[60vh] items-center justify-center bg-background">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Applying referral…
        </p>
      </main>
    </>
  );
};

export default ReferralRedirectPage;
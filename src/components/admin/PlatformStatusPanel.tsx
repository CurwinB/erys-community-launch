import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWallet } from "@/hooks/useWallet";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Platform = "bags" | "pumpfun";

interface Status {
  bags_enabled: boolean;
  pumpfun_enabled: boolean;
  bags_updated_at: string | null;
  pumpfun_updated_at: string | null;
}

const formatTime = (iso: string | null) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
};

const PlatformStatusPanel = () => {
  const { publicKey } = useWallet();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [pending, setPending] = useState<{ platform: Platform; enabled: boolean } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-platform-status"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_launch_platform_status");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return row as Status;
    },
    refetchOnWindowFocus: true,
  });

  const mutation = useMutation({
    mutationFn: async (vars: { platform: Platform; enabled: boolean }) => {
      const { data, error } = await supabase.rpc("set_launch_platform_status", {
        p_admin_wallet: publicKey!,
        p_platform: vars.platform,
        p_enabled: vars.enabled,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      toast({
        title: vars.enabled ? "Platform enabled" : "Platform paused",
        description: `${vars.platform === "bags" ? "Bags.fm" : "Pump.fun"} launches are now ${vars.enabled ? "accepting new submissions" : "paused"}.`,
      });
      qc.invalidateQueries({ queryKey: ["admin-platform-status"] });
      qc.invalidateQueries({ queryKey: ["launch-platform-status"] });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to update",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const rows: { platform: Platform; label: string; enabled: boolean; updated: string | null; accent: string }[] = [
    {
      platform: "bags",
      label: "Bags.fm launches",
      enabled: !!data?.bags_enabled,
      updated: data?.bags_updated_at ?? null,
      accent: "#00D4FF",
    },
    {
      platform: "pumpfun",
      label: "Pump.fun launches",
      enabled: !!data?.pumpfun_enabled,
      updated: data?.pumpfun_updated_at ?? null,
      accent: "#00FF88",
    },
  ];

  return (
    <>
      <div className="border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Platform Status
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Pause new launches per platform. Existing launches keep executing normally.
          </p>
        </div>
        <div className="divide-y divide-border">
          {rows.map((row) => (
            <div key={row.platform} className="flex items-center justify-between gap-4 px-4 py-4">
              <div className="flex items-center gap-3">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: row.enabled ? row.accent : "#666" }}
                />
                <div>
                  <div className="text-sm font-medium text-foreground">{row.label}</div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {row.enabled ? "Accepting new launches" : "Paused — maintenance message shown"}
                    {" · "}
                    last changed {formatTime(row.updated)}
                  </div>
                </div>
              </div>
              <Switch
                checked={row.enabled}
                disabled={isLoading || mutation.isPending}
                onCheckedChange={(next) => setPending({ platform: row.platform, enabled: next })}
              />
            </div>
          ))}
        </div>
      </div>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.enabled ? "Re-enable" : "Pause"}{" "}
              {pending?.platform === "bags" ? "Bags.fm" : "Pump.fun"} launches?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.enabled
                ? "Users will be able to schedule new launches on this platform again."
                : "Users will see a maintenance message on the Schedule page and won't be able to start new launches on this platform. Existing launches keep executing."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) mutation.mutate(pending);
                setPending(null);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default PlatformStatusPanel;
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export function makeSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function countUnclaimed(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from("pump_keypair_pool")
    .select("id", { count: "exact", head: true })
    .is("claimed_at", null);
  if (error) throw new Error(`countUnclaimed failed: ${error.message}`);
  return count ?? 0;
}

export async function insertKeypair(
  supabase: SupabaseClient,
  publicKey: string,
  encryptedPrivateKey: string,
): Promise<{ inserted: boolean; reason?: string }> {
  const { error } = await supabase
    .from("pump_keypair_pool")
    .insert({ public_key: publicKey, encrypted_private_key: encryptedPrivateKey });
  if (error) {
    // Unique violation on public_key — extremely unlikely but harmless.
    if ((error as any).code === "23505") return { inserted: false, reason: "duplicate" };
    return { inserted: false, reason: error.message };
  }
  return { inserted: true };
}
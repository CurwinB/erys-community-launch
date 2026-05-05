import { FunctionsHttpError } from "@supabase/supabase-js";

/**
 * Pull the real error message out of a supabase.functions.invoke() error.
 * Supabase returns a generic "Edge Function returned a non-2xx status code"
 * for any 4xx/5xx; the actual JSON body is on err.context.response.
 */
export async function extractEdgeError(err: unknown): Promise<string> {
  try {
    if (err instanceof FunctionsHttpError) {
      const res = err.context as Response | undefined;
      if (res && typeof res.text === "function") {
        const txt = await res.text();
        try {
          const j = JSON.parse(txt);
          if (j?.error) return String(j.error);
          if (j?.message) return String(j.message);
        } catch {
          if (txt) return txt;
        }
      }
    }
    if (err instanceof Error && err.message) return err.message;
  } catch {
    // fall through
  }
  return "Edge function returned a non-2xx status code";
}
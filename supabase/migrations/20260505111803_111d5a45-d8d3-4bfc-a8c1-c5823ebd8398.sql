
-- Switch the view off security_invoker so it can read the locked-down base table
ALTER VIEW public.launches_public SET (security_invoker = false);

-- Drop the overly permissive policy that exposed every column of launches to anon/authenticated
DROP POLICY IF EXISTS "Public can read launches via view" ON public.launches;

-- Ensure the deny policy on direct browser SELECT remains (already exists: "No direct browser access to launches")

-- Make sure anon/authenticated can read the safe view
GRANT SELECT ON public.launches_public TO anon, authenticated;

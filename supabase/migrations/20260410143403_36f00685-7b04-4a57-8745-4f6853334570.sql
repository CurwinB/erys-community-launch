
-- Schedule execute-launch to run every minute
SELECT cron.schedule(
  'execute-launch-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://cifdozolzbztuohtdavx.supabase.co/functions/v1/execute-launch',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpZmRvem9semJ6dHVvaHRkYXZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MDAzODMsImV4cCI6MjA5MTM3NjM4M30.2g-chNVNPqoj5ZQUCAlTniSlKgKPCEqZ7gRK5nLCyCk"}'::jsonb,
    body := concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

-- Schedule claim-partner-fees to run every 6 hours
SELECT cron.schedule(
  'claim-partner-fees-every-6h',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://cifdozolzbztuohtdavx.supabase.co/functions/v1/claim-partner-fees',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpZmRvem9semJ6dHVvaHRkYXZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MDAzODMsImV4cCI6MjA5MTM3NjM4M30.2g-chNVNPqoj5ZQUCAlTniSlKgKPCEqZ7gRK5nLCyCk"}'::jsonb,
    body := concat('{"time": "', now(), '"}')::jsonb
  ) AS request_id;
  $$
);

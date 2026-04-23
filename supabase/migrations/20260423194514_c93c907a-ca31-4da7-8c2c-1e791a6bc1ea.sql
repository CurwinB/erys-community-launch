UPDATE public.launches
SET 
  status = 'scheduled',
  execution_error = null,
  worker_locked_at = null,
  worker_id = null
WHERE id = 'a0d56180-c34a-4588-b4a4-709197996f94';
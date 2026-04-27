UPDATE public.launches
   SET status = 'sponsor_pending_funding',
       sponsor_funding_attempts = 0,
       sponsor_funding_error = null,
       worker_locked_at = null,
       worker_id = null
 WHERE id = '0bac9d01-f5fc-484a-90e3-0d5133368bdd'
   AND status = 'cancelled';
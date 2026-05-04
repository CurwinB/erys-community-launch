UPDATE public.launches
SET token_name = trim(token_name),
    token_symbol = trim(token_symbol)
WHERE token_name <> trim(token_name)
   OR token_symbol <> trim(token_symbol);
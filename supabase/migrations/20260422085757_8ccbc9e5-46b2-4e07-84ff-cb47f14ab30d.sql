INSERT INTO public.admin_wallets (wallet_address, email)
VALUES (lower('BvpGuDSLDafZXSDeokapirQqiPshocaMFHG5N46c9rxV'), 'curwinbreedy@gmail.com')
ON CONFLICT (wallet_address) DO NOTHING;
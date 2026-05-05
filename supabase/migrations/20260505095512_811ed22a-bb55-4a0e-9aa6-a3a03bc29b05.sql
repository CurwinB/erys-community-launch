UPDATE public.launches
SET ipfs_metadata_url =
  'https://ipfs.io/ipfs/' ||
  regexp_replace(ipfs_metadata_url, '^https?://[^/]*pinata[^/]*/ipfs/', '')
WHERE ipfs_metadata_url ILIKE '%pinata.cloud%';

UPDATE public.launches
SET ipfs_metadata_url =
  'https://ipfs.io/ipfs/' || substring(ipfs_metadata_url from 8)
WHERE ipfs_metadata_url ILIKE 'ipfs://%';
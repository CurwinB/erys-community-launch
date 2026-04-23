

# Diagnosis: First Bags Launch Failure

## Failed launch summary

| Field | Value |
|---|---|
| Launch ID | `ccf4b49d-13d4-4f9b-a6bd-a7ba2dc76041` |
| Token | Erys test (`$TEST`) |
| Platform | `bags` |
| Status | `execution_failed` |
| Execution attempts | 1 |
| Launch datetime | 2026-04-23 18:00:00 UTC |
| Created | 2026-04-23 17:11:06 UTC |
| `token_mint_address` | `7MEXD4pRDtjgDXU6pWBahiJ1cumbAT3xY1khaRYYBAGS` (populated) |
| `ipfs_metadata_url` | `https://ipfs.io/ipfs/QmVnWDHV4CfNrboEcNR2FNDhYioakqjUtncqzTq7mCGpSd` (populated) |
| `fee_share_config_key` | **null** (fee-share/config never completed) |
| `worker_id` / `worker_locked_at` | both null (lock cleanly released after failure) |

## The exact error

`execution_error` from the DB:

```
fee-share/config failed: {"success":false,"response":"[
  {
    \"code\": \"custom\",
    \"path\": [\"basisPointsArray\"],
    \"message\": \"The sum of all basis points must equal 10000\"
  }
]"}
```

Bags rejected the `fee-share/config` POST because `basisPointsArray` did not sum to 10000.

## Contributions for this launch

| # | Wallet | Lamports | basis_points | is_fee_claimer |
|---|---|---|---|---|
| 1 | `BvpGuDSLDafZXSDeokapirQqiPshocaMFHG5N46c9rxV` (creator) | 100,000,000 (0.1 SOL) | null | true |
| 2 | `62aKWrHctoH4TUCfmmqoKCbaXXJWYWoLGL5Zc9izubaV` | 100,000,000 (0.1 SOL) | null | true |

- 2 contributions, **0.2 SOL total**
- `basis_points` is null on both — `storeBasisPoints` was never called because we never made it past `fee-share/config`

## Root cause (read-only analysis)

In `executor/src/executeBags.ts`, the basis-points loop has a math bug that triggers exactly when the creator's contribution share is small enough that the `Math.max(750, creatorRaw)` floor is hit. With these two equal 0.1 SOL contributions:

```
PLATFORM_BPS  = 2500
remaining     = 10000 - 2500 = 7500
totalNum      = 200_000_000

# Creator (contrib 1)
creatorRaw    = floor((100_000_000 / 200_000_000) * 7500) = 3750
creatorBps    = max(750, 3750) = 3750
usedBps       = 3750

# Contributor 2
bps           = floor((100_000_000 / 200_000_000) * 7500) = 3750
usedBps       = 3750 + 3750 = 7500

# Adjustment line
basisPointsArray[0] += remaining - usedBps   # += 7500 - 7500 = 0
```

So `basisPointsArray = [3750, 3750]`, `partner = 2500` is sent separately, and Bags expects the `claimersArray` BP sum to equal 10000, **not 7500**. The current code only ever sums to `10000 - PLATFORM_BPS`.

This is consistent with the saved memory `mem://features/fee-share-config`: "BP sum = 10000". The platform/partner cut belongs **inside** the claimers BP total or the remaining math has to scale to a 10000 base — currently it does neither, so any launch where rounding doesn't accidentally backfill the missing 2500 will fail.

The earlier failed launch (`a3eb98bf...`, `Erys Test launch`) failed differently (`Reset from stale executing state by distributor`) — that's a separate stuck-worker issue, not the same bug.

## Why this didn't surface in dev

The bug only manifests when `claimersArray.length > 1` AND total basis points after flooring don't accidentally re-fill the 2500 PLATFORM_BPS gap. With a single contributor, `remaining - usedBps` happened to absorb the leftover into `basisPointsArray[0]`, masking it.

## Notes / oddities to flag

1. The Bags API expects claimer BPs to total 10000 even though `partner` is a separate field — the current code treats `remaining = 10000 - PLATFORM_BPS` as the claimer pool, which is wrong per the API's validation.
2. `execution_attempts = 1` and `< 3`, so this launch is technically eligible to be re-queued by `execute-launch` if its status is flipped back to `scheduled`, but it won't succeed until the BP math is corrected.
3. No worker lock is held — safe to retry / inspect at any time.

## What I did NOT do

No code, schema, or status changes were made. This is a read-only diagnosis as requested.


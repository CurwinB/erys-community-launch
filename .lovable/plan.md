## Self-diagnosis plan for Bags launch failures

Yes — Bags has public surface area we can mine, and we don't need their support to make real progress. Here's what exists and what I'd do with it.

### What's actually available

1. **Public SDK repo** — `github.com/bagsfm/bags-sdk` (active, last commit ~3 weeks ago, v1.3.7 on npm). Source is readable; we can see the exact HTTP calls `createLaunchTransaction` makes.
2. **Public API docs** — `docs.bags.fm` with a full API Reference section, Changelog, and FAQ.
3. **Dev portal** — `dev.bags.fm` (where API keys are managed; may show request logs / quotas).
4. **Changelog** — can correlate the start of our 500s with a Bags-side deploy.
5. **Their Discord / X** — community channels usually surface ongoing incidents faster than email support.

We are NOT blind here. We just haven't read the source yet.

### Diagnosis steps

**1. Pin the exact HTTP call the SDK is making**
- Read `bags-sdk/src` — specifically the launchpad / fee-share-v2 service that backs `sdk.launchpad.createLaunchTransaction(...)`.
- Extract: endpoint URL, method, full request body shape, headers, and how it serializes `feeClaimers` / `partner` / `partnerConfig` / `bagsConfigType`.
- Confirm whether v1.3.7 (what we use) matches the current docs, or whether the API moved and our SDK is stale.

**2. Read the REST reference for create-launch-transaction**
- Pull the API Reference page for the launch-creation endpoint from `docs.bags.fm/api-reference/...`.
- Compare field-by-field against what the SDK actually sends and what our `executeBags.ts` passes in.
- Specifically verify: required vs optional fields, whether `bagsConfigType` is still accepted, whether dual-claimer (creator + partner via `partnerConfig`) is documented.

**3. Check the changelog for a regression window**
- Map Bags changelog entries against the date our 500s started. A backend change to fee-share-v2 indexing or claimer validation would line up.

**4. Reproduce against the raw API (no SDK)**
- Build a tiny standalone script that hits the documented endpoint directly with `curl` / `fetch` using our API key and a real `configKey` from one of our failed launches.
- This isolates: is the 500 from the SDK's preflight (config indexing) or from the launch endpoint itself? Is it our payload or their handler?
- Try variants: with `partner` only, without `partnerConfig`, single-claimer vs dual-claimer. The variant that succeeds tells us exactly which field combination breaks their handler.

**5. Capture full server response on next failure**
- Add temporary verbose logging in `executeBags.ts` around the SDK call: log the request body the SDK constructs (intercept via a fetch wrapper on the `Connection`/SDK level if needed), and log the full response body + headers from the 500. Bags 500s sometimes include a `requestId` or error message in the body that we're currently swallowing.

**6. Version bump test**
- We're on `^1.3.7`. Check npm for any newer versions and read the diff. A patch since 1.3.7 may already fix this.

**7. Community signal**
- Search GitHub issues on `bagsfm/bags-sdk`, plus their Discord/X for "500" / "fee-share" / "dual claimer" reports in the same window. If others are hitting it, it's confirmed Bags-side and we stop debugging our payload.

### Deliverables after the dive

- A side-by-side diff: **SDK request body ↔ docs spec ↔ our inputs**, highlighting any mismatch.
- A reproducible curl command that triggers the 500 with one of our real configKeys.
- A go/no-go on upgrading the SDK.
- Either: a concrete code fix, OR a documented escalation packet (requestId, payload, timestamps, curl repro) to send Bags support that they can't bounce.

### Out of scope for this plan

- No production code changes yet. This is a read + reproduce phase.
- The temporary verbose logging in step 5 is the only code change, and it's behind a guard / removable in one revert.

---

If you approve, I'll execute steps 1–4 and 6–7 immediately (no code edits, just research + a standalone repro script in `/tmp`), then come back with the diff + curl repro before touching `executeBags.ts`.
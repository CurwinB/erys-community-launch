# Global Footer + Policy & Contact Pages

Right now the footer only lives on the homepage and has no legal links. Given Erys handles SOL escrow, token launches on Bags.fm/Pump.fun, and influencer sponsorships, we need clear policies that limit liability and a single contact channel: **info@erys.live**.

## What we'll build

### 1. Global `<Footer />` component
- New `src/components/Footer.tsx`, mounted globally in `App.tsx` (just like `ConditionalNavbar`).
- Hidden on `/admin/*` and `/sponsored/*` (same rule as the navbar) so internal/influencer flows stay clean.
- Replaces the inline footer in `src/pages/Index.tsx`.

Layout (responsive, matches existing dark/cyan aesthetic — bordered, mono accents, no emojis):

```text
+---------------------------------------------------------------+
| erys.                          Platform     Legal     Contact |
| Community launch platform      Schedule     Terms     info@.. |
| for Solana tokens.             Dashboard    Privacy   X / TG  |
|                                How it works Risk              |
+---------------------------------------------------------------+
| (c) 2026 Erys  ·  Launch on Bags.fm or Pump.fun  ·  Not financial advice |
+---------------------------------------------------------------+
```

Columns:
- **Platform**: Schedule a Launch, Dashboard, How it works (anchor `/#how-it-works`).
- **Legal**: Terms of Service, Privacy Policy, Risk Disclosure.
- **Contact**: `info@erys.live` (mailto), Contact page link, optional X/Telegram placeholders we can fill later.

Bottom strip keeps the existing "Every token launched through Erys is a real on-chain Solana token" line plus a "Not financial advice" disclaimer and copyright.

### 2. Policy pages
All static, server-rendered React pages with `<Seo />`, consistent typography (`prose`-like styling using existing tokens), and a "Last updated" date.

- `src/pages/TermsPage.tsx` → `/terms`
- `src/pages/PrivacyPage.tsx` → `/privacy`
- `src/pages/RiskPage.tsx` → `/risk`
- `src/pages/ContactPage.tsx` → `/contact`

Routes added to `App.tsx`. Navbar untouched; access is via the footer.

### 3. Contact page
Simple, no backend form (avoids spam + extra infra). It surfaces:
- Primary email **info@erys.live** as a big `mailto:` button (copy-to-clipboard secondary action).
- Expected response window ("within 2–3 business days").
- What to include for different request types: refund inquiry, sponsored slot issue, security disclosure, press/partnerships.
- Note that admin/legal requests must come from the wallet address tied to the launch (for verification).

### 4. Policy content (drafted in-plan, refined on build)

**Terms of Service** — covers:
- Erys is a non-custodial scheduling/escrow platform; users transact directly with Bags.fm and Pump.fun, which are third-party protocols.
- Eligibility: 18+, not in sanctioned jurisdictions, not a US person where local law restricts token participation.
- No guarantee of token price, liquidity, or launch success. Refund mechanics apply only to failed launches per platform rules.
- User responsibilities: securing their wallet, verifying launch details before contributing, complying with local tax law.
- Prohibited uses: market manipulation, money laundering, impersonation, launching tokens that infringe IP or violate law.
- Sponsored / influencer slots: influencers are independent; Erys does not endorse any token. Time-slot claims are first-come-first-served within capacity.
- Limitation of liability + indemnity + arbitration / governing law placeholders (we'll mark `[Jurisdiction]` for the user to confirm).
- Right to modify terms; continued use = acceptance.

**Privacy Policy** — covers:
- Data we collect: wallet addresses, on-chain transactions, IP/user-agent for abuse prevention, optional email if user contacts us, Dynamic Labs auth metadata.
- Data we do NOT collect: private keys (custodial escrow keys are AES-256-GCM encrypted server-side per existing memory), passwords beyond Dynamic's auth.
- Processors: Supabase (DB + edge functions), Dynamic Labs (wallet auth), Solana RPC providers, Bags.fm / Pump.fun / PumpPortal (launch execution).
- Cookies / local storage: session auth only.
- User rights: access, deletion, correction — request via info@erys.live.
- Retention: launch records kept indefinitely for on-chain auditability; contact emails purged after resolution + 12 months.

**Risk Disclosure** — covers:
- Crypto tokens are highly volatile and may go to zero.
- Smart-contract / protocol risk on Bags.fm and Pump.fun.
- Solana network risk (downtime, congestion, failed transactions).
- Custodial escrow risk: although keys are encrypted, no system is perfectly secure.
- Sponsored / influencer launches: influencers may have undisclosed positions; nothing on Erys is investment advice.
- Refund timing depends on platform conditions and on-chain finality.

### 5. SEO + sitemap
- Each new page gets a unique title + description via `<Seo />`.
- Add `/terms`, `/privacy`, `/risk`, `/contact` to `public/sitemap.xml`.
- `robots.txt` already allows them.

## Files to add
- `src/components/Footer.tsx`
- `src/pages/TermsPage.tsx`
- `src/pages/PrivacyPage.tsx`
- `src/pages/RiskPage.tsx`
- `src/pages/ContactPage.tsx`

## Files to edit
- `src/App.tsx` — register 4 new routes; mount `<Footer />` conditionally (hidden on `/admin` and `/sponsored`).
- `src/pages/Index.tsx` — remove the inline `<footer>` block (now global).
- `public/sitemap.xml` — add the 4 new URLs.

## Open questions (we can default these unless you object)
- Governing law / arbitration jurisdiction → default placeholder `[Jurisdiction TBD]` for you to fill before publishing.
- Social links in the footer (X, Telegram, Discord) → leave hidden until you provide handles.
- Cookie banner → not needed since we only use functional auth storage; if you later add analytics we'll revisit.

## Disclaimer
Drafted policies are a strong starting baseline tailored to Erys's flows but are **not a substitute for legal review**. Before going live we recommend a lawyer in your operating jurisdiction signs off, especially on the Terms and Risk Disclosure.

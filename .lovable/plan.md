

# Make "Connect Wallet to Contribute" trigger login

## Change

On `src/pages/LaunchPage.tsx`, when the user is not connected, the contribute button should:

- Display the label **"Login to Contribute"** instead of "Connect Wallet to Contribute"
- Be **enabled** (not disabled) even when no wallet is connected
- On click, open the Dynamic auth/login modal (sign up + connect wallet flow) instead of doing nothing

## Implementation

In `src/pages/LaunchPage.tsx`:

1. Import `useDynamicContext` from `@dynamic-labs/sdk-react-core` and pull `setShowAuthFlow` from it.
2. Update the Contribute button:
   - Disabled state becomes: `!canContribute || isContributing || (connected && !solAmount)` style logic — specifically, when not connected the button is **enabled** so the user can click it to log in. Keep it disabled only when contributions are closed or a contribute call is in flight.
   - `onClick` handler: if `!connected`, call `setShowAuthFlow(true)` and return early. Otherwise call the existing `handleContribute()`.
   - Label logic:
     - Contributions closed → "Contributions Closed"
     - Not connected → **"Login to Contribute"**
     - Sending → "Sending..."
     - Default → "Contribute SOL"
   - Icon: keep `Wallet` icon for the login state (matches the visual in the screenshot).

3. Leave the SOL input disabled when `!canContribute` (unchanged). The amount field stays usable once the user logs in, since `connected` flips to true and the page re-renders.

## Out of scope

- No changes to `Navbar`, `DashboardPage`, `SchedulePage`, or `AdminGate`. Only the launch page contribute CTA is updated, per the request.
- No styling or layout changes to the card.

## Files edited

- `src/pages/LaunchPage.tsx`


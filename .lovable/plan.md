

# Add Share Button to Launch Page and Launch Cards

## What to build

Add a share section to the launch page and a share button to launch cards, allowing anyone (regardless of wallet connection or creator status) to copy the launch link or share it on Twitter.

## Implementation

### 1. LaunchPage.tsx changes

**Imports**: Add `Share2, Copy, Check` from `lucide-react` to the existing import.

**State**: Add `copied` state with `useState(false)`.

**Constants** (after existing platform variables):
- `shareUrl`: Full URL to the launch page using `window.location.origin`
- `platformLabel`: "Pump.fun" or "Bags.fm" based on launch platform
- `tweetText`: Pre-composed tweet with token name, symbol, platform mention, and share URL

**Functions**:
- `handleCopy()`: Writes shareUrl to clipboard, sets copied state for 2 seconds

**UI**: Insert a share bar between `LaunchHeader` and the main grid container:
- Full-width card with border and bg-card styling
- Left side: Share icon + "Share" label
- Center: Truncated share URL
- Right side: Copy button (icon changes to checkmark when copied) and Tweet button (with X logo)

### 2. LaunchCard.tsx changes

**Imports**: Add `Copy, Check` from `lucide-react`.

**State**: Add local `copied` state.

**Functions**:
- `handleCopy(e)`: Stops propagation (prevents card navigation), copies share URL, shows brief copied state

**UI**: Add a small share icon button at the bottom right of the card, next to the existing "Participate/View Details" button.

## Files to edit

- `src/pages/LaunchPage.tsx`
- `src/components/LaunchCard.tsx`

No backend changes. No schema changes. No auth changes.


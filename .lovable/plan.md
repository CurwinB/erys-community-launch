

# Add ATA Creation Warning to Token Send Form

## Problem
When sending tokens to a recipient without an existing ATA, the sender pays ~0.00204 SOL for ATA creation. The user sees no warning about this extra cost.

## What changes

### Edit: `src/components/WalletDropdown.tsx`

**1. Add state for ATA check** — new state variable:
```typescript
const [recipientNeedsAta, setRecipientNeedsAta] = useState(false);
```

**2. Add ATA check effect** — when `sendMode === "token"` and `sendTo` is a valid 32-44 char base58 address, check if the recipient's ATA exists:
```typescript
useEffect(() => {
  if (sendMode !== "token" || !selectedToken || !sendTo || sendTo.length < 32) {
    setRecipientNeedsAta(false);
    return;
  }
  let cancelled = false;
  (async () => {
    try {
      const mintPubkey = new PublicKey(selectedToken.mint);
      const toPubkey = new PublicKey(sendTo);
      const toAta = await getAssociatedTokenAddress(mintPubkey, toPubkey);
      const info = await connection.getAccountInfo(toAta);
      if (!cancelled) setRecipientNeedsAta(!info);
    } catch {
      if (!cancelled) setRecipientNeedsAta(false);
    }
  })();
  return () => { cancelled = true; };
}, [sendMode, sendTo, selectedToken]);
```

**3. Add warning in send form UI** — between the amount input and the send button, show a yellow warning when `recipientNeedsAta` is true:
```
⚠ Recipient has no token account. ATA creation will cost ~0.00204 SOL.
```

**4. Reset state** — clear `recipientNeedsAta` when send mode is closed or send completes (already covered by the effect dependency cleanup).

One new state variable, one effect, one conditional warning line. No other changes needed — the other three concerns are already correctly implemented.


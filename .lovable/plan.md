

# Add 500ms Debounce to ATA Check Effect

## Edit: `src/components/WalletDropdown.tsx`

Replace the existing ATA check `useEffect` (lines ~208-228) with a debounced version using `setTimeout`. The check will only fire after the user stops typing for 500ms instead of on every keystroke.

```typescript
useEffect(() => {
  if (sendMode !== "token" || !selectedToken || !sendTo || sendTo.length < 32) {
    setRecipientNeedsAta(false);
    return;
  }

  const timer = setTimeout(async () => {
    try {
      const mintPubkey = new PublicKey(selectedToken.mint);
      const toPubkey = new PublicKey(sendTo);
      const toAta = await getAssociatedTokenAddress(mintPubkey, toPubkey);
      const info = await connection.getAccountInfo(toAta);
      setRecipientNeedsAta(!info);
    } catch {
      setRecipientNeedsAta(false);
    }
  }, 500);

  return () => clearTimeout(timer);
}, [sendMode, sendTo, selectedToken]);
```

Single effect replacement. No other changes.


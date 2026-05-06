## Fix: grinder accepts any case variation of `pump`

### Problem
`keypair-grinder/src/worker.ts` line 30 checks:
```
pub.toLowerCase().endsWith(SUFFIX)
```
This accepts `PUMP`, `PumP`, `puMP`, etc. Pump.fun tokens end with literal lowercase `pump` in the base58 string.

### Change
```text
keypair-grinder/src/worker.ts  line 30
  FROM: if (pub.toLowerCase().endsWith(SUFFIX)) {
  TO:   if (pub.endsWith(SUFFIX)) {
```

`SUFFIX` is already lowercased to `"pump"` on line 4, so the check becomes a strict case-sensitive match for `"pump"`.

No other files are touched.
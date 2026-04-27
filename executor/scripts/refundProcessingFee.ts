/**
 * One-off recovery script.
 *
 * Sends a SOL refund from the platform/Bags treasury wallet
 * (ERYS_PLATFORM_PRIVATE_KEY, which is the same keypair as
 * BAGS_PARTNER_WALLET) to a single recipient.
 *
 * Use case: a launch failed AFTER the hidden processing fee was charged
 * and contributors were partially refunded by `refundFailedLaunch`. The
 * platform pocketed the 0.06 SOL fee for a launch that never happened, so
 * we make the affected contributor whole out of treasury.
 *
 * USAGE (run from inside the executor working directory with the same
 * .env the Railway worker uses):
 *
 *   cd executor
 *   npm install                                # if not already
 *   npx ts-node scripts/refundProcessingFee.ts \
 *     --to <recipient-pubkey> \
 *     --lamports <int>
 *
 * Defaults are wired to the 643a4fe0 incident (April 27, 2026):
 *   recipient: BvpGuDSLDafZXSDeokapirQqiPshocaMFHG5N46c9rxV
 *   amount:    60,010,000 lamports (0.06001 SOL — fee + 2 tx fees)
 */

import * as dotenv from "dotenv";
dotenv.config();

import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;
const PLATFORM_SK = process.env.ERYS_PLATFORM_PRIVATE_KEY!;
const TREASURY = process.env.BAGS_PARTNER_WALLET!;

function parseArgs(): { to: string; lamports: number } {
  const args = process.argv.slice(2);
  let to = "BvpGuDSLDafZXSDeokapirQqiPshocaMFHG5N46c9rxV";
  let lamports = 60_010_000; // 0.06 SOL fee + ~2 tx fees
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--to") to = args[++i];
    else if (args[i] === "--lamports") lamports = parseInt(args[++i], 10);
  }
  return { to, lamports };
}

async function main() {
  if (!SOLANA_RPC_URL || !PLATFORM_SK || !TREASURY) {
    throw new Error(
      "Missing env: SOLANA_RPC_URL, ERYS_PLATFORM_PRIVATE_KEY, BAGS_PARTNER_WALLET",
    );
  }

  const { to, lamports } = parseArgs();
  const platformKp = Keypair.fromSecretKey(bs58.decode(PLATFORM_SK));

  console.log("Treasury keypair pubkey:", platformKp.publicKey.toBase58());
  console.log("BAGS_PARTNER_WALLET env:", TREASURY);
  if (platformKp.publicKey.toBase58() !== TREASURY) {
    throw new Error(
      "ERYS_PLATFORM_PRIVATE_KEY does not derive to BAGS_PARTNER_WALLET. Aborting.",
    );
  }

  const conn = new Connection(SOLANA_RPC_URL, "confirmed");
  const balBefore = await conn.getBalance(platformKp.publicKey);
  console.log(
    "Treasury balance before:",
    balBefore / LAMPORTS_PER_SOL,
    "SOL",
  );
  console.log("Sending", lamports / LAMPORTS_PER_SOL, "SOL →", to);

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash(
    "confirmed",
  );
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: platformKp.publicKey,
      toPubkey: new PublicKey(to),
      lamports,
    }),
  );
  tx.feePayer = platformKp.publicKey;
  tx.recentBlockhash = blockhash;
  tx.sign(platformKp);

  const sig = await conn.sendRawTransaction(tx.serialize(), {
    preflightCommitment: "confirmed",
  });
  console.log("Sent:", sig);
  await conn.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  console.log("Confirmed: https://solscan.io/tx/" + sig);

  const balAfter = await conn.getBalance(platformKp.publicKey);
  console.log("Treasury balance after:", balAfter / LAMPORTS_PER_SOL, "SOL");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { isSolanaWallet } from "@dynamic-labs/solana";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { useWallet } from "@/hooks/useWallet";
import { supabase } from "@/integrations/supabase/client";
import { Copy, Send, ChevronDown, Loader2, X, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface ErysToken {
  mint: string;
  name: string;
  symbol: string;
  image_url: string | null;
  balance: bigint;
  decimals: number;
  launch_id: string;
}

const ALCHEMY_RPC = import.meta.env.VITE_SOLANA_RPC_URL;
const connection = new Connection(ALCHEMY_RPC, "confirmed");

const WalletDropdown = () => {
  const { connected, publicKey, wallet } = useWallet();
  const { handleLogOut, setShowDynamicUserProfile } = useDynamicContext();

  const [open, setOpen] = useState(false);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [erysTokens, setErysTokens] = useState<ErysToken[]>([]);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [sendMode, setSendMode] = useState<"sol" | "token" | null>(null);
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [selectedToken, setSelectedToken] = useState<ErysToken | null>(null);
  const [sending, setSending] = useState(false);
  const [recipientNeedsAta, setRecipientNeedsAta] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadBalances = async () => {
    if (!publicKey) return;
    setLoadingBalances(true);

    try {
      const walletPubkey = new PublicKey(publicKey);
      console.log("Fetching SOL balance for:", publicKey);
      console.log("Using RPC:", ALCHEMY_RPC?.split("/v2/")[0] + "/v2/***");
      const lamports = await connection.getBalance(walletPubkey, "confirmed");
      console.log("SOL balance in lamports:", lamports);
      setSolBalance(lamports / LAMPORTS_PER_SOL);

      const { data: contributions } = await supabase
        .from("contributions")
        .select(
          "launch_id, launches(token_mint_address, token_name, token_symbol, image_url)"
        )
        .eq("wallet_address", publicKey)
        .eq("tokens_distributed", true);

      const { data: createdLaunches } = await supabase
        .from("launches")
        .select("id, token_mint_address, token_name, token_symbol, image_url")
        .eq("created_by_wallet", publicKey)
        .eq("status", "launched");

      const tokenMap = new Map<string, ErysToken>();

      const addToken = (
        mint: string,
        name: string,
        symbol: string,
        image: string | null,
        launchId: string
      ) => {
        if (!tokenMap.has(mint)) {
          tokenMap.set(mint, {
            mint,
            name,
            symbol,
            image_url: image,
            balance: 0n,
            decimals: 6,
            launch_id: launchId,
          });
        }
      };

      contributions?.forEach((c: any) => {
        const l = c.launches;
        if (l?.token_mint_address) {
          addToken(
            l.token_mint_address,
            l.token_name,
            l.token_symbol,
            l.image_url,
            c.launch_id
          );
        }
      });

      createdLaunches?.forEach((l: any) => {
        if (l.token_mint_address) {
          addToken(
            l.token_mint_address,
            l.token_name,
            l.token_symbol,
            l.image_url,
            l.id
          );
        }
      });

      const tokens = Array.from(tokenMap.values());

      for (const token of tokens) {
        try {
          const mintPubkey = new PublicKey(token.mint);
          const walletPubkey = new PublicKey(publicKey);
          const ata = await getAssociatedTokenAddress(mintPubkey, walletPubkey);
          const ataInfo = await connection.getAccountInfo(ata);

          if (ataInfo) {
            const parsed = await connection.getParsedAccountInfo(ata);
            const data = (parsed.value?.data as any)?.parsed?.info?.tokenAmount;
            if (data) {
              token.balance = BigInt(data.amount);
              token.decimals = data.decimals;
            }
          }
        } catch {
          // Token not held
        }
      }

      setErysTokens(tokens.filter((t) => t.balance > 0n));
    } catch (err: any) {
      console.error("Error loading balances:", err);
    } finally {
      setLoadingBalances(false);
    }
  };

  const handleSendSol = async () => {
    if (!wallet || !isSolanaWallet(wallet) || !publicKey) {
      console.error("No wallet connected");
      return;
    }
    if (!sendTo || !sendAmount) return;

    setSending(true);
    try {
      console.log("=== SEND SOL START ===");
      console.log("From:", publicKey);
      console.log("To:", sendTo);
      console.log("Amount SOL:", sendAmount);

      const lamports = Math.floor(parseFloat(sendAmount) * LAMPORTS_PER_SOL);
      console.log("Lamports:", lamports);

      let toPubkey: PublicKey;
      try {
        toPubkey = new PublicKey(sendTo);
      } catch {
        toast.error("Invalid address", { description: "Recipient address is not a valid Solana address" });
        return;
      }

      console.log("Fetching blockhash from Alchemy...");
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      console.log("Blockhash:", blockhash);
      console.log("Last valid block height:", lastValidBlockHeight);

      const tx = new Transaction();
      tx.add(
        SystemProgram.transfer({
          fromPubkey: new PublicKey(publicKey),
          toPubkey,
          lamports,
        })
      );
      tx.feePayer = new PublicKey(publicKey);
      tx.recentBlockhash = blockhash;

      console.log("Transaction built. Requesting signature from Dynamic...");
      const signer = await wallet.getSigner();
      const txSignature = await signer.signAndSendTransaction(tx as any);
      const sig = typeof txSignature === "string"
        ? txSignature
        : (txSignature as any)?.signature || (txSignature as any)?.hash || JSON.stringify(txSignature);
      console.log("Transaction signature:", sig);
      console.log("Solscan:", `https://solscan.io/tx/${sig}`);
      console.log("=== SEND SOL END ===");

      toast.success("SOL Sent", {
        description: (
          <a
            href={`https://solscan.io/tx/${sig}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-primary"
          >
            View on Solscan
          </a>
        ),
      });
      setSendMode(null);
      setSendTo("");
      setSendAmount("");
      loadBalances();
    } catch (err: any) {
      console.error("=== SEND SOL FAILED ===");
      console.error("Error:", err.message);
      console.error("Full error:", err);
      toast.error("Send Failed", { description: err.message });
    } finally {
      setSending(false);
    }
  };

  const handleSendToken = async () => {
    if (!wallet || !isSolanaWallet(wallet) || !publicKey || !selectedToken) {
      console.error("No wallet or token selected");
      return;
    }
    if (!sendTo || !sendAmount) return;

    setSending(true);
    try {
      console.log("=== SEND TOKEN START ===");
      console.log("Token:", selectedToken.symbol, selectedToken.mint);
      console.log("From:", publicKey);
      console.log("To:", sendTo);
      console.log("Amount:", sendAmount);

      let toPubkey: PublicKey;
      try {
        toPubkey = new PublicKey(sendTo);
      } catch {
        toast.error("Invalid address", { description: "Recipient address is not a valid Solana address" });
        return;
      }

      const mintPubkey = new PublicKey(selectedToken.mint);
      const fromPubkey = new PublicKey(publicKey);

      const fromAta = await getAssociatedTokenAddress(mintPubkey, fromPubkey);
      const toAta = await getAssociatedTokenAddress(mintPubkey, toPubkey);
      console.log("From ATA:", fromAta.toBase58());
      console.log("To ATA:", toAta.toBase58());

      const toAtaInfo = await connection.getAccountInfo(toAta);
      console.log("Recipient ATA exists:", !!toAtaInfo);

      const tx = new Transaction();

      if (!toAtaInfo) {
        console.log("Creating ATA for recipient. Cost: ~0.00204 SOL from sender");
        tx.add(
          createAssociatedTokenAccountInstruction(
            fromPubkey,
            toAta,
            toPubkey,
            mintPubkey
          )
        );
      }

      const decimals = selectedToken.decimals || 6;
      const amount = BigInt(Math.floor(parseFloat(sendAmount) * Math.pow(10, decimals)));
      console.log("Token amount (raw):", amount.toString());
      console.log("Token decimals:", decimals);

      tx.add(
        createTransferInstruction(
          fromAta,
          toAta,
          fromPubkey,
          Number(amount),
          [],
          TOKEN_PROGRAM_ID
        )
      );

      console.log("Fetching blockhash from Alchemy...");
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      console.log("Blockhash:", blockhash);
      console.log("Last valid block height:", lastValidBlockHeight);

      tx.feePayer = fromPubkey;
      tx.recentBlockhash = blockhash;

      console.log("Transaction built. Requesting signature from Dynamic...");
      const signer = await wallet.getSigner();
      const txSignature = await signer.signAndSendTransaction(tx as any);
      const sig = typeof txSignature === "string"
        ? txSignature
        : (txSignature as any)?.signature || (txSignature as any)?.hash || JSON.stringify(txSignature);
      console.log("Transaction signature:", sig);
      console.log("Solscan:", `https://solscan.io/tx/${sig}`);
      console.log("=== SEND TOKEN END ===");

      toast.success(`${selectedToken.symbol} Sent`, {
        description: (
          <a
            href={`https://solscan.io/tx/${sig}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-primary"
          >
            View on Solscan
          </a>
        ),
      });
      setSendMode(null);
      setSendTo("");
      setSendAmount("");
      setSelectedToken(null);
      loadBalances();
    } catch (err: any) {
      console.error("=== SEND TOKEN FAILED ===");
      console.error("Error:", err.message);
      console.error("Full error:", err);
      toast.error("Send Failed", { description: err.message });
    } finally {
      setSending(false);
    }
  };

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setSendMode(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Load balances when opened
  useEffect(() => {
    if (open && publicKey) loadBalances();
  }, [open, publicKey]);

  // Check if recipient needs ATA creation
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

  if (!connected || !publicKey) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-sm border border-border bg-card px-3 py-2 text-sm font-mono text-foreground hover:border-primary/50 transition-colors"
      >
        <div className="h-2 w-2 rounded-full bg-primary" />
        {publicKey.slice(0, 4)}...{publicKey.slice(-4)}
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-md border border-border bg-card shadow-lg z-50">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border p-3">
            <div>
              <p className="text-xs text-muted-foreground">Wallet</p>
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-foreground">
                  {publicKey.slice(0, 6)}...{publicKey.slice(-6)}
                </span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(publicKey);
                    toast.success("Copied");
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {loadingBalances ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {/* SOL balance */}
              <div className="border-b border-border p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img
                      src="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png"
                      className="h-8 w-8 rounded-full object-cover"
                      alt="SOL"
                    />
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Solana
                      </p>
                      <p className="text-xs text-muted-foreground">SOL</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-mono text-foreground">
                      {solBalance !== null ? solBalance.toFixed(4) : "—"} SOL
                    </p>
                    <button
                      onClick={() => {
                        setSendMode("sol");
                        setSelectedToken(null);
                      }}
                      className="flex items-center gap-1 text-xs text-primary hover:underline mt-0.5"
                    >
                      <Send className="h-3 w-3" /> Send
                    </button>
                  </div>
                </div>
              </div>

              {/* Erys tokens */}
              {erysTokens.length > 0 && (
                <div className="border-b border-border p-3">
                  <p className="text-xs text-muted-foreground mb-2">
                    Erys Tokens
                  </p>
                  {erysTokens.map((token) => (
                    <div
                      key={token.mint}
                      className="flex items-center justify-between py-2"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted overflow-hidden">
                          {token.image_url ? (
                            <img
                              src={token.image_url}
                              alt={token.symbol}
                              className="h-8 w-8 rounded-full object-cover"
                            />
                          ) : (
                            <span className="text-xs font-bold text-foreground">
                              {token.symbol.charAt(0)}
                            </span>
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {token.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            ${token.symbol}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-mono text-foreground">
                          {(
                            Number(token.balance) /
                            Math.pow(10, token.decimals)
                          ).toLocaleString()}
                        </p>
                        <button
                          onClick={() => {
                            setSendMode("token");
                            setSelectedToken(token);
                          }}
                          className="flex items-center gap-1 text-xs text-primary hover:underline mt-0.5"
                        >
                          <Send className="h-3 w-3" /> Send
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {erysTokens.length === 0 && !loadingBalances && (
                <div className="p-3 text-center text-xs text-muted-foreground">
                  No Erys tokens yet. Participate in a launch to earn tokens.
                </div>
              )}

              {/* Send form */}
              {sendMode && (
                <div className="border-b border-border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-foreground">
                      Send{" "}
                      {sendMode === "sol" ? "SOL" : selectedToken?.symbol}
                    </p>
                    <button
                      onClick={() => {
                        setSendMode(null);
                        setSendTo("");
                        setSendAmount("");
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <Input
                    placeholder="Recipient address"
                    value={sendTo}
                    onChange={(e) => setSendTo(e.target.value)}
                    className="font-mono text-xs"
                  />
                  <Input
                    placeholder="Amount"
                    type="number"
                    value={sendAmount}
                    onChange={(e) => setSendAmount(e.target.value)}
                    className="font-mono text-xs"
                  />
                  {recipientNeedsAta && (
                    <p className="text-xs text-yellow-500">
                      ⚠ Recipient has no token account. ATA creation will cost ~0.00204 SOL.
                    </p>
                  )}
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={sending || !sendTo || !sendAmount}
                    onClick={
                      sendMode === "sol" ? handleSendSol : handleSendToken
                    }
                  >
                    {sending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : null}
                    {sending
                      ? "Sending..."
                      : `Send ${sendMode === "sol" ? "SOL" : selectedToken?.symbol}`}
                  </Button>
                </div>
              )}

              {/* Export key */}
              <button
                onClick={() => {
                  setShowDynamicUserProfile(true);
                  setOpen(false);
                }}
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors py-2 border-t border-border"
              >
                Export Private Key
              </button>
              {/* Dashboard */}
              <Link
                to="/dashboard"
                onClick={() => setOpen(false)}
                className="flex w-full items-center justify-center gap-2 text-center text-xs text-muted-foreground hover:text-foreground transition-colors py-2 border-t border-border"
              >
                <LayoutDashboard className="h-3 w-3" />
                Dashboard
              </Link>
              <p className="px-3 pt-2 pb-1 text-[10px] text-center text-muted-foreground/70 leading-relaxed">
                Your keys are non-custodial. Export to use in any Solana wallet.
              </p>

              {/* Disconnect */}
              <button
                onClick={() => {
                  handleLogOut();
                  setOpen(false);
                }}
                className="w-full text-center text-xs text-muted-foreground hover:text-destructive transition-colors py-2 pb-3"
              >
                Log out
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WalletDropdown;

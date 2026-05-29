import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createHash } from "crypto";

import type { BlobPublisher } from "./celestia";

/** SPL Memo program. The batch blob rides in a memo instruction's data. */
export const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);

export interface SolanaDaConfig {
  connection: Connection;
  /** Pays the (tiny) tx fee for the DA write. */
  payer: Keypair;
}

/**
 * Solana-native data availability. The batch blob is written into the Solana
 * ledger as a Memo-program instruction (base64-encoded), so the data lives in
 * the transaction and is retrievable via archival RPC or an indexer. No second
 * chain, no TIA, no rent-paying account.
 *
 * This is the default DA path for Iris. It is the right choice for the MVP and
 * for typical batch sizes.
 *
 * Constraint: a single Solana transaction is capped at ~1232 bytes, so one memo
 * holds only a small batch. For very large batches, either chunk across several
 * txs or use `CelestiaPublisher` (see celestia.ts), which is the optional
 * Phase-2 scale path.
 */
export class SolanaDaPublisher implements BlobPublisher {
  constructor(private readonly cfg: SolanaDaConfig) {}

  async submitBlob(
    blob: Uint8Array,
  ): Promise<{ daPointer: Uint8Array; slot: number; signature: string }> {
    const ix = new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(Buffer.from(blob).toString("base64"), "utf8"),
    });
    const tx = new Transaction().add(ix);
    const signature = await sendAndConfirmTransaction(
      this.cfg.connection,
      tx,
      [this.cfg.payer],
      { commitment: "confirmed" },
    );
    const status = await this.cfg.connection.getSignatureStatus(signature);
    const slot = status.value?.slot ?? 0;
    const commitment = sha256(blob);
    return { daPointer: encodeSolanaDaPointer(BigInt(slot), commitment), slot, signature };
  }
}

/**
 * Pack a Solana ledger reference into the 64-byte `da_pointer` stored on-chain.
 * Layout: slot(8 LE) | blob_sha256(32) | reserved(23) | source_tag(1).
 * source_tag 2 = solana-ledger (1 = celestia), so a verifier can tell which DA
 * layer a root was anchored to.
 */
export function encodeSolanaDaPointer(slot: bigint, commitment: Uint8Array): Uint8Array {
  const out = new Uint8Array(64);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, slot, true);
  out.set(commitment.slice(0, 32), 8);
  out[63] = 2;
  return out;
}

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(Buffer.from(data)).digest());
}

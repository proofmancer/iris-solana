import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { deriveReceiptPda } from "./receipt";
import {
  IRIS_PROGRAM_ID,
  ReceiptAccount,
  AttestationView,
  RECEIPT_VERSION,
} from "./types";

const ACCOUNT_DISCRIMINATOR_LEN = 8;

export interface VerifyOptions {
  rpcUrl?: string;
  connection?: Connection;
  programId?: PublicKey;
  expectedAuthorizingKey?: PublicKey;
  expectedRelayer?: PublicKey;
  /** Reject receipts older than this many seconds (default: no limit). */
  maxAgeSeconds?: number;
  /** Require the receipt to be anchored to a root commit. */
  requireAnchored?: boolean;
}

export class VerificationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "VerificationError";
  }
}

export async function verifyReceipt(
  payloadHash: Buffer,
  opts: VerifyOptions = {},
): Promise<AttestationView> {
  const programId = opts.programId ?? IRIS_PROGRAM_ID;
  const connection =
    opts.connection ??
    new Connection(
      opts.rpcUrl ?? "https://api.devnet.solana.com",
      "confirmed",
    );

  const [pda] = deriveReceiptPda(payloadHash, programId);
  const info = await connection.getAccountInfo(pda, "confirmed");
  if (!info) {
    throw new VerificationError(
      "NOT_FOUND",
      `No receipt at ${pda.toBase58()}`,
    );
  }
  if (!info.owner.equals(programId)) {
    throw new VerificationError(
      "WRONG_OWNER",
      `Receipt account owned by ${info.owner.toBase58()}, expected ${programId.toBase58()}`,
    );
  }

  const receipt = decodeReceipt(info.data);

  if (receipt.version !== RECEIPT_VERSION) {
    throw new VerificationError(
      "VERSION",
      `Unsupported receipt version ${receipt.version}`,
    );
  }
  if (!buffersEqual(Buffer.from(receipt.payloadHash), payloadHash)) {
    throw new VerificationError(
      "PAYLOAD_MISMATCH",
      "On-chain payload hash does not match expected",
    );
  }
  if (
    opts.expectedAuthorizingKey &&
    !receipt.authorizingKey.equals(opts.expectedAuthorizingKey)
  ) {
    throw new VerificationError(
      "WRONG_AGENT",
      "Receipt signed for a different authorizing key",
    );
  }
  if (
    opts.expectedRelayer &&
    !receipt.relayer.equals(opts.expectedRelayer)
  ) {
    throw new VerificationError(
      "WRONG_RELAYER",
      "Receipt submitted by an unexpected relayer",
    );
  }
  if (opts.maxAgeSeconds != null) {
    const ageSec = Math.floor(Date.now() / 1000) - receipt.timestamp.toNumber();
    if (ageSec > opts.maxAgeSeconds) {
      throw new VerificationError(
        "EXPIRED",
        `Receipt is ${ageSec}s old (max ${opts.maxAgeSeconds}s)`,
      );
    }
  }
  if (opts.requireAnchored && !receipt.rootCommit) {
    throw new VerificationError(
      "NOT_ANCHORED",
      "Receipt has not yet been committed to a DA root",
    );
  }

  return {
    action: receipt.action,
    authorizingKey: receipt.authorizingKey,
    relayer: receipt.relayer,
    payloadHash: receipt.payloadHash,
    timestamp: receipt.timestamp,
    slot: receipt.slot,
    anchored: receipt.rootCommit !== null,
  };
}

function decodeReceipt(raw: Buffer): ReceiptAccount {
  let o = ACCOUNT_DISCRIMINATOR_LEN;
  const version = raw.readUInt8(o); o += 1;
  const action = raw.subarray(o, o + 32); o += 32;
  const authorizingKey = new PublicKey(raw.subarray(o, o + 32)); o += 32;
  const relayer = new PublicKey(raw.subarray(o, o + 32)); o += 32;
  const payloadHash = raw.subarray(o, o + 32); o += 32;
  const timestamp = new BN(raw.subarray(o, o + 8), "le"); o += 8;
  const slot = new BN(raw.subarray(o, o + 8), "le"); o += 8;
  const hasRoot = raw.readUInt8(o); o += 1;
  let rootCommit: PublicKey | null = null;
  if (hasRoot === 1) {
    rootCommit = new PublicKey(raw.subarray(o, o + 32));
    o += 32;
  }
  const bump = raw.readUInt8(o);
  return {
    version,
    action: new Uint8Array(action),
    authorizingKey,
    relayer,
    payloadHash: new Uint8Array(payloadHash),
    timestamp,
    slot,
    rootCommit,
    bump,
  };
}

function buffersEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

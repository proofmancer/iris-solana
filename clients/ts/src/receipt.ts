import { createHash } from "crypto";
import { PublicKey } from "@solana/web3.js";

import {
  IRIS_PROGRAM_ID,
  RECEIPT_SEED,
  ROOT_SEED,
  ReceiptPayload,
} from "./types";

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) => JSON.stringify(k) + ":" + canonicalize((value as any)[k]),
  );
  return "{" + parts.join(",") + "}";
}

export function hashPayload(payload: ReceiptPayload): Buffer {
  const canonical = canonicalize({
    action: payload.action,
    authorizingKey: payload.authorizingKey.toBase58(),
    body: payload.body,
    nonce: payload.nonce ?? null,
    issuedAt: payload.issuedAt ?? null,
  });
  return createHash("sha256").update(canonical).digest();
}

export function hashAction(action: string): Buffer {
  return createHash("sha256").update(action).digest();
}

export function deriveReceiptPda(
  payloadHash: Buffer,
  programId: PublicKey = IRIS_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [RECEIPT_SEED, payloadHash],
    programId,
  );
}

export function deriveRootCommitPda(
  merkleRoot: Buffer,
  programId: PublicKey = IRIS_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([ROOT_SEED, merkleRoot], programId);
}

export interface BuiltReceipt {
  payloadHash: Buffer;
  actionHash: Buffer;
  receiptPda: PublicKey;
  bump: number;
}

export function buildReceipt(payload: ReceiptPayload): BuiltReceipt {
  const payloadHash = hashPayload(payload);
  const actionHash = hashAction(payload.action);
  const [receiptPda, bump] = deriveReceiptPda(payloadHash);
  return { payloadHash, actionHash, receiptPda, bump };
}

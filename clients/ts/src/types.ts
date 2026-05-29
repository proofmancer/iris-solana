import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

export const IRIS_PROGRAM_ID = new PublicKey(
  "Ir1sRecPt11111111111111111111111111111111",
);

export const RECEIPT_SEED = Buffer.from("receipt");
export const ROOT_SEED = Buffer.from("root");

export const RECEIPT_VERSION = 1;

export interface ReceiptPayload {
  action: string;
  authorizingKey: PublicKey;
  body: unknown;
  nonce?: string;
  issuedAt?: number;
}

export interface ReceiptAccount {
  version: number;
  action: Uint8Array;
  authorizingKey: PublicKey;
  relayer: PublicKey;
  payloadHash: Uint8Array;
  timestamp: BN;
  slot: BN;
  rootCommit: PublicKey | null;
  bump: number;
}

export interface AttestationView {
  action: Uint8Array;
  authorizingKey: PublicKey;
  relayer: PublicKey;
  payloadHash: Uint8Array;
  timestamp: BN;
  slot: BN;
  anchored: boolean;
}

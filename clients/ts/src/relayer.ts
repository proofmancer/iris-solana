import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";

import { buildReceipt, deriveReceiptPda } from "./receipt";
import { IRIS_PROGRAM_ID, ReceiptPayload } from "./types";

export interface RelayerConfig {
  rpcUrl: string;
  relayerKeypair: Keypair;
  programId?: PublicKey;
  idl?: any;
}

export class IrisRelayer {
  readonly connection: Connection;
  readonly relayer: Keypair;
  readonly programId: PublicKey;
  readonly provider: AnchorProvider;
  private program?: Program;

  constructor(cfg: RelayerConfig) {
    this.connection = new Connection(cfg.rpcUrl, "confirmed");
    this.relayer = cfg.relayerKeypair;
    this.programId = cfg.programId ?? IRIS_PROGRAM_ID;
    this.provider = new AnchorProvider(
      this.connection,
      new Wallet(this.relayer),
      { commitment: "confirmed" },
    );
    if (cfg.idl) {
      this.program = new Program(cfg.idl, this.provider);
    }
  }

  async issueReceipt(payload: ReceiptPayload): Promise<{
    signature: string;
    receiptPda: PublicKey;
    payloadHash: Buffer;
  }> {
    if (!this.program) {
      throw new Error(
        "IDL not provided; pass `idl` in RelayerConfig or use buildIssueReceiptIx",
      );
    }
    const { payloadHash, actionHash, receiptPda } = buildReceipt(payload);

    const sig = await this.program.methods
      .issueReceipt({
        action: Array.from(actionHash),
        authorizingKey: payload.authorizingKey,
        payloadHash: Array.from(payloadHash),
      })
      .accounts({
        relayer: this.relayer.publicKey,
        receipt: receiptPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { signature: sig, receiptPda, payloadHash };
  }

  /**
   * Manual instruction builder for callers that don't want to load the IDL.
   * The MCP server should usually use issueReceipt() with the IDL.
   */
  buildIssueReceiptIx(payload: ReceiptPayload): {
    ix: TransactionInstruction;
    receiptPda: PublicKey;
    payloadHash: Buffer;
  } {
    const { payloadHash, actionHash, receiptPda } = buildReceipt(payload);
    const data = encodeIssueReceiptData(
      Array.from(actionHash),
      payload.authorizingKey,
      Array.from(payloadHash),
    );
    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: this.relayer.publicKey, isSigner: true, isWritable: true },
        { pubkey: receiptPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    return { ix, receiptPda, payloadHash };
  }
}

// Anchor discriminator for `issue_receipt` = sha256("global:issue_receipt")[..8]
// We hard-code the precomputed bytes so we can build ixs without the IDL.
const ISSUE_RECEIPT_DISCRIMINATOR = Buffer.from([
  0xb9, 0x6c, 0x73, 0x82, 0x1e, 0x83, 0xaf, 0xb6,
]);

function encodeIssueReceiptData(
  action: number[],
  authorizingKey: PublicKey,
  payloadHash: number[],
): Buffer {
  const buf = Buffer.alloc(8 + 32 + 32 + 32);
  ISSUE_RECEIPT_DISCRIMINATOR.copy(buf, 0);
  Buffer.from(action).copy(buf, 8);
  authorizingKey.toBuffer().copy(buf, 40);
  Buffer.from(payloadHash).copy(buf, 72);
  return buf;
}

export { deriveReceiptPda };

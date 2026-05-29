import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { createHash } from "crypto";

import type { IrisReceipts } from "../target/types/iris_receipts";

const RECEIPT_SEED = Buffer.from("receipt");
const ROOT_SEED = Buffer.from("root");

function sha256(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

describe("iris-receipts", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.IrisReceipts as Program<IrisReceipts>;
  const relayer = provider.wallet;
  const agent = Keypair.generate();

  const action = sha256("transfer.execute");
  const payloadHash = sha256("payload:test-001");

  let receiptPda: PublicKey;

  before(() => {
    [receiptPda] = PublicKey.findProgramAddressSync(
      [RECEIPT_SEED, payloadHash],
      program.programId,
    );
  });

  it("issues a receipt", async () => {
    await program.methods
      .issueReceipt({
        action: Array.from(action),
        authorizingKey: agent.publicKey,
        payloadHash: Array.from(payloadHash),
      })
      .accounts({
        relayer: relayer.publicKey,
        receipt: receiptPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const r = await program.account.receipt.fetch(receiptPda);
    expect(r.version).to.equal(1);
    expect(Buffer.from(r.action)).to.deep.equal(action);
    expect(Buffer.from(r.payloadHash)).to.deep.equal(payloadHash);
    expect(r.authorizingKey.toBase58()).to.equal(agent.publicKey.toBase58());
    expect(r.relayer.toBase58()).to.equal(relayer.publicKey.toBase58());
    expect(r.rootCommit).to.be.null;
  });

  it("rejects a duplicate receipt for the same payload", async () => {
    let threw = false;
    try {
      await program.methods
        .issueReceipt({
          action: Array.from(action),
          authorizingKey: agent.publicKey,
          payloadHash: Array.from(payloadHash),
        })
        .accounts({
          relayer: relayer.publicKey,
          receipt: receiptPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch {
      threw = true;
    }
    expect(threw, "second issue_receipt should fail").to.equal(true);
  });

  it("returns an attestation view via verify_receipt", async () => {
    const view = await program.methods
      .verifyReceipt(Array.from(payloadHash))
      .accounts({ receipt: receiptPda })
      .view();

    expect(view.authorizingKey.toBase58()).to.equal(agent.publicKey.toBase58());
    expect(Buffer.from(view.payloadHash)).to.deep.equal(payloadHash);
    expect(view.anchored).to.equal(false);
  });

  it("commits a Merkle root", async () => {
    const merkleRoot = sha256("root:batch-001");
    const daPointer = Buffer.alloc(64);
    daPointer.writeBigUInt64LE(1234567n, 0);

    const [rootPda] = PublicKey.findProgramAddressSync(
      [ROOT_SEED, merkleRoot],
      program.programId,
    );

    await program.methods
      .commitRoot({
        merkleRoot: Array.from(merkleRoot),
        daPointer: Array.from(daPointer),
        receiptCount: 1,
      })
      .accounts({
        relayer: relayer.publicKey,
        rootCommit: rootPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const rc = await program.account.rootCommit.fetch(rootPda);
    expect(rc.receiptCount).to.equal(1);
    expect(Buffer.from(rc.merkleRoot)).to.deep.equal(merkleRoot);
  });
});

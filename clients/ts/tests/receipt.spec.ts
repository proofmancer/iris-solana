import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";

import {
  buildReceipt,
  canonicalize,
  deriveReceiptPda,
  hashPayload,
} from "../src/receipt";
import { buildBatch, encodeDaPointer } from "../src/da/celestia";
import { IRIS_PROGRAM_ID } from "../src/types";

describe("canonicalize", () => {
  it("sorts object keys deterministically", () => {
    expect(canonicalize({ b: 1, a: 2 })).to.equal('{"a":2,"b":1}');
  });
  it("recurses into nested structures", () => {
    expect(canonicalize({ x: { c: 3, a: 1 }, y: [{ b: 2, a: 1 }] }))
      .to.equal('{"x":{"a":1,"c":3},"y":[{"a":1,"b":2}]}');
  });
});

describe("buildReceipt", () => {
  it("produces a deterministic payload hash and PDA", () => {
    const agent = PublicKey.unique();
    const payload = {
      action: "transfer.execute",
      authorizingKey: agent,
      body: { to: "abc", amount: 100 },
      nonce: "1",
    };
    const a = buildReceipt(payload);
    const b = buildReceipt(payload);
    expect(a.payloadHash.equals(b.payloadHash)).to.equal(true);
    expect(a.receiptPda.equals(b.receiptPda)).to.equal(true);
  });

  it("changes hash when body changes", () => {
    const agent = PublicKey.unique();
    const a = hashPayload({
      action: "transfer.execute",
      authorizingKey: agent,
      body: { amount: 1 },
    });
    const b = hashPayload({
      action: "transfer.execute",
      authorizingKey: agent,
      body: { amount: 2 },
    });
    expect(a.equals(b)).to.equal(false);
  });
});

describe("deriveReceiptPda", () => {
  it("matches Solana PDA derivation rules", () => {
    const payloadHash = Buffer.alloc(32, 7);
    const [pda1] = deriveReceiptPda(payloadHash);
    const [pda2] = PublicKey.findProgramAddressSync(
      [Buffer.from("receipt"), payloadHash],
      IRIS_PROGRAM_ID,
    );
    expect(pda1.equals(pda2)).to.equal(true);
  });
});

describe("buildBatch", () => {
  it("builds a single-leaf root for one receipt", () => {
    const ph = Buffer.alloc(32, 1);
    const pda = Buffer.alloc(32, 2);
    const batch = buildBatch([{ payloadHash: ph, receiptPda: pda }]);
    expect(batch.count).to.equal(1);
    expect(batch.root.length).to.equal(32);
    expect(batch.leaves.length).to.equal(1);
  });

  it("is stable across runs", () => {
    const inputs = [0, 1, 2, 3].map((i) => ({
      payloadHash: Buffer.alloc(32, i),
      receiptPda: Buffer.alloc(32, i + 10),
    }));
    const a = buildBatch(inputs);
    const b = buildBatch(inputs);
    expect(Buffer.from(a.root)).to.deep.equal(Buffer.from(b.root));
  });
});

describe("encodeDaPointer", () => {
  it("packs height + namespace + commitment into 64 bytes", () => {
    const out = encodeDaPointer({
      height: 1234567n,
      namespace: new Uint8Array(24).fill(9),
      commitment: new Uint8Array(32).fill(7),
    });
    expect(out.length).to.equal(64);
  });
});

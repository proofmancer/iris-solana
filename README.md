# Iris — Solana side

Verifiable on-chain receipts for AI agent actions. This repo is the **Solana half** of Iris; the MCP server core lives at
[github.com/ligate-io/ligate-mcp](https://github.com/ligate-io/ligate-mcp).

## What this gives you

1. **`iris-receipts`** — Anchor program. Stores relayer-signed agent-action receipts in a PDA keyed by `payload_hash`. Any
   downstream Solana program can verify a receipt by deriving the same PDA and reading it (no CPI required).
2. **`verifier-example`** — Anchor program. Tiny worked example of a downstream program that gates an action on a valid Iris
   receipt for a specific agent + payload hash.
3. **`@iris/client`** (TypeScript) — receipt builder, off-chain verifier, relayer helper, and Celestia DA worker.
4. **Tests** — LiteSVM/Anchor integration tests for the program and offline unit tests for the client.

## Architecture

```
   ┌────────────┐  agent action       ┌─────────────┐   issue_receipt    ┌────────────────┐
   │  AI agent  │ ─────────────────► │  Iris MCP   │ ────────────────► │  iris-receipts │
   │ (ligate)   │   canonical body   │  (relayer)  │   payload_hash      │   PDA per hash │
   └────────────┘                     └──────┬──────┘                     └──────┬─────────┘
                                             │                                    │
                                             │ batch every N or T                 │
                                             ▼                                    ▼
                                     ┌────────────────┐  commit_root   ┌────────────────┐
                                     │ Merkle batcher │ ─────────────► │ RootCommit PDA │
                                     └──────┬─────────┘                └────────────────┘
                                            │
                                            ▼
                                     ┌────────────────┐
                                     │   Celestia     │  blob: leaves + root
                                     │   (mocha-4)    │  pointer stored on Solana
                                     └────────────────┘

   ┌──────────────────┐  derive PDA from payload_hash      ┌────────────────┐
   │ downstream prog  │ ─────────────────────────────────► │  iris-receipts │
   │  (verifier-ex)   │  read Receipt, check fields        │  PDA per hash  │
   └──────────────────┘                                    └────────────────┘
```

## Data model

`Receipt` (PDA `[b"receipt", payload_hash]`):

| field             | type        | notes                                                       |
|-------------------|-------------|-------------------------------------------------------------|
| `version`         | `u8`        | starts at 1                                                 |
| `action`          | `[u8; 32]`  | `sha256(action_name)` — bounded, no string heap             |
| `authorizing_key` | `Pubkey`    | the agent's signing key (the key the user authorized)       |
| `relayer`         | `Pubkey`    | who paid + submitted; must sign the tx                      |
| `payload_hash`    | `[u8; 32]`  | `sha256(canonical_json(payload))`                           |
| `timestamp`       | `i64`       | from Solana `Clock`                                         |
| `slot`            | `u64`       | from Solana `Clock`                                         |
| `root_commit`     | `Option<Pubkey>` | set when a Merkle root containing this leaf lands     |
| `bump`            | `u8`        |                                                             |

`RootCommit` (PDA `[b"root", merkle_root]`):

| field            | type        | notes                                                        |
|------------------|-------------|--------------------------------------------------------------|
| `merkle_root`    | `[u8; 32]`  | root of `sha256` over receipt `payload_hash`es               |
| `da_pointer`     | `[u8; 64]`  | `height(8 LE) ‖ namespace(24) ‖ commitment(32)`              |
| `receipt_count`  | `u32`       | leaves in the batch                                          |
| `committed_at`   | `i64`       |                                                              |
| `committed_slot` | `u64`       |                                                              |
| `relayer`        | `Pubkey`    |                                                              |
| `bump`           | `u8`        |                                                              |

## Instructions

| ix                | who signs | effect                                                                                  |
|-------------------|-----------|------------------------------------------------------------------------------------------|
| `issue_receipt`   | relayer   | creates the `Receipt` PDA. Fails if one already exists for the payload (idempotent).    |
| `commit_root`    | relayer   | creates a `RootCommit` PDA pointing at a Celestia blob.                                  |
| `verify_receipt`  | (none)    | view ix — returns `AttestationView` and emits `ReceiptVerified`. Callable via CPI.       |

Two verification patterns are supported:

- **Read-only (cheap path)** — derive PDA from `payload_hash`, read & check fields. See `verifier-example/src/lib.rs`.
- **CPI / event path** — call `verify_receipt`; the program emits `ReceiptVerified` that callers can pin to.

## Trust model

- The agent's `authorizing_key` is whatever the MCP server registered for that user. The on-chain program does not verify the
  agent's signature directly — the **relayer** vouches by signing the transaction and the `authorizing_key` is recorded in
  the receipt. Downstream programs trust the receipt iff they trust the relayer.
- For trust-minimized variants, the MCP server can sign the canonical payload with the agent key, store the signature in the
  payload, and any verifier can re-check it off-chain. Keep the on-chain footprint to `payload_hash` only.
- Batched roots on Celestia exist so that a permanent, public record of every receipt survives even if individual Solana
  accounts are garbage collected by future cleanup work.

## Project plan

### Phase 0 — scaffold (this commit)
- [x] Anchor program with `issue_receipt`, `commit_root`, `verify_receipt`
- [x] `verifier-example` showing how a downstream Anchor program reads receipts
- [x] TS client with payload hashing, PDA derivation, relayer wrapper, off-chain verifier
- [x] Celestia DA worker scaffold (batch + publish blob, encode `da_pointer`)
- [x] Anchor & TS tests
- [x] `.env.example`, setup script

### Phase 1 — wire to ligate-mcp
- [ ] Add `iris.issue_receipt(action, payload)` as an MCP tool inside `ligate-mcp` that uses `@iris/client`'s `IrisRelayer`
- [ ] Add `iris.verify_receipt(payloadHash)` as an MCP tool that returns the `AttestationView`
- [ ] MCP server: register the agent's `authorizing_key` per user, expose `iris.get_receipt_url(payloadHash)` returning an explorer URL
- [ ] Decide payload canonicalization with ligate-mcp team — currently `canonicalize()` in `clients/ts/src/receipt.ts`

### Phase 2 — DA + back-fill
- [ ] Run the DA worker as a sidecar to the MCP relayer
- [ ] On `RootCommitted` event, back-fill `root_commit` field on each `Receipt` (new ix `link_receipts_to_root`)
- [ ] Inclusion-proof helper in `@iris/client`: prove a `payload_hash` is in a given root using the Celestia blob

### Phase 3 — harden
- [ ] Relayer allowlist + per-relayer rate limits on-chain
- [ ] Replace ad-hoc Merkle with `@solana/spl-account-compression` concurrent Merkle tree (so the on-chain proof itself is verifiable)
- [ ] Optional Ed25519 program verification of the agent signature inside `issue_receipt`
- [ ] Devnet → mainnet plan, multisig program upgrade authority (Squads)
- [ ] Security review (see `/code-review ultra` and the `cso` skill)

## Setup

```bash
cd ~/Desktop/iris-solana
./scripts/setup.sh           # installs avm + anchor 0.30.1, builds, deploys to devnet
cp .env.example .env         # fill in HELIUS_RPC_URL, CELESTIA_AUTH_TOKEN
```

Anchor isn't currently installed on this machine — `scripts/setup.sh` will install it via `avm`. The first install takes a
while (compiling anchor-cli from source). If you'd rather install it yourself:

```bash
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install 0.30.1 && avm use 0.30.1
```

## Build & test

```bash
anchor build                # builds both programs
anchor test                 # spins up a local validator and runs tests/iris-receipts.ts
npm --prefix clients/ts test   # offline unit tests for the TS client (no validator needed)
```

## Deploy to devnet

```bash
anchor deploy --provider.cluster devnet
# replace IRIS_PROGRAM_ID in .env with the printed program id and rebuild
# IDLs land in target/idl/ — the MCP server can import them directly.
```

## Wiring into `ligate-mcp`

```ts
import { IrisRelayer } from "@iris/client";
import idl from "../target/idl/iris_receipts.json";

const iris = new IrisRelayer({
  rpcUrl: process.env.HELIUS_RPC_URL!,
  relayerKeypair: loadKeypair(process.env.RELAYER_KEYPAIR_PATH!),
  idl,
});

// Inside an MCP tool handler:
const { signature, receiptPda, payloadHash } = await iris.issueReceipt({
  action: "transfer.execute",
  authorizingKey: user.agentPubkey,
  body: { to, amount, denom },
  nonce: ulid(),
  issuedAt: Date.now(),
});
return { signature, receiptPda: receiptPda.toBase58(), payloadHash: payloadHash.toString("hex") };
```

## Notes & known TODOs

- The `issue_receipt` discriminator in `clients/ts/src/relayer.ts` is precomputed (`b96c73821e83afb6`). If you rename the
  instruction in Rust, regenerate it: `sha256("global:issue_receipt")[..8]`.
- `DaWorker.flush()` currently reads `(this.cfg.publisher as any).cfg.namespace` — replace with a typed accessor before
  shipping.
- `verify_receipt` is a `.view()` ix today; switching it to a real CPI just means dropping the `.view()` call in clients and
  reading `ReceiptVerified` from logs.
- Program IDs in `Anchor.toml` / `declare_id!` are placeholders. Generate real keys with `anchor keys list` after `anchor build`
  and update both files.

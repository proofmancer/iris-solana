# Iris (Solana)

**Verifiable on-chain receipts for AI agent actions.**

> [Live demo](https://proofmancer.github.io/iris-solana/) &middot; [Deployed program (devnet)](https://explorer.solana.com/address/GvXMdAupDkGQxNXVEPMNowxFbyuBS5Bi4Kfq1zcDdopK?cluster=devnet) &middot; [Sample receipt](https://explorer.solana.com/address/8rbTEj7gEQvTfr8eBrKmKfabPkUos7dUM5K7SUnB99ow?cluster=devnet)

Every time an AI agent takes an action through MCP, Iris writes a signed on-chain receipt to a content-addressable PDA on Solana. Any program, off-chain verifier, or auditor can read the receipt back, atomically, without an indexer.

This repo is the Solana half of Iris. The MCP server (the relayer that issues receipts) is a separate companion service.

## Try it in 30 seconds

1. Open [the live demo](https://proofmancer.github.io/iris-solana/).
2. Click "Try the demo receipt".
3. The page derives the PDA from the payload hash, fetches the account from Solana devnet, and renders the verified receipt fields.

The demo verifies a real on-chain receipt. The deployed program ID is `GvXMdAupDkGQxNXVEPMNowxFbyuBS5Bi4Kfq1zcDdopK`. The sample receipt PDA is `8rbTEj7gEQvTfr8eBrKmKfabPkUos7dUM5K7SUnB99ow`.

## What ships

| Component | Description |
|---|---|
| `programs/iris-receipts` | Anchor program. Three instructions: `issue_receipt`, `commit_root`, `verify_receipt`. Stores receipts in PDAs keyed by `payload_hash`. |
| `programs/verifier-example` | Anchor program. A tiny downstream program that gates an action on a valid Iris receipt for a specific agent and payload. |
| `clients/ts` (`@iris/client`) | TypeScript client. Canonical payload hashing, PDA derivation, relayer helper, pure client-side verifier, pluggable Celestia DA publisher. |
| `docs/` | The live verifier page hosted on GitHub Pages. |
| `tests/` | LiteSVM and Anchor integration tests for the program. Offline unit tests for the client. |

## How it works

```
   ┌────────────┐  agent action      ┌──────────────┐  issue_receipt    ┌─────────────────┐
   │  AI agent  │ ─────────────────► │  Iris MCP    │ ────────────────► │  iris-receipts  │
   │            │  canonical body    │  (relayer)   │  payload_hash     │  PDA per hash   │
   └────────────┘                    └──────┬───────┘                   └────────┬────────┘
                                            │                                    │
                                            │  batch every N or T                │
                                            ▼                                    ▼
                                    ┌────────────────┐  commit_root      ┌────────────────┐
                                    │ Merkle batcher │ ────────────────► │ RootCommit PDA │
                                    └──────┬─────────┘                   └────────────────┘
                                           │
                                           ▼
                                    ┌────────────────┐
                                    │   Celestia     │  blob: leaves + root
                                    │   (mocha-4)    │  pointer stored on Solana
                                    └────────────────┘

   ┌──────────────────┐  derive PDA from payload_hash    ┌─────────────────┐
   │ downstream prog  │ ───────────────────────────────► │  iris-receipts  │
   │  (verifier-ex)   │  read Receipt, check fields      │  PDA per hash   │
   └──────────────────┘                                  └─────────────────┘
```

PDA layout is **content-addressable**: `seeds = [b"receipt", payload_hash]`. The same canonical payload always lands at the same account. Duplicates fail loud.

## Data model

`Receipt` (PDA `[b"receipt", payload_hash]`):

| field | type | notes |
|---|---|---|
| `version` | `u8` | starts at 1 |
| `action` | `[u8; 32]` | `sha256(action_name)`, bounded, no string heap |
| `authorizing_key` | `Pubkey` | the agent's signing key (the key the user authorized) |
| `relayer` | `Pubkey` | who paid and submitted; must sign the tx |
| `payload_hash` | `[u8; 32]` | `sha256(canonical_json(payload))` |
| `timestamp` | `i64` | from Solana `Clock` |
| `slot` | `u64` | from Solana `Clock` |
| `root_commit` | `Option<Pubkey>` | set when a Merkle root containing this leaf lands |
| `bump` | `u8` |  |

`RootCommit` (PDA `[b"root", merkle_root]`):

| field | type | notes |
|---|---|---|
| `merkle_root` | `[u8; 32]` | root of `sha256` over receipt `payload_hash`es |
| `da_pointer` | `[u8; 64]` | `height(8 LE) ‖ namespace(24) ‖ commitment(32)` |
| `receipt_count` | `u32` | leaves in the batch |
| `committed_at` | `i64` |  |
| `committed_slot` | `u64` |  |
| `relayer` | `Pubkey` |  |
| `bump` | `u8` |  |

## Instructions

| Instruction | Signer | Effect |
|---|---|---|
| `issue_receipt` | relayer | Creates the `Receipt` PDA. Fails if one already exists for the payload (idempotent by design). |
| `commit_root` | relayer | Creates a `RootCommit` PDA pointing at a Celestia blob. |
| `verify_receipt` | none | View instruction. Returns `AttestationView` and emits `ReceiptVerified`. Callable via CPI. |

### Two verification patterns

**Cheap path (pure client-side).** Derive the PDA from the payload hash, read the account, decode the fields. No CPI, no extra signature. This is what the [live verifier page](https://proofmancer.github.io/iris-solana/) does in the browser.

**CPI path.** Downstream Solana programs invoke `verify_receipt` and pin to the `ReceiptVerified` event. Useful when you want the verification step itself recorded on-chain.

Example downstream program (the actual `verifier-example`):

```rust
use anchor_lang::prelude::*;
use iris_receipts::state::{Receipt, RECEIPT_SEED};

#[derive(Accounts)]
#[instruction(payload_hash: [u8; 32])]
pub struct ExecuteWithReceipt<'info> {
    #[account(
        seeds = [RECEIPT_SEED, payload_hash.as_ref()],
        seeds::program = iris_receipts::ID,
        bump,
    )]
    pub receipt: Account<'info, Receipt>,
}

pub fn handler(ctx: Context<ExecuteWithReceipt>, payload_hash: [u8; 32]) -> Result<()> {
    let r = &ctx.accounts.receipt;
    require!(r.payload_hash == payload_hash, ErrorCode::Mismatch);
    // r.action, r.authorizing_key, r.timestamp are all on-chain truth.
    Ok(())
}
```

## Trust model

- The agent's `authorizing_key` is whatever the MCP server registered for that user. The on-chain program does not verify the agent's signature directly. The **relayer** vouches by signing the transaction, and the `authorizing_key` is recorded in the receipt. Downstream programs trust the receipt iff they trust the relayer.
- For trust-minimized variants the MCP server can sign the canonical payload with the agent key, store the signature in the payload, and any verifier can re-check it off-chain. The on-chain footprint stays at `payload_hash` only.
- Batched roots on Celestia exist so a permanent, public record of every receipt survives even if individual Solana accounts are garbage collected by future state cleanup work.

## Roadmap

**Phase 0 (scaffold).** Anchor program with all three instructions. `verifier-example`. TypeScript client with payload hashing, PDA derivation, relayer wrapper, off-chain verifier. Celestia DA worker scaffold. Anchor and TS tests. `.env.example` and setup script.

**Phase 0.5 (this milestone).** Program deployed to devnet at `GvXMdAupDkGQxNXVEPMNowxFbyuBS5Bi4Kfq1zcDdopK`. Sample receipt issued. Live verifier page on GitHub Pages.

**Phase 1 (next).** Wire the program into an MCP server (the Iris relayer). Expose `iris.issue_receipt(action, payload)` and `iris.verify_receipt(payload_hash)` as MCP tools. Register each user's `authorizing_key` server-side. Lock canonicalization with the MCP-side team.

**Phase 2.** Run the DA worker as a sidecar to the MCP relayer. On `RootCommitted`, back-fill `root_commit` on each receipt via a new `link_receipts_to_root` instruction. Inclusion-proof helper in `@iris/client`.

**Phase 3 (harden).** Relayer allowlist and per-relayer rate limits on-chain. Replace ad-hoc Merkle with `@solana/spl-account-compression` concurrent Merkle tree. Optional Ed25519 program verification of the agent signature inside `issue_receipt`. Mainnet plan, Squads multisig program upgrade authority. Security review.

## Build and test (local)

The deployed binary on devnet was built via [Solana Playground](https://beta.solpg.io/) because of a transient toolchain gap in the local Solana 4.x platform-tools at the time of this commit. Local build instructions below remain for when the upstream toolchain stabilizes.

```bash
# install anchor (one-time)
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install 0.30.1 && avm use 0.30.1

# build and test
anchor build
anchor test
npm --prefix clients/ts test
```

## Deploy to devnet

The shipped artifact for this milestone was deployed via Solana Playground. To redeploy from a local clone once the toolchain works:

```bash
solana config set --url devnet
anchor deploy --provider.cluster devnet
```

The deployed program ID is pinned in `Anchor.toml` and `programs/iris-receipts/src/lib.rs`. If you regenerate keypairs in `target/deploy/`, run `anchor keys sync` and rebuild before deploy.

## Wiring into an MCP server

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

## Notes

- The `issue_receipt` discriminator in `clients/ts/src/relayer.ts` is precomputed (`b96c73821e83afb6`). Regenerate with `sha256("global:issue_receipt")[..8]` if the instruction is renamed.
- `BlobPublisher` is pluggable. The Solana-native ledger publisher is the default. The Celestia mocha-4 publisher in `clients/ts/src/da/celestia.ts` is optional and exposes its namespace via a typed `get namespace()` accessor.
- The verify page in `docs/` is pure client-side. It loads `@solana/web3.js` from a CDN, derives the PDA in the browser, and queries Solana devnet directly. No backend required.

## License

MIT or Apache-2.0, dual-licensed. See `LICENSE-MIT` and `LICENSE-APACHE`.

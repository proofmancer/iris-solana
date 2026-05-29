# CLAUDE.md — Iris (Solana side)

## What this repo is

The Solana half of Iris. Two Anchor programs (`iris-receipts`, `verifier-example`) and a TypeScript client (`@iris/client`)
that the MCP server at `github.com/ligate-io/ligate-mcp` calls.

The job of Iris: every time an AI agent takes an action via MCP, the relayer writes a verifiable receipt on-chain
(`action`, `authorizing_key`, `timestamp`, `payload_hash`) keyed by `payload_hash`, and a separate worker batches roots to
Celestia for cheap permanent storage.

## Architecture in one paragraph

PDA layout is **content-addressable**: `seeds = [b"receipt", payload_hash]`. Same canonical payload always lands at the same
account — duplicates fail loud. Downstream Solana programs verify by deriving the PDA themselves and reading the `Receipt`
account (Anchor's `seeds::program` does the trick — see `programs/verifier-example/src/lib.rs`). A `verify_receipt` ix exists
for CPI/event-based verification. Batched Merkle roots over `payload_hash`es get committed via `commit_root` and the blob
gets posted to Celestia mocha-4.

## Stack

- Anchor 0.30.1 / Rust edition 2021
- `@coral-xyz/anchor` + `@solana/web3.js` v1 in the TS client (deliberate — the IDL flow is much smoother than kit/v2 today)
- Helius RPC for devnet/mainnet
- Celestia light node (mocha-4) for DA

## Conventions

- One handler per file under `instructions/`. `instructions/mod.rs` re-exports.
- Account structs use `InitSpace`; account size is always `8 + T::INIT_SPACE`.
- Errors live in `error.rs`, never inline. Use `@ IrisError::X` in account constraints.
- TS: no `any` at API boundaries. Internal escape hatches (`as any`) only with a `TODO` comment naming the missing typing.
- Canonical JSON for payload hashing is `canonicalize()` in `clients/ts/src/receipt.ts`. **Do not** swap it for `JSON.stringify`
  — key ordering must be deterministic across MCP server / verifier.

## When editing

- Renaming `issue_receipt` requires regenerating the precomputed discriminator in `clients/ts/src/relayer.ts`.
- New fields on `Receipt` are a breaking change — bump `RECEIPT_VERSION` in `state.rs` and the verifier's version check.
- New ixs that mutate `Receipt` should respect content-addressable semantics (no edits-in-place — append-only).

## Useful commands

```bash
anchor build
anchor test
anchor deploy --provider.cluster devnet
npm --prefix clients/ts test   # offline tests, no validator
```

## Skills + MCPs to lean on

- `programs-anchor` (official) — patterns for Anchor accounts/constraints
- `testing` (official) + `surfpool` (official) — integration testing
- `security` (official) + `vulnhunter-skill` — pre-deploy review
- `helius-mcp` — RPC, webhooks, DAS API for the DA worker's event subscription
- `solana-fender-mcp` / `anchor-mcp` — program inspection

## Related repos

- `github.com/ligate-io/ligate-mcp` — MCP server that calls `@iris/client`

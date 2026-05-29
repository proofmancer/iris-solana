---
phase: build
project: iris-solana
created: 2026-05-29
---

# Iris — Solana scaffold context

## Stack
- **Pattern**: On-chain Program (Pattern 4) + thin TS client. No frontend.
- **Anchor 0.30.1** + Rust edition 2021
- **TS**: `@coral-xyz/anchor` + `@solana/web3.js` v1
- **RPC**: Helius (devnet)
- **DA**: Celestia mocha-4

## Programs
- `iris-receipts` — content-addressable Receipt PDA (`[b"receipt", payload_hash]`), `RootCommit` PDA (`[b"root", merkle_root]`).
  Three instructions: `issue_receipt`, `commit_root`, `verify_receipt`.
- `verifier-example` — downstream program that reads the Iris PDA via `seeds::program = iris_receipts::ID`.

## Client
- `@iris/client` exposes `IrisRelayer`, `verifyReceipt`, `buildReceipt`, `canonicalize`, plus a `celestia` namespace with
  `CelestiaPublisher` and `DaWorker`.

## Decisions
- **PDA seeds**: content-addressable on `payload_hash`. Same payload → same PDA, dedup is free, downstream verification needs
  no extra context. Trade-off: identical-payload replays are impossible to record separately — the MCP server should include
  a nonce in the canonical payload when distinct receipts for identical bodies are needed.
- **Trust model**: relayer signs the tx; `authorizing_key` is recorded but not signature-verified on-chain. Strong enough for
  v0 (relayer-attested). Ed25519 program verification is Phase 3.
- **DA**: Celestia chosen because user already runs `~/.celestia-light-mocha-4`. Blob format is
  `[magic | count | root | (payload_hash ‖ pda) * count]`. Pointer is `height(8) ‖ namespace(24) ‖ commitment(32)` in 64 bytes.

## Skills + MCPs
- Skills (recommend installing): `programs-anchor`, `testing`, `security`, `surfpool`, `helius-build-skill`
- MCPs (recommend wiring into `.claude/settings.json` later): `helius-mcp`, `solana-fender-mcp`, `anchor-mcp`

## Build status
```json
{
  "mvp_complete": false,
  "scaffold_complete": true,
  "anchor_installed": false,
  "tests_passing": null,
  "devnet_deployed": false,
  "celestia_wired": false
}
```

## Open TODOs picked up by Phase 1
- Replace placeholder program IDs (`Ir1sRecPt…`, `Ver1f1erEx…`) with `anchor keys list` output after first build
- Install `avm` + Anchor 0.30.1 (see `scripts/setup.sh`)
- Wire `@iris/client` into `github.com/ligate-io/ligate-mcp`
- Replace `(publisher as any).cfg.namespace` access in `DaWorker.flush()` with a typed accessor
- Move from ad-hoc Merkle to `@solana/spl-account-compression` concurrent Merkle tree once inclusion proofs are needed

## Next phase
Run `/build-with-claude` to begin guided implementation of Phase 1 (wire `@iris/client` into `ligate-mcp`).

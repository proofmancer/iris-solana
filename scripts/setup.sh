#!/usr/bin/env bash
set -euo pipefail

# One-shot bootstrap for a fresh clone.
# Expects: rustc, cargo, solana, node, npm already installed.

cd "$(dirname "$0")/.."

if ! command -v anchor >/dev/null 2>&1; then
  echo "[setup] anchor not found — installing avm + anchor 0.30.1"
  cargo install --git https://github.com/coral-xyz/anchor avm --force
  avm install 0.30.1
  avm use 0.30.1
fi

echo "[setup] installing node deps"
npm install
(cd clients/ts && npm install)

if [ ! -f ~/.config/solana/id.json ]; then
  echo "[setup] generating a dev wallet at ~/.config/solana/id.json"
  solana-keygen new --no-bip39-passphrase -o ~/.config/solana/id.json
fi

solana config set --url devnet >/dev/null

echo "[setup] requesting devnet airdrop"
solana airdrop 2 || true

echo "[setup] building program"
anchor build

echo
echo "Done. Next steps:"
echo "  anchor deploy --provider.cluster devnet"
echo "  npm test            # runs Anchor tests against a local validator"
echo "  npm run test:ts     # runs offline TS client tests"

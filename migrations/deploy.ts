// Anchor deploy hook. Anchor runs this after `anchor deploy`.
// Use it to initialize on-chain config (allowlisted relayers, etc.) once you
// extend the program beyond the v0 receipt schema.

import * as anchor from "@coral-xyz/anchor";

module.exports = async function (provider: anchor.AnchorProvider) {
  anchor.setProvider(provider);
  console.log(
    `[iris-solana] deployed by ${provider.wallet.publicKey.toBase58()} to ${
      provider.connection.rpcEndpoint
    }`,
  );
};

use anchor_lang::prelude::*;

#[error_code]
pub enum IrisError {
    #[msg("Payload hash does not match receipt")]
    PayloadHashMismatch,
    #[msg("Relayer is not authorized")]
    UnauthorizedRelayer,
    #[msg("Receipt already exists for this payload")]
    ReceiptAlreadyExists,
    #[msg("Root commit account already exists")]
    RootAlreadyCommitted,
    #[msg("Receipt version is not supported by this program")]
    UnsupportedVersion,
}

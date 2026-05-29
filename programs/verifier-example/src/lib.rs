use anchor_lang::prelude::*;

use iris_receipts::state::{Receipt, RECEIPT_SEED};

declare_id!("Ver1f1erEx111111111111111111111111111111111");

#[program]
pub mod verifier_example {
    use super::*;

    pub fn execute_with_receipt(
        ctx: Context<ExecuteWithReceipt>,
        payload_hash: [u8; 32],
        expected_authorizing_key: Pubkey,
    ) -> Result<()> {
        let r = &ctx.accounts.iris_receipt;
        require_keys_eq!(
            r.authorizing_key,
            expected_authorizing_key,
            ErrorCode::WrongAgent
        );
        require!(r.payload_hash == payload_hash, ErrorCode::PayloadHashMismatch);

        msg!(
            "iris receipt OK: agent={} relayer={} slot={}",
            r.authorizing_key,
            r.relayer,
            r.slot
        );
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(payload_hash: [u8; 32])]
pub struct ExecuteWithReceipt<'info> {
    #[account(
        seeds = [RECEIPT_SEED, payload_hash.as_ref()],
        bump = iris_receipt.bump,
        seeds::program = iris_receipts::ID,
    )]
    pub iris_receipt: Account<'info, Receipt>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Receipt is for a different agent")]
    WrongAgent,
    #[msg("Receipt payload hash does not match")]
    PayloadHashMismatch,
}

use anchor_lang::prelude::*;

use crate::error::IrisError;
use crate::state::*;

#[derive(Accounts)]
#[instruction(expected_payload_hash: [u8; 32])]
pub struct VerifyReceipt<'info> {
    #[account(
        seeds = [RECEIPT_SEED, expected_payload_hash.as_ref()],
        bump = receipt.bump,
        constraint = receipt.payload_hash == expected_payload_hash @ IrisError::PayloadHashMismatch,
        constraint = receipt.version == RECEIPT_VERSION @ IrisError::UnsupportedVersion,
    )]
    pub receipt: Account<'info, Receipt>,
}

pub fn handler(
    ctx: Context<VerifyReceipt>,
    _expected_payload_hash: [u8; 32],
) -> Result<AttestationView> {
    let r = &ctx.accounts.receipt;

    let view = AttestationView {
        action: r.action,
        authorizing_key: r.authorizing_key,
        relayer: r.relayer,
        payload_hash: r.payload_hash,
        timestamp: r.timestamp,
        slot: r.slot,
        anchored: r.root_commit.is_some(),
    };

    emit!(ReceiptVerified {
        payload_hash: r.payload_hash,
        authorizing_key: r.authorizing_key,
        slot: r.slot,
        anchored: view.anchored,
    });

    Ok(view)
}

#[event]
pub struct ReceiptVerified {
    pub payload_hash: [u8; 32],
    pub authorizing_key: Pubkey,
    pub slot: u64,
    pub anchored: bool,
}

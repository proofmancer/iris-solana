use anchor_lang::prelude::*;

use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct IssueReceiptParams {
    pub action: [u8; 32],
    pub authorizing_key: Pubkey,
    pub payload_hash: [u8; 32],
}

#[derive(Accounts)]
#[instruction(params: IssueReceiptParams)]
pub struct IssueReceipt<'info> {
    #[account(mut)]
    pub relayer: Signer<'info>,

    #[account(
        init,
        payer = relayer,
        space = 8 + Receipt::INIT_SPACE,
        seeds = [RECEIPT_SEED, params.payload_hash.as_ref()],
        bump,
    )]
    pub receipt: Account<'info, Receipt>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<IssueReceipt>, params: IssueReceiptParams) -> Result<()> {
    let clock = Clock::get()?;
    let receipt = &mut ctx.accounts.receipt;

    receipt.version = RECEIPT_VERSION;
    receipt.action = params.action;
    receipt.authorizing_key = params.authorizing_key;
    receipt.relayer = ctx.accounts.relayer.key();
    receipt.payload_hash = params.payload_hash;
    receipt.timestamp = clock.unix_timestamp;
    receipt.slot = clock.slot;
    receipt.root_commit = None;
    receipt.bump = ctx.bumps.receipt;

    emit!(ReceiptIssued {
        payload_hash: params.payload_hash,
        authorizing_key: params.authorizing_key,
        relayer: receipt.relayer,
        action: params.action,
        slot: clock.slot,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

#[event]
pub struct ReceiptIssued {
    pub payload_hash: [u8; 32],
    pub authorizing_key: Pubkey,
    pub relayer: Pubkey,
    pub action: [u8; 32],
    pub slot: u64,
    pub timestamp: i64,
}

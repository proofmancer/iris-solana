use anchor_lang::prelude::*;

use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CommitRootParams {
    pub merkle_root: [u8; 32],
    pub da_pointer: [u8; 64],
    pub receipt_count: u32,
}

#[derive(Accounts)]
#[instruction(params: CommitRootParams)]
pub struct CommitRoot<'info> {
    #[account(mut)]
    pub relayer: Signer<'info>,

    #[account(
        init,
        payer = relayer,
        space = 8 + RootCommit::INIT_SPACE,
        seeds = [ROOT_SEED, params.merkle_root.as_ref()],
        bump,
    )]
    pub root_commit: Account<'info, RootCommit>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CommitRoot>, params: CommitRootParams) -> Result<()> {
    let clock = Clock::get()?;
    let root = &mut ctx.accounts.root_commit;

    root.merkle_root = params.merkle_root;
    root.da_pointer = params.da_pointer;
    root.receipt_count = params.receipt_count;
    root.committed_at = clock.unix_timestamp;
    root.committed_slot = clock.slot;
    root.relayer = ctx.accounts.relayer.key();
    root.bump = ctx.bumps.root_commit;

    emit!(RootCommitted {
        merkle_root: params.merkle_root,
        da_pointer: params.da_pointer,
        receipt_count: params.receipt_count,
        committed_at: clock.unix_timestamp,
        relayer: root.relayer,
    });

    Ok(())
}

#[event]
pub struct RootCommitted {
    pub merkle_root: [u8; 32],
    pub da_pointer: [u8; 64],
    pub receipt_count: u32,
    pub committed_at: i64,
    pub relayer: Pubkey,
}

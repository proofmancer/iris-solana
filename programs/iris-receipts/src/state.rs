use anchor_lang::prelude::*;

pub const RECEIPT_SEED: &[u8] = b"receipt";
pub const ROOT_SEED: &[u8] = b"root";

pub const RECEIPT_VERSION: u8 = 1;

#[account]
#[derive(InitSpace)]
pub struct Receipt {
    pub version: u8,
    pub action: [u8; 32],
    pub authorizing_key: Pubkey,
    pub relayer: Pubkey,
    pub payload_hash: [u8; 32],
    pub timestamp: i64,
    pub slot: u64,
    pub root_commit: Option<Pubkey>,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct RootCommit {
    pub merkle_root: [u8; 32],
    pub da_pointer: [u8; 64],
    pub receipt_count: u32,
    pub committed_at: i64,
    pub committed_slot: u64,
    pub relayer: Pubkey,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct AttestationView {
    pub action: [u8; 32],
    pub authorizing_key: Pubkey,
    pub relayer: Pubkey,
    pub payload_hash: [u8; 32],
    pub timestamp: i64,
    pub slot: u64,
    pub anchored: bool,
}

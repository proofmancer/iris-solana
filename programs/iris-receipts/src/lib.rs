use anchor_lang::prelude::*;

pub mod state;
pub mod error;
pub mod instructions;

pub use state::*;
pub use error::*;
use instructions::*;

declare_id!("6Sd4wz6XWU8wKQZjttw6g5uQEJMaf5Juv9gTuC2uXWHm");

#[program]
pub mod iris_receipts {
    use super::*;

    pub fn issue_receipt(
        ctx: Context<IssueReceipt>,
        params: IssueReceiptParams,
    ) -> Result<()> {
        instructions::issue_receipt::handler(ctx, params)
    }

    pub fn commit_root(
        ctx: Context<CommitRoot>,
        params: CommitRootParams,
    ) -> Result<()> {
        instructions::commit_root::handler(ctx, params)
    }

    pub fn verify_receipt(
        ctx: Context<VerifyReceipt>,
        expected_payload_hash: [u8; 32],
    ) -> Result<AttestationView> {
        instructions::verify_receipt::handler(ctx, expected_payload_hash)
    }
}

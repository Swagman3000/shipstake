use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use solana_security_txt::security_txt;

declare_id!("sBuf5eTY8MpC6DwErLYSYu9uwGLhwnU2kMRBeinN4KN");

// Replace these placeholders before any mainnet build. See the README checklist.
#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "Shipstake",
    project_url: "https://example.com/replace-before-mainnet",
    contacts: "link:https://example.com/replace-before-mainnet",
    policy: "https://example.com/replace-before-mainnet"
}

// `devnet-fast` shortens the timers so the full flow can be run by hand on
// devnet. It must never be enabled for a mainnet build.
#[cfg(not(feature = "devnet-fast"))]
pub const CHALLENGE_WINDOW: i64 = 72 * 60 * 60;
#[cfg(not(feature = "devnet-fast"))]
pub const REVIEW_WINDOW: i64 = 7 * 24 * 60 * 60;
#[cfg(not(feature = "devnet-fast"))]
pub const MIN_DURATION: i64 = 24 * 60 * 60;

#[cfg(feature = "devnet-fast")]
pub const CHALLENGE_WINDOW: i64 = 120;
#[cfg(feature = "devnet-fast")]
pub const REVIEW_WINDOW: i64 = 120;
#[cfg(feature = "devnet-fast")]
pub const MIN_DURATION: i64 = 60;

pub const MAX_DURATION: i64 = 366 * 24 * 60 * 60;
pub const MIN_STAKE: u64 = 10_000_000; // 0.01 SOL
pub const MIN_BACKING: u64 = 1_000_000; // 0.001 SOL

#[program]
pub mod shipstake {
    use super::*;

    /// Publishes a promise and locks the team's stake inside the promise account.
    pub fn create_promise(
        ctx: Context<CreatePromise>,
        id: u64,
        team_name: String,
        title: String,
        criteria: String,
        stake: u64,
        deadline: i64,
        reviewer: Pubkey,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let team = ctx.accounts.team.key();

        require!(!title.trim().is_empty(), ShipstakeError::EmptyText);
        require!(!criteria.trim().is_empty(), ShipstakeError::EmptyText);
        require!(!team_name.trim().is_empty(), ShipstakeError::EmptyText);
        require!(stake >= MIN_STAKE, ShipstakeError::StakeTooSmall);
        require!(deadline >= now + MIN_DURATION, ShipstakeError::DeadlineTooSoon);
        require!(deadline <= now + MAX_DURATION, ShipstakeError::DeadlineTooFar);
        require_keys_neq!(reviewer, team, ShipstakeError::TeamCannotReview);

        let profile = &mut ctx.accounts.profile;
        require_eq!(id, profile.promise_count, ShipstakeError::WrongPromiseId);
        profile.team = team;
        profile.name = team_name;
        profile.promise_count += 1;
        profile.total_staked = profile.total_staked.checked_add(stake).ok_or(ShipstakeError::Overflow)?;

        let promise = &mut ctx.accounts.promise;
        promise.team = team;
        promise.reviewer = reviewer;
        promise.id = id;
        promise.title = title;
        promise.criteria = criteria;
        promise.proof_uri = String::new();
        promise.stake = stake;
        promise.total_backed = 0;
        promise.backer_count = 0;
        promise.created_at = now;
        promise.backing_closes_at = now + (deadline - now) / 2;
        promise.deadline = deadline;
        promise.proof_at = 0;
        promise.challenge_ends_at = 0;
        promise.review_ends_at = 0;
        promise.challenger = Pubkey::default();
        promise.status = Status::Active;
        promise.stake_withdrawn = false;

        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.team.to_account_info(),
                    to: ctx.accounts.promise.to_account_info(),
                },
            ),
            stake,
        )
    }

    /// Deposits refundable SOL behind a promise. Open until halfway to the deadline.
    pub fn back(ctx: Context<Back>, amount: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let backer = ctx.accounts.backer.key();
        let promise = &mut ctx.accounts.promise;

        require!(promise.status == Status::Active, ShipstakeError::WrongStatus);
        require!(now <= promise.backing_closes_at, ShipstakeError::BackingClosed);
        require!(amount >= MIN_BACKING, ShipstakeError::BackingTooSmall);
        require_keys_neq!(backer, promise.team, ShipstakeError::TeamCannotBack);
        require_keys_neq!(backer, promise.reviewer, ShipstakeError::ReviewerCannotBack);

        let backing = &mut ctx.accounts.backing;
        if backing.amount == 0 {
            backing.promise = promise.key();
            backing.backer = backer;
            promise.backer_count += 1;
        }
        backing.amount = backing.amount.checked_add(amount).ok_or(ShipstakeError::Overflow)?;
        promise.total_backed = promise.total_backed.checked_add(amount).ok_or(ShipstakeError::Overflow)?;

        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.backer.to_account_info(),
                    to: ctx.accounts.promise.to_account_info(),
                },
            ),
            amount,
        )
    }

    /// The team posts proof of delivery, which opens the challenge window.
    pub fn post_proof(ctx: Context<PostProof>, proof_uri: String) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let promise = &mut ctx.accounts.promise;

        require!(promise.status == Status::Active, ShipstakeError::WrongStatus);
        require!(now <= promise.deadline, ShipstakeError::DeadlinePassed);
        require!(!proof_uri.trim().is_empty(), ShipstakeError::EmptyText);

        promise.proof_uri = proof_uri;
        promise.proof_at = now;
        promise.challenge_ends_at = now + CHALLENGE_WINDOW;
        promise.status = Status::ProofPosted;
        Ok(())
    }

    /// Any backer can dispute the proof during the challenge window.
    pub fn challenge(ctx: Context<Challenge>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let promise = &mut ctx.accounts.promise;

        require!(promise.status == Status::ProofPosted, ShipstakeError::WrongStatus);
        require!(now <= promise.challenge_ends_at, ShipstakeError::ChallengeClosed);

        promise.challenger = ctx.accounts.backer.key();
        promise.review_ends_at = now + REVIEW_WINDOW;
        promise.status = Status::Challenged;
        Ok(())
    }

    /// The named reviewer settles a challenged promise.
    pub fn rule(ctx: Context<Rule>, shipped: bool) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let promise = &mut ctx.accounts.promise;

        require!(promise.status == Status::Challenged, ShipstakeError::WrongStatus);
        require!(now <= promise.review_ends_at, ShipstakeError::ReviewClosed);

        settle(promise, &mut ctx.accounts.profile, shipped)
    }

    /// Anyone can settle a promise once its timer has run out:
    /// no proof by the deadline is a miss, an unchallenged proof is a delivery,
    /// and a reviewer who never rules counts against the team that named them.
    pub fn finalize(ctx: Context<Finalize>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let promise = &mut ctx.accounts.promise;

        let shipped = match promise.status {
            Status::Active if now > promise.deadline => false,
            Status::ProofPosted if now > promise.challenge_ends_at => true,
            Status::Challenged if now > promise.review_ends_at => false,
            Status::Active | Status::ProofPosted | Status::Challenged => {
                return err!(ShipstakeError::TooEarly)
            }
            _ => return err!(ShipstakeError::WrongStatus),
        };

        settle(promise, &mut ctx.accounts.profile, shipped)
    }

    /// Returns the stake to the team after a delivery. A missed promise with
    /// no backers also refunds, because nobody is owed the money.
    pub fn withdraw_stake(ctx: Context<WithdrawStake>) -> Result<()> {
        let promise = &mut ctx.accounts.promise;

        let refundable = promise.status == Status::Shipped
            || (promise.status == Status::Missed && promise.total_backed == 0);
        require!(refundable, ShipstakeError::WrongStatus);
        require!(!promise.stake_withdrawn, ShipstakeError::AlreadyWithdrawn);

        promise.stake_withdrawn = true;
        let stake = promise.stake;
        promise.sub_lamports(stake)?;
        ctx.accounts.team.add_lamports(stake)?;
        Ok(())
    }

    /// Returns a backer's deposit after settlement, plus their pro-rata share
    /// of the stake if the team missed. Closing the account blocks a second claim.
    pub fn claim_backing(ctx: Context<ClaimBacking>) -> Result<()> {
        let promise = &mut ctx.accounts.promise;
        let amount = ctx.accounts.backing.amount;

        let share = match promise.status {
            Status::Shipped => 0,
            Status::Missed => u64::try_from(
                (promise.stake as u128) * (amount as u128) / (promise.total_backed as u128),
            )
            .map_err(|_| ShipstakeError::Overflow)?,
            _ => return err!(ShipstakeError::WrongStatus),
        };

        let payout = amount.checked_add(share).ok_or(ShipstakeError::Overflow)?;
        promise.sub_lamports(payout)?;
        ctx.accounts.backer.add_lamports(payout)?;
        Ok(())
    }
}

fn settle(promise: &mut Account<PromiseAccount>, profile: &mut Account<TeamProfile>, shipped: bool) -> Result<()> {
    if shipped {
        promise.status = Status::Shipped;
        profile.shipped_count += 1;
    } else {
        promise.status = Status::Missed;
        profile.missed_count += 1;
        if promise.total_backed > 0 {
            profile.total_lost = profile.total_lost.checked_add(promise.stake).ok_or(ShipstakeError::Overflow)?;
        }
    }
    Ok(())
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CreatePromise<'info> {
    #[account(mut)]
    pub team: Signer<'info>,
    #[account(
        init_if_needed,
        payer = team,
        space = 8 + TeamProfile::INIT_SPACE,
        seeds = [b"team", team.key().as_ref()],
        bump
    )]
    pub profile: Account<'info, TeamProfile>,
    #[account(
        init,
        payer = team,
        space = 8 + PromiseAccount::INIT_SPACE,
        seeds = [b"promise", team.key().as_ref(), &id.to_le_bytes()],
        bump
    )]
    pub promise: Account<'info, PromiseAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Back<'info> {
    #[account(mut)]
    pub backer: Signer<'info>,
    #[account(mut)]
    pub promise: Account<'info, PromiseAccount>,
    #[account(
        init_if_needed,
        payer = backer,
        space = 8 + Backing::INIT_SPACE,
        seeds = [b"backing", promise.key().as_ref(), backer.key().as_ref()],
        bump
    )]
    pub backing: Account<'info, Backing>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PostProof<'info> {
    pub team: Signer<'info>,
    #[account(mut, has_one = team)]
    pub promise: Account<'info, PromiseAccount>,
}

#[derive(Accounts)]
pub struct Challenge<'info> {
    pub backer: Signer<'info>,
    #[account(mut)]
    pub promise: Account<'info, PromiseAccount>,
    #[account(
        seeds = [b"backing", promise.key().as_ref(), backer.key().as_ref()],
        bump,
        has_one = promise,
        has_one = backer
    )]
    pub backing: Account<'info, Backing>,
}

#[derive(Accounts)]
pub struct Rule<'info> {
    pub reviewer: Signer<'info>,
    #[account(mut, has_one = reviewer)]
    pub promise: Account<'info, PromiseAccount>,
    #[account(mut, seeds = [b"team", promise.team.as_ref()], bump)]
    pub profile: Account<'info, TeamProfile>,
}

#[derive(Accounts)]
pub struct Finalize<'info> {
    #[account(mut)]
    pub promise: Account<'info, PromiseAccount>,
    #[account(mut, seeds = [b"team", promise.team.as_ref()], bump)]
    pub profile: Account<'info, TeamProfile>,
}

#[derive(Accounts)]
pub struct WithdrawStake<'info> {
    #[account(mut)]
    pub team: Signer<'info>,
    #[account(mut, has_one = team)]
    pub promise: Account<'info, PromiseAccount>,
}

#[derive(Accounts)]
pub struct ClaimBacking<'info> {
    #[account(mut)]
    pub backer: Signer<'info>,
    #[account(mut)]
    pub promise: Account<'info, PromiseAccount>,
    #[account(
        mut,
        close = backer,
        seeds = [b"backing", promise.key().as_ref(), backer.key().as_ref()],
        bump,
        has_one = promise,
        has_one = backer
    )]
    pub backing: Account<'info, Backing>,
}

#[account]
#[derive(InitSpace)]
pub struct TeamProfile {
    pub team: Pubkey,
    #[max_len(40)]
    pub name: String,
    pub promise_count: u64,
    pub shipped_count: u64,
    pub missed_count: u64,
    pub total_staked: u64,
    pub total_lost: u64,
}

// Promise accounts are never closed, so a team's history stays on-chain.
#[account]
#[derive(InitSpace)]
pub struct PromiseAccount {
    pub team: Pubkey,
    pub reviewer: Pubkey,
    pub id: u64,
    #[max_len(120)]
    pub title: String,
    #[max_len(280)]
    pub criteria: String,
    #[max_len(200)]
    pub proof_uri: String,
    pub stake: u64,
    pub total_backed: u64,
    pub backer_count: u32,
    pub created_at: i64,
    pub backing_closes_at: i64,
    pub deadline: i64,
    pub proof_at: i64,
    pub challenge_ends_at: i64,
    pub review_ends_at: i64,
    pub challenger: Pubkey,
    pub status: Status,
    pub stake_withdrawn: bool,
}

#[account]
#[derive(InitSpace)]
pub struct Backing {
    pub promise: Pubkey,
    pub backer: Pubkey,
    pub amount: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Status {
    Active,
    ProofPosted,
    Challenged,
    Shipped,
    Missed,
}

#[error_code]
pub enum ShipstakeError {
    #[msg("Text fields can't be empty")]
    EmptyText,
    #[msg("The stake is below the minimum of 0.01 SOL")]
    StakeTooSmall,
    #[msg("The deadline is too soon")]
    DeadlineTooSoon,
    #[msg("The deadline is more than a year away")]
    DeadlineTooFar,
    #[msg("A team can't review its own promise")]
    TeamCannotReview,
    #[msg("Promise id doesn't match this team's next id")]
    WrongPromiseId,
    #[msg("This action isn't allowed at the promise's current stage")]
    WrongStatus,
    #[msg("Backing closed halfway to the deadline")]
    BackingClosed,
    #[msg("The backing is below the minimum of 0.001 SOL")]
    BackingTooSmall,
    #[msg("A team can't back its own promise")]
    TeamCannotBack,
    #[msg("The reviewer can't back a promise they review")]
    ReviewerCannotBack,
    #[msg("The deadline has passed")]
    DeadlinePassed,
    #[msg("The challenge window has closed")]
    ChallengeClosed,
    #[msg("The review window has closed")]
    ReviewClosed,
    #[msg("This promise can't be settled yet")]
    TooEarly,
    #[msg("The stake has already been withdrawn")]
    AlreadyWithdrawn,
    #[msg("Number overflow")]
    Overflow,
}

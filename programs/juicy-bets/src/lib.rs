use anchor_lang::prelude::*;
use anchor_lang::prelude::program;
use anchor_lang::prelude::Rent;
use anchor_lang::solana_program::system_program;

declare_id!("CYpwqMgesShNFYrkLzpHC3NmaWqAXkiRZihAgekb535w");

// TODO:
// Figure out where to put Juiced Dev take rate: 2%

const TAKE_RATE: f64  = 1.02;


#[program]
pub mod juicy_bets {
    use super::*;

    // *** Betting Functionality *** //

    // TODO: Bet state should be initialized every market close 
    // Endpoint that will initialize a bet state
    pub fn initialize_bet_state(
        ctx: Context<InitializeBetState>,
        start: u64,
        duration: u64,
        symbol: String,
        snapshot_price: u128,
        bet_range: u8,
    ) -> Result<()> {
        let bet_state = &mut ctx.accounts.bet_state;
        let bet_creator = &mut ctx.accounts.bet_creator;

        bet_state.symbol = symbol;
        bet_state.creator = bet_creator.key();
        bet_state.running_total_pool = 0;
        bet_state.static_total_pool = 0;
        bet_state.party_one_pool = 0;
        bet_state.party_two_pool = 0;
        bet_state.bet_outcome = BetOutcomeStatus::Undecided;
        bet_state.status = BetStateStatus::Open;
        bet_state.start_time = start;
        bet_state.end_time = start + duration;

        bet_state.snapshot_price = snapshot_price;

        match bet_range {
            0 => { bet_state.bet_range = BetRange::NegativeThreeAndOver },
            1 => { bet_state.bet_range = BetRange::NegativeTwoToThree },
            2 => { bet_state.bet_range = BetRange::NegativeOneToTwo },
            3 => { bet_state.bet_range = BetRange::NegativeOneToZero },
            4 => { bet_state.bet_range = BetRange::ZeroToPositiveOne },
            5 => { bet_state.bet_range = BetRange::PositiveOneToTwo },
            6 => { bet_state.bet_range = BetRange::PositiveTwoToThree },
            7 => { bet_state.bet_range = BetRange::PositiveThreeAndOver },
            _ => { return Err(error!(ErrorCode::InvalidBetRange)); }
        };

        Ok(())
    }

    // Endpoint that allows a user to place a wager on a bet state
    pub fn place_wager(
        ctx: Context<PlaceWager>,
        party: u8,
        lamports: u64,
    ) -> Result<()> {

        let bet_state = &mut ctx.accounts.bet_state;
        let wager_detail = &mut ctx.accounts.wager_detail;
        let user_account = &mut ctx.accounts.user_account;
        let bettor = &mut ctx.accounts.bettor_account;
        // let bet_creator = &mut ctx.accounts.bet_creator;

        // separate take rate from actual wager
        let wager_amount_float = lamports as f64 / TAKE_RATE;
        let wager_amount_int = wager_amount_float as u64;

        // grab the take rate from actual wager
        let take_rate_amount_int = lamports - wager_amount_int;
        
        // add lamport amount to the static total pool and running_total_pool
        bet_state.static_total_pool += wager_amount_int;
        bet_state.running_total_pool += wager_amount_int;
        
        // update the BetterDetail obj
        wager_detail.bet_value = wager_amount_int;
        wager_detail.bet_state = bet_state.key();
        wager_detail.bettor = bettor.key();

        // based on which party the bet is placed, assign correct PartyStatus and correct amount of lamports to correct party on BetState type
        if party == 1 {
            wager_detail.party = PartyStatus::PartyOne;
            bet_state.party_one_pool += wager_amount_int;
        } else if party == 2 {
            wager_detail.party = PartyStatus::PartyTwo;
            bet_state.party_two_pool += wager_amount_int;
        } else {
            return Err(error!(ErrorCode::InvalidParty));
        }
        
        // add the bet to the user account
        user_account.active_wagers.push(wager_detail.key());
        user_account.current_balance -= lamports;

        // Transfer actual wager lamport amount from user account into bet state wallet
        **user_account.to_account_info().try_borrow_mut_lamports()? = user_account.to_account_info().lamports().checked_sub(wager_amount_int).ok_or(ProgramError::InvalidArgument)?;
        **bet_state.to_account_info().try_borrow_mut_lamports()? = bet_state.to_account_info().lamports().checked_add(wager_amount_int).ok_or(ProgramError::InvalidArgument)?;

        // Transfer take fee lamport amount from user account into bet creator wallet
        // **user_account.to_account_info().try_borrow_mut_lamports()? = user_account.to_account_info().lamports().checked_sub(take_rate_amount_int).ok_or(ProgramError::InvalidArgument)?;
        // **bet_creator.to_account_info().try_borrow_mut_lamports()? = bet_creator.to_account_info().lamports().checked_add(take_rate_amount_int).ok_or(ProgramError::InvalidArgument)?;

        Ok(())
    }

    // Endpoint that allows a user to cancel their wager on a bet state if its still in an open and undecided state
    pub fn cancel_wager(ctx:Context<CancelWager>) -> Result<()> { 

        // Pull the respective accounts involved in this instruction
        let bet_state = &mut ctx.accounts.bet_state;
        let wager_detail = &mut ctx.accounts.wager_detail;
        let user_account = &mut ctx.accounts.user_account;

        // Grab bettor details bet value
        let bet_value_from_wager_detail = wager_detail.bet_value;

        // Subtract the user's bet amount from the total pool
        bet_state.static_total_pool -= bet_value_from_wager_detail;
        bet_state.running_total_pool -= bet_value_from_wager_detail;
        
        // Subtract the user's bet amount from the respective party's pool
        match wager_detail.party {
            PartyStatus::PartyOne => bet_state.party_one_pool -= bet_value_from_wager_detail,
            PartyStatus::PartyTwo => bet_state.party_two_pool -= bet_value_from_wager_detail
        }

        // iterate through the user accounts bets and find the matching bet
        if let Some(keypos) = user_account.active_wagers.iter().position(|x| *x == wager_detail.key()) {
            user_account.active_wagers.remove(keypos);
        } else {
            return Err(error!(ErrorCode::ActiveWagerNotFound));
        }

        // Add back to user account balance
        user_account.current_balance += bet_value_from_wager_detail as u64;

        **bet_state.to_account_info().try_borrow_mut_lamports()? = bet_state.to_account_info().lamports().checked_sub(bet_value_from_wager_detail as u64).ok_or(ProgramError::InvalidArgument)?;
        **user_account.to_account_info().try_borrow_mut_lamports()? = user_account.to_account_info().lamports().checked_add(bet_value_from_wager_detail as u64).ok_or(ProgramError::InvalidArgument)?;

        Ok(()) 
    }

    // Endpoint that allows a user to claim their winnings from a bet state given that the bet is closed and a winner is decided
    pub fn claim_winnings(ctx:Context<ClaimWinnings>, winnings_amount: u64) -> Result<()> { 

        let bet_state = &mut ctx.accounts.bet_state;
        let wager_detail = &mut ctx. accounts.wager_detail;
        let user_account = &mut ctx.accounts.user_account;
        
        // Make the lamport credit and debit
        if bet_state.bet_outcome == BetOutcomeStatus::PartyOneWin && wager_detail.party == PartyStatus::PartyOne {
            // Transfer winnings amount from bet state to bettor
            **bet_state.to_account_info().try_borrow_mut_lamports()? = bet_state.to_account_info().lamports().checked_sub(winnings_amount).ok_or(ProgramError::InvalidArgument)?;
            **user_account.to_account_info().try_borrow_mut_lamports()? = user_account.to_account_info().lamports().checked_add(winnings_amount).ok_or(ProgramError::InvalidArgument)?;
            bet_state.running_total_pool -= winnings_amount;
        } else if bet_state.bet_outcome == BetOutcomeStatus::PartyTwoWin && wager_detail.party == PartyStatus::PartyTwo {
            // Transfer winnings amount from bet state to bettor
            **bet_state.to_account_info().try_borrow_mut_lamports()? = bet_state.to_account_info().lamports().checked_sub(winnings_amount).ok_or(ProgramError::InvalidArgument)?;
            **user_account.to_account_info().try_borrow_mut_lamports()? = user_account.to_account_info().lamports().checked_add(winnings_amount).ok_or(ProgramError::InvalidArgument)?;
            bet_state.running_total_pool -= winnings_amount;
        } else {
            return Err(error!(ErrorCode::NonWinningParty));
        }

        // iterate through the user accounts bets and find the matching bet
        // TODO: Test this works
        if let Some(keypos) = user_account.active_wagers.iter().position(|x| *x == wager_detail.key()) {
            user_account.active_wagers.remove(keypos);
        } else {
            return Err(error!(ErrorCode::ActiveWagerNotFound));
        }

        // Add the winning lamports to the user's account balance
        user_account.current_balance += winnings_amount;

        Ok(())
    }

    // Endpoint that allows the app to close a bet once the betting time (end date - start date) has elapsed
    pub fn close_bet_state(
        ctx:Context<CloseBetState>, 
        end: u64
    ) -> Result<()> { 

        let bet_state = &mut ctx.accounts.bet_state;

        bet_state.end_time = end;
        bet_state.status = BetStateStatus::Closed;

        Ok(()) 
    }

    // Endpoint that allows a user to cancel a bet state they created
    pub fn cancel_bet_state(ctx:Context<CancelBetState>) -> Result<()> { 

        let bet_state = &mut ctx.accounts.bet_state;

        if bet_state.running_total_pool != 0 {
            return Err(error!(ErrorCode::FundsStillInPlay))
        }

        // Do we wanna only close the bet if there aren't any active bets except the initiating bettor's?
        Ok(()) 
    }

    // Endpoint that will determine who won the bet, either Party 1 or Party 2, mutating the bet_outcome field
    pub fn decide_bet_state_outcome(ctx:Context<DecideBetState>, outcome: u8) -> Result<()> { 

        let bet_state = &mut ctx.accounts.bet_state;

        match outcome {
            1 => { bet_state.bet_outcome = BetOutcomeStatus::PartyOneWin },
            2 => { bet_state.bet_outcome = BetOutcomeStatus::PartyTwoWin },
            _ => { return Err(error!(ErrorCode::InvalidBetOutcome)); }
        };

        Ok(()) 
    }

    // Endpoint that will put the bet state into a "settled" state, all winnings have been claimed and the bet state account is ready to be closed
    pub fn settle_bet_state(ctx: Context<SettleBetState>) -> Result<()> {

        let bet_state = &mut ctx.accounts.bet_state;

        if bet_state.running_total_pool != 0 {
            return Err(error!(ErrorCode::FundsStillInPlay));
        }

        Ok(())
    }


    // *** User Account Functionality *** //
    pub fn initialize_user_account(ctx: Context<InitializeUserAccount>) -> Result<()> {

        let user_account = &mut ctx.accounts.user_account;
        let account_owner = &mut ctx.accounts.account_owner;

        user_account.account_owner = account_owner.key();
        user_account.wins = 0;
        user_account.losses = 0;
        user_account.current_balance = 0;

        Ok(())
    }

    pub fn close_user_account(_ctx: Context<CloseUserAccount>) -> Result<()> {
        Ok(())
    }

    pub fn deposit_into_account(ctx: Context<DepositIntoAccount>, lamports: u64) -> Result<()> {

        let user_account = &mut ctx.accounts.user_account;

        user_account.current_balance += lamports;

        Ok(())
    }

    // TODO: Test this function
    pub fn withdraw_from_account(ctx: Context<WithdrawFromAccount>, lamports: u64) -> Result<()> {

        let user_account = &mut ctx.accounts.user_account;
        let account_owner = &mut ctx.accounts.account_owner;

        user_account.current_balance.checked_sub(lamports).ok_or(ErrorCode::InvalidWithdrawalAmount)?;

        user_account.current_balance -= lamports;

        **user_account.to_account_info().try_borrow_mut_lamports()? = user_account.to_account_info().lamports().checked_sub(lamports).ok_or(ProgramError::InvalidArgument)?;
        **account_owner.to_account_info().try_borrow_mut_lamports()? = account_owner.to_account_info().lamports().checked_add(lamports).ok_or(ProgramError::InvalidArgument)?;

        Ok(())
    }

}


// ***** BETTING FUNCTIONALITY CONTEXT AND STRUCTS ***** //
// Adding an account on a context simply means its public key should be provided when sending the instruction

// Context to initialize the bet state
#[derive(Accounts)]
pub struct InitializeBetState<'info> {

    #[account(init, payer = bet_creator, space = BetState::MAX_SIZE + 8)]
    bet_state: Account<'info, BetState>,

    /// CHECK: Used to pay for the bet state account
    #[account(signer, mut)]
    bet_creator: AccountInfo<'info>,

    /// CHECK: Not read from or written to
    #[account(address = system_program::ID)]
    pub system_program: AccountInfo<'info>,

}

// Context to place a wager on a created bet 
#[derive(Accounts)]
pub struct PlaceWager<'info> {

    #[account(
        constraint = bet_state.status == BetStateStatus::Open @ ErrorCode::BetIsClosedOrSettled,
        constraint = bet_state.bet_outcome == BetOutcomeStatus::Undecided @ ErrorCode::BetAlreadyDecided,
        mut
    )]
    bet_state: Account<'info, BetState>,

    #[account(init, payer = bettor_account, space = WagerDetail::MAX_SIZE + 8)]
    wager_detail: Account<'info, WagerDetail>,

    #[account(
        mut,
        constraint = user_account.account_owner == bettor_account.key() @ ErrorCode::NotAccountOwnerToPlaceWager,
    )]
    user_account: Account<'info, UserAccount>,

    /// CHECK: Used to pay for the wager detail account
    #[account(signer, mut)]
    bettor_account: AccountInfo<'info>,

    /// CHECK: Used to credit bet manager wallet with take rate
    // #[account(mut)]
    // bet_creator: AccountInfo<'info>,

    /// CHECK: Not read from or written to
    #[account(address = system_program::ID)]
    system_program: AccountInfo<'info>,
}

// Context to cancel a wager on a created bet
#[derive(Accounts)]
pub struct CancelWager<'info> {

    #[account(
        constraint = bet_state.status == BetStateStatus::Open @ ErrorCode::BetIsClosedOrSettled,
        constraint = bet_state.bet_outcome == BetOutcomeStatus::Undecided @ ErrorCode::BetAlreadyDecided,
        mut,
    )]
    bet_state: Account<'info, BetState>,

    #[account(
        constraint = wager_detail.bettor == bettor.key(),
        mut, 
        close = bettor,
    )]
    wager_detail: Account<'info, WagerDetail>,

    #[account(
        mut,
        constraint = user_account.account_owner == bettor.key() @ ErrorCode::NotAccountOwnerToPlaceWager,
        constraint = user_account.active_wagers.len() > 0 @ ErrorCode::ActiveWagersEmpty,
    )]
    user_account: Account<'info, UserAccount>,

    /// CHECK: Used to cancel the wager it owns
    #[account(signer, mut)]
    bettor: AccountInfo<'info>
}

// Context to claim winnings from a closed bet with a decided outcome
#[derive(Accounts)]
pub struct ClaimWinnings<'info> {

    #[account(
        constraint = bet_state.status == BetStateStatus::Closed @ ErrorCode::BetStillOpen,
        constraint = bet_state.bet_outcome != BetOutcomeStatus::Undecided @ ErrorCode::BetStillUndecided,
        mut
    )]
    bet_state: Account<'info, BetState>,

    #[account(
        has_one = bet_state, 
        has_one = bettor,
        constraint = wager_detail.bettor == bettor.key() @ ErrorCode::NotAccountOwnerToClaimWinnings,
        mut,
        close = bettor
    )]
    wager_detail: Account<'info, WagerDetail>,

    #[account(
        mut,
        constraint = user_account.account_owner == bettor.key() @ ErrorCode::NotAccountOwnerToClaimWinnings,
        constraint = user_account.active_wagers.len() > 0 @ ErrorCode::ActiveWagersEmpty,
    )]
    user_account: Account<'info, UserAccount>,

    /// CHECK: Used to pay for the bet state account
    #[account(signer, mut)]
    bettor: AccountInfo<'info>,
}

// Context for bet creator to cancel a bet when it's empty
#[derive(Accounts)]
pub struct CancelBetState<'info>{
    #[account(
        constraint = bet_state.status == BetStateStatus::Open @ ErrorCode::BetIsClosedOrSettled,
        constraint = bet_state.bet_outcome == BetOutcomeStatus::Undecided @ ErrorCode::BetAlreadyDecided,
        constraint = bet_state.creator == bettor.key() @ ErrorCode::NotBetCreator,
        constraint = bet_state.running_total_pool == 0 @ ErrorCode::FundsStillInPlay,
        mut,
        close = bettor
    )]
    bet_state: Account<'info, BetState>,

    /// CHECK: Used to cancel a wager
    #[account(signer, mut)]
    bettor: AccountInfo<'info>

}

// Context for closing a bet before the actual event takes place
#[derive(Accounts)]
pub struct CloseBetState<'info> {
    #[account(
        constraint = bet_state.creator == bet_creator.key() @ ErrorCode::NotBetCreator,
        constraint = bet_state.status == BetStateStatus::Open @ ErrorCode::BetIsClosedOrSettled,
        constraint = bet_state.bet_outcome == BetOutcomeStatus::Undecided @ ErrorCode::BetAlreadyDecided,
        mut
    )]
    bet_state: Account<'info, BetState>,

    /// CHECK: Not written to
    #[account()]
    bet_creator: AccountInfo<'info>
    
}

// General context for a closed bet state
#[derive(Accounts)]
pub struct DecideBetState<'info> {
    #[account(
        constraint = bet_state.creator == bet_creator.key() @ ErrorCode::NotBetCreator,
        constraint = bet_state.status == BetStateStatus::Closed @ ErrorCode::BetStillOpen,
        constraint = bet_state.bet_outcome == BetOutcomeStatus::Undecided @ ErrorCode::BetAlreadyDecided,
        mut
    )]
    bet_state: Account<'info, BetState>,

    /// CHECK: Not written to
    #[account()]
    bet_creator: AccountInfo<'info>
}

// General context for a closed and settled bet state
#[derive(Accounts)]
pub struct SettleBetState<'info> {
    #[account(
        constraint = bet_state.status == BetStateStatus::Closed @ ErrorCode::BetStillOpen,
        constraint = (
            bet_state.bet_outcome == BetOutcomeStatus::PartyOneWin || bet_state.bet_outcome == BetOutcomeStatus::PartyTwoWin
        ) @ ErrorCode::BetStillUndecided,
        constraint = bet_state.creator == bet_creator.key() @ ErrorCode::NotBetCreator,
        mut,
        close = bet_creator
    )]
    bet_state: Account<'info, BetState>,

    /// CHECK: Not written to
    #[account()]
    bet_creator: AccountInfo<'info>
}


// ** Betting Related Types ** //
// TODO: Incorporate more info about the pyth data
// TODO: Implement a PDA for this account
#[account]
pub struct BetState {
    pub symbol: String, // 14
    pub creator: Pubkey, //32
    pub running_total_pool: u64, // 8
    pub static_total_pool: u64, // 8
    pub party_one_pool: u64, // 8
    pub party_two_pool: u64, // 8
    pub start_price: u64, // 8
    pub bet_outcome: BetOutcomeStatus, // 33
    pub status: BetStateStatus, // 33
    pub start_time: u64, // 8
    pub end_time: u64, // 8

    pub snapshot_price: u128, //16
    pub bet_range: BetRange //33
}

impl BetState {
    const MAX_SIZE: usize = 220;
}

#[account]
pub struct WagerDetail {
    pub bettor: Pubkey, // 32
    pub bet_state: Pubkey, // 32
    pub party: PartyStatus, // 33
    pub bet_value: u64, // 8
}

impl WagerDetail {
    const MAX_SIZE: usize = 105;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Copy, Debug)]
pub enum BetOutcomeStatus {
    Undecided,
    PartyOneWin,
    PartyTwoWin,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Copy, Debug)]
pub enum PartyStatus {
    PartyOne,
    PartyTwo,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Copy, Debug)]
pub enum BetStateStatus {
    Open,
    Closed,
    Settled
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Copy, Debug)]
pub enum BetRange {
    NegativeThreeAndOver,
    NegativeTwoToThree,
    NegativeOneToTwo,
    NegativeOneToZero,
    ZeroToPositiveOne,
    PositiveOneToTwo,
    PositiveTwoToThree,
    PositiveThreeAndOver
}


// ***** IN-APP USER ACCOUNT FUNCTIONALITY CONTEXT AND STRUCTS ***** //

#[derive(Accounts)]
pub struct InitializeUserAccount<'info> {
    #[account(init, payer = account_owner, space = UserAccount::MAX_SIZE + 8)]
    user_account: Account<'info, UserAccount>,

    /// CHECK: Used to create a user account
    #[account(mut)]
    account_owner: Signer<'info>,

    /// CHECK: Not read from or written to
    #[account(address = system_program::ID)]
    pub system_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct CloseUserAccount<'info> {
    #[account(
        mut, 
        constraint = user_account.account_owner == account_owner.key() @ ErrorCode::InvalidAccountOwner,
        constraint = user_account.current_balance == 0 @ ErrorCode::AccountBalanceNotEmpty,
        close = account_owner)]
    user_account: Account<'info, UserAccount>,

    /// CHECK: Used to close account
    #[account(mut)]
    account_owner: Signer<'info>
}

#[derive(Accounts)]
pub struct DepositIntoAccount<'info> {
    #[account(
        mut,
        constraint = user_account.account_owner == account_owner.key() @ ErrorCode::InvalidAccountOwner,
    )]
    user_account: Account<'info, UserAccount>,

    /// CHECK: used to deposit funds into user account
    #[account(mut)]
    account_owner: Signer<'info>
}

#[derive(Accounts)]
pub struct WithdrawFromAccount<'info> {
    #[account(
        mut,
        constraint = user_account.account_owner == account_owner.key() @ ErrorCode::InvalidAccountOwner,
        constraint = user_account.current_balance > 0 @ ErrorCode::CannotWithdrawFromEmptyAccount,
    )]
    user_account: Account<'info, UserAccount>,

    /// CHECK: used to withdraw funds from user account
    #[account(mut)]
    account_owner: Signer<'info>
}

#[account]
pub struct UserAccount {
    pub account_owner: Pubkey, //32
    pub wins: u64, //8
    pub losses: u64, //8
    pub active_wagers: Vec<Pubkey>, //4 + (32 * 5),
    pub current_balance: u64, //8
}

impl UserAccount {
    const MAX_SIZE: usize = 220;
}


// ***** Errors ***** //
//TODO: Implement erors for user account constraints

#[error_code]
pub enum ErrorCode {

    // Betting Errors
    #[msg("You are not the creator of this bet")]
    InvalidBetCreator,
    #[msg("The given value is not a valid party number entry.")]
    InvalidParty,
    #[msg("The given value is not a valid outcome for the bet.")]
    InvalidBetOutcome,
    #[msg("The given value is not a valid bet range entry")]
    InvalidBetRange,
    #[msg("Cannot carry out this action. You are not a part of the winning party for this bet.")]
    NonWinningParty,
    #[msg("Cannot carry out this action until all funds are withdrawn.")]
    FundsStillInPlay,
    #[msg("Cannot carry out this action while the bet is still open.")]
    BetStillOpen,
    #[msg("Cannot carry out this action while the bet is still undecided on a winner.")]
    BetStillUndecided,
    #[msg("Cannot carry out this action when bet's outcome has already been decided.")]
    BetAlreadyDecided,
    #[msg("Cannot carry out this action. You are not the creator of this bet.")]
    NotBetCreator,
    #[msg("Cannot carry out this action when the bet is closed or is already settled.")]
    BetIsClosedOrSettled,
    #[msg("You cannot place a wager from this account because you are not the account owner.")]
    NotAccountOwnerToPlaceWager,
    #[msg("You cannot claim winnings for this account because you are not the account owner.")]
    NotAccountOwnerToClaimWinnings,
    #[msg("Could not find that wager within your list of active wagers.")]
    ActiveWagerNotFound,
    #[msg("You do not have any active bets open.")]
    ActiveWagersEmpty,

    // User Account Errors
    #[msg("You are not the creator of this account.")]
    InvalidAccountOwner,
    #[msg("You must withdraw all of your betting funds to close your account.")]
    AccountBalanceNotEmpty,
    #[msg("Invalid desposit amount.")]
    InvalidDepositAmount,
    #[msg("Invalid withdrawal amount.")]
    InvalidWithdrawalAmount,
    #[msg("Cannot withdraw from an empty account.")]
    CannotWithdrawFromEmptyAccount,

}

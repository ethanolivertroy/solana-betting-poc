import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import { LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { JuicyBets } from '../target/types/juicy_bets';
import assert from 'assert';
import { 
  calculateWinnings,
  findWagerForUser,
  matchingWagerFound
} from '../app/utils'

describe('juicy-bets', () => {

  // calls the anchor.Provider.env() method to generate a new Provider for us using our Anchor.toml config file
  // (it pulls from everything under the [provider] tag)
  // Cluster + Wallet = Provider
  anchor.setProvider(anchor.Provider.env()); 

  // Use that registered provider to create a new Program object that we can use in our tests
  const program = anchor.workspace.JuicyBets as Program<JuicyBets>;

  const providerWallet = program.provider.wallet

  const JUICED_BETS_TAKE_RATE = 1.02

  const TICKERS = ["TSLA/USD", "SPY/USD", "AAPL/USD"];


  // E2E Betting Tests //

  it.skip('Initialize a Bet, Place a Wager, and Cancel a Wager', async () => {

    ///// ***** INITIALIZE BET FUNCTIONALITY ***** /////

    // Generate a new random keypair for betState
    const betStateKP = anchor.web3.Keypair.generate();
    const tradingPair = TICKERS[0];

    const start = new anchor.BN(Date.now());
    const duration = new anchor.BN(5 * 60 * 1000);

    console.log("Starting the 'initialize bet state' functionality...");

    await program.rpc.initializeBetState(
      start,
      duration,
      tradingPair,
      {
        accounts: {
          betState: betStateKP.publicKey,
          betCreator: providerWallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId
        },
        signers:[betStateKP]
      },
    )

    let betStateAccount = await program.account.betState.fetch(betStateKP.publicKey);

    console.log(`${JSON.stringify(betStateAccount)}`);

    assert.ok(betStateAccount);
    assert.ok(betStateAccount.staticTotalPool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.runningTotalPool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.partyOnePool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.partyTwoPool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.status.hasOwnProperty("open"));
    assert.ok(betStateAccount.betOutcome.hasOwnProperty("undecided"));




    // ///// ***** USER CREATES ACCOUNT ***** /////

    const bettorKP = anchor.web3.Keypair.generate();
    const bettor_airdrop_sig = await program.provider.connection.requestAirdrop(bettorKP.publicKey, 2000000000)
    await program.provider.connection.confirmTransaction(bettor_airdrop_sig, "finalized");

    const userAccountKP = anchor.web3.Keypair.generate();

    console.log("Starting the 'initialize user account' functionality...");

    await program.rpc.initializeUserAccount({
      accounts: {
        userAccount: userAccountKP.publicKey,
        accountOwner: bettorKP.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId
      },
      signers: [bettorKP, userAccountKP]
    })

    const userAccount = await program.account.userAccount.fetch(userAccountKP.publicKey);

    assert.ok(userAccount);
    console.log(`Bettor 1 User Account: ${JSON.stringify(userAccount)}`);
    assert.equal(userAccount.currentBalance.toNumber(), 0)
    assert.equal(userAccount.wins.toNumber(), 0)
    assert.equal(userAccount.losses.toNumber(), 0)




    ///// ***** USER DEPOSITS LAMPORTS INTO USER ACCOUNT ***** /////

    const lamports_to_deposit_num = LAMPORTS_PER_SOL * 1
    const lamports_to_deposit = new anchor.BN(LAMPORTS_PER_SOL * 1);

    console.log("Starting the 'deposit into user account' functionality...");

    await program.rpc.depositIntoAccount(lamports_to_deposit, {
      accounts: {
        userAccount: userAccountKP.publicKey,
        accountOwner: bettorKP.publicKey
      },
      preInstructions: [
        await SystemProgram.transfer({
          fromPubkey: bettorKP.publicKey,
          lamports: lamports_to_deposit_num,
          toPubkey: userAccountKP.publicKey
        })
      ],
      signers:[userAccountKP, bettorKP]
    })

    const userAccountAfterDeposit = await program.account.userAccount.fetch(userAccountKP.publicKey);

    console.log(`Bettor 1 User Account After 1 Sol Deposit: ${JSON.stringify(userAccountAfterDeposit)}`);
    assert.equal(userAccountAfterDeposit.currentBalance.toNumber(), 1000000000);
    assert.equal(userAccountAfterDeposit.wins.toNumber(), 0);
    assert.equal(userAccountAfterDeposit.losses.toNumber(), 0);
    assert.equal(userAccountAfterDeposit.accountOwner.toString(), bettorKP.publicKey.toString());




    ///// ***** PLACE WAGER FUNCTIONALITY ***** /////

    const wagerDetailKP = anchor.web3.Keypair.generate();
    const party = 1;
    const lamports_to_wager = new anchor.BN((LAMPORTS_PER_SOL * 0.5) * JUICED_BETS_TAKE_RATE);

    console.log(`Bet State lamports before first wager placement: ${await program.provider.connection.getBalance(betStateKP.publicKey)/LAMPORTS_PER_SOL}`)
    console.log(`User Account lamports before first wager placement: ${await program.provider.connection.getBalance(userAccountKP.publicKey)/LAMPORTS_PER_SOL}`)
    
    console.log("Starting the 'place wager' functionality...");

    await program.rpc.placeWager(party, lamports_to_wager, {
      accounts: {
        betState: betStateKP.publicKey,
        wagerDetail: wagerDetailKP.publicKey,
        userAccount: userAccountKP.publicKey,
        bettorAccount: bettorKP.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId
      },
      signers: [betStateKP, wagerDetailKP, bettorKP, userAccountKP]
    })

    const wagerDetailsAccount = await program.account.wagerDetail.fetch(wagerDetailKP.publicKey);
    const betStateAfterWager = await program.account.betState.fetch(betStateKP.publicKey);
    const userAccountAfterWager = await program.account.userAccount.fetch(userAccountKP.publicKey);

    // Test the newly created bettor detail account and associated changes
    assert.ok(wagerDetailsAccount);
    console.log(wagerDetailsAccount)
    assert.ok(wagerDetailsAccount.bettor.equals(bettorKP.publicKey), `The attached bettor address: ${wagerDetailsAccount.bettor.toString()} attached to this bettor detail does not match with the correct betting user address: ${bettorKP.publicKey.toString()}`);
    assert.ok(wagerDetailsAccount.betState.equals(betStateKP.publicKey), `The attached bet state: ${wagerDetailsAccount.betState.toString()} attached to this bettor detail does not match with the correct bet state: ${betStateKP.publicKey.toString()}`);
    assert.ok(wagerDetailsAccount.betValue.eq(new anchor.BN(lamports_to_wager.toNumber()/JUICED_BETS_TAKE_RATE)), `Lamports we expect to bet: ${lamports_to_wager} are not equal to the expected amount: ${wagerDetailsAccount.betValue.toNumber()}`);

    // Test the right number of lamports were transferred from user account to betState
    console.log(`User Account lamports after first wager placement: ${await program.provider.connection.getBalance(userAccountKP.publicKey)/LAMPORTS_PER_SOL}`)
    console.log(`Bettor 1 User Account Balance after wager: ${userAccountAfterWager.currentBalance.toNumber()/LAMPORTS_PER_SOL}`);
    assert.equal(userAccountAfterWager.activeWagers.length, 1);
    assert.equal(userAccountAfterWager.currentBalance.toNumber(), LAMPORTS_PER_SOL - lamports_to_wager.toNumber());
    
    // Test the newly modified bet state obj with the updates from the placed wager
    console.log(`Bet state static total pool after first wager placement: ${betStateAfterWager.staticTotalPool.toNumber()/LAMPORTS_PER_SOL}`);
    console.log(`Bet state running total pool after first wager placement: ${betStateAfterWager.runningTotalPool.toNumber()/LAMPORTS_PER_SOL}`);
    console.log(`Bet state party 1 pool after first wager placement: ${betStateAfterWager.partyOnePool.toNumber()/LAMPORTS_PER_SOL}`);
    console.log(`Bet state party 2 pool after first wager placement: ${betStateAfterWager.partyTwoPool.toNumber()/LAMPORTS_PER_SOL}`);
    console.log(`Bet State lamports after first wager placement: ${await program.provider.connection.getBalance(betStateKP.publicKey)/LAMPORTS_PER_SOL}`)




    // ///// ***** CANCEL WAGER FUNCTIONALITY ***** /////

    console.log("Starting the 'cancel wager' functionality");

    await program.rpc.cancelWager(
      {
        accounts: {
          betState: betStateKP.publicKey,
          wagerDetail: wagerDetailKP.publicKey,
          userAccount: userAccountKP.publicKey,
          bettor: bettorKP.publicKey,
        },
        signers: [bettorKP]
      });


    const wagerDetailPAPostCancel = await program.account.wagerDetail.all([
      {
        memcmp: {
          offset: 8,
          bytes: bettorKP.publicKey.toBase58(),
        }
      }
    ]);

    const betStateAfterWagerCancellation = await program.account.betState.fetch(betStateKP.publicKey);
    const userAccountAfterWagerCancellation = await program.account.userAccount.fetch(userAccountKP.publicKey);

    // Test the cancel wager func
    assert.equal(wagerDetailPAPostCancel.length, 0);
    assert.equal(betStateAfterWagerCancellation.staticTotalPool.toNumber(), 0);
    assert.equal(betStateAfterWagerCancellation.runningTotalPool.toNumber(), 0);
    assert.equal(betStateAfterWagerCancellation.partyOnePool.toNumber(), 0);

    console.log(`Bet State lamports after cancellation: ${await program.provider.connection.getBalance(betStateKP.publicKey)/LAMPORTS_PER_SOL}`);
    console.log(`User Account lamports after cancellation: ${await program.provider.connection.getBalance(userAccountKP.publicKey)/LAMPORTS_PER_SOL}`);

    console.log(`Bettor 1 User Account Balance after wager: ${userAccountAfterWagerCancellation.currentBalance.toNumber()/LAMPORTS_PER_SOL}`);
    assert.equal(userAccountAfterWagerCancellation.activeWagers.length, 0);

    console.log(`Bet state static total pool after first wager cancellation: ${betStateAfterWagerCancellation.staticTotalPool}`);
    console.log(`Bet state running total pool after first wager cancellation: ${betStateAfterWagerCancellation.runningTotalPool}`);
    console.log(`Bet state party 1 pool after first wager cancellation: ${betStateAfterWagerCancellation.partyOnePool}`);
    console.log(`Bet state party 2 pool after first wager cancellation: ${betStateAfterWagerCancellation.partyTwoPool}`);

  });
    
  it('Initialize the bet, make three bets, party 1 wins, bet is closed, and party 1 pool participants can successfully claim their winnings, while party 2 pool participants cannot', async() => {

    const betCreatorKeyPair = anchor.web3.Keypair.generate();
    const sig = await program.provider.connection.requestAirdrop(betCreatorKeyPair.publicKey, 2000000000)
    await program.provider.connection.confirmTransaction(sig, "finalized");




     ///// ***** INITIALIZE BET FUNCTIONALITY ***** /////

    // Generate a new random keypair for betState
    const betStateKP = anchor.web3.Keypair.generate();
    const tradingPair = TICKERS[0];

    const start = new anchor.BN(Date.now());
    const duration = new anchor.BN(5 * 60 * 1000);

    console.log("Starting the 'initialize bet state' functionality...");
    console.log('--------------------')
    console.log(`Bet Creator Sol Balance pre bet init: ${await program.provider.connection.getBalance(betCreatorKeyPair.publicKey)/LAMPORTS_PER_SOL}`)

    await program.rpc.initializeBetState(
      start,
      duration,
      'Equity.US.SPY/USD',
      new anchor.BN(725.45 * 1000),
      0,
      {
        accounts: {
          betState: betStateKP.publicKey,
          betCreator: providerWallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId
        },
        signers:[betStateKP]
      },
    )

    let betStateAccount = await program.account.betState.fetch(betStateKP.publicKey);

    await program.account.betState.all

    console.log(`${JSON.stringify(betStateAccount)}`);

    assert.ok(betStateAccount);
    assert.ok(betStateAccount.staticTotalPool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.runningTotalPool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.partyOnePool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.partyTwoPool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.status.hasOwnProperty("open"));
    assert.ok(betStateAccount.betOutcome.hasOwnProperty("undecided"));

    console.log('--------------------')
    console.log(`Bet Creator Sol Balance post bet init: ${await program.provider.connection.getBalance(betCreatorKeyPair.publicKey)/LAMPORTS_PER_SOL}`)



            ///// USER 1 /////




    ///// ***** USER 1 CREATES ACCOUNT ***** /////

    const user1KP = anchor.web3.Keypair.generate();
    const bettor1_airdrop_sig = await program.provider.connection.requestAirdrop(user1KP.publicKey, 2000000000)
    await program.provider.connection.confirmTransaction(bettor1_airdrop_sig, "finalized");

    const user1AccountKP = anchor.web3.Keypair.generate();

    console.log("Initializaing User 1 Account...");

    await program.rpc.initializeUserAccount({
      accounts: {
        userAccount: user1AccountKP.publicKey,
        accountOwner: user1KP.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId
      },
      signers: [user1KP, user1AccountKP]
    })

    const userAccount = await program.account.userAccount.fetch(user1AccountKP.publicKey);

    assert.ok(userAccount);
    console.log(`Bettor 1 User Account: ${JSON.stringify(userAccount)}`);
    assert.equal(userAccount.currentBalance.toNumber(), 0)
    assert.equal(userAccount.wins.toNumber(), 0)
    assert.equal(userAccount.losses.toNumber(), 0)




    ///// ***** USER 1 DEPOSITS LAMPORTS INTO USER 1 ACCOUNT ***** /////

    const user1_lamports_to_deposit_num = LAMPORTS_PER_SOL * 1
    const user1_lamports_to_deposit = new anchor.BN(LAMPORTS_PER_SOL * 1);

    console.log("User 1 Depositing...");

    await program.rpc.depositIntoAccount(user1_lamports_to_deposit, {
      accounts: {
        userAccount: user1AccountKP.publicKey,
        accountOwner: user1KP.publicKey
      },
      preInstructions: [
        await SystemProgram.transfer({
          fromPubkey: user1KP.publicKey,
          lamports: user1_lamports_to_deposit_num,
          toPubkey: user1AccountKP.publicKey
        })
      ],
      signers:[user1KP]
    })

    const user1AccountAfterDeposit = await program.account.userAccount.fetch(user1AccountKP.publicKey);

    console.log(`User 1 User Account After 1 Sol Deposit: ${JSON.stringify(user1AccountAfterDeposit)}`);
    assert.equal(user1AccountAfterDeposit.currentBalance.toNumber(), 1000000000);
    assert.equal(user1AccountAfterDeposit.wins.toNumber(), 0);
    assert.equal(user1AccountAfterDeposit.losses.toNumber(), 0);
    assert.equal(user1AccountAfterDeposit.accountOwner.toString(), user1KP.publicKey.toString());




    ///// ***** USER 1 PLACE WAGER FUNCTIONALITY ***** /////

    const wagerDetail1KP = anchor.web3.Keypair.generate();
    const party = 1;
    const user1_lamports_to_wager = new anchor.BN((LAMPORTS_PER_SOL * 0.5) * JUICED_BETS_TAKE_RATE);

    console.log(`Bet State lamports before first wager placement: ${await program.provider.connection.getBalance(betStateKP.publicKey)/LAMPORTS_PER_SOL}`)
    console.log(`User Account lamports before first wager placement: ${await program.provider.connection.getBalance(user1AccountKP.publicKey)/LAMPORTS_PER_SOL}`)
    
    console.log("User 1 placing wager...");

    await program.rpc.placeWager(party, user1_lamports_to_wager, {
      accounts: {
        betState: betStateKP.publicKey,
        wagerDetail: wagerDetail1KP.publicKey,
        userAccount: user1AccountKP.publicKey,
        bettorAccount: user1KP.publicKey,
        betCreator: betCreatorKeyPair.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId
      },
      signers: [user1KP, wagerDetail1KP]
    })

    const wagerDetails1Account = await program.account.wagerDetail.fetch(wagerDetail1KP.publicKey);
    const betStateAfterWager = await program.account.betState.fetch(betStateKP.publicKey);
    const user1AccountAfterWager = await program.account.userAccount.fetch(user1AccountKP.publicKey);

    // Test the newly created bettor detail account and associated changes
    assert.ok(wagerDetails1Account);
    console.log(wagerDetails1Account)
    assert.ok(wagerDetails1Account.bettor.equals(user1KP.publicKey), `The attached bettor address: ${wagerDetails1Account.bettor.toString()} attached to this bettor detail does not match with the correct betting user address: ${user1KP.publicKey.toString()}`);
    assert.ok(wagerDetails1Account.betState.equals(betStateKP.publicKey), `The attached bet state: ${wagerDetails1Account.betState.toString()} attached to this bettor detail does not match with the correct bet state: ${betStateKP.publicKey.toString()}`);
    assert.ok(wagerDetails1Account.betValue.eq(new anchor.BN(user1_lamports_to_wager.toNumber()/JUICED_BETS_TAKE_RATE)), `Lamports we expect to bet: ${user1_lamports_to_wager} are not equal to the expected amount: ${wagerDetails1Account.betValue.toNumber()}`);

    // Test the right number of lamports were transferred from user account to betState
    console.log(`User 1 Account lamports after first wager placement: ${await program.provider.connection.getBalance(user1AccountKP.publicKey)/LAMPORTS_PER_SOL}`)
    console.log(`Bettor 1 User Account Balance after wager: ${user1AccountAfterWager.currentBalance.toNumber()/LAMPORTS_PER_SOL}`);
    console.log('--------------------')
    console.log(`Bet Creator Sol Balance after Bettor 1 places wager: ${await program.provider.connection.getBalance(betCreatorKeyPair.publicKey)/LAMPORTS_PER_SOL}`)
    assert.equal(user1AccountAfterWager.activeWagers.length, 1);
    
    // Test the newly modified bet state obj with the updates from the placed wager
    console.log(`Bet state static total pool after first wager placement: ${betStateAfterWager.staticTotalPool.toNumber()/LAMPORTS_PER_SOL}`);
    console.log(`Bet state running total pool after first wager placement: ${betStateAfterWager.runningTotalPool.toNumber()/LAMPORTS_PER_SOL}`);
    console.log(`Bet state party 1 pool after first wager placement: ${betStateAfterWager.partyOnePool.toNumber()/LAMPORTS_PER_SOL}`);
    console.log(`Bet state party 2 pool after first wager placement: ${betStateAfterWager.partyTwoPool.toNumber()/LAMPORTS_PER_SOL}`);
    console.log(`Bet State lamports after first wager placement: ${await program.provider.connection.getBalance(betStateKP.publicKey)/LAMPORTS_PER_SOL}`)





          ///// USER 2 /////




    ///// ***** USER 2 CREATES ACCOUNT ***** /////

    const user2KP = anchor.web3.Keypair.generate();
    const user2_airdrop_sig = await program.provider.connection.requestAirdrop(user2KP.publicKey, 2000000000)
    await program.provider.connection.confirmTransaction(user2_airdrop_sig, "finalized");

    const user2AccountKP = anchor.web3.Keypair.generate();

    console.log("Initializaing User 2 Account...");

    await program.rpc.initializeUserAccount({
      accounts: {
        userAccount: user2AccountKP.publicKey,
        accountOwner: user2KP.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId
      },
      signers: [user2KP, user2AccountKP]
    })

    const user2Account = await program.account.userAccount.fetch(user2AccountKP.publicKey);

    assert.ok(user2Account);
    console.log(`Bettor 2 User Account: ${JSON.stringify(user2Account)}`);
    assert.equal(user2Account.currentBalance.toNumber(), 0);
    assert.equal(user2Account.wins.toNumber(), 0);
    assert.equal(user2Account.losses.toNumber(), 0);




    ///// ***** USER 2 DEPOSITS LAMPORTS INTO USER 1 ACCOUNT ***** /////

    const user2_lamports_deposit_num = LAMPORTS_PER_SOL * 1
    const user2_lamports_to_deposit = new anchor.BN(LAMPORTS_PER_SOL * 1);

    console.log("User 2 Depositing...");

    await program.rpc.depositIntoAccount(user2_lamports_to_deposit, {
      accounts: {
        userAccount: user2AccountKP.publicKey,
        accountOwner: user2KP.publicKey
      },
      preInstructions: [
        await SystemProgram.transfer({
          fromPubkey: user2KP.publicKey,
          lamports: user2_lamports_deposit_num,
          toPubkey: user2AccountKP.publicKey
        })
      ],
      signers:[user2KP]
    })

    const user2AccountAfterDeposit = await program.account.userAccount.fetch(user2AccountKP.publicKey);

    console.log(`User 2 User Account After 1 Sol Deposit: ${JSON.stringify(user2AccountAfterDeposit)}`);
    assert.equal(user2AccountAfterDeposit.currentBalance.toNumber(), 1000000000);
    assert.equal(user2AccountAfterDeposit.wins.toNumber(), 0);
    assert.equal(user2AccountAfterDeposit.losses.toNumber(), 0);
    assert.equal(user2AccountAfterDeposit.accountOwner.toString(), user2KP.publicKey.toString());




    ///// ***** USER 2 PLACE WAGER FUNCTIONALITY ***** /////

    const wagerDetail2KP = anchor.web3.Keypair.generate();
    const user2_party = 1;
    const user2_lamports_to_wager = new anchor.BN((LAMPORTS_PER_SOL * 0.5) * JUICED_BETS_TAKE_RATE);

    console.log(`Bet State lamports before second wager placement: ${await program.provider.connection.getBalance(betStateKP.publicKey)/LAMPORTS_PER_SOL}`)
    console.log(`User 2 Account lamports before second wager placement: ${await program.provider.connection.getBalance(user2AccountKP.publicKey)/LAMPORTS_PER_SOL}`)
    
    console.log("User 2 placing wager...");

    await program.rpc.placeWager(user2_party, user2_lamports_to_wager, {
      accounts: {
        betState: betStateKP.publicKey,
        wagerDetail: wagerDetail2KP.publicKey,
        userAccount: user2AccountKP.publicKey,
        bettorAccount: user2KP.publicKey,
        betCreator: betCreatorKeyPair.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId
      },
      signers: [user2KP, wagerDetail2KP]
    })

    const wagerDetails2Account = await program.account.wagerDetail.fetch(wagerDetail2KP.publicKey);
    const userAccount2AfterWager = await program.account.userAccount.fetch(user2AccountKP.publicKey);

    // Test the newly created bettor detail account and associated changes
    assert.ok(wagerDetails2Account);
    console.log(wagerDetails2Account)
    assert.ok(wagerDetails2Account.bettor.equals(user2KP.publicKey), `The attached bettor address: ${wagerDetails2Account.bettor.toString()} attached to this bettor detail does not match with the correct betting user address: ${user2KP.publicKey.toString()}`);
    assert.ok(wagerDetails2Account.betState.equals(betStateKP.publicKey), `The attached bet state: ${wagerDetails2Account.betState.toString()} attached to this bettor detail does not match with the correct bet state: ${betStateKP.publicKey.toString()}`);
    assert.ok(wagerDetails2Account.betValue.eq(new anchor.BN(user2_lamports_to_wager.toNumber()/JUICED_BETS_TAKE_RATE)), `Lamports we expect to bet: ${user2_lamports_to_wager} are not equal to the expected amount: ${wagerDetails2Account.betValue.toNumber()}`);

    // Test the right number of lamports were transferred from user account to betState
    console.log(`User 2 Account lamports after first wager placement: ${await program.provider.connection.getBalance(user2AccountKP.publicKey)/LAMPORTS_PER_SOL}`)
    console.log(`Bettor 2 User Account Balance after wager: ${userAccount2AfterWager.currentBalance.toNumber()/LAMPORTS_PER_SOL}`);
    console.log('--------------------')
    console.log(`Bet Creator Sol Balance after Bettor 2 places wager: ${await program.provider.connection.getBalance(betCreatorKeyPair.publicKey)/LAMPORTS_PER_SOL}`)
    assert.equal(userAccount2AfterWager.activeWagers.length, 1);
    
    // Test the newly modified bet state obj with the updates from the placed wager
    console.log(`Bet state static total pool after second wager placement: ${betStateAfterWager.staticTotalPool.toNumber()/LAMPORTS_PER_SOL}`);
    console.log(`Bet state running total pool after second wager placement: ${betStateAfterWager.runningTotalPool.toNumber()/LAMPORTS_PER_SOL}`);
    console.log(`Bet state party 1 pool after second wager placement: ${betStateAfterWager.partyOnePool.toNumber()/LAMPORTS_PER_SOL}`);
    console.log(`Bet state party 2 pool after second wager placement: ${betStateAfterWager.partyTwoPool.toNumber()/LAMPORTS_PER_SOL}`);
    console.log(`Bet State lamports after second wager placement: ${await program.provider.connection.getBalance(betStateKP.publicKey)/LAMPORTS_PER_SOL}`)






          ///// USER 3 /////




    ///// ***** USER 3 CREATES ACCOUNT ***** /////

    const user3KP = anchor.web3.Keypair.generate();
    const user3_airdrop_sig = await program.provider.connection.requestAirdrop(user3KP.publicKey, 2000000000)
    await program.provider.connection.confirmTransaction(user3_airdrop_sig, "finalized");

    const user3AccountKP = anchor.web3.Keypair.generate();

    console.log("Initializaing User 3 Account...");

    await program.rpc.initializeUserAccount({
      accounts: {
        userAccount: user3AccountKP.publicKey,
        accountOwner: user3KP.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId
      },
      signers: [user3KP, user3AccountKP]
    })

    const user3Account = await program.account.userAccount.fetch(user3AccountKP.publicKey);

    assert.ok(user3Account);
    console.log(`Bettor 3 User Account: ${JSON.stringify(user3Account)}`);
    assert.equal(user3Account.currentBalance.toNumber(), 0)
    assert.equal(user3Account.wins.toNumber(), 0)
    assert.equal(user3Account.losses.toNumber(), 0)




    ///// ***** USER 3 DEPOSITS LAMPORTS INTO USER 1 ACCOUNT ***** /////

    const user3_lamports_deposit_num = LAMPORTS_PER_SOL * 1
    const user3_lamports_to_deposit = new anchor.BN(LAMPORTS_PER_SOL * 1);

    console.log("User 3 Depositing...");

    await program.rpc.depositIntoAccount(user3_lamports_to_deposit, {
      accounts: {
        userAccount: user3AccountKP.publicKey,
        accountOwner: user3KP.publicKey
      },
      preInstructions: [
        await SystemProgram.transfer({
          fromPubkey: user3KP.publicKey,
          lamports: user3_lamports_deposit_num,
          toPubkey: user3AccountKP.publicKey
        })
      ],
      signers:[user3KP]
    })

    const user3AccountAfterDeposit = await program.account.userAccount.fetch(user3AccountKP.publicKey);

    console.log(`User 3 User Account After 1 Sol Deposit: ${JSON.stringify(user3AccountAfterDeposit)}`);
    assert.equal(user3AccountAfterDeposit.currentBalance.toNumber(), 1000000000);
    assert.equal(user3AccountAfterDeposit.wins.toNumber(), 0);
    assert.equal(user3AccountAfterDeposit.losses.toNumber(), 0);
    assert.equal(user3AccountAfterDeposit.accountOwner.toString(), user3KP.publicKey.toString());




    ///// ***** USER 3 PLACE WAGER FUNCTIONALITY ***** /////

    const wagerDetail3KP = anchor.web3.Keypair.generate();
    const user3_party = 2;
    const user3_lamports_to_wager = new anchor.BN((LAMPORTS_PER_SOL * 0.5) * JUICED_BETS_TAKE_RATE);

    console.log(`Bet State lamports before third wager placement: ${await program.provider.connection.getBalance(betStateKP.publicKey)/LAMPORTS_PER_SOL}`)
    console.log(`User 3 Account lamports before third wager placement: ${await program.provider.connection.getBalance(user3AccountKP.publicKey)/LAMPORTS_PER_SOL}`)
    
    console.log("User 3 placing wager...");

    await program.rpc.placeWager(user3_party, user3_lamports_to_wager, {
      accounts: {
        betState: betStateKP.publicKey,
        wagerDetail: wagerDetail3KP.publicKey,
        userAccount: user3AccountKP.publicKey,
        bettorAccount: user3KP.publicKey,
        betCreator: betCreatorKeyPair.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId
      },
      signers: [user3KP, wagerDetail3KP]
    })

    const wagerDetails3Account = await program.account.wagerDetail.fetch(wagerDetail3KP.publicKey);
    const userAccount3AfterWager = await program.account.userAccount.fetch(user3AccountKP.publicKey);

    // Test the newly created bettor detail account and associated changes
    assert.ok(wagerDetails3Account);
    console.log(wagerDetails3Account)
    assert.ok(wagerDetails3Account.bettor.equals(user3KP.publicKey), `The attached bettor address: ${wagerDetails3Account.bettor.toString()} attached to this bettor detail does not match with the correct betting user address: ${user3KP.publicKey.toString()}`);
    assert.ok(wagerDetails3Account.betState.equals(betStateKP.publicKey), `The attached bet state: ${wagerDetails3Account.betState.toString()} attached to this bettor detail does not match with the correct bet state: ${betStateKP.publicKey.toString()}`);
    assert.ok(wagerDetails3Account.betValue.eq(new anchor.BN(user3_lamports_to_wager.toNumber()/JUICED_BETS_TAKE_RATE)), `Lamports we expect to bet: ${user3_lamports_to_wager} are not equal to the expected amount: ${wagerDetails3Account.betValue.toNumber()}`);

    // Test the right number of lamports were transferred from user account to betState
    console.log(`User 3 Account lamports after third wager placement: ${await program.provider.connection.getBalance(user3AccountKP.publicKey)/LAMPORTS_PER_SOL}`)
    console.log(`Bettor 3 User Account Balance after wager: ${userAccount3AfterWager.currentBalance.toNumber()/LAMPORTS_PER_SOL}`);
    console.log('--------------------')
    console.log(`Bet Creator Sol Balance after Bettor 3 places wager: ${await program.provider.connection.getBalance(betCreatorKeyPair.publicKey)/LAMPORTS_PER_SOL}`)
    assert.equal(userAccount3AfterWager.activeWagers.length, 1);
    
    // Test the newly modified bet state obj with the updates from the placed wager
    console.log(`Bet state static total pool after third wager placement: ${betStateAfterWager.staticTotalPool.toNumber()/LAMPORTS_PER_SOL}`);
    console.log(`Bet state running total pool after third wager placement: ${betStateAfterWager.runningTotalPool.toNumber()/LAMPORTS_PER_SOL}`);
    console.log(`Bet state party 1 pool after third wager placement: ${betStateAfterWager.partyOnePool.toNumber()/LAMPORTS_PER_SOL}`);
    console.log(`Bet state party 2 pool after third wager placement: ${betStateAfterWager.partyTwoPool.toNumber()/LAMPORTS_PER_SOL}`);
    console.log(`Bet State lamports after third wager placement: ${await program.provider.connection.getBalance(betStateKP.publicKey)/LAMPORTS_PER_SOL}`)




    ///// ***** CLOSING A BET STATE ***** /////

    const end_time = new anchor.BN(Date.now());

    const betStateBeforeClosing = await program.account.betState.fetch(betStateKP.publicKey);
    assert.ok(betStateBeforeClosing.status.hasOwnProperty("open"));

    await program.rpc.closeBetState(
      end_time,
      {
        accounts: {
          betState: betStateKP.publicKey,
          betCreator: providerWallet.publicKey
        }
      }
    )

    const betStateAfterClosing = await program.account.betState.fetch(betStateKP.publicKey);
    assert.ok(betStateAfterClosing);
    assert.ok(betStateAfterClosing.betOutcome.hasOwnProperty("undecided"));
    assert.ok(betStateAfterClosing.status.hasOwnProperty("closed"));




    ///// ***** DECIDE THE BET STATE OUTCOME ***** /////

    await program.rpc.decideBetStateOutcome(
      1,
      {
        accounts: {
          betState: betStateKP.publicKey,
          betCreator: providerWallet.publicKey
        }
      }
    )

    const betStateAfterBetOutcomeDecided = await program.account.betState.fetch(betStateKP.publicKey);
    assert.ok(betStateAfterBetOutcomeDecided);
    assert.ok(betStateAfterBetOutcomeDecided.betOutcome.hasOwnProperty("partyOneWin"));




    ///// ***** BETTOR FROM WINNING PARTY CAN CLAIM WINNINGS ***** /////

    /// BETTOR DETAIL INFO ///
    console.log("*****BETTOR DETAIL INFO*****");
    console.log(`Bettor Detail 1: ${wagerDetails1Account.bettor}`);
    console.log(`Bettor Detail 1 Bet: ${wagerDetails1Account.betValue}`);
    console.log(`Bettor Detail 2: ${wagerDetails2Account.bettor}`);
    console.log(`Bettor Detail 2 Bet: ${wagerDetails2Account.betValue}`);
    console.log(`Bettor Detail 3: ${wagerDetails3Account.bettor}`);
    console.log(`Bettor Detail 3 Bet: ${wagerDetails3Account.betValue}`);

    /// CHECK CURRENT BET STATE TO SEE ALL THREE BETTORS AND CONFIRM POOL TOTALS ///
    console.log("*****BETTOR STATE INFO*****");
    const betStateAfterThreeBets = await program.account.betState.fetch(betStateKP.publicKey);
    console.log(`Bet State actual sol balance after 3 bets: ${(await program.provider.connection.getBalance(betStateKP.publicKey))/LAMPORTS_PER_SOL} SOL`);
    console.log(`Bet State party 1 pool balance after 3 bets: ${betStateAfterThreeBets.partyOnePool.toNumber()/LAMPORTS_PER_SOL} SOL`);
    console.log(`Bet State party 2 pool balance after 3 bets: ${betStateAfterThreeBets.partyTwoPool.toNumber()/LAMPORTS_PER_SOL} SOL`);
     

    const bettor1Winnings = new anchor.BN(calculateWinnings(wagerDetails1Account, betStateAfterThreeBets));
    const bettor2Winnings = new anchor.BN(calculateWinnings(wagerDetails2Account, betStateAfterThreeBets));
    const bettor3Winnings = new anchor.BN(calculateWinnings(wagerDetails3Account, betStateAfterThreeBets));

    console.log("*****CALCULATE WINNINGS FOR ALL THREE BETTORS*****")
    console.log(`Calculate winnings for Bettor 1: ${bettor1Winnings.toNumber()/LAMPORTS_PER_SOL} SOL`);
    console.log(`Calculate winnings for Bettor 2: ${bettor2Winnings.toNumber()/LAMPORTS_PER_SOL} SOL`);
    console.log(`Calculate winnings for Bettor 3: ${bettor3Winnings.toNumber()/LAMPORTS_PER_SOL} SOL`);

    console.log("*****PRE BETTOR 1 CLAIM STATE******");
    console.log(`Bet Creator Sol Balance `)
    console.log(`Bet State Sol Balance before Bettor 1 (Bet Creator) claims winnings: ${(await program.provider.connection.getBalance(betStateKP.publicKey))/LAMPORTS_PER_SOL} SOL`);
    console.log(`Bettor 1 (User 1) User Account Sol Balance Pre-Claim: ${(await program.provider.connection.getBalance(user1AccountKP.publicKey))/LAMPORTS_PER_SOL} SOL`);  
    console.log(`Bet State Account Static Total before Bettor 1 (User 1) claims winnings: ${betStateAfterThreeBets.staticTotalPool.toNumber()/LAMPORTS_PER_SOL} SOL`);
    console.log(`Bet State Account Running Total before Bettor 1 (User 1) claims winnings: ${betStateAfterThreeBets.runningTotalPool.toNumber()/LAMPORTS_PER_SOL} SOL`);




    ///// ***** USER 1 CLAIMS WINNINGS ***** /////

    // TODO: Abstract into utils
    await program.rpc.claimWinnings(
      bettor1Winnings,
      {
        accounts: {
          betState: betStateKP.publicKey,
          wagerDetail: wagerDetail1KP.publicKey,
          userAccount: user1AccountKP.publicKey,
          bettor: user1KP.publicKey
        },
        signers:[user1KP]
      }
    )

    const betStateAfterUser1Claims = await program.account.betState.fetch(betStateKP.publicKey);
    assert.ok(betStateAfterUser1Claims);

    console.log("*****POST BETTOR 1 CLAIM STATE******");
    console.log(`Bet State Sol Balance after Bettor 1 (User 1) claims winnings: ${(await program.provider.connection.getBalance(betStateKP.publicKey))/LAMPORTS_PER_SOL} SOL`);
    console.log(`Bettor 1 (User 1) User Account Sol Balance Post-Claim: ${(await program.provider.connection.getBalance(user1AccountKP.publicKey))/LAMPORTS_PER_SOL} SOL`);
    console.log(`Bet State Account Static Total after Bettor 1 (User 1) claims winnings: ${betStateAfterUser1Claims.staticTotalPool.toNumber()/LAMPORTS_PER_SOL} SOL`);
    console.log(`Bet State Account Running Total after Bettor 1 (User 1) claims winnings: ${betStateAfterUser1Claims.runningTotalPool.toNumber()/LAMPORTS_PER_SOL} SOL`);

    


    ///// ***** LAST BETTOR CLAIMS WINNINGS ***** /////

    await program.rpc.claimWinnings(
      bettor2Winnings,
      {
        accounts: {
          betState: betStateKP.publicKey,
          wagerDetail: wagerDetail2KP.publicKey,
          userAccount: user2AccountKP.publicKey,
          bettor: user2KP.publicKey
        },
        signers:[user2KP]
      }
    );

    const betStateAfterUser2Claims = await program.account.betState.fetch(betStateKP.publicKey);
    assert.ok(betStateAfterUser2Claims);

    console.log("*****POST FULLY CLAIMED BET STATE******");
    console.log(`Bet State Sol Balance after all winnings are claimed: ${(await program.provider.connection.getBalance(betStateKP.publicKey))/LAMPORTS_PER_SOL} SOL`);
    console.log(`Bettor 2 (User 2) User Account Sol Balance after all winnings are claimed: ${(await program.provider.connection.getBalance(user2AccountKP.publicKey))/LAMPORTS_PER_SOL} SOL`);
    console.log(`Bet State Account Static Total after all winnings are claimed: ${betStateAfterUser2Claims.staticTotalPool.toNumber()/LAMPORTS_PER_SOL} SOL`);
    console.log(`Bet State Account Running Total after all winnings are claimed: ${betStateAfterUser2Claims.runningTotalPool.toNumber()/LAMPORTS_PER_SOL} SOL`);




    ///// ***** BET CREATOR SETTLES BET WHEN ALL WINNINGS ARE CLAIMED ***** /////

    await program.rpc.settleBetState(
      {
        accounts: {
          betState: betStateKP.publicKey,
          betCreator: providerWallet.publicKey,
        }
      }
    );

    const betStateToFindAfterBetStateSettles = await program.account.betState.all([
      {
        memcmp: {
          offset: 8,
          bytes: betStateKP.publicKey.toBase58(),
        }
      }
    ]);

    assert.equal(betStateToFindAfterBetStateSettles.length, 0);

  });


  // Placing Wagers //

  // WILL NEED TO BE FULLY TESTED ON FRONT END
  // Create a utility function to find bettor detail structs
  it.skip('Cannot place multiple wagers on one bet state from the same betting user', async() => {

    const betCreatorKeyPair = anchor.web3.Keypair.generate();
    const sig = await program.provider.connection.requestAirdrop(betCreatorKeyPair.publicKey, 2000000000)
    await program.provider.connection.confirmTransaction(sig, "finalized");




     ///// ***** INITIALIZE BET FUNCTIONALITY ***** /////

    // Generate a new random keypair for betState
    const betStateKP = anchor.web3.Keypair.generate();
    const tradingPair = TICKERS[0];

    const start = new anchor.BN(Date.now());
    const duration = new anchor.BN(5 * 60 * 1000);

    console.log("Starting the 'initialize bet state' functionality...");

    await program.rpc.initializeBetState(
      start,
      duration,
      tradingPair,
      {
        accounts: {
          betState: betStateKP.publicKey,
          betCreator: providerWallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId
        },
        signers:[betStateKP]
      },
    )

    let betStateAccount = await program.account.betState.fetch(betStateKP.publicKey);

    console.log(`${JSON.stringify(betStateAccount)}`);

    assert.ok(betStateAccount);
    assert.ok(betStateAccount.staticTotalPool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.runningTotalPool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.partyOnePool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.partyTwoPool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.status.hasOwnProperty("open"));
    assert.ok(betStateAccount.betOutcome.hasOwnProperty("undecided"));



            ///// USER 1 /////




    ///// ***** USER 1 CREATES ACCOUNT ***** /////

    const user1KP = anchor.web3.Keypair.generate();
    const bettor1_airdrop_sig = await program.provider.connection.requestAirdrop(user1KP.publicKey, 2000000000)
    await program.provider.connection.confirmTransaction(bettor1_airdrop_sig, "finalized");

    const user1AccountKP = anchor.web3.Keypair.generate();

    console.log("Initializaing User 1 Account...");

    await program.rpc.initializeUserAccount({
      accounts: {
        userAccount: user1AccountKP.publicKey,
        accountOwner: user1KP.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId
      },
      signers: [user1KP, user1AccountKP]
    })

    const userAccount = await program.account.userAccount.fetch(user1AccountKP.publicKey);

    assert.ok(userAccount);
    console.log(`Bettor 1 User Account: ${JSON.stringify(userAccount)}`);
    assert.equal(userAccount.currentBalance.toNumber(), 0)
    assert.equal(userAccount.wins.toNumber(), 0)
    assert.equal(userAccount.losses.toNumber(), 0)




    ///// ***** USER 1 DEPOSITS LAMPORTS INTO USER 1 ACCOUNT ***** /////

    const user1_lamports_to_deposit_num = LAMPORTS_PER_SOL * 1
    const user1_lamports_to_deposit = new anchor.BN(LAMPORTS_PER_SOL * 1);

    console.log("User 1 Depositing...");

    await program.rpc.depositIntoAccount(user1_lamports_to_deposit, {
      accounts: {
        userAccount: user1AccountKP.publicKey,
        accountOwner: user1KP.publicKey
      },
      preInstructions: [
        await SystemProgram.transfer({
          fromPubkey: user1KP.publicKey,
          lamports: user1_lamports_to_deposit_num,
          toPubkey: user1AccountKP.publicKey
        })
      ],
      signers:[user1AccountKP, user1KP]
    })

    const user1AccountAfterDeposit = await program.account.userAccount.fetch(user1AccountKP.publicKey);

    console.log(`User 1 User Account After 1 Sol Deposit: ${JSON.stringify(user1AccountAfterDeposit)}`);
    assert.equal(user1AccountAfterDeposit.currentBalance.toNumber(), 1000000000);
    assert.equal(user1AccountAfterDeposit.wins.toNumber(), 0);
    assert.equal(user1AccountAfterDeposit.losses.toNumber(), 0);
    assert.equal(user1AccountAfterDeposit.accountOwner.toString(), user1KP.publicKey.toString());




    ///// ***** USER 1 PLACE WAGER FUNCTIONALITY ***** /////

    const wagerDetail1KP = anchor.web3.Keypair.generate();
    const party = 1;
    const user1_lamports_to_wager = new anchor.BN(LAMPORTS_PER_SOL * 0.5);

    console.log(`Bet State lamports before first wager placement: ${await program.provider.connection.getBalance(betStateKP.publicKey)/LAMPORTS_PER_SOL}`)
    console.log(`User Account lamports before first wager placement: ${await program.provider.connection.getBalance(user1AccountKP.publicKey)/LAMPORTS_PER_SOL}`)

    const user1AccountBeforeWager = await program.account.userAccount.fetch(user1AccountKP.publicKey);

    // We'll use this function to find matching wagers before a user places a wager
    assert.ok(!matchingWagerFound(program, user1AccountBeforeWager, betStateKP));
    
    console.log("User 1 placing wager...");

    await program.rpc.placeWager(party, user1_lamports_to_wager, {
      accounts: {
        betState: betStateKP.publicKey,
        wagerDetail: wagerDetail1KP.publicKey,
        userAccount: user1AccountKP.publicKey,
        bettorAccount: user1KP.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId
      },
      signers: [betStateKP, wagerDetail1KP, user1KP, user1AccountKP]
    })

    const user1AccountAfterWager = await program.account.userAccount.fetch(user1AccountKP.publicKey);

    console.log(`user1AccountAfterWager: ${JSON.stringify(user1AccountAfterWager.activeWagers)}`);

    // We'll use this function to find matching wagers before a user places a wager
    assert.ok(matchingWagerFound(program, user1AccountAfterWager, betStateKP));


  });

  it.skip('Cannot place a wager when the bet state is closed', async() => {

    const betCreatorKeyPair = anchor.web3.Keypair.generate();
    const sig = await program.provider.connection.requestAirdrop(betCreatorKeyPair.publicKey, 2000000000)
    await program.provider.connection.confirmTransaction(sig, "finalized");




     ///// ***** INITIALIZE BET FUNCTIONALITY ***** /////

    // Generate a new random keypair for betState
    const betStateKP = anchor.web3.Keypair.generate();
    const tradingPair = TICKERS[0];

    const start = new anchor.BN(Date.now());
    const duration = new anchor.BN(5 * 60 * 1000);

    console.log("Starting the 'initialize bet state' functionality...");

    await program.rpc.initializeBetState(
      start,
      duration,
      tradingPair,
      {
        accounts: {
          betState: betStateKP.publicKey,
          betCreator: providerWallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId
        },
        signers:[betStateKP]
      },
    )

    let betStateAccount = await program.account.betState.fetch(betStateKP.publicKey);

    console.log(`${JSON.stringify(betStateAccount)}`);

    assert.ok(betStateAccount);
    assert.ok(betStateAccount.staticTotalPool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.runningTotalPool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.partyOnePool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.partyTwoPool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.status.hasOwnProperty("open"));
    assert.ok(betStateAccount.betOutcome.hasOwnProperty("undecided"));



            ///// USER 1 /////




    ///// ***** USER 1 CREATES ACCOUNT ***** /////

    const user1KP = anchor.web3.Keypair.generate();
    const bettor1_airdrop_sig = await program.provider.connection.requestAirdrop(user1KP.publicKey, 2000000000)
    await program.provider.connection.confirmTransaction(bettor1_airdrop_sig, "finalized");

    const user1AccountKP = anchor.web3.Keypair.generate();

    console.log("Initializaing User 1 Account...");

    await program.rpc.initializeUserAccount({
      accounts: {
        userAccount: user1AccountKP.publicKey,
        accountOwner: user1KP.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId
      },
      signers: [user1KP, user1AccountKP]
    })

    const userAccount = await program.account.userAccount.fetch(user1AccountKP.publicKey);

    assert.ok(userAccount);
    console.log(`Bettor 1 User Account: ${JSON.stringify(userAccount)}`);
    assert.equal(userAccount.currentBalance.toNumber(), 0)
    assert.equal(userAccount.wins.toNumber(), 0)
    assert.equal(userAccount.losses.toNumber(), 0)




    ///// ***** USER 1 DEPOSITS LAMPORTS INTO USER 1 ACCOUNT ***** /////

    const user1_lamports_to_deposit_num = LAMPORTS_PER_SOL * 1
    const user1_lamports_to_deposit = new anchor.BN(LAMPORTS_PER_SOL * 1);

    console.log("User 1 Depositing...");

    await program.rpc.depositIntoAccount(user1_lamports_to_deposit, {
      accounts: {
        userAccount: user1AccountKP.publicKey,
        accountOwner: user1KP.publicKey
      },
      preInstructions: [
        await SystemProgram.transfer({
          fromPubkey: user1KP.publicKey,
          lamports: user1_lamports_to_deposit_num,
          toPubkey: user1AccountKP.publicKey
        })
      ],
      signers:[user1AccountKP, user1KP]
    })

    const user1AccountAfterDeposit = await program.account.userAccount.fetch(user1AccountKP.publicKey);

    console.log(`User 1 User Account After 1 Sol Deposit: ${JSON.stringify(user1AccountAfterDeposit)}`);
    assert.equal(user1AccountAfterDeposit.currentBalance.toNumber(), 1000000000);
    assert.equal(user1AccountAfterDeposit.wins.toNumber(), 0);
    assert.equal(user1AccountAfterDeposit.losses.toNumber(), 0);
    assert.equal(user1AccountAfterDeposit.accountOwner.toString(), user1KP.publicKey.toString());




    ///// ***** USER 1 PLACE WAGER FUNCTIONALITY ***** /////

    const wagerDetail1KP = anchor.web3.Keypair.generate();
    const party = 1;
    const user1_lamports_to_wager = new anchor.BN(LAMPORTS_PER_SOL * 0.5);

    console.log(`Bet State lamports before first wager placement: ${await program.provider.connection.getBalance(betStateKP.publicKey)/LAMPORTS_PER_SOL}`)
    console.log(`User Account lamports before first wager placement: ${await program.provider.connection.getBalance(user1AccountKP.publicKey)/LAMPORTS_PER_SOL}`)
    
    console.log("User 1 placing wager...");

    await program.rpc.placeWager(party, user1_lamports_to_wager, {
      accounts: {
        betState: betStateKP.publicKey,
        wagerDetail: wagerDetail1KP.publicKey,
        userAccount: user1AccountKP.publicKey,
        bettorAccount: user1KP.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId
      },
      signers: [betStateKP, wagerDetail1KP, user1KP, user1AccountKP]
    })

    const wagerDetails1Account = await program.account.wagerDetail.fetch(wagerDetail1KP.publicKey);
    const betStateAfterWager = await program.account.betState.fetch(betStateKP.publicKey);
    const user1AccountAfterWager = await program.account.userAccount.fetch(user1AccountKP.publicKey);

    // Test the newly created bettor detail account and associated changes
    assert.ok(wagerDetails1Account);
    console.log(wagerDetails1Account)
    assert.ok(wagerDetails1Account.bettor.equals(user1KP.publicKey), `The attached bettor address: ${wagerDetails1Account.bettor.toString()} attached to this bettor detail does not match with the correct betting user address: ${user1KP.publicKey.toString()}`);
    assert.ok(wagerDetails1Account.betState.equals(betStateKP.publicKey), `The attached bet state: ${wagerDetails1Account.betState.toString()} attached to this bettor detail does not match with the correct bet state: ${betStateKP.publicKey.toString()}`);
    assert.ok(wagerDetails1Account.betValue.eq(new anchor.BN(user1_lamports_to_wager)), `Lamports we expect to bet: ${user1_lamports_to_wager} are not equal to the expected amount: ${wagerDetails1Account.betValue.toNumber()}`);

    // Test the right number of lamports were transferred from user account to betState
    console.log(`User 1 Account lamports after first wager placement: ${await program.provider.connection.getBalance(user1AccountKP.publicKey)/LAMPORTS_PER_SOL}`)
    console.log(`Bettor 1 User Account Balance after wager: ${user1AccountAfterWager.currentBalance.toNumber()/LAMPORTS_PER_SOL}`);
    assert.equal(user1AccountAfterWager.activeWagers.length, 1);
    assert.equal(user1AccountAfterWager.currentBalance.toNumber(), LAMPORTS_PER_SOL * 0.5);
    
    // Test the newly modified bet state obj with the updates from the placed wager
    console.log(`Bet state static total pool after first wager placement: ${betStateAfterWager.staticTotalPool.toNumber()/LAMPORTS_PER_SOL}`);
    console.log(`Bet state running total pool after first wager placement: ${betStateAfterWager.runningTotalPool.toNumber()/LAMPORTS_PER_SOL}`);
    console.log(`Bet state party 1 pool after first wager placement: ${betStateAfterWager.partyOnePool.toNumber()/LAMPORTS_PER_SOL}`);
    console.log(`Bet state party 2 pool after first wager placement: ${betStateAfterWager.partyTwoPool.toNumber()/LAMPORTS_PER_SOL}`);
    console.log(`Bet State lamports after first wager placement: ${await program.provider.connection.getBalance(betStateKP.publicKey)/LAMPORTS_PER_SOL}`)





          ///// USER 2 /////




    ///// ***** USER 2 CREATES ACCOUNT ***** /////

    const user2KP = anchor.web3.Keypair.generate();
    const user2_airdrop_sig = await program.provider.connection.requestAirdrop(user2KP.publicKey, 2000000000)
    await program.provider.connection.confirmTransaction(user2_airdrop_sig, "finalized");

    const user2AccountKP = anchor.web3.Keypair.generate();

    console.log("Initializaing User 2 Account...");

    await program.rpc.initializeUserAccount({
      accounts: {
        userAccount: user2AccountKP.publicKey,
        accountOwner: user2KP.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId
      },
      signers: [user2KP, user2AccountKP]
    })

    const user2Account = await program.account.userAccount.fetch(user2AccountKP.publicKey);

    assert.ok(user2Account);
    console.log(`Bettor 2 User Account: ${JSON.stringify(user2Account)}`);
    assert.equal(user2Account.currentBalance.toNumber(), 0)
    assert.equal(user2Account.wins.toNumber(), 0)
    assert.equal(user2Account.losses.toNumber(), 0)




    ///// ***** USER 2 DEPOSITS LAMPORTS INTO USER 1 ACCOUNT ***** /////

    const user2_lamports_deposit_num = LAMPORTS_PER_SOL * 1
    const user2_lamports_to_deposit = new anchor.BN(LAMPORTS_PER_SOL * 1);

    console.log("User 2 Depositing...");

    await program.rpc.depositIntoAccount(user2_lamports_to_deposit, {
      accounts: {
        userAccount: user2AccountKP.publicKey,
        accountOwner: user2KP.publicKey
      },
      preInstructions: [
        await SystemProgram.transfer({
          fromPubkey: user2KP.publicKey,
          lamports: user2_lamports_deposit_num,
          toPubkey: user2AccountKP.publicKey
        })
      ],
      signers:[user2AccountKP, user2KP]
    })

    const user2AccountAfterDeposit = await program.account.userAccount.fetch(user2AccountKP.publicKey);

    console.log(`User 2 User Account After 1 Sol Deposit: ${JSON.stringify(user2AccountAfterDeposit)}`);
    assert.equal(user2AccountAfterDeposit.currentBalance.toNumber(), 1000000000);
    assert.equal(user2AccountAfterDeposit.wins.toNumber(), 0);
    assert.equal(user2AccountAfterDeposit.losses.toNumber(), 0);
    assert.equal(user2AccountAfterDeposit.accountOwner.toString(), user2KP.publicKey.toString());




    ///// ***** USER 2 PLACE WAGER FUNCTIONALITY ***** /////

    const wagerDetail2KP = anchor.web3.Keypair.generate();
    const user2_party = 1;
    const user2_lamports_to_wager = new anchor.BN(LAMPORTS_PER_SOL * 0.5);

    console.log(`Bet State lamports before second wager placement: ${await program.provider.connection.getBalance(betStateKP.publicKey)/LAMPORTS_PER_SOL}`)
    console.log(`User 2 Account lamports before second wager placement: ${await program.provider.connection.getBalance(user2AccountKP.publicKey)/LAMPORTS_PER_SOL}`)
    
    console.log("User 2 placing wager...");

    await program.rpc.placeWager(user2_party, user2_lamports_to_wager, {
      accounts: {
        betState: betStateKP.publicKey,
        wagerDetail: wagerDetail2KP.publicKey,
        userAccount: user2AccountKP.publicKey,
        bettorAccount: user2KP.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId
      },
      signers: [betStateKP, wagerDetail2KP, user2KP, user2AccountKP]
    })

    const wagerDetails2Account = await program.account.wagerDetail.fetch(wagerDetail2KP.publicKey);
    const userAccount2AfterWager = await program.account.userAccount.fetch(user2AccountKP.publicKey);

    // Test the newly created bettor detail account and associated changes
    assert.ok(wagerDetails2Account);
    console.log(wagerDetails2Account)
    assert.ok(wagerDetails2Account.bettor.equals(user2KP.publicKey), `The attached bettor address: ${wagerDetails2Account.bettor.toString()} attached to this bettor detail does not match with the correct betting user address: ${user2KP.publicKey.toString()}`);
    assert.ok(wagerDetails2Account.betState.equals(betStateKP.publicKey), `The attached bet state: ${wagerDetails2Account.betState.toString()} attached to this bettor detail does not match with the correct bet state: ${betStateKP.publicKey.toString()}`);
    assert.ok(wagerDetails2Account.betValue.eq(new anchor.BN(user2_lamports_to_wager)), `Lamports we expect to bet: ${user2_lamports_to_wager} are not equal to the expected amount: ${wagerDetails2Account.betValue.toNumber()}`);

    // Test the right number of lamports were transferred from user account to betState
    console.log(`User 2 Account lamports after first wager placement: ${await program.provider.connection.getBalance(user2AccountKP.publicKey)/LAMPORTS_PER_SOL}`)
    console.log(`Bettor 2 User Account Balance after wager: ${userAccount2AfterWager.currentBalance.toNumber()/LAMPORTS_PER_SOL}`);
    assert.equal(userAccount2AfterWager.activeWagers.length, 1);
    assert.equal(userAccount2AfterWager.currentBalance.toNumber(), LAMPORTS_PER_SOL * 0.5);
    
    // Test the newly modified bet state obj with the updates from the placed wager
    console.log(`Bet state static total pool after second wager placement: ${betStateAfterWager.staticTotalPool.toNumber()/LAMPORTS_PER_SOL}`);
    console.log(`Bet state running total pool after second wager placement: ${betStateAfterWager.runningTotalPool.toNumber()/LAMPORTS_PER_SOL}`);
    console.log(`Bet state party 1 pool after second wager placement: ${betStateAfterWager.partyOnePool.toNumber()/LAMPORTS_PER_SOL}`);
    console.log(`Bet state party 2 pool after second wager placement: ${betStateAfterWager.partyTwoPool.toNumber()/LAMPORTS_PER_SOL}`);
    console.log(`Bet State lamports after second wager placement: ${await program.provider.connection.getBalance(betStateKP.publicKey)/LAMPORTS_PER_SOL}`)





              ///// USER 3 /////




    ///// ***** USER 3 CREATES ACCOUNT ***** /////

    const user3KP = anchor.web3.Keypair.generate();
    const user3_airdrop_sig = await program.provider.connection.requestAirdrop(user3KP.publicKey, 2000000000)
    await program.provider.connection.confirmTransaction(user3_airdrop_sig, "finalized");

    const user3AccountKP = anchor.web3.Keypair.generate();

    console.log("Initializaing User 3 Account...");

    await program.rpc.initializeUserAccount({
      accounts: {
        userAccount: user3AccountKP.publicKey,
        accountOwner: user3KP.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId
      },
      signers: [user3KP, user3AccountKP]
    })

    const user3Account = await program.account.userAccount.fetch(user3AccountKP.publicKey);

    assert.ok(user3Account);
    console.log(`Bettor 3 User Account: ${JSON.stringify(user3Account)}`);
    assert.equal(user3Account.currentBalance.toNumber(), 0)
    assert.equal(user3Account.wins.toNumber(), 0)
    assert.equal(user3Account.losses.toNumber(), 0)




    ///// ***** USER 3 DEPOSITS LAMPORTS INTO USER 1 ACCOUNT ***** /////

    const user3_lamports_deposit_num = LAMPORTS_PER_SOL * 1
    const user3_lamports_to_deposit = new anchor.BN(LAMPORTS_PER_SOL * 1);

    console.log("User 3 Depositing...");

    await program.rpc.depositIntoAccount(user3_lamports_to_deposit, {
      accounts: {
        userAccount: user3AccountKP.publicKey,
        accountOwner: user3KP.publicKey
      },
      preInstructions: [
        await SystemProgram.transfer({
          fromPubkey: user3KP.publicKey,
          lamports: user3_lamports_deposit_num,
          toPubkey: user3AccountKP.publicKey
        })
      ],
      signers:[user3AccountKP, user3KP]
    })

    const user3AccountAfterDeposit = await program.account.userAccount.fetch(user3AccountKP.publicKey);

    console.log(`User 3 User Account After 1 Sol Deposit: ${JSON.stringify(user3AccountAfterDeposit)}`);
    assert.equal(user3AccountAfterDeposit.currentBalance.toNumber(), 1000000000);
    assert.equal(user3AccountAfterDeposit.wins.toNumber(), 0);
    assert.equal(user3AccountAfterDeposit.losses.toNumber(), 0);
    assert.equal(user3AccountAfterDeposit.accountOwner.toString(), user3KP.publicKey.toString());


    ///// ***** CLOSING A BET STATE ***** /////

    const end_time = new anchor.BN(Date.now());

    const betStateBeforeClosing = await program.account.betState.fetch(betStateKP.publicKey);
    assert.ok(betStateBeforeClosing.status.hasOwnProperty("open"));

    await program.rpc.closeBetState(
      end_time,
      {
        accounts: {
          betState: betStateKP.publicKey
        },
        signers:[betStateKP]
      }
    )

    const betStateAfterClosing = await program.account.betState.fetch(betStateKP.publicKey);
    assert.ok(betStateAfterClosing);
    assert.ok(betStateAfterClosing.betOutcome.hasOwnProperty("undecided"));
    assert.ok(betStateAfterClosing.status.hasOwnProperty("closed"));


    try {

      ///// ***** USER 3 PLACE WAGER FUNCTIONALITY ***** /////

      const wagerDetail3KP = anchor.web3.Keypair.generate();
      const user3_party = 2;
      const user3_lamports_to_wager = new anchor.BN(LAMPORTS_PER_SOL * 0.5);

      console.log(`Bet State lamports before third wager placement: ${await program.provider.connection.getBalance(betStateKP.publicKey)/LAMPORTS_PER_SOL}`)
      console.log(`User 3 Account lamports before third wager placement: ${await program.provider.connection.getBalance(user3AccountKP.publicKey)/LAMPORTS_PER_SOL}`)
      
      console.log("User 3 placing wager...");

      await program.rpc.placeWager(user3_party, user3_lamports_to_wager, {
        accounts: {
          betState: betStateKP.publicKey,
          wagerDetail: wagerDetail3KP.publicKey,
          userAccount: user3AccountKP.publicKey,
          bettorAccount: user3KP.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId
        },
        signers: [betStateKP, wagerDetail3KP, user3KP, user3AccountKP]
      })
      
    } catch (error) {
      assert.equal(error, 'Cannot carry out this action when the bet is closed or is already settled.');
      return;
    }

  });


  // Closing/Cancelling Bets //

  it.skip('Cannot close a bet when either party has > 0 funds in its pool', async() => {
  
    const betCreatorKeyPair = anchor.web3.Keypair.generate();
    const sig = await program.provider.connection.requestAirdrop(betCreatorKeyPair.publicKey, 2000000000)
    await program.provider.connection.confirmTransaction(sig, "finalized");

    ///// ***** INITIALIZE BET FUNCTIONALITY ***** /////

    // Generate a new random keypair for betState
    const betStateKeyPair = anchor.web3.Keypair.generate();

    const start = new anchor.BN(Date.now());
    const duration = new anchor.BN(5 * 60 * 1000);

    console.log("Starting the 'initialize bet state' functionality");

    // Add your test here.
    const initializeBetStateTX = await initializeBetState(anchor, program, start, duration, betStateKeyPair, betCreatorKeyPair);
    
    console.log("Your 'initializeBetStateTX' transaction signature", initializeBetStateTX);

    let betStateAccount = await program.account.betState.fetch(betStateKeyPair.publicKey);

    console.log(`${JSON.stringify(betStateAccount)}`);

    assert.ok(betStateAccount);
    assert.equal(betStateAccount.creator.toString, betCreatorKeyPair.publicKey.toString);
    assert.ok(betStateAccount.staticTotalPool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.runningTotalPool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.partyOnePool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.partyTwoPool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.status.hasOwnProperty("open"));
    assert.ok(betStateAccount.betOutcome.hasOwnProperty("undecided"));




    ///// ***** PLACE WAGER FUNCTIONALITY FOR BETTOR 1 ***** /////

    const wagerDetail1 = anchor.web3.Keypair.generate();
    const wagerDetail1Party = 1;
    const bettor_1_actual_bet_amount = 1 * LAMPORTS_PER_SOL;
    const bettor_1_lamports_to_transfer = bettor_1_actual_bet_amount + (bettor_1_actual_bet_amount * JUICED_BETS_TAKE_RATE);
    const bettor_1_lamports_to_bet_param = new anchor.BN(bettor_1_actual_bet_amount);
    
    console.log("Starting the 'place wager' functionality for bettor 1");

    await placeWager(anchor, program, wagerDetail1Party, bettor_1_lamports_to_bet_param, betStateKeyPair, wagerDetail1, betCreatorKeyPair, bettor_1_lamports_to_transfer, SystemProgram)

    const wagerDetailsAccount1 = await program.account.wagerDetail.fetch(wagerDetail1.publicKey);
    assert.ok(wagerDetailsAccount1);
    assert.ok(wagerDetailsAccount1.bettor.equals(betCreatorKeyPair.publicKey), `The attached bettor address: ${wagerDetailsAccount1.bettor.toString()} attached to this bettor detail does not match with the correct betting user address: ${betCreatorKeyPair.publicKey.toString()}`);
    assert.ok(wagerDetailsAccount1.betState.equals(betStateKeyPair.publicKey), `The attached bet state: ${wagerDetailsAccount1.betState.toString()} attached to this bettor detail does not match with the correct bet state: ${betStateKeyPair.publicKey.toString()}`);
    assert.ok(wagerDetailsAccount1.betValue.eq(bettor_1_lamports_to_bet_param), `Lamports we expect to bet: ${bettor_1_lamports_to_bet_param.toNumber()} are not equal to the expected amount: ${wagerDetailsAccount1.betValue.toNumber()}`);





    ///// ***** CLOSE BET FUNCTIONALITY ***** //////
    try {
      const end_time = new anchor.BN(Date.now());
      await program.rpc.closeBetState(
        end_time,
        {
          accounts: {
            betState: betStateKeyPair.publicKey
          },
          signers:[betStateKeyPair]
        }
      )
    } catch (error) {
      assert.equal(error,'Cannot carry out this action until all funds are withdrawn.');
      return;
    }

  });


  // Claiming Winnings //

  it.skip('Cannot claim winnings when the bet state outcome is still open', async() => {

    const betCreatorKeyPair = anchor.web3.Keypair.generate();
    const sig = await program.provider.connection.requestAirdrop(betCreatorKeyPair.publicKey, 2000000000)
    await program.provider.connection.confirmTransaction(sig, "finalized");

    ///// ***** INITIALIZE BET FUNCTIONALITY ***** /////

    // Generate a new random keypair for betState
    const betStateKeyPair = anchor.web3.Keypair.generate();

    const start = new anchor.BN(Date.now());
    const duration = new anchor.BN(5 * 60 * 1000);

    console.log("Starting the 'initialize bet state' functionality");

    // Add your test here.
    const initializeBetStateTX = await initializeBetState(anchor, program, start, duration, betStateKeyPair, betCreatorKeyPair);
    
    console.log("Your 'initializeBetStateTX' transaction signature", initializeBetStateTX);

    let betStateAccount = await program.account.betState.fetch(betStateKeyPair.publicKey);

    console.log(`${JSON.stringify(betStateAccount)}`);

    assert.ok(betStateAccount);
    assert.equal(betStateAccount.creator.toString, betCreatorKeyPair.publicKey.toString);
    assert.ok(betStateAccount.staticTotalPool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.runningTotalPool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.partyOnePool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.partyTwoPool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.status.hasOwnProperty("open"));
    assert.ok(betStateAccount.betOutcome.hasOwnProperty("undecided"));




    ///// ***** PLACE WAGER FUNCTIONALITY FOR BETTOR 1 ***** /////

    const wagerDetail1 = anchor.web3.Keypair.generate();
    const wagerDetail1Party = 1;
    const bettor_1_actual_bet_amount = 1 * LAMPORTS_PER_SOL;
    const bettor_1_lamports_to_transfer = bettor_1_actual_bet_amount + (bettor_1_actual_bet_amount * JUICED_BETS_TAKE_RATE);
    const bettor_1_lamports_to_bet_param = new anchor.BN(bettor_1_actual_bet_amount);
    
    console.log("Starting the 'place wager' functionality for bettor 1");

    await placeWager(anchor, program, wagerDetail1Party, bettor_1_lamports_to_bet_param, betStateKeyPair, wagerDetail1, betCreatorKeyPair, bettor_1_lamports_to_transfer, SystemProgram)

    const wagerDetailsAccount1 = await program.account.wagerDetail.fetch(wagerDetail1.publicKey);
    assert.ok(wagerDetailsAccount1);
    assert.ok(wagerDetailsAccount1.bettor.equals(betCreatorKeyPair.publicKey), `The attached bettor address: ${wagerDetailsAccount1.bettor.toString()} attached to this bettor detail does not match with the correct betting user address: ${betCreatorKeyPair.publicKey.toString()}`);
    assert.ok(wagerDetailsAccount1.betState.equals(betStateKeyPair.publicKey), `The attached bet state: ${wagerDetailsAccount1.betState.toString()} attached to this bettor detail does not match with the correct bet state: ${betStateKeyPair.publicKey.toString()}`);
    assert.ok(wagerDetailsAccount1.betValue.eq(bettor_1_lamports_to_bet_param), `Lamports we expect to bet: ${bettor_1_lamports_to_bet_param.toNumber()} are not equal to the expected amount: ${wagerDetailsAccount1.betValue.toNumber()}`);



    ///// ***** PLACE WAGER FUNCTIONALITY FOR BETTOR 2 ***** /////

    const wagerDetail2 = anchor.web3.Keypair.generate();
    const wagerDetail2Party = 1;
    const bettor_2_actual_bet_amount = 1 * LAMPORTS_PER_SOL;
    const bettor_2_lamports_to_transfer = bettor_2_actual_bet_amount + (bettor_2_actual_bet_amount * JUICED_BETS_TAKE_RATE);
    const bettor_2_lamports_to_bet_param = new anchor.BN(bettor_2_actual_bet_amount);

    // Generate a betting user
    const bettingUser2 = anchor.web3.Keypair.generate();
    const bettingUser2PubKey = bettingUser2.publicKey;
    const bettor_2_airdrop_sig = await program.provider.connection.requestAirdrop(bettingUser2PubKey, 2000000000)
    await program.provider.connection.confirmTransaction(bettor_2_airdrop_sig, "finalized");
    
    console.log("Starting the 'place wager' functionality for bettor 2");

    await placeWager(anchor, program, wagerDetail2Party, bettor_2_lamports_to_bet_param, betStateKeyPair, wagerDetail2, bettingUser2, bettor_2_lamports_to_transfer, SystemProgram)

    const wagerDetailsAccount2 = await program.account.wagerDetail.fetch(wagerDetail2.publicKey);
    assert.ok(wagerDetailsAccount2);
    assert.ok(wagerDetailsAccount2.bettor.equals(bettingUser2PubKey), `The attached bettor address: ${wagerDetailsAccount2.bettor.toString()} attached to this bettor detail does not match with the correct betting user address: ${bettingUser2PubKey.toString()}`);
    assert.ok(wagerDetailsAccount2.betState.equals(betStateKeyPair.publicKey), `The attached bet state: ${wagerDetailsAccount2.betState.toString()} attached to this bettor detail does not match with the correct bet state: ${betStateKeyPair.publicKey.toString()}`);
    assert.ok(wagerDetailsAccount2.betValue.eq(bettor_2_lamports_to_bet_param), `Lamports we expect to bet: ${bettor_2_lamports_to_bet_param.toNumber()} are not equal to the expected amount: ${wagerDetailsAccount2.betValue.toNumber()}`);




    ///// ***** PLACE WAGER FUNCTIONALITY FOR BETTOR 3 ***** /////

    const wagerDetail3 = anchor.web3.Keypair.generate();
    const wagerDetail3Party = 2;
    const bettor_3_actual_bet_amount = 1 * LAMPORTS_PER_SOL;
    const bettor_3_lamports_to_transfer = bettor_3_actual_bet_amount + (bettor_3_actual_bet_amount * JUICED_BETS_TAKE_RATE);
    const bettor_3_lamports_to_bet_param = new anchor.BN(bettor_3_actual_bet_amount);

    // Generate a betting user
    const bettingUser3 = anchor.web3.Keypair.generate();
    const bettingUser3PubKey = bettingUser3.publicKey;
    const bettor_3_airdrop_sig = await program.provider.connection.requestAirdrop(bettingUser3PubKey, 2000000000)
    await program.provider.connection.confirmTransaction(bettor_3_airdrop_sig, "finalized");

    await placeWager(anchor, program, wagerDetail3Party, bettor_3_lamports_to_bet_param, betStateKeyPair, wagerDetail3, bettingUser3, bettor_3_lamports_to_transfer, SystemProgram)

    const wagerDetailsAccount3 = await program.account.wagerDetail.fetch(wagerDetail3.publicKey);
    assert.ok(wagerDetailsAccount3);
    assert.ok(wagerDetailsAccount3.bettor.equals(bettingUser3PubKey), `The attached bettor address: ${wagerDetailsAccount3.bettor.toString()} attached to this bettor detail does not match with the correct betting user address: ${bettingUser3PubKey.toString()}`);
    assert.ok(wagerDetailsAccount3.betState.equals(betStateKeyPair.publicKey), `The attached bet state: ${wagerDetailsAccount3.betState.toString()} attached to this bettor detail does not match with the correct bet state: ${betStateKeyPair.publicKey.toString()}`);
    assert.ok(wagerDetailsAccount3.betValue.eq(bettor_3_lamports_to_bet_param), `Lamports we expect to bet: ${bettor_3_lamports_to_bet_param.toNumber()} are not equal to the expected amount: ${wagerDetailsAccount3.betValue.toNumber()}`);

    const betStateAfterThreeBets = await program.account.betState.fetch(betStateKeyPair.publicKey);

    const bettor1Winnings = new anchor.BN(calculateWinnings(wagerDetailsAccount1, betStateAfterThreeBets));
    const bettor2Winnings = new anchor.BN(calculateWinnings(wagerDetailsAccount2, betStateAfterThreeBets));
    const bettor3Winnings = new anchor.BN(calculateWinnings(wagerDetailsAccount3, betStateAfterThreeBets));




    ///// ***** CLAIM WINNINGS ***** /////

    try {
      await program.rpc.claimWinnings(
        bettor1Winnings,
        {
          accounts: {
            betState: betStateKeyPair.publicKey,
            wagerDetail: wagerDetail1.publicKey,
            bettor: betCreatorKeyPair.publicKey
          },
          signers:[betStateKeyPair, wagerDetail1, betCreatorKeyPair]
        }
      )
    } catch (error) {
      assert.equal(error.msg, 'Cannot carry out this action while the bet is still open.');
      return;
    }
    
  });

  it.skip('Cannot claim winnings when the bet state outcome is closed, but still undecided', async() => {

    const betCreatorKeyPair = anchor.web3.Keypair.generate();
    const sig = await program.provider.connection.requestAirdrop(betCreatorKeyPair.publicKey, 2000000000)
    await program.provider.connection.confirmTransaction(sig, "finalized");


    ///// ***** INITIALIZE BET FUNCTIONALITY ***** /////

    // Generate a new random keypair for betState
    const betStateKeyPair = anchor.web3.Keypair.generate();

    const start = new anchor.BN(Date.now());
    const duration = new anchor.BN(5 * 60 * 1000);

    console.log("Starting the 'initialize bet state' functionality");

    // Add your test here.
    const initializeBetStateTX = await initializeBetState(anchor, program, start, duration, betStateKeyPair, betCreatorKeyPair);
    
    console.log("Your 'initializeBetStateTX' transaction signature", initializeBetStateTX);

    let betStateAccount = await program.account.betState.fetch(betStateKeyPair.publicKey);

    console.log(`${JSON.stringify(betStateAccount)}`);

    assert.ok(betStateAccount);
    assert.equal(betStateAccount.creator.toString, betCreatorKeyPair.publicKey.toString);
    assert.ok(betStateAccount.staticTotalPool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.runningTotalPool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.partyOnePool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.partyTwoPool.eq(new anchor.BN(0)));
    assert.ok(betStateAccount.status.hasOwnProperty("open"));
    assert.ok(betStateAccount.betOutcome.hasOwnProperty("undecided"));




    ///// ***** PLACE WAGER FUNCTIONALITY FOR BETTOR 1 ***** /////

    const wagerDetail1 = anchor.web3.Keypair.generate();
    const wagerDetail1Party = 1;
    const bettor_1_actual_bet_amount = 1 * LAMPORTS_PER_SOL;
    const bettor_1_lamports_to_transfer = bettor_1_actual_bet_amount + (bettor_1_actual_bet_amount * JUICED_BETS_TAKE_RATE);
    const bettor_1_lamports_to_bet_param = new anchor.BN(bettor_1_actual_bet_amount);
    
    console.log("Starting the 'place wager' functionality for bettor 1");

    await placeWager(anchor, program, wagerDetail1Party, bettor_1_lamports_to_bet_param, betStateKeyPair, wagerDetail1, betCreatorKeyPair, bettor_1_lamports_to_transfer, SystemProgram)

    const wagerDetailsAccount1 = await program.account.wagerDetail.fetch(wagerDetail1.publicKey);
    assert.ok(wagerDetailsAccount1);
    assert.ok(wagerDetailsAccount1.bettor.equals(betCreatorKeyPair.publicKey), `The attached bettor address: ${wagerDetailsAccount1.bettor.toString()} attached to this bettor detail does not match with the correct betting user address: ${betCreatorKeyPair.publicKey.toString()}`);
    assert.ok(wagerDetailsAccount1.betState.equals(betStateKeyPair.publicKey), `The attached bet state: ${wagerDetailsAccount1.betState.toString()} attached to this bettor detail does not match with the correct bet state: ${betStateKeyPair.publicKey.toString()}`);
    assert.ok(wagerDetailsAccount1.betValue.eq(bettor_1_lamports_to_bet_param), `Lamports we expect to bet: ${bettor_1_lamports_to_bet_param.toNumber()} are not equal to the expected amount: ${wagerDetailsAccount1.betValue.toNumber()}`);



    ///// ***** PLACE WAGER FUNCTIONALITY FOR BETTOR 2 ***** /////

    const wagerDetail2 = anchor.web3.Keypair.generate();
    const wagerDetail2Party = 1;
    const bettor_2_actual_bet_amount = 1 * LAMPORTS_PER_SOL;
    const bettor_2_lamports_to_transfer = bettor_2_actual_bet_amount + (bettor_2_actual_bet_amount * JUICED_BETS_TAKE_RATE);
    const bettor_2_lamports_to_bet_param = new anchor.BN(bettor_2_actual_bet_amount);

    // Generate a betting user
    const bettingUser2 = anchor.web3.Keypair.generate();
    const bettingUser2PubKey = bettingUser2.publicKey;
    const bettor_2_airdrop_sig = await program.provider.connection.requestAirdrop(bettingUser2PubKey, 2000000000)
    await program.provider.connection.confirmTransaction(bettor_2_airdrop_sig, "finalized");
    
    console.log("Starting the 'place wager' functionality for bettor 2");

    await placeWager(anchor, program, wagerDetail2Party, bettor_2_lamports_to_bet_param, betStateKeyPair, wagerDetail2, bettingUser2, bettor_2_lamports_to_transfer, SystemProgram)

    const wagerDetailsAccount2 = await program.account.wagerDetail.fetch(wagerDetail2.publicKey);
    assert.ok(wagerDetailsAccount2);
    assert.ok(wagerDetailsAccount2.bettor.equals(bettingUser2PubKey), `The attached bettor address: ${wagerDetailsAccount2.bettor.toString()} attached to this bettor detail does not match with the correct betting user address: ${bettingUser2PubKey.toString()}`);
    assert.ok(wagerDetailsAccount2.betState.equals(betStateKeyPair.publicKey), `The attached bet state: ${wagerDetailsAccount2.betState.toString()} attached to this bettor detail does not match with the correct bet state: ${betStateKeyPair.publicKey.toString()}`);
    assert.ok(wagerDetailsAccount2.betValue.eq(bettor_2_lamports_to_bet_param), `Lamports we expect to bet: ${bettor_2_lamports_to_bet_param.toNumber()} are not equal to the expected amount: ${wagerDetailsAccount2.betValue.toNumber()}`);




    ///// ***** PLACE WAGER FUNCTIONALITY FOR BETTOR 3 ***** /////

    const wagerDetail3 = anchor.web3.Keypair.generate();
    const wagerDetail3Party = 2;
    const bettor_3_actual_bet_amount = 1 * LAMPORTS_PER_SOL;
    const bettor_3_lamports_to_transfer = bettor_3_actual_bet_amount + (bettor_3_actual_bet_amount * JUICED_BETS_TAKE_RATE);
    const bettor_3_lamports_to_bet_param = new anchor.BN(bettor_3_actual_bet_amount);

    // Generate a betting user
    const bettingUser3 = anchor.web3.Keypair.generate();
    const bettingUser3PubKey = bettingUser3.publicKey;
    const bettor_3_airdrop_sig = await program.provider.connection.requestAirdrop(bettingUser3PubKey, 2000000000)
    await program.provider.connection.confirmTransaction(bettor_3_airdrop_sig, "finalized");

    await placeWager(anchor, program, wagerDetail3Party, bettor_3_lamports_to_bet_param, betStateKeyPair, wagerDetail3, bettingUser3, bettor_3_lamports_to_transfer, SystemProgram)

    const wagerDetailsAccount3 = await program.account.wagerDetail.fetch(wagerDetail3.publicKey);
    assert.ok(wagerDetailsAccount3);
    assert.ok(wagerDetailsAccount3.bettor.equals(bettingUser3PubKey), `The attached bettor address: ${wagerDetailsAccount3.bettor.toString()} attached to this bettor detail does not match with the correct betting user address: ${bettingUser3PubKey.toString()}`);
    assert.ok(wagerDetailsAccount3.betState.equals(betStateKeyPair.publicKey), `The attached bet state: ${wagerDetailsAccount3.betState.toString()} attached to this bettor detail does not match with the correct bet state: ${betStateKeyPair.publicKey.toString()}`);
    assert.ok(wagerDetailsAccount3.betValue.eq(bettor_3_lamports_to_bet_param), `Lamports we expect to bet: ${bettor_3_lamports_to_bet_param.toNumber()} are not equal to the expected amount: ${wagerDetailsAccount3.betValue.toNumber()}`);

    const betStateAfterThreeBets = await program.account.betState.fetch(betStateKeyPair.publicKey);

    const bettor1Winnings = new anchor.BN(calculateWinnings(wagerDetailsAccount1, betStateAfterThreeBets));
    const bettor2Winnings = new anchor.BN(calculateWinnings(wagerDetailsAccount2, betStateAfterThreeBets));
    const bettor3Winnings = new anchor.BN(calculateWinnings(wagerDetailsAccount3, betStateAfterThreeBets));




    ///// ***** CLOSING A BET STATE ***** /////

    const end_time = new anchor.BN(Date.now());

    const betStateBeforeClosing = await program.account.betState.fetch(betStateKeyPair.publicKey);
    assert.ok(betStateBeforeClosing.status.hasOwnProperty("open"));

    await program.rpc.closeBetState(
      end_time,
      {
        accounts: {
          betState: betStateKeyPair.publicKey
        },
        signers:[betStateKeyPair]
      }
    )

    const betStateAfterClosing = await program.account.betState.fetch(betStateKeyPair.publicKey);
    assert.ok(betStateAfterClosing);
    assert.ok(betStateAfterClosing.betOutcome.hasOwnProperty("undecided"));
    assert.ok(betStateAfterClosing.status.hasOwnProperty("closed"));




    ///// ***** CLAIM WINNINGS ***** /////

    try {
      await program.rpc.claimWinnings(
        bettor1Winnings,
        {
          accounts: {
            betState: betStateKeyPair.publicKey,
            wagerDetail: wagerDetail1.publicKey,
            bettor: betCreatorKeyPair.publicKey
          },
          signers:[betStateKeyPair, wagerDetail1, betCreatorKeyPair]
        }
      )
    } catch (error) {
      assert.equal(error,'Cannot carry out this action while the bet is still undecided on a winner.');
      return;
    }
    
  });


});

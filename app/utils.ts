export const calculateWinnings = (bettorDetail, betState) => {
  try {

    const partyOnePool: number = betState.partyOnePool.toNumber();
    const partyTwoPool: number = betState.partyTwoPool.toNumber();
    const bettorsBetValue: number = bettorDetail.betValue.toNumber();

    let poolWeight: number;
    let winnings: number;

    if (bettorDetail.party.hasOwnProperty("partyOne")) {
      poolWeight = bettorsBetValue/partyOnePool;
      winnings = bettorsBetValue + (poolWeight * partyTwoPool);
    } else if (bettorDetail.party.hasOwnProperty("partyTwo")) {
      poolWeight = bettorsBetValue/partyTwoPool;
      winnings = bettorsBetValue + (poolWeight * partyOnePool);
    } else {
      throw new Error("bettor does not belong to a valid party");
    }

    return winnings
    
  } catch (error) {

    throw new Error(error)
    
  }

}

export const findWagerForUser = async (program, betState) => await program.account.bettorDetail.all([
  {
    memcmp: {
      offset: 8 + 32,
      bytes: betState.publicKey.toBase58(),
    }
  }
]);


// Bet State Functions

export const getAllBets = async (program) => await program.account.betState.all();

export const getSingleBet = async (program, betStateKP) => await program.account.betState.fetch(betStateKP.publicKey);


// Wager Functions

export const getAllWagersByUser = async (program) => await program.account.betState.all();

export const getOneWagerByUser = async (program, bettorDetailKP) => await program.account.betState.fetch(bettorDetailKP.publicKey);


// User Account Functions

export const getUserAccount = async (program, userKP) => await program.account.userAccount.all([
  {
    memcmp: {
      offset: 8,
      bytes: userKP.publicKey.toBase58(),
    }
  }
])

export const getUserWagers = async (userAccount) => {
  userAccount.activeWagers
}

export const matchingWagerFound = (program, userAccount, betStateKP) => {

  if (userAccount.activeWagers.length == 0) {
    return false
  }

  const matches = userAccount.activeWagers.map( async el => {
    const wager = await program.account.bettorDetail.fetch(el.toString())
    wager.betState.toString() == betStateKP.publicKey.toString()
  })

  if (matches.length > 0) {
    return true
  }

  return false
}


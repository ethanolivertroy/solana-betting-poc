import { Program, Provider } from '@project-serum/anchor'
import { useWallet } from '@solana/wallet-adapter-react'
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Asset } from '../../models/asset-type'
import { BET_CREATOR_WALLET, PARTY_ONE, PARTY_TWO, RANGE_ENUM, SOL_TOKEN_LOGO, TAKER_FEE } from '../../models/constants'
import useAssetsStore from '../../stores/stocks'
import userAccountStore from '../../stores/user-state'
import idl from '../../idl.json'
import * as anchor from '@project-serum/anchor';
import './betting-page.scss';
import { LoadingAnimation } from '../../shared/components/svgs'
import { failureToast, successToast } from '../../shared/toasts'
import { Switch } from '@headlessui/react'

const BettingPage = () => {
    const params = useParams()
    const wallet = useWallet()
    // TODO: Add error handling for if ticker is empty
    const asset = useAssetsStore(s => s.assets[params["ticker"]!])
    const isLoaded = useAssetsStore(s => s.isLoaded["pythProductData"])
    const isAccountLoaded = userAccountStore(s => s.isAccountLoaded)
    const userAccount = userAccountStore(s => s.userAccount)
    const ranges = [[-Infinity, -0.03], [-0.03, -0.02], [-0.02, -0.01], [-0.01, 0], [0, 0.01], [0.01, 0.02], [0.02, 0.03], [0.03, Infinity]]
    const [balance, setBalance] = useState(-1)
    const [wagerAmount, setWagerAmount] = useState('')
    const [selectedRange, setSelectedRange] = useState<number | null>(null)
    const [displayBetDialog, setDisplayBetDialog] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [isBettingAgainst, setIsBettingAgainst] = useState(false)

    useEffect(() => {
        if (!userAccount) { return }
        setBalance(userAccount!.currentBalance.toNumber() / LAMPORTS_PER_SOL || -1)
    }, [userAccount])

    useEffect(() => {
        setDisplayBetDialog(selectedRange != null)
    }, [selectedRange])

    async function placeWager() {
        let wager = Number(wagerAmount)
        if (wager > balance || wager < 0) {
            failureToast('Insufficient amount of SOL to bet with.')
            return
        }

        const network = "http://127.0.0.1:8899";
        const connection = new Connection(network, 'processed')
        // @ts-ignore
        const provider = new Provider(connection, wallet, 'processed')

        const programId = idl.metadata.address
        const program = new Program(idl as any, programId, provider)
        if (!wallet.connected) {
            console.error('Wallet not connected.')
            return
        }

        setIsSubmitting(true)
        const ticker = asset.ticker
        const ranges = Object.keys(RANGE_ENUM)
        const betStates = await program.account.betState.all()
        const filteredStates = betStates.filter(state => state.account.symbol == ticker && state.account.betRange[ranges[selectedRange!]])

        let betState;
        if (filteredStates.length != 0) {
            betState = filteredStates[0]
        } else {
            // Create bet state
            const betStateKeypair = anchor.web3.Keypair.generate()
            const start = new anchor.BN(Date.now())
            const duration = new anchor.BN(1000 * 60)
            const price = new anchor.BN(asset.price)
            const range = new anchor.BN(selectedRange!)

            await program.rpc.initializeBetState(start, duration, ticker, price, range, {
                accounts: {
                    betState: betStateKeypair.publicKey,
                    betCreator: provider.wallet.publicKey,
                    systemProgram: anchor.web3.SystemProgram.programId
                },
                signers: [betStateKeypair]
            }).catch(e => {
                setIsSubmitting(false)
                failureToast('Error initializing bet state.')
            })

            betState = await program.account.betState.fetch(betStateKeypair.publicKey)
            betState.publicKey = betStateKeypair.publicKey
        }

        const wagerDetailKP = Keypair.generate()
        const wagerToPlace = new anchor.BN(wager * (1 + TAKER_FEE) * LAMPORTS_PER_SOL)
        const party = isBettingAgainst ? PARTY_TWO : PARTY_ONE

        if (wager < 1) {
            console.error('ERROR: Do not have enough SOL in user account. Consider adding some.')
            setIsSubmitting(false)
            return
        }

        program.rpc.placeWager(new anchor.BN(party), wagerToPlace, {
            accounts: {
                betState: betState.publicKey,
                wagerDetail: wagerDetailKP.publicKey,
                userAccount: userAccount!.publicKey,
                bettorAccount: provider.wallet.publicKey,
                // betCreator: provider.wallet.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId
            },
            signers: [wagerDetailKP]
        })
        .then(tx => {
            console.log('Wager successfully submitted.', tx)
            setIsSubmitting(false)
            successToast('Wager has been placed!')
    
            // Update user account
            userAccountStore.getState().actions.getAccount(wallet)
    
        }).catch(e => {
            setIsSubmitting(false)
            failureToast('Error placing wager.')
        })
    }

    // Utility functions
    function rangeInDollars(index: number) {
        const range = ranges[index]

        if (range[0] == -Infinity) {
            return `<$${(asset.price * (1 + range[1])).toFixed(2)}`
        } else if (range[1] == Infinity) {
            return `>$${(asset.price * (1 + range[0])).toFixed(2)}`
        } else {
            return `$${(asset.price * (1 + range[0])).toFixed(2)} - $${(asset.price * (1 + range[1])).toFixed(2)}`
        }
    }

    function rangeInPercentages(index: number) {
        const range = ranges[index]
        if (range[0] == -Infinity) {
            return `<${range[1] * 100}%`
        } else if (range[1] == Infinity) {
            return `${range[0] * 100}%+`
        } else {
            return `${range[0] * 100}% -\ ${range[1] * 100}%`
        }
    }

    return (<>
        {isLoaded ? <>
            <div className="m-auto max-w-5xl mt-12">
                <div className="text-slate-50 text-left">
                    <h1 className="text-4xl font-semibold my-4">{asset.name}</h1>
                    <p className="text-m mt-8">Here you can place bets on what price ${asset.ticker} will open at for the next market open.</p>
                    <p className="text-m mt-8">Bets will be placed in methods of ranges. For example, if you select 1%-2%, you are betting that price for ${asset.ticker} will increase in that range next market session.   </p>
                    <p className="text-xl mt-8 text-slate-200 font-bold">Current Price: ${asset.price.toFixed(2)}</p>
                </div>
                <div className="h-1 border-b mt-8" style={{ borderColor: "#274060" }}></div>
                <div className="w-full">
                    <div>
                        <div className="grid grid-cols-4 gap-y-1 gap-x-1 w-full range-div mt-4">
                            {ranges.map((r, index) => {
                                return (<div className="flex-1" id={r[0].toString()} key={r[0]}>
                                    <div className={`range-container bg-slate-800 font-semibold text-m text-slate-200 pl-4 cursor-pointer hover:bg-slate-500 py-6 flex flex-col justify-center ${(selectedRange != null && ranges[selectedRange][0] == r[0]) ? 'selected' : ''}`} onClick={() => setSelectedRange(index)}>
                                        <p className="text-center">{rangeInPercentages(index)}</p>
                                        <p className="italic invisible opacity-0 text-sm price-range">{rangeInDollars(index)}</p>
                                    </div>
                                </div>)
                            })}
                        </div>
                    </div>
                    <div className="flex justify-center">
                        <div id="bet-dialog" className={`bg-slate-800 border border-slate-200 w-1/2 px-4 rounded-md block ${displayBetDialog ? 'display-header' : 'hide-header'}`}>
                            <h3 className="text-slate-200 text-lg text-center mt-4">
                                <span className="font-semibold">${asset.ticker}</span> bet {isBettingAgainst ? 'against' : 'for'} <span className="font-semibold">{selectedRange ? rangeInPercentages(selectedRange!) : ''}</span> by <span className="font-semibold">{new Date('03/18/2022').toDateString()}</span>
                            </h3>
                            <div className="flex w-full mt-4 mb-2 justify-end">
                                {balance != -1 ?
                                    <span className="mt-1 mr-4 text-slate-200">Balance: {`${balance.toFixed(2)} `}<span className="mb-1">{SOL_TOKEN_LOGO}</span></span>
                                    : null}
                                <button className="text-slate-400 bg-slate-900 px-2 py-0.5 border border-slate-400 rounded-lg hover:bg-slate-700" onClick={() => setWagerAmount(balance.toString())}>Max</button>
                            </div>
                            <div className="bg-slate-600 mt-2 mb-2 py-2 w-full rounded-md">
                                <input className="w-full bg-transparent text-slate-200 outline-none p-0.5" placeholder="Amount" value={wagerAmount} onChange={(e) => setWagerAmount(e.target['value'])} />
                            </div>
                            <p className="text-right font-light italic text-slate-200">Taker fee: {(+wagerAmount * TAKER_FEE).toFixed(2)} {SOL_TOKEN_LOGO}</p>
                            {/* <p className="text-slate-200 mt-12">To return: 3.75 SOL</p> */}
                            <div className="float-right mt-8 mb-16">
                                <Switch.Group>
                                    <Switch.Label className={"text-slate-200 mr-4"}><span className="pb-2">Betting against?</span></Switch.Label>
                                    <Switch checked={isBettingAgainst} onChange={setIsBettingAgainst} className={`${isBettingAgainst ? 'bg-slate-500' : 'bg-slate-900'} relative inline-flex flex-shrink-0  border-2 h-[28px] w-[56px] border-transparent rounded-full cursor-pointer transition-colors ease-in-out duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75`}>
                                        <span className="sr-only">Use setting</span>

                                        <span
                                            aria-hidden="true"
                                            className={`${isBettingAgainst ? 'translate-x-7' : 'translate-x-0'} pointer-events-none inline-block h-[26px] w-[26px] rounded-full bg-white shadow-lg transform ring-0 transition ease-in-out duration-200`}
                                        />
                                    </Switch>
                                </Switch.Group>
                            </div>

                            <div className="flex w-full mt-12 mb-2">
                                <button className="flex-1 border border-slate-300 text-slate-300 rounded-lg mr-4" onClick={() => setSelectedRange(null)}>Cancel</button>
                                <button className="text-slate-300 flex-1 ml-4 bg-slate-900 rounded-lg py-3" onClick={placeWager}>
                                    {isSubmitting ? <span className="w-full flex justify-center"><LoadingAnimation /></span> : <span>Place Wager</span>}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
            : null}

    </>)
}

export default BettingPage
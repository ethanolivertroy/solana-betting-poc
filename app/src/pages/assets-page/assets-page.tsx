import { useEffect, useState } from "react";
import { AssetCard } from "./components/asset-card";
import { clusterApiUrl, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import React from 'react'
import useAssetsStore from "../../stores/stocks";
import { Link } from "react-router-dom";
import { ConnectionProvider, useWallet, WalletProvider } from "@solana/wallet-adapter-react";
import ConnectWalletButton from "../../shared/components/connect-wallet-button";
import { BN, Program, Provider } from "@project-serum/anchor";
import NewAccountDialog from "../../shared/components/new-account-dialog";
import userAccountStore from "../../stores/user-state";
import ActionMenu from "../../shared/components/action-menu/action-menu";
import idl from '../../idl.json'
import { PARTY_ONE } from "../../models/constants";

enum AccountType {
    Unknown,
    Mapping,
    Product,
    Price,
    Test,
}

const AssetsPage = () => {
    const wallet = useWallet();
    const assets = useAssetsStore(s => s.assets)
    const isAccountLoaded = userAccountStore(s => s.isAccountLoaded)
    const userAccount = userAccountStore(s => s.userAccount)
    const [displayCreateUserDialog, setDisplayCreateUserDialog] = useState(false)

    useEffect(() => {
        // setBetOutcome()
        
        if (!isAccountLoaded || userAccount) { return }

        setDisplayCreateUserDialog(true)
    }, [isAccountLoaded])

    async function getProvider() {
        const network = "http://127.0.0.1:8899";
        const connection = new Connection(network, 'processed')

        // @ts-ignore
        return new Provider(connection, wallet, 'processed')
    }

    async function setBetOutcome() {
        const network = "http://127.0.0.1:8899";
        const connection = new Connection(network, 'finalized')
        // @ts-ignore
        const provider = new Provider(connection, wallet, 'finalized')

        const programId = idl.metadata.address
        const program = new Program(idl as any, programId, provider)

        console.log(await program.account.betState.all())

        const betStatePK = (await program.account.betState.all())[0].publicKey


        const closeTx = program.transaction.closeBetState(new BN(Date.now()), {
            accounts: {
                betState: betStatePK,
                betCreator: provider.wallet.publicKey
            }
        })
        
        closeTx.add(program.transaction.decideBetStateOutcome(new BN(PARTY_ONE), {
            accounts: {
                betState: betStatePK,
                betCreator: provider.wallet.publicKey
            }
        }))

        closeTx.feePayer = provider.wallet.publicKey
        closeTx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash
        
        const signedTx = await provider.wallet.signTransaction(closeTx)
        const txId = await provider.connection.sendRawTransaction(signedTx.serialize())
        await provider.connection.confirmTransaction(txId)
        console.log('Confirmed successfully!')
    }

    return (<>
        <div className="float-right">
            <ConnectWalletButton />
            {wallet.connected ? <div className="mt-2"><ActionMenu /></div> : null }
        </div>
        <div className="text-slate-50 text-left">
            <h1 className="text-4xl font-semibold my-4">Assets</h1>
            <p className="text-m mt-8">Select an asset to place your bets on!</p>
        </div>
        <div className="h-1 border-b mt-8" style={{borderColor: "#274060"}}></div>
        <div className="mt-10 grid gap-y-8 gap-x-24 grid-cols-3">
            {Object.keys(assets).map(ticker => {
                return (
                <Link
                    to={`/assets/${ticker}`}
                    key={ticker}>
                        <AssetCard ticker={ticker} price={assets[ticker].price} key={ticker}></AssetCard>
                </Link>
                )
            })}
        </div>
        <NewAccountDialog isDialogOpen={displayCreateUserDialog} onDialogClose={() => setDisplayCreateUserDialog(false)}></NewAccountDialog>
    </>)
}

export default AssetsPage
import { useWallet } from "@solana/wallet-adapter-react"
import React, { useEffect } from "react"
import { BrowserRouter, Route, Routes } from "react-router-dom"
import { ToastContainer } from "react-toastify"
import AssetsPage from "./pages/assets-page/assets-page"
import BettingPage from "./pages/betting-page/betting-page"
import MyBetsPage from "./pages/my-bets-page/my-bets-page"
import TopNav from "./shared/components/top-nav/top-nav"
import useAssetsStore from "./stores/stocks"
import userAccountStore from "./stores/user-state"

function Mediator() {
    const wallet = useWallet()
    const isLoaded = useAssetsStore(s => s.isLoaded["pythProductData"])
    const actions = useAssetsStore.getState().actions
    const userAccountActions = userAccountStore.getState().actions

    useEffect(() => {
        if (!wallet.connected) { return }

        userAccountActions.getAccount(wallet)
    }, [wallet.connected])

    useEffect(() => {
        if (isLoaded) { return }
        actions.getPythProductData()

    }, [isLoaded])

    return (
        <><ToastContainer
            position="top-right"
            autoClose={5000}
            hideProgressBar={false}
            newestOnTop={false}
            closeOnClick
            rtl={false}
            pauseOnFocusLoss
            draggable
            pauseOnHover /><BrowserRouter>
                <Routes>
                    <Route path="/" element={<div>
                        <div className="mt-4"><TopNav /></div>
                        <div className="App m-auto max-w-5xl mt-12">
                            <AssetsPage></AssetsPage>
                        </div>
                    </div>} />
                    <Route path="assets/:ticker" element={<div>
                        <div className="mt-4"><TopNav /></div>
                        <BettingPage />
                    </div>} />
                    <Route path="my-bets" element={<div>
                        <div className="mt-4"><TopNav /></div>
                        <MyBetsPage />
                    </div>} />
                </Routes>
            </BrowserRouter><ToastContainer /></>

    )
}

export default Mediator;
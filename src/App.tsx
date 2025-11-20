// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { ConnectButton, useCurrentAccount } from '@mysten/dapp-kit';
import { Box, Button, Card, Container, Flex, Grid } from '@radix-ui/themes';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';

// Local components
import { CreateAllowlist } from './CreateAllowlist';
import { Allowlist } from './Allowlist';
import WalrusUpload from './EncryptAndUpload';
import { AllAllowlist } from './OwnedAllowlists';
import Feeds from './AllowlistView';

const GlobalStyles = () => (
    <style>
      {`
      .app-root {
        min-height: 100vh;
        background: linear-gradient(135deg, #1e3a8a, #4f46e5, #7e22ce);
        color: white;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        padding: 1rem;
        padding-top: 4rem;
        box-sizing: border-box;
      }

      .nav-bar {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        padding: 1rem 1.5rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: rgba(0, 0, 0, 0.2);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        z-index: 10;
        border-bottom-left-radius: 12px;
        border-bottom-right-radius: 12px;
      }

      .app-title {
        font-size: 1.875rem;
        font-weight: 700;
        background: linear-gradient(to right, #67e8f9, #38bdf8);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
      }

      @media (min-width: 768px) {
        .app-title {
          font-size: 2.25rem;
        }
      }

      /* Full-screen centered landing content */
      .landing-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 2rem;
        max-width: 800px;
        margin: 0 auto;
        height: calc(100vh - 6rem); /* account for nav bar height */
      }

      .landing-title {
        font-size: 2.5rem;
        font-weight: 800;
        margin-bottom: 1.5rem;
        text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        background: linear-gradient(to bottom, white, #e0e7ff);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
      }

      @media (min-width: 768px) {
        .landing-title {
          font-size: 3rem;
        }
      }

      .landing-description {
        font-size: 1.125rem;
        line-height: 1.7;
        margin-bottom: 2rem;
        color: rgba(255, 255, 255, 0.95);
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
        max-width: 650px;
      }

      .try-button {
        background: linear-gradient(to right, #6366f1, #8b5cf6);
        color: white;
        padding: 0.875rem 2rem;
        border-radius: 12px;
        font-weight: 600;
        font-size: 1.125rem;
        border: none;
        cursor: pointer;
        transition: opacity 0.2s, transform 0.15s;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      }

      .try-button:hover {
        opacity: 0.95;
        transform: translateY(-2px);
      }

      .glass-card {
        background: rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 16px;
        padding: 1.5rem;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
        margin-bottom: 1.5rem;
      }

      .connect-prompt {
        background: rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 16px;
        padding: 2rem;
        text-align: center;
        max-width: 500px;
        margin: 5rem auto 0;
        color: #cffafe;
        font-size: 1.125rem;
      }
    `}
    </style>
);

function LandingPage() {
  return (
      <div className="landing-container">
        <h1 className="landing-title">Welcome to SealMessage</h1>
        <p className="landing-description">
          SealMessage is a decentralized, real-time messaging application built on the Sui blockchain and powered by Walrus storage. Every message you send is protected with end-to-end encryption, ensuring that only intended recipients can read your conversations—no intermediaries, not even the servers.
        </p>
        <Link to="/CreateRoom/">
          <button className="try-button">Try It Now</button>
        </Link>
      </div>
  );
}

function App() {
  const currentAccount = useCurrentAccount();
  const [recipientAllowlist, setRecipientAllowlist] = useState<string>('');
  const [capId, setCapId] = useState<string>('');

  return (
      <>
        <GlobalStyles />
        <div className="app-root">
          {/* Top Navigation Bar */}
          <div className="nav-bar">
            <h1 className="app-title">Seal Message</h1>
            <Box>
              <ConnectButton />
            </Box>
          </div>

          {/* Main Content */}
          <div className="content-wrapper" style={{ width: '100%', maxWidth: '1200px' }}>
            {currentAccount ? (
                <BrowserRouter>
                  <Routes>
                    <Route path="/" element={<LandingPage />} />
                    <Route
                        // path="/allowlist-example/*"
                        path="/CreateRoom/*"
                        element={
                          <Routes>
                            <Route index element={<CreateAllowlist />} />
                            <Route
                                path="admin/allowlist/:id"
                                element={
                                  <div>
                                    <div className="glass-card">
                                      <Allowlist
                                          setRecipientAllowlist={setRecipientAllowlist}
                                          setCapId={setCapId}
                                      />
                                    </div>
                                      <div className="glass-card">
                                          <Feeds suiAddress={currentAccount.address} />
                                      </div>
                                    <div className="glass-card">
                                      <WalrusUpload
                                          policyObject={recipientAllowlist}
                                          cap_id={capId}
                                          moduleName="allowlist"
                                      />
                                    </div>
                                  </div>
                                }
                            />
                            <Route path="admin/allowlists" element={<AllAllowlist />} />
                            {/*<Route*/}
                            {/*    path="view/allowlist/:id"*/}
                            {/*    element={*/}
                            {/*    <div>*/}
                            {/*    <div className="glass-card">*/}
                            {/*    <Feeds suiAddress={currentAccount.address} />*/}
                            {/*    </div>*/}
                                {/*<div className="glass-card">*/}
                                {/*    <WalrusUpload*/}
                                {/*        policyObject={recipientAllowlist}*/}
                                {/*        cap_id={capId}*/}
                                {/*        moduleName="allowlist"*/}
                                {/*    />*/}
                                {/*</div>*/}
                            {/*    </div>*/}

                            {/*}*/}
                            {/*/>*/}
                          </Routes>
                        }
                    />
                  </Routes>
                </BrowserRouter>
            ) : (
                <div className="connect-prompt">
                  Please connect your wallet to continue
                </div>
            )}
          </div>
        </div>
      </>
  );
}

export default App;
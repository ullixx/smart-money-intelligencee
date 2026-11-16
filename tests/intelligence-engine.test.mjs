import test from "node:test";
import assert from "node:assert/strict";
import { analyseIntelligence, discoverWalletCandidates } from "../functions/lib/intelligence-engine.js";
const A="Wallet1111111111111111111111111111111111";
const B="Wallet2222222222222222222222222222222222";
function tx({owner=A,mint="Mint11111111111111111111111111111111111",pre="0",post="5",payer=A,blockTime=1}={}){
 return {blockTime,transaction:{message:{accountKeys:[payer],instructions:[]}},meta:{fee:5000,preTokenBalances:[{owner,mint,uiTokenAmount:{uiAmountString:pre}}],postTokenBalances:[{owner,mint,uiTokenAmount:{uiAmountString:post}}],innerInstructions:[]}};
}
test("C-F returns evidence-based wallet ranking and capital flow",()=>{
 const result=analyseIntelligence({wallets:[A],transactionsByWallet:{[A]:[tx(),tx({pre:"5",post:"8",blockTime:2})]}});
 assert.equal(result.status,"PARTIAL");
 assert.equal(result.walletRanking[0].address,A);
 assert.equal(result.capitalFlows[0].direction,"NETTO-AKKUMULATION");
 assert.equal(result.capitalFlows[0].events,2);
});
test("shared token exposure is an observed overlap, not a control claim",()=>{
 const result=analyseIntelligence({wallets:[A,B],transactionsByWallet:{[A]:[tx()], [B]:[tx({owner:B,payer:B})]}});
 assert.equal(result.clusters.sharedTokenExposure.length,1);
 assert.match(result.clusters.note,/beweisen keine gemeinsame Kontrolle/);
});
test("fee payer discovery excludes already tracked wallets",()=>{
 const result=analyseIntelligence({wallets:[A],transactionsByWallet:{[A]:[tx({payer:B}),tx({payer:B})]}});
 assert.equal(result.walletDiscovery[0].address,B);
 assert.equal(result.walletDiscovery[0].mentions,2);
 assert.equal(result.walletDiscovery[0].status,"CANDIDATE");
});

test("discovers fee payers and SOL transfer counterparties as unconfirmed candidates",()=>{
 const peer="Waaet33333333333333333333333333333333333";
 const tx={transaction:{message:{accountKeys:[A],instructions:[{programId:"11111111111111111111111111111111",parsed:{type:"transfer",info:{source:A,destination:peer,lamports:1000}}}]}},meta:{innerInstructions:[]}};
 const candidates=discoverWalletCandidates({[A]:[tx]},[A]);
 assert.equal(candidates[0].address,peer);
 assert.equal(candidates[0].status,"CANDIDATE");
 assert.match(candidates[0].warning,/Nicht als Smart Money bestätigt/);
});


test("does not infer BUY or SELL from token movements without decoded DEX evidence",()=>{
 const result=analyseIntelligence({wallets:[A],transactionsByWallet:{[A]:[tx({pre:"0",post:"5"})]}});
 assert.equal(result.walletRanking[0].observedBuys,0);
 assert.equal(result.walletRanking[0].observedSells,0);
 assert.equal(result.walletRanking[0].confirmedDexSwaps,0);
 assert.equal(result.capitalFlows[0].valuationStatus,"UNAVAILABLE");
 assert.equal(result.capitalFlows[0].usdValue,null);
});


test("C discovers direct SOL transfer counterparties, not only fee payers",()=>{
 const peer="Waaet33333333333333333333333333333333333";
 const transfer={blockTime:3,transaction:{message:{accountKeys:[A],instructions:[
  {programId:"11111111111111111111111111111111",parsed:{type:"transfer",info:{source:A,destination:peer,lamports:250000000}}}
 ]}},meta:{fee:5000,innerInstructions:[],preTokenBalances:[],postTokenBalances:[]}};
 const result=analyseIntelligence({wallets:[A],transactionsByWallet:{[A]:[transfer]}});
 assert.equal(result.walletDiscovery[0].address,peer);
 assert.equal(result.walletDiscovery[0].discoveryReason,"Gegenpartei eines beobachteten SOL-Transfers");
 assert.equal(result.walletRanking[0].counterparties.includes(peer),true);
});

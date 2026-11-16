import test from "node:test";
import assert from "node:assert/strict";
import { decodeSwapEvidence } from "../functions/lib/swap-decoder.js";

const WALLET="Wallet1111111111111111111111111111111111";
const ATA_A="AtaA111111111111111111111111111111111111";
const ATA_B="AtaB111111111111111111111111111111111111";
const POOL="Pool111111111111111111111111111111111111";
const JUP="JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const SYSTEM="11111111111111111111111111111111";
function fixture({dex=false,tokenIn=false,tokenOut=false,solIn=false,solOut=false}={}){
 const keys=[WALLET,ATA_A,ATA_B,POOL,...(dex?[JUP]:[])];
 const instructions=[];
 if(tokenIn)instructions.push({program:"spl-token",parsed:{type:"transfer",info:{source:POOL,destination:ATA_A,amount:"10"}}});
 if(tokenOut)instructions.push({program:"spl-token",parsed:{type:"transfer",info:{source:ATA_B,destination:POOL,amount:"5"}}});
 if(solIn)instructions.push({programId:SYSTEM,parsed:{type:"transfer",info:{source:POOL,destination:WALLET,lamports:1000}}});
 if(solOut)instructions.push({programId:SYSTEM,parsed:{type:"transfer",info:{source:WALLET,destination:POOL,lamports:1000}}});
 if(dex)instructions.push({programId:JUP});
 const balances=[];
 if(tokenIn)balances.push({accountIndex:1,owner:WALLET,mint:"MintA"});
 if(tokenOut)balances.push({accountIndex:2,owner:WALLET,mint:"MintB"});
 const changes=[];
 if(tokenIn)changes.push({mint:"MintA",amount:10});
 if(tokenOut)changes.push({mint:"MintB",amount:-5});
 return {tx:{transaction:{message:{accountKeys:keys,instructions}},meta:{preTokenBalances:balances,postTokenBalances:balances}},changes};
}
test("classifies parsed wallet-linked token receipt as transfer, not BUY without SOL out",()=>{
 const f=fixture({tokenIn:true});
 const r=decodeSwapEvidence(f.tx,{wallet:WALLET,solDelta:0,tokenChanges:f.changes});
 assert.equal(r.classification,"TOKEN_TRANSFER_IN");
});
test("does not infer BUY from unrelated SOL out without wallet token transfer",()=>{
 const f=fixture({solOut:true});
 const r=decodeSwapEvidence(f.tx,{wallet:WALLET,solDelta:-0.000001,tokenChanges:[{mint:"MintA",amount:10}]});
 assert.notEqual(r.classification,"BUY_INFERRED");
});
test("recognizes token-to-token swap candidate only with wallet-linked parsed flows",()=>{
 const f=fixture({tokenIn:true,tokenOut:true});
 const r=decodeSwapEvidence(f.tx,{wallet:WALLET,solDelta:0,tokenChanges:f.changes});
 assert.equal(r.classification,"SWAP_CANDIDATE");
 assert.equal(r.direction,"TOKEN_TO_TOKEN");
});
test("marks known DEX plus wallet token flow and opposing balances as DEX evidence",()=>{
 const f=fixture({dex:true,tokenIn:true,tokenOut:true});
 const r=decodeSwapEvidence(f.tx,{wallet:WALLET,solDelta:0,tokenChanges:f.changes});
 assert.equal(r.classification,"DEX_SWAP_EVIDENCE");
 assert.deepEqual(r.dexPrograms,["Jupiter v6"]);
});

const DEX_FIXTURES=[
 ["Raydium AMM v4","675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"],
 ["Raydium CPMM","CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"],
 ["Raydium CLMM","CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"],
 ["Raydium LaunchLab","LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj"],
 ["Orca legacy","9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP"],
 ["Meteora DBC","dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"],
 ["Meteora DAMM v1","Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB"],
 ["Meteora DAMM v2","cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"],
 ["PumpSwap","pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"],
 ["Jupiter v4","JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB"]
];
for(const [name,programId] of DEX_FIXTURES){
 test(`recognizes ${name} only with wallet-linked token flows`,()=>{
  const f=fixture({tokenIn:true,tokenOut:true});
  f.tx.transaction.message.instructions.push({programId});
  const r=decodeSwapEvidence(f.tx,{wallet:WALLET,solDelta:0,tokenChanges:f.changes});
  assert.equal(r.classification,"DEX_SWAP_EVIDENCE");
  assert.ok(r.dexPrograms.includes(name));
 });
}
test("does not label an unrelated program as a known DEX",()=>{
 const f=fixture({tokenIn:true,tokenOut:true});
 f.tx.transaction.message.instructions.push({programId:"Unrelated11111111111111111111111111111111"});
 const r=decodeSwapEvidence(f.tx,{wallet:WALLET,solDelta:0,tokenChanges:f.changes});
 assert.equal(r.classification,"SWAP_CANDIDATE");
 assert.deepEqual(r.dexPrograms,[]);
});
test("does not call a one-sided wallet token transfer a swap",()=>{
 const f=fixture({dex:true,tokenIn:true});
 const r=decodeSwapEvidence(f.tx,{wallet:WALLET,solDelta:0,tokenChanges:f.changes});
 assert.equal(r.classification,"TOKEN_TRANSFER_IN");
});

test("maps newly created associated token accounts to the wallet without balance owner metadata",()=>{
 const tx={transaction:{message:{accountKeys:[WALLET,ATA_A,POOL],instructions:[
  {program:"spl-associated-token-account",parsed:{type:"create",info:{account:ATA_A,wallet:WALLET,mint:"MintA"}}},
  {program:"spl-token",parsed:{type:"transferchecked",info:{source:POOL,destination:ATA_A,tokenAmount:{uiAmountString:"10"}}}}
 ]}},meta:{preTokenBalances:[],postTokenBalances:[]}};
 const r=decodeSwapEvidence(tx,{wallet:WALLET,solDelta:0,tokenChanges:[{mint:"MintA",amount:10}]});
 assert.equal(r.walletTokenAccountsChecked,1);
 assert.equal(r.hasWalletTokenTransferIn,true);
 assert.equal(r.classification,"TOKEN_TRANSFER_IN");
});

test("recognizes WSOL outflow as SOL consideration for a token buy candidate",()=>{
 const f=fixture({tokenIn:true});
 const r=decodeSwapEvidence(f.tx,{wallet:WALLET,solDelta:0,tokenChanges:[...f.changes,{mint:"So11111111111111111111111111111111111111112",amount:-0.25}]});
 assert.equal(r.hasWrappedSolOut,true);
 assert.equal(r.classification,"BUY_INFERRED");
 assert.equal(r.direction,"SOL_TO_TOKEN");
});
test("recognizes WSOL inflow as SOL consideration for a token sell candidate",()=>{
 const f=fixture({tokenOut:true});
 const r=decodeSwapEvidence(f.tx,{wallet:WALLET,solDelta:0,tokenChanges:[...f.changes,{mint:"So11111111111111111111111111111111111111112",amount:0.25}]});
 assert.equal(r.hasWrappedSolIn,true);
 assert.equal(r.classification,"SELL_INFERRED");
 assert.equal(r.direction,"TOKEN_TO_SOL");
});


test("exposes fee payer, token mint and external counterparties for wallet-linked flows",()=>{
 const tx={transaction:{message:{accountKeys:[WALLET,ATA_A,POOL],instructions:[
  {programId:"spl-token",parsed:{type:"transferchecked",info:{source:POOL,destination:ATA_A,mint:"MintA",tokenAmount:{amount:"1000",decimals:2,uiAmountString:"10"}}}}
 ]}},meta:{preTokenBalances:[{accountIndex:1,owner:WALLET,mint:"MintA"}],postTokenBalances:[]}};
 const r=decodeSwapEvidence(tx,{wallet:WALLET,tokenChanges:[{mint:"MintA",amount:10}]});
 assert.equal(r.feePayer,WALLET);
 assert.equal(r.walletTokenTransfers[0].mint,"MintA");
 assert.equal(r.walletTokenTransfers[0].rawAmount,"1000");
 assert.deepEqual(r.counterparties,[POOL]);
});

test("recognizes an associated token account address alias when owner metadata is absent",()=>{
 const tx={transaction:{message:{accountKeys:[WALLET,ATA_A,POOL],instructions:[
  {program:"spl-associated-token-account",parsed:{type:"create",info:{accountAddress:ATA_A,wallet:WALLET,mint:"MintA"}}},
  {program:"spl-token",parsed:{type:"transfer",info:{source:POOL,destination:ATA_A,amount:"10"}}}
 ]}},meta:{preTokenBalances:[],postTokenBalances:[]}};
 const r=decodeSwapEvidence(tx,{wallet:WALLET,tokenChanges:[{mint:"MintA",amount:10}]});
 assert.equal(r.hasWalletTokenTransferIn,true);
 assert.equal(r.walletTokenAccountsChecked,1);
});


test("returns ordered DEX instruction trace including inner route instructions",()=>{
 const tx={transaction:{message:{accountKeys:[WALLET,JUP],instructions:[{programId:JUP,accounts:[WALLET],data:"outer"}]}},meta:{innerInstructions:[{index:0,instructions:[{programId:JUP,accounts:[ATA_A,POOL],data:"inner",stackHeight:2}]}]}};
 const result=decodeSwapEvidence(tx,{wallet:WALLET});
 assert.equal(result.dexInstructionTrace.length,2);
 assert.equal(result.dexInstructionTrace[0].data,"outer");
 assert.equal(result.dexInstructionTrace[1].data,"inner");
 assert.equal(result.dexInstructionTrace[1].stackHeight,2);
});


test("normalizes raw SPL transfer amount with decimals from token balance metadata",()=>{
 const tx={transaction:{message:{accountKeys:[WALLET,ATA_A,POOL],instructions:[
  {programId:"spl-token",parsed:{type:"transfer",info:{source:POOL,destination:ATA_A,amount:"1250000"}}}
 ]}},meta:{preTokenBalances:[{accountIndex:1,owner:WALLET,mint:"MintA",uiTokenAmount:{decimals:6,uiAmountString:"0"}}],postTokenBalances:[]}};
 const result=decodeSwapEvidence(tx,{wallet:WALLET,tokenChanges:[{mint:"MintA",amount:1.25}]});
 assert.equal(result.walletTokenLegs[0].side,"IN");
 assert.equal(result.walletTokenLegs[0].rawAmount,"1250000");
 assert.equal(result.walletTokenLegs[0].amountUi,1.25);
 assert.equal(result.walletTokenLegs[0].decimals,6);
});

test("interleaves inner instructions after their parent in execution order",()=>{
 const SYSTEM_TRANSFER={programId:SYSTEM,parsed:{type:"transfer",info:{source:WALLET,destination:POOL,lamports:1000}}};
 const tx={transaction:{message:{accountKeys:[WALLET,JUP,SYSTEM],instructions:[
  {programId:JUP,accounts:[WALLET],data:"outer-jupiter"},
  {programId:JUP,parsed:{type:"transfer",info:{}},accounts:[ATA_B],data:"outer-after"}
 ]}},meta:{innerInstructions:[{index:0,instructions:[
  {programId:JUP,accounts:[ATA_A,POOL],data:"inner-jupiter",stackHeight:2}
 ]}]}};
 const result=decodeSwapEvidence(tx,{wallet:WALLET});
 assert.deepEqual(result.dexInstructionTrace.map(x=>x.data),["outer-jupiter","inner-jupiter","outer-after"]);
 assert.deepEqual(result.parsedInstructionTypes,["transfer"]);
});


test("does not treat SOL rent paid to a wallet token account as swap consideration",()=>{
 const tx={transaction:{message:{accountKeys:[WALLET,ATA_A,POOL,JUP,SYSTEM],instructions:[
  {program:"spl-associated-token-account",parsed:{type:"create",info:{account:ATA_A,wallet:WALLET,mint:"MintA"}}},
  {programId:SYSTEM,parsed:{type:"transfer",info:{source:WALLET,destination:ATA_A,lamports:2039280}}},
  {programId:"spl-token",parsed:{type:"transfer",info:{source:POOL,destination:ATA_A,mint:"MintA",amount:"100"}}},
  {programId:JUP}
 ]}},meta:{preTokenBalances:[],postTokenBalances:[]}};
 const result=decodeSwapEvidence(tx,{wallet:WALLET,solDelta:-0.00203928,tokenChanges:[{mint:"MintA",amount:100}]});
 assert.equal(result.systemTransfers[0].rentRelated,true);
 assert.equal(result.hasWalletSystemTransferOut,false);
 assert.equal(result.classification,"TOKEN_TRANSFER_IN");
});

test("recognizes Token-2022 transferCheckedWithFee wallet flows",()=>{
 const TOKEN_2022="TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
 const tx={transaction:{message:{accountKeys:[WALLET,ATA_A,POOL],instructions:[
  {programId:TOKEN_2022,parsed:{type:"transferCheckedWithFee",info:{source:POOL,destination:ATA_A,mint:"MintA",tokenAmount:{amount:"1000",decimals:2,uiAmountString:"10"},feeAmount:"5"}}}
 ]}},meta:{preTokenBalances:[{accountIndex:1,owner:WALLET,mint:"MintA"}],postTokenBalances:[]}};
 const result=decodeSwapEvidence(tx,{wallet:WALLET,tokenChanges:[{mint:"MintA",amount:10}]});
 assert.equal(result.walletTokenTransfers.length,1);
 assert.equal(result.walletTokenTransfers[0].tokenProgram,"TOKEN_2022");
 assert.equal(result.walletTokenTransfers[0].feeAmount,"5");
 assert.equal(result.walletTokenLegs[0].side,"IN");
});

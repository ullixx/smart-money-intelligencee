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
 assert.deepEqual(r.dexPrograms,["Jupiter"]);
});

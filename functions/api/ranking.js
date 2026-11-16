import { createSolanaRpc } from "../lib/solana-rpc.js";
const valid=a=>/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
const DEX_PROGRAM_IDS=new Set([
 "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
 "675kPX9MHTjS2zt1qfr1NYHuzeL7N9T8r8Z3F5V5",
 "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
 "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
 "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
]);
const knownDex=tx=>{
 const keys=tx.transaction?.message?.accountKeys||[];
 const loaded=[...(tx.meta?.loadedAddresses?.writable||[]),...(tx.meta?.loadedAddresses?.readonly||[])];
 const keyAt=i=>{const k=i<keys.length?keys[i]:loaded[i-keys.length];return typeof k==="string"?k:k?.pubkey;};
 const instructions=[...(tx.transaction?.message?.instructions||[]),...(tx.meta?.innerInstructions||[]).flatMap(x=>x.instructions||[])];
 return instructions.some(ix=>{const id=ix.programId||(Number.isInteger(ix.programIdIndex)?keyAt(ix.programIdIndex):null);return typeof id==="string"&&DEX_PROGRAM_IDS.has(id);});
};
export async function onRequestGet({request,env}){
 const rpc=createSolanaRpc(env),wallets=[...new Set((new URL(request.url).searchParams.get("wallets")||"").split(",").map(x=>x.trim()).filter(Boolean))].slice(0,10);
 if(!wallets.length||wallets.some(x=>!valid(x)))return Response.json({status:"UNAVAILABLE",error:"Mindestens eine gültige Solana-Wallet-Adresse erforderlich."},{status:400});
 try{
  const results=[];
  // Keep a hard global budget below Cloudflare Workers subrequest limits.
  const perWalletLimit=10;
  for(const address of wallets){
   let signatures=[],analysed=0,skipped=0,buys=0,sells=0,dexSwaps=0,inferredSwaps=0;
   const skipReasons={rpcError:0,transactionNotFound:0,missingMetadata:0,failedTransaction:0};
   const rpcErrors={},mintCounts=new Map(),buyMints=new Set();
   try{signatures=await rpc.call("getSignaturesForAddress",[address,{limit:20,commitment:"confirmed"}]);}
   catch(e){results.push({address,status:"UNAVAILABLE",score:null,error:e.message,analysed:0,skipped:0});continue;}
   for(const sig of (signatures||[]).slice(0,perWalletLimit)){
    try{
     const tx=await rpc.call("getTransaction",[sig.signature,{encoding:"jsonParsed",commitment:"confirmed",maxSupportedTransactionVersion:2}]);
     if(!tx){skipReasons.transactionNotFound++;skipped++;continue;}
     if(!tx.meta){skipReasons.missingMetadata++;skipped++;continue;}
     if(tx.meta.err){skipReasons.failedTransaction++;skipped++;continue;}
     const keys=[...(tx.transaction?.message?.accountKeys||[]),...(tx.meta?.loadedAddresses?.writable||[]),...(tx.meta?.loadedAddresses?.readonly||[])];
     const idx=keys.findIndex(k=>(typeof k==="string"?k:k?.pubkey)===address);
     const sol=idx>=0?((tx.meta.postBalances?.[idx]||0)-(tx.meta.preBalances?.[idx]||0))/1e9:null;
     const deltas=new Map();
     for(const b of tx.meta.preTokenBalances||[])if(b.owner===address)deltas.set(b.mint,{mint:b.mint,amount:-Number(b.uiTokenAmount?.uiAmountString||0)});
     for(const b of tx.meta.postTokenBalances||[])if(b.owner===address){const v=deltas.get(b.mint)||{mint:b.mint,amount:0};v.amount+=Number(b.uiTokenAmount?.uiAmountString||0);deltas.set(b.mint,v);}
     const changes=[...deltas.values()].filter(x=>Number.isFinite(x.amount)&&x.amount!==0);
     const received=changes.filter(x=>x.amount>0),sent=changes.filter(x=>x.amount<0);
     const dex=knownDex(tx);
     let kind="NON_SWAP";
     if(dex&&((received.length&&sent.length)||(received.length&&sol!==null&&sol<0)||(sent.length&&sol!==null&&sol>0)))kind="DEX_SWAP";
     else if(received.length&&sent.length)kind="SWAP_CANDIDATE";
     else if(received.length&&sol!==null&&sol<0)kind="BUY_INFERRED";
     else if(sent.length&&sol!==null&&sol>0)kind="SELL_INFERRED";
     if(kind==="DEX_SWAP"||kind==="SWAP_CANDIDATE"||kind==="BUY_INFERRED"||kind==="SELL_INFERRED"){
      inferredSwaps++;
      if(kind==="DEX_SWAP")dexSwaps++;
      if(kind==="DEX_SWAP"||kind==="SWAP_CANDIDATE"){
       buys+=received.length?1:0;sells+=sent.length?1:0;
      }else if(kind==="BUY_INFERRED")buys++;
      else sells++;
      for(const c of received){buyMints.add(c.mint);mintCounts.set(c.mint,(mintCounts.get(c.mint)||0)+1);}
      for(const c of sent)mintCounts.set(c.mint,(mintCounts.get(c.mint)||0)+1);
     }
     analysed++;
    }catch(e){skipped++;skipReasons.rpcError++;const m=String(e?.message||e||"Unbekannter RPC-Fehler").slice(0,180);rpcErrors[m]=(rpcErrors[m]||0)+1;}
   }
   const repeats=[...mintCounts.values()].filter(n=>n>1).length;
   const sampleCount=Math.min(perWalletLimit,(signatures||[]).length);
   const coverage=Math.round(analysed/Math.max(1,sampleCount)*100);
   const buyRatio=buys+sells?buys/(buys+sells):null;
   const score=inferredSwaps>0?Math.round(Math.min(100,
    Math.min(40,inferredSwaps*5)+Math.min(25,buyMints.size*5)+Math.min(15,repeats*5)+Math.min(20,coverage*.2)
   )):null;
   const status=analysed<5?"INSUFFICIENT_DATA":inferredSwaps===0?"NO_SWAP_EVIDENCE":"PARTIAL";
   results.push({address,status,score,rank:null,analysed,skipped,requestedTransactions:sampleCount,coverage,swapTransactions:inferredSwaps,dexSwapsDetected:dexSwaps,inferredSwaps:Math.max(0,inferredSwaps-dexSwaps),buys,sells,buyMints:buyMints.size,repeatedMints:repeats,buyRatio,skipReasons,rpcErrors,method:"Exploratory swap-activity score. Only transactions with DEX-program evidence or opposing token/SOL balance changes contribute. No swap evidence means no score; this is not profitability or proven smart-money quality."});
  }
  const ranked=results.filter(x=>x.score!==null).sort((a,b)=>b.score-a.score);
  ranked.forEach((x,i)=>x.rank=i+1);
  return Response.json({status:"PARTIAL",source:"Solana RPC mit automatischem Failover",rpcProvider:rpc.providerLabel(),checkedAt:new Date().toISOString(),walletsChecked:wallets.length,ranked:[...ranked,...results.filter(x=>x.score===null)],note:"Maximal 10 der letzten 20 Signaturen je Wallet, damit bei mehreren Wallets das Cloudflare-Subrequest-Budget nicht ausgeschöpft wird. Transfers und reine Aktivität ohne Swap-Hinweis erzeugen keinen Ranking-Score. DEX-Programm plus Salden ist ein Swap-Hinweis, aber keine vollständige wirtschaftliche Swap-Dekodierung. BUY/SELL bleiben teilweise heuristisch; kein PnL und keine nachgewiesene Smart-Money-Qualität."},{headers:{"Cache-Control":"no-store"}});
 }catch(e){return Response.json({status:"UNAVAILABLE",source:"Solana RPC mit automatischem Failover",rpcProvider:rpc.providerLabel(),error:"Ranking nicht verfügbar",detail:e.message},{status:502});}
}
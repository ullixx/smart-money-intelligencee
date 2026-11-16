import { createSolanaRpc } from "../lib/solana-rpc.js";
import { decodeSwapEvidence } from "../lib/swap-decoder.js";
const valid=a=>/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
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
   const selected=(signatures||[]).slice(0,perWalletLimit);
   let txBatch=[];
   try{
    txBatch=await rpc.callBatch(selected.map(sig=>({method:"getTransaction",params:[sig.signature,{encoding:"jsonParsed",commitment:"confirmed",maxSupportedTransactionVersion:2}]})));
   }catch(e){
    for(let i=0;i<selected.length;i++){skipped++;skipReasons.rpcError++;const m=String(e?.message||e).slice(0,180);rpcErrors[m]=(rpcErrors[m]||0)+1;}
   }
   for(let txIndex=0;txIndex<selected.length;txIndex++){
    try{
     if(!txBatch.length)break;
     const tx=txBatch[txIndex];
     if(tx?.__rpcError)throw new Error(tx.__rpcError);
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
     const evidence=decodeSwapEvidence(tx,{wallet:address,solDelta:sol,tokenChanges:changes});
     const received=changes.filter(x=>x.amount>0),sent=changes.filter(x=>x.amount<0);
     const kind=evidence.classification;
     if(kind==="DEX_SWAP_EVIDENCE"||kind==="SWAP_CANDIDATE"||kind==="BUY_INFERRED"||kind==="SELL_INFERRED"){
      inferredSwaps++;
      if(kind==="DEX_SWAP_EVIDENCE")dexSwaps++;
      if(kind==="DEX_SWAP_EVIDENCE"||kind==="SWAP_CANDIDATE"){
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
  return Response.json({status:"PARTIAL",source:"Solana RPC mit automatischem Failover",rpcProvider:rpc.providerLabel(),rpcBudget:rpc.budget(),checkedAt:new Date().toISOString(),walletsChecked:wallets.length,ranked:[...ranked,...results.filter(x=>x.score===null)],note:"Maximal 10 der letzten 20 Signaturen je Wallet, damit bei mehreren Wallets das Cloudflare-Subrequest-Budget nicht ausgeschöpft wird. Transfers und reine Aktivität ohne Swap-Hinweis erzeugen keinen Ranking-Score. DEX-Programm plus Salden ist ein Swap-Indiz, aber keine vollständige wirtschaftliche Swap-Dekodierung. BUY/SELL bleiben teilweise heuristisch; kein PnL und keine nachgewiesene Smart-Money-Qualität."},{headers:{"Cache-Control":"no-store"}});
 }catch(e){return Response.json({status:"UNAVAILABLE",source:"Solana RPC mit automatischem Failover",rpcProvider:rpc.providerLabel(),error:"Ranking nicht verfügbar",detail:e.message},{status:502});}
}
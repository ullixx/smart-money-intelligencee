import { createSolanaRpc } from "../lib/solana-rpc.js";
const valid=a=>/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
export async function onRequestGet({request,env}){
 const rpcClient=createSolanaRpc(env);const RPCS=[];const rpc=async(_endpoints,method,params)=>({result:await rpcClient.call(method,params),provider:0});let activeProvider="Not yet selected";
 const wallets=[...new Set((new URL(request.url).searchParams.get("wallets")||"").split(",").map(x=>x.trim()).filter(Boolean))].slice(0,10);
 if(!wallets.length||wallets.some(x=>!valid(x)))return Response.json({status:"UNAVAILABLE",error:"Mindestens eine gültige Solana-Wallet-Adresse erforderlich."},{status:400});
 try{
  const results=[];
  for(const address of wallets){
   let signatures=[],analysed=0,skipped=0,buys=0,sells=0;
   const mintCounts=new Map(),buyMints=new Set();
   try{const q=await rpc(RPCS,"getSignaturesForAddress",[address,{limit:20,commitment:"confirmed"}]);signatures=q.result;activeProvider=rpcClient.providerLabel();}
   catch(e){results.push({address,status:"UNAVAILABLE",error:e.message});continue;}
   for(const sig of (signatures||[]).slice(0,15)){
    try{
     const q=await rpc(RPCS,"getTransaction",[sig.signature,{encoding:"jsonParsed",commitment:"confirmed",maxSupportedTransactionVersion:2}]);const tx=q.result;activeProvider=rpcClient.providerLabel();
     if(!tx?.meta||tx.meta.err){skipped++;continue;}
     const staticKeys=tx.transaction?.message?.accountKeys||[],loadedKeys=[...(tx.meta?.loadedAddresses?.writable||[]),...(tx.meta?.loadedAddresses?.readonly||[])],keys=[...staticKeys,...loadedKeys];
     const idx=keys.findIndex(k=>(typeof k==="string"?k:k?.pubkey)===address);
     const sol=idx>=0?((tx.meta.postBalances?.[idx]||0)-(tx.meta.preBalances?.[idx]||0))/1e9:null;
     const deltas=new Map();
     for(const b of tx.meta.preTokenBalances||[])if(b.owner===address)deltas.set(b.mint,{mint:b.mint,amount:-Number(b.uiTokenAmount?.uiAmountString||0)});
     for(const b of tx.meta.postTokenBalances||[])if(b.owner===address){const v=deltas.get(b.mint)||{mint:b.mint,amount:0};v.amount+=Number(b.uiTokenAmount?.uiAmountString||0);deltas.set(b.mint,v);}
     const changes=[...deltas.values()].filter(x=>Number.isFinite(x.amount)&&x.amount!==0);
     const received=changes.filter(x=>x.amount>0),sent=changes.filter(x=>x.amount<0);
     if(received.length>0&&sent.length===0&&sol!==null&&sol<0){buys+=received.length;for(const change of received){buyMints.add(change.mint);mintCounts.set(change.mint,(mintCounts.get(change.mint)||0)+1);}}
     else if(sent.length>0&&received.length===0&&sol!==null&&sol>0){sells+=sent.length;for(const change of sent)mintCounts.set(change.mint,(mintCounts.get(change.mint)||0)+1);}
     else if(received.length>0&&sent.length>0){buys+=received.length;sells+=sent.length;for(const change of received){buyMints.add(change.mint);mintCounts.set(change.mint,(mintCounts.get(change.mint)||0)+1);}for(const change of sent)mintCounts.set(change.mint,(mintCounts.get(change.mint)||0)+1);}
     analysed++;
    }catch(_){skipped++;}
   }
   const repeats=[...mintCounts.values()].filter(n=>n>1).length;
   const coverage=Math.round(analysed/Math.max(1,Math.min(15,(signatures||[]).length))*100);
   const sampleOk=analysed>=5;
   const buyRatio=buys+sells?(buys/(buys+sells)):null;
   const activity=Math.min(100,analysed*4+buys*2+repeats*8);
   const score=sampleOk?Math.round(Math.min(100,activity*0.45+Math.min(100,buyMints.size*12)*0.35+coverage*0.2)):null;
   results.push({address,status:sampleOk?"PARTIAL":"INSUFFICIENT_DATA",score,analysed,skipped,coverage,buys,sells,buyMints:buyMints.size,repeatedMints:repeats,buyRatio,activity,method:"Exploratory activity rank: decoded sample, inferred buy activity, distinct buy mints, repeated mint interactions and coverage. Not profitability or proven smart-money quality."});
  }
  const ranked=results.filter(x=>x.score!==null).sort((a,b)=>b.score-a.score);
  ranked.forEach((x,i)=>x.rank=i+1);
  return Response.json({status:"PARTIAL",source:"Solana RPC mit automatischem Failover",rpcProvider:activeProvider,checkedAt:new Date().toISOString(),walletsChecked:wallets.length,ranked:[...ranked,...results.filter(x=>x.score===null)],note:"Nur bis zu 15 der letzten 20 Signaturen je Wallet. BUY/SELL sind Heuristiken aus Token-Delta und SOL-Delta. Ein hoher Rang bedeutet mehr beobachtete Aktivität, nicht nachgewiesenen Gewinn, Insiderwissen oder Smart-Money-Qualität. Für belastbare Performance sind längere Historie und vollständige Swap-/Preisdekodierung nötig."},{headers:{"Cache-Control":"no-store"}});
 }catch(e){return Response.json({status:"UNAVAILABLE",source:"Solana RPC mit automatischem Failover",rpcProvider:activeProvider,error:"Ranking nicht verfügbar",detail:e.message},{status:502});}
}
import { createSolanaRpc } from "../lib/solana-rpc.js";
import { decodeSwapEvidence } from "../lib/swap-decoder.js";
import { parseHistoryWindow, buildHistoryPagination } from "../lib/history-pagination.js";
import { selectPriceResolution, nearestCandle } from "../lib/price-resolution.js";
const GT="https://api.geckoterminal.com/api/v2";
const headers={"accept":"application/json;version=20230203"};
const json=async(url,opts={})=>{const r=await fetch(url,opts);if(!r.ok)throw new Error("HTTP "+r.status+" bei "+url);return r.json();};

export async function onRequestGet({request,env}){
  const rpcClient=createSolanaRpc(env);const RPCS=[];const rpc=async(_endpoints,method,params)=>({result:await rpcClient.call(method,params),provider:0});let activeProvider="Not yet selected";
 const requestUrl=new URL(request.url);const address=requestUrl.searchParams.get("address")?.trim()||"";const historyWindow=parseHistoryWindow(requestUrl);
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))return Response.json({status:"UNAVAILABLE",error:"Ungültige Solana-Wallet-Adresse"},{status:400});
 try{
  const sq=await rpc(RPCS,"getSignaturesForAddress",[address,{limit:historyWindow.rpcLimit,...(historyWindow.before?{before:historyWindow.before}:{})}]);const sigs=sq.result||[];const historyPagination=buildHistoryPagination(sigs,historyWindow.pageSize,historyWindow.before);const pageSignatures=sigs.slice(0,historyWindow.pageSize);activeProvider=rpcClient.providerLabel();const events=[],mints=new Set();let skippedTransactions=0,unclassifiedTransactions=0,decodedTransactions=0;
  for(const sig of pageSignatures){
   try{
    const tq=await rpc(RPCS,"getTransaction",[sig.signature,{encoding:"jsonParsed",maxSupportedTransactionVersion:2}]);const tx=tq.result;activeProvider=rpcClient.providerLabel();
    if(!tx?.meta||tx.meta.err||!sig.blockTime){skippedTransactions++;continue;}
    decodedTransactions++;
    const staticKeys=tx.transaction?.message?.accountKeys||[];
    const loadedKeys=[...(tx.meta?.loadedAddresses?.writable||[]),...(tx.meta?.loadedAddresses?.readonly||[])];
    const keys=[...staticKeys,...loadedKeys],ix=keys.findIndex(k=>(typeof k==="string"?k:k?.pubkey)===address);
    const sol=ix>=0?((tx.meta.postBalances?.[ix]||0)-(tx.meta.preBalances?.[ix]||0))/1e9:null;
    const changes=new Map();
    for(const b of tx.meta.preTokenBalances||[])if(b.owner===address)changes.set(b.mint,{mint:b.mint,amount:-Number(b.uiTokenAmount?.uiAmountString||0)});
    for(const b of tx.meta.postTokenBalances||[])if(b.owner===address){const v=changes.get(b.mint)||{mint:b.mint,amount:0};v.amount+=Number(b.uiTokenAmount?.uiAmountString||0);changes.set(b.mint,v);}
    const delta=[...changes.values()].filter(x=>Number.isFinite(x.amount)&&x.amount!==0);
    const evidence=decodeSwapEvidence(tx,{wallet:address,solDelta:sol,tokenChanges:delta});
    const confirmedLegMints=new Set((evidence.walletTokenLegs||[]).filter(x=>x.side==="IN"||x.side==="OUT").map(x=>x.mint).filter(Boolean));
    const sent=delta.filter(x=>x.amount<0&&confirmedLegMints.has(x.mint)),received=delta.filter(x=>x.amount>0&&confirmedLegMints.has(x.mint));
    const dexConfirmed=evidence.classification==="DEX_SWAP_EVIDENCE";
    if(!dexConfirmed){if(delta.length>0)unclassifiedTransactions++;continue;}
    // Only known DEX-program + wallet-linked transfer evidence enters the PnL ledger.
    // Heuristic BUY/SELL candidates remain excluded until independently confirmed.
    for(const change of sent){mints.add(change.mint);events.push({mint:change.mint,side:"SELL",amount:Math.abs(change.amount),time:sig.blockTime,signature:sig.signature,solDelta:sol,classification:"DEX_SWAP_EVIDENCE",dexPrograms:evidence.dexPrograms,confidence:evidence.confidence});}
    for(const change of received){mints.add(change.mint);events.push({mint:change.mint,side:"BUY",amount:change.amount,time:sig.blockTime,signature:sig.signature,solDelta:sol,classification:"DEX_SWAP_EVIDENCE",dexPrograms:evidence.dexPrograms,confidence:evidence.confidence});}
    if(!sent.length&&!received.length)unclassifiedTransactions++;
   }catch(_){skippedTransactions++;}
  }
  const priceMap={};
  for(const mint of [...mints].slice(0,8)){
   try{
    const pairs=await json("https://api.dexscreener.com/token-pairs/v1/solana/"+mint);
    const pool=(Array.isArray(pairs)?pairs:[]).filter(p=>(p.baseToken?.address===mint||p.quoteToken?.address===mint)&&p.pairAddress).sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0))[0];
    if(!pool) {priceMap[mint]={status:"UNAVAILABLE",reason:"Kein passender DEX-Screener-Pool"};continue;}
    const poolToken=pool.baseToken?.address===mint?"base":"quote";
    const mintEvents=events.filter(e=>e.mint===mint);
    const resolution=selectPriceResolution(mintEvents);
    const interval=resolution.timeframe==="minute"?60:3600;
    const end=Math.max(...mintEvents.map(e=>e.time));
    const before=Math.floor(end/interval)*interval+interval;
    const u=GT+"/networks/solana/pools/"+pool.pairAddress+"/ohlcv/"+resolution.timeframe+"?aggregate="+resolution.aggregate+"&limit=1000&before_timestamp="+before+"&currency=usd&token="+poolToken;
    const candles=await json(u,{headers});
    const list=candles?.data?.attributes?.ohlcv_list||[];
    priceMap[mint]={status:list.length?"HISTORICAL":"UNAVAILABLE",resolution,pairAddress:pool.pairAddress,poolUrl:pool.url,candles:list.map(x=>({time:x[0],open:Number(x[1]),high:Number(x[2]),low:Number(x[3]),close:Number(x[4])}))};
   }catch(e){priceMap[mint]={status:"UNAVAILABLE",reason:"Historische Kursdaten nicht abrufbar: "+e.message};}
  }
  const priced=events.map(e=>{
   const p=priceMap[e.mint],candles=p?.candles||[];
   if(!candles.length)return {...e,priceUsd:null,priceStatus:"UNAVAILABLE"};
   const resolution=p?.resolution||{toleranceSeconds:3600,method:"HOURLY_ESTIMATE"};
   const best=nearestCandle(candles,e.time,resolution.toleranceSeconds);
   if(!best)return {...e,priceUsd:null,priceStatus:"NO_NEAR_CANDLE"};
   return {...e,priceUsd:best.close,priceTime:best.time,priceStatus:"HISTORICAL_"+resolution.method};
  });
  const byMint=new Map();for(const e of priced){if(!byMint.has(e.mint))byMint.set(e.mint,[]);byMint.get(e.mint).push(e);}
  const results=[];
  for(const [mint,arr] of byMint){
   arr.sort((a,b)=>a.time-b.time);const lots=[];let realized=0,matched=0,unmatched=0,profitableClosedLots=0,losingClosedLots=0,closedLots=0,totalHoldingSeconds=0;
   for(const e of arr){
    if(e.side==="BUY"){lots.push({amount:e.amount,price:e.priceUsd,time:e.time});if(e.priceUsd==null)unmatched++;}
    else {
     let remaining=e.amount;
     while(remaining>1e-12&&lots.length){
      const lot=lots[0],qty=Math.min(remaining,lot.amount);
      if(lot.price==null||e.priceUsd==null){unmatched++;}else{
       const lotPnl=(e.priceUsd-lot.price)*qty;
       realized+=lotPnl;matched+=qty;closedLots++;
       totalHoldingSeconds+=Math.max(0,e.time-lot.time);
       if(lotPnl>0)profitableClosedLots++;else if(lotPnl<0)losingClosedLots++;
      }
      remaining-=qty;lot.amount-=qty;
      if(lot.amount<=1e-12)lots.shift();
     }

     if(remaining>0)unmatched++;
    }
   }
   const pricedLegs=arr.filter(x=>x.priceUsd!==null);const tokenInflowUsd=pricedLegs.filter(x=>x.side==="BUY").reduce((n,x)=>n+x.amount*x.priceUsd,0);const tokenOutflowUsd=pricedLegs.filter(x=>x.side==="SELL").reduce((n,x)=>n+x.amount*x.priceUsd,0);
   results.push({mint,buys:arr.filter(x=>x.side==="BUY").length,sells:arr.filter(x=>x.side==="SELL").length,matchedTokenAmount:matched,estimatedRealizedPnlUsd:matched?realized:null,profitableClosedLots,losingClosedLots,closedLots,winRateClosedLots:closedLots?profitableClosedLots/closedLots:null,averageHoldingDays:closedLots?totalHoldingSeconds/closedLots/86400:null,openLots:lots.length,unmatchedEvents:unmatched,estimatedTokenLegsUsd:{inflow:tokenInflowUsd,outflow:tokenOutflowUsd,net:tokenInflowUsd-tokenOutflowUsd,pricedEvents:pricedLegs.length,totalEvents:arr.length,status:pricedLegs.length===arr.length?"HISTORICAL":"PARTIAL",method:"Token-Menge × nächstgelegener historischer 1-Minuten- oder Stundenkerzen-Schlusskurs; keine exakte Swap-Gegenleistung"},events:arr.map(({mint,...x})=>x),priceSource:priceMap[mint]?.resolution?.method||priceMap[mint]?.status||"UNAVAILABLE",poolUrl:priceMap[mint]?.poolUrl||null});
  }
  const closed=results.filter(x=>x.estimatedRealizedPnlUsd!==null),wins=closed.filter(x=>x.estimatedRealizedPnlUsd>0).length,closedLots=results.reduce((n,x)=>n+(x.closedLots||0),0),winningLots=results.reduce((n,x)=>n+(x.profitableClosedLots||0),0),losingLots=results.reduce((n,x)=>n+(x.losingClosedLots||0),0),holdingDays=results.reduce((n,x)=>n+(x.averageHoldingDays||0)*(x.closedLots||0),0);
  return Response.json({status:"PARTIAL",source:"Solana RPC mit automatischem Failover + DEX Screener + GeckoTerminal OHLCV",rpcProvider:activeProvider,address,checkedAt:new Date().toISOString(),events:priced.length,signaturesReceived:pageSignatures.length,transactionsRequested:pageSignatures.length,skippedTransactions,unclassifiedTransactions,coverage:Math.round(decodedTransactions/Math.max(1,pageSignatures.length)*100),decodedTransactions,confirmedSwapTransactions:new Set(events.map(e=>e.signature)).size,historyStatus:historyPagination.status,historyPagination,tokenResults:results,summary:{tokens:results.length,pricedEvents:priced.filter(x=>x.priceUsd!==null).length,unpricedEvents:priced.filter(x=>x.priceUsd===null).length,estimatedTokenLegInflowUsd:results.reduce((n,x)=>n+(x.estimatedTokenLegsUsd?.inflow||0),0),estimatedTokenLegOutflowUsd:results.reduce((n,x)=>n+(x.estimatedTokenLegsUsd?.outflow||0),0),closedTokens:closed.length,positiveTokenPnlTokens:wins,tokenLevelPositiveShare:closed.length?wins/closed.length:null,closedFifoLots:closedLots,winningFifoLots:winningLots,losingFifoLots:losingLots,fifoLotWinRate:closedLots?winningLots/closedLots:null,averageHoldingDays:closedLots?holdingDays/closedLots:null,reputationStatus:closedLots>=10?"PARTIAL":"INSUFFICIENT_DATA"},note:"Pro Abruf eine paginierte Transaktionsseite (standardmäßig 25, maximal 30 Signaturen) und bis zu 8 Token. Bei hasMore=true mit nextBefore die nächste Seite abrufen. FIFO und PnL gelten ausschließlich für die aktuelle Seite und werden noch nicht seitenübergreifend zusammengeführt. RPC_PAGE_EXHAUSTED bedeutet nur, dass der aktuelle RPC-Aufruf keine weitere Seite geliefert hat, nicht dass die gesamte Wallet-Historie vollständig ist. RPC-Abdeckung misst erfolgreich geladene Transaktionen; unklassifizierte Bewegungen werden separat gezählt. Nur DEX_SWAP_EVIDENCE aus gemeinsamem Decoder (bekanntes DEX-Programm plus Wallet-Transfer-/Saldo-Indizien) gelangt in die FIFO-PnL-Auswertung; heuristische BUY/SELL-Kandidaten bleiben ausgeschlossen. FIFO-PnL ist eine Näherung aus nächstgelegenen 1-Minuten-Kerzen (bei Zeitfenstern bis 15 Stunden) oder Stundenkerzen und dem aktuell ermittelten Pool, nicht der exakte Ausführungspreis. FIFO-Lot-Trefferquote und Haltedauer sind stundenkursbasierte Näherungen, keine vollständige Wallet-Reputation. Keine Gebühren-/Slippage-/MEV-/Steuerberechnung. Unbepreiste BUYs blockieren die FIFO-Zuordnung ihrer späteren SELL-Mengen, statt falsche Gewinne zu erzeugen. Trefferquote auf Token-Ebene, keine Trade-Trefferquote."},{headers:{"Cache-Control":"no-store"}});
 }catch(e){activeProvider=rpcClient.providerLabel();return Response.json({status:"UNAVAILABLE",rpcProvider:activeProvider,error:"Historische Performance konnte nicht berechnet werden",detail:e.message,tokenResults:[]},{status:502});}
}
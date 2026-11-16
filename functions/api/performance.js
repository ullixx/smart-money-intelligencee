import { createSolanaRpc } from "../lib/solana-rpc.js";
import { decodeSwapEvidence } from "../lib/swap-decoder.js";
import { parseHistoryWindow, buildHistoryPagination } from "../lib/history-pagination.js";
import { selectPriceResolution, nearestCandle, deriveUsdcExecutionPrice, SOLANA_USDC_MINT } from "../lib/price-resolution.js";
import { aggregatePerformancePages } from "../lib/reputation-metrics.js";
const GT="https://api.geckoterminal.com/api/v2";
const headers={"accept":"application/json;version=20230203"};
const json=async(url,opts={})=>{const r=await fetch(url,opts);if(!r.ok)throw new Error("HTTP "+r.status+" bei "+url);return r.json();};

export async function onRequestGet({request,env}){
  const rpcClient=createSolanaRpc(env);const RPCS=[];const rpc=async(_endpoints,method,params)=>({result:await rpcClient.call(method,params),provider:0});let activeProvider="Not yet selected";
 const requestUrl=new URL(request.url);const address=requestUrl.searchParams.get("address")?.trim()||"";const historyWindow=parseHistoryWindow(requestUrl);const requestedPages=Math.max(1,Math.min(3,Number.parseInt(requestUrl.searchParams.get("pages")||"3",10)||3));
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))return Response.json({status:"UNAVAILABLE",error:"Ungültige Solana-Wallet-Adresse"},{status:400});
 try{
  const events=[],mints=new Set(),historyPageResults=[];let skippedTransactions=0,unclassifiedTransactions=0,decodedTransactions=0,signatureCursor=historyWindow.before;
  for(let pageIndex=0;pageIndex<requestedPages;pageIndex++){
   const sigResult=await rpc(RPCS,"getSignaturesForAddress",[address,{limit:historyWindow.rpcLimit,...(signatureCursor?{before:signatureCursor}:{})}]);
   const signatures=sigResult.result||[];
   const pageInfo=buildHistoryPagination(signatures,historyWindow.pageSize,signatureCursor);
   const pageSignatures=signatures.slice(0,historyWindow.pageSize);
   historyPageResults.push({page:pageIndex+1,signatures:pageSignatures.length,...pageInfo});
   activeProvider=rpcClient.providerLabel();
   if(!pageSignatures.length)break;
   let txBatch=[];
   try{
    txBatch=await rpcClient.callBatch(pageSignatures.map(sig=>({method:"getTransaction",params:[sig.signature,{encoding:"jsonParsed",maxSupportedTransactionVersion:2}]})));
    activeProvider=rpcClient.providerLabel();
   }catch(_){txBatch=[];}
   for(let txIndex=0;txIndex<pageSignatures.length;txIndex++){
    const sig=pageSignatures[txIndex];
    try{
     const tx=txBatch[txIndex];
     if(tx?.__rpcError)throw new Error(tx.__rpcError);
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
     if(evidence.classification!=="DEX_SWAP_EVIDENCE"){if(delta.length>0)unclassifiedTransactions++;continue;}
     for(const change of sent){if(change.mint===SOLANA_USDC_MINT)continue;const executionPriceUsd=deriveUsdcExecutionPrice({mint:change.mint,amount:Math.abs(change.amount),side:"SELL",tokenChanges:delta});const leg=(evidence.walletTokenLegs||[]).find(x=>x.mint===change.mint&&x.side==="OUT");mints.add(change.mint);events.push({mint:change.mint,side:"SELL",amount:Math.abs(change.amount),rawAmount:leg?.rawAmount??null,decimals:leg?.decimals??null,time:sig.blockTime,signature:sig.signature,solDelta:sol,classification:"DEX_SWAP_EVIDENCE",dexPrograms:evidence.dexPrograms,counterparties:evidence.counterparties,confidence:evidence.confidence,executionPriceUsd});}
     for(const change of received){if(change.mint===SOLANA_USDC_MINT)continue;const executionPriceUsd=deriveUsdcExecutionPrice({mint:change.mint,amount:change.amount,side:"BUY",tokenChanges:delta});const leg=(evidence.walletTokenLegs||[]).find(x=>x.mint===change.mint&&x.side==="IN");mints.add(change.mint);events.push({mint:change.mint,side:"BUY",amount:change.amount,rawAmount:leg?.rawAmount??null,decimals:leg?.decimals??null,time:sig.blockTime,signature:sig.signature,solDelta:sol,classification:"DEX_SWAP_EVIDENCE",dexPrograms:evidence.dexPrograms,counterparties:evidence.counterparties,confidence:evidence.confidence,executionPriceUsd});}
     if(!sent.some(x=>x.mint!==SOLANA_USDC_MINT)&&!received.some(x=>x.mint!==SOLANA_USDC_MINT))unclassifiedTransactions++;
    }catch(_){skippedTransactions++;}
   }
   if(!pageInfo.hasMore||!pageInfo.nextBefore)break;
   signatureCursor=pageInfo.nextBefore;
  }
  const lastHistoryPage=historyPageResults[historyPageResults.length-1]||{hasMore:false,nextBefore:null,status:"RPC_PAGE_EXHAUSTED"};
  const historyPagination={...lastHistoryPage,pagesFetched:historyPageResults.length,pagesRequested:requestedPages,transactionsScanned:historyPageResults.reduce((n,x)=>n+x.signatures,0),nextBefore:lastHistoryPage.nextBefore,hasMore:Boolean(lastHistoryPage.hasMore),pageResults:historyPageResults};
  const totalSignatures=historyPagination.transactionsScanned;
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
   if(Number.isFinite(e.executionPriceUsd))return {...e,priceUsd:e.executionPriceUsd,priceTime:e.time,priceStatus:"EXECUTION_QUOTE_USDC_PEG_ESTIMATE"};
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
   results.push({mint,buys:arr.filter(x=>x.side==="BUY").length,sells:arr.filter(x=>x.side==="SELL").length,matchedTokenAmount:matched,estimatedRealizedPnlUsd:matched?realized:null,profitableClosedLots,losingClosedLots,closedLots,winRateClosedLots:closedLots?profitableClosedLots/closedLots:null,averageHoldingDays:closedLots?totalHoldingSeconds/closedLots/86400:null,openLots:lots.length,unmatchedEvents:unmatched,estimatedTokenLegsUsd:{inflow:tokenInflowUsd,outflow:tokenOutflowUsd,net:tokenInflowUsd-tokenOutflowUsd,pricedEvents:pricedLegs.length,totalEvents:arr.length,status:pricedLegs.length===arr.length?"HISTORICAL":"PARTIAL",method:"Bevorzugt Wallet-USDC-Gegenfluss ÷ Token-Menge (USDC-Peg-Annahme 1 USD); sonst nächstgelegener historischer Kerzenschlusskurs"},events:arr.map(({mint,...x})=>x),priceSource:arr.every(x=>x.priceStatus==="EXECUTION_QUOTE_USDC_PEG_ESTIMATE")?"USDC_EXECUTION_RATIO_PEGGED":arr.some(x=>x.priceStatus==="EXECUTION_QUOTE_USDC_PEG_ESTIMATE")?"MIXED_EXECUTION_AND_CANDLES":priceMap[mint]?.resolution?.method||priceMap[mint]?.status||"UNAVAILABLE",executionPricedEvents:arr.filter(x=>x.priceStatus==="EXECUTION_QUOTE_USDC_PEG_ESTIMATE").length,poolUrl:priceMap[mint]?.poolUrl||null});
  }
  const reputation=aggregatePerformancePages([{tokenResults:results}]);
  const reputationResults=results.map(token=>{const metrics=reputation.tokenResults.find(x=>x.mint===token.mint)||{};return {...token,closedTrades:metrics.closedTrades??0,winningTrades:metrics.winningTrades??0,losingTrades:metrics.losingTrades??0,breakevenTrades:metrics.breakevenTrades??0,partialClosedTrades:metrics.partialClosedTrades??0,averageWinUsd:metrics.averageWinUsd??null,averageLossUsd:metrics.averageLossUsd??null,grossProfitUsd:metrics.grossProfitUsd??0,grossLossUsd:metrics.grossLossUsd??0,profitFactor:metrics.profitFactor??null,winRateClosedTrades:metrics.winRateClosedTrades??null};});
  const reputationSummary=reputation.summary;
  return Response.json({status:"PARTIAL",source:"Solana RPC mit automatischem Failover + DEX Screener + GeckoTerminal OHLCV",rpcProvider:activeProvider,address,checkedAt:new Date().toISOString(),events:priced.length,signaturesReceived:totalSignatures,transactionsRequested:totalSignatures,skippedTransactions,unclassifiedTransactions,coverage:Math.round(decodedTransactions/Math.max(1,totalSignatures)*100),decodedTransactions,confirmedSwapTransactions:new Set(events.map(e=>e.signature)).size,historyStatus:historyPagination.status,historyPagination,tokenResults:reputationResults,summary:{...reputationSummary,pricedEvents:priced.filter(x=>x.priceUsd!==null).length,unpricedEvents:priced.filter(x=>x.priceUsd===null).length,estimatedTokenLegInflowUsd:results.reduce((n,x)=>n+(x.estimatedTokenLegsUsd?.inflow||0),0),estimatedTokenLegOutflowUsd:results.reduce((n,x)=>n+(x.estimatedTokenLegsUsd?.outflow||0),0),winningFifoLots:reputationSummary.winningTrades,losingFifoLots:reputationSummary.losingTrades,tradeWinRate:reputationSummary.winRateClosedTrades??reputationSummary.fifoLotWinRate},note:"Pro Abruf bis zu 3 paginierte Seiten mit je 50 Signaturen (maximal 150) und bis zu 8 Token. BUY/SELL-Ereignisse und FIFO werden über alle in diesem Abruf geladenen Seiten zusammengeführt; weitere Abrufe setzen am nextBefore-Cursor fort. Die Oberfläche führt die geladenen Abrufe zusätzlich zusammen. Die gesamte Wallet-Historie ist erst dann abgedeckt, wenn der RPC keine weitere Seite meldet. RPC_PAGE_EXHAUSTED bedeutet nur, dass der aktuelle RPC-Aufruf keine weitere Seite geliefert hat, nicht dass die gesamte Wallet-Historie vollständig ist. RPC-Abdeckung misst erfolgreich geladene Transaktionen; unklassifizierte Bewegungen werden separat gezählt. Nur DEX_SWAP_EVIDENCE aus gemeinsamem Decoder (bekanntes DEX-Programm plus Wallet-Transfer-/Saldo-Indizien) gelangt in die FIFO-PnL-Auswertung; heuristische BUY/SELL-Kandidaten bleiben ausgeschlossen. FIFO-PnL nutzt, wenn eindeutig vorhanden, den tatsächlichen Wallet-USDC-Gegenfluss als Ausführungskurs unter der Annahme eines 1-USD-USDC-Pegs; ansonsten nächstgelegene 1-Minuten- oder Stundenkerzen des aktuell ermittelten Pools. Das ist keine vollständige Ausführungspreis-, Gebühren- oder Slippage-Abrechnung. Trade-Trefferquote zählt vollständig bepreiste abgeschlossene SELL-Transaktionen; Break-even-Trades bleiben im Nenner, teilweise bepreiste Trades werden separat ausgewiesen. Haltedauer und PnL sind Näherungen aus historischen Minuten- oder Stundenkursen, keine vollständige Wallet-Reputation. Keine Gebühren-/Slippage-/MEV-/Steuerberechnung. Unbepreiste BUYs blockieren die FIFO-Zuordnung ihrer späteren SELL-Mengen, statt falsche Gewinne zu erzeugen. Trefferquote auf Trade-Ebene; nur vollständig bewertete abgeschlossene Trades zählen."},{headers:{"Cache-Control":"no-store"}});
 }catch(e){activeProvider=rpcClient.providerLabel();return Response.json({status:"UNAVAILABLE",rpcProvider:activeProvider,error:"Historische Performance konnte nicht berechnet werden",detail:e.message,tokenResults:[]},{status:502});}
}
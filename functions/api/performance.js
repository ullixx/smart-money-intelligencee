const GT="https://api.geckoterminal.com/api/v2";
const headers={"accept":"application/json;version=20230203"};
const json=async(url,opts={})=>{const r=await fetch(url,opts);if(!r.ok)throw new Error("HTTP "+r.status+" bei "+url);return r.json();};
const rpc=async(endpoint,method,params)=>{const j=await json(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});if(j.error)throw new Error(j.error.message||"RPC-Fehler");return j.result;};
export async function onRequestGet({request,env}){
  const RPC=env?.SOLANA_RPC_URL||env?.SOLANA_RPC_FALLBACK_URL||"https://solana-rpc.publicnode.com";
 const address=new URL(request.url).searchParams.get("address")?.trim()||"";
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))return Response.json({status:"UNAVAILABLE",error:"Ungültige Solana-Wallet-Adresse"},{status:400});
 try{
  const sigs=await rpc(RPC,"getSignaturesForAddress",[address,{limit:30}]),events=[],mints=new Set();let skippedTransactions=0,unclassifiedTransactions=0;
  for(const sig of (sigs||[]).slice(0,25)){
   try{
    const tx=await rpc(RPC,"getTransaction",[sig.signature,{encoding:"jsonParsed",maxSupportedTransactionVersion:2}]);
    if(!tx?.meta||tx.meta.err||!sig.blockTime){skippedTransactions++;continue;}
    const keys=tx.transaction?.message?.accountKeys||[],ix=keys.findIndex(k=>(typeof k==="string"?k:k.pubkey)===address);
    const sol=ix>=0?((tx.meta.postBalances?.[ix]||0)-(tx.meta.preBalances?.[ix]||0))/1e9:null;
    const changes=new Map();
    for(const b of tx.meta.preTokenBalances||[])if(b.owner===address)changes.set(b.mint,{mint:b.mint,amount:-Number(b.uiTokenAmount?.uiAmountString||0)});
    for(const b of tx.meta.postTokenBalances||[])if(b.owner===address){const v=changes.get(b.mint)||{mint:b.mint,amount:0};v.amount+=Number(b.uiTokenAmount?.uiAmountString||0);changes.set(b.mint,v);}
    const delta=[...changes.values()].filter(x=>Number.isFinite(x.amount)&&x.amount!==0);
    if(delta.length!==1||sol===null){if(delta.length>0)unclassifiedTransactions++;continue;}
    const c=delta[0];let side=null;
    if(c.amount>0&&sol<0)side="BUY";else if(c.amount<0&&sol>0)side="SELL";else {unclassifiedTransactions++;continue;}
    mints.add(c.mint);events.push({mint:c.mint,side,amount:Math.abs(c.amount),time:sig.blockTime,signature:sig.signature,solDelta:sol});
   }catch(_){skippedTransactions++;}
  }
  const priceMap={};
  for(const mint of [...mints].slice(0,8)){
   try{
    const pairs=await json("https://api.dexscreener.com/token-pairs/v1/solana/"+mint);
    const pool=(Array.isArray(pairs)?pairs:[]).filter(p=>p.baseToken?.address===mint&&p.pairAddress).sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0))[0];
    if(!pool) {priceMap[mint]={status:"UNAVAILABLE",reason:"Kein passender DEX-Screener-Pool"};continue;}
    const end=Math.max(...events.filter(e=>e.mint===mint).map(e=>e.time));
    const before=Math.floor(end/3600)*3600+3600;
    const u=GT+"/networks/solana/pools/"+pool.pairAddress+"/ohlcv/hour?aggregate=1&limit=1000&before_timestamp="+before+"&currency=usd&token=base";
    const candles=await json(u,{headers});
    const list=candles?.data?.attributes?.ohlcv_list||[];
    priceMap[mint]={status:list.length?"HISTORICAL":"UNAVAILABLE",pairAddress:pool.pairAddress,poolUrl:pool.url,candles:list.map(x=>({time:x[0],open:Number(x[1]),high:Number(x[2]),low:Number(x[3]),close:Number(x[4])}))};
   }catch(e){priceMap[mint]={status:"UNAVAILABLE",reason:"Historische Kursdaten nicht abrufbar: "+e.message};}
  }
  const priced=events.map(e=>{
   const p=priceMap[e.mint],candles=p?.candles||[];
   if(!candles.length)return {...e,priceUsd:null,priceStatus:"UNAVAILABLE"};
   let best=candles.reduce((a,c)=>Math.abs(c.time-e.time)<Math.abs(a.time-e.time)?c:a,candles[0]);
   if(Math.abs(best.time-e.time)>3600)return {...e,priceUsd:null,priceStatus:"NO_NEAR_CANDLE"};
   return {...e,priceUsd:best.close,priceTime:best.time,priceStatus:"HISTORICAL_HOURLY_ESTIMATE"};
  });
  const byMint=new Map();for(const e of priced){if(!byMint.has(e.mint))byMint.set(e.mint,[]);byMint.get(e.mint).push(e);}
  const results=[];
  for(const [mint,arr] of byMint){
   arr.sort((a,b)=>a.time-b.time);const lots=[];let realized=0,matched=0,unmatched=0;
   for(const e of arr){
    if(e.side==="BUY"){lots.push({amount:e.amount,price:e.priceUsd,time:e.time});if(e.priceUsd==null)unmatched++;}
    else {
     let remaining=e.amount;
     if(e.priceUsd==null){unmatched++;continue;}
     while(remaining>0&&lots.length){
      const lot=lots[0],qty=Math.min(remaining,lot.amount);
      realized+=(e.priceUsd-lot.price)*qty;matched+=qty;remaining-=qty;lot.amount-=qty;
      if(lot.amount<=1e-12)lots.shift();
     }
     if(remaining>0)unmatched++;
    }
   }
   results.push({mint,buys:arr.filter(x=>x.side==="BUY").length,sells:arr.filter(x=>x.side==="SELL").length,matchedTokenAmount:matched,estimatedRealizedPnlUsd:matched?realized:null,profitableClosedLots:realized>0?1:0,openLots:lots.length,unmatchedEvents:unmatched,events:arr.map(({mint,...x})=>x),priceSource:priceMap[mint]?.status||"UNAVAILABLE",poolUrl:priceMap[mint]?.poolUrl||null});
  }
  const closed=results.filter(x=>x.estimatedRealizedPnlUsd!==null),wins=closed.filter(x=>x.estimatedRealizedPnlUsd>0).length;
  return Response.json({status:"PARTIAL",source:"Configured Solana RPC + DEX Screener + GeckoTerminal OHLCV",address,checkedAt:new Date().toISOString(),events:priced.length,signaturesReceived:(sigs||[]).length,transactionsRequested:Math.min(25,(sigs||[]).length),skippedTransactions,unclassifiedTransactions,coverage:Math.round((Math.min(25,(sigs||[]).length)-skippedTransactions-unclassifiedTransactions)/Math.max(1,Math.min(25,(sigs||[]).length))*100),historyStatus:(sigs||[]).length>=25?"LIMITED_TO_RECENT_25":"AVAILABLE_SIGNATURE_WINDOW",tokenResults:results,summary:{tokens:results.length,pricedEvents:priced.filter(x=>x.priceUsd!==null).length,unpricedEvents:priced.filter(x=>x.priceUsd===null).length,closedTokens:closed.length,positiveTokenPnlTokens:wins,tokenLevelPositiveShare:closed.length?wins/closed.length:null},note:"Nur bis zu 25 jüngste Transaktionen und bis zu 8 Token. Übersprungene oder nicht dekodierbare Transaktionen werden separat ausgewiesen. FIFO-PnL ist eine Näherung aus Stundenkerzen-Schlusskursen; keine Gebühren-/Slippage-/MEV-/Steuerberechnung. Unklassifizierte Bewegungen werden separat gezählt. Unbepreiste BUYs blockieren die FIFO-Zuordnung ihrer späteren SELL-Mengen, statt falsche Gewinne zu erzeugen. Trefferquote auf Token-Ebene, keine Trade-Trefferquote."},{headers:{"Cache-Control":"no-store"}});
 }catch(e){return Response.json({status:"UNAVAILABLE",error:"Historische Performance konnte nicht berechnet werden",detail:e.message,tokenResults:[]},{status:502});}
}
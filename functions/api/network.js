const RPC="https://api.mainnet-beta.solana.com";
export async function onRequestGet({request}) {
 const u=new URL(request.url);
 const wallets=[...new Set((u.searchParams.get("wallets")||"").split(",").map(x=>x.trim()).filter(Boolean))].slice(0,5);
 if(wallets.length<2||wallets.some(a=>!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a))) return Response.json({status:"UNAVAILABLE",error:"Mindestens zwei gültige Solana-Wallet-Adressen erforderlich.",clusters:[]},{status:400});
 const rpc=async(method,params)=>{const r=await fetch(RPC,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});if(!r.ok)throw new Error("RPC HTTP "+r.status);const j=await r.json();if(j.error)throw new Error(j.error.message||"RPC error");return j.result;};
 try{
  const events=[];let transactionsRequested=0,transactionsAnalysed=0,skippedTransactions=0;
  for(const wallet of wallets){
   const sigs=await rpc("getSignaturesForAddress",[wallet,{limit:8}]);
   for(const sig of (sigs||[]).slice(0,8)){
    transactionsRequested++;
    try{
     const tx=await rpc("getTransaction",[sig.signature,{encoding:"jsonParsed",maxSupportedTransactionVersion:0}]);
     if(!tx?.meta||tx.meta.err||!sig.blockTime){skippedTransactions++;continue;}
     transactionsAnalysed++;
     const keys=tx.transaction?.message?.accountKeys||[],walletIndex=keys.findIndex(k=>(typeof k==="string"?k:k.pubkey)===wallet);
     const solDelta=walletIndex>=0?((tx.meta.postBalances?.[walletIndex]||0)-(tx.meta.preBalances?.[walletIndex]||0))/1e9:null;
     const deltas=new Map();
     for(const b of tx.meta.preTokenBalances||[])if(b.owner===wallet)deltas.set(b.mint,{mint:b.mint,delta:-Number(b.uiTokenAmount?.uiAmountString||0)});
     for(const b of tx.meta.postTokenBalances||[])if(b.owner===wallet){const v=deltas.get(b.mint)||{mint:b.mint,delta:0};v.delta+=Number(b.uiTokenAmount?.uiAmountString||0);deltas.set(b.mint,v);}
     for(const v of deltas.values())if(Number.isFinite(v.delta)&&v.delta>0&&solDelta!==null&&solDelta<0)events.push({wallet,mint:v.mint,time:sig.blockTime,signature:sig.signature,amount:v.delta,solDelta});
    }catch(_){skippedTransactions++;}
   }
  }
  const byMint=new Map();for(const e of events){if(!byMint.has(e.mint))byMint.set(e.mint,[]);byMint.get(e.mint).push(e);}
  const clusters=[];
  for(const [mint,ev] of byMint){
   ev.sort((a,b)=>a.time-b.time);
   for(let i=0;i<ev.length;i++){
    const group=ev.filter(x=>Math.abs(x.time-ev[i].time)<=1800);
    const unique=[...new Set(group.map(x=>x.wallet))];
    if(unique.length>=2&&!clusters.some(c=>c.mint===mint&&Math.abs(c.firstSeen-ev[i].time)<=1800)){
     const first=Math.min(...group.map(x=>x.time)),last=Math.max(...group.map(x=>x.time));
     clusters.push({mint,walletCount:unique.length,wallets:unique.map(a=>a.slice(0,5)+"…"+a.slice(-5)),firstSeen:new Date(first*1000).toISOString(),windowMinutes:Math.round((last-first)/60),events:group.length,signatures:[...new Set(group.map(x=>x.signature))].slice(0,5)});
    }
   }
  }
  clusters.sort((a,b)=>b.walletCount-a.walletCount||b.events-a.events);
  const overlap=[...byMint.entries()].map(([mint,ev])=>({mint,walletCount:new Set(ev.map(x=>x.wallet)).size})).filter(x=>x.walletCount>=2).sort((a,b)=>b.walletCount-a.walletCount);
  return Response.json({status:"PARTIAL",source:"Solana public RPC",checkedAt:new Date().toISOString(),walletsChecked:wallets.length,transactionsRequested,transactionsAnalysed,skippedTransactions,coverage:Math.round(transactionsAnalysed/Math.max(1,transactionsRequested)*100),positiveTokenMovements:events.length,inferredBuyCandidates:events.length,clusters,sharedTokens:overlap,note:"Erfasst werden positive Token-Bewegungen bei gleichzeitigem SOL-Abgang. Das ist nur ein Kaufkandidat: Gebühren, Rent, Token-Transfers und Swap-Routen können die Zuordnung verfälschen. Zeitliche Überschneidungen beweisen weder gemeinsame Kontrolle noch Insider-Verbindungen."},{headers:{"Cache-Control":"no-store"}});
 }catch(e){return Response.json({status:"UNAVAILABLE",error:"Solana RPC nicht erreichbar oder rate-limited",detail:e.message,clusters:[]},{status:502});}
}
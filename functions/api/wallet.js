import { createSolanaRpc } from "../lib/solana-rpc.js";
const DEX_PROGRAM_IDS=new Set([
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  "675kPX9MHTjS2zt1qfr1NYHuzeL7N9T8r8Z3F5V5",
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
]);
const hasKnownDexInstruction=tx=>{
  const keys=tx.transaction?.message?.accountKeys||[];
  const loaded=[...(tx.meta?.loadedAddresses?.writable||[]),...(tx.meta?.loadedAddresses?.readonly||[])];
  const keyAt=index=>{
    const key=index<keys.length?keys[index]:loaded[index-keys.length];
    return typeof key==="string"?key:key?.pubkey;
  };
  const outer=tx.transaction?.message?.instructions||[];
  const inner=(tx.meta?.innerInstructions||[]).flatMap(x=>x.instructions||[]);
  return [...outer,...inner].some(ix=>{
    let id=ix.programId;
    if(!id&&Number.isInteger(ix.programIdIndex))id=keyAt(ix.programIdIndex);
    return typeof id==="string"&&DEX_PROGRAM_IDS.has(id);
  });
};
export async function onRequestGet({ request, env }) {
  const url=new URL(request.url),address=(url.searchParams.get("address")||"").trim();
  if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))return Response.json({status:"UNAVAILABLE",error:"Ungültige Solana-Wallet-Adresse",transactions:[]},{status:400});
  const rpc=createSolanaRpc(env);
  const call=rpc.call;
  let rpcProvider="Not yet selected";
  try{
    const signatures=await call("getSignaturesForAddress",[address,{limit:40}]);
    const selected=(signatures||[]).slice(0,12);
    let skippedTransactions=0;
    const skipReasons={rpcError:0,transactionNotFound:0,missingMetadata:0,failedTransaction:0};
    const rpcErrorDetails={};
    const analyse=async (item,tx)=>{
      try{
        if(tx?.__rpcError)throw new Error(tx.__rpcError);
        if(!tx){skipReasons.transactionNotFound++;return null;}
        if(!tx.meta){skipReasons.missingMetadata++;return null;}
        if(tx.meta.err){skipReasons.failedTransaction++;return null;}
        const staticKeys=tx.transaction?.message?.accountKeys||[];
        const loadedKeys=[...(tx.meta?.loadedAddresses?.writable||[]),...(tx.meta?.loadedAddresses?.readonly||[])];
        const keys=[...staticKeys,...loadedKeys];
        const index=keys.findIndex(k=>(typeof k==="string"?k:k?.pubkey)===address);
        const solDelta=index>=0?((tx.meta.postBalances?.[index]||0)-(tx.meta.preBalances?.[index]||0))/1e9:null;
        const changes=new Map();
        for(const b of tx.meta.preTokenBalances||[])if(b.owner===address)changes.set(b.mint,{mint:b.mint,amount:-Number(b.uiTokenAmount?.uiAmountString||0)});
        for(const b of tx.meta.postTokenBalances||[])if(b.owner===address){const v=changes.get(b.mint)||{mint:b.mint,amount:0};v.amount+=Number(b.uiTokenAmount?.uiAmountString||0);changes.set(b.mint,v);}
        const tokenChanges=[...changes.values()].filter(x=>Number.isFinite(x.amount)&&x.amount!==0);
        const received=tokenChanges.filter(x=>x.amount>0),sent=tokenChanges.filter(x=>x.amount<0);
        let classification="UNCLEAR",classificationBasis="Nicht eindeutig";
        const dexInstructionDetected=hasKnownDexInstruction(tx);
        if(dexInstructionDetected&&((received.length>0&&sent.length>0)||(received.length>0&&solDelta!==null&&solDelta<0)||(sent.length>0&&solDelta!==null&&solDelta>0))){classification="DEX_SWAP_DETECTED";classificationBasis="Bekannte DEX-Programm-ID + gegenläufige Token-/SOL-Salden; Token-Gegenleistung wird aus Wallet-Salden rekonstruiert";}
        else if(received.length>0&&sent.length>0){classification="SWAP_CANDIDATE";classificationBasis="Gegenläufige Token-Salden; unbekannter oder nicht bestätigter Router, daher Swap-Kandidat";}
        else if(received.length>0&&sent.length===0&&solDelta!==null&&solDelta<0){classification="BUY_INFERRED";classificationBasis="Token-Zugang + SOL-Abgang; Kauf nur vermutet, kein bestätigtes DEX-Programm";}
        else if(sent.length>0&&received.length===0&&solDelta!==null&&solDelta>0){classification="SELL_INFERRED";classificationBasis="Token-Abgang + SOL-Zugang; Verkauf nur vermutet, kein bestätigtes DEX-Programm";}
        else if(tokenChanges.length>0){classification="TOKEN_MOVEMENT";classificationBasis="Token-Bewegung ohne eindeutig rekonstruierbare Gegenleistung";}
        const assetsSent=sent.map(x=>({mint:x.mint,amount:Math.abs(x.amount)}));
        const assetsReceived=received.map(x=>({mint:x.mint,amount:x.amount}));
        return {signature:item.signature,time:item.blockTime?new Date(item.blockTime*1000).toISOString():null,slot:item.slot??null,solDelta,tokenChanges,assetsSent,assetsReceived,swapDirection:assetsSent.length&&assetsReceived.length?"TOKEN_TO_TOKEN":assetsReceived.length&&solDelta<0?"SOL_TO_TOKEN":assetsSent.length&&solDelta>0?"TOKEN_TO_SOL":"UNRESOLVED",classification,classificationBasis,feeSol:(tx.meta.fee||0)/1e9,success:!tx.meta.err};
      }catch(error){skipReasons.rpcError++;const message=String(error?.message||error||"Unknown RPC error").slice(0,180);rpcErrorDetails[message]=(rpcErrorDetails[message]||0)+1;return null;}
    };
    const transactions=[];
    // Ein JSON-RPC-Batch reduziert Worker-Subrequests gegenüber Einzelabfragen.
    let transactionResults=[];
    try{
      transactionResults=await rpc.callBatch(selected.map(item=>({method:"getTransaction",params:[item.signature,{encoding:"jsonParsed",maxSupportedTransactionVersion:2}]})));
    }catch(error){
      skipReasons.rpcError+=selected.length;
      skippedTransactions+=selected.length;
      const message=String(error?.message||error||"Unknown RPC error").slice(0,180);
      rpcErrorDetails[message]=(rpcErrorDetails[message]||0)+selected.length;
    }
    if(transactionResults.length){
      const analysedBatch=await Promise.all(selected.map((item,index)=>analyse(item,transactionResults[index])));
      for(const tx of analysedBatch){if(tx)transactions.push(tx);else skippedTransactions++;}
    }
    const successful=transactions.filter(t=>t.success),buyClasses=["BUY_INFERRED","DEX_SWAP_DETECTED","SWAP_CANDIDATE"],sellClasses=["SELL_INFERRED","DEX_SWAP_DETECTED","SWAP_CANDIDATE"],buys=successful.reduce((n,t)=>n+(buyClasses.includes(t.classification)&&t.assetsReceived.length?1:0),0),sells=successful.reduce((n,t)=>n+(sellClasses.includes(t.classification)&&t.assetsSent.length?1:0),0),classificationCounts=successful.reduce((o,t)=>(o[t.classification]=(o[t.classification]||0)+1,o),{});
    const ledgerMap=new Map();
    for(const tx of successful)for(const c of tx.tokenChanges){const v=ledgerMap.get(c.mint)||{mint:c.mint,netAmount:0,received:0,sent:0,transactions:0,firstSeen:tx.time,lastSeen:tx.time};v.netAmount+=c.amount;if(c.amount>0)v.received+=c.amount;else v.sent+=Math.abs(c.amount);v.transactions++;if(tx.time&&(!v.firstSeen||tx.time<v.firstSeen))v.firstSeen=tx.time;if(tx.time&&(!v.lastSeen||tx.time>v.lastSeen))v.lastSeen=tx.time;ledgerMap.set(c.mint,v);}
    const tokenLedger=[...ledgerMap.values()].sort((a,b)=>b.transactions-a.transactions);
    const buyEvents=[];
    for(const tx of successful){
      if(!["BUY_INFERRED","DEX_SWAP_DETECTED","SWAP_CANDIDATE"].includes(tx.classification))continue;
      for(const change of tx.tokenChanges.filter(x=>x.amount>0)){
        buyEvents.push({mint:change.mint,time:tx.time,signature:tx.signature,amount:change.amount,classification:tx.classification,confidence:tx.classification==="DEX_SWAP_DETECTED"?"PROGRAM_CONFIRMED":"INFERRED_OR_CANDIDATE"});
      }
    }
    const buyMap=new Map();
    for(const event of buyEvents){const item=buyMap.get(event.mint)||{mint:event.mint,buyEvents:0,firstBuy:event.time,lastBuy:event.time,amountReceived:0,times:[]};item.buyEvents++;item.amountReceived+=event.amount;if(event.time){item.times.push(Date.parse(event.time));if(!item.firstBuy||event.time<item.firstBuy)item.firstBuy=event.time;if(!item.lastBuy||event.time>item.lastBuy)item.lastBuy=event.time;}buyMap.set(event.mint,item);}
    const smartMoneySignals=[...buyMap.values()].map(item=>{const sorted=item.times.sort((a,b)=>a-b);let burst=false;for(let i=0;i<sorted.length;i++){let j=i+1;while(j<sorted.length&&sorted[j]-sorted[i]<=30*60*1000)j++;if(j-i>=3){burst=true;break;}}return {...item,burstWithin30m:burst};}).filter(item=>item.buyEvents>=2).sort((a,b)=>b.buyEvents-a.buyEvents).slice(0,10);
    const repeatTokens=tokenLedger.filter(t=>t.transactions>1).length;
    const activityScore=Math.min(100,successful.length*3+buys*2+sells*2+repeatTokens*5);
    const activityLabel=successful.length<5?"Zu wenig Daten":activityScore>=65?"Hohe beobachtete Aktivität":activityScore>=30?"Mittlere beobachtete Aktivität":"Geringe beobachtete Aktivität";
    const netSol=successful.reduce((sum,t)=>sum+(t.solDelta||0),0);
    const dated=successful.filter(t=>t.time).map(t=>Date.parse(t.time)).filter(Number.isFinite).sort((a,b)=>a-b);
    const topTokens=tokenLedger.slice().sort((a,b)=>b.transactions-a.transactions).slice(0,5).map(t=>({mint:t.mint,transactions:t.transactions,received:t.received,sent:t.sent,netAmount:t.netAmount,share:transactions.length?t.transactions/transactions.length:0}));
    const buySellTotal=buys+sells;
    const profile={firstObserved:dated.length?new Date(dated[0]).toISOString():null,lastObserved:dated.length?new Date(dated[dated.length-1]).toISOString():null,activeDays:new Set(dated.map(t=>new Date(t).toISOString().slice(0,10))).size,buySellRatio:buySellTotal?buys/buySellTotal:null,buySellBasis:"Swap-Seite aus Token-Zu-/Abgängen; DEX_SWAP_DETECTED und SWAP_CANDIDATE werden berücksichtigt",topTokens,topTokenShare:topTokens.length?topTokens[0].share:0,repeatTokenCount:repeatTokens,knownDexShare:successful.length?successful.filter(t=>t.classification==="DEX_SWAP_DETECTED").length/successful.length:0};
    rpcProvider=rpc.providerLabel();
    return Response.json({status:"PARTIAL",source:"Solana RPC mit automatischem Failover",rpcProvider,rpcBudget:rpc.budget(),address,checkedAt:new Date().toISOString(),signatureCount:(signatures||[]).length,requestedTransactions:selected.length,skippedTransactions,skipReasons,rpcErrorDetails,coverage:Math.round(transactions.length/Math.max(1,selected.length)*100),summary:{analysed:transactions.length,successful:successful.length,inferredBuys:buys,inferredSells:sells,classificationCounts,swapCandidates:successful.filter(t=>t.classification==="SWAP_CANDIDATE").length,dexSwapsDetected:successful.filter(t=>t.classification==="DEX_SWAP_DETECTED").length,distinctTokens:tokenLedger.length,netSol,repeatTokens,repeatedBuyTokens:smartMoneySignals.length,burstBuyTokens:smartMoneySignals.filter(x=>x.burstWithin30m).length},activityProfile:{score:activityScore,label:activityLabel,method:"Aktivitätsscore aus geprüften Transaktionen, vermuteten Käufen/Verkäufen und mehrfach berührten Token. Kein Gewinn-, Qualitäts- oder Smart-Money-Score."},walletProfile:profile,tokenLedger,smartMoneySignals,transactions,note:"Pro Anfrage maximal 12 der neuesten Signaturen, um Cloudflare-Subrequest-Limits zu vermeiden. skipReasons unterscheidet RPC-Fehler, nicht gefundene Transaktionen, fehlende Metadaten und fehlgeschlagene Transaktionen. Nicht auswertbare oder fehlgeschlagene Transaktionen werden gezählt und ausgelassen. BUY/SELL sind Heuristiken. Bekannte DEX-Programm-IDs plus gegenläufige Token-Salden werden als DEX_SWAP_DETECTED markiert; unbekannte Router/Programme bleiben Kandidaten. Das bestätigt die DEX-Ausführung, aber nicht automatisch den wirtschaftlichen Swap-Pfad oder Ausführungspreis. Gebühren und Rent können SOL-Bewegungen verfälschen. Kein historischer USD-Kurs, kein PnL und keine Trefferquote."},{headers:{"Cache-Control":"no-store"}});
  }catch(e){rpcProvider=rpc.providerLabel();return Response.json({status:"UNAVAILABLE",source:"Solana RPC mit automatischem Failover",rpcProvider,address,checkedAt:new Date().toISOString(),error:"RPC momentan nicht erreichbar oder rate-limited",detail:e.message,transactions:[]},{status:502});}
}
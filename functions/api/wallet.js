const RPC = "https://solana-rpc.publicnode.com";
export async function onRequestGet({ request }) {
  const url=new URL(request.url),address=(url.searchParams.get("address")||"").trim();
  if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))return Response.json({status:"UNAVAILABLE",error:"Ungültige Solana-Wallet-Adresse",transactions:[]},{status:400});
  const call=async(method,params)=>{const r=await fetch(RPC,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});if(!r.ok)throw new Error("Solana RPC HTTP "+r.status);const j=await r.json();if(j.error)throw new Error(j.error.message||"Solana RPC Fehler");return j.result;};
  try{
    const signatures=await call("getSignaturesForAddress",[address,{limit:40}]);
    const selected=(signatures||[]).slice(0,25);
    let skippedTransactions=0;
    const skipReasons={rpcError:0,transactionNotFound:0,missingMetadata:0,failedTransaction:0};
    const rpcErrorDetails={};
    const analyse=async item=>{
      try{
        const tx=await call("getTransaction",[item.signature,{encoding:"jsonParsed",maxSupportedTransactionVersion:0}]);
        if(!tx){skipReasons.transactionNotFound++;return null;}
        if(!tx.meta){skipReasons.missingMetadata++;return null;}
        if(tx.meta.err){skipReasons.failedTransaction++;return null;}
        const keys=tx.transaction?.message?.accountKeys||[],index=keys.findIndex(k=>(typeof k==="string"?k:k.pubkey)===address);
        const solDelta=index>=0?((tx.meta.postBalances?.[index]||0)-(tx.meta.preBalances?.[index]||0))/1e9:null;
        const changes=new Map();
        for(const b of tx.meta.preTokenBalances||[])if(b.owner===address)changes.set(b.mint,{mint:b.mint,amount:-Number(b.uiTokenAmount?.uiAmountString||0)});
        for(const b of tx.meta.postTokenBalances||[])if(b.owner===address){const v=changes.get(b.mint)||{mint:b.mint,amount:0};v.amount+=Number(b.uiTokenAmount?.uiAmountString||0);changes.set(b.mint,v);}
        const tokenChanges=[...changes.values()].filter(x=>Number.isFinite(x.amount)&&x.amount!==0);
        const received=tokenChanges.filter(x=>x.amount>0),sent=tokenChanges.filter(x=>x.amount<0);
        let classification="UNCLEAR",classificationBasis="Nicht eindeutig";
        if(tokenChanges.length===1&&received.length===1&&solDelta!==null&&solDelta<0){classification="BUY_INFERRED";classificationBasis="Token-Zugang + SOL-Abgang";}
        else if(tokenChanges.length===1&&sent.length===1&&solDelta!==null&&solDelta>0){classification="SELL_INFERRED";classificationBasis="Token-Abgang + SOL-Zugang";}
        else if(tokenChanges.length===2&&received.length===1&&sent.length===1){classification="SWAP_CANDIDATE";classificationBasis="Zwei gegenläufige Token-Salden; Swap-Kandidat, kein bestätigter DEX-Swap";}
        else if(tokenChanges.length>0){classification="TOKEN_MOVEMENT";classificationBasis="Token-Bewegung ohne eindeutiges SOL-Gegenstück";}
        return {signature:item.signature,time:item.blockTime?new Date(item.blockTime*1000).toISOString():null,slot:item.slot??null,solDelta,tokenChanges,classification,classificationBasis,feeSol:(tx.meta.fee||0)/1e9,success:!tx.meta.err};
      }catch(error){skipReasons.rpcError++;const message=String(error?.message||error||"Unknown RPC error").slice(0,180);rpcErrorDetails[message]=(rpcErrorDetails[message]||0)+1;return null;}
    };
    const transactions=[];
    // Fünf gleichzeitige RPC-Abfragen begrenzen Wartezeit und vermeiden einen 25er-Request-Sturm.
    for(let i=0;i<selected.length;i+=5){
      const batch=await Promise.all(selected.slice(i,i+5).map(analyse));
      for(const tx of batch){if(tx)transactions.push(tx);else skippedTransactions++;}
    }
    const successful=transactions.filter(t=>t.success),buys=successful.filter(t=>t.classification==="BUY_INFERRED").length,sells=successful.filter(t=>t.classification==="SELL_INFERRED").length;
    const ledgerMap=new Map();
    for(const tx of successful)for(const c of tx.tokenChanges){const v=ledgerMap.get(c.mint)||{mint:c.mint,netAmount:0,received:0,sent:0,transactions:0,firstSeen:tx.time,lastSeen:tx.time};v.netAmount+=c.amount;if(c.amount>0)v.received+=c.amount;else v.sent+=Math.abs(c.amount);v.transactions++;if(tx.time&&(!v.firstSeen||tx.time<v.firstSeen))v.firstSeen=tx.time;if(tx.time&&(!v.lastSeen||tx.time>v.lastSeen))v.lastSeen=tx.time;ledgerMap.set(c.mint,v);}
    const tokenLedger=[...ledgerMap.values()].sort((a,b)=>b.transactions-a.transactions);
    const repeatTokens=tokenLedger.filter(t=>t.transactions>1).length;
    const activityScore=Math.min(100,successful.length*3+buys*2+sells*2+repeatTokens*5);
    const activityLabel=successful.length<5?"Zu wenig Daten":activityScore>=65?"Hohe beobachtete Aktivität":activityScore>=30?"Mittlere beobachtete Aktivität":"Geringe beobachtete Aktivität";
    const netSol=successful.reduce((sum,t)=>sum+(t.solDelta||0),0);
    return Response.json({status:"PARTIAL",source:"Solana public RPC",address,checkedAt:new Date().toISOString(),signatureCount:(signatures||[]).length,skippedTransactions,skipReasons,rpcErrorDetails,coverage:Math.round(transactions.length/Math.max(1,Math.min(25,(signatures||[]).length))*100),summary:{analysed:transactions.length,successful:successful.length,inferredBuys:buys,inferredSells:sells,swapCandidates:successful.filter(t=>t.classification==="SWAP_CANDIDATE").length,distinctTokens:tokenLedger.length,netSol,repeatTokens},activityProfile:{score:activityScore,label:activityLabel,method:"Aktivitätsscore aus geprüften Transaktionen, vermuteten Käufen/Verkäufen und mehrfach berührten Token. Kein Gewinn-, Qualitäts- oder Smart-Money-Score."},tokenLedger,transactions,note:"Nur die letzten bis zu 25 Signaturen. skipReasons unterscheidet RPC-Fehler, nicht gefundene Transaktionen, fehlende Metadaten und fehlgeschlagene Transaktionen. Nicht auswertbare oder fehlgeschlagene Transaktionen werden gezählt und ausgelassen. BUY/SELL sind Heuristiken. Transfers können wie Token-zu-Token-Swaps aussehen; SWAP_CANDIDATE ist ausdrücklich keine bestätigte DEX-Ausführung. Gebühren und Rent können SOL-Bewegungen verfälschen. Kein historischer USD-Kurs, kein PnL und keine Trefferquote."},{headers:{"Cache-Control":"no-store"}});
  }catch(e){return Response.json({status:"UNAVAILABLE",source:"Solana public RPC",address,checkedAt:new Date().toISOString(),error:"RPC momentan nicht erreichbar oder rate-limited",detail:e.message,transactions:[]},{status:502});}
}
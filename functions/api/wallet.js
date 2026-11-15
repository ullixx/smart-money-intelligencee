const RPC = "https://api.mainnet-beta.solana.com";
export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const address = (url.searchParams.get("address") || "").trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    return Response.json({status:"UNAVAILABLE",error:"Ungültige Solana-Wallet-Adresse",transactions:[]},{status:400});
  }
  const call = async (method, params) => {
    const r = await fetch(RPC,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});
    if(!r.ok) throw new Error("Solana RPC HTTP "+r.status);
    const j=await r.json(); if(j.error) throw new Error(j.error.message||"Solana RPC Fehler"); return j.result;
  };
  try {
    const signatures = await call("getSignaturesForAddress",[address,{limit:30}]);
    const transactions = [];
    for (const item of (signatures||[]).slice(0,20)) {
      try {
        const tx = await call("getTransaction",[item.signature,{encoding:"jsonParsed",maxSupportedTransactionVersion:0}]);
        if(!tx?.meta) continue;
        const keys = tx.transaction?.message?.accountKeys || [];
        const index = keys.findIndex(k=>(typeof k==="string"?k:k.pubkey)===address);
        const solDelta = index>=0 ? ((tx.meta.postBalances?.[index]||0)-(tx.meta.preBalances?.[index]||0))/1e9 : null;
        const changes = new Map();
        for(const b of (tx.meta.preTokenBalances||[])) if(b.owner===address) changes.set(b.mint,{mint:b.mint,amount:-Number(b.uiTokenAmount?.uiAmountString||0)});
        for(const b of (tx.meta.postTokenBalances||[])) if(b.owner===address) {
          const v=changes.get(b.mint)||{mint:b.mint,amount:0};
          v.amount+=Number(b.uiTokenAmount?.uiAmountString||0);changes.set(b.mint,v);
        }
        const tokenChanges=[...changes.values()].filter(x=>Number.isFinite(x.amount)&&x.amount!==0).map(x=>({mint:x.mint,amount:x.amount}));
        const received=tokenChanges.filter(x=>x.amount>0),sent=tokenChanges.filter(x=>x.amount<0);
        let classification="UNCLEAR",classificationBasis="Nicht eindeutig";
        if(tokenChanges.length===1 && received.length===1 && solDelta!==null && solDelta<0){classification="BUY_INFERRED";classificationBasis="Token-Zugang + SOL-Abgang";}
        else if(tokenChanges.length===1 && sent.length===1 && solDelta!==null && solDelta>0){classification="SELL_INFERRED";classificationBasis="Token-Abgang + SOL-Zugang";}
        else if(tokenChanges.length>0){classification="TOKEN_MOVEMENT";classificationBasis="Token-Bewegung ohne eindeutiges SOL-Gegenstück";}
        transactions.push({signature:item.signature,time:item.blockTime?new Date(item.blockTime*1000).toISOString():null,solDelta,tokenChanges,classification,classificationBasis,feeSol:(tx.meta.fee||0)/1e9,success:!tx.meta.err});
      } catch (_) {}
    }
    const successful=transactions.filter(t=>t.success);
    const buys=successful.filter(t=>t.classification==="BUY_INFERRED").length;
    const sells=successful.filter(t=>t.classification==="SELL_INFERRED").length;
    const mints=[...new Set(successful.flatMap(t=>t.tokenChanges.map(c=>c.mint)))];
    const netSol=successful.reduce((sum,t)=>sum+(t.solDelta||0),0);
    return Response.json({status:"PARTIAL",source:"Solana public RPC",address,checkedAt:new Date().toISOString(),signatureCount:(signatures||[]).length,summary:{analysed:transactions.length,successful:successful.length,inferredBuys:buys,inferredSells:sells,distinctTokens:mints.length,netSol},transactions,note:"BUY/SELL sind nur Heuristiken aus Token- und SOL-Veränderung. Transfers, Gebühren, Rent und Token-zu-Token-Swaps können die Einordnung verfälschen. Keine USD-Werte oder PnL-Berechnung."},{headers:{"Cache-Control":"no-store"}});
  } catch(e) {
    return Response.json({status:"UNAVAILABLE",source:"Solana public RPC",address,checkedAt:new Date().toISOString(),error:"RPC momentan nicht erreichbar oder rate-limited",detail:e.message,transactions:[]},{status:502});
  }
}
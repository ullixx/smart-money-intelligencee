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
    const j=await r.json();
    if(j.error) throw new Error(j.error.message||"Solana RPC Fehler");
    return j.result;
  };
  try {
    const signatures = await call("getSignaturesForAddress",[address,{limit:20}]);
    const transactions = [];
    for (const item of (signatures||[]).slice(0,12)) {
      try {
        const tx = await call("getTransaction",[item.signature,{encoding:"jsonParsed",maxSupportedTransactionVersion:0}]);
        if(!tx?.meta) continue;
        const keys = tx.transaction?.message?.accountKeys || [];
        const index = keys.findIndex(k=>(typeof k==="string"?k:k.pubkey)===address);
        const solDelta = index>=0 ? ((tx.meta.postBalances?.[index]||0)-(tx.meta.preBalances?.[index]||0))/1e9 : null;
        const changes = new Map();
        for(const b of (tx.meta.preTokenBalances||[])) if(b.owner===address) changes.set(b.mint,{mint:b.mint,amount:-(Number(b.uiTokenAmount?.uiAmountString||0))});
        for(const b of (tx.meta.postTokenBalances||[])) if(b.owner===address) {
          const v=changes.get(b.mint)||{mint:b.mint,amount:0};
          v.amount+=Number(b.uiTokenAmount?.uiAmountString||0);changes.set(b.mint,v);
        }
        const tokenChanges=[...changes.values()].filter(x=>x.amount!==0).map(x=>({mint:x.mint,amount:x.amount}));
        transactions.push({signature:item.signature,time:item.blockTime?new Date(item.blockTime*1000).toISOString():null,solDelta,tokenChanges,feeSol:(tx.meta.fee||0)/1e9,success:!tx.meta.err});
      } catch (_) {}
    }
    return Response.json({status:"PARTIAL",source:"Solana public RPC",address,checkedAt:new Date().toISOString(),signatureCount:(signatures||[]).length,transactions,note:"Rohdaten der letzten Transaktionen. Token-Änderungen sind keine sichere Kauf-/Verkaufsklassifizierung; USD-Werte und vollständige Swap-Erkennung fehlen."},{headers:{"Cache-Control":"no-store"}});
  } catch(e) {
    return Response.json({status:"UNAVAILABLE",source:"Solana public RPC",address,checkedAt:new Date().toISOString(),error:"RPC momentan nicht erreichbar oder rate-limited",detail:e.message,transactions:[]},{status:502});
  }
}
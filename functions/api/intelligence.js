import { createSolanaRpc } from "../lib/solana-rpc.js";
import { analyseIntelligence, discoverWalletCandidates } from "../lib/intelligence-engine.js";
import { selectPriceResolution } from "../lib/price-resolution.js";
import { valueCapitalFlow } from "../lib/capital-flow-valuation.js";
const GT="https://api.geckoterminal.com/api/v2";
const GT_HEADERS={"accept":"application/json;version=20230203"};
const validAddress=value=>/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
export async function onRequestGet({request,env}){
 const url=new URL(request.url);
 const seeds=[...new Set((url.searchParams.get("addresses")||"").split(",").map(x=>x.trim()).filter(validAddress))].slice(0,5);
 if(!seeds.length)return Response.json({status:"UNAVAILABLE",error:"Mindestens eine gültige Solana-Wallet-Adresse als addresses angeben.",wallets:[]},{status:400});
 const rpc=createSolanaRpc(env);
 try{
  const getRecent=async addresses=>{
   const lists=await Promise.all(addresses.map(address=>rpc.call("getSignaturesForAddress",[address,{limit:5}])));
   const refs=addresses.flatMap((address,i)=>(lists[i]||[]).filter(s=>!s.err).map(s=>({address,signature:s.signature,blockTime:s.blockTime||null})));
   const unique=[...new Map(refs.map(x=>[x.signature,x])).values()];
   const results=unique.length?await rpc.callBatch(unique.map(x=>({method:"getTransaction",params:[x.signature,{encoding:"jsonParsed",maxSupportedTransactionVersion:2}]}))):[];
   const byWallet=Object.fromEntries(addresses.map(a=>[a,[]]));
   const txBySignature=new Map(unique.map((ref,i)=>[ref.signature,results[i]]));
   for(const ref of refs){const tx=txBySignature.get(ref.signature);if(tx&&!tx.__rpcError){const copy={...tx,signature:ref.signature,blockTime:tx.blockTime||ref.blockTime};byWallet[ref.address].push(copy);}}
   return {byWallet,requested:unique.length};
  };
  const first=await getRecent(seeds);
  const discovered=discoverWalletCandidates(first.byWallet,seeds);
  const expandedAddresses=discovered.map(x=>x.address);
  const second=expandedAddresses.length?await getRecent(expandedAddresses):{byWallet:{},requested:0};
  const allWallets=[...seeds,...expandedAddresses];
  const transactionsByWallet={...first.byWallet,...second.byWallet};
  const analysis=analyseIntelligence({wallets:allWallets,transactionsByWallet});
  const valuedFlows=await Promise.all(analysis.capitalFlows.slice(0,5).map(async flow=>{
   try{
    const pairsResponse=await fetch("https://api.dexscreener.com/token-pairs/v1/solana/"+flow.mint);
    if(!pairsResponse.ok)throw new Error("DEX-Pool nicht abrufbar");
    const pairs=await pairsResponse.json();
    const pool=(Array.isArray(pairs)?pairs:[]).filter(p=>(p.baseToken?.address===flow.mint||p.quoteToken?.address===flow.mint)&&p.pairAddress).sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0))[0];
    if(!pool)throw new Error("Kein passender Pool gefunden");
    const resolution=selectPriceResolution(flow.eventDetails||[]);
    const interval=resolution.timeframe==="minute"?60:3600;
    const end=Math.max(...(flow.eventDetails||[]).map(e=>e.time));
    if(!Number.isFinite(end))throw new Error("Keine verwertbaren Zeitstempel");
    const before=Math.floor(end/interval)*interval+interval;
    const token=pool.baseToken?.address===flow.mint?"base":"quote";
    const url=GT+"/networks/solana/pools/"+pool.pairAddress+"/ohlcv/"+resolution.timeframe+"?aggregate="+resolution.aggregate+"&limit=1000&before_timestamp="+before+"&currency=usd&token="+token;
    const response=await fetch(url,{headers:GT_HEADERS});
    if(!response.ok)throw new Error("Historische Kerzen nicht abrufbar");
    const payload=await response.json();
    const candles=(payload?.data?.attributes?.ohlcv_list||[]).map(x=>({time:x[0],close:Number(x[4])}));
    const valuation=valueCapitalFlow(flow,candles,resolution.toleranceSeconds);
    return {...flow,...valuation,valuationNote:valuation.valuationMethod+". Der aktuell liquideste Pool muss nicht der tatsächlich genutzte historische Ausführungspool sein.",poolAddress:pool.pairAddress,poolUrl:pool.url,priceResolution:resolution.method,valuationSource:"GeckoTerminal OHLCV + DEX Screener",valuedAt:new Date().toISOString()};
   }catch(error){return {...flow,usdValue:null,usdInflow:null,usdOutflow:null,valuationStatus:"UNAVAILABLE",valuationNote:"Historische USD-Bewertung nicht verfügbar: "+error.message};}
  }));
  const remainingFlows=analysis.capitalFlows.slice(5).map(flow=>({...flow,usdValue:null,valuationStatus:"UNAVAILABLE",valuationNote:"Außerhalb des aktuellen Bewertungsbudgets (Top 5 Kapitalflüsse)."}));
  const capitalFlows=[...valuedFlows,...remainingFlows];
  const flowStatuses=capitalFlows.map(x=>x.valuationStatus);const capitalFlowStatus=flowStatuses.length&&flowStatuses.every(x=>x==="HISTORICAL")?"HISTORICAL":flowStatuses.some(x=>x==="HISTORICAL"||x==="PARTIAL")?"PARTIAL":"UNAVAILABLE";
  return Response.json({...analysis,capitalFlows,dataStatus:{...analysis.dataStatus,capitalFlows:capitalFlowStatus},walletDiscovery:discovered,seedWallets:seeds,expandedWallets:expandedAddresses,coverage:{...analysis.coverage,seedWallets:seeds.length,discoveredWallets:expandedAddresses.length,transactionsAnalysed:analysis.coverage.transactionsAnalysed,window:"Bis zu 5 jüngste Transaktionen je Seed- und Kandidaten-Wallet"},source:"Solana RPC · DEX Screener · GeckoTerminal historische Kerzen",rpcProvider:rpc.providerLabel(),rpcBudget:rpc.budget(),requestedSignatures:first.requested+second.requested},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  return Response.json({status:"UNAVAILABLE",source:"Solana RPC",rpcProvider:rpc.providerLabel(),rpcBudget:rpc.budget(),error:"C–F Analyse konnte nicht vollständig geladen werden",detail:String(error?.message||error)},{status:502,headers:{"Cache-Control":"no-store"}});
 }
}

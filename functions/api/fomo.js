const get=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error("HTTP "+r.status);return r.json();};
export async function onRequestGet(){
 const checkedAt=new Date().toISOString();
 try{
  const [profiles,boosts]=await Promise.all([get("https://api.dexscreener.com/token-profiles/latest/v1"),get("https://api.dexscreener.com/token-boosts/latest/v1")]);
  const map=new Map();
  for(const token of [...(Array.isArray(profiles)?profiles:[]),...(Array.isArray(boosts)?boosts:[])])if(token.chainId==="solana"&&token.tokenAddress)map.set(token.tokenAddress,{...(map.get(token.tokenAddress)||{}),...token});
  const addresses=[...map.keys()].slice(0,25);
  const pairs=addresses.length?await get("https://api.dexscreener.com/tokens/v1/solana/"+addresses.join(",")):[];
  if(!Array.isArray(pairs))throw new Error("DEX Screener lieferte ein ungültiges Handelspaar-Format");
  const best=new Map();
  for(const pair of pairs){
   for(const [address,side] of [[pair.baseToken?.address,"base"],[pair.quoteToken?.address,"quote"]]){
    if(!address||!addresses.includes(address))continue;
    const current=best.get(address);
    if(!current||(Number(pair.liquidity?.usd)||0)>(Number(current.pair.liquidity?.usd)||0))best.set(address,{pair,side});
   }
  }
  const tokens=addresses.map(address=>{
   const match=best.get(address);if(!match)return null;
   const pair=match.pair,isBase=match.side==="base";
   const liquidity=pair.liquidity?.usd==null?null:Number(pair.liquidity.usd);
   const volume=pair.volume?.h24==null?null:Number(pair.volume.h24);
   const rawBuys=pair.txns?.h24?.buys,rawSells=pair.txns?.h24?.sells;
   const targetBuys=isBase?rawBuys:rawSells,targetSells=isBase?rawSells:rawBuys;
   const buys=targetBuys==null?null:Number(targetBuys),sells=targetSells==null?null:Number(targetSells);
   const total=buys!==null&&sells!==null?buys+sells:null;
   const buyPressure=total>0?buys/total:null,volLiq=liquidity>0&&volume!==null?volume/liquidity:null;
   const parts={
    buyPressure:buyPressure===null?null:Math.round(Math.max(0,Math.min(1,(buyPressure-.5)/.35))*35),
    volumeLiquidity:volLiq===null?null:Math.round(Math.max(0,Math.min(1,volLiq/5))*25),
    liquidityDepth:liquidity===null?null:Math.round(Math.max(0,Math.min(1,liquidity/50000))*25),
    activity:total===null?null:Math.round(Math.max(0,Math.min(1,total/500))*15)
   };
   const available=Object.values(parts).filter(value=>value!==null&&Number.isFinite(value));
   const complete=available.length===4;
   const score=complete?available.reduce((sum,value)=>sum+value,0):null;
   return {
    address,
    name:(isBase?pair.baseToken:pair.quoteToken)?.name||null,
    symbol:(isBase?pair.baseToken:pair.quoteToken)?.symbol||null,
    url:pair.url||null,
    priceUsd:isBase&&pair.priceUsd!=null?Number(pair.priceUsd):null,
    liquidityUsd:liquidity,
    volume24h:volume,
    buys24h:buys,
    sells24h:sells,
    buyPressure,
    volumeLiquidity:volLiq,
    score,
    scoreStatus:complete?"LIVE":available.length?"PARTIAL":"UNAVAILABLE",
    scoreCoverage:{available:available.length,total:4},
    components:parts,
    pairTokenSide:match.side,
    pairCreatedAt:pair.pairCreatedAt||null
   };
  }).filter(Boolean).sort((a,b)=>(b.score??-1)-(a.score??-1));
  return Response.json({status:"PARTIAL",source:"DEX Screener",checkedAt,tokens,social:{status:"UNAVAILABLE",source:null,note:"Keine X-/Telegram-Datenquelle angebunden. Social Sentiment wird nicht geschätzt."},method:"Market-only pulse: Kaufanteil (35), Volumen/Liquidität (25), Liquiditätstiefe (25), Transaktionsaktivität (15). Ein Score wird nur bei vollständigen vier Komponenten ausgegeben; fehlende Eingaben bleiben PARTIAL/UNAVAILABLE statt als Nullwert in einen Score einzufließen.",note:"Ein hoher Marktimpuls ist kein Kaufsignal. DEX-Profile/Boosts sind keine vollständige Token-Auswahl; Metriken können kurzfristig stark schwanken. Bei Quote-Token-Paaren werden Kauf-/Verkaufszahlen umgedreht; Preis wird nicht aus dem Base-Token übernommen."},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return Response.json({status:"UNAVAILABLE",source:"DEX Screener",checkedAt,error:"FOMO Fusion Daten nicht verfügbar",detail:String(error?.message||error),tokens:[],social:{status:"UNAVAILABLE"}},{status:502});}
}

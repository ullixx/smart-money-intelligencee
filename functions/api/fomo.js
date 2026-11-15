const get=async url=>{const r=await fetch(url);if(!r.ok)throw new Error("HTTP "+r.status);return r.json();};
export async function onRequestGet(){
 const checkedAt=new Date().toISOString();
 try{
  const [profiles,boosts]=await Promise.all([get("https://api.dexscreener.com/token-profiles/latest/v1"),get("https://api.dexscreener.com/token-boosts/latest/v1")]);
  const map=new Map();
  for(const t of [...(Array.isArray(profiles)?profiles:[]),...(Array.isArray(boosts)?boosts:[])])if(t.chainId==="solana"&&t.tokenAddress)map.set(t.tokenAddress,t);
  const addresses=[...map.keys()].slice(0,25);
  const pairs=addresses.length?await get("https://api.dexscreener.com/tokens/v1/solana/"+addresses.join(",")):[];
  const best=new Map();
  for(const p of Array.isArray(pairs)?pairs:[]){const mint=p.baseToken?.address;if(mint&&(!best.has(mint)||(p.liquidity?.usd||0)>(best.get(mint).liquidity?.usd||0)))best.set(mint,p);}
  const tokens=addresses.map(address=>{
   const p=best.get(address);if(!p)return null;
   const liquidity=Number(p.liquidity?.usd)||0,volume=Number(p.volume?.h24)||0,buys=Number(p.txns?.h24?.buys)||0,sells=Number(p.txns?.h24?.sells)||0,total=buys+sells;
   const buyPressure=total?buys/total:null,volLiq=liquidity?volume/liquidity:null;
   const parts={buyPressure:buyPressure===null?null:Math.round(Math.max(0,Math.min(1,(buyPressure-.5)/.35))*35),volumeLiquidity:volLiq===null?null:Math.round(Math.max(0,Math.min(1,volLiq/5))*25),liquidityDepth:Math.round(Math.max(0,Math.min(1,liquidity/50000))*25),activity:Math.round(Math.max(0,Math.min(1,total/500))*15)};
   const available=Object.values(parts).filter(v=>v!==null),score=available.length?Math.round(available.reduce((a,b)=>a+b,0)):null;
   return {address,name:p.baseToken?.name||null,symbol:p.baseToken?.symbol||null,url:p.url||null,priceUsd:p.priceUsd||null,liquidityUsd:liquidity,volume24h:volume,buys24h:buys,sells24h:sells,buyPressure,volumeLiquidity:volLiq,score,components:parts,pairCreatedAt:p.pairCreatedAt||null};
  }).filter(Boolean).sort((a,b)=>(b.score??-1)-(a.score??-1));
  return Response.json({status:"PARTIAL",source:"DEX Screener",checkedAt,tokens,social:{status:"UNAVAILABLE",source:null,note:"Keine X-/Telegram-Datenquelle angebunden. Social Sentiment wird nicht geschätzt."},method:"Market-only pulse: Kaufanteil (35), Volumen/Liquidität (25), Liquiditätstiefe (25), Transaktionsaktivität (15). Fehlende Komponenten bleiben nicht verfügbar und werden nicht durch Social-Daten ersetzt.",note:"Ein hoher Marktimpuls ist kein Kaufsignal. DEX-Profile/Boosts sind keine vollständige Token-Auswahl; Metriken können kurzfristig stark schwanken."},{headers:{"Cache-Control":"no-store"}});
 }catch(e){return Response.json({status:"UNAVAILABLE",source:"DEX Screener",checkedAt,error:"FOMO Fusion Daten nicht verfügbar",detail:e.message,tokens:[],social:{status:"UNAVAILABLE"}},{status:502});}
}
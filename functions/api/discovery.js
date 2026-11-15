export async function onRequestGet() {
  const source = "DEX Screener";
  const now = new Date().toISOString();
  try {
    const results = await Promise.all([
      fetch("https://api.dexscreener.com/token-profiles/latest/v1"),
      fetch("https://api.dexscreener.com/token-boosts/latest/v1")
    ]);
    if (!results[0].ok || !results[1].ok) throw new Error("DEX Screener antwortet nicht");
    const lists = await Promise.all([results[0].json(), results[1].json()]);
    const map = new Map();
    for (const item of [...(Array.isArray(lists[0]) ? lists[0] : []), ...(Array.isArray(lists[1]) ? lists[1] : [])]) {
      if (item.chainId === "solana" && item.tokenAddress) map.set(item.tokenAddress, {...(map.get(item.tokenAddress)||{}),...item});
    }
    const tokens = [...map.values()].slice(0,30);
    const addresses = tokens.map(t=>t.tokenAddress);
    let pairs=[];
    if(addresses.length){const res=await fetch("https://api.dexscreener.com/tokens/v1/solana/"+addresses.join(","));if(res.ok)pairs=await res.json();}
    const best=new Map();
    for(const p of Array.isArray(pairs)?pairs:[]){const a=p.baseToken?.address;if(a&&(!best.has(a)||(p.liquidity?.usd||0)>(best.get(a).liquidity?.usd||0)))best.set(a,p);}
    return Response.json({status:"PARTIAL",source,timestamp:now,note:"Profil- und Boost-Listen sind keine vollständige Liste aller neu erstellten Token.",tokens:tokens.map(t=>{const p=best.get(t.tokenAddress);const liquidity=p?.liquidity?.usd??null;const volume=p?.volume?.h24??null;const buys=p?.txns?.h24?.buys??null;const sells=p?.txns?.h24?.sells??null;const flags=[];if(liquidity!==null&&liquidity<10000)flags.push("Niedrige Liquidität (< $10k)");if(buys!==null&&sells!==null&&buys+sells>=10&&sells>buys*1.5)flags.push("Verkaufsdruck");if(liquidity>0&&volume!==null&&volume/liquidity>5)flags.push("Sehr hoher Umsatz/Liquidität");return {address:t.tokenAddress,name:p?.baseToken?.name||null,symbol:p?.baseToken?.symbol||null,priceUsd:p?.priceUsd||null,liquidityUsd:liquidity,volume24h:volume,buys24h:buys,sells24h:sells,marketCap:p?.marketCap??p?.fdv??null,pairCreatedAt:p?.pairCreatedAt??null,flags,url:p?.url||t.url||null,hasMarketPair:!!p};})},{headers:{"Cache-Control":"public, max-age=30"}});
  } catch(e) {
    return Response.json({status:"UNAVAILABLE",source,timestamp:now,error:"Datenquelle momentan nicht erreichbar",tokens:[]},{status:502});
  }
}
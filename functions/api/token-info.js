export async function onRequestGet({request}){
 const url=new URL(request.url),mint=(url.searchParams.get("mint")||"").trim();
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint))return Response.json({status:"UNAVAILABLE",error:"Ungültige Mint-Adresse"},{status:400});
 const clean=v=>typeof v==="string"&&v.trim()?v.trim():null;
 // Pump.fun kennt neu gestartete Coins häufig bereits vor dem ersten DEX-Pair.
 try{
  const response=await fetch("https://frontend-api-v3.pump.fun/coins-v2/"+encodeURIComponent(mint),{headers:{"Accept":"application/json"},signal:AbortSignal.timeout(8000)});
  if(response.ok){
   const coin=await response.json();
   if((coin?.mint||"").toLowerCase()===mint.toLowerCase()&&(clean(coin.name)||clean(coin.symbol))){
    return Response.json({status:"LIVE",mint,name:clean(coin.name),symbol:clean(coin.symbol),source:"Pump.fun",image:clean(coin.image_uri),pairUrl:"https://pump.fun/coin/"+encodeURIComponent(mint)},{headers:{"Cache-Control":"public, max-age=300"}});
   }
  }
 }catch{}
 // Jupiter Tokens API als zweite Metadatenquelle für Solana-Mints.
 try{
  const response=await fetch("https://api.jup.ag/tokens/v2/search?query="+encodeURIComponent(mint),{headers:{"Accept":"application/json"},signal:AbortSignal.timeout(8000)});
  if(response.ok){
   const data=await response.json(),tokens=Array.isArray(data)?data:[];
   const token=tokens.find(t=>(t.id||"").toLowerCase()===mint.toLowerCase());
   if(token&&(clean(token.name)||clean(token.symbol))){
    return Response.json({status:"LIVE",mint,name:clean(token.name),symbol:clean(token.symbol),source:"Jupiter Tokens API",image:clean(token.icon),verified:token.isVerified??null,organicScore:token.organicScore??null,pairUrl:"https://pump.fun/coin/"+encodeURIComponent(mint)},{headers:{"Cache-Control":"public, max-age=300"}});
   }
  }
 }catch{}
 // Fallback for tokens traded on DEXes outside Pump.fun.
 try{
  const response=await fetch("https://api.dexscreener.com/latest/dex/tokens/"+encodeURIComponent(mint),{headers:{"Accept":"application/json"},signal:AbortSignal.timeout(8000)});
  if(response.ok){
   const data=await response.json(),pairs=Array.isArray(data.pairs)?data.pairs:[];
   const pair=pairs.find(p=>(p.baseToken?.address||"").toLowerCase()===mint.toLowerCase())||pairs.find(p=>(p.quoteToken?.address||"").toLowerCase()===mint.toLowerCase());
   const token=pair&&((pair.baseToken?.address||"").toLowerCase()===mint.toLowerCase()?pair.baseToken:pair.quoteToken);
   if(token&&(clean(token.name)||clean(token.symbol)))return Response.json({status:"LIVE",mint,name:clean(token.name),symbol:clean(token.symbol),source:"DEX Screener",pairUrl:pair.url||null},{headers:{"Cache-Control":"public, max-age=300"}});
  }
 }catch{}
 return Response.json({status:"UNAVAILABLE",mint,name:null,symbol:null,source:"Pump.fun + DEX Screener",note:"Für diese Mint-Adresse wurden keine Token-Metadaten gefunden."},{headers:{"Cache-Control":"public, max-age=60"}});
}
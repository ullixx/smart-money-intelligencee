export async function onRequestGet({request}){
 const url=new URL(request.url),mint=(url.searchParams.get("mint")||"").trim();
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint))return Response.json({status:"UNAVAILABLE",error:"Ungültige Mint-Adresse"},{status:400});
 try{
  const response=await fetch("https://api.dexscreener.com/latest/dex/tokens/"+encodeURIComponent(mint),{headers:{"Accept":"application/json"}});
  if(!response.ok)throw new Error("DEX Screener HTTP "+response.status);
  const data=await response.json(),pairs=Array.isArray(data.pairs)?data.pairs:[];
  const pair=pairs.find(p=>(p.baseToken?.address||"").toLowerCase()===mint.toLowerCase())||pairs.find(p=>(p.quoteToken?.address||"").toLowerCase()===mint.toLowerCase())||pairs[0];
  const token=pair&&((pair.baseToken?.address||"").toLowerCase()===mint.toLowerCase()?pair.baseToken:pair.quoteToken);
  if(!token)return Response.json({status:"UNAVAILABLE",mint,name:null,symbol:null,source:"DEX Screener"});
  return Response.json({status:"LIVE",mint,name:token.name||null,symbol:token.symbol||null,source:"DEX Screener",pairUrl:pair.url||null},{headers:{"Cache-Control":"public, max-age=300"}});
 }catch(error){return Response.json({status:"UNAVAILABLE",mint,name:null,symbol:null,source:"DEX Screener",error:error.message},{status:502});}
}
import { isValidSolanaAddress } from "../lib/solana-address.js";
import { isValidSolanaAddress } from "../lib/solana-address.js";
import { createSolanaRpc } from "../lib/solana-rpc.js";
const valid=isValidSolanaAddress;
export async function onRequestGet({request,env}){
 const rpc=createSolanaRpc(env);
 const address=new URL(request.url).searchParams.get("address")?.trim()||"";
 if(!valid(address))return Response.json({status:"UNAVAILABLE",error:"Ungültige Token-Mint-Adresse"},{status:400});
 try{
  const [pairsRes,mintAccount]=await Promise.all([
   fetch("https://api.dexscreener.com/token-pairs/v1/solana/"+address,{signal:AbortSignal.timeout(10000)}),
   rpc.call("getAccountInfo",[address,{encoding:"jsonParsed",commitment:"confirmed"}])
  ]);
  if(!pairsRes.ok)throw new Error("DEX Screener HTTP "+pairsRes.status);
  const pairs=await pairsRes.json(),mintInfo=mintAccount?.value?.data?.parsed?.info;
  if(!mintInfo||mintInfo.decimals===undefined)throw new Error("Keine lesbaren SPL-Mint-Daten");
  const pool=(Array.isArray(pairs)?pairs:[]).filter(p=>p.baseToken?.address===address&&p.pairAddress).sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0))[0];
  const activeProvider=rpc.providerLabel();
  if(!pool)return Response.json({status:"NO_SETUP",source:"DEX Screener + Solana RPC mit Failover",rpcProvider:activeProvider,address,checkedAt:new Date().toISOString(),decision:"NO_SETUP",reasons:["Kein passendes Handelspaar gefunden"],note:"Keine Entry-Einschätzung ohne verifizierbares Handelspaar."});
  const liquidity=Number(pool.liquidity?.usd)||0,volume=Number(pool.volume?.h24)||0,buys=Number(pool.txns?.h24?.buys)||0,sells=Number(pool.txns?.h24?.sells)||0,total=buys+sells,buyPressure=total?buys/total:null,ratio=liquidity?volume/liquidity:null;
  const reasons=[],blocks=[];
  if(liquidity<10000)blocks.push("Liquidität unter $10.000");
  if(total<20)blocks.push("Weniger als 20 Transaktionen in 24h");
  if(buyPressure===null||buyPressure<0.52)blocks.push("Kaufanteil unter 52% oder nicht verfügbar");
  if(sells>buys*1.5&&total>=20)blocks.push("Deutlicher Verkaufsüberhang");
  if(mintInfo.freezeAuthority)blocks.push("Freeze Authority weiterhin aktiv");
  if(mintInfo.mintAuthority)reasons.push("Mint Authority aktiv: zusätzliche Token-Ausgabe möglich");
  if(ratio!==null&&ratio>10)reasons.push("Extrem hohes Volumen im Verhältnis zur Liquidität");
  if(liquidity>=10000)reasons.push("Liquiditätsschwelle erreicht");
  if(total>=20)reasons.push("Mindestaktivität erreicht");
  if(buyPressure!==null&&buyPressure>=0.52)reasons.push("Kaufanteil mindestens 52%");
  const decision=blocks.length?"NO_SETUP":reasons.some(x=>x.includes("Authority aktiv")||x.includes("Extrem hohes"))?"WATCH_ONLY":"WATCH";
  const score=Math.max(0,Math.min(100,Math.round((buyPressure??0)*35+Math.min(1,liquidity/50000)*30+Math.min(1,total/300)*20+Math.min(1,(ratio??0)/5)*15)));
  return Response.json({status:"PARTIAL",source:"DEX Screener + Solana RPC mit Failover",rpcProvider:activeProvider,address,checkedAt:new Date().toISOString(),decision,score,market:{liquidityUsd:liquidity,volume24h:volume,buys24h:buys,sells24h:sells,buyPressure,volumeLiquidity:ratio},security:{mintAuthorityActive:!!mintInfo.mintAuthority,freezeAuthorityActive:!!mintInfo.freezeAuthority},blocks,reasons,method:"Rule-based watchlist gate, not a trade signal. Liquidity >= $10k, >=20 transactions/24h, buy share >=52%, no >1.5x sell imbalance and no active freeze authority. Score is a market-condition score only.",note:"WATCH bedeutet nur weiter beobachten. WATCH_ONLY weist auf zusätzliche Risiken hin. Kein Kauf-/Verkaufssignal; keine Berücksichtigung von Slippage, MEV, Steuern, Wallet-Historie oder vollständiger Holder-Verteilung."},{headers:{"Cache-Control":"no-store"}});
 }catch(e){return Response.json({status:"UNAVAILABLE",source:"DEX Screener + Solana RPC mit Failover",rpcProvider:rpc.providerLabel(),address,error:"Entry-Prüfung nicht verfügbar",detail:e.message},{status:502,headers:{"Cache-Control":"no-store"}});}
}
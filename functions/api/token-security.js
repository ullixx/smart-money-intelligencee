import { createSolanaRpc } from "../lib/solana-rpc.js";
export async function onRequestGet({request,env}){
 const rpc=createSolanaRpc(env);
 const address=new URL(request.url).searchParams.get("address")?.trim()||"";
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))return Response.json({status:"UNAVAILABLE",error:"Ungültige Token-Mint-Adresse"},{status:400});
 try{
  const [account,supply,largest,pairsResponse]=await Promise.all([
   rpc.call("getAccountInfo",[address,{encoding:"jsonParsed",commitment:"confirmed"}]),
   rpc.call("getTokenSupply",[address,{commitment:"confirmed"}]),
   rpc.call("getTokenLargestAccounts",[address,{commitment:"confirmed"}]),
   fetch("https://api.dexscreener.com/token-pairs/v1/solana/"+address).then(async r=>r.ok?await r.json():null).catch(()=>null)
  ]);
  const info=account?.value?.data?.parsed?.info,supplyData=supply,largestData=largest;
  if(!info||info.decimals===undefined)throw new Error("Adresse ist kein unterstützter SPL-Token-Mint oder Mint-Daten fehlen");
  const total=Number(supplyData?.value?.uiAmountString||0);
  const holders=(largestData?.value||[]).map(x=>({tokenAccount:x.address,amount:Number(x.uiAmountString||0),share:total>0?Number(x.uiAmountString||0)/total:null}));
  const accountDetails=holders.length?await rpc.call("getMultipleAccounts",[holders.map(x=>x.tokenAccount),{encoding:"jsonParsed",commitment:"confirmed"}]):{value:[]};
  const ownerBalances=new Map();
  holders.forEach((holder,index)=>{
   const parsedOwner=accountDetails?.value?.[index]?.data?.parsed?.info?.owner;
   holder.owner=parsedOwner||null;
   if(parsedOwner)ownerBalances.set(parsedOwner,(ownerBalances.get(parsedOwner)||0)+holder.amount);
  });
  const largestOwners=[...ownerBalances.entries()].map(([owner,amount])=>({owner,amount,share:total>0?amount/total:null})).sort((a,b)=>b.amount-a.amount);
  const top10=holders.slice(0,10).reduce((sum,x)=>sum+x.amount,0),top10Owners=largestOwners.slice(0,10).reduce((sum,x)=>sum+x.amount,0);
  const top20OwnerShare=total>0?largestOwners.slice(0,20).reduce((sum,x)=>sum+x.amount,0)/total:null;
  const riskFlags=[];if(info.mintAuthority)riskFlags.push("MINT_AUTHORITY_ACTIVE");if(info.freezeAuthority)riskFlags.push("FREEZE_AUTHORITY_ACTIVE");if(total>0&&top10Owners/total>0.5)riskFlags.push("TOP10_OBSERVED_OWNERS_OVER_50_PERCENT");else if(top20OwnerShare!==null&&top20OwnerShare>0.7)riskFlags.push("TOP20_OBSERVED_OWNERS_OVER_70_PERCENT");
  const pairs=Array.isArray(pairsResponse)?pairsResponse:[];
  const pool=pairs.filter(p=>p?.chainId==="solana"&&(p.baseToken?.address===address||p.quoteToken?.address===address)).sort((a,b)=>(Number(b.liquidity?.usd)||0)-(Number(a.liquidity?.usd)||0))[0]||null;
  const poolLiquidityUsd=pool&&Number.isFinite(Number(pool.liquidity?.usd))?Number(pool.liquidity.usd):null;
  const poolFdvUsd=pool&&Number.isFinite(Number(pool.fdv))?Number(pool.fdv):null;
  const volume24hUsd=pool&&Number.isFinite(Number(pool.volume?.h24))?Number(pool.volume.h24):null;
  const liquidityToFdvRatio=poolLiquidityUsd!==null&&poolFdvUsd>0?poolLiquidityUsd/poolFdvUsd:null;
  const volumeToLiquidity24h=poolLiquidityUsd>0&&volume24hUsd!==null?volume24hUsd/poolLiquidityUsd:null;
  const liquidityFlags=[];if(poolLiquidityUsd!==null&&poolLiquidityUsd<10000)liquidityFlags.push("LOW_POOL_LIQUIDITY_UNDER_10K_USD");else if(poolLiquidityUsd!==null&&poolLiquidityUsd<25000)liquidityFlags.push("LIMITED_POOL_LIQUIDITY_UNDER_25K_USD");if(liquidityToFdvRatio!==null&&liquidityToFdvRatio<0.02)liquidityFlags.push("LOW_LIQUIDITY_TO_FDV_UNDER_2_PERCENT");if(volumeToLiquidity24h!==null&&volumeToLiquidity24h>10)liquidityFlags.push("HIGH_24H_VOLUME_TO_LIQUIDITY_RATIO");
  return Response.json({status:"PARTIAL",source:"Solana RPC mit automatischem Failover",rpcProvider:rpc.providerLabel(),address,checkedAt:new Date().toISOString(),mintAuthorityActive:!!info.mintAuthority,freezeAuthorityActive:!!info.freezeAuthority,mintAuthority:info.mintAuthority||null,freezeAuthority:info.freezeAuthority||null,decimals:info.decimals??null,supply:total,largestTokenAccounts:holders,top10TokenAccountShare:total>0?top10/total:null,largestOwners,top10OwnerShare:total>0?top10Owners/total:null,top20ObservedOwnerShare:top20OwnerShare,riskAssessment:{status:"PARTIAL",flags:riskFlags,level:riskFlags.length>=2?"ELEVATED":riskFlags.length===1?"WATCH":"NO_SIGNAL",basis:"Mint-Authority, Freeze-Authority und Eigentümer der 20 größten Token-Accounts; keine vollständige Holder-Kontrollanalyse."},liquidityRisk:{status:pool?"PARTIAL":"UNAVAILABLE",source:pool?"DexScreener größter gefundener Solana-Pool":"DexScreener-Pooldaten nicht verfügbar",poolAddress:pool?.pairAddress||null,poolUrl:pool?.url||null,dexId:pool?.dexId||null,liquidityUsd:poolLiquidityUsd,fdvUsd:poolFdvUsd,marketCapUsd:pool&&Number.isFinite(Number(pool.marketCap))?Number(pool.marketCap):null,volume24hUsd,liquidityToFdvRatio,volumeToLiquidity24h,flags:liquidityFlags,level:liquidityFlags.some(x=>x.includes("UNDER_10K"))?"ELEVATED":liquidityFlags.length?"WATCH":pool?"NO_SIGNAL":"UNAVAILABLE",note:"Nur der größte aktuell gefundene Pool. Keine LP-Token-Sperrprüfung, keine vollständige Liquiditäts-Historie und keine Garantie, dass die gesamte Liquidität tatsächlich abziehbar ist."},note:"Owner-Konzentration wird aus den Eigentümerfeldern der 20 größten Token-Accounts gruppiert. Das ist keine vollständige Holder-Liste: kleinere Accounts fehlen; Pools, Börsen und Verwahrstellen können enthalten sein. Kein vollständiger Rug-Pull- oder Audit-Check."},{headers:{"Cache-Control":"no-store"}});
 }catch(e){return Response.json({status:"UNAVAILABLE",source:"Solana RPC mit automatischem Failover",rpcProvider:rpc.providerLabel(),error:"Token-Sicherheitsdaten nicht verfügbar",detail:e.message},{status:502,headers:{"Cache-Control":"no-store"}});}
}
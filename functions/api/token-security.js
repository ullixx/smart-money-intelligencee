import { createSolanaRpc } from "../lib/solana-rpc.js";
import { assessPoolLiquidityRisk } from "../lib/liquidity-risk.js";
import { decodeRaydiumV4LpMint } from "../lib/raydium-lp.js";
import { assessPoolAgeRisk } from "../lib/pool-age-risk.js";
import { decodeLockProgramAccount, RAYDIUM_LOCK_PROGRAM, RAYDIUM_CPMM_PROGRAM, RAYDIUM_CLMM_PROGRAM, CP_DISCRIMINATOR, CLMM_DISCRIMINATOR, encodeBase58 } from "../lib/raydium-lock.js";
export async function onRequestGet({request,env}){
 const rpc=createSolanaRpc(env);
 const address=new URL(request.url).searchParams.get("address")?.trim()||"";
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))return Response.json({status:"UNAVAILABLE",error:"Ungültige Token-Mint-Adresse"},{status:400});
 try{
  const [account,supply,largest,pairsResponse]=await Promise.all([
   rpc.call("getAccountInfo",[address,{encoding:"jsonParsed",commitment:"confirmed"}]),
   rpc.call("getTokenSupply",[address,{commitment:"confirmed"}]),
   rpc.call("getTokenLargestAccounts",[address,{commitment:"confirmed"}]),
   fetch("https://api.dexscreener.com/token-pairs/v1/solana/"+address,{signal:AbortSignal.timeout(10000)}).then(async r=>r.ok?await r.json():null).catch(()=>null)
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
  let lpControl={status:"UNAVAILABLE",reason:"LP-Mint kann für diesen Pool-Typ noch nicht sicher aus dem Pool-State dekodiert werden.",lockVerification:"UNAVAILABLE"};
  if(pool?.pairAddress){
   try{
    const poolAccount=await rpc.call("getAccountInfo",[pool.pairAddress,{encoding:"base64",commitment:"confirmed"}]);
    const encoded=poolAccount?.value?.data?.[0];
    const poolProgram=poolAccount?.value?.owner;
    if(poolProgram===RAYDIUM_CPMM_PROGRAM||poolProgram===RAYDIUM_CLMM_PROGRAM){
     const poolType=poolProgram===RAYDIUM_CPMM_PROGRAM?"CPMM":"CLMM";
     const discriminator=poolType==="CPMM"?CP_DISCRIMINATOR:CLMM_DISCRIMINATOR;
     const poolOffset=poolType==="CPMM"?64:41;
     const lockAccounts=await rpc.call("getProgramAccounts",[RAYDIUM_LOCK_PROGRAM,{encoding:"base64",commitment:"confirmed",filters:[{memcmp:{offset:0,bytes:encodeBase58(discriminator)}},{memcmp:{offset:poolOffset,bytes:pool.pairAddress}}]}]);
     const verifiedLocks=(lockAccounts||[]).map(item=>{
      const raw=item.account?.data?.[0];
      if(typeof raw!=="string")return null;
      const binary=atob(raw),bytes=Uint8Array.from(binary,ch=>ch.charCodeAt(0));
      const decoded=decodeLockProgramAccount({programOwner:item.account?.owner,data:bytes,poolId:pool.pairAddress,poolType});
      return decoded.status==="VERIFIED_LOCK_STATE"?{account:item.pubkey,...decoded}:null;
     }).filter(Boolean);
     if(poolType==="CPMM"&&verifiedLocks.length){
      const lpMints=[...new Set(verifiedLocks.map(lock=>lock.lockedLpMint).filter(Boolean))];
      const supplies=await Promise.all(lpMints.map(mint=>rpc.call("getTokenSupply",[mint,{commitment:"confirmed"}]).catch(()=>null)));
      const supplyByMint=new Map(lpMints.map((mint,index)=>[mint,supplies[index]?.value?.amount||null]));
      for(const lock of verifiedLocks){
       const rawSupply=supplyByMint.get(lock.lockedLpMint);
       lock.lockedLpSupplyRaw=rawSupply;
       lock.lockedLpShareOfSupply=rawSupply&&BigInt(rawSupply)>0n?Number(BigInt(lock.lockedLpAmountRaw)*1000000n/BigInt(rawSupply))/10000:null;
       lock.lockedLpShareStatus=lock.lockedLpShareOfSupply===null?"UNAVAILABLE":"ESTIMATED_FROM_ON_CHAIN_RAW_SUPPLY";
      }
     }
     lpControl={status:"PARTIAL",poolProgram,lockProgram:RAYDIUM_LOCK_PROGRAM,poolType,verifiedLocks,verifiedLockCount:verifiedLocks.length,lockVerification:verifiedLocks.length?"VERIFIED_LOCKS_FOUND":"NO_LOCK_ACCOUNT_FOUND",lockModel:"BURN_AND_EARN_PERMANENT_LOCK",unlockAt:null,reason:"Raydium-Lock-Program-Accounts wurden anhand des Programms, des Account-Discriminators und der Pool-Adresse geprüft. CPMM-LP-Anteile werden aus gesperrter Rohmenge und On-Chain-LP-Supply berechnet; CLMM-Positionen sind NFTs und nicht direkt als LP-Supply-Prozent vergleichbar. Burn & Earn ist permanent; ein Unlock-Zeitpunkt wird nicht behauptet.",checkedAt:new Date().toISOString()};
    }else if(typeof encoded==="string"){
     const binary=atob(encoded),bytes=Uint8Array.from(binary,ch=>ch.charCodeAt(0));
     const decoded=decodeRaydiumV4LpMint({programOwner:poolProgram,data:bytes});
     if(decoded.status==="DECODED"){
      const [lpSupply,lpLargest]=await Promise.all([
       rpc.call("getTokenSupply",[decoded.lpMint,{commitment:"confirmed"}]),
       rpc.call("getTokenLargestAccounts",[decoded.lpMint,{commitment:"confirmed"}])
      ]);
      const lpTotal=Number(lpSupply?.value?.uiAmountString||0);
      const lpAccounts=(lpLargest?.value||[]).slice(0,10);
      const lpDetails=lpAccounts.length?await rpc.call("getMultipleAccounts",[lpAccounts.map(x=>x.address),{encoding:"jsonParsed",commitment:"confirmed"}]):{value:[]};
      const authorities=lpAccounts.map((item,index)=>({tokenAccount:item.address,amount:Number(item.uiAmountString||0),share:lpTotal>0?Number(item.uiAmountString||0)/lpTotal:null,authority:lpDetails?.value?.[index]?.data?.parsed?.info?.owner||null}));
      const authorityAddresses=[...new Set(authorities.map(x=>x.authority).filter(Boolean))];
      const authorityDetails=authorityAddresses.length?await rpc.call("getMultipleAccounts",[authorityAddresses,{encoding:"base64",commitment:"confirmed"}]):{value:[]};
      const authorityPrograms=new Map(authorityAddresses.map((key,index)=>[key,authorityDetails?.value?.[index]?.owner||null]));
      for(const item of authorities)item.authorityAccountOwnerProgram=item.authority?authorityPrograms.get(item.authority)||null:null;
      const top10Share=authorities.reduce((sum,item)=>sum+(item.share||0),0);
      lpControl={status:"PARTIAL",poolProgram:poolAccount.value.owner,lpMint:decoded.lpMint,layout:decoded.layout,lpSupply:lpTotal,topLpTokenAccounts:authorities,top10LpTokenAccountShare:lpTotal>0?top10Share:null,lockVerification:"UNAVAILABLE",reason:"LP-Token-Mint und größte LP-Token-Accounts on-chain gelesen. Ein Holder kann ein Locker, ein Pool-Vault oder eine normale Wallet sein; ohne validierte Locker-Program- und Vesting-Daten wird keine Sperre behauptet.",checkedAt:new Date().toISOString()};
     }else{
      lpControl={status:decoded.status,reason:decoded.reason,lockVerification:"UNAVAILABLE",poolProgram:poolAccount?.value?.owner||null};
     }
    }else{
     lpControl={status:"UNAVAILABLE",reason:"Pool-Account oder binäre Account-Daten nicht verfügbar.",lockVerification:"UNAVAILABLE"};
    }
   }catch(error){
    lpControl={status:"UNAVAILABLE",reason:"LP-Token-Daten konnten nicht sicher gelesen werden: "+error.message,lockVerification:"UNAVAILABLE"};
   }
  }
  const liquidityAssessment=assessPoolLiquidityRisk({liquidityUsd:pool?.liquidity?.usd,fdvUsd:pool?.fdv,volume24hUsd:pool?.volume?.h24});
  const poolAge=assessPoolAgeRisk({pairCreatedAt:pool?.pairCreatedAt});
  const {liquidityUsd:poolLiquidityUsd,fdvUsd:poolFdvUsd,volume24hUsd,liquidityToFdvRatio,volumeToLiquidity24h,flags:liquidityFlags}=liquidityAssessment;
  return Response.json({status:"PARTIAL",source:"Solana RPC mit automatischem Failover",rpcProvider:rpc.providerLabel(),address,checkedAt:new Date().toISOString(),mintAuthorityActive:!!info.mintAuthority,freezeAuthorityActive:!!info.freezeAuthority,mintAuthority:info.mintAuthority||null,freezeAuthority:info.freezeAuthority||null,decimals:info.decimals??null,supply:total,largestTokenAccounts:holders,top10TokenAccountShare:total>0?top10/total:null,largestOwners,top10OwnerShare:total>0?top10Owners/total:null,top20ObservedOwnerShare:top20OwnerShare,riskAssessment:{status:"PARTIAL",flags:riskFlags,level:riskFlags.length>=2?"ELEVATED":riskFlags.length===1?"WATCH":"NO_SIGNAL",basis:"Mint-Authority, Freeze-Authority und Eigentümer der 20 größten Token-Accounts; keine vollständige Holder-Kontrollanalyse."},liquidityRisk:{status:pool?liquidityAssessment.status:"UNAVAILABLE",poolAge,source:pool?"DexScreener größter gefundener Solana-Pool":"DexScreener-Pooldaten nicht verfügbar",poolAddress:pool?.pairAddress||null,poolUrl:pool?.url||null,dexId:pool?.dexId||null,liquidityUsd:poolLiquidityUsd,fdvUsd:poolFdvUsd,marketCapUsd:pool&&Number.isFinite(Number(pool.marketCap))?Number(pool.marketCap):null,volume24hUsd,liquidityToFdvRatio,volumeToLiquidity24h,flags:liquidityFlags,level:pool?liquidityAssessment.level:"UNAVAILABLE",lpControl,note:"Nur der größte aktuell gefundene Pool. Keine LP-Token-Sperrprüfung, keine vollständige Liquiditäts-Historie und keine Garantie, dass die gesamte Liquidität tatsächlich abziehbar ist."},note:"Owner-Konzentration wird aus den Eigentümerfeldern der 20 größten Token-Accounts gruppiert. Das ist keine vollständige Holder-Liste: kleinere Accounts fehlen; Pools, Börsen und Verwahrstellen können enthalten sein. Kein vollständiger Rug-Pull- oder Audit-Check."},{headers:{"Cache-Control":"no-store"}});
 }catch(e){return Response.json({status:"UNAVAILABLE",source:"Solana RPC mit automatischem Failover",rpcProvider:rpc.providerLabel(),error:"Token-Sicherheitsdaten nicht verfügbar",detail:e.message},{status:502,headers:{"Cache-Control":"no-store"}});}
}
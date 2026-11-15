const call=async(endpoints,method,params)=>{
 let last;
 for(let i=0;i<endpoints.length;i++){
  try{
   const r=await fetch(endpoints[i],{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});
   if(!r.ok)throw new Error("RPC HTTP "+r.status);
   const j=await r.json();if(j.error)throw new Error(j.error.message||"RPC-Fehler");
   return {result:j.result,provider:i};
  }catch(e){last=e;}
 }
 throw last||new Error("Kein Solana RPC-Endpunkt verfügbar");
};
export async function onRequestGet({request,env}){
 const RPCS=[...new Set([env?.SOLANA_RPC_URL,env?.SOLANA_RPC_FALLBACK_URL,"https://solana-rpc.publicnode.com"].filter(Boolean))];
 let activeProvider="Not yet selected";
 const address=new URL(request.url).searchParams.get("address")?.trim()||"";
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))return Response.json({status:"UNAVAILABLE",error:"Ungültige Token-Mint-Adresse"},{status:400});
 try{
  const [account,supply,largest]=await Promise.all([
   call(RPCS,"getAccountInfo",[address,{encoding:"jsonParsed",commitment:"confirmed"}]),
   call(RPCS,"getTokenSupply",[address,{commitment:"confirmed"}]),
   call(RPCS,"getTokenLargestAccounts",[address,{commitment:"confirmed"}])
  ]);
  const providerIndex=Math.max(account.provider,supply.provider,largest.provider);
  activeProvider=providerIndex===0?"Primary RPC":RPCS[providerIndex]===env?.SOLANA_RPC_FALLBACK_URL?"QuickNode fallback":"PublicNode fallback";
  const info=account.result?.value?.data?.parsed?.info;
  const supplyData=supply.result;
  const largestData=largest.result;
  if(!info||info.decimals===undefined)throw new Error("Adresse ist kein unterstützter SPL-Token-Mint oder Mint-Daten fehlen");
  const total=Number(supplyData?.value?.uiAmountString||0);
  const holders=(largestData?.value||[]).map(x=>({tokenAccount:x.address,amount:Number(x.uiAmountString||0),share:total>0?Number(x.uiAmountString||0)/total:null}));
  const accountDetails=holders.length?await call(RPCS,"getMultipleAccounts",[holders.map(x=>x.tokenAccount),{encoding:"jsonParsed",commitment:"confirmed"}]):{value:[]};
  const ownerBalances=new Map();
  holders.forEach((holder,index)=>{
   const parsedOwner=accountDetails?.result?.value?.[index]?.data?.parsed?.info?.owner;
   holder.owner=parsedOwner||null;
   if(parsedOwner)ownerBalances.set(parsedOwner,(ownerBalances.get(parsedOwner)||0)+holder.amount);
  });
  const largestOwners=[...ownerBalances.entries()].map(([owner,amount])=>({owner,amount,share:total>0?amount/total:null})).sort((a,b)=>b.amount-a.amount);
  const top10=holders.reduce((sum,x)=>sum+x.amount,0);
  const top10Owners=largestOwners.slice(0,10).reduce((sum,x)=>sum+x.amount,0);
  return Response.json({
   status:"PARTIAL",source:"Solana RPC mit automatischem Failover",rpcProvider:activeProvider,address,checkedAt:new Date().toISOString(),
   mintAuthorityActive:!!info.mintAuthority,freezeAuthorityActive:!!info.freezeAuthority,
   mintAuthority:info.mintAuthority||null,freezeAuthority:info.freezeAuthority||null,
   decimals:info.decimals??null,supply:total,
   largestTokenAccounts:holders,top10TokenAccountShare:total>0?top10/total:null,
   largestOwners,top10OwnerShare:total>0?top10Owners/total:null,
   note:"Owner-Konzentration wird aus den Eigentümerfeldern der 20 größten Token-Accounts gruppiert. Das ist keine vollständige Holder-Liste: kleinere Accounts fehlen; Pools, Börsen und Verwahrstellen können enthalten sein. Kein vollständiger Rug-Pull- oder Audit-Check."
  },{headers:{"Cache-Control":"no-store"}});
 }catch(e){return Response.json({status:"UNAVAILABLE",source:"Solana RPC mit automatischem Failover",rpcProvider:activeProvider,error:"Token-Sicherheitsdaten nicht verfügbar",detail:e.message},{status:502});}
}

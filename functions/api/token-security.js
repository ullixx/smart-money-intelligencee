const RPC="https://api.mainnet-beta.solana.com";
const call=async(method,params)=>{
 const r=await fetch(RPC,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});
 if(!r.ok)throw new Error("RPC HTTP "+r.status);
 const j=await r.json();if(j.error)throw new Error(j.error.message||"RPC-Fehler");return j.result;
};
export async function onRequestGet({request}){
 const address=new URL(request.url).searchParams.get("address")?.trim()||"";
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))return Response.json({status:"UNAVAILABLE",error:"Ungültige Token-Mint-Adresse"},{status:400});
 try{
  const [account,supply,largest]=await Promise.all([
   call("getAccountInfo",[address,{encoding:"jsonParsed",commitment:"confirmed"}]),
   call("getTokenSupply",[address,{commitment:"confirmed"}]),
   call("getTokenLargestAccounts",[address,{commitment:"confirmed"}])
  ]);
  const info=account?.value?.data?.parsed?.info;
  if(!info||info.tokenAmount===undefined&&info.decimals===undefined)throw new Error("Adresse ist kein unterstützter SPL-Token-Mint oder Mint-Daten fehlen");
  const total=Number(supply?.value?.uiAmountString||0);
  const holders=(largest?.value||[]).map(x=>({tokenAccount:x.address,amount:Number(x.uiAmountString||0),share:total>0?Number(x.uiAmountString||0)/total:null}));
  const top10=holders.reduce((sum,x)=>sum+x.amount,0);
  return Response.json({
   status:"PARTIAL",source:"Solana public RPC",address,checkedAt:new Date().toISOString(),
   mintAuthorityActive:!!info.mintAuthority,freezeAuthorityActive:!!info.freezeAuthority,
   mintAuthority:info.mintAuthority||null,freezeAuthority:info.freezeAuthority||null,
   decimals:info.decimals??null,supply:total,
   largestTokenAccounts:holders,top10TokenAccountShare:total>0?top10/total:null,
   note:"Authority-Status und größte Token-Accounts aus Mint-/RPC-Daten. Top-10-Anteil bezieht sich auf Token-Accounts, nicht zwingend auf verschiedene Eigentümer; Pools, Börsen und Verwahrstellen können enthalten sein. Kein vollständiger Rug-Pull- oder Audit-Check."
  },{headers:{"Cache-Control":"no-store"}});
 }catch(e){return Response.json({status:"UNAVAILABLE",error:"Token-Sicherheitsdaten nicht verfügbar",detail:e.message},{status:502});}
}

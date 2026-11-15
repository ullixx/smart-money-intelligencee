export function createSolanaRpc(env){
 const primary=env?.SOLANA_RPC_URL||"https://solana-rpc.publicnode.com";
 const fallback=env?.SOLANA_RPC_FALLBACK_URL||"https://solana-rpc.publicnode.com";
 const endpoints=[...new Set([primary,fallback,"https://solana-rpc.publicnode.com"].filter(Boolean))];
 const used=new Set(),label=endpoint=>endpoint===primary?"Primary RPC":endpoint===fallback?"Fallback RPC":"PublicNode fallback";
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const call=async(method,params)=>{
  let lastError;
  for(const endpoint of endpoints){
   for(let attempt=0;attempt<3;attempt++){
    try{
     const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:AbortSignal.timeout(10000)});
     if(response.status===429||response.status>=500){lastError=new Error("RPC vorübergehend nicht verfügbar (HTTP "+response.status+")");if(attempt<2){await sleep(250*(attempt+1));continue;}break;}
     if(!response.ok)throw new Error("RPC-Anfrage fehlgeschlagen (HTTP "+response.status+")");
     const payload=await response.json();if(payload.error)throw new Error("Solana RPC "+(payload.error.code??"Fehler")+": "+(payload.error.message||"Unbekannter RPC-Fehler"));
     used.add(label(endpoint));return payload.result;
    }catch(error){lastError=error?.name==="TimeoutError"||error?.name==="AbortError"?new Error("RPC-Zeitüberschreitung nach 10 Sekunden"):error;if(attempt<2)await sleep(250*(attempt+1));}
   }
  }
  throw lastError||new Error("Kein Solana RPC-Endpunkt verfügbar");
 };
 return {call,providerLabel:()=>used.size?[...used].join(" + "):"Not yet selected"};
}
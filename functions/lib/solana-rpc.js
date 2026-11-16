export function createSolanaRpc(env){
 const configured=[
  env?.SOLANA_RPC_URL?{url:env.SOLANA_RPC_URL,label:"Primary RPC"}:null,
  env?.SOLANA_RPC_FALLBACK_URL?{url:env.SOLANA_RPC_FALLBACK_URL,label:"Fallback RPC"}:null,
  {url:"https://solana-rpc.publicnode.com",label:"PublicNode fallback"}
 ].filter(Boolean);
 const endpoints=[...new Map(configured.map(x=>[x.url,x])).values()];
 const used=new Set();
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const call=async(method,params)=>{
  let lastError;
  for(const endpoint of endpoints){
   for(let attempt=0;attempt<3;attempt++){
    try{
     const response=await fetch(endpoint.url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:AbortSignal.timeout(10000)});
     if(response.status===429||response.status>=500){
      lastError=new Error("RPC vorübergehend nicht verfügbar (HTTP "+response.status+")");
      if(attempt<2){await sleep(250*(attempt+1));continue;}
      break;
     }
     if(!response.ok)throw new Error("RPC-Anfrage fehlgeschlagen (HTTP "+response.status+")");
     const payload=await response.json();
     if(payload.error)throw new Error("Solana RPC "+(payload.error.code??"Fehler")+": "+(payload.error.message||"Unbekannter RPC-Fehler"));
     used.add(endpoint.label);
     return payload.result;
    }catch(error){
     lastError=error?.name==="TimeoutError"||error?.name==="AbortError"?new Error("RPC-Zeitüberschreitung nach 10 Sekunden"):error;
     if(attempt<2)await sleep(250*(attempt+1));
    }
   }
  }
  throw lastError||new Error("Kein Solana RPC-Endpunkt verfügbar");
 };
 return {call,providerLabel:()=>used.size?[...used].join(" + "):"Not yet selected"};
}
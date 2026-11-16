export function createSolanaRpc(env){
 const configured=[
  env?.SOLANA_RPC_URL?{url:env.SOLANA_RPC_URL,label:"Primary RPC"}:null,
  env?.SOLANA_RPC_FALLBACK_URL?{url:env.SOLANA_RPC_FALLBACK_URL,label:"Fallback RPC"}:null,
  {url:"https://solana-rpc.publicnode.com",label:"PublicNode fallback"}
 ].filter(Boolean);
 const endpoints=[...new Map(configured.map(x=>[x.url,x])).values()];
 const used=new Set();
 const maxRequests=35;
 let requests=0;
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const retryable=(error,status)=>{
  if(status===429||status>=500)return true;
  const code=error?.code;
  if(code===-32005||code===-32603)return true;
  return error?.name==="TimeoutError"||error?.name==="AbortError"||error instanceof TypeError;
 };
 const send=async(payload)=>{
  if(requests>=maxRequests)throw new Error("RPC-Budget erreicht ("+maxRequests+" HTTP-Anfragen pro Worker-Aufruf)");
  requests++;
  const response=await fetch(payload.url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload.body),signal:AbortSignal.timeout(10000)});
  if(!response.ok){
   const error=new Error("RPC HTTP "+response.status);
   error.httpStatus=response.status;
   throw error;
  }
  return response.json();
 };
 const execute=async(body)=>{
  let lastError;
  for(const endpoint of endpoints){
   for(let attempt=0;attempt<2;attempt++){
    try{
     const payload=await send({url:endpoint.url,body});
     const entries=Array.isArray(body)?payload:(payload?[payload]:[]);
     // Batch members are independent: preserve successful results and let callBatch
     // expose an error only for the corresponding request ID.
     const rpcError=Array.isArray(body)?null:entries.find(x=>x?.error);
     if(rpcError){
      const error=new Error("Solana RPC "+(rpcError.error.code??"Fehler")+": "+(rpcError.error.message||"Unbekannter RPC-Fehler"));
      error.code=rpcError.error.code;
      if(!retryable(error))throw error;
      lastError=error;
      break;
     }
     used.add(endpoint.label);
     return payload;
    }catch(error){
     lastError=error;
     if(!retryable(error,error?.httpStatus))throw error;
     if(attempt===0)await sleep(150);
    }
   }
  }
  throw lastError||new Error("Kein Solana RPC-Endpunkt verfügbar");
 };
 const call=async(method,params)=>{
  const payload=await execute({jsonrpc:"2.0",id:1,method,params});
  if(payload?.error)throw new Error("Solana RPC "+(payload.error.code??"Fehler")+": "+(payload.error.message||"Unbekannter RPC-Fehler"));
  return payload?.result;
 };
 const callBatch=async(calls)=>{
  if(!Array.isArray(calls)||!calls.length)return [];
  const body=calls.map((item,index)=>({jsonrpc:"2.0",id:index+1,method:item.method,params:item.params||[]}));
  const payload=await execute(body);
  if(!Array.isArray(payload))throw new Error("RPC-Anbieter unterstützt keine JSON-RPC-Batch-Antwort");
  const byId=new Map(payload.map(item=>[item.id,item]));
  return body.map(item=>{
   const entry=byId.get(item.id);
   if(!entry)return {__rpcError:"RPC-Batch-Antwort unvollständig"};
   if(entry.error)return {__rpcError:"Solana RPC "+(entry.error.code??"Fehler")+": "+(entry.error.message||"Unbekannter RPC-Fehler")};
   return entry.result;
  });
 };
 return {call,callBatch,providerLabel:()=>used.size?[...used].join(" + "):"Not yet selected",budget:()=>({used:requests,max:maxRequests,remaining:maxRequests-requests})};
}

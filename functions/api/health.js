import { createSolanaRpc } from "../lib/solana-rpc.js";
export async function onRequestGet({env}){
 const timestamp=new Date().toISOString();
 const checks=await Promise.all([
  (async()=>{
   const started=Date.now();
   try{
    const response=await fetch("https://api.dexscreener.com/token-profiles/latest/v1",{headers:{"accept":"application/json"},signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error("HTTP "+response.status);
    const data=await response.json();
    if(!Array.isArray(data))throw new Error("Unerwartetes Antwortformat");
    return {name:"DEX Screener",status:"LIVE",latencyMs:Date.now()-started,detail:{records:data.length}};
   }catch(error){
    return {name:"DEX Screener",status:"UNAVAILABLE",latencyMs:Date.now()-started,error:error?.name==="TimeoutError"?"Zeitüberschreitung nach 8 Sekunden":error.message};
   }
  })(),
  (async()=>{
   const started=Date.now(),rpc=createSolanaRpc(env);
   try{
    const slot=await rpc.call("getSlot",[]);
    if(!Number.isFinite(slot))throw new Error("RPC lieferte keinen gültigen Slot");
    return {name:"Solana RPC · effektiver Failover-Pfad",status:"LIVE",latencyMs:Date.now()-started,provider:rpc.providerLabel(),detail:{slot}};
   }catch(error){
    return {name:"Solana RPC · effektiver Failover-Pfad",status:"UNAVAILABLE",latencyMs:Date.now()-started,provider:rpc.providerLabel(),error:error.message};
   }
  })()
 ]);
 const status=checks.every(x=>x.status==="LIVE")?"LIVE":"PARTIAL";
 return Response.json({status,timestamp,checks},{headers:{"Cache-Control":"no-store"}});
}
import { createSolanaRpc } from "../lib/solana-rpc.js";
import { analyseIntelligence } from "../lib/intelligence-engine.js";
const validAddress=value=>/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
export async function onRequestGet({request,env}){
 const url=new URL(request.url);
 const addresses=[...new Set((url.searchParams.get("addresses")||"").split(",").map(x=>x.trim()).filter(validAddress))].slice(0,5);
 if(!addresses.length)return Response.json({status:"UNAVAILABLE",error:"Mindestens eine gültige Solana-Wallet-Adresse als addresses angeben.",wallets:[]},{status:400});
 const rpc=createSolanaRpc(env);
 try{
  const signatureLists=await Promise.all(addresses.map(address=>rpc.call("getSignaturesForAddress",[address,{limit:5}])));
  const refs=addresses.flatMap((address,i)=>(signatureLists[i]||[]).filter(s=>!s.err).map(s=>({address,signature:s.signature,blockTime:s.blockTime||null})));
  const unique=[...new Map(refs.map(x=>[x.signature,x])).values()];
  const results=unique.length?await rpc.callBatch(unique.map(x=>({method:"getTransaction",params:[x.signature,{encoding:"jsonParsed",maxSupportedTransactionVersion:2}]}))):[];
  const byWallet=Object.fromEntries(addresses.map(a=>[a,[]]));
  unique.forEach((ref,i)=>{const tx=results[i];if(tx&&!tx.__rpcError){tx.blockTime=tx.blockTime||ref.blockTime;byWallet[ref.address].push(tx);}});
  const analysis=analyseIntelligence({wallets:addresses,transactionsByWallet:byWallet});
  return Response.json({...analysis,source:"Solana RPC · getSignaturesForAddress + getTransaction",rpcProvider:rpc.providerLabel(),rpcBudget:rpc.budget(),requestedSignatures:unique.length},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  return Response.json({status:"UNAVAILABLE",source:"Solana RPC",rpcProvider:rpc.providerLabel(),rpcBudget:rpc.budget(),error:"C–F Analyse konnte nicht vollständig geladen werden",detail:String(error?.message||error)},{status:502,headers:{"Cache-Control":"no-store"}});
 }
}

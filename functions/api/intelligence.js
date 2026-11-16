import { createSolanaRpc } from "../lib/solana-rpc.js";
import { analyseIntelligence, discoverWalletCandidates } from "../lib/intelligence-engine.js";
const validAddress=value=>/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
export async function onRequestGet({request,env}){
 const url=new URL(request.url);
 const seeds=[...new Set((url.searchParams.get("addresses")||"").split(",").map(x=>x.trim()).filter(validAddress))].slice(0,5);
 if(!seeds.length)return Response.json({status:"UNAVAILABLE",error:"Mindestens eine gültige Solana-Wallet-Adresse als addresses angeben.",wallets:[]},{status:400});
 const rpc=createSolanaRpc(env);
 try{
  const getRecent=async addresses=>{
   const lists=await Promise.all(addresses.map(address=>rpc.call("getSignaturesForAddress",[address,{limit:5}])));
   const refs=addresses.flatMap((address,i)=>(lists[i]||[]).filter(s=>!s.err).map(s=>({address,signature:s.signature,blockTime:s.blockTime||null})));
   const unique=[...new Map(refs.map(x=>[x.signature,x])).values()];
   const results=unique.length?await rpc.callBatch(unique.map(x=>({method:"getTransaction",params:[x.signature,{encoding:"jsonParsed",maxSupportedTransactionVersion:2}]}))):[];
   const byWallet=Object.fromEntries(addresses.map(a=>[a,[]]));
   unique.forEach((ref,i)=>{const tx=results[i];if(tx&&!tx.__rpcError){tx.blockTime=tx.blockTime||ref.blockTime;byWallet[ref.address].push(tx);}});
   return {byWallet,requested:unique.length};
  };
  const first=await getRecent(seeds);
  const discovered=discoverWalletCandidates(first.byWallet,seeds);
  const expandedAddresses=discovered.map(x=>x.address);
  const second=expandedAddresses.length?await getRecent(expandedAddresses):{byWallet:{},requested:0};
  const allWallets=[...seeds,...expandedAddresses];
  const transactionsByWallet={...first.byWallet,...second.byWallet};
  const analysis=analyseIntelligence({wallets:allWallets,transactionsByWallet});
  return Response.json({...analysis,walletDiscovery:discovered,seedWallets:seeds,expandedWallets:expandedAddresses,coverage:{...analysis.coverage,seedWallets:seeds.length,discoveredWallets:expandedAddresses.length,transactionsAnalysed:analysis.coverage.transactionsAnalysed,window:"Bis zu 5 jüngste Transaktionen je Seed- und Kandidaten-Wallet"},source:"Solana RPC · getSignaturesForAddress + getTransaction",rpcProvider:rpc.providerLabel(),rpcBudget:rpc.budget(),requestedSignatures:first.requested+second.requested},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  return Response.json({status:"UNAVAILABLE",source:"Solana RPC",rpcProvider:rpc.providerLabel(),rpcBudget:rpc.budget(),error:"C–F Analyse konnte nicht vollständig geladen werden",detail:String(error?.message||error)},{status:502,headers:{"Cache-Control":"no-store"}});
 }
}

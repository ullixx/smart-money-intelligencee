import { createSolanaRpc } from "../lib/solana-rpc.js";
export async function onRequestGet({request,env}){
 const rpc=createSolanaRpc(env);
 const address=new URL(request.url).searchParams.get("address")?.trim()||"";
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))return Response.json({status:"UNAVAILABLE",error:"Ungültige Token-Mint-Adresse"},{status:400});
 try{
  const [mintData,signatureData]=await Promise.all([
   rpc.call("getAccountInfo",[address,{encoding:"jsonParsed",commitment:"confirmed"}]),
   rpc.call("getSignaturesForAddress",[address,{limit:1000,commitment:"confirmed"}])
  ]);
  const parsed=mintData?.value?.data?.parsed?.info;
  if(!parsed||parsed.decimals===undefined)throw new Error("Adresse ist kein lesbarer SPL-Token-Mint");
  if(!signatureData?.length)return Response.json({status:"PARTIAL",source:"Solana RPC mit automatischem Failover",rpcProvider:rpc.providerLabel(),address,firstVisibleTransaction:null,mintAuthority:parsed.mintAuthority||null,freezeAuthority:parsed.freezeAuthority||null,note:"Für diese Mint-Adresse wurden keine Signaturen geliefert."},{headers:{"Cache-Control":"no-store"}});
  const oldest=signatureData[signatureData.length-1];
  const tx=await rpc.call("getTransaction",[oldest.signature,{encoding:"jsonParsed",commitment:"confirmed",maxSupportedTransactionVersion:2}]);
  const keys=tx?.transaction?.message?.accountKeys||[];
  const feePayer=keys.length?(typeof keys[0]==="string"?keys[0]:keys[0].pubkey):null;
  const instructions=tx?.transaction?.message?.instructions||[];
  const init=instructions.find(i=>i.parsed?.type==="initializeMint"||i.parsed?.type==="initializeMint2");
  const initInfo=init?.parsed?.info||null,complete=signatureData.length<1000;
  return Response.json({status:"PARTIAL",source:"Solana RPC mit automatischem Failover",rpcProvider:rpc.providerLabel(),address,checkedAt:new Date().toISOString(),signaturesChecked:signatureData.length,historyWindowComplete:complete,firstVisibleTransaction:{signature:oldest.signature,blockTime:tx?.blockTime??oldest.blockTime??null,slot:oldest.slot,feePayerCandidate:feePayer,initializeMintAuthority:initInfo?.mintAuthority||null,initializeFreezeAuthority:initInfo?.freezeAuthority||null,explorerUrl:"https://solscan.io/tx/"+oldest.signature},mintAuthority:parsed.mintAuthority||null,freezeAuthority:parsed.freezeAuthority||null,note:complete?"Die älteste Signatur in der aktuell gelieferten Historie wurde geprüft. Der Fee-Payer ist nur ein Kandidat für den ursprünglichen Ersteller, kein Beweis für Entwickler- oder Eigentümerkontrolle.":"Es wurden maximal 1.000 Signaturen geprüft. Die Historie kann älter sein; die erste sichtbare Transaktion ist nicht zwingend die Mint-Erstellung. Fee-Payer ist nur ein Kandidat, kein bestätigter Entwickler."},{headers:{"Cache-Control":"no-store"}});
 }catch(e){return Response.json({status:"UNAVAILABLE",source:"Solana RPC mit automatischem Failover",rpcProvider:rpc.providerLabel(),error:"Developer-Daten nicht verfügbar",detail:e.message},{status:502,headers:{"Cache-Control":"no-store"}});}
}
import { createSolanaRpc } from "../lib/solana-rpc.js";
import { isValidSolanaAddress } from "../lib/solana-address.js";
export async function onRequestGet({request,env}){
 const rpc=createSolanaRpc(env);
 const signatureRequestLimit=1000;
 const address=new URL(request.url).searchParams.get("address")?.trim()||"";
 if(!isValidSolanaAddress(address))return Response.json({status:"UNAVAILABLE",error:"Ungültige Token-Mint-Adresse"},{status:400});
 try{
  const [mintData,signatureData]=await Promise.all([
   rpc.call("getAccountInfo",[address,{encoding:"jsonParsed",commitment:"confirmed"}]),
   rpc.call("getSignaturesForAddress",[address,{limit:signatureRequestLimit,commitment:"confirmed"}])
  ]);
  const parsed=mintData?.value?.data?.parsed?.info;
  if(!parsed||parsed.decimals===undefined)throw new Error("Adresse ist kein lesbarer SPL-Token-Mint");
  if(!signatureData?.length)return Response.json({status:"PARTIAL",source:"Solana RPC mit automatischem Failover",rpcProvider:rpc.providerLabel(),address,signaturesChecked:0,historyWindowComplete:null,historyWindowStatus:"EMPTY_RPC_RESPONSE",firstVisibleTransaction:null,mintAuthority:parsed.mintAuthority||null,freezeAuthority:parsed.freezeAuthority||null,note:"Der RPC hat keine Signaturen geliefert. Das beweist nicht, dass die Mint-Historie leer oder vollständig ist."},{headers:{"Cache-Control":"no-store"}});
  const oldest=signatureData[signatureData.length-1];
  const tx=await rpc.call("getTransaction",[oldest.signature,{encoding:"jsonParsed",commitment:"confirmed",maxSupportedTransactionVersion:2}]);
  const keys=tx?.transaction?.message?.accountKeys||[];
  const feePayer=keys.length?(typeof keys[0]==="string"?keys[0]:keys[0].pubkey):null;
  const instructions=tx?.transaction?.message?.instructions||[];
  const init=instructions.find(i=>i.parsed?.type==="initializeMint"||i.parsed?.type==="initializeMint2");
  const initInfo=init?.parsed?.info||null;
  const historyWindowStatus=signatureData.length>=signatureRequestLimit?"REQUEST_LIMIT_REACHED":"RPC_RETURNED_FEWER_THAN_REQUESTED_LIMIT";
  return Response.json({status:"PARTIAL",source:"Solana RPC mit automatischem Failover",rpcProvider:rpc.providerLabel(),address,checkedAt:new Date().toISOString(),signaturesChecked:signatureData.length,signatureRequestLimit,historyWindowComplete:null,historyWindowStatus,firstVisibleTransaction:{signature:oldest.signature,blockTime:tx?.blockTime??oldest.blockTime??null,slot:oldest.slot,feePayerCandidate:feePayer,initializeMintAuthority:initInfo?.mintAuthority||null,initializeFreezeAuthority:initInfo?.freezeAuthority||null,explorerUrl:"https://solscan.io/tx/"+oldest.signature},mintAuthority:parsed.mintAuthority||null,freezeAuthority:parsed.freezeAuthority||null,note:"Die älteste Signatur innerhalb des vom RPC gelieferten Fensters wurde geprüft. Ein Ergebnis unterhalb des angefragten Limits beweist keine vollständige Historie, da RPC-Anbieter niedrigere Antwortlimits setzen können. Die erste sichtbare Transaktion ist nicht zwingend die Mint-Erstellung. Fee-Payer ist nur ein Kandidat, kein bestätigter Entwickler."},{headers:{"Cache-Control":"no-store"}});
 }catch(e){return Response.json({status:"UNAVAILABLE",source:"Solana RPC mit automatischem Failover",rpcProvider:rpc.providerLabel(),error:"Developer-Daten nicht verfügbar",detail:e.message},{status:502,headers:{"Cache-Control":"no-store"}});}
}
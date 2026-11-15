async function rpc(endpoints,method,params){let last;for(let i=0;i<endpoints.length;i++){try{const r=await fetch(endpoints[i],{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});if(!r.ok)throw new Error("Solana RPC HTTP "+r.status);const j=await r.json();if(j.error)throw new Error(j.error.message||"RPC-Fehler");return {result:j.result,provider:i};}catch(e){last=e;}}throw last||new Error("Kein Solana RPC-Endpunkt verfügbar");}
export async function onRequestGet({request,env}){
 const RPCS=[...new Set([env?.SOLANA_RPC_URL,env?.SOLANA_RPC_FALLBACK_URL,"https://solana-rpc.publicnode.com"].filter(Boolean))];let activeProvider="Not yet selected";
 const address=new URL(request.url).searchParams.get("address")?.trim()||"";
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))return Response.json({status:"UNAVAILABLE",error:"Ungültige Token-Mint-Adresse"},{status:400});
 try{
  const [mint,signatures]=await Promise.all([
   rpc(RPCS,"getAccountInfo",[address,{encoding:"jsonParsed",commitment:"confirmed"}]),
   rpc(RPCS,"getSignaturesForAddress",[address,{limit:1000,commitment:"confirmed"}])
  ]);
  activeProvider=[mint,signatures].some(x=>x.provider>0)?"Fallback RPC":"Primary RPC";const mintData=mint.result,signatureData=signatures.result;
  const parsed=mintData?.value?.data?.parsed?.info;
  if(!parsed||parsed.decimals===undefined)throw new Error("Adresse ist kein lesbarer SPL-Token-Mint");
  if(!signatureData?.length)return Response.json({status:"PARTIAL",source:"Solana RPC mit automatischem Failover",rpcProvider:activeProvider,address,firstVisibleTransaction:null,mintAuthority:parsed.mintAuthority||null,freezeAuthority:parsed.freezeAuthority||null,note:"Für diese Mint-Adresse wurden keine Signaturen geliefert."});
  const oldest=signatureData[signatureData.length-1];
  const tq=await rpc(RPCS,"getTransaction",[oldest.signature,{encoding:"jsonParsed",commitment:"confirmed",maxSupportedTransactionVersion:0}]);const tx=tq.result;if(tq.provider>0)activeProvider="Fallback RPC";
  const keys=tx?.transaction?.message?.accountKeys||[];
  const feePayer=keys.length?(typeof keys[0]==="string"?keys[0]:keys[0].pubkey):null;
  const instructions=tx?.transaction?.message?.instructions||[];
  const init=instructions.find(i=>i.parsed?.type==="initializeMint"||i.parsed?.type==="initializeMint2");
  const initInfo=init?.parsed?.info||null;
  const complete=signatureData.length<1000;
  return Response.json({
   status:complete&&tx?"PARTIAL":"PARTIAL",source:"Solana RPC mit automatischem Failover",rpcProvider:activeProvider,address,checkedAt:new Date().toISOString(),
   signaturesChecked:signatureData.length,historyWindowComplete:complete,
   firstVisibleTransaction:{signature:oldest.signature,blockTime:tx?.blockTime??oldest.blockTime??null,slot:oldest.slot,feePayerCandidate:feePayer,initializeMintAuthority:initInfo?.mintAuthority||null,initializeFreezeAuthority:initInfo?.freezeAuthority||null,explorerUrl:"https://solscan.io/tx/"+oldest.signature},
   mintAuthority:parsed.mintAuthority||null,freezeAuthority:parsed.freezeAuthority||null,
   note:complete?"Die älteste Signatur in der aktuell gelieferten Historie wurde geprüft. Der Fee-Payer ist nur ein Kandidat für den ursprünglichen Ersteller, kein Beweis für Entwickler- oder Eigentümerkontrolle.":"Es wurden maximal 1.000 Signaturen geprüft. Die Historie kann älter sein; die erste sichtbare Transaktion ist nicht zwingend die Mint-Erstellung. Fee-Payer ist nur ein Kandidat, kein bestätigter Entwickler."
  },{headers:{"Cache-Control":"no-store"}});
 }catch(e){return Response.json({status:"UNAVAILABLE",source:"Solana RPC mit automatischem Failover",rpcProvider:activeProvider,error:"Developer-Daten nicht verfügbar",detail:e.message},{status:502});}
}
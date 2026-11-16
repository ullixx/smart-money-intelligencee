import { decodeSwapEvidence } from "../lib/swap-decoder.js";
import { isValidSolanaAddress } from "../lib/solana-address.js";
import { createSolanaRpc } from "../lib/solana-rpc.js";
export async function onRequestGet({request,env}) {
 const rpc=createSolanaRpc(env);let activeProvider="Not yet selected";
 const u=new URL(request.url),wallets=[...new Set((u.searchParams.get("wallets")||"").split(",").map(x=>x.trim()).filter(Boolean))].slice(0,5);
 if(wallets.length<2||wallets.some(a=>!isValidSolanaAddress(a)))return Response.json({status:"UNAVAILABLE",error:"Mindestens zwei gültige Solana-Wallet-Adressen erforderlich.",clusters:[]},{status:400});
 try{
  const events=[],funding=[],walletStats={},refs=[];let transactionsRequested=0,transactionsAnalysed=0,skippedTransactions=0;
  // Signaturen je Wallet holen, Transaktionen anschließend gemeinsam abrufen.
  for(const wallet of wallets){
   const sigs=await rpc.call("getSignaturesForAddress",[wallet,{limit:10}]);
   const selected=(sigs||[]).slice(0,8);
   walletStats[wallet]={requested:selected.length,analysed:0};
   for(const sig of selected)refs.push({wallet,signature:sig.signature,blockTime:sig.blockTime});
  }
  transactionsRequested=refs.length;
  let txResults=[];
  if(refs.length){
   try{
    txResults=await rpc.callBatch(refs.map(ref=>({method:"getTransaction",params:[ref.signature,{encoding:"jsonParsed",maxSupportedTransactionVersion:2}]})));
   }catch(_){
    txResults=refs.map(()=>({__rpcError:"RPC-Batch-Abfrage fehlgeschlagen"}));
   }
  }
  for(let index=0;index<refs.length;index++){
   const ref=refs[index],wallet=ref.wallet;
   try{
    const tx=txResults[index];
    if(tx?.__rpcError)throw new Error(tx.__rpcError);
    if(!tx?.meta||tx.meta.err||!ref.blockTime){skippedTransactions++;continue;}
    transactionsAnalysed++;walletStats[wallet].analysed++;
    const keys=tx.transaction?.message?.accountKeys||[],loaded=[...(tx.meta.loadedAddresses?.writable||[]),...(tx.meta.loadedAddresses?.readonly||[])],allKeys=[...keys,...loaded];
    const keyString=k=>typeof k==="string"?k:k?.pubkey;
    const walletIndex=allKeys.findIndex(k=>keyString(k)===wallet);
    const solDelta=walletIndex>=0?((tx.meta.postBalances?.[walletIndex]||0)-(tx.meta.preBalances?.[walletIndex]||0))/1e9:null;
    const deltas=new Map();
    for(const b of tx.meta.preTokenBalances||[])if(b.owner===wallet)deltas.set(b.mint,{mint:b.mint,delta:-Number(b.uiTokenAmount?.uiAmountString||0)});
    for(const b of tx.meta.postTokenBalances||[])if(b.owner===wallet){const v=deltas.get(b.mint)||{mint:b.mint,delta:0};v.delta+=Number(b.uiTokenAmount?.uiAmountString||0);deltas.set(b.mint,v);}
    const tokenChanges=[...deltas.values()].filter(v=>Number.isFinite(v.delta)&&v.delta!==0).map(v=>({mint:v.mint,amount:v.delta}));
    const evidence=decodeSwapEvidence(tx,{wallet,solDelta,tokenChanges});
    const incomingMints=new Set((evidence.walletTokenLegs||[]).filter(v=>v.side==="IN"&&v.mint).map(v=>v.mint));
    const positive=tokenChanges.filter(v=>v.amount>0&&incomingMints.has(v.mint));
    const confirmedBuy=evidence.classification==="DEX_SWAP_EVIDENCE"&&["SOL_TO_TOKEN","TOKEN_TO_TOKEN"].includes(evidence.direction);
    for(const v of positive)events.push({wallet,mint:v.mint,time:ref.blockTime,signature:ref.signature,amount:v.amount,solDelta,kind:confirmedBuy?"BUY_CANDIDATE":"TOKEN_RECEIPT",classification:evidence.classification,dexPrograms:evidence.dexPrograms});
    const instructions=[...(tx.transaction?.message?.instructions||[]),...(tx.meta.innerInstructions||[]).flatMap(x=>x.instructions||[])];
    for(const ix of instructions){const parsed=ix.parsed,info=parsed?.info;if(ix.program==="system"&&parsed?.type==="transfer"&&info?.destination===wallet&&info?.source&&info.source!==wallet){funding.push({wallet,funder:info.source,time:ref.blockTime,lamports:Number(info.lamports)||0,signature:ref.signature});}}
   }catch(_){skippedTransactions++;}
  }
  const byMint=new Map();for(const e of events){if(!byMint.has(e.mint))byMint.set(e.mint,[]);byMint.get(e.mint).push(e);}
  const clusters=[];
  for(const [mint,ev] of byMint){ev.sort((a,b)=>a.time-b.time);for(const e of ev){const group=ev.filter(x=>Math.abs(x.time-e.time)<=1800),unique=[...new Set(group.map(x=>x.wallet))];if(unique.length<2)continue;const first=Math.min(...group.map(x=>x.time)),last=Math.max(...group.map(x=>x.time));if(clusters.some(c=>c.mint===mint&&c.wallets.some(w=>unique.includes(w))&&Math.abs(Date.parse(c.firstSeen)/1000-first)<=1800))continue;clusters.push({mint,walletCount:unique.length,wallets:unique,firstSeen:new Date(first*1000).toISOString(),windowMinutes:Math.round((last-first)/60),events:group.length,buyCandidateCount:group.filter(x=>x.kind==="BUY_CANDIDATE").length,signatures:[...new Set(group.map(x=>x.signature))].slice(0,5)});}}
  clusters.sort((a,b)=>b.walletCount-a.walletCount||b.buyCandidateCount-a.buyCandidateCount||b.events-a.events);
  const sharedTokens=[...byMint.entries()].map(([mint,ev])=>({mint,walletCount:new Set(ev.map(x=>x.wallet)).size,wallets:[...new Set(ev.map(x=>x.wallet))],buyCandidates:ev.filter(x=>x.kind==="BUY_CANDIDATE").length})).filter(x=>x.walletCount>=2).sort((a,b)=>b.walletCount-a.walletCount);
  const funderMap=new Map();for(const f of funding){if(!funderMap.has(f.funder))funderMap.set(f.funder,[]);funderMap.get(f.funder).push(f);}
  const sharedFunders=[...funderMap.entries()].map(([funder,items])=>({funder,walletCount:new Set(items.map(x=>x.wallet)).size,wallets:[...new Set(items.map(x=>x.wallet))],transfers:items.length,totalSol:items.reduce((n,x)=>n+x.lamports/1e9,0),firstSeen:new Date(Math.min(...items.map(x=>x.time))*1000).toISOString(),lastSeen:new Date(Math.max(...items.map(x=>x.time))*1000).toISOString()})).filter(x=>x.walletCount>=2).sort((a,b)=>b.walletCount-a.walletCount||b.transfers-a.transfers);
  const relationships=[];
  for(const c of clusters){const funder=sharedFunders.find(f=>c.wallets.every(w=>f.wallets.includes(w)));const score=35+(funder?45:0)+(c.buyCandidateCount>=2?20:0);relationships.push({...c,evidenceScore:Math.min(100,score),evidenceLevel:funder?"MULTIPLE_SIGNALS":"TIME_OVERLAP_ONLY",sharedFunder:funder?.funder||null,interpretation:funder?"Gemeinsamer Funding-Absender plus zeitliche Token-Überschneidung":"Zeitliche Token-Überschneidung ohne gemeinsamen Funding-Nachweis"});}
  activeProvider=rpc.providerLabel();
  return Response.json({status:"PARTIAL",source:"Solana RPC mit automatischem Failover",rpcProvider:activeProvider,rpcBudget:rpc.budget(),checkedAt:new Date().toISOString(),walletsChecked:wallets.length,walletStats,transactionsRequested,transactionsAnalysed,skippedTransactions,coverage:Math.round(transactionsAnalysed/Math.max(1,transactionsRequested)*100),positiveTokenMovements:events.length,buyCandidates:events.filter(x=>x.kind==="BUY_CANDIDATE").length,clusters:relationships,sharedTokens,sharedFunders,note:"Untersucht werden maximal 8 aktuelle Transaktionen je Wallet. Signaturen werden je Wallet geladen; alle Transaktionen werden in einer JSON-RPC-Batch-Abfrage verarbeitet. Funding-Beziehungen beruhen auf expliziten eingehenden System-Transfers in diesem Stichprobenfenster; Börsen, Relayer und gemeinsame Dienste können denselben Absender erklären. Zeitliche Überschneidungen und gemeinsame Funding-Absender beweisen weder gemeinsame Kontrolle noch Insider-Verbindungen. Nur DEX-Programm plus Wallet-Transfer- und Saldenindizien werden als Kaufkandidaten markiert; einseitige Token-Zugänge bleiben TOKEN_RECEIPT. Vollständige DEX-Routen und Ausführungspreise sind nicht dekodiert."},{headers:{"Cache-Control":"no-store"}});
 }catch(e){activeProvider=rpc.providerLabel();return Response.json({status:"UNAVAILABLE",rpcProvider:activeProvider,rpcBudget:rpc.budget(),error:"Solana RPC nicht erreichbar oder rate-limited",detail:e.message,clusters:[]},{status:502});}
}

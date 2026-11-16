const WSOL_MINT="So11111111111111111111111111111111111111112";
const DEX_IDS={
 "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4":"Jupiter v6",
 "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB":"Jupiter v4",
 "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8":"Raydium AMM v4",
 "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C":"Raydium CPMM",
 "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK":"Raydium CLMM",
 "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj":"Raydium LaunchLab",
 "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc":"Orca Whirlpool",
 "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP":"Orca legacy",
 "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo":"Meteora DLMM",
 "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN":"Meteora DBC",
 "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB":"Meteora DAMM v1",
 "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG":"Meteora DAMM v2",
 "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P":"Pump.fun bonding curve",
 "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA":"PumpSwap"
};

const keyString=k=>typeof k==="string"?k:k?.pubkey;
export function decodeSwapEvidence(tx,{wallet,solDelta,tokenChanges=[]}={}){
 const message=tx?.transaction?.message||{},meta=tx?.meta||{};
 const staticKeys=message.accountKeys||[];
 const loaded=[...(meta.loadedAddresses?.writable||[]),...(meta.loadedAddresses?.readonly||[])];
 const keyAt=i=>keyString(i<staticKeys.length?staticKeys[i]:loaded[i-staticKeys.length]);
 const outerInstructions=message.instructions||[];
 const innerByIndex=new Map((meta.innerInstructions||[]).map(group=>[group.index,group.instructions||[]]));
 const instructions=[];
 outerInstructions.forEach((instruction,index)=>{
  instructions.push(instruction);
  instructions.push(...(innerByIndex.get(index)||[]));
 });
 // Preserve any non-standard inner groups whose parent index is absent.
 for(const group of meta.innerInstructions||[])if(!Number.isInteger(group.index)||group.index<0||group.index>=outerInstructions.length)instructions.push(...(group.instructions||[]));
 const programIds=[...new Set(instructions.map(ix=>ix.programId||(Number.isInteger(ix.programIdIndex)?keyAt(ix.programIdIndex):null)).filter(x=>typeof x==="string"))];
 const dexPrograms=[...new Set(programIds.filter(id=>Object.hasOwn(DEX_IDS,id)).map(id=>DEX_IDS[id]))];
 const dexInstructionTrace=instructions.map((ix,index)=>{const programId=ix.programId||(Number.isInteger(ix.programIdIndex)?keyAt(ix.programIdIndex):null);return {index,programId,dexName:DEX_IDS[programId]||null,parsedType:ix.parsed?.type||null,accounts:ix.accounts||[],data:ix.data||null,stackHeight:ix.stackHeight??null};}).filter(x=>x.dexName);
 // Token-Konten auch dann der Wallet zuordnen, wenn RPC-Metadaten
 // owner/accountIndex bei neu angelegten oder geschlossenen ATAs auslassen.
 const walletTokenAccounts=new Set([...(meta.preTokenBalances||[]),...(meta.postTokenBalances||[])].filter(b=>b.owner===wallet&&Number.isInteger(b.accountIndex)).map(b=>keyAt(b.accountIndex)).filter(Boolean));
 const allTokenBalances=[...(meta.preTokenBalances||[]),...(meta.postTokenBalances||[])];
 const tokenAccountMints=new Map(allTokenBalances.filter(b=>Number.isInteger(b.accountIndex)&&b.mint).map(b=>[keyAt(b.accountIndex),b.mint]));
 const tokenAccountDecimals=new Map(allTokenBalances.filter(b=>Number.isInteger(b.accountIndex)&&Number.isInteger(b.uiTokenAmount?.decimals)).map(b=>[keyAt(b.accountIndex),b.uiTokenAmount.decimals]));
 const parsedTypes=instructions.map(ix=>String(ix.parsed?.type||"").toLowerCase()).filter(Boolean);
 for(const ix of instructions){
  const info=ix.parsed?.info||{},type=String(ix.parsed?.type||"").toLowerCase();
  const account=info.account||info.accountAddress||info.tokenAccount||null;
  if(account&&(info.wallet===wallet||info.owner===wallet))walletTokenAccounts.add(account);
  if(["initializeaccount","initializeaccount2","initializeaccount3"].includes(type)&&info.owner===wallet){const account=info.account||info.accountAddress||info.tokenAccount;if(account)walletTokenAccounts.add(account);}
 }
 const tokenTransfers=[],systemTransfers=[];
 for(const ix of instructions){
  const id=ix.programId||(Number.isInteger(ix.programIdIndex)?keyAt(ix.programIdIndex):null);
  const parsed=ix.parsed||{},info=parsed.info||{},type=String(parsed.type||"").toLowerCase();
  if(["transfer","transferchecked"].includes(type)){
   const source=info.source||null,destination=info.destination||null;
   const sourceOwned=!!source&&walletTokenAccounts.has(source),destinationOwned=!!destination&&walletTokenAccounts.has(destination);
   const mint=info.mint||tokenAccountMints.get(source)||tokenAccountMints.get(destination)||null;
   const rawAmount=info.tokenAmount?.amount??info.amount??null;
   const decimals=info.tokenAmount?.decimals??tokenAccountDecimals.get(source)??tokenAccountDecimals.get(destination)??null;
   const amountUi=info.tokenAmount?.uiAmountString??(rawAmount!==null&&decimals!==null?Number(rawAmount)/10**decimals:null);
   tokenTransfers.push({source,destination,sourceOwned,destinationOwned,mint,amount:amountUi,amountUi,rawAmount,decimals,program:id});
  }
  if(id==="11111111111111111111111111111111"&&["transfer","transferwithseed"].includes(type)){
   const source=info.source||null,destination=info.destination||null;
   systemTransfers.push({source,destination,lamports:Number(info.lamports??0),fromWallet:source===wallet,toWallet:destination===wallet});
  }
 }
 const walletTokenTransfers=tokenTransfers.filter(x=>x.sourceOwned||x.destinationOwned);
 const walletTokenLegs=walletTokenTransfers.map(x=>({...x,side:x.destinationOwned&&!x.sourceOwned?"IN":x.sourceOwned&&!x.destinationOwned?"OUT":"INTERNAL_OR_SELF"}));
 const hasWalletTokenTransferIn=walletTokenTransfers.some(x=>x.destinationOwned&&!x.sourceOwned);
 const hasWalletTokenTransferOut=walletTokenTransfers.some(x=>x.sourceOwned&&!x.destinationOwned);
 const hasWalletSystemTransferIn=systemTransfers.some(x=>x.toWallet);
 const hasWalletSystemTransferOut=systemTransfers.some(x=>x.fromWallet);
 const nonSolTokenChanges=tokenChanges.filter(x=>x.mint!==WSOL_MINT);
 const received=nonSolTokenChanges.filter(x=>Number(x.amount)>0),sent=nonSolTokenChanges.filter(x=>Number(x.amount)<0);
 const hasTokenIn=received.length>0,hasTokenOut=sent.length>0;
 const wrappedSolChange=tokenChanges.filter(x=>x.mint===WSOL_MINT).reduce((n,x)=>n+Number(x.amount||0),0);
 const hasWrappedSolIn=wrappedSolChange>0,hasWrappedSolOut=wrappedSolChange<0;
 const solIn=hasWalletSystemTransferIn||hasWrappedSolIn,solOut=hasWalletSystemTransferOut||hasWrappedSolOut;
 let classification="UNCLEAR",confidence="LOW",basis="Keine eindeutigen Swap- oder Transfermerkmale";
 if(dexPrograms.length&&walletTokenTransfers.length>0&&((hasTokenIn&&hasTokenOut)||(hasTokenIn&&solOut)||(hasTokenOut&&solIn))){
  classification="DEX_SWAP_EVIDENCE";confidence="MEDIUM";basis="Bekanntes DEX-Programm und parsed Token-Transfer zwischen Wallet-Token-Konto und externem Konto; Salden passen dazu. Kein vollständiger Route-/Preisnachweis";
 }else if(hasTokenIn&&hasTokenOut&&walletTokenTransfers.length>0){
  classification="SWAP_CANDIDATE";confidence="LOW";basis="Gegenläufige Token-Salden und Wallet-zugeordnetes parsed Transfer-Indiz ohne erkanntes DEX-Programm";
 }else if(hasTokenIn&&hasTokenOut){
  classification="TOKEN_MOVEMENT";confidence="LOW";basis="Gegenläufige Token-Salden ohne parsed Wallet-Transfer-Nachweis; nicht als Swap gewertet";
 }else if(hasWalletTokenTransferIn&&solOut){
  classification="BUY_INFERRED";confidence="LOW";basis="Wallet erhält Token und sendet SOL laut System-Transfer; DEX-Gegenleistung nicht bestätigt";
 }else if(hasWalletTokenTransferOut&&solIn){
  classification="SELL_INFERRED";confidence="LOW";basis="Wallet sendet Token und erhält SOL laut System-Transfer; DEX-Gegenleistung nicht bestätigt";
 }else if(hasWalletTokenTransferIn||hasTokenIn){
  classification=hasWalletTokenTransferIn?"TOKEN_TRANSFER_IN":"AIRDROP_OR_TOKEN_RECEIPT";confidence="LOW";basis=hasWalletTokenTransferIn?"Parsed Token-Transfer an ein Token-Konto der Wallet":"Einseitiger Token-Zugang ohne nachgewiesene Gegenleistung";
 }else if(hasWalletTokenTransferOut||hasTokenOut){
  classification=hasWalletTokenTransferOut?"TOKEN_TRANSFER_OUT":"TOKEN_MOVEMENT";confidence="LOW";basis=hasWalletTokenTransferOut?"Parsed Token-Transfer von einem Token-Konto der Wallet":"Einseitiger Token-Abgang ohne nachgewiesene Gegenleistung";
 }else if(hasWalletSystemTransferIn){
  classification="WALLET_FUNDING_IN";confidence="MEDIUM";basis="Parsed System-Program-Transfer mit Ziel Wallet";
 }else if(hasWalletSystemTransferOut){
  classification="SOL_TRANSFER_OUT";confidence="MEDIUM";basis="Parsed System-Program-Transfer mit Quelle Wallet";
 }else if(walletTokenTransfers.length){
  classification="TOKEN_TRANSFER";confidence="MEDIUM";basis="Parsed SPL-Token-Transfer mit Wallet-eigenem Token-Konto";
 }
 const direction=hasWalletTokenTransferOut&&hasWalletTokenTransferIn?"TOKEN_TO_TOKEN":hasWalletTokenTransferIn&&solOut?"SOL_TO_TOKEN":hasWalletTokenTransferOut&&solIn?"TOKEN_TO_SOL":"UNRESOLVED";
 const feePayer=keyAt(0)||null;
 const counterparties=[...new Set([...walletTokenTransfers.flatMap(x=>[x.sourceOwned?null:x.source,x.destinationOwned?null:x.destination]),...systemTransfers.flatMap(x=>[x.fromWallet?null:x.source,x.toWallet?null:x.destination])].filter(x=>typeof x==="string"&&x!==wallet))];
 return {classification,confidence,basis,direction,feePayer,counterparties,dexPrograms,dexInstructionTrace,walletTokenLegs,programIds,wrappedSolMint:WSOL_MINT,wrappedSolDelta:wrappedSolChange,hasWrappedSolIn,hasWrappedSolOut,parsedInstructionTypes:[...new Set(parsedTypes)],walletTokenAccountsChecked:walletTokenAccounts.size,walletTokenTransfers,systemTransfers,hasWalletTokenTransferIn,hasWalletTokenTransferOut,hasWalletSystemTransferIn,hasWalletSystemTransferOut,hasKnownDexProgram:dexPrograms.length>0};
}
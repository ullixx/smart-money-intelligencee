const DEX_PROGRAMS={
 jupiter:"Jupiter",raydium:"Raydium",orca:"Orca Whirlpool",meteora:"Meteora",pumpfun:"Pump.fun"
};
const DEX_IDS={
 jupiter:["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"],
 raydium:["675kPX9MHTjS2zt1qfr1NYHuzeL7N9T8r8Z3F5V5"],
 orca:["whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"],
 meteora:["LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"],
 pumpfun:["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"]
};
const allDexIds=new Map(Object.entries(DEX_IDS).flatMap(([key,ids])=>ids.map(id=>[id,DEX_PROGRAMS[key]])));
const keyString=k=>typeof k==="string"?k:k?.pubkey;
export function decodeSwapEvidence(tx,{wallet,solDelta,tokenChanges=[]}={}){
 const message=tx?.transaction?.message||{},meta=tx?.meta||{};
 const staticKeys=message.accountKeys||[];
 const loaded=[...(meta.loadedAddresses?.writable||[]),...(meta.loadedAddresses?.readonly||[])];
 const keyAt=i=>keyString(i<staticKeys.length?staticKeys[i]:loaded[i-staticKeys.length]);
 const instructions=[...(message.instructions||[]),...(meta.innerInstructions||[]).flatMap(x=>x.instructions||[])];
 const programIds=[...new Set(instructions.map(ix=>ix.programId||(Number.isInteger(ix.programIdIndex)?keyAt(ix.programIdIndex):null)).filter(x=>typeof x==="string"))];
 const dexPrograms=[...new Set(programIds.filter(id=>allDexIds.has(id)).map(id=>allDexIds.get(id)))];
 const walletTokenAccounts=new Set([...(meta.preTokenBalances||[]),...(meta.postTokenBalances||[])].filter(b=>b.owner===wallet&&Number.isInteger(b.accountIndex)).map(b=>keyAt(b.accountIndex)).filter(Boolean));
 const parsedTypes=instructions.map(ix=>String(ix.parsed?.type||"").toLowerCase()).filter(Boolean);
 const tokenTransfers=[],systemTransfers=[];
 for(const ix of instructions){
  const id=ix.programId||(Number.isInteger(ix.programIdIndex)?keyAt(ix.programIdIndex):null);
  const parsed=ix.parsed||{},info=parsed.info||{},type=String(parsed.type||"").toLowerCase();
  if(["transfer","transferchecked"].includes(type)){
   const source=info.source||null,destination=info.destination||null;
   const sourceOwned=!!source&&walletTokenAccounts.has(source),destinationOwned=!!destination&&walletTokenAccounts.has(destination);
   tokenTransfers.push({source,destination,sourceOwned,destinationOwned,amount:info.tokenAmount?.uiAmountString??info.amount??null,program:id});
  }
  if(id==="11111111111111111111111111111111"&&["transfer","transferwithseed"].includes(type)){
   const source=info.source||null,destination=info.destination||null;
   systemTransfers.push({source,destination,lamports:Number(info.lamports??0),fromWallet:source===wallet,toWallet:destination===wallet});
  }
 }
 const walletTokenTransfers=tokenTransfers.filter(x=>x.sourceOwned||x.destinationOwned);
 const hasWalletTokenTransferIn=walletTokenTransfers.some(x=>x.destinationOwned&&!x.sourceOwned);
 const hasWalletTokenTransferOut=walletTokenTransfers.some(x=>x.sourceOwned&&!x.destinationOwned);
 const hasWalletSystemTransferIn=systemTransfers.some(x=>x.toWallet);
 const hasWalletSystemTransferOut=systemTransfers.some(x=>x.fromWallet);
 const received=tokenChanges.filter(x=>Number(x.amount)>0),sent=tokenChanges.filter(x=>Number(x.amount)<0);
 const hasTokenIn=received.length>0,hasTokenOut=sent.length>0;
 const solIn=hasWalletSystemTransferIn,solOut=hasWalletSystemTransferOut;
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
 return {classification,confidence,basis,direction,dexPrograms,programIds,parsedInstructionTypes:[...new Set(parsedTypes)],walletTokenAccountsChecked:walletTokenAccounts.size,walletTokenTransfers,systemTransfers,hasWalletTokenTransferIn,hasWalletTokenTransferOut,hasWalletSystemTransferIn,hasWalletSystemTransferOut,hasKnownDexProgram:dexPrograms.length>0};
}
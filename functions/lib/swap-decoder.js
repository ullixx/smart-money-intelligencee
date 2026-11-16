const DEX_PROGRAMS={
 jupiter:"Jupiter",
 raydium:"Raydium",
 orca:"Orca Whirlpool",
 meteora:"Meteora",
 pumpfun:"Pump.fun"
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
 const message=tx?.transaction?.message||{};
 const staticKeys=message.accountKeys||[];
 const loaded=[...(tx?.meta?.loadedAddresses?.writable||[]),...(tx?.meta?.loadedAddresses?.readonly||[])];
 const keyAt=i=>keyString(i<staticKeys.length?staticKeys[i]:loaded[i-staticKeys.length]);
 const outer=message.instructions||[];
 const inner=(tx?.meta?.innerInstructions||[]).flatMap(x=>x.instructions||[]);
 const instructions=[...outer,...inner];
 const programIds=[...new Set(instructions.map(ix=>ix.programId||(Number.isInteger(ix.programIdIndex)?keyAt(ix.programIdIndex):null)).filter(x=>typeof x==="string"))];
 const dexPrograms=[...new Set(programIds.filter(id=>allDexIds.has(id)).map(id=>allDexIds.get(id)))];
 const parsedTypes=instructions.map(ix=>String(ix.parsed?.type||"").toLowerCase()).filter(Boolean);
 const hasTokenTransfer=parsedTypes.some(x=>x==="transfer"||x==="transferchecked");
 const hasSystemTransfer=instructions.some(ix=>{
  const id=ix.programId||(Number.isInteger(ix.programIdIndex)?keyAt(ix.programIdIndex):null);
  return id==="11111111111111111111111111111111"&&["transfer","transferwithseed"].includes(String(ix.parsed?.type||"").toLowerCase());
 });
 const received=tokenChanges.filter(x=>Number(x.amount)>0);
 const sent=tokenChanges.filter(x=>Number(x.amount)<0);
 const hasTokenIn=received.length>0,hasTokenOut=sent.length>0;
 let classification="UNCLEAR",confidence="LOW",basis="Keine eindeutigen Swap- oder Transfermerkmale";
 if(dexPrograms.length&&(hasTokenIn&&hasTokenOut||(hasTokenIn&&Number(solDelta)<0)||(hasTokenOut&&Number(solDelta)>0))){
  classification="DEX_SWAP_EVIDENCE";confidence="MEDIUM";basis="Bekanntes DEX-Programm und gegenläufige Token-/SOL-Salden; exakter Instruction-Pfad und Ausführungspreis nicht vollständig dekodiert";
 }else if(hasTokenIn&&hasTokenOut){
  classification="SWAP_CANDIDATE";confidence="LOW";basis="Gegenläufige Token-Salden ohne bestätigtes bekanntes DEX-Programm";
 }else if(hasTokenIn&&Number.isFinite(solDelta)&&solDelta<0){
  classification="BUY_INFERRED";confidence="LOW";basis="Token-Zugang und SOL-Abgang; kann auch Transfer plus Gebühr/Rent sein";
 }else if(hasTokenOut&&Number.isFinite(solDelta)&&solDelta>0){
  classification="SELL_INFERRED";confidence="LOW";basis="Token-Abgang und SOL-Zugang; kann auch unabhängige Transfers enthalten";
 }else if(hasTokenIn&&!hasTokenOut){
  classification=hasTokenTransfer?"TOKEN_TRANSFER_IN":"AIRDROP_OR_TOKEN_RECEIPT";confidence="LOW";basis=hasTokenTransfer?"Einseitiger Token-Zugang mit Transfer-Instruktion":"Einseitiger Token-Zugang ohne erkennbare Gegenleistung";
 }else if(hasTokenOut&&!hasTokenIn){
  classification=hasTokenTransfer?"TOKEN_TRANSFER_OUT":"TOKEN_MOVEMENT";confidence="LOW";basis=hasTokenTransfer?"Einseitiger Token-Abgang mit Transfer-Instruktion":"Einseitiger Token-Abgang ohne erkennbare Gegenleistung";
 }else if(hasSystemTransfer&&Number(solDelta)>0){
  classification="WALLET_FUNDING_IN";confidence="MEDIUM";basis="System-Program SOL-Transfer und positiver SOL-Saldo";
 }else if(hasSystemTransfer&&Number(solDelta)<0){
  classification="SOL_TRANSFER_OUT";confidence="MEDIUM";basis="System-Program SOL-Transfer und negativer SOL-Saldo";
 }else if(hasTokenTransfer){
  classification="TOKEN_TRANSFER";confidence="MEDIUM";basis="Parsed SPL-Token-Transfer-Instruktion";
 }
 const direction=hasTokenOut&&hasTokenIn?"TOKEN_TO_TOKEN":hasTokenIn&&Number(solDelta)<0?"SOL_TO_TOKEN":hasTokenOut&&Number(solDelta)>0?"TOKEN_TO_SOL":"UNRESOLVED";
 return {classification,confidence,basis,direction,dexPrograms,programIds,parsedInstructionTypes:[...new Set(parsedTypes)],hasTokenTransfer,hasSystemTransfer,hasKnownDexProgram:dexPrograms.length>0};
}

import { decodeSwapEvidence } from "./swap-decoder.js";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const WSOL = "So11111111111111111111111111111111111111112";
const keyString = value => typeof value === "string" ? value : value?.pubkey || null;
const clamp = (n,min=0,max=100) => Math.max(min,Math.min(max,n));
const round = n => Number.isFinite(n) ? Number(n.toFixed(6)) : null;

export function analyseIntelligence({ wallets = [], transactionsByWallet = {}, now = Date.now() } = {}) {
  const walletSet = new Set(wallets);
  const profiles = [];
  const edges = new Map();
  const tokenOwners = new Map();
  const tokenFlows = new Map();
  const candidates = new Map();
  const candidateReasons = new Map();

  for (const wallet of wallets) {
    const txs = (transactionsByWallet[wallet] || []).filter(tx => tx && tx.meta && !tx.meta.err);
    let buys = 0, sells = 0, solIn = 0, solOut = 0, fees = 0, confirmedDexSwaps = 0, swapCandidates = 0;
    const mints = new Map();
    const counterparties = new Set();
    const activityDays = new Set();
    const riskFlags = [];
    for (const tx of txs) {
      const message = tx.transaction?.message || {};
      const meta = tx.meta || {};
      const keys = [...(message.accountKeys || []).map(keyString), ...(meta.loadedAddresses?.writable || []), ...(meta.loadedAddresses?.readonly || [])];
      const payer = keys[0];
      if (payer && payer !== wallet && !walletSet.has(payer)) { candidates.set(payer,(candidates.get(payer)||0)+1); candidateReasons.set(payer,"FEE_PAYER"); }
      const time = Number(tx.blockTime || 0) * 1000;
      if (time) activityDays.add(new Date(time).toISOString().slice(0,10));
      fees += Number(meta.fee || 0) / 1e9;
      for (const ix of [...(message.instructions || []), ...(meta.innerInstructions || []).flatMap(x=>x.instructions || [])]) {
        const parsed = ix.parsed || {}, info = parsed.info || {}, type = String(parsed.type || "").toLowerCase();
        const program = ix.programId || (Number.isInteger(ix.programIdIndex) ? keys[ix.programIdIndex] : null);
        if (program === SYSTEM_PROGRAM && ["transfer","transferwithseed"].includes(type)) {
          const source = info.source, destination = info.destination, amount = Number(info.lamports || 0) / 1e9;
          if (source === wallet && destination && destination !== wallet) { solOut += amount; counterparties.add(destination); }
          if (destination === wallet && source && source !== wallet) { solIn += amount; counterparties.add(source); }
        }
      }
      const before = new Map();
      for (const b of meta.preTokenBalances || []) if (b.owner === wallet) before.set(b.mint, (before.get(b.mint)||0)-Number(b.uiTokenAmount?.uiAmountString || 0));
      for (const b of meta.postTokenBalances || []) if (b.owner === wallet) before.set(b.mint, (before.get(b.mint)||0)+Number(b.uiTokenAmount?.uiAmountString || 0));
      for (const [mint, delta] of before) {
        if (!Number.isFinite(delta) || Math.abs(delta) < 1e-12) continue;
        mints.set(mint,(mints.get(mint)||0)+delta);
        if (mint !== WSOL) {
          const owners = tokenOwners.get(mint) || new Set(); owners.add(wallet); tokenOwners.set(mint,owners);
          const flow = tokenFlows.get(mint) || {mint, wallets: new Set(), netUnits: 0, inflowUnits: 0, outflowUnits: 0, events: 0, eventDetails: []};
          flow.wallets.add(wallet); flow.netUnits += delta; flow.events++; flow.eventDetails.push({wallet,signature:tx.signature||null,time:Number(tx.blockTime||0),amount:delta});
          if (delta > 0) flow.inflowUnits += delta; else flow.outflowUnits += Math.abs(delta);
          tokenFlows.set(mint,flow);
        }
      }
      const nonSol = [...before].filter(([mint,delta])=>mint!==WSOL&&delta!==0);
      const tokenChanges=[...before.entries()].map(([mint,amount])=>({mint,amount})).filter(x=>Number.isFinite(x.amount)&&x.amount!==0);
      const evidence=decodeSwapEvidence(tx,{wallet,tokenChanges});
      for(const transfer of evidence.systemTransfers){
        const peer=transfer.fromWallet?transfer.destination:transfer.toWallet?transfer.source:null;
        if(peer&&peer!==wallet){counterparties.add(peer);if(!walletSet.has(peer)){candidates.set(peer,(candidates.get(peer)||0)+1);candidateReasons.set(peer,"SOL_TRANSFER_COUNTERPARTY");}}
      }
      if(evidence.classification==="DEX_SWAP_EVIDENCE"){
        confirmedDexSwaps++;
        if(evidence.direction==="SOL_TO_TOKEN")buys++;
        else if(evidence.direction==="TOKEN_TO_SOL")sells++;
        else if(evidence.direction==="TOKEN_TO_TOKEN"){buys++;sells++;}
      }else if(evidence.classification==="SWAP_CANDIDATE")swapCandidates++;
      for (const ix of [...(message.instructions || []), ...(meta.innerInstructions || []).flatMap(x=>x.instructions || [])]) {
        const info=ix.parsed?.info||{};
        for (const address of [info.source,info.destination]) if (typeof address==="string" && address!==wallet && address.length>=32 && address.length<=44 && !address.startsWith("Ata")) {
          if (info.lamports != null) counterparties.add(address);
        }
      }
    }
    const activity = txs.length;
    const observedTrades = buys + sells;
    const activityScore = clamp(activity*7 + observedTrades*8 + Math.min(20,activityDays.size*4));
    if (txs.length < 3) riskFlags.push("GERINGE DATENBASIS");
    if (observedTrades === 0) riskFlags.push("KEINE BESTÄTIGTEN BUY/SELL-PAARE");
    if (solOut > 0 && solIn === 0) riskFlags.push("NETTO-SOL-ABFLUSS IM BEOBACHTETEN FENSTER");
    profiles.push({
      address: wallet, status: txs.length ? "PARTIAL" : "UNAVAILABLE",
      transactionsAnalysed: txs.length, confirmedDexSwaps, swapCandidates, observedBuys: buys, observedSells: sells,
      activityDays: activityDays.size, activityScore, solIn: round(solIn), solOut: round(solOut),
      netSolTransfers: round(solIn-solOut), feesSol: round(fees),
      distinctTokens: [...mints.keys()].filter(m=>m!==WSOL).length,
      counterparties: [...counterparties], riskFlags,
      scoreMeaning: "Beobachtete Aktivität, kein Gewinn- oder Qualitätsnachweis"
    });
    for (const peer of counterparties) {
      const id=[wallet,peer].sort().join("|");
      const edge=edges.get(id)||{from:wallet,to:peer,transfers:0,solIn:0,solOut:0,sharedTokens:0};
      edge.transfers++; edges.set(id,edge);
    }
  }

  const clusters = [...edges.values()].filter(e=>walletSet.has(e.from)&&walletSet.has(e.to)).map(e=>({...e,relation:"DIREKTE TRANSFERBEZIEHUNG"}));
  const sharedTokenClusters = [];
  for (const [mint, owners] of tokenOwners) if (owners.size>1) sharedTokenClusters.push({mint,wallets:[...owners],walletCount:owners.size,evidence:"Mehrere beobachtete Wallets hielten/bewegten denselben Mint; keine Beziehungsbestätigung"});
  const capitalFlows = [...tokenFlows.values()].map(f=>({
    mint:f.mint,walletCount:f.wallets.size,netUnits:round(f.netUnits),
    inflowUnits:round(f.inflowUnits),outflowUnits:round(f.outflowUnits),events:f.events,eventDetails:f.eventDetails,
    usdValue:null,valuationStatus:"UNAVAILABLE",valuationNote:"Historische USD-Kurse je Bewegungszeitpunkt sind noch nicht zugeordnet.",
    direction:f.netUnits>0?"NETTO-AKKUMULATION":f.netUnits<0?"NETTO-ABFLUSS":"AUSGEGLICHEN",
    wallets:[...f.wallets]
  })).sort((a,b)=>b.events-a.events);
  const discovered = [...candidates.entries()].filter(([address])=>!walletSet.has(address)).map(([address,mentions])=>({
    address,mentions,discoveryReason:candidateReasons.get(address)==="FEE_PAYER"?"Fee-Payer einer beobachteten Transaktion":"Gegenpartei eines beobachteten SOL-Transfers",candidateType:"WALLET_CANDIDATE",
    status:"CANDIDATE",warning:"Nicht als Smart Money bestätigt; separat prüfen"
  })).sort((a,b)=>b.mentions-a.mentions).slice(0,30);
  const risk = profiles.map(p=>{
    const flags=[...p.riskFlags];
    if (p.distinctTokens===1 && p.transactionsAnalysed>=4) flags.push("STARKE TOKEN-KONZENTRATION IM BEOBACHTETEN FENSTER");
    if (p.feesSol>0 && p.transactionsAnalysed>0 && p.feesSol/p.transactionsAnalysed>0.01) flags.push("HOHE DURCHSCHNITTLICHE TRANSAKTIONSGEBÜHR");
    return {...p,riskLevel:p.transactionsAnalysed<3?"UNBEWERTET":flags.length>=3?"ERHÖHT":flags.length>=1?"BEOBACHTEN":"KEIN SIGNAL",riskFlags:flags};
  });
  return {
    status: wallets.length ? "PARTIAL" : "UNAVAILABLE",
    dataStatus: {wallets:wallets.length?"HISTORICAL":"UNAVAILABLE", discovery:discovered.length?"HISTORICAL":"PARTIAL", clusters:clusters.length||sharedTokenClusters.length?"HISTORICAL":"PARTIAL", capitalFlows:capitalFlows.length?"PARTIAL":"UNAVAILABLE", risk:profiles.length?"PARTIAL":"UNAVAILABLE"},
    generatedAt:new Date(now).toISOString(),
    coverage:{walletsRequested:wallets.length,walletsAnalysed:profiles.length,transactionsAnalysed:profiles.reduce((n,p)=>n+p.transactionsAnalysed,0),window:"Bis zu 5 jüngste Transaktionen je Wallet"},
    walletDiscovery:discovered,
    walletRanking:profiles.slice().sort((a,b)=>b.activityScore-a.activityScore).map((p,i)=>({...p,rank:i+1})),
    clusters:{directTransfers:clusters,sharedTokenExposure:sharedTokenClusters,note:"Transfer- oder gemeinsame Token-Indizien beweisen keine gemeinsame Kontrolle."},
    capitalFlows,
    riskAssessment:risk,
    limitations:["Nur die abgefragten Wallets und bis zu fünf jüngste Transaktionen je Wallet.","Historische Saldenänderungen; keine vollständige Marktpreis- oder PnL-Berechnung.","Kapitalflüsse werden nur dann in USD bewertet, wenn historische Kurse den Bewegungszeitpunkten mit ausreichender zeitlicher Nähe zugeordnet werden können.","Wallet-Reputation ist nicht berechnet: Aktivität und Swap-Indizien sind kein Gewinn- oder Qualitätsnachweis.","Fee-Payer und Transfer-Gegenparteien sind Kandidaten, keine bestätigten Smart-Money-Wallets.","Keine automatisierte Wallet-Verbindung und keine Trading-Aktionen."]
  };
}

export function discoverWalletCandidates(transactionsByWallet, excludedWallets = []) {
  const excluded = new Set(excludedWallets);
  const mentions = new Map();
  for (const txs of Object.values(transactionsByWallet || {})) {
    for (const tx of txs || []) {
      const message = tx?.transaction?.message || {};
      const meta = tx?.meta || {};
      const keys = [...(message.accountKeys || []).map(keyString), ...(meta.loadedAddresses?.writable || []), ...(meta.loadedAddresses?.readonly || [])];
      const payer = keys[0];
      if (typeof payer === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(payer) && !excluded.has(payer)) mentions.set(payer,(mentions.get(payer)||0)+1);
      for (const ix of [...(message.instructions || []), ...(meta.innerInstructions || []).flatMap(x=>x.instructions || [])]) {
        const parsed=ix.parsed||{},info=parsed.info||{},type=String(parsed.type||"").toLowerCase();
        const program=ix.programId || (Number.isInteger(ix.programIdIndex)?keys[ix.programIdIndex]:null);
        if(program==="11111111111111111111111111111111" && ["transfer","transferwithseed"].includes(type)) {
          for(const peer of [info.source,info.destination]) if(typeof peer==="string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(peer) && !excluded.has(peer)) mentions.set(peer,(mentions.get(peer)||0)+1);
        }
      }
    }
  }
  return [...mentions.entries()].map(([address,count])=>({address,mentions:count,discoveryReason:"Fee-Payer oder Gegenpartei eines beobachteten SOL-Transfers",status:"CANDIDATE",warning:"Nicht als Smart Money bestätigt; historische Aktivität separat prüfen"})).sort((a,b)=>b.mentions-a.mentions).slice(0,5);
}

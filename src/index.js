import { onRequestGet as health } from "../functions/api/health.js";
import { onRequestGet as discovery } from "../functions/api/discovery.js";
import { onRequestGet as wallet } from "../functions/api/wallet.js";
import { onRequestGet as network } from "../functions/api/network.js";
import { onRequestGet as ranking } from "../functions/api/ranking.js";
import { onRequestGet as fomo } from "../functions/api/fomo.js";
import { onRequestGet as entry } from "../functions/api/entry.js";
import { onRequestGet as performance } from "../functions/api/performance.js";
import { onRequestGet as developer } from "../functions/api/developer.js";
import { onRequestGet as tokenSecurity } from "../functions/api/token-security.js";

const routes = {
  "/api/health": health,
  "/api/discovery": discovery,
  "/api/wallet": wallet,
  "/api/network": network,
  "/api/ranking": ranking,
  "/api/fomo": fomo,
  "/api/entry": entry,
  "/api/performance": performance,
  "/api/developer": developer,
  "/api/token-security": tokenSecurity
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const handler = routes[url.pathname];
    if (handler) {
      if (request.method !== "GET") {
        return Response.json({ status: "UNAVAILABLE", error: "Method not allowed" }, { status: 405 });
      }
      try {
        return await handler({ request, env, params: {} });
      } catch (error) {
        return Response.json({
          status: "UNAVAILABLE",
          error: error?.message || "Interner Worker-Fehler"
        }, { status: 500, headers: { "Cache-Control": "no-store" } });
      }
    }
    return env.ASSETS.fetch(request);
  }
};

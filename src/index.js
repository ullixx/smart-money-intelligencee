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
import { onRequestGet as tokenInfo } from "../functions/api/token-info.js";
import { onRequestGet as intelligence } from "../functions/api/intelligence.js";

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
  "/api/token-security": tokenSecurity,
  "/api/token-info": tokenInfo,
  "/api/intelligence": intelligence
};

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; upgrade-insecure-requests",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
};

async function secureResponse(response) {
  const headers = new Headers(response.headers);
  let body = response.body;
  const contentType = headers.get("Content-Type") || "";
  let nonce = null;
  if (response.status === 200 && contentType.toLowerCase().includes("text/html")) {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    nonce = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    headers.delete("Content-Length");
    headers.delete("Content-MD5");
    headers.delete("ETag");
    headers.set("Cache-Control", "no-store");
    body = (await response.text()).replace(/<script(?=[\s>])/gi, '<script nonce="' + nonce + '"');
  }
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, name === "Content-Security-Policy" && nonce
      ? value.replace("script-src 'self'", "script-src 'self' 'nonce-" + nonce + "'")
      : value);
  }
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const handler = routes[url.pathname];
    if (handler) {
      if (request.method !== "GET") {
        return secureResponse(Response.json({ status: "UNAVAILABLE", error: "Method not allowed" }, { status: 405 }));
      }
      try {
        return secureResponse(await handler({ request, env, params: {} }));
      } catch (error) {
        return secureResponse(Response.json({
          status: "UNAVAILABLE",
          error: error?.message || "Interner Worker-Fehler"
        }, { status: 500, headers: { "Cache-Control": "no-store" } }));
      }
    }
    return secureResponse(await env.ASSETS.fetch(request));
  }
};

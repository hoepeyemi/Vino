const fs = require("fs");
const path = require("path");

const TIMEOUT_MS = 4000;
const CHAIN_ID_HEX = "0x279f"; // 10143 decimal
const OUT_FILE = path.join(__dirname, "..", ".env.local");

const CANDIDATES = [
  process.env.MONAD_TESTNET_RPC,
  "https://testnet-rpc.monad.xyz",
].filter(Boolean);

async function probeRpc(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return false;
    }

    const json = await response.json().catch(() => null);
    if (!json || typeof json.result !== "string") {
      return false;
    }

    return json.result.toLowerCase() === CHAIN_ID_HEX;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  for (const url of CANDIDATES) {
    if (await probeRpc(url)) {
      fs.writeFileSync(OUT_FILE, `MONAD_TESTNET_RPC_SELECTED=${url}\n`, "utf8");
      console.log(`Selected Monad Testnet RPC: ${url}`);
      return;
    }
  }

  throw new Error(
    "Could not reach any Monad Testnet RPC endpoint. " +
    "Try setting MONAD_TESTNET_RPC manually in contracts/.env."
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});

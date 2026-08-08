/**
 * generate-apass.js
 *
 * Registers a wallet with Cleanverse KYB by calling POST /generate_apass.
 * After this succeeds, run relay-kyb-approval.js to approve the wallet on-chain.
 *
 * Usage:
 *   WALLET=0xAbc... npm run generate-apass --prefix contracts
 *
 * Optional env overrides:
 *   CUSTOMER_ID   — custom ID (default: VINO + wallet suffix, 12 chars min)
 *   FULL_NAME     — name on KYC document (default: "Vino User")
 *   COUNTRY       — ISO 3166-1 alpha-2 issuing country (default: "US")
 *
 * Required env:
 *   CLEANVERSE_API_ID
 *   CLEANVERSE_API_KEY
 */

const crypto = require("crypto");

const API_ID  = process.env.CLEANVERSE_API_ID;
const API_KEY = process.env.CLEANVERSE_API_KEY;
const API_URL = process.env.CLEANVERSE_API_URL || "https://uatapi.cleanverse.com/api/cooperate";
const CHAIN   = "monad";

function aesEncrypt(obj) {
  const key = Buffer.from(API_KEY, "base64");
  const iv  = Buffer.alloc(16, 0);
  const cipher = crypto.createCipheriv(`aes-${key.length * 8}-cbc`, key, iv);
  const plain = JSON.stringify(obj);
  return Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]).toString("base64");
}

async function main() {
  const walletAddress = process.env.WALLET;
  if (!walletAddress) { console.error("Set WALLET=0x..."); process.exit(1); }
  if (!API_ID || !API_KEY) { console.error("CLEANVERSE_API_ID and CLEANVERSE_API_KEY required"); process.exit(1); }

  // customerId: 12+ alphanumeric only, no special chars
  const suffix = walletAddress.replace(/^0x/i, "").toUpperCase().slice(0, 20);
  const customerId = process.env.CUSTOMER_ID || `VINO${suffix}`;

  const fullName  = process.env.FULL_NAME || "Vino User";
  const country   = process.env.COUNTRY   || "US";
  const expiresIn = 3 * 365 * 24 * 3600; // 3 years
  const expirationTime = Math.floor(Date.now() / 1000) + expiresIn;

  const body = {
    customerId,
    expirationTime,
    wallet: { address: walletAddress, chain: CHAIN },
    identityDataList: [
      {
        idType: "PASSPORT",
        fullName,
        issuingCountryISO2: country,
      },
    ],
  };

  console.log(`Registering A-Pass for: ${walletAddress}`);
  console.log(`  customerId : ${customerId}`);
  console.log(`  chain      : ${CHAIN}`);
  console.log(`  expires    : ${new Date(expirationTime * 1000).toISOString()}`);

  const res = await fetch(`${API_URL}/generate_apass`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-id": API_ID,
      "X-Request-ID": crypto.randomUUID(),
    },
    body: JSON.stringify({ data: aesEncrypt(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from Cleanverse API`);

  const json = await res.json();
  console.log("\nResponse:", JSON.stringify(json, null, 2));

  if (json.code === "0000") {
    console.log("\n✅ A-Pass registered.");
    console.log("   cvRecordId:", json.data?.cvRecordId);
    console.log("   txHash    :", json.data?.wallet?.txHash);
    console.log("\nNext step — approve on-chain:");
    console.log(`  WALLET=${walletAddress} npm run relay-kyb-approval --prefix contracts`);
  } else if (json.code === "1000") {
    // Already exists — re-run with override=true
    console.log("\n⚠️  A-Pass already exists. Re-registering with override=true ...");
    const overrideRes = await fetch(`${API_URL}/generate_apass`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-id": API_ID,
        "X-Request-ID": crypto.randomUUID(),
      },
      body: JSON.stringify({ data: aesEncrypt({ ...body, override: true }) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!overrideRes.ok) throw new Error(`HTTP ${overrideRes.status} from Cleanverse API`);
    const overrideJson = await overrideRes.json();
    console.log("Override response:", JSON.stringify(overrideJson, null, 2));
    if (overrideJson.code === "0000") {
      console.log("\n✅ A-Pass updated.");
      console.log(`\nNext: WALLET=${walletAddress} npm run relay-kyb-approval --prefix contracts`);
    } else {
      console.error("\n❌ Override failed:", overrideJson.message);
    }
  } else {
    console.error("\n❌ Failed:", json.message);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

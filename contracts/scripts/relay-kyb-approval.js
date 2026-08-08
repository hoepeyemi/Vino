/**
 * relay-kyb-approval.js
 *
 * 1. Checks the wallet's A-Pass via POST /query_apass
 * 2. If active and not expired, approves on-chain via MockCVI.verify()
 *
 * Follows the Cleanverse A-Pass Management module (API v5.6),
 * which supports Monad testnet.
 *
 * Usage:
 *   WALLET=0xAbc... npm run relay-kyb-approval --prefix contracts
 *
 * Required env (contracts/.env):
 *   WALLET            — address to approve
 *   CLEANVERSE_API_ID — Cleanverse institution API ID
 *   PRIVATE_KEY       — deployer wallet (must be MockCVI owner)
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const API_ID = process.env.CLEANVERSE_API_ID;
const API_URL =
  process.env.CLEANVERSE_API_URL ||
  "https://uatapi.cleanverse.com/api/cooperate";
const CHAIN = "monad";

async function queryAPass(address) {
  const res = await fetch(`${API_URL}/query_apass`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-id": API_ID,
      "X-Request-ID": randomUUID(),
    },
    body: JSON.stringify({ chain: CHAIN, address }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from Cleanverse API`);
  return res.json();
}

async function main() {
  const walletAddress = process.env.WALLET;
  if (!walletAddress) {
    console.error("Set WALLET=0x... to the address you want to relay KYB for.");
    process.exit(1);
  }
  if (!API_ID) {
    console.error("CLEANVERSE_API_ID must be set in contracts/.env");
    process.exit(1);
  }

  console.log(`Wallet: ${walletAddress}`);
  console.log(`Chain:  ${CHAIN}`);

  let resp;
  try {
    resp = await queryAPass(walletAddress);
  } catch (err) {
    console.error(`❌ Failed to reach Cleanverse API: ${err.message}`);
    process.exit(1);
  }

  if (resp.code !== "0000" || !resp.data || typeof resp.data !== "object") {
    console.log("❌ No A-Pass found for this wallet.");
    console.log(`   Run: WALLET=${walletAddress} npm run generate-apass --prefix contracts`);
    process.exit(0);
  }

  const apass = resp.data;
  const now = Math.floor(Date.now() / 1000);

  console.log(`\nA-Pass:`);
  console.log(`   Tier      : ${apass.tier}`);
  console.log(`   Status    : ${apass.status === 1 ? "Active" : "Frozen"}`);
  console.log(`   Expires   : ${new Date(apass.expirationTime * 1000).toISOString()}`);
  console.log(`   Countries : ${apass.countries?.join(", ") || "(none)"}`);

  if (apass.status !== 1) {
    console.log("❌ A-Pass is frozen — cannot approve.");
    process.exit(0);
  }
  if (apass.expirationTime < now) {
    console.log("❌ A-Pass has expired — cannot approve.");
    process.exit(0);
  }

  const manifestPath = path.join(__dirname, "../deployments/monadTestnet.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const MockCVI = await hre.ethers.getContractAt("MockCVI", manifest.mockCVI);

  let isAlready;
  try {
    isAlready = await MockCVI.isVerified(walletAddress);
  } catch (err) {
    console.error(`❌ Could not read MockCVI.isVerified: ${err.message}`);
    process.exit(1);
  }

  if (isAlready) {
    console.log("\n✅ Already approved on-chain — nothing to do.");
    process.exit(0);
  }

  console.log(`\nApproving on-chain via MockCVI (${manifest.mockCVI})...`);
  try {
    const tx = await MockCVI.verify(walletAddress);
    await tx.wait();
    console.log(`✅ Approved. tx: ${tx.hash}`);
    console.log(`   ${walletAddress} can now call InvoiceNFT.mint() and YieldVault.deposit()`);
  } catch (err) {
    console.error(`❌ On-chain approval failed: ${err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

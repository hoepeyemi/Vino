// Activates PythOracle fallback mode so the agent uses the hardcoded
// fallback price instead of querying Pyth (needed when the configured feed
// ID has no data on the target chain, e.g. ETH/USD on Monad Testnet).
const hre = require("hardhat");

const PYTH_ORACLE_ADDRESS = "0x025C18Ccc2403D7a8cb7aD20Ac4924b16AF26e13";

async function main() {
  const [owner] = await hre.ethers.getSigners();
  console.log("Owner:", owner.address);

  const oracle = await hre.ethers.getContractAt("PythOracle", PYTH_ORACLE_ADDRESS, owner);

  const useFallback = await oracle.useFallback();
  if (useFallback) {
    console.log("Fallback already active — nothing to do.");
    return;
  }

  console.log("Activating fallback on PythOracle at", PYTH_ORACLE_ADDRESS, "...");
  const tx = await oracle.activateFallback("ETH/USD feed not available on Monad Testnet");
  const receipt = await tx.wait();
  console.log("Done. tx:", receipt.hash);
  console.log("Oracle will now return fallbackEthPrice ($2000) for all price queries.");
}

main().catch((e) => { console.error(e); process.exit(1); });

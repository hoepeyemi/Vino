const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;
  console.log(`Deploying vino on ${network} with deployer: ${deployer.address}`);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${hre.ethers.formatEther(balance)} MON`);

  // ── 1. Cleanverse CVI (sandbox mock) ─────────────────────────────────────
  console.log("\n[1/7] Deploying MockCVI (Cleanverse sandbox)...");
  const MockCVI = await hre.ethers.getContractFactory("MockCVI");
  const mockCVI = await MockCVI.deploy();
  await mockCVI.waitForDeployment();
  const mockCVIAddress = await mockCVI.getAddress();
  console.log("MockCVI:", mockCVIAddress);

  // ── 2. InvoiceNFT ─────────────────────────────────────────────────────────
  console.log("\n[2/7] Deploying InvoiceNFT...");
  const InvoiceNFT = await hre.ethers.getContractFactory("src/InvoiceNFT.sol:InvoiceNFT");
  const invoiceNFT = await InvoiceNFT.deploy();
  await invoiceNFT.waitForDeployment();
  const invoiceNFTAddress = await invoiceNFT.getAddress();
  console.log("InvoiceNFT:", invoiceNFTAddress);

  // ── 3. YieldVault ─────────────────────────────────────────────────────────
  console.log("\n[3/7] Deploying YieldVault...");
  const YieldVault = await hre.ethers.getContractFactory("YieldVault");
  const yieldVault = await YieldVault.deploy(invoiceNFTAddress);
  await yieldVault.waitForDeployment();
  const yieldVaultAddress = await yieldVault.getAddress();
  console.log("YieldVault:", yieldVaultAddress);

  // ── 4. PrivacyRegistry ────────────────────────────────────────────────────
  console.log("\n[4/7] Deploying PrivacyRegistry...");
  const PrivacyRegistry = await hre.ethers.getContractFactory("PrivacyRegistry");
  const privacyRegistry = await PrivacyRegistry.deploy();
  await privacyRegistry.waitForDeployment();
  const privacyRegistryAddress = await privacyRegistry.getAddress();
  console.log("PrivacyRegistry:", privacyRegistryAddress);

  // ── 5. AgentRouter ────────────────────────────────────────────────────────
  console.log("\n[5/7] Deploying AgentRouter...");
  const AgentRouter = await hre.ethers.getContractFactory("AgentRouter");
  const agentRouter = await AgentRouter.deploy(invoiceNFTAddress, yieldVaultAddress);
  await agentRouter.waitForDeployment();
  const agentRouterAddress = await agentRouter.getAddress();
  console.log("AgentRouter:", agentRouterAddress);

  // ── 6. MockOracle (Pyth not on Monad testnet) ─────────────────────────────
  console.log("\n[6/7] Deploying MockOracle...");
  const MockOracle = await hre.ethers.getContractFactory("MockOracle");
  const mockOracle = await MockOracle.deploy(invoiceNFTAddress);
  await mockOracle.waitForDeployment();
  const mockOracleAddress = await mockOracle.getAddress();
  console.log("MockOracle:", mockOracleAddress);

  // ── 7. Wire contracts ─────────────────────────────────────────────────────
  console.log("\n[7/7] Wiring contracts...");

  let tx;

  tx = await invoiceNFT.setYieldVault(yieldVaultAddress);
  await tx.wait();
  console.log("  InvoiceNFT.setYieldVault ✓");

  tx = await invoiceNFT.setAgentRouter(agentRouterAddress);
  await tx.wait();
  console.log("  InvoiceNFT.setAgentRouter ✓");

  tx = await invoiceNFT.setOracle(mockOracleAddress);
  await tx.wait();
  console.log("  InvoiceNFT.setOracle ✓");

  tx = await yieldVault.setAgentRouter(agentRouterAddress);
  await tx.wait();
  console.log("  YieldVault.setAgentRouter ✓");

  // Enable CVI gating with MockCVI on both contracts
  tx = await invoiceNFT.setCVI(mockCVIAddress);
  await tx.wait();
  console.log("  InvoiceNFT.setCVI ✓");

  tx = await invoiceNFT.setCVIGateEnabled(true);
  await tx.wait();
  console.log("  InvoiceNFT.setCVIGateEnabled(true) ✓");

  tx = await yieldVault.setCVI(mockCVIAddress);
  await tx.wait();
  console.log("  YieldVault.setCVI ✓");

  tx = await yieldVault.setCVIGateEnabled(true);
  await tx.wait();
  console.log("  YieldVault.setCVIGateEnabled(true) ✓");

  // Auto-verify deployer so they can demo immediately
  tx = await mockCVI.verify(deployer.address);
  await tx.wait();
  console.log(`  MockCVI.verify(deployer) ✓  → ${deployer.address} is KYB-verified`);

  // ── Save manifest ─────────────────────────────────────────────────────────
  // Flat structure matches what the agent's readDeploymentDefaults() and
  // verify-monad-testnet.js both read from (top-level address keys).
  const manifest = {
    network,
    chainId: 10143,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    mockCVI: mockCVIAddress,
    invoiceNFT: invoiceNFTAddress,
    yieldVault: yieldVaultAddress,
    privacyRegistry: privacyRegistryAddress,
    agentRouter: agentRouterAddress,
    mockOracle: mockOracleAddress,
    cleanverse: {
      cviGateEnabled: true,
      cviContract: mockCVIAddress,
      module: "A-Pass Management (API v5.6)",
      note: "MockCVI is used on Monad testnet. On mainnet, replace with the real Cleanverse on-chain CVI once deployed on Monad mainnet.",
    },
  };

  const outPath = path.join(__dirname, "..", "deployments", "monadTestnet.json");
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
  console.log("\nManifest saved to deployments/monadTestnet.json");

  console.log("\n=== Monad Testnet Deployment Summary ===");
  console.log(`Chain ID  : 10143`);
  console.log(`Explorer  : https://testnet.monadexplorer.com`);
  console.log(`MockCVI   : ${mockCVIAddress}`);
  console.log(`InvoiceNFT: ${invoiceNFTAddress}`);
  console.log(`YieldVault: ${yieldVaultAddress}`);
  console.log(`PrivacyReg: ${privacyRegistryAddress}`);
  console.log(`AgentRouter: ${agentRouterAddress}`);
  console.log(`MockOracle: ${mockOracleAddress}`);
  console.log("\nCVI gate  : ENABLED on InvoiceNFT.mint() + YieldVault.deposit()");
  console.log("To verify a new business wallet, call:");
  console.log(`  MockCVI.verify(<wallet>)  at ${mockCVIAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

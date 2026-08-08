const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying vino contracts locally with deployer:", deployer.address);

  const InvoiceNFT = await hre.ethers.getContractFactory("InvoiceNFT");
  const YieldVault = await hre.ethers.getContractFactory("YieldVault");
  const PrivacyRegistry = await hre.ethers.getContractFactory("PrivacyRegistry");
  const AgentRouter = await hre.ethers.getContractFactory("AgentRouter");
  const MockOracle = await hre.ethers.getContractFactory("MockOracle");

  const invoiceNFT = await InvoiceNFT.deploy();
  await invoiceNFT.waitForDeployment();
  const yieldVault = await YieldVault.deploy(await invoiceNFT.getAddress());
  await yieldVault.waitForDeployment();
  const privacyRegistry = await PrivacyRegistry.deploy();
  await privacyRegistry.waitForDeployment();
  const agentRouter = await AgentRouter.deploy(await invoiceNFT.getAddress(), await yieldVault.getAddress());
  await agentRouter.waitForDeployment();
  const mockOracle = await MockOracle.deploy(await invoiceNFT.getAddress());
  await mockOracle.waitForDeployment();

  await invoiceNFT.setYieldVault(await yieldVault.getAddress());
  await invoiceNFT.setAgentRouter(await agentRouter.getAddress());
  await invoiceNFT.setOracle(await mockOracle.getAddress());
  await yieldVault.setAgentRouter(await agentRouter.getAddress());

  console.log("");
  console.log("=== Local Deployment Summary ===");
  console.log("InvoiceNFT:", await invoiceNFT.getAddress());
  console.log("YieldVault:", await yieldVault.getAddress());
  console.log("PrivacyRegistry:", await privacyRegistry.getAddress());
  console.log("AgentRouter:", await agentRouter.getAddress());
  console.log("MockOracle:", await mockOracle.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

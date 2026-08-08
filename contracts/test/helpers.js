const { ethers, network } = require("hardhat");

async function increaseTime(seconds) {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine");
}

async function getEventArgs(receipt, contract, eventName) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed && parsed.name === eventName) {
        return parsed.args;
      }
    } catch (_) {
      // Ignore logs from other contracts.
    }
  }
  throw new Error(`Event ${eventName} not found`);
}

async function deployCoreContracts() {
  const [owner, user1, user2, agent, oracle, reporter, buyer] = await ethers.getSigners();

  const InvoiceNFT = await ethers.getContractFactory("src/InvoiceNFT.sol:InvoiceNFT");
  const YieldVault = await ethers.getContractFactory("YieldVault");
  const PrivacyRegistry = await ethers.getContractFactory("PrivacyRegistry");
  const AgentRouter = await ethers.getContractFactory("AgentRouter");
  const MockOracle = await ethers.getContractFactory("MockOracle");

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
  await agentRouter.authorizeAgent(agent.address);
  await agentRouter.setDecisionCooldown(0);

  return {
    owner,
    user1,
    user2,
    agent,
    oracle,
    reporter,
    buyer,
    invoiceNFT,
    yieldVault,
    privacyRegistry,
    agentRouter,
    mockOracle,
  };
}

module.exports = {
  deployCoreContracts,
  getEventArgs,
  increaseTime,
};

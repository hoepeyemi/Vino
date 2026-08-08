const hre = require("hardhat");

async function main() {
  const agentAddress = process.env.AGENT_WALLET_ADDRESS;
  if (!agentAddress || !/^0x[0-9a-fA-F]{40}$/.test(agentAddress)) {
    throw new Error("Set AGENT_WALLET_ADDRESS=0x... (the public address derived from your AGENT_PRIVATE_KEY)");
  }

  const deployment = require("../deployments/monadTestnet.json");
  const [deployer] = await hre.ethers.getSigners();

  console.log(`Deployer : ${deployer.address}`);
  console.log(`AgentRouter: ${deployment.agentRouter}`);
  console.log(`Authorizing: ${agentAddress}`);

  const AgentRouter = await hre.ethers.getContractAt("AgentRouter", deployment.agentRouter);

  const already = await AgentRouter.isAgentAuthorized(agentAddress);
  if (already) {
    console.log("✅ Already authorized — nothing to do.");
    return;
  }

  const tx = await AgentRouter.authorizeAgent(agentAddress);
  await tx.wait();
  console.log(`✅ Authorized. Tx: ${tx.hash}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

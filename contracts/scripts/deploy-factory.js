const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying vino Factory with deployer:", deployer.address);

  const VinoFactory = await hre.ethers.getContractFactory("VinoFactory");
  const factory = await VinoFactory.deploy();
  await factory.waitForDeployment();

  const tx = await factory.deployProtocol();
  const receipt = await tx.wait();

  console.log("VinoFactory deployed at:", await factory.getAddress());
  console.log("=== vino Protocol Deployed ===");
  console.log("Deployment tx:", receipt.hash);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

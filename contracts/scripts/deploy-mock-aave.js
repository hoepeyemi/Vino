const hre = require("hardhat");
const { mergeDeploymentState } = require("./deployment-state");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account available. Set PRIVATE_KEY before deploying the mock Aave pool.");
  }

  const MockAaveV3Pool = await hre.ethers.getContractFactory("MockAaveV3Pool");
  const WrappedMON = await hre.ethers.getContractFactory("WrappedMON");
  const pool = await MockAaveV3Pool.deploy();
  await pool.waitForDeployment();

  console.log("=== Mock Aave V3 Pool ===");
  console.log("Deployer:", deployer.address);
  console.log("Pool:", await pool.getAddress());

  let asset = process.env.MOCK_AAVE_ASSET || hre.ethers.ZeroAddress;
  if (asset === hre.ethers.ZeroAddress && process.env.MOCK_AAVE_WRAP_NATIVE === "true") {
    const WrappedMON = await WrappedMON.deploy();
    await WrappedMON.waitForDeployment();
    asset = await WrappedMON.getAddress();
    console.log("WrappedMON deployed at:", asset);
  }

  if (asset !== hre.ethers.ZeroAddress) {
    const tokenName = process.env.MOCK_AAVE_ATOKEN_NAME || "Mock Aave interest bearing token";
    const tokenSymbol = process.env.MOCK_AAVE_ATOKEN_SYMBOL || "maToken";
    const liquidityRate = process.env.MOCK_AAVE_LIQUIDITY_RATE ? BigInt(process.env.MOCK_AAVE_LIQUIDITY_RATE) : 0n;

    const tx = await pool.registerAsset(asset, tokenName, tokenSymbol, liquidityRate);
    await tx.wait();

    console.log("Registered asset:", asset);
    console.log("aToken:", await pool.getAToken(asset));
    console.log("Liquidity rate:", liquidityRate.toString());

    mergeDeploymentState("hardhat", {
      mockAavePool: await pool.getAddress(),
      WrappedMON: process.env.MOCK_AAVE_WRAP_NATIVE === "true" ? asset : undefined,
      mockAaveAsset: asset,
      mockAToken: await pool.getAToken(asset),
    });
  } else {
    console.log("No asset registered. Use MOCK_AAVE_ASSET or MOCK_AAVE_WRAP_NATIVE=true.");
    mergeDeploymentState("hardhat", {
      mockAavePool: await pool.getAddress(),
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

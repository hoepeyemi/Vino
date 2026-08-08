const hre = require("hardhat");
const { mergeDeploymentState, readDeploymentState } = require("./deployment-state");

const MONAD_TESTNET_PYTH_ADDRESS = "0x98046Bd286715D3B0BC227Dd7a956b83D8978603";
const MONAD_TESTNET_NATIVE_USD_FEED = "0x4e3037c822d852d79af3ac80e35eb420ee3b870dca49f9344a38ef4773fb0585";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error(
      "No deployer account available. Set PRIVATE_KEY in contracts/.env or your shell before running deploy:monad-testnet."
    );
  }
  const pythAddress =
    process.env.PYTH ||
    (hre.network.name === "monadTestnet" ? MONAD_TESTNET_PYTH_ADDRESS : hre.ethers.ZeroAddress);
  const nativeUsdFeed =
    process.env.PYTH_NATIVE_USD_FEED ||
    process.env.MON_USD_FEED ||
    (hre.network.name === "monadTestnet" ? MONAD_TESTNET_NATIVE_USD_FEED : hre.ethers.ZeroHash);
  const deploymentState = readDeploymentState(hre.network.name);
  const aavePool = process.env.AAVE_POOL || deploymentState.mockAavePool || hre.ethers.ZeroAddress;
  const mockAaveAsset = process.env.MOCK_AAVE_ASSET || deploymentState.mockAaveAsset || hre.ethers.ZeroAddress;
  const wrapNativeMnt = process.env.MOCK_AAVE_WRAP_NATIVE === "true";

  console.log("=== vino Multichain Deployment ===");
  console.log("Deployer:", deployer.address);
  console.log("Chain ID:", hre.network.config.chainId || "unknown");
  console.log("Pyth Oracle:", pythAddress);
  if (hre.network.name === "monadTestnet" && !process.env.PYTH) {
    console.log("Pyth Oracle source: built-in Monad Testnet address");
  }
  console.log("Native USD Feed:", nativeUsdFeed);
  console.log("Aave V3 Pool:", aavePool);
  console.log("Mock Aave Asset:", mockAaveAsset);
  console.log("Wrap Native MON:", wrapNativeMnt);

  const InvoiceNFT = await hre.ethers.getContractFactory("src/InvoiceNFT.sol:InvoiceNFT");
  const YieldVault = await hre.ethers.getContractFactory("YieldVault");
  const PrivacyRegistry = await hre.ethers.getContractFactory("PrivacyRegistry");
  const AgentRouter = await hre.ethers.getContractFactory("AgentRouter");
  const PythOracle = await hre.ethers.getContractFactory("PythOracle");
  const AaveV3YieldSource = await hre.ethers.getContractFactory("AaveV3YieldSource");
  const MockAaveV3Pool = await hre.ethers.getContractFactory("MockAaveV3Pool");
  const WrappedMON = await hre.ethers.getContractFactory("WrappedMON");

  const invoiceNFT = await InvoiceNFT.deploy();
  await invoiceNFT.waitForDeployment();
  const yieldVault = await YieldVault.deploy(await invoiceNFT.getAddress());
  await yieldVault.waitForDeployment();
  const privacyRegistry = await PrivacyRegistry.deploy();
  await privacyRegistry.waitForDeployment();
  const agentRouter = await AgentRouter.deploy(await invoiceNFT.getAddress(), await yieldVault.getAddress());
  await agentRouter.waitForDeployment();

  let oracleAddress = hre.ethers.ZeroAddress;
  if (pythAddress !== hre.ethers.ZeroAddress) {
    if (nativeUsdFeed === hre.ethers.ZeroHash) {
      throw new Error("Set PYTH_NATIVE_USD_FEED (or MON_USD_FEED) before deploying PythOracle.");
    }

    const pythOracle = await PythOracle.deploy(pythAddress, nativeUsdFeed);
    await pythOracle.waitForDeployment();
    oracleAddress = await pythOracle.getAddress();
    console.log("PythOracle deployed at:", oracleAddress);
  }

  let yieldSourceAddress = hre.ethers.ZeroAddress;
  let resolvedAavePool = aavePool;
  if (resolvedAavePool === hre.ethers.ZeroAddress && hre.network.name === "monadTestnet") {
    const mockPool = await MockAaveV3Pool.deploy();
    await mockPool.waitForDeployment();
    resolvedAavePool = await mockPool.getAddress();
    console.log("MockAaveV3Pool deployed at:", resolvedAavePool);

    let assetToRegister = mockAaveAsset;
    if (assetToRegister === hre.ethers.ZeroAddress && wrapNativeMnt) {
      const WrappedMON = await WrappedMON.deploy();
      await WrappedMON.waitForDeployment();
      assetToRegister = await WrappedMON.getAddress();
      console.log("WrappedMON deployed at:", assetToRegister);
    }

    if (assetToRegister !== hre.ethers.ZeroAddress) {
      const tokenName = process.env.MOCK_AAVE_ATOKEN_NAME || "Mock Aave interest bearing token";
      const tokenSymbol = process.env.MOCK_AAVE_ATOKEN_SYMBOL || "maToken";
      const liquidityRate = process.env.MOCK_AAVE_LIQUIDITY_RATE ? BigInt(process.env.MOCK_AAVE_LIQUIDITY_RATE) : 0n;
      const registerTx = await mockPool.registerAsset(assetToRegister, tokenName, tokenSymbol, liquidityRate);
      await registerTx.wait();
      console.log("Mock Aave asset registered:", assetToRegister);
      console.log("Mock aToken:", await mockPool.getAToken(assetToRegister));

      mergeDeploymentState(hre.network.name, {
        mockAavePool: resolvedAavePool,
        WrappedMON: assetToRegister,
        mockAaveAsset: assetToRegister,
        mockAToken: await mockPool.getAToken(assetToRegister),
      });
    } else {
      console.log("Mock Aave pool deployed without an asset. Set MOCK_AAVE_ASSET or MOCK_AAVE_WRAP_NATIVE=true.");
      mergeDeploymentState(hre.network.name, {
        mockAavePool: resolvedAavePool,
      });
    }
  }

  if (resolvedAavePool !== hre.ethers.ZeroAddress) {
    const yieldSource = await AaveV3YieldSource.deploy(resolvedAavePool);
    await yieldSource.waitForDeployment();
    await yieldSource.setAuthorizedVault(await yieldVault.getAddress());
    yieldSourceAddress = await yieldSource.getAddress();
    console.log("AaveV3YieldSource deployed at:", yieldSourceAddress);
  }

  await invoiceNFT.setYieldVault(await yieldVault.getAddress());
  await invoiceNFT.setAgentRouter(await agentRouter.getAddress());
  if (oracleAddress !== hre.ethers.ZeroAddress) {
    await invoiceNFT.setOracle(oracleAddress);
  }
  await yieldVault.setAgentRouter(await agentRouter.getAddress());
  if (yieldSourceAddress !== hre.ethers.ZeroAddress) {
    await yieldVault.setYieldSource(yieldSourceAddress);
  }

  console.log("");
  console.log("=== Deployment Addresses ===");
  console.log("INVOICE_NFT:", await invoiceNFT.getAddress());
  console.log("YIELD_VAULT:", await yieldVault.getAddress());
  console.log("PRIVACY_REGISTRY:", await privacyRegistry.getAddress());
  console.log("AGENT_ROUTER:", await agentRouter.getAddress());
  console.log("PYTH_ORACLE:", oracleAddress);
  console.log("AAVE_YIELD_SOURCE:", yieldSourceAddress);

  mergeDeploymentState(hre.network.name, {
    invoiceNFT: await invoiceNFT.getAddress(),
    yieldVault: await yieldVault.getAddress(),
    privacyRegistry: await privacyRegistry.getAddress(),
    agentRouter: await agentRouter.getAddress(),
    pythOracle: oracleAddress,
    nativeUsdFeed,
    aaveYieldSource: yieldSourceAddress,
    mockAavePool: resolvedAavePool,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

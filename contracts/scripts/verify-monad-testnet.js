const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const CHAIN_ID = 10143;
const API_URL = "https://api.etherscan.io/v2/api";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = line.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(path.join(__dirname, "..", ".env"));
loadEnvFile(path.join(__dirname, "..", ".env.local"));
loadEnvFile(path.join(__dirname, "..", "..", ".env"));

const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;
if (!ETHERSCAN_API_KEY) {
  throw new Error("Set ETHERSCAN_API_KEY in contracts/.env before running verification.");
}

const deploymentPath = path.join(__dirname, "..", "deployments", "monadTestnet.json");
const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

const rpcUrls = [
  process.env.MONAD_TESTNET_RPC,
  "https://testnet-rpc.monad.xyz",
].filter(Boolean);

const provider = new ethers.JsonRpcProvider(rpcUrls[0], CHAIN_ID);
const abiCoder = ethers.AbiCoder.defaultAbiCoder();

function readArtifact(relativePath) {
  const artifactPath = path.join(__dirname, "..", "artifacts", relativePath);
  return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
}

function findBuildInfoFor(sourceName, contractName) {
  const buildInfoDir = path.join(__dirname, "..", "artifacts", "build-info");
  const files = fs.existsSync(buildInfoDir)
    ? fs.readdirSync(buildInfoDir).filter((file) => file.endsWith(".json"))
    : [];

  for (const file of files) {
    const buildInfo = JSON.parse(fs.readFileSync(path.join(buildInfoDir, file), "utf8"));
    if (buildInfo?.input && buildInfo?.output?.contracts?.[sourceName]?.[contractName]) {
      return buildInfo;
    }
  }

  throw new Error(`Could not find build-info for ${sourceName}:${contractName}`);
}

async function getLiveConstructorArgs(address, contractAbi, selectorFns) {
  const contract = new ethers.Contract(address, contractAbi, provider);
  const values = [];
  for (const fn of selectorFns) {
    values.push(await contract[fn]());
  }
  return values;
}

async function getVerificationState(address) {
  const url = new URL(API_URL);
  url.searchParams.set("chainid", String(CHAIN_ID));
  url.searchParams.set("module", "contract");
  url.searchParams.set("action", "getsourcecode");
  url.searchParams.set("address", address);
  url.searchParams.set("apikey", ETHERSCAN_API_KEY);

  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`getsourcecode request failed for ${address}: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const result = Array.isArray(payload.result) ? payload.result[0] : undefined;
  return {
    verified: Boolean(result && result.SourceCode && result.SourceCode.trim()),
    result,
    payload,
  };
}

async function submitVerification(target) {
  const artifact = readArtifact(target.artifactPath);
  const buildInfo = findBuildInfoFor(artifact.sourceName, artifact.contractName);
  const compilerVersion = buildInfo.solcLongVersion.startsWith("v")
    ? buildInfo.solcLongVersion
    : `v${buildInfo.solcLongVersion}`;
  const input = JSON.parse(JSON.stringify(buildInfo.input));
  const sourceCode = JSON.stringify(input);
  const constructorArgs = target.constructorArgs.length
    ? abiCoder.encode(target.constructorTypes, target.constructorArgs).replace(/^0x/, "")
    : "";

  const body = new URLSearchParams({
    apikey: ETHERSCAN_API_KEY,
    module: "contract",
    action: "verifysourcecode",
    chainid: String(CHAIN_ID),
    contractaddress: target.address,
    sourceCode,
    codeformat: "solidity-standard-json-input",
    contractname: `${artifact.sourceName}:${artifact.contractName}`,
    compilerversion: compilerVersion,
    optimizationUsed: buildInfo.input.settings.optimizer?.enabled ? "1" : "0",
    runs: String(buildInfo.input.settings.optimizer?.runs ?? 0),
    evmVersion: buildInfo.input.settings.evmVersion || "default",
    licenseType: "3",
    constructorArguments: constructorArgs,
  });

  const response = await fetch(`${API_URL}?chainid=${CHAIN_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new Error(`Verification request failed for ${target.name}: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const guid = payload.result;
  if (!guid || typeof guid !== "string") {
    throw new Error(`Verification submission failed for ${target.name}: ${JSON.stringify(payload)}`);
  }

  return { guid, payload };
}

async function pollVerification(guid, name, address) {
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const url = new URL(API_URL);
    url.searchParams.set("chainid", String(CHAIN_ID));
    url.searchParams.set("module", "contract");
    url.searchParams.set("action", "checkverifystatus");
    url.searchParams.set("guid", guid);
    url.searchParams.set("apikey", ETHERSCAN_API_KEY);

    const response = await fetch(url, { method: "GET" });
    if (!response.ok) {
      if (response.status === 403 && address) {
        const state = await getVerificationState(address);
        if (state.verified) {
          return { ok: true, result: "Verified via source lookup fallback", payload: state.payload };
        }
        continue;
      }
      throw new Error(`Status check failed for ${name}: HTTP ${response.status}`);
    }

    const payload = await response.json();
    const status = String(payload.status ?? "");
    const result = String(payload.result ?? "");

    if (status === "1") return { ok: true, result, payload };
    if (/already verified/i.test(result)) return { ok: true, result, payload };
    if (/pending/i.test(result) || /queue/i.test(result)) continue;
    if (status === "0" && result && !/pending/i.test(result)) return { ok: false, result, payload };
  }

  return { ok: false, result: "Timed out waiting for verification status", payload: null };
}

async function verifyContract(target) {
  if (!target.address || target.address === ethers.ZeroAddress) {
    return { name: target.name, status: "skipped", reason: "No address configured" };
  }

  const code = await provider.getCode(target.address);
  if (code === "0x") {
    return { name: target.name, status: "skipped", reason: "No contract code at address" };
  }

  const currentState = await getVerificationState(target.address);
  if (currentState.verified) {
    return { name: target.name, status: "already-verified" };
  }

  const { guid } = await submitVerification(target);
  const finalState = await pollVerification(guid, target.name, target.address);
  if (!finalState.ok) {
    throw new Error(`${target.name} verification failed: ${finalState.result}`);
  }

  return { name: target.name, status: "verified", guid, result: finalState.result };
}

async function main() {
  const contracts = deployment;

  const yieldVaultAbi = ["function invoiceNFT() view returns (address)"];
  const agentRouterAbi = [
    "function invoiceNFT() view returns (address)",
    "function yieldVault() view returns (address)",
  ];
  const mockOracleAbi = ["function invoiceNFT() view returns (address)"];

  const targets = [
    {
      name: "MockCVI",
      address: contracts.mockCVI,
      artifactPath: path.join("src", "mocks", "MockCVI.sol", "MockCVI.json"),
      constructorArgs: [],
      constructorTypes: [],
    },
    {
      name: "InvoiceNFT",
      address: contracts.invoiceNFT,
      artifactPath: path.join("src", "InvoiceNFT.sol", "InvoiceNFT.json"),
      constructorArgs: [],
      constructorTypes: [],
    },
    {
      name: "YieldVault",
      address: contracts.yieldVault,
      artifactPath: path.join("src", "YieldVault.sol", "YieldVault.json"),
      constructorArgs: await getLiveConstructorArgs(contracts.yieldVault, yieldVaultAbi, ["invoiceNFT"]),
      constructorTypes: ["address"],
    },
    {
      name: "PrivacyRegistry",
      address: contracts.privacyRegistry,
      artifactPath: path.join("src", "PrivacyRegistry.sol", "PrivacyRegistry.json"),
      constructorArgs: [],
      constructorTypes: [],
    },
    {
      name: "AgentRouter",
      address: contracts.agentRouter,
      artifactPath: path.join("src", "AgentRouter.sol", "AgentRouter.json"),
      constructorArgs: await getLiveConstructorArgs(contracts.agentRouter, agentRouterAbi, ["invoiceNFT", "yieldVault"]),
      constructorTypes: ["address", "address"],
    },
    {
      name: "MockOracle",
      address: contracts.mockOracle,
      artifactPath: path.join("src", "MockOracle.sol", "MockOracle.json"),
      constructorArgs: await getLiveConstructorArgs(contracts.mockOracle, mockOracleAbi, ["invoiceNFT"]),
      constructorTypes: ["address"],
    },
  ];

  console.log("=== Monad Testnet Verification ===");
  console.log("Chain ID:", CHAIN_ID);
  console.log("RPC:", rpcUrls[0]);
  console.log("Explorer:", "https://testnet.monadexplorer.com");

  const results = [];
  for (const target of targets) {
    try {
      const result = await verifyContract(target);
      results.push(result);
      if (result.status === "verified") {
        console.log(`✓ ${target.name} verified`);
      } else if (result.status === "already-verified") {
        console.log(`↺ ${target.name} already verified`);
      } else {
        console.log(`- ${target.name} skipped: ${result.reason}`);
      }
    } catch (error) {
      results.push({ name: target.name, status: "failed", reason: error.message });
      console.error(`✗ ${target.name} failed: ${error.message}`);
    }
  }

  const failed = results.filter((item) => item.status === "failed");
  if (failed.length > 0) {
    process.exitCode = 1;
    console.error("\nSome contracts failed verification:");
    for (const item of failed) {
      console.error(`- ${item.name}: ${item.reason}`);
    }
    return;
  }

  console.log("\nVerification pass complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

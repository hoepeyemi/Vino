# vino Contracts

Hardhat workspace for the vino protocol contracts on Monad Testnet.

## What is deployed

The live deployment is on Monad Testnet and the deployed addresses are recorded in:

- [`contracts/deployments/monadTestnet.json`](C:/Users/jwavo/vino/contracts/deployments/monadTestnet.json)

## Deployed contracts

Chain ID: `10143`

| Contract | Address | Explorer status |
| --- | --- | --- |
| MockCVI | `0x98DbA1d179b013342C2f63Ef551Cf72de4bb64e3` | Verified |
| InvoiceNFT | `0x827f01e7c3111cbB7b690E12B365eC0E14b144f6` | Verified |
| YieldVault | `0xd4DE5d9DC3fFd4c728dE13aaE57C74628cd441b5` | Verified |
| AgentRouter | `0x410494FC48f1cC24904fC3cc57F608ba498b12EA` | Verified |
| PrivacyRegistry | `0x6872DC335eDF9A1525b005c38820641AdF78d9A1` | Verified |
| MockOracle | `0x70231d59379687CaBab203b99481baC7300a19ca` | Verified |

Explorer:
- [Monad Testnet Explorer](https://testnet.monadexplorer.com)

## Contract overview

- `MockCVI` - Cleanverse KYB gate sandbox (auto-verifies deployer; owner calls `verify(address)` to onboard wallets)
- `InvoiceNFT` - invoice tokenization and privacy commitments; `mint()` gated by CVI
- `YieldVault` - deposit and yield management; `deposit()` gated by CVI
- `AgentRouter` - records and executes AI-driven strategy decisions
- `PrivacyRegistry` - selective disclosure registry
- `MockOracle` - price and risk feeds (Monad testnet does not have Pyth)

## Setup

```bash
cd contracts
npm install
npm run build
npm test
```

## Deployment

### Monad Testnet

```bash
npm run deploy:monad --prefix contracts
```

This deploys all 6 contracts, wires them together, enables the CVI gate, and writes the manifest to `deployments/monadTestnet.json`.

### Local network

```bash
npm run deploy:local
```

## Verification

```bash
npm run verify:monad-testnet
```

Required environment variable:

```bash
ETHERSCAN_API_KEY=your_api_key_here
```

The verifier checks: `MockCVI`, `InvoiceNFT`, `YieldVault`, `AgentRouter`, `PrivacyRegistry`, `MockOracle`.

## Architecture

```text
MockCVI ──► InvoiceNFT ──► YieldVault ──► AgentRouter
                 |               |
           PrivacyRegistry   MockOracle
```

## Notes

- The deployment manifest is the canonical source of truth for the app and agent.
- If you redeploy any contract, update the deployment manifest and the frontend/agent env values together.
- After redeployment, call `AgentRouter.authorizeAgent(<agentWalletAddress>)` from the deployer wallet.

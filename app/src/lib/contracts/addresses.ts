// Contract addresses for vino - Multichain
import { isAddress } from 'viem'

export const CHAIN_IDS = {
  ETHEREUM: 1,
  BSC: 56,
  POLYGON: 137,
  BASE: 8453,
  ARBITRUM: 42161,
  MONAD_TESTNET: 10143,
  SKALE: 2046399126,
  // Other testnets
  SEPOLIA: 11155111,
  BSC_TESTNET: 97,
  POLYGON_AMOY: 80002,
  ARBITRUM_SEPOLIA: 421614,
  SKALE_TESTNET: 1444673419,
  // Local
  LOCAL: 31337,
} as const

type ChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS]

export type ContractAddresses = {
  invoiceNFT: `0x${string}`
  yieldVault: `0x${string}`
  agentRouter: `0x${string}`
  privacyRegistry: `0x${string}`
  pythOracle: `0x${string}`
  aaveYieldSource: `0x${string}`
}

const ZERO = "0x0000000000000000000000000000000000000000" as `0x${string}`

// Block number at or before the first contract deployment on each chain.
// Used as fromBlock floor in eth_getLogs calls to avoid scanning the entire
// chain history (public RPCs cap ranges at 10,000 blocks per request).
export const CONTRACT_DEPLOY_BLOCKS: Partial<Record<ChainId, bigint>> = {
  [CHAIN_IDS.MONAD_TESTNET]: BigInt(
    process.env.NEXT_PUBLIC_DEPLOY_BLOCK || "0"
  ),
  [CHAIN_IDS.LOCAL]: BigInt(0),
}

const emptyAddresses: ContractAddresses = {
  invoiceNFT: ZERO,
  yieldVault: ZERO,
  agentRouter: ZERO,
  privacyRegistry: ZERO,
  pythOracle: ZERO,
  aaveYieldSource: ZERO,
}

// Contract addresses per chain - set via env vars after deployment
const addresses: Partial<Record<ChainId, ContractAddresses>> = {
  // Monad Testnet — set NEXT_PUBLIC_*_ADDRESS env vars after running `npm run deploy:monad`
  [CHAIN_IDS.MONAD_TESTNET]: {
    invoiceNFT: (process.env.NEXT_PUBLIC_INVOICE_NFT_ADDRESS || ZERO) as `0x${string}`,
    yieldVault: (process.env.NEXT_PUBLIC_YIELD_VAULT_ADDRESS || ZERO) as `0x${string}`,
    agentRouter: (process.env.NEXT_PUBLIC_AGENT_ROUTER_ADDRESS || ZERO) as `0x${string}`,
    privacyRegistry: (process.env.NEXT_PUBLIC_PRIVACY_REGISTRY_ADDRESS || ZERO) as `0x${string}`,
    pythOracle: ZERO,
    aaveYieldSource: ZERO,
  },
  [CHAIN_IDS.ARBITRUM_SEPOLIA]: { ...emptyAddresses },
  [CHAIN_IDS.POLYGON_AMOY]: { ...emptyAddresses },
  [CHAIN_IDS.SEPOLIA]: { ...emptyAddresses },

  // Mainnets - will be populated after testnet verification
  [CHAIN_IDS.ETHEREUM]: { ...emptyAddresses },
  [CHAIN_IDS.BSC]: { ...emptyAddresses },
  [CHAIN_IDS.BASE]: { ...emptyAddresses },
  [CHAIN_IDS.ARBITRUM]: { ...emptyAddresses },
  [CHAIN_IDS.POLYGON]: { ...emptyAddresses },
  [CHAIN_IDS.SKALE]: { ...emptyAddresses, pythOracle: ZERO, aaveYieldSource: ZERO },

  // Local development (Anvil)
  [CHAIN_IDS.LOCAL]: {
    invoiceNFT: (process.env.NEXT_PUBLIC_INVOICE_NFT_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3") as `0x${string}`,
    yieldVault: (process.env.NEXT_PUBLIC_YIELD_VAULT_ADDRESS || "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512") as `0x${string}`,
    agentRouter: (process.env.NEXT_PUBLIC_AGENT_ROUTER_ADDRESS || "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9") as `0x${string}`,
    privacyRegistry: (process.env.NEXT_PUBLIC_PRIVACY_REGISTRY_ADDRESS || "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0") as `0x${string}`,
    pythOracle: ZERO,
    aaveYieldSource: ZERO,
  },
}

// Chain metadata for UI
export type ChainMeta = {
  name: string
  shortName: string
  hasAave: boolean
  hasPyth: boolean
  gasLabel: string
  explorerUrl: string
  nativeCurrency: string
}

export const CHAIN_META: Partial<Record<ChainId, ChainMeta>> = {
  [CHAIN_IDS.ETHEREUM]: {
    name: "Ethereum", shortName: "ETH", hasAave: true, hasPyth: true,
    gasLabel: "~$2-10", explorerUrl: "https://etherscan.io", nativeCurrency: "ETH",
  },
  [CHAIN_IDS.BSC]: {
    name: "BNB Chain", shortName: "BSC", hasAave: true, hasPyth: true,
    gasLabel: "~$0.05", explorerUrl: "https://bscscan.com", nativeCurrency: "BNB",
  },
  [CHAIN_IDS.BASE]: {
    name: "Base", shortName: "BASE", hasAave: true, hasPyth: true,
    gasLabel: "~$0.01", explorerUrl: "https://basescan.org", nativeCurrency: "ETH",
  },
  [CHAIN_IDS.ARBITRUM]: {
    name: "Arbitrum", shortName: "ARB", hasAave: true, hasPyth: true,
    gasLabel: "~$0.01", explorerUrl: "https://arbiscan.io", nativeCurrency: "ETH",
  },
  [CHAIN_IDS.POLYGON]: {
    name: "Polygon", shortName: "MATIC", hasAave: true, hasPyth: true,
    gasLabel: "~$0.01", explorerUrl: "https://polygonscan.com", nativeCurrency: "POL",
  },
  [CHAIN_IDS.SKALE]: {
    name: "SKALE Europa", shortName: "SKALE", hasAave: false, hasPyth: false,
    gasLabel: "FREE", explorerUrl: "https://elated-tan-skat.explorer.mainnet.skalenodes.com", nativeCurrency: "sFUEL",
  },
  // Testnets
  [CHAIN_IDS.SEPOLIA]: {
    name: "Sepolia", shortName: "SEP", hasAave: true, hasPyth: true,
    gasLabel: "~$0", explorerUrl: "https://sepolia.etherscan.io", nativeCurrency: "ETH",
  },
  [CHAIN_IDS.MONAD_TESTNET]: {
    name: "Monad Testnet", shortName: "MON-T", hasAave: false, hasPyth: false,
    gasLabel: "~$0", explorerUrl: "https://testnet.monadexplorer.com", nativeCurrency: "MON",
  },
  [CHAIN_IDS.ARBITRUM_SEPOLIA]: {
    name: "Arbitrum Sepolia", shortName: "A-SEP", hasAave: true, hasPyth: true,
    gasLabel: "~$0", explorerUrl: "https://sepolia.arbiscan.io", nativeCurrency: "ETH",
  },
  [CHAIN_IDS.POLYGON_AMOY]: {
    name: "Polygon Amoy", shortName: "P-AMOY", hasAave: true, hasPyth: true,
    gasLabel: "~$0", explorerUrl: "https://amoy.polygonscan.com", nativeCurrency: "POL",
  },
}

export const SUPPORTED_MAINNET_CHAINS = [
  CHAIN_IDS.ETHEREUM, CHAIN_IDS.BSC, CHAIN_IDS.BASE,
  CHAIN_IDS.ARBITRUM, CHAIN_IDS.POLYGON, CHAIN_IDS.SKALE,
] as const

export const SUPPORTED_TESTNET_CHAINS = [
  CHAIN_IDS.MONAD_TESTNET,
] as const

export function getContractAddresses(chainId: number): ContractAddresses {
  return addresses[chainId as ChainId] || emptyAddresses
}

export function getInvoiceNFTAddress(chainId: number): `0x${string}` {
  return getContractAddresses(chainId).invoiceNFT
}

export function getYieldVaultAddress(chainId: number): `0x${string}` {
  return getContractAddresses(chainId).yieldVault
}

export function getAgentRouterAddress(chainId: number): `0x${string}` {
  return getContractAddresses(chainId).agentRouter
}

export function areContractsDeployed(chainId: number): boolean {
  const addrs = getContractAddresses(chainId)
  return addrs.invoiceNFT !== ZERO && addrs.yieldVault !== ZERO && addrs.agentRouter !== ZERO
}

export function getChainMeta(chainId: number): ChainMeta | undefined {
  return CHAIN_META[chainId as ChainId]
}

/** Default MockCVI deployment on Monad Testnet. */
const DEFAULT_MOCK_CVI_ADDRESS = '0x98DbA1d179b013342C2f63Ef551Cf72de4bb64e3' as `0x${string}`

/**
 * Returns the MockCVI contract address for the connected chain.
 * - Monad Testnet / Local: reads NEXT_PUBLIC_MOCK_CVI_ADDRESS, falls back to the
 *   hardcoded default deployment.
 * - All other chains: returns the zero address (MockCVI is not deployed there).
 *
 * Safe to call in client components — reads only NEXT_PUBLIC_* env vars.
 */
export function getMockCVIAddress(chainId?: number): `0x${string}` {
  if (
    chainId !== undefined &&
    chainId !== CHAIN_IDS.MONAD_TESTNET &&
    chainId !== CHAIN_IDS.LOCAL
  ) {
    return ZERO
  }
  return (process.env.NEXT_PUBLIC_MOCK_CVI_ADDRESS || DEFAULT_MOCK_CVI_ADDRESS) as `0x${string}`
}

export function isValidContractAddress(address: string): boolean {
  if (!address) return false
  if (address === ZERO) return false
  return isAddress(address)
}

export function validateContractAddresses(chainId: number): { valid: boolean; errors: string[] } {
  const addrs = getContractAddresses(chainId)
  const errors: string[] = []

  if (!isValidContractAddress(addrs.invoiceNFT)) errors.push(`InvoiceNFT address is invalid: ${addrs.invoiceNFT}`)
  if (!isValidContractAddress(addrs.yieldVault)) errors.push(`YieldVault address is invalid: ${addrs.yieldVault}`)
  if (!isValidContractAddress(addrs.agentRouter)) errors.push(`AgentRouter address is invalid: ${addrs.agentRouter}`)

  return { valid: errors.length === 0, errors }
}

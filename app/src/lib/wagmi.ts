import { http, createConfig } from 'wagmi';
import {
  mainnet,
  base,
  arbitrum,
  polygon,
  bsc,
} from 'wagmi/chains';
import { defineChain } from 'viem';
import { injected, walletConnect } from '@wagmi/connectors';
import { createMonadTestnetTransport } from './monad-rpc';

export {
  getContractAddresses,
  getInvoiceNFTAddress,
  getYieldVaultAddress,
  getAgentRouterAddress,
  areContractsDeployed,
  getChainMeta,
  CHAIN_IDS,
  SUPPORTED_MAINNET_CHAINS,
  SUPPORTED_TESTNET_CHAINS,
} from './contracts/addresses';

export type { ContractAddresses, ChainMeta } from './contracts/addresses';

// Local Anvil chain
export const anvil = defineChain({
  id: 31337,
  name: 'Anvil Local',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
});

// SKALE Europa Hub
export const skaleEuropa = defineChain({
  id: 2046399126,
  name: 'SKALE Europa',
  nativeCurrency: { name: 'sFUEL', symbol: 'sFUEL', decimals: 18 },
  rpcUrls: { default: { http: ['https://mainnet.skalenodes.com/v1/elated-tan-skat'] } },
  blockExplorers: {
    default: {
      name: 'SKALE Explorer',
      url: 'https://elated-tan-skat.explorer.mainnet.skalenodes.com',
    },
  },
});

export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.monad.xyz'] },
    public: { http: ['https://testnet-rpc.monad.xyz'] },
  },
  blockExplorers: {
    default: {
      name: 'Monad Explorer',
      url: 'https://testnet.monadexplorer.com',
    },
  },
  contracts: {
    // Multicall3 canonical address — check Monad docs if this needs updating after mainnet.
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
    },
  },
});

const isTestnet = process.env.NEXT_PUBLIC_NETWORK_MODE !== 'mainnet';

// Mainnet chains
const mainnetChains = [mainnet, bsc, base, arbitrum, polygon, skaleEuropa] as const;
// Testnet chains
const testnetChains = [monadTestnet] as const;
// Dev chain
const devChains = [anvil] as const;

const isDev = process.env.NODE_ENV === 'development';

export const config = createConfig({
  // Required for Next.js App Router: prevents wagmi from synchronously
  // rehydrating from localStorage on the first client render. Without this,
  // useChainId()/useAccount() return restored values that differ from the
  // server's initial render, causing React 19 hydration error #418.
  ssr: true,
  chains: [
    ...(isTestnet ? testnetChains : mainnetChains),
    ...(isDev ? devChains : []),
  ],
  pollingInterval: 12_000,
  batch: { multicall: true },
  connectors: [
    injected({ shimDisconnect: true }),
    walletConnect({
      projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '',
      showQrModal: true,
    }),
  ],
  transports: {
    // Mainnets
    [mainnet.id]: http(process.env.NEXT_PUBLIC_ETH_RPC || undefined),
    [bsc.id]: http(process.env.NEXT_PUBLIC_BSC_RPC || 'https://bsc-dataseed.binance.org'),
    [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC || undefined),
    [arbitrum.id]: http(process.env.NEXT_PUBLIC_ARBITRUM_RPC || undefined),
    [polygon.id]: http(process.env.NEXT_PUBLIC_POLYGON_RPC || undefined),
    [skaleEuropa.id]: http('https://mainnet.skalenodes.com/v1/elated-tan-skat'),
    // Testnet
    [monadTestnet.id]: createMonadTestnetTransport(),
    // Local
    [anvil.id]: http('http://127.0.0.1:8545'),
  },
});

// WebSocket URL for agent
export const AGENT_WS_URL = process.env.NEXT_PUBLIC_AGENT_WS_URL || 'wss://agent.eduworld.world';

// Get all supported chain IDs based on network mode
export const SUPPORTED_CHAINS = isTestnet
  ? testnetChains.map(c => c.id)
  : mainnetChains.map(c => c.id);

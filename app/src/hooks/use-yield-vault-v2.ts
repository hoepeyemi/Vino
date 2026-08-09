/**
 * Yield Vault Hook - TanStack Query Version
 *
 * Migrated from direct wagmi hooks to TanStack Query for:
 * - Better caching and automatic refetching
 * - Optimistic updates
 * - Centralized cache invalidation
 * - Reduced RPC calls
 */

import { formatUnits } from 'viem';
import {
  useVaultTVL,
  useActiveDepositsCount,
  useConservativeAPY,
  useAggressiveAPY,
  useVaultDeposit,
  useAccruedYield,
} from '@/features/vault/api/vaultQueries';

export function useYieldVault() {
  const { data: tvlRaw, isLoading: isLoadingTVL } = useVaultTVL();
  const { data: activeCountRaw, isLoading: isLoadingCount } = useActiveDepositsCount();
  const { data: conservativeAPY = 0, isLoading: isLoadingConservative } = useConservativeAPY();
  const { data: aggressiveAPY = 0, isLoading: isLoadingAggressive } = useAggressiveAPY();

  // Format values
  const tvl = tvlRaw ? formatUnits(tvlRaw, 18) : '0';
  const activeDepositsCount = activeCountRaw ? Number(activeCountRaw) : 0;

  // Estimate 30-day cumulative yield: TVL × conservativeAPY × (30/365)
  // In production this would aggregate getAccruedYield() across all active deposits;
  // for testnet the on-chain accrual period is short so this estimate is appropriate.
  const avgAPY = conservativeAPY > 0 ? conservativeAPY : (aggressiveAPY > 0 ? aggressiveAPY : 4.5)
  const totalYield = (Number(tvl) * (avgAPY / 100) * (30 / 365)).toFixed(4)

  return {
    tvl,
    totalYield,
    activeDepositsCount,
    conservativeAPY,
    aggressiveAPY,
    isLoading: isLoadingTVL || isLoadingCount || isLoadingConservative || isLoadingAggressive,
  };
}

/**
 * Hook for a specific deposit's data
 */
export function useDeposit(tokenId?: bigint) {
  const { data: deposit, isLoading: isLoadingDeposit } = useVaultDeposit(tokenId);
  const { data: accruedYieldRaw, isLoading: isLoadingYield } = useAccruedYield(tokenId);

  return {
    deposit,
    accruedYield: accruedYieldRaw ? formatUnits(accruedYieldRaw, 18) : '0',
    isLoading: isLoadingDeposit || isLoadingYield,
  };
}

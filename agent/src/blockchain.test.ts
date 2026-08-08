import { describe, it, expect, beforeEach } from 'vitest';
import { BlockchainService } from './blockchain.js';
import { MarketConditions } from './types.js';

// Use a non-routable address so the provider is constructed but never contacted
const DUMMY_RPC = 'http://192.0.2.1:8545';
const DUMMY_ADDRESSES = {
  invoiceNFT: '0x1111111111111111111111111111111111111111',
  yieldVault: '0x2222222222222222222222222222222222222222',
  agentRouter: '0x3333333333333333333333333333333333333333',
};

function makeService() {
  return new BlockchainService(DUMMY_RPC, DUMMY_ADDRESSES);
}

function conditions(priceChange4h: number, volatilityLevel: MarketConditions['volatilityLevel'] = 'low'): MarketConditions {
  return { ethPrice: 2000, nativePrice: null, priceChange4h, volatilityLevel, lastUpdated: Date.now() };
}

describe('BlockchainService.checkMarketAlert', () => {
  let service: BlockchainService;
  beforeEach(() => { service = makeService(); });

  it('returns null for price change below ±3%', () => {
    expect(service.checkMarketAlert(conditions(0))).toBeNull();
    expect(service.checkMarketAlert(conditions(2.9))).toBeNull();
    expect(service.checkMarketAlert(conditions(-2.9))).toBeNull();
  });

  it('returns info level for -3% to -5% drop', () => {
    expect(service.checkMarketAlert(conditions(-3.5))?.level).toBe('info');
    expect(service.checkMarketAlert(conditions(-4.9))?.level).toBe('info');
  });

  it('returns warning level for -5% to -8% drop', () => {
    expect(service.checkMarketAlert(conditions(-5))?.level).toBe('warning');
    expect(service.checkMarketAlert(conditions(-7.9))?.level).toBe('warning');
  });

  it('returns critical level for drop beyond -8%', () => {
    expect(service.checkMarketAlert(conditions(-8))?.level).toBe('critical');
    expect(service.checkMarketAlert(conditions(-20))?.level).toBe('critical');
  });

  it('returns info level for +5% rally', () => {
    expect(service.checkMarketAlert(conditions(5))?.level).toBe('info');
    expect(service.checkMarketAlert(conditions(10))?.level).toBe('info');
  });

  it('critical alert recommendation instructs capital protection', () => {
    const result = service.checkMarketAlert(conditions(-10));
    expect(result?.recommendation).toMatch(/HOLD/i);
  });
});

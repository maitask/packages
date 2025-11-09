import { createBinanceClient } from './binance.js';
import { createAsterClient } from './aster.js';
import { createOkxClient } from './okx.js';
import { createPaperClient } from './paper.js';

const PROVIDERS = {
    binance: createBinanceClient,
    aster: createAsterClient,
    okx: createOkxClient,
    paper: createPaperClient,
};

export function createExchangeClient(runtimeConfig) {
    const exchangeConfig = runtimeConfig.exchange || {};
    const providerKey = (exchangeConfig.provider || 'binance').toLowerCase();
    const factory = PROVIDERS[providerKey];
    if (!factory) {
        throw new Error(`Unsupported exchange provider: ${exchangeConfig.provider}`);
    }
    return factory({ ...exchangeConfig, runtime: runtimeConfig });
}

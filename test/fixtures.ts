import type { PaymentRequired } from '../src/types.js';

export const PAY_TO_EVM = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'; // an EIP-55 test vector
export const PAY_TO_SVM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'; // any valid 32-byte key
export const FEE_PAYER_SVM = 'SysvarRent111111111111111111111111111111111';
export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
export const USDC_SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/** A PaymentRequired that passes every check (Base, Ethereum and Solana at $0.01). */
export function goodPaymentRequired(url = 'https://seller.example/api/search'): PaymentRequired {
  return {
    x402Version: 2,
    error: 'PAYMENT-SIGNATURE header is required',
    resource: { url, description: 'Company search: up to 10 companies matching a query', mimeType: 'application/json' },
    accepts: [
      { scheme: 'exact', network: 'eip155:8453', amount: '10000', asset: USDC_BASE, payTo: PAY_TO_EVM, maxTimeoutSeconds: 90, extra: { name: 'USD Coin', version: '2' } },
      { scheme: 'exact', network: 'eip155:1', amount: '10000', asset: USDC_ETH, payTo: PAY_TO_EVM, maxTimeoutSeconds: 90, extra: { name: 'USD Coin', version: '2' } },
      { scheme: 'exact', network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', amount: '10000', asset: USDC_SOL, payTo: PAY_TO_SVM, maxTimeoutSeconds: 90, extra: { feePayer: FEE_PAYER_SVM } }
    ],
    extensions: {
      bazaar: {
        info: { input: { type: 'http', method: 'GET', queryParams: { q: 'fintech' } }, output: { type: 'json', example: { items: [] } } },
        schema: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          properties: {
            input: {
              type: 'object',
              properties: { type: { type: 'string', const: 'http' }, method: { type: 'string', enum: ['GET'] }, queryParams: { type: 'object' } },
              required: ['type', 'method'],
              additionalProperties: false
            },
            output: { type: 'object' }
          },
          required: ['input']
        }
      }
    }
  };
}

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');

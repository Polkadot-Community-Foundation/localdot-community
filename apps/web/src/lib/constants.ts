/**
 * Chain configuration — single source of truth for chainId / RPC / native
 * currency / explorer. When migrating to a new chain, this is the file to edit.
 */

export interface NativeCurrency {
  name: string;
  symbol: string;
  decimals: number;
}

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorer: string;
  nativeCurrency: NativeCurrency;
}

/** Supported blockchain networks. Add new entries here on migration. */
export const SUPPORTED_CHAINS = {
  SUMMIT: {
    chainId: 420420417,
    name: "Summit Asset Hub",
    // Summit has no hosted public eth-rpc endpoint. This field is stored for the
    // app's display/wrong-network badge only — contract I/O is host-routed over
    // WSS (see lib/host/networks.ts), never this URL. Run a local revive eth-rpc
    // adapter (→ wss://summit-asset-hub-rpc.polkadot.io) only if you need EVM JSON-RPC.
    rpcUrl: "",
    // Summit has no public block explorer yet; leave empty (explorer links hide).
    explorer: "",
    nativeCurrency: { name: "Summit", symbol: "SUM", decimals: 10 },
  },
} as const satisfies Record<string, ChainConfig>;

export const DEFAULT_CHAIN = SUPPORTED_CHAINS.SUMMIT;

export type SupportedChainId =
  (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS]["chainId"];

/** Get chain name from chain ID. */
export function getChainName(chainId: number | null | undefined): string {
  if (!chainId) return "Unknown";

  for (const chain of Object.values(SUPPORTED_CHAINS)) {
    if (chain.chainId === chainId) {
      return chain.name;
    }
  }
  return `Chain ${chainId}`;
}

/** True iff `chainId` is one of the configured chains. */
export function isSupportedChain(chainId: number | null | undefined): boolean {
  if (!chainId) return false;
  return Object.values(SUPPORTED_CHAINS).some((c) => c.chainId === chainId);
}

/** Full chain config by ID, or undefined if unknown. */
export function getChainConfig(chainId: number): ChainConfig | undefined {
  return Object.values(SUPPORTED_CHAINS).find((c) => c.chainId === chainId);
}

/** Default fallback currency (matches the default chain). */
export const DEFAULT_CURRENCY: NativeCurrency = DEFAULT_CHAIN.nativeCurrency;

/** Get native currency for a specific chain ID. Falls back to default. */
export function getNativeCurrency(chainId: number): NativeCurrency {
  return getChainConfig(chainId)?.nativeCurrency ?? DEFAULT_CURRENCY;
}

/**
 * Minimum native-token balance (in planck) required to submit a tx.
 * 0.1 native at the default chain's decimal places. When migrating to a chain
 * with different decimals, recompute this value accordingly.
 */
export const MIN_GAS_BALANCE_NATIVE =
  10n ** BigInt(DEFAULT_CHAIN.nativeCurrency.decimals - 1);

/**
 * Offer time-to-live, in milliseconds. Mirrors P2PMarket.OFFER_TTL (14 days)
 * and matches the Bulletin Chain listing TTL — keep these aligned so the
 * frontend never displays an offer whose metadata CID has already expired.
 */
export const OFFER_TTL_MS = 14 * 24 * 60 * 60 * 1000;

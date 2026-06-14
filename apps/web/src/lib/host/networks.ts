/**
 * Network registry — the set of chains a deployment runs against, selected at
 * build time via `VITE_NETWORK` (defaults to `summit`).
 *
 * Because connections are host-routed (`createPapiProvider` keys off the genesis
 * hash), a network's hashes MUST match the host's environment registry for the
 * same network id — otherwise the host rejects the chain ("Host doesn't support
 * it"). Keep these aligned with polkadot-desktop's `summit` entry.
 *
 * Add a network: append an entry to `NETWORKS`, then deploy with
 * `VITE_NETWORK=<key>`. Genesis hashes come from `.papi/polkadot-api.json`;
 * regenerate them with the papi sync tooling if a chain is re-genesised.
 */

import type { HexString } from "@novasamatech/host-api";

import { env } from "../../env";

export interface NetworkConfig {
  key: string;
  /** Human-readable label for diagnostics / UI. */
  displayName: string;
  /** Asset Hub (pallet-revive contracts) genesis — chain id for createPapiProvider. */
  assetHubGenesis: HexString;
  /** People chain (pallet-statement) genesis — for the statement-store connection. */
  peopleGenesis: HexString;
  /** Bulletin chain (blob storage) genesis. */
  bulletinGenesis: HexString;
}

export const NETWORKS = {
  summit: {
    key: "summit",
    displayName: "Summit Asset Hub",
    // Genesis hashes verified live against the Summit chains. These MUST match
    // the host's environment registry (polkadot-desktop's `summit` entry) or host
    // routing rejects the chain with "Host doesn't support it". Re-verify with
    // `chain_getBlockHash(0)` against each RPC if routing starts failing.
    assetHubGenesis:
      "0xf388dc6d6cdf6fb77eac3c4a91f31bc0c8642b142f1a757512ab7849f9f70660",
    peopleGenesis:
      "0xbe5238f82c3553bc57ac3be43bef110bd58c49ad0744110814985195ca7d8c4e",
    bulletinGenesis:
      "0x147aae0d60625af72300d4d5ebd5dcb869f7ac4c6c1a326be1cbb14a4a65ae77",
  },
} satisfies Record<string, NetworkConfig>;

export type NetworkKey = keyof typeof NETWORKS;
export const DEFAULT_NETWORK: NetworkKey = "summit";

/**
 * The active network for this build. `VITE_NETWORK` selects it; an unknown key
 * throws at module load so a misconfigured deploy fails loudly at boot rather
 * than silently running against the default chain.
 */
function resolveActiveNetwork(): NetworkConfig {
  const key = env.VITE_NETWORK ?? DEFAULT_NETWORK;
  if (key in NETWORKS) {
    return NETWORKS[key as NetworkKey];
  }
  throw new Error(
    `Unknown VITE_NETWORK "${key}". Known networks: ${Object.keys(NETWORKS).join(", ")}`,
  );
}

export const activeNetwork: NetworkConfig = resolveActiveNetwork();

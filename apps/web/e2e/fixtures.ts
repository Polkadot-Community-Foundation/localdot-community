import { test as base, expect } from "@playwright/test";
import {
  createTestHostFixture,
  type ChainConfig,
  type HexString,
  type TestHost,
} from "@parity/host-api-test-sdk/playwright";

const PRODUCT_URL = "http://localhost:5199";

// The mock host routes chain connections by genesis hash, so the fixture's chain
// MUST carry the SAME genesis the app requests (activeNetwork.assetHubGenesis in
// apps/web/src/lib/host/networks.ts) — otherwise host routing rejects it with
// "Host doesn't support it". The test SDK does not bundle a Summit chain, so we
// declare the Summit chain inline here.
const SUMMIT_ASSET_HUB: ChainConfig = {
  id: "summit-asset-hub",
  name: "Summit Asset Hub",
  genesisHash:
    "0xf388dc6d6cdf6fb77eac3c4a91f31bc0c8642b142f1a757512ab7849f9f70660" as HexString,
  rpcUrl: "wss://summit-asset-hub-rpc.polkadot.io",
  tokenSymbol: "SUM",
  tokenDecimals: 10,
};

// LocalDOT derives its DotNS identifier from `window.location.host`, so under
// Playwright the product account key is `localhost:5199/0`. We also map the
// canonical `.dot` identifier so the same Bob signer is used regardless of
// which host name the iframe loads under.
const bobFixture = createTestHostFixture({
  productUrl: PRODUCT_URL,
  accounts: ["bob"],
  chain: SUMMIT_ASSET_HUB,
  productAccounts: {
    "localmarket.dot/0": "bob",
    "localhost:5199/0": "bob",
  },
});

// The landing page auto-opens a fullscreen "Set location" modal when no
// location is saved in localStorage. The modal sits at z-[2000] and blocks
// every click on the rest of the UI. We use `context.addInitScript` so the
// seed runs in the iframe's origin before any product script — including
// LocationContext's storage read.
const SEEDED_LOCATION = {
  lat: 52.52,
  lon: 13.405,
  city: "Berlin",
  country: "Germany",
};

const test = base.extend<{ testHost: TestHost }>(bobFixture).extend({
  page: async ({ page }, use) => {
    await page.context().addInitScript((loc) => {
      try {
        localStorage.setItem("localdot_user_location", JSON.stringify(loc));
      } catch {
        /* iframes from sandboxed/cross-origin contexts may throw — fine */
      }
    }, SEEDED_LOCATION);
    await use(page);
  },
});

export { test, expect };

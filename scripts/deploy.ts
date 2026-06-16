/**
 * Interactive, (almost) no-skill deploy for LocalDOT.
 *
 * One command takes an operator from nothing to a live .dot product:
 *   1. generate a fresh wallet or paste an existing 12/24-word mnemonic,
 *   2. fund the printed address (faucet link, then press Enter),
 *   3. compile + deploy the P2PMarket contract (PAPI / pallet-revive),
 *   4. build the web app (Vite static export), and
 *   5. publish it to a .dot domain via polkadot-app-deploy.
 *
 * A single Substrate mnemonic is used end-to-end: it signs the contract
 * instantiate (PAPI) and is handed to polkadot-app-deploy via the MNEMONIC env var
 * for the publish. The mnemonic only ever lives in memory — it is never written
 * to disk. The contract deploy writes the resulting H160 + chain into
 * apps/web/.env.local (gitignored) so the static build inlines them.
 *
 * Usage:  pnpm run deploy    (from the repo root)
 *         (`pnpm deploy` won't work — `deploy` is a reserved pnpm command.)
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { cryptoWaitReady, mnemonicGenerate } from "@polkadot/util-crypto";

import {
  deployerFromSeed,
  deployP2PMarket,
  deriveAccount,
  fetchBalance,
  NETWORK,
} from "./deploy-p2pmarket";
import * as ui from "./lib/style";

const REPO_ROOT = resolve(__dirname, "..");
const WEB_DIST = resolve(REPO_ROOT, "apps/web/dist");
const RESOLC_BIN = resolve(REPO_ROOT, "packages/contracts/bin/resolc");
const ARTIFACT = resolve(
  REPO_ROOT,
  "packages/contracts/artifacts/contracts/P2PMarket.sol/P2PMarket.json",
);

// polkadot-app-deploy --env id for the Summit Bulletin chain.
const BULLETIN_ENV = "summit";
// There is no default domain — the operator must choose a label at the prompt.
// The DotNS naming policy that governs which labels are registrable is documented
// (and surfaced to the operator) at the Domain prompt below; it assumes a NoStatus
// signer (no personhood), the common case — only such names are open to any caller.
const GATEWAY_BASE = process.env.DOTNS_GATEWAY_BASE ?? "dot.li";
// Funding floor checked before spending. The deploy pays the contract's code +
// storage deposit and the .dot registration; the dry-run computes the exact
// contract cost, this is just a pre-flight gate. SUM has 10 decimals.
const MIN_FUNDING_SUM = 20;
// The scoped publish CLI. polkadot-app-deploy@0.11.0 carries the `summit` env
// (Summit Asset Hub / Bulletin / RPCs + the summit-ipfs gateway) and the manifest
// direct-signer fix; the unscoped legacy `polkadot-app-deploy` does not ship `summit`.
const PUBLISH_PACKAGE = "@polkadot-community-foundation/polkadot-app-deploy";
const PUBLISH_BIN = "polkadot-app-deploy";
// Pin a floor: the `summit` env is only available from 0.10.1. Below this we fetch
// a known-good build via npx instead.
const MIN_PUBLISH_VERSION = "0.10.1";
// polkadot-app-deploy stores a paired mobile (QR `login`) session here; it prefers
// it over the MNEMONIC we pass, so we detect it before publishing.
const SSO_SESSION_FILE = resolve(homedir(), ".polkadot-apps", "dot-cli_SsoSessions.json");

function normalizeMnemonic(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function assertWordCount(mnemonic: string): void {
  const words = mnemonic.split(" ").filter(Boolean).length;
  if (words !== 12 && words !== 24) {
    throw new Error(`Mnemonic has ${words} words; expected 12 or 24. Re-check the phrase.`);
  }
}

function parseSemver(value: string): [number, number, number] | null {
  const m = value.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function versionGte(current: string, minimum: string): boolean {
  const a = parseSemver(current);
  const b = parseSemver(minimum);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

/** Probe the installed polkadot-app-deploy. Returns its version string, or null if it isn't on PATH. */
function probePublishVersion(): string | null {
  const probe = spawnSync(PUBLISH_BIN, ["--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) return null;
  // The CLI banner is e.g. `polkadot-app-deploy vX.Y.Z`; parseSemver extracts the X.Y.Z.
  return `${probe.stdout ?? ""}${probe.stderr ?? ""}`.trim();
}

function isUsableVersion(version: string | null): version is string {
  return !!version && !!parseSemver(version) && versionGte(version, MIN_PUBLISH_VERSION);
}

/**
 * Ensure a recent polkadot-app-deploy is available. If a good one is already on
 * the machine, use it. If it's missing or too old, install the pinned version
 * globally (`npm i -g @polkadot-community-foundation/polkadot-app-deploy@0.11.0`)
 * so this and future deploys reuse it. The floor guarantees the `summit` env is
 * present. Only if a global install isn't possible (e.g. no write access to the
 * global prefix) do we fall back to a throwaway `npx` fetch. Returns the argv
 * prefix to spawn.
 */
function resolvePublishCommand(): string[] {
  const installed = probePublishVersion();
  if (isUsableVersion(installed)) {
    ui.success(`${installed} (installed)`);
    return [PUBLISH_BIN];
  }

  if (installed) {
    ui.warn(`${installed} is older than ${MIN_PUBLISH_VERSION} — installing ${MIN_PUBLISH_VERSION} globally…`);
  } else {
    ui.info(`${PUBLISH_BIN} not found — installing ${MIN_PUBLISH_VERSION} globally (npm i -g)…`);
  }

  const install = spawnSync("npm", ["install", "-g", `${PUBLISH_PACKAGE}@${MIN_PUBLISH_VERSION}`], { stdio: "inherit" });
  if (install.status === 0) {
    const after = probePublishVersion();
    if (isUsableVersion(after)) {
      ui.success(`${after} (installed)`);
      return [PUBLISH_BIN];
    }
    ui.warn(`Global install completed but ${PUBLISH_BIN} still isn't usable — falling back to npx.`);
  } else {
    ui.warn("Global install failed (npm i -g) — falling back to npx for this run.");
  }
  return ["npx", "-y", `${PUBLISH_PACKAGE}@${MIN_PUBLISH_VERSION}`];
}

async function resolveWallet(rl: Interface): Promise<string> {
  ui.section("Wallet");
  ui.choice(1, "Generate a new wallet");
  ui.choice(2, "Paste an existing mnemonic");
  const choice = (await rl.question(ui.ask("Choose [1]: "))).trim() || "1";

  if (choice === "2") {
    const pasted = normalizeMnemonic(
      await rl.question(ui.ask("Paste your 12/24-word mnemonic: ")),
    );
    assertWordCount(pasted);
    return pasted;
  }

  const seed = mnemonicGenerate(12);
  ui.notice(
    "NEW WALLET MNEMONIC — write this down now",
    [
      ui.bold(ui.cyan(seed)),
      "",
      ui.dim("Anyone with these words controls the wallet. Never commit it."),
    ],
    "yellow",
  );
  await rl.question(ui.ask("Press Enter once you've saved it… "));
  return seed;
}

/** Format planck (smallest unit) as a trimmed human balance string, max 4 dp. */
function formatPas(planck: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = planck / base;
  const frac = (planck % base).toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

function normalizeDomain(raw: string): string {
  let domain = raw.trim().toLowerCase();
  if (!domain) throw new Error("A domain is required.");
  if (!domain.endsWith(".dot")) domain += ".dot";
  return domain;
}

function pnpm(args: string[], label: string, env?: NodeJS.ProcessEnv): void {
  const result = spawnSync("pnpm", args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: env ? { ...process.env, ...env } : process.env,
  });
  if (result.status !== 0) throw new Error(`${label} failed (pnpm ${args.join(" ")}).`);
}

/** Ensure the PolkaVM blob exists: fetch resolc if needed, then compile. */
function buildContract(): void {
  ui.section("Compile");
  if (!existsSync(RESOLC_BIN)) {
    // RESOLC_ONLY skips the revive-dev-node / eth-rpc / anvil binaries (~360 MB of
    // local-dev tooling we don't need) and fetches only the resolc compiler.
    ui.step("Fetching resolc PolkaVM compiler (one-time, ~170 MB)…");
    pnpm(["download:binaries"], "resolc download", { RESOLC_ONLY: "1" });
  }
  if (existsSync(ARTIFACT)) {
    ui.info("Artifact present — recompiling to pick up any contract changes.");
  }
  ui.step("Compiling contracts (Hardhat + resolc)…");
  pnpm(["contracts:compile"], "contract compile");
  ui.success("P2PMarket compiled.");
}

function runBuild(domain: string): void {
  ui.section("Build");
  ui.step("Building the web app (vite)…");
  // Bake the bare chosen domain into the bundle as the host product identifier
  // (VITE_DOTNS_ID). The host grants the product account/allowance against this
  // bare domain — the same value the manifest is published with — so signing must
  // use it rather than window.location.host, which is app.<domain> at runtime.
  pnpm(["--filter", "@localdot/web", "build"], "web build", {
    VITE_DOTNS_ID: domain,
  });
  if (!existsSync(resolve(WEB_DIST, "index.html"))) {
    throw new Error(`Build did not produce ${WEB_DIST}/index.html.`);
  }
  ui.success("Static export ready (apps/web/dist/).");
}

function publishDapp(command: string[], domain: string, seed: string): void {
  ui.section("Publish");
  ui.step(`${PUBLISH_BIN} --env ${BULLETIN_ENV} → ${domain}…`);
  const [bin, ...prefixArgs] = command;
  const args = [...prefixArgs, "--env", BULLETIN_ENV, WEB_DIST, domain];
  // polkadot-app-deploy merkleizes via a local IPFS (kubo); if it isn't usable, fall
  // back to its pure-JS merkleizer so no kubo install/init is required. Probe a
  // repo-bound command (`ipfs repo stat`) rather than `--version`: the binary can
  // be present while the repo is uninitialized (no ~/.ipfs), and `--version`
  // passes regardless — `ipfs add` would then abort with "no IPFS repo found".
  const kuboReady = spawnSync("ipfs", ["repo", "stat"], { encoding: "utf8" }).status === 0;
  if (!kuboReady) {
    ui.info("ipfs (kubo) not available or not initialized — using --js-merkle (pure-JS merkleization).");
    args.push("--js-merkle");
  }
  const result = spawnSync(bin, args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    // MNEMONIC stays in-memory only — never written to disk. NODE_OPTIONS mirrors
    // CI so the publish doesn't OOM on the bundle. POLKADOT_APP_DEPLOY_DOMAIN is
    // read by apps/web/polkadot-app-deploy.config.ts so the published manifest's
    // `domain` matches the label we're deploying to (publishManifest aborts otherwise).
    env: {
      ...process.env,
      MNEMONIC: seed,
      POLKADOT_APP_DEPLOY_DOMAIN: domain,
      NODE_OPTIONS: "--max-old-space-size=8192",
    },
  });
  if (result.status !== 0) throw new Error(`${PUBLISH_BIN} failed.`);
}

/**
 * polkadot-app-deploy prefers a paired mobile (QR `login`) session over the
 * MNEMONIC we pass — so a leftover session would publish and register the .dot as
 * a DIFFERENT account than the wallet we just deployed from. If one exists, offer
 * to clear it so the publish uses the mnemonic (the single-secret design).
 */
async function ensureMnemonicSigner(rl: Interface, command: string[]): Promise<void> {
  if (!existsSync(SSO_SESSION_FILE)) return;
  ui.section("Signer");
  ui.warn(
    "A saved polkadot-app-deploy mobile session exists; it will be used to publish " +
      "(and register the .dot) instead of your deploy mnemonic.",
  );
  ui.choice(1, "Log out and publish with the mnemonic (recommended; clears the saved login)");
  ui.choice(2, "Keep the session and approve the publish on your phone");
  const choice = (await rl.question(ui.ask("Choose [1]: "))).trim() || "1";
  if (choice !== "1") return;
  const [bin, ...prefixArgs] = command;
  const result = spawnSync(bin, [...prefixArgs, "logout"], { cwd: REPO_ROOT, stdio: "inherit" });
  if (result.status !== 0) ui.warn("`polkadot-app-deploy logout` failed — the session may still be used.");
  else ui.success("Session cleared — publishing with the mnemonic.");
}

async function main(): Promise<void> {
  await cryptoWaitReady();
  ui.banner("LOCALDOT", "one-shot deploy · contract + frontend → .dot");
  const publishCmd = resolvePublishCommand();

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const seed = await resolveWallet(rl);
    const { ss58, h160 } = deriveAccount(seed);

    ui.section("Funding");
    ui.info(`Send SUM to this address on ${NETWORK.displayName}:`);
    ui.kvBlock([
      ["SS58", ss58],
      ["H160", h160],
    ]);
    ui.info(
      "Summit has no public faucet — fund this address from a Summit source account " +
        `(transfer SUM over the Asset Hub WSS).`,
    );
    ui.info(
      `(needs at least ${MIN_FUNDING_SUM} SUM for the contract deploy and the .dot registration)`,
    );

    // Re-check on-chain balance after each "funded" confirmation. Under the
    // floor → warn and loop; a read error → warn and retry, never proceed on an
    // under-funded wallet.
    for (;;) {
      await rl.question(ui.ask("Press Enter once the address is funded… "));
      ui.step("Checking on-chain balance…");
      try {
        const { planck, decimals, symbol } = await fetchBalance(ss58);
        const needed = BigInt(MIN_FUNDING_SUM) * 10n ** BigInt(decimals);
        const human = `${formatPas(planck, decimals)} ${symbol}`;
        if (planck >= needed) {
          ui.success(`Balance ${human} — enough to continue.`);
          break;
        }
        ui.warn(
          `Balance ${human} is below the ${MIN_FUNDING_SUM} ${symbol} needed — ` +
            "top up from a Summit source account, then press Enter to re-check.",
        );
      } catch (error) {
        ui.warn(
          `Couldn't read the balance (${error instanceof Error ? error.message : error}). ` +
            "Check the connection, then press Enter to retry.",
        );
      }
    }

    buildContract();
    const { contractAddress } = await deployP2PMarket(deployerFromSeed(seed));

    ui.section("Domain");
    // DotNS naming policy, framed for a NoStatus signer (no personhood — the
    // common case). "base" is the label with any trailing digits stripped:
    //   • base length ≥ 9   → open to any caller (NoStatus) when carrying zero or
    //     exactly two trailing digits. This is all a NoStatus wallet can register.
    //   • base length 6–8  → requires personhood: PopFull, or PopLite carrying
    //     exactly two trailing digits (gateway-issued lite names). Not available here.
    //   • a one-digit suffix, or more than two trailing digits, is invalid.
    ui.info("Naming rules:");
    ui.info("• 9+ characters");
    ui.info("• end with zero or exactly two digits (e.g. mydappname or mydappname42)");
    let domain = "";
    while (!domain) {
      const answer = (await rl.question(ui.ask("Domain to publish to (.dot): "))).trim();
      if (!answer) {
        ui.warn("A domain is required — enter a .dot name to publish to.");
        continue;
      }
      domain = normalizeDomain(answer);
    }

    runBuild(domain);
    await ensureMnemonicSigner(rl, publishCmd);
    publishDapp(publishCmd, domain, seed);

    const name = domain.replace(/\.dot$/, "");
    ui.notice(
      "Deployment complete",
      [
        `${ui.dim("Contract")}  ${contractAddress} ${ui.dim(`(${NETWORK.key})`)}`,
        `${ui.dim("Live at ")}  ${ui.bold(ui.cyan(`https://${name}.${GATEWAY_BASE}`))}`,
      ],
      "green",
    );
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  ui.fail(`Deploy failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});

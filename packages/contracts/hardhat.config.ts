import '@nomicfoundation/hardhat-toolbox';
import '@nomicfoundation/hardhat-verify';
import 'hardhat-contract-sizer';
import 'hardhat-gas-reporter';
import 'solidity-coverage';
import '@parity/hardhat-polkadot';
import { HardhatUserConfig } from 'hardhat/config';
import 'dotenv/config';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.28',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  resolc: {
    compilerSource: 'binary',
    settings: {
      resolcPath: './bin/resolc',
      memoryConfig: {
        heapSize: 128000,
        stackSize: 128000,
      },
    },
  },
  defaultNetwork: 'hardhat',
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
      chainId: 31337,
      blockGasLimit: 16777216,
    },
    // Summit Asset Hub — PRIVATE_KEY must be set in .env.
    // Summit has NO hosted public eth-rpc endpoint, so this Hardhat/ethers path
    // needs a LOCAL revive eth-rpc adapter (the dotns revive adapter, base
    // compose) bridging http://localhost:8545 → wss://summit-asset-hub-rpc.polkadot.io.
    // Override with SUMMIT_RPC_URL if your adapter listens elsewhere.
    // NOTE: the primary deploy path (scripts/deploy.ts → scripts/deploy-p2pmarket.ts)
    // is PAPI/pallet-revive over WSS and needs NO adapter; this network is for the
    // optional Hardhat deploy/verify/seed flow only.
    summit: {
      url: process.env.SUMMIT_RPC_URL || 'http://localhost:8545',
      chainId: 420420417,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      polkadot: {
        target: 'pvm',
      },
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === 'true',
    currency: 'USD',
  },
  // Summit has no public block explorer / verification API yet. When one is
  // available, add it here as a `customChains` entry for the `summit` network.
  etherscan: {
    apiKey: {},
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
  typechain: {
    outDir: './typechain-types',
    target: 'ethers-v6',
  },
  contractSizer: {
    alphaSort: true,
    runOnCompile: false,
  },
};

export default config;
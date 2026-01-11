import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import dotenv from "dotenv";

dotenv.config();

// Common RPC and API key configuration from env
const INFURA_KEY = process.env.INFURA_KEY || process.env.INFURA_API_KEY;
const MAINNET_RPC =
  process.env.MAINNET_RPC_URL ||
  (INFURA_KEY
    ? `https://mainnet.infura.io/v3/${INFURA_KEY}`
    : "https://ethereum-rpc.publicnode.com");
const LOCAL_RPC = process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545";
const DEVNET_RPC =
  process.env.DEVNET_RPC_URL || process.env.SEPOLIA_RPC_URL || "";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

// Build networks object conditionally
const networks: HardhatUserConfig["networks"] = {
  hardhat: {
    // Local network configuration for testing
    chainId: 31337,
    // (optional) mainnet forking:
    // forking: { url: MAINNET_RPC, enabled: true },
    gas: "auto",
    gasPrice: "auto",
    blockGasLimit: 30_000_000,
    // Initial balance for test accounts (10000 ETH each)
    accounts: {
      mnemonic: "test test test test test test test test test test test junk",
      count: 20,
      accountsBalance: "10000000000000000000000", // 10000 ETH
    },
  },
};

// Only add mainnet if PRIVKEY is set
if (process.env.PRIVKEY) {
  networks.mainnet = {
    url: MAINNET_RPC,
    accounts: [process.env.PRIVKEY],
    gas: "auto",
    gasMultiplier: 1.2,
    gasPrice: 50_000_000_000,
    blockGasLimit: 0x1fffffffffffff,
  };
}

// Add devnet/testnet if PRIVKEY and RPC URL are set
if (process.env.PRIVKEY && DEVNET_RPC) {
  networks.devnet = {
    url: DEVNET_RPC,
    accounts: [process.env.PRIVKEY],
    gas: "auto",
    gasMultiplier: 1.2,
    // Common testnet chain IDs
    chainId: process.env.DEVNET_CHAIN_ID
      ? parseInt(process.env.DEVNET_CHAIN_ID)
      : undefined,
  };

  // Also add sepolia if using Sepolia RPC
  if (process.env.SEPOLIA_RPC_URL) {
    networks.sepolia = {
      url: process.env.SEPOLIA_RPC_URL,
      accounts: [process.env.PRIVKEY],
      gas: "auto",
      gasMultiplier: 1.2,
      chainId: 11155111,
    };
  }
}

// Optional external local node (e.g. anvil/geth) with forking
if (process.env.ENABLE_LOCALNODE === "true") {
  networks.localnode = {
    url: LOCAL_RPC,
    accounts: [
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
      "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    ],
    blockGasLimit: 0x1fffffffffffff,
    forking: {
      url: MAINNET_RPC,
      enabled: true,
    },
  };
}

const config: HardhatUserConfig = {
  solidity: "0.8.28",
  networks,
  etherscan: {
    apiKey: ETHERSCAN_API_KEY, // set ETHERSCAN_API_KEY in .env
  },
};

export default config;

# Deployment Guide

This guide will help you deploy the AintiVirus Mixer contracts to a devnet/testnet.

## Prerequisites

1. **Environment Setup**

   - Node.js and npm/yarn/pnpm installed
   - A wallet with testnet ETH for gas fees
   - Access to an RPC endpoint (Infura, Alchemy, or public RPC)

2. **Compile Contracts**
   ```bash
   npm run compile
   # or
   pnpm compile
   ```

## Configuration

1. **Create `.env` file** (copy from `.env.example` if available):

   ```bash
   # Required: Your private key (NEVER commit this!)
   PRIVKEY=0x...

   # Required: Devnet RPC URL
   DEVNET_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
   # Or use public RPC: https://ethereum-sepolia-rpc.publicnode.com

    # Optional: Chain ID (auto-detected for common networks)
    DEVNET_CHAIN_ID=11155111  # Sepolia

    # Optional: Use existing token instead of deploying new one
    TOKEN_ADDRESS=0x17A53880B82f3535646B85D62Eb805BceCF433d6

    # Optional: Etherscan API key for verification
    ETHERSCAN_API_KEY=...
   ```

2. **Common Testnet Configurations**:

   **Sepolia Testnet:**

   ```env
   DEVNET_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
   DEVNET_CHAIN_ID=11155111
   ```

   **Goerli Testnet:**

   ```env
   DEVNET_RPC_URL=https://goerli.infura.io/v3/YOUR_KEY
   DEVNET_CHAIN_ID=5
   ```

## Deployment Steps

### 1. Basic Deployment

Deploy all core contracts (Token, Poseidon, Verifier, Factory, Staking):

```bash
npx hardhat run scripts/deploy.ts --network devnet
```

### 2. Deployment with Mixers

To automatically deploy mixers after the factory:

```bash
DEPLOY_MIXERS=true MIXER_AMOUNTS="1,2,5" npx hardhat run scripts/deploy.ts --network devnet
```

This will deploy mixers for 1 ETH, 2 ETH, and 5 ETH amounts.

### 3. Manual Mixer Deployment

After factory deployment, you can deploy mixers manually:

```typescript
// Connect to factory
const factory = await ethers.getContractAt(
  "AintiVirusFactory",
  FACTORY_ADDRESS
);

// Grant OPERATOR_ROLE to your operator address
await factory.grantRole(await factory.OPERATOR_ROLE(), OPERATOR_ADDRESS);

// Deploy mixer for 1 ETH
await factory.connect(operator).deployMixer(0, ethers.parseEther("1")); // 0 = ETH mode
```

## Deployment Output

The deployment script will output:

```
📋 DEPLOYMENT SUMMARY
============================================================
Token (AINTI):             0x...
Poseidon:                  0x...
Verifier:                  0x...
Factory:                   0x...
Staking:                   0x...
Fee Rate:                  250 (0.25%)
============================================================
```

## Post-Deployment

### 1. Verify Contracts (Automatic)

The deployment script automatically verifies all contracts on Etherscan if `ETHERSCAN_API_KEY` is set in your `.env` file. No manual verification needed!

To disable automatic verification:

```env
VERIFY_CONTRACTS=false
```

**Manual Verification** (if needed):

If you need to manually verify contracts:

```bash
# Verify Poseidon
npx hardhat verify --network devnet <POSEIDON_ADDRESS>

# Verify Verifier
npx hardhat verify --network devnet <VERIFIER_ADDRESS>

# Verify Token (if deployed)
npx hardhat verify --network devnet <TOKEN_ADDRESS> "TokenName" "TOKEN"

# Verify Factory
npx hardhat verify --network devnet <FACTORY_ADDRESS> <TOKEN_ADDRESS> <VERIFIER_ADDRESS> <POSEIDON_ADDRESS> 250

# Verify Staking
npx hardhat verify --network devnet <STAKING_ADDRESS> <FACTORY_ADDRESS>
```

### 2. Grant Roles

The deployer automatically gets `DEFAULT_ADMIN_ROLE` and `OPERATOR_ROLE`. You may want to:

- Grant `OPERATOR_ROLE` to a separate operator address
- Transfer `DEFAULT_ADMIN_ROLE` to a multisig or secure address

```typescript
const factory = await ethers.getContractAt(
  "AintiVirusFactory",
  FACTORY_ADDRESS
);
const OPERATOR_ROLE = await factory.OPERATOR_ROLE();

// Grant operator role
await factory.grantRole(OPERATOR_ROLE, OPERATOR_ADDRESS);

// Revoke operator role from deployer (optional)
await factory.revokeRole(OPERATOR_ROLE, DEPLOYER_ADDRESS);
```

### 3. Deploy Additional Mixers

Deploy mixers for different amounts as needed:

```typescript
// ETH mode (0) mixers
await factory.connect(operator).deployMixer(0, ethers.parseEther("0.1"));
await factory.connect(operator).deployMixer(0, ethers.parseEther("10"));

// Token mode (1) mixers (requires token to be set)
await factory.connect(operator).deployMixer(1, ethers.parseEther("100"));
```

## Environment Variables Reference

| Variable            | Required | Description                                      |
| ------------------- | -------- | ------------------------------------------------ |
| `PRIVKEY`           | Yes      | Private key for deployment (0x...)               |
| `DEVNET_RPC_URL`    | Yes      | RPC endpoint URL                                 |
| `DEVNET_CHAIN_ID`   | No       | Chain ID (auto-detected for common networks)     |
| `TOKEN_NAME`        | No       | Token name (default: "AintiVirus")               |
| `TOKEN_SYMBOL`      | No       | Token symbol (default: "AINTI")                  |
| `TOKEN_ADDRESS`     | No       | Use existing token address instead of deploying  |
| `DEPLOY_MIXERS`     | No       | Set to "true" to deploy mixers automatically     |
| `MIXER_AMOUNTS`     | No       | Comma-separated amounts in ETH (e.g., "1,2,5")   |
| `ETHERSCAN_API_KEY` | No       | For automatic contract verification              |
| `VERIFY_CONTRACTS`  | No       | Set to "false" to disable automatic verification |

## Troubleshooting

### "Insufficient funds"

- Ensure your wallet has enough testnet ETH for gas fees

### "Network not found"

- Check that `DEVNET_RPC_URL` is set correctly
- Verify the network name matches `devnet` in hardhat.config.ts

### "Contract deployment failed"

- Check RPC endpoint is accessible
- Verify private key is correct
- Ensure contracts are compiled (`npm run compile`)

## Security Notes

⚠️ **IMPORTANT:**

- Never commit your `.env` file or private keys to git
- Use a separate wallet for deployments
- Consider using a hardware wallet or multisig for production
- Test thoroughly on testnets before mainnet deployment

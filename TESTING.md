# Testing Guide

## Quick Start

### 1. Compile Contracts

```bash
npm run compile
```

This will compile all Solidity contracts and generate TypeScript types.

### 2. Run Tests

Run all tests on Hardhat local network:

```bash
npm test
```

Run specific test file:

```bash
npm run test:factory
```

Run tests with gas reporting:

```bash
npm run test:gas
```

## Hardhat Local Network Configuration

The `hardhat.config.ts` is configured for local testing:

- **Network**: Hardhat built-in network (chainId: 31337)
- **Forking**: Disabled by default (can be enabled if needed)
- **Gas Settings**: Auto-configured
- **Test Accounts**: 20 accounts with 10,000 ETH each

### Network Details

- **Chain ID**: 31337
- **Block Gas Limit**: 30,000,000
- **Initial Balance**: 10,000 ETH per account
- **Mnemonic**: `test test test test test test test test test test test junk`

## Running a Local Node

To run a persistent local node (useful for debugging):

```bash
npm run node
```

This starts a Hardhat node on `http://127.0.0.1:8545` that you can connect to with MetaMask or other tools.

## Test Structure

### Main Test File

- `test/AintiVirusFactory.test.ts` - Comprehensive test suite for the Factory contract

### Test Coverage

1. **Deployment Tests**

   - Token, Poseidon, Verifier deployment
   - Factory deployment and initialization

2. **Mixer Deployment**

   - ETH mixer deployment
   - Token mixer deployment
   - Access control and validation

3. **Deposits**

   - ETH deposits with fees
   - Token deposits with fees
   - Error handling

4. **Withdrawals**

   - ETH withdrawals (requires ZK proof implementation)
   - Token withdrawals (requires ZK proof implementation)

5. **Staking**

   - ETH staking
   - Token staking
   - Reward claiming
   - Unstaking

6. **Admin Functions**
   - Fee rate updates
   - Verifier/hasher updates
   - Staking season management

## Enabling Mainnet Forking

If you want to test with mainnet state, uncomment the forking section in `hardhat.config.ts`:

```typescript
hardhat: {
  forking: {
    url: "https://mainnet.infura.io/v3/YOUR_API_KEY",
    enabled: true,
  },
}
```

## Troubleshooting

### "Contract not found" errors

- Run `npm run compile` first
- Check that contracts are in the `contracts/` directory

### "Type not found" errors

- Run `npm run typechain` to generate TypeScript types
- Or run `npm run compile` which includes typechain

### Gas estimation failures

- Increase `blockGasLimit` in `hardhat.config.ts`
- Check contract complexity

### Proof verification failures

- Implement actual proof generation in `test/helpers/proofGenerator.ts`
- Ensure circuit is compiled and trusted setup is complete

## Test Accounts

Hardhat provides 20 test accounts automatically. The first few are:

1. `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` (deployer)
2. `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
3. `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`
   ... and 17 more

Each account starts with 10,000 ETH.

## Running Specific Tests

Run a specific test by name:

```bash
npx hardhat test --grep "Should deploy ETH mixer"
```

Run tests in a specific file:

```bash
npx hardhat test test/AintiVirusFactory.test.ts
```

Run with verbose output:

```bash
npx hardhat test --verbose
```

## Continuous Testing

Watch mode (re-runs tests on file changes):

```bash
npm run test:watch
```

## Coverage

Generate test coverage report:

```bash
npx hardhat coverage
```

## Debugging

To debug tests, add `console.log` statements or use a debugger:

```typescript
console.log("Factory address:", await factory.getAddress());
console.log("Balance:", await ethers.provider.getBalance(user1.address));
```

For advanced debugging, use Hardhat's console.log in Solidity:

```solidity
import "hardhat/console.sol";
console.log("Value:", value);
```

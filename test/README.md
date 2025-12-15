# Test Suite for AintiVirusFactory

## Overview

This test suite provides comprehensive testing for the `AintiVirusFactory` contract, covering:

- Factory deployment and initialization
- Mixer deployment (ETH and Token)
- Deposits (ETH and Token)
- Withdrawals (with ZK proofs)
- Staking functionality (stake, claim, unstake)
- Admin functions
- View functions

## Setup

1. Install dependencies:
```bash
npm install
```

2. Compile contracts:
```bash
npx hardhat compile
```

3. Generate TypeScript types:
```bash
npx hardhat typechain
```

## Running Tests

Run all tests:
```bash
npx hardhat test
```

Run specific test file:
```bash
npx hardhat test test/AintiVirusFactory.test.ts
```

Run with gas reporting:
```bash
REPORT_GAS=true npx hardhat test
```

## Test Structure

### 1. Deployment Tests
- Token, Poseidon, Verifier deployment
- Factory deployment and initialization
- Staking contract deployment

### 2. Mixer Deployment Tests
- Deploy ETH mixer
- Deploy Token mixer
- Duplicate deployment prevention
- Access control

### 3. Deposit Tests
- ETH deposits with fees
- Token deposits with fees
- Insufficient balance handling
- Invalid mixer handling

### 4. Withdrawal Tests
- ETH withdrawals with ZK proofs
- Token withdrawals with ZK proofs
- Merkle tree reconstruction
- Proof generation

### 5. Staking Tests
- ETH staking
- Token staking
- Reward claiming
- Unstaking

### 6. Admin Function Tests
- Fee rate updates
- Verifier updates
- Hasher updates
- Staking season management

## Important Notes

### Proof Generation

The withdrawal tests currently use placeholder proofs. To enable actual withdrawal testing:

1. Compile your Circom circuit:
```bash
cd zk-circuit
npm install
npm run compile
```

2. Generate trusted setup (if not already done):
```bash
# Follow the setup instructions in zk-circuit/README.md
```

3. Implement actual proof generation in `test/helpers/proofGenerator.ts`:
   - Use the compiled circuit WASM
   - Generate witness from inputs
   - Use snarkjs to generate proofs
   - Format according to your circuit structure

See the commented example in `proofGenerator.ts` for reference.

### Merkle Tree

The tests use `fixed-merkle-tree` to reconstruct the merkle tree from deposit events. This matches the on-chain merkle tree structure.

### Test Data

The tests use:
- ETH amount: 1 ETH
- Token amount: 1000 tokens (18 decimals)
- Fee rate: 0.25% (250 basis points)

## Troubleshooting

### "Mixer not deployed" errors
- Ensure mixer deployment tests run before deposit/withdrawal tests
- Check that the correct mode and amount are used

### Proof verification failures
- Implement actual proof generation (see above)
- Ensure circuit is compiled and trusted setup is complete
- Verify merkle tree reconstruction matches on-chain state

### Staking season errors
- Staking tests may fail if season has expired
- Use time manipulation helpers if needed
- Or manually start a new season before testing

## Extending Tests

To add new test cases:

1. Add test in appropriate describe block
2. Use helper functions from `proofGenerator.ts`
3. Follow existing patterns for assertions
4. Add necessary setup/teardown if needed

## Helper Functions

Located in `test/helpers/proofGenerator.ts`:
- `generateSecretAndNullifier()` - Generate random secret/nullifier
- `computeCommitment()` - Compute commitment hash
- `computeNullifierHash()` - Compute nullifier hash
- `buildMerkleTreeFromEvents()` - Rebuild merkle tree from events
- `generateWithdrawalProof()` - Generate ZK proof (placeholder)


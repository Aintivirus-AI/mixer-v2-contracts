# Complex Multi-Season Staking Test Suite

## Overview

This test suite (`AintiVirusFactory.complex.test.ts`) provides comprehensive testing of the AintiVirus staking system across multiple seasons with extensive security checks, balance verification, and stress testing.

## Test Structure

### Global Rules & Assumptions

- **Season Duration**: 30 days each
- **Asset Pools**: 1 ETH, 2 ETH, 5 ETH
- **Access Control**: Only stakers can claim/unstake their own positions
- **Claim Scope**: Claims are season-scoped
- **Replay Protection**: Already claimed seasons cannot be claimed again
- **Cross-Season Rules**: Cross-season claims must respect stake timing
- **Security**: Unauthorized access attempts must revert

## Test Scenarios

### 🟢 Season 1 - Initial Setup & Activity

#### Admin Actions
- Deploys staking pools for 1 ETH, 2 ETH, and 5 ETH
- Starts Season 1

#### Normal User Activity (Load + Stress Test)
- **User1, User2, User3**: Deposit & withdraw 1 ETH, repeat 10 times each
- **User2, User3**: Deposit & withdraw 2 ETH, repeat 10 times each
- **User3**: Deposit & withdraw 5 ETH, repeat 10 times

**Purpose**: Stress test vault balance, accounting, and event indexing

#### Long-Term Staking
- **UserA**: Stakes 2 ETH on Day 10
- **UserB**: Stakes 4 ETH on Day 20

#### ❌ Security Tests
- **UserD (attacker)**: Attempts to claim + unstake UserA's Season 1 position
  - **Expected**: ❌ REVERT
  - **Reason**: Unauthorized caller

### 🟢 Season 2 - Continuation

#### Normal Activity
- **User1, User2, User3**: Deposit & withdraw 1 ETH, repeat 10 times
- **User3**: Deposit & withdraw 5 ETH, repeat 10 times

### 🟢 Season 3 - Claims & New Stakes

#### Valid Claims
- **UserA**: Claims rewards for Season 1 + Season 2, then unstakes
  - **Expected**: ✅ SUCCESS
  - **Balance Verification**: Verifies exact reward amounts and stake return

#### ❌ Security Tests
- **UserD**: Attempts to claim UserA's Season 1, 2, and 3
  - **Expected**: ❌ REVERT
  - **Reasons**: Unauthorized caller, Season 3 not staked, already claimed seasons

#### New Stake
- **UserC**: Stakes 10 ETH on Day 5 of Season 3

#### High-Frequency Actions
- **User1**: Deposit & withdraw 1 ETH, repeat 10 times

### 🟢 Season 4 - Advanced Security Checks

#### ❌ Replay / Double Claim Attacks
- **UserD**: Attempts to claim UserA's Season 1, 2, and 3 again
  - **Expected**: ❌ REVERT
  - **Reasons**: Unauthorized, already claimed, no stake record

#### ❌ Invalid Claim (Already Unstaked)
- **UserA**: Attempts to claim Season 1, 2, and 3 after unstaking
  - **Expected**: ❌ REVERT
  - **Reason**: Already claimed or unstaked

#### ✅ Valid Multi-Season Claim
- **UserB**: Claims Season 1, 2, and 3
  - **Expected**: ✅ SUCCESS
  - **Checks**:
    - Stake existed before season cutoff
    - Not previously claimed
    - Correct reward calculation with balance verification

#### ❌ Invalid Early Claim
- **UserC**: Attempts to claim Season 1 and 2
  - **Expected**: ❌ REVERT
  - **Reasons**: Did not stake in Season 1 or 2
- **UserC**: Successfully claims Season 3 (the season they staked in)

## Security Coverage Checklist

✅ **Unauthorized claim protection** - Users cannot claim other users' rewards  
✅ **Cross-user claim prevention** - Access control enforced  
✅ **Replay attack prevention** - Double-claim protection  
✅ **Double-claim protection** - Claim status tracking  
✅ **Season boundary enforcement** - Cannot claim from future/active seasons  
✅ **Stake timing validation** - Cross-season claims respect stake timing  
✅ **High-frequency deposit/withdraw stress** - 30+ cycles per user  
✅ **Multi-asset pool isolation** - 1 ETH, 2 ETH, 5 ETH pools tested  
✅ **Late stake cutoff enforcement** - Stakes respect season boundaries  
✅ **Balance verification** - Exact reward calculations verified  
✅ **Factory balance integrity** - Total balances tracked correctly  

## Balance Verification

The test suite includes comprehensive balance verification:

### UserA Claims (Season 3)
- Calculates expected rewards based on:
  - Season 1: Weight from actual staking time (20 days remaining)
  - Season 2: Full period weight (30 days)
- Verifies received amount = expected rewards + stake amount
- Checks factory balance decrease matches user balance increase

### UserB Claims (Season 4)
- Calculates expected rewards for all 3 seasons:
  - Season 1: Weight from actual staking time (10 days remaining)
  - Season 2 & 3: Full period weight (30 days each)
- Verifies total received matches sum of all expected rewards
- Allows up to 3 wei tolerance for rounding errors

### Final Balance Check
- Verifies all remaining stakes are correct
- Checks factory balance >= total remaining stakes
- Validates all claim statuses are correctly tracked
- Summarizes total rewards across all seasons

## Running the Tests

### Prerequisites
- Node.js and npm installed
- Hardhat configured
- ZK circuit artifacts built (for proof generation)

### Run Command
```bash
# Run the complex test suite
npx hardhat test test/AintiVirusFactory.complex.test.ts

# Run with gas reporting
REPORT_GAS=true npx hardhat test test/AintiVirusFactory.complex.test.ts

# Run with increased timeout (if needed)
npx hardhat test test/AintiVirusFactory.complex.test.ts --timeout 600000
```

### Expected Duration
- **Normal**: ~3-5 minutes (depending on proof generation speed)
- **Timeout**: 5 minutes (300 seconds) configured

## Test Output

The test suite provides detailed console output including:
- ✅ Success indicators for valid operations
- 🚫 Security test results showing prevented attacks
- 📊 Expected vs actual reward calculations
- 💰 Balance changes and verifications
- 🔍 Detailed security check results

## Key Test Functions

### `depositAndWithdraw(user, amount, times)`
- Optimized batch function that deposits all amounts first, then withdraws
- Reduces merkle tree rebuilds from N to 1 per batch
- Handles proof generation for withdrawals

### `advanceTimeByDays(days)`
- Advances blockchain time by specified days
- Used to simulate season progression

### Balance Verification Helpers
- Tracks factory balance before/after operations
- Accounts for gas costs in balance calculations
- Verifies reward calculations with tolerance for rounding

## Important Notes

1. **Proof Generation**: The test uses actual zk-SNARK proofs which can be slow. The batching optimization helps reduce execution time.

2. **Gas Costs**: Balance verifications account for gas costs to ensure accurate comparisons.

3. **Rounding Tolerance**: Reward calculations allow up to 3 wei difference for rounding errors in division operations.

4. **Season Transitions**: Each season transition preserves stake data and calculates new weights correctly.

5. **Security Focus**: The test suite emphasizes security checks to ensure unauthorized access is prevented.

## Troubleshooting

### Timeout Issues
If tests timeout, try:
- Increasing timeout: `--timeout 600000`
- Reducing deposit/withdraw cycles (modify `times` parameter)
- Checking proof generation performance

### Balance Mismatches
If balance verifications fail:
- Check gas cost calculations
- Verify reward calculation formulas
- Ensure all deposits/withdrawals completed successfully

### Proof Generation Errors
If proof generation fails:
- Verify zk-circuit artifacts are built
- Check circuit WASM and zkey files exist
- Ensure snarkjs is properly installed

## Contributing

When adding new test scenarios:
1. Follow the existing structure and naming conventions
2. Include balance verification for all claim operations
3. Add security checks for unauthorized access attempts
4. Update this README with new test scenarios
5. Ensure all tests pass with proper error messages


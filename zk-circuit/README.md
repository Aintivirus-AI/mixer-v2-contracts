# Zero-Knowledge Circuits for AintiVirus Mixer

This folder contains the Circom circuit files for the AintiVirus Mixer zero-knowledge proof system.

## Structure

- `circuits/` - Main circuit files (`.circom`)
  - `mixer.circom` - Main withdrawal circuit
  - `merkleTree.circom` - Merkle tree verification components
- `inputs/` - Test input files for circuit testing
  - `example_input.json` - Example input file
- `build/` - Compiled circuit artifacts (generated, should be in .gitignore)

## Circuit Overview

The mixer uses zero-knowledge proofs to allow users to:

1. **Deposit**: Commit funds without revealing their identity
2. **Withdraw**: Prove ownership of a commitment without revealing which commitment

## Key Components

### Mixer Circuit (`mixer.circom`)

The `AintiMixerProof` template verifies:

- Knowledge of a secret and nullifier
- The commitment hash (Poseidon(secret, nullifier)) exists in the merkle tree
- The nullifier hash (Poseidon(nullifier, 0)) prevents double-spending
- The recipient address is correctly specified

### Merkle Tree Components (`merkleTree.circom`)

- `HashLeftRight` - Computes Poseidon([left, right])
- `DualMux` - Multiplexer for selecting left/right based on path index
- `MerkleTreeChecker` - Verifies merkle proof correctness

### Public Signals (matching contract's `pubSignals[3]`)

The circuit outputs 3 public signals:

- `[0]` nullifierHash - Hash of the nullifier (Poseidon(nullifier, 0))
- `[1]` recipientAddress - Address to receive funds
- `[2]` rootOutput - Merkle root of the tree

### Inputs

**Private Inputs:**

- `secret` - Secret value (random 256-bit number)
- `nullifier` - Nullifier value (random 256-bit number)
- `pathElements[24]` - Array of 24 merkle path elements
- `pathIndices[24]` - Array of 24 path indices (0 or 1)

**Public Inputs:**

- `root` - Merkle root to verify against
- `recipient` - Recipient address as uint256

## Commitment Calculation

The commitment is computed as:

```
commitment = Poseidon(secret, nullifier)
```

Note: Amount and mode are not included in the commitment since each mixer contract is deployed for a specific fixed amount and mode. The mixer contract itself enforces the amount and mode.

## Nullifier Hash

The nullifier hash is computed as:

```
nullifierHash = Poseidon(nullifier, 0)
```

This prevents double-spending by ensuring each nullifier can only be used once.

## Usage

### 1. Install Dependencies

```bash
cd zk-circuit
npm install
```

### 2. Compile Circuit

```bash
npm run compile
# or
circom circuits/mixer.circom --r1cs --wasm --sym -o build
```

### 3. Generate Trusted Setup

```bash
# Phase 1: Powers of Tau
snarkjs powersoftau new bn128 14 pot14_0000.ptau -v
snarkjs powersoftau contribute pot14_0000.ptau pot14_0001.ptau --name="First contribution" -v
snarkjs powersoftau prepare phase2 pot14_0001.ptau pot14_final.ptau -v

# Phase 2: Circuit-specific setup
snarkjs groth16 setup build/mixer.r1cs pot14_final.ptau build/mixer_0000.zkey
snarkjs zkey contribute build/mixer_0000.zkey build/mixer_0001.zkey --name="1st Contributor Name" -v
snarkjs zkey export verificationkey build/mixer_0001.zkey build/verification_key.json
```

### 4. Generate Proof

```bash
# Generate witness
node build/mixer_js/generate_witness.js build/mixer_js/mixer.wasm inputs/example_input.json build/witness.wtns

# Generate proof
snarkjs groth16 prove build/mixer_0001.zkey build/witness.wtns build/proof.json build/public.json
```

### 5. Verify Proof

```bash
snarkjs groth16 verify build/verification_key.json build/public.json build/proof.json
```

### 6. Generate Solidity Verifier

```bash
snarkjs zkey export solidityverifier build/mixer_0001.zkey ../contracts/verifiers/Verifier.sol
```

**Note:** After generating the verifier, you may need to update the contract name and pragma version to match your project's requirements.

## Circuit Details

- **Tree Levels**: 24 (supports up to 2^24 = 16,777,216 deposits)
- **Hash Function**: Poseidon
  - Commitment: Poseidon(2) - [secret, nullifier]
  - Nullifier Hash: Poseidon(2) - [nullifier, 0]
  - Merkle Tree: Poseidon(2) - [left, right]
- **Zero Element**: 0 (as used in the contract)

## Integration with Smart Contract

The circuit's public signals match the contract's `WithdrawalProof` structure:

- `pubSignals[0]` → `nullifierHash` (checked for double-spending)
- `pubSignals[1]` → `recipient` (extracted as address)
- `pubSignals[2]` → `root` (checked against known roots)

## Notes

- The circuit uses Poseidon hash function (as used in the smart contracts)
- The merkle tree has 24 levels, matching the contract's `MerkleTreeWithHistory(24, ...)`
- Amount and mode are not in the circuit since each mixer is for a fixed amount/mode
- Path indices: 0 = left, 1 = right
- The `DualMux` template efficiently handles path selection

## Security Considerations

- Always use a secure random number generator for `secret` and `nullifier`
- Never reuse the same `nullifier` for different withdrawals
- Keep the `secret` and `nullifier` private - they are the proof of ownership
- The circuit ensures the commitment exists in the merkle tree without revealing which one
- Each mixer contract enforces a specific amount and mode, so they don't need to be in the proof

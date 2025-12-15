# Circuit Files

## Structure

- `mixer.circom` - Main mixer circuit for withdrawals
- `merkleTree.circom` - Merkle tree verification components (HashLeftRight, DualMux, MerkleTreeChecker)

## Circuit Requirements

The withdrawal circuit (`AintiMixerProof`) verifies:

1. Knowledge of a secret and nullifier
2. The commitment hash (Poseidon(secret, nullifier)) exists in the merkle tree
3. The nullifier hash (Poseidon(nullifier, 0)) hasn't been used before
4. The recipient address is correctly specified

## Public Signals (matching contract's `pubSignals[3]`)

The circuit outputs 3 public signals:

- `[0]` nullifierHash - Hash of the nullifier (Poseidon(nullifier, 0))
- `[1]` recipientAddress - Address to receive funds
- `[2]` rootOutput - Merkle root of the tree

## Inputs

### Private Inputs:

- `secret` - Secret value (random 256-bit number)
- `nullifier` - Nullifier value (random 256-bit number)
- `pathElements[24]` - Array of 24 merkle path elements
- `pathIndices[24]` - Array of 24 path indices (0 or 1)

### Public Inputs:

- `root` - Merkle root to verify against
- `recipient` - Recipient address as uint256

## Commitment Calculation

The commitment is computed as:

```
commitment = Poseidon(secret, nullifier)
```

Note: Amount and mode are not included in the commitment since each mixer contract is deployed for a specific fixed amount and mode.

## Nullifier Hash

The nullifier hash is computed as:

```
nullifierHash = Poseidon(nullifier, 0)
```

This prevents double-spending by ensuring each nullifier can only be used once.

## Merkle Tree Verification

The circuit uses the `MerkleTreeChecker` template which:

- Uses `DualMux` to select left/right based on `pathIndices`
- Uses `HashLeftRight` (Poseidon) to hash pairs at each level
- Verifies the computed root matches the provided root

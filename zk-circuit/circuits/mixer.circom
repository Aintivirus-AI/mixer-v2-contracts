pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "./merkleTree.circom";

template AintiMixerProof(levels) {
    // Private inputs
    signal input secret;
    signal input nullifier;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    
    // Public inputs
    signal input root;
    signal input recipient; // Address as uint256
    
    // Internal commitment (computed from secret, nullifier)
    signal commitment;

    // Public outputs (matching contract's pubSignals[3])
    signal output nullifierHash;      // pubSignals[0]
    signal output recipientAddress;   // pubSignals[1]
    signal output rootOutput;         // pubSignals[2]

    // Compute commitment = Poseidon(secret, nullifier)
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== secret;
    commitmentHasher.inputs[1] <== nullifier;
    commitment <== commitmentHasher.out;

    // Compute nullifierHash = Poseidon(nullifier, 0)
    // This prevents double-spending
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHasher.inputs[1] <== 0;
    nullifierHash <== nullifierHasher.out;

    // Merkle tree proof verification
    component tree = MerkleTreeChecker(levels);
    tree.leaf <== commitment;
    tree.root <== root;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }

    // Public outputs matching contract structure
    recipientAddress <== recipient;
    rootOutput <== root;
}

// Main component with 24 levels (matching the contract)
component main = AintiMixerProof(24);

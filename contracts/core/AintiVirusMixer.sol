// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "../libraries/MerkleTreeWithHistory.sol";
import "../interfaces/IPoseidon.sol";
import "../interfaces/IVerifier.sol";

/**
 * @title AintiVirusMixer
 * @dev State-only contract for managing mixer commitments, nullifiers, and merkle tree
 * All fund transfers are handled by the Factory contract
 * 
 * Note: The Verifier contract must be regenerated from the circuit to match pubSignals[3]
 */
contract AintiVirusMixer is MerkleTreeWithHistory, ReentrancyGuard {
    IVerifier public immutable verifier;

    // Commitments
    mapping(bytes32 => bool) public commitments;

    // Nullifier mappings
    mapping(bytes32 => bool) public nullifierHashes;

    struct WithdrawalProof {
        uint[2] pA;
        uint[2][2] pB;
        uint[2] pC;
        uint[3] pubSignals;
    }

    address public immutable vault; // Factory/Vault address

    event Deposit(
        bytes32 indexed commitment,
        uint32 leafIndex,
        uint256 timestamp
    );
    event Withdrawal(address to, bytes32 nullifierHash);

    constructor(
        address _verifier,
        address _hasher,
        address _vault
    ) MerkleTreeWithHistory(24, IPoseidon(_hasher)) {
        verifier = IVerifier(_verifier);
        vault = _vault;
    }

    /**
     * @dev State-only deposit function for Factory to call (no fund transfers)
     * @param _commitment The commitment hash to add to the merkle tree
     */
    function depositState(
        bytes32 _commitment
    ) external nonReentrant {
        require(msg.sender == vault, "Only vault can call");
        require(!commitments[_commitment], "The commitment has been submitted");

        uint32 insertedIndex = _insert(_commitment);
        commitments[_commitment] = true;

        emit Deposit(_commitment, insertedIndex, block.timestamp);
    }

    /**
     * @dev State-only withdraw validation function for Factory to call
     * @param _proof The withdrawal proof to validate
     * @return recipient The recipient address extracted from the proof
     */
    function validateWithdraw(
        WithdrawalProof calldata _proof
    ) external nonReentrant returns (address recipient) {
        require(msg.sender == vault, "Only vault can call");
        
        bytes32 nullifierHash = bytes32(_proof.pubSignals[0]);
        require(
            nullifierHashes[nullifierHash] == false,
            "Nullifier already used"
        );

        require(
            verifier.verifyProof(
                _proof.pA,
                _proof.pB,
                _proof.pC,
                _proof.pubSignals
            ),
            "Invalid withdraw proof"
        );

        require(
            isKnownRoot(bytes32(_proof.pubSignals[2])),
            "Cannot find your merkle root"
        );

        // Extract recipient address from proof (pubSignals[1])
        recipient = address(uint160(_proof.pubSignals[1]));

        nullifierHashes[nullifierHash] = true;

        emit Withdrawal(recipient, nullifierHash);
    }

}

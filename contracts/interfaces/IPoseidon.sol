// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IPoseidon {
    function poseidon(
        uint256[2] calldata inputs
    ) external pure returns (uint256);
}


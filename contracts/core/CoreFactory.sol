// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title CoreFactory
 * @dev Base factory contract with common enums, constants, and setting functions
 */
contract CoreFactory is ReentrancyGuard, AccessControl {
    // ============ ENUMS ============
    
    enum AssetMode {
        ETH,   // 0
        TOKEN  // 1
    }

    // ============ CONSTANTS ============
    
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // ============ STATE VARIABLES ============
    
    address public immutable verifier;
    address public immutable hasher;
    uint256 public feeRate; // Fee rate in basis points (e.g., 250 = 0.25%)

    // ============ EVENTS ============
    
    event FeeRateUpdated(uint256 oldFeeRate, uint256 newFeeRate);

    // ============ CONSTRUCTOR ============
    
    constructor(
        address _verifier,
        address _hasher,
        uint256 _feeRate
    ) {
        verifier = _verifier;
        hasher = _hasher;
        feeRate = _feeRate;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
    }

    // ============ SETTING FUNCTIONS ============
    

    /**
     * @dev Set the fee rate
     * @param _feeRate The new fee rate in basis points (e.g., 250 for 0.25%)
     */
    function setFeeRate(uint256 _feeRate) external onlyRole(OPERATOR_ROLE) {
        require(_feeRate <= 5000, "Fee rate cannot exceed 5%");
        uint256 oldFeeRate = feeRate;
        feeRate = _feeRate;
        emit FeeRateUpdated(oldFeeRate, _feeRate);
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @dev Calculate the total deposit amount including fees
     * @param _amount The base deposit amount
     * @return The total amount including fees
     */
    function calculateDepositAmount(uint256 _amount) public view returns (uint256) {
        uint256 fee = (_amount * feeRate) / 100000;
        return fee + _amount;
    }

    /**
     * @dev Convert enum AssetMode to uint256 for backward compatibility
     * @param _mode The AssetMode enum value
     * @return The corresponding uint256 mode value
     */
    function modeToUint(AssetMode _mode) public pure returns (uint256) {
        return uint256(_mode);
    }

    /**
     * @dev Convert uint256 to enum AssetMode
     * @param _mode The uint256 mode value
     * @return The corresponding AssetMode enum value
     */
    function uintToMode(uint256 _mode) public pure returns (AssetMode) {
        require(_mode == uint256(AssetMode.ETH) || _mode == uint256(AssetMode.TOKEN), "Invalid mode");
        return AssetMode(_mode);
    }
}


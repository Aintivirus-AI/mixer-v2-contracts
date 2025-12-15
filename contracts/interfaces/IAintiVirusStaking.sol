// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface IAintiVirusStaking {
    // Events
    event StakedEth(address indexed staker, uint256 amount, uint256 seasonId);
    event StakedToken(address indexed staker, uint256 amount, uint256 seasonId);
    event ClaimedEth(address indexed staker, uint256 amount, uint256 seasonId);
    event ClaimedToken(address indexed staker, uint256 amount, uint256 seasonId);
    event UnstakedEth(address indexed staker, uint256 amount);
    event UnstakedToken(address indexed staker, uint256 amount);
    event RewardAdded(uint256 amount, uint256 mode, uint256 seasonId);
    event SeasonStarted(uint256 seasonId, uint256 startTimestamp, uint256 endTimestamp);

    // Structs
    struct StakeSeason {
        uint256 seasonId;
        uint256 startTimestamp;
        uint256 endTimestamp;
        uint256 totalStakedEthAmount;
        uint256 totalStakedTokenAmount;
        uint256 totalRewardEthAmount;
        uint256 totalRewardTokenAmount;
        uint256 totalEthWeightValue;
        uint256 totalTokenWeightValue;
    }

    struct StakerRecord {
        uint256 ethStakedSeasonId;
        uint256 tokenStakedSeasonId;
        uint256 ethStakedTimestamp;
        uint256 tokenStakedTimestamp;
        uint256 stakedEthAmount;
        uint256 stakedTokenAmount;
        uint256 ethWeightValue;
        uint256 tokenWeightValue;
    }

    // Public state variables
    function vault() external view returns (address);
    function stakingSeasonPeriod() external view returns (uint256);
    function currentStakeSeason() external view returns (uint256);
    function stakeSeasons(uint256) external view returns (
        uint256 seasonId,
        uint256 startTimestamp,
        uint256 endTimestamp,
        uint256 totalStakedEthAmount,
        uint256 totalStakedTokenAmount,
        uint256 totalRewardEthAmount,
        uint256 totalRewardTokenAmount,
        uint256 totalEthWeightValue,
        uint256 totalTokenWeightValue
    );
    function stakeRecords(address) external view returns (
        uint256 ethStakedSeasonId,
        uint256 tokenStakedSeasonId,
        uint256 ethStakedTimestamp,
        uint256 tokenStakedTimestamp,
        uint256 stakedEthAmount,
        uint256 stakedTokenAmount,
        uint256 ethWeightValue,
        uint256 tokenWeightValue
    );
    function addressToSeasonClaimedEth(address, uint256) external view returns (bool);
    function addressToSeasonClaimedToken(address, uint256) external view returns (bool);

    // Functions
    function addRewards(uint256 mode, uint256 amount) external;
    function startStakeSeason() external;
    function setStakingSeasonPeriod(uint256 _period) external;
    function getCurrentStakeSeason() external view returns (uint256);

    // State-only functions for Vault
    function stakeState(address staker, uint256 mode, uint256 amount) external;
    function claimState(address staker, uint256 mode, uint256 seasonId) external returns (uint256 reward);
    function unstakeState(address staker, uint256 mode) external returns (uint256 releaseAmount);
}


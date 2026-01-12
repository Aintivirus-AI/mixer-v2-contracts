// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/IAintiVirusStaking.sol";
import "./CoreFactory.sol";

contract AintiVirusStaking is IAintiVirusStaking {
    uint256 public constant DAY_IN_SECONDS = 86400;

    address public override immutable vault; // Factory/Vault address

    uint256 public override stakingSeasonPeriod;
    uint256 public override currentStakeSeason;

    mapping(uint256 => StakeSeason) public override stakeSeasons;
    mapping(address => StakerRecord) public override stakeRecords;
    mapping(address => mapping(uint256 => bool)) public override addressToSeasonClaimedEth;
    mapping(address => mapping(uint256 => bool)) public override addressToSeasonClaimedToken;

    constructor(address _vault) {
        vault = _vault;

        currentStakeSeason = 1;
        stakingSeasonPeriod = 30 days;

        stakeSeasons[currentStakeSeason] = StakeSeason(
            currentStakeSeason,
            block.timestamp,
            block.timestamp + stakingSeasonPeriod,
            stakingSeasonPeriod,
            0,
            0,
            0,
            0,
            0,
            0
        );
    }

    // ============ MODIFIERS ============

    /**
     * @dev Modifier to validate asset mode
     * @param _mode The asset mode to validate
     */
    modifier validAssetMode(uint256 _mode) {
        require(
            _mode == uint256(CoreFactory.AssetMode.ETH) || _mode == uint256(CoreFactory.AssetMode.TOKEN),
            "Invalid mode"
        );
        _;
    }

    // ============ FUNCTIONS ============

    /**
     * @dev State-only function to add rewards to the current staking season
     * Funds are held by the Factory, this only updates state
     * @param mode The asset mode (0 for ETH, 1 for Token)
     * @param amount Amount of reward to add
     */
    function addRewards(
        uint256 mode,
        uint256 amount
    ) external override validAssetMode(mode) {
        require(msg.sender == vault, "Only vault can call");
        require(amount > 0, "Amount must be greater than zero");
        
        if (mode == uint256(CoreFactory.AssetMode.ETH)) {
            stakeSeasons[currentStakeSeason].totalRewardEthAmount += amount;
        } else {
            stakeSeasons[currentStakeSeason].totalRewardTokenAmount += amount;
        }
        
        emit RewardAdded(amount, mode, currentStakeSeason);
    }


    /**
     * @dev State-only stake function for Vault to call
     * @param staker The staker address
     * @param mode The asset mode (0 for ETH, 1 for Token)
     * @param amount The amount to stake
     */
    function stakeState(address staker, uint256 mode, uint256 amount) external override validAssetMode(mode) {
        require(msg.sender == vault, "Only vault can call");
        require(
            block.timestamp <= stakeSeasons[currentStakeSeason].endTimestamp,
            "Current staking season expired"
        );
        require(amount > 0, "Amount must be greater than zero");

        uint256 timeLeftTillSeasonEnd = stakeSeasons[currentStakeSeason]
            .endTimestamp - block.timestamp;
        uint256 stakerWeight = (amount * timeLeftTillSeasonEnd) / DAY_IN_SECONDS;

        if (mode == uint256(CoreFactory.AssetMode.ETH)) {
            require(
                stakeRecords[staker].stakedEthAmount == 0,
                "User already staked ETH"
            );

            stakeSeasons[currentStakeSeason].totalStakedEthAmount += amount;
            stakeSeasons[currentStakeSeason].totalEthWeightValue += stakerWeight;

            stakeRecords[staker].stakedEthAmount = amount;
            stakeRecords[staker].ethStakedTimestamp = block.timestamp;
            stakeRecords[staker].ethStakedSeasonId = currentStakeSeason;
            stakeRecords[staker].ethWeightValue = stakerWeight;

            emit StakedEth(staker, amount, currentStakeSeason);
        } else {
            require(
                stakeRecords[staker].stakedTokenAmount == 0,
                "User already staked Token"
            );

            stakeSeasons[currentStakeSeason].totalStakedTokenAmount += amount;
            stakeSeasons[currentStakeSeason].totalTokenWeightValue += stakerWeight;

            stakeRecords[staker].stakedTokenAmount = amount;
            stakeRecords[staker].tokenStakedTimestamp = block.timestamp;
            stakeRecords[staker].tokenStakedSeasonId = currentStakeSeason;
            stakeRecords[staker].tokenWeightValue = stakerWeight;

            emit StakedToken(staker, amount, currentStakeSeason);
        }
    }


    /**
     * @dev State-only claim function for Vault to call
     * @param staker The staker address
     * @param mode The asset mode (0 for ETH, 1 for Token)
     * @param seasonId The season ID to claim rewards from
     * @return reward The reward amount to be claimed
     */
    function claimState(address staker, uint256 mode, uint256 seasonId) external override validAssetMode(mode) returns (uint256 reward) {
        require(msg.sender == vault, "Only vault can call");
        require(seasonId <= currentStakeSeason, "Season is not started yet");
        require(
            stakeSeasons[seasonId].endTimestamp < block.timestamp,
            "Current season is still active"
        );

        uint256 weightValue;
        uint256 stakedSeasonId;
        uint256 stakedAmount;
        uint256 totalRewardAmount;
        uint256 totalWeightValue;

        if (mode == uint256(CoreFactory.AssetMode.ETH)) {
            require(
                stakeRecords[staker].ethStakedSeasonId <= seasonId,
                "User has not staked in this season"
            );
            require(
                stakeRecords[staker].ethWeightValue > 0,
                "No reward to claim"
            );
            require(
                addressToSeasonClaimedEth[staker][seasonId] == false,
                "User already claimed this season's rewards"
            );

            addressToSeasonClaimedEth[staker][seasonId] = true;
            stakedSeasonId = stakeRecords[staker].ethStakedSeasonId;
            stakedAmount = stakeRecords[staker].stakedEthAmount;
            totalRewardAmount = stakeSeasons[seasonId].totalRewardEthAmount;
            totalWeightValue = stakeSeasons[seasonId].totalEthWeightValue;

            if (seasonId == stakedSeasonId) {
                weightValue = stakeRecords[staker].ethWeightValue;
            } else {
                weightValue = (stakedAmount * stakeSeasons[seasonId].stakingSeasonPeriod) / DAY_IN_SECONDS;
            }

            reward = (totalRewardAmount * weightValue) / totalWeightValue;
            emit ClaimedEth(staker, reward, seasonId);
        } else {
            require(
                stakeRecords[staker].tokenStakedSeasonId >= seasonId,
                "User has not staked in this season"
            );
            require(
                stakeRecords[staker].tokenWeightValue > 0,
                "No reward to claim"
            );
            require(
                addressToSeasonClaimedToken[staker][seasonId] == false,
                "User already claimed this season's rewards"
            );

            addressToSeasonClaimedToken[staker][seasonId] = true;
            stakedSeasonId = stakeRecords[staker].tokenStakedSeasonId;
            stakedAmount = stakeRecords[staker].stakedTokenAmount;
            totalRewardAmount = stakeSeasons[seasonId].totalRewardTokenAmount;
            totalWeightValue = stakeSeasons[seasonId].totalTokenWeightValue;

            if (seasonId == stakedSeasonId) {
                weightValue = stakeRecords[staker].tokenWeightValue;
            } else {
                weightValue = (stakedAmount * stakeSeasons[seasonId].stakingSeasonPeriod) / DAY_IN_SECONDS;
            }

            reward = (totalRewardAmount * weightValue) / totalWeightValue;
            emit ClaimedToken(staker, reward, seasonId);
        }
    }


    /**
     * @dev State-only unstake function for Vault to call
     * @param staker The staker address
     * @param mode The asset mode (0 for ETH, 1 for Token)
     * @return releaseAmount The amount to be released
     */
    function unstakeState(address staker, uint256 mode) external override validAssetMode(mode) returns (uint256 releaseAmount) {
        require(msg.sender == vault, "Only vault can call");

        if (mode == uint256(CoreFactory.AssetMode.ETH)) {
            require(
                stakeRecords[staker].stakedEthAmount > 0,
                "No staked balance to unstake"
            );

            releaseAmount = stakeRecords[staker].stakedEthAmount;
            uint256 stakedSeasonId = stakeRecords[staker].ethStakedSeasonId;
            uint256 weightToRemove;

            // Calculate weight to remove based on current season
            if (currentStakeSeason == stakedSeasonId) {
                // If unstaking from the same season they staked, remove actual weight
                weightToRemove = stakeRecords[staker].ethWeightValue;
            } else {
                // Otherwise, remove full period weight (same as claim calculation)
                weightToRemove = (releaseAmount * stakeSeasons[currentStakeSeason].stakingSeasonPeriod) / DAY_IN_SECONDS;
            }

            stakeSeasons[currentStakeSeason].totalStakedEthAmount -= releaseAmount;
            stakeSeasons[currentStakeSeason].totalEthWeightValue -= weightToRemove;

            stakeRecords[staker].stakedEthAmount = 0;
            stakeRecords[staker].ethWeightValue = 0;

            emit UnstakedEth(staker, releaseAmount);
        } else {
            require(
                stakeRecords[staker].stakedTokenAmount > 0,
                "No staked balance to unstake"
            );

            releaseAmount = stakeRecords[staker].stakedTokenAmount;
            uint256 stakedSeasonId = stakeRecords[staker].tokenStakedSeasonId;
            uint256 weightToRemove;

            // Calculate weight to remove based on current season
            if (currentStakeSeason == stakedSeasonId) {
                // If unstaking from the same season they staked, remove actual weight
                weightToRemove = stakeRecords[staker].tokenWeightValue;
            } else {
                // Otherwise, remove full period weight (same as claim calculation)
                weightToRemove = (releaseAmount * stakeSeasons[currentStakeSeason].stakingSeasonPeriod) / DAY_IN_SECONDS;
            }

            stakeSeasons[currentStakeSeason].totalStakedTokenAmount -= releaseAmount;
            stakeSeasons[currentStakeSeason].totalTokenWeightValue -= weightToRemove;

            stakeRecords[staker].stakedTokenAmount = 0;
            stakeRecords[staker].tokenWeightValue = 0;

            emit UnstakedToken(staker, releaseAmount);
        }
    }


    function startStakeSeason() external override {
        require(msg.sender == vault, "Only vault can call");
        require(
            stakeSeasons[currentStakeSeason].endTimestamp < block.timestamp,
            "Current season is still active"
        );

        // Transfer current season's data to next season
        stakeSeasons[currentStakeSeason + 1] = stakeSeasons[currentStakeSeason];

        stakeSeasons[currentStakeSeason + 1].seasonId = currentStakeSeason + 1;
        
        stakeSeasons[currentStakeSeason + 1].startTimestamp = block.timestamp;
        stakeSeasons[currentStakeSeason + 1].stakingSeasonPeriod = stakingSeasonPeriod;
        stakeSeasons[currentStakeSeason + 1].endTimestamp =
            block.timestamp +
            stakingSeasonPeriod;

        stakeSeasons[currentStakeSeason + 1].totalEthWeightValue  = (stakeSeasons[currentStakeSeason].totalStakedEthAmount * stakingSeasonPeriod) / DAY_IN_SECONDS;

        stakeSeasons[currentStakeSeason + 1].totalTokenWeightValue = (stakeSeasons[currentStakeSeason].totalStakedTokenAmount * stakingSeasonPeriod) / DAY_IN_SECONDS;

        stakeSeasons[currentStakeSeason + 1].totalRewardEthAmount = 0;
        stakeSeasons[currentStakeSeason + 1].totalRewardTokenAmount = 0;

        currentStakeSeason++;

        emit SeasonStarted(
            currentStakeSeason,
            stakeSeasons[currentStakeSeason].startTimestamp,
            stakeSeasons[currentStakeSeason].endTimestamp
        );
    }


    function setStakingSeasonPeriod(
        uint256 _period
    ) external override {
        require(msg.sender == vault, "Only vault can call");
        require(
            stakingSeasonPeriod != _period,
            "New value must not be same with current value"
        );
        stakingSeasonPeriod = _period;
    }

    function getCurrentStakeSeason() external view override returns (uint256) {
        return currentStakeSeason;
    }

    function getCurrentWeight(address staker, uint256 mode) external view returns (uint256 weight) {
        if (mode == uint256(CoreFactory.AssetMode.ETH)) {
            uint256 stakedSeasonId = stakeRecords[staker].ethStakedSeasonId;

            if (currentStakeSeason == stakedSeasonId) {
                return stakeRecords[staker].ethWeightValue;
            } else {
                return
                    (stakeRecords[staker].stakedEthAmount * stakeSeasons[currentStakeSeason].stakingSeasonPeriod) / DAY_IN_SECONDS;
            }
        } else {
            uint256 stakedSeasonId = stakeRecords[staker].tokenStakedSeasonId;

            if (currentStakeSeason == stakedSeasonId) {
                return stakeRecords[staker].tokenWeightValue;
            } else {
                return
                    (stakeRecords[staker].stakedTokenAmount * stakeSeasons[currentStakeSeason].stakingSeasonPeriod) / DAY_IN_SECONDS;
            }
        }
    }
}


// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "./MerkleTreeWithHistory.sol";

interface IVerifier {
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[6] calldata _pubSignals
    ) external view returns (bool);
}

contract AintiVirusMixer is
    MerkleTreeWithHistory,
    ReentrancyGuard,
    AccessControl
{
    using Address for address;
    using Address for address payable;
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    uint256 public constant DAY_IN_SECONDS = 86400;
    uint256 public constant MODE_ETH = 1;
    uint256 public constant MODE_TOKEN = 2;

    IVerifier public immutable verifier;
    IERC20Metadata public immutable mixToken;

    uint256 public feeRate; // fee percentage amount for operator
    uint256 public minETHDepositAmount; // Minimum deposit amount for ETH
    uint256 public minTokenDepositAmount; // Minimum deposit amount for token

    // Commitments
    mapping(bytes32 => bool) public commitments;

    // Nullifier mappings
    mapping(bytes32 => bool) public nullifierHashes;

    struct WithdrawalProof {
        uint[2] pA;
        uint[2][2] pB;
        uint[2] pC;
        uint[6] pubSignals;
    }

    uint256 public stakingSeasonPeriod;
    uint256 public currentStakeSeason;

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

    mapping(uint256 => StakeSeason) public stakeSeasons;
    mapping(address => StakerRecord) public stakeRecords;
    mapping(address => mapping(uint256 => bool)) public addressToSeasonClaimedEth;
    mapping(address => mapping(uint256 => bool)) public addressToSeasonClaimedToken;

    event Deposit(
        bytes32 indexed commitment,
        uint32 leafIndex,
        uint256 timestamp
    );
    event Withdrawal(address to, bytes32 nullifierHash);

    constructor(
        address _token,
        address _verifier,
        address _hasher
    ) MerkleTreeWithHistory(24, IPoseidon(_hasher)) {
        mixToken = IERC20Metadata(_token);

        verifier = IVerifier(_verifier);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);

        feeRate = 250; // 0.25%

        minETHDepositAmount = 0.01 ether;
        minTokenDepositAmount = 500 * (10 ** mixToken.decimals());

        currentStakeSeason = 1;
        stakingSeasonPeriod = 30 days;

        stakeSeasons[currentStakeSeason] = StakeSeason(
            currentStakeSeason,
            block.timestamp,
            block.timestamp + stakingSeasonPeriod,
            0,
            0,
            0,
            0,
            0,
            0
        );
    }

    function deposit(
        uint256 _mode,
        uint256 _amount,
        bytes32 _commitment
    ) public payable nonReentrant {
        require(!commitments[_commitment], "The commitment has been submitted");

        // Set deposit commitment TRUE
        uint32 insertedIndex = _insert(_commitment);
        commitments[_commitment] = true;

        uint256 fee = (_amount * feeRate) / 100000;

        if (_mode == MODE_ETH) {
            require(
                msg.value >= minETHDepositAmount,
                "Deposit amount is under than minimum deposit amount"
            );
            require(msg.value >= _amount + fee, "Insufficient ETH deposit");

            stakeSeasons[currentStakeSeason].totalRewardEthAmount += fee;
        } else if (_mode == MODE_TOKEN) {
            require(
                _amount >= minTokenDepositAmount,
                "Deposit amount is under than minimum deposit amount"
            );
            require(
                mixToken.balanceOf(msg.sender) >= _amount + fee,
                "Insufficient ERC20 balance"
            );

            SafeERC20.safeTransferFrom(
                mixToken,
                msg.sender,
                address(this),
                _amount + fee
            );

            stakeSeasons[currentStakeSeason].totalRewardTokenAmount += fee;
        } else {
            revert("Invalid mode");
        }

        emit Deposit(_commitment, insertedIndex, block.timestamp);
    }
    function withdraw(
        WithdrawalProof calldata _proof,
        address payable _recipient
    ) public nonReentrant {
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
            isKnownRoot(bytes32(_proof.pubSignals[3])),
            "Cannot find your merkle root"
        );

        nullifierHashes[nullifierHash] = true;

        uint256 amount = _proof.pubSignals[1];
        uint256 mode = _proof.pubSignals[2];

        // Withdrawal process
        if (mode == MODE_ETH) {
            _recipient.sendValue(amount);
        } else if (mode == MODE_TOKEN) {
            SafeERC20.safeTransfer(mixToken, _recipient, amount);
        } else {
            revert("Invalid mode");
        }
    }

    function stakeEther(uint256 amount) public payable nonReentrant {
        require(
            block.timestamp <= stakeSeasons[currentStakeSeason].endTimestamp,
            "Current staking season expired"
        );
        require(amount <= msg.value, "Invalid staking amount");

        require(
            stakeRecords[msg.sender].stakedEthAmount == 0,
            "User already staked"
        );

        // Increase total staked ETH amount in the current seasoon
        stakeSeasons[currentStakeSeason].totalStakedEthAmount += amount;

        // Calculate and increase user's staking weight value
        uint256 daysLeftTillSeasonEnd = (stakeSeasons[currentStakeSeason]
            .endTimestamp - block.timestamp) / DAY_IN_SECONDS;
        uint256 stakerWeight = amount * daysLeftTillSeasonEnd;

        stakeSeasons[currentStakeSeason].totalEthWeightValue += stakerWeight;

        stakeRecords[msg.sender].stakedEthAmount = amount;
        stakeRecords[msg.sender].ethStakedTimestamp = block.timestamp;
        stakeRecords[msg.sender].ethStakedSeasonId = currentStakeSeason;
        stakeRecords[msg.sender].ethWeightValue = stakerWeight;
    }

    function stakeToken(uint256 amount) public nonReentrant {
        require(
            block.timestamp <= stakeSeasons[currentStakeSeason].endTimestamp,
            "Current staking season expired"
        );

        require(
            stakeRecords[msg.sender].stakedTokenAmount == 0,
            "User already staked"
        );

        // Transfer token from staker to contract
        SafeERC20.safeTransferFrom(mixToken, msg.sender, address(this), amount);

        // Increase total staked token amount in the current seasoon
        stakeSeasons[currentStakeSeason].totalStakedTokenAmount += amount;

        // Calculate and increase user's staking weight value
        uint256 daysLeftTillSeasonEnd = (stakeSeasons[currentStakeSeason]
            .endTimestamp - block.timestamp) / DAY_IN_SECONDS;
        uint256 stakerWeight = amount * daysLeftTillSeasonEnd;

        stakeSeasons[currentStakeSeason].totalTokenWeightValue += stakerWeight;

        stakeRecords[msg.sender].stakedTokenAmount = amount;
        stakeRecords[msg.sender].tokenStakedTimestamp = block.timestamp;
        stakeRecords[msg.sender].tokenStakedSeasonId = currentStakeSeason;
        stakeRecords[msg.sender].tokenWeightValue = stakerWeight;
    }

    function claimEth(uint256 seasonId) public nonReentrant {
        require(seasonId <= currentStakeSeason, "Season is not started yet");
        require(
            stakeSeasons[seasonId].endTimestamp < block.timestamp,
            "Current season is still active"
        );

        require(
            stakeRecords[msg.sender].ethWeightValue > 0,
            "No reward to claim"
        );

        require(
            addressToSeasonClaimedEth[msg.sender][seasonId] == false,
            "User already claimed this season's rewards"
        );

        addressToSeasonClaimedEth[msg.sender][seasonId] = true;

        uint256 ethWeightValue = 0;

        if (seasonId == stakeRecords[msg.sender].ethStakedSeasonId) {
            ethWeightValue = stakeRecords[msg.sender].ethWeightValue;
        } else {
            ethWeightValue =
                stakeRecords[msg.sender].stakedEthAmount *
                (stakingSeasonPeriod / DAY_IN_SECONDS);
        }

        uint256 ethReward = (stakeSeasons[seasonId].totalRewardEthAmount *
            ethWeightValue) / stakeSeasons[seasonId].totalEthWeightValue;

        // ETH claim process
        payable(msg.sender).sendValue(ethReward);
    }

    function claimToken(uint256 seasonId) public nonReentrant {
        require(seasonId <= currentStakeSeason, "Season is not started yet");
        require(
            stakeSeasons[seasonId].endTimestamp < block.timestamp,
            "Current season is still active"
        );

        require(
            stakeRecords[msg.sender].tokenWeightValue > 0,
            "No reward to claim"
        );

        require(
            addressToSeasonClaimedToken[msg.sender][seasonId] == false,
            "User already claimed this season's rewards"
        );

        addressToSeasonClaimedToken[msg.sender][seasonId] = true;

        uint256 tokenWeightValue = 0;

        if (seasonId == stakeRecords[msg.sender].tokenStakedSeasonId) {
            tokenWeightValue = stakeRecords[msg.sender].tokenWeightValue;
        } else {
            tokenWeightValue =
                stakeRecords[msg.sender].stakedTokenAmount *
                (stakingSeasonPeriod / DAY_IN_SECONDS);
        }

        uint256 tokenReward = (stakeSeasons[seasonId].totalRewardTokenAmount *
            tokenWeightValue) / stakeSeasons[seasonId].totalTokenWeightValue;

        // Token claim process
        SafeERC20.safeTransfer(mixToken, msg.sender, tokenReward);
    }

    function unstakeEth() public payable nonReentrant {
        require(
            stakeRecords[msg.sender].stakedEthAmount > 0,
            "No staked balance to unstake"
        );

        uint256 releaseAmount = stakeRecords[msg.sender].stakedEthAmount;

        // Reset stake record
        stakeRecords[msg.sender].stakedEthAmount = 0;
        stakeRecords[msg.sender].ethWeightValue = 0;

        // Unstaking process
        payable(msg.sender).sendValue(releaseAmount);
    }

    function unstakeToken() public payable nonReentrant {
        require(
            stakeRecords[msg.sender].stakedTokenAmount > 0,
            "No staked balance to unstake"
        );

        uint256 releaseAmount = stakeRecords[msg.sender].stakedTokenAmount;

        // Reset stake record
        stakeRecords[msg.sender].stakedTokenAmount = 0;
        stakeRecords[msg.sender].tokenWeightValue = 0;

        // Unstaking process
        SafeERC20.safeTransfer(
            mixToken,
            msg.sender,
            releaseAmount
        );
    }

    function startStakeSeason() public onlyRole(OPERATOR_ROLE) {
        require(
            stakeSeasons[currentStakeSeason].endTimestamp < block.timestamp,
            "Current season is still active"
        );

        // Transfer current season's data to next season
        stakeSeasons[currentStakeSeason + 1] = stakeSeasons[currentStakeSeason];

        stakeSeasons[currentStakeSeason + 1].startTimestamp = block.timestamp;
        stakeSeasons[currentStakeSeason + 1].endTimestamp =
            block.timestamp +
            stakingSeasonPeriod;

        stakeSeasons[currentStakeSeason + 1].totalEthWeightValue +=
            stakeSeasons[currentStakeSeason + 1].totalStakedEthAmount *
            (stakingSeasonPeriod / DAY_IN_SECONDS);

        stakeSeasons[currentStakeSeason + 1].totalTokenWeightValue +=
            stakeSeasons[currentStakeSeason + 1].totalStakedTokenAmount *
            (stakingSeasonPeriod / DAY_IN_SECONDS);

        currentStakeSeason++;
    }

    function setMinETHDepositValue(
        uint256 _value
    ) external onlyRole(OPERATOR_ROLE) {
        require(minETHDepositAmount != _value, "Can not set as current value");
        minETHDepositAmount = _value;
    }

    function setMinTokenDepositValue(
        uint256 _value
    ) external onlyRole(OPERATOR_ROLE) {
        require(
            minTokenDepositAmount != _value,
            "Can not set as current value"
        );
        minTokenDepositAmount = _value;
    }

    function setFeeRate(uint256 _fee) external onlyRole(OPERATOR_ROLE) {
        require(
            feeRate != _fee,
            "New value must not be same with current value"
        );
        feeRate = _fee;
    }

    function setStakingSeasonPeriod(
        uint256 _period
    ) external onlyRole(OPERATOR_ROLE) {
        require(
            stakingSeasonPeriod != _period,
            "New value must not be same with current value"
        );
        stakingSeasonPeriod = _period;
    }

    function getCurrentStakeSeason() public view returns (uint256) {
        return currentStakeSeason;
    }

    function calculateDepositAmount(
        uint256 _amount
    ) public view returns (uint256) {
        uint256 fee = (_amount * feeRate) / 100000;

        return fee + _amount;
    }

    receive() external payable {}
}

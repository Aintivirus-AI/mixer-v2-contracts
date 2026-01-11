// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./core/CoreFactory.sol";
import "./core/AintiVirusMixer.sol";
import "./core/AintiVirusStaking.sol";
import "./interfaces/IAintiVirusStaking.sol";

contract AintiVirusFactory is CoreFactory {
    using Address for address;
    using Address for address payable;
    using SafeERC20 for IERC20;

    IAintiVirusStaking public immutable staking;
    IERC20Metadata public immutable mixToken;
    
    // Mapping to track Mixer instances: mode => amount => mixer address
    mapping(uint256 => mapping(uint256 => address)) public mixers;
    
    event ContractsDeployed(
        address indexed deployer,
        address indexed staking
    );
    event MixerDeployed(
        address indexed mixer,
        uint256 indexed mode,
        uint256 indexed amount
    );
    event Withdrawal(address to, bytes32 nullifierHash);

    /**
     * @dev Deploy Staking contract and initialize as Payment Vault
     * Note: Mixer contracts will be deployed separately for each fixed amount
     * @param _token Address of the ERC20 token contract
     * @param _verifier Address of the verifier contract
     * @param _hasher Address of the Poseidon hasher contract
     * @param _feeRate Fee rate (e.g., 250 for 0.25%)
     */
    constructor(
        address _token,
        address _verifier,
        address _hasher,
        uint256 _feeRate
    ) CoreFactory(_verifier, _hasher, _feeRate) {
        mixToken = IERC20Metadata(_token);

        // Deploy Staking contract
        AintiVirusStaking stakingContract = new AintiVirusStaking(address(this));
        staking = IAintiVirusStaking(address(stakingContract));

        emit ContractsDeployed(msg.sender, address(stakingContract));
    }

    // ============ INTERNAL HELPER FUNCTIONS ============

    /**
     * @dev Get mixer route (address) for given mode and amount
     * Validates mode and amount, returns the mixer contract address
     * @param _mode The mode (0 for ETH, 1 for Token)
     * @param _amount The amount
     * @return mixerAddress The mixer contract address for this route
     */
    function _getMixerRoute(uint256 _mode, uint256 _amount) internal view returns (address mixerAddress) {
        require(
            _mode == uint256(AssetMode.ETH) || _mode == uint256(AssetMode.TOKEN),
            "Invalid mode"
        );
        
        mixerAddress = mixers[_mode][_amount];
        require(mixerAddress != address(0), "Mixer not deployed for this mode and amount");
    }

    // ============ MIXER FUNCTIONS ============

    /**
     * @dev Deploy a new Mixer contract for a specific fixed amount
     * @param _mode The mode (0 for ETH, 1 for Token)
     * @param _amount The fixed amount for this Mixer instance
     * @return mixerAddress The address of the deployed Mixer contract
     */
    function deployMixer(
        uint256 _mode,
        uint256 _amount
    ) external onlyRole(OPERATOR_ROLE) returns (address mixerAddress) {
        require(_mode == uint256(AssetMode.ETH) || _mode == uint256(AssetMode.TOKEN), "Invalid mode");
        require(mixers[_mode][_amount] == address(0), "Mixer already exists for this amount");

        AintiVirusMixer mixerContract = new AintiVirusMixer(
            verifier,
            hasher,
            address(this)
        );
        
        mixerAddress = address(mixerContract);
        mixers[_mode][_amount] = mixerAddress;

        emit MixerDeployed(mixerAddress, _mode, _amount);
    }

    /**
     * @dev Deposit funds into the mixer (Factory holds funds, Mixer manages state)
     * @param _mode The mode (0 for ETH, 1 for Token)
     * @param _amount The deposit amount (must match the Mixer's fixed amount)
     * @param _commitment The commitment hash
     */
    function deposit(
        uint256 _mode,
        uint256 _amount,
        bytes32 _commitment
    ) public payable nonReentrant {
        // Validate and get mixer address
        address mixerAddress = _getMixerRoute(_mode, _amount);
        
        uint256 fee = (_amount * feeRate) / 100000;

        if (_mode == uint256(AssetMode.ETH)) {
            require(msg.value == _amount + fee, "ETH amount must equal deposit + fee exactly");
        } else {
            require(
                mixToken.balanceOf(msg.sender) >= _amount + fee,
                "Insufficient ERC20 balance"
            );

            // Transfer tokens to Factory (vault)
            SafeERC20.safeTransferFrom(
                mixToken,
                msg.sender,
                address(this),
                _amount + fee
            );
        }

        // Delegate state management to Mixer (commitments, merkle tree)
        AintiVirusMixer mixerContract = AintiVirusMixer(mixerAddress);
        mixerContract.depositState(_commitment);

        // Update staking rewards state (fees stay in Factory)
        if (fee > 0) {
            staking.addRewards(_mode, fee);
        }
    }

    /**
     * @dev Withdraw funds from mixer (Factory sends funds, Mixer validates state)
     * @param _proof The withdrawal proof to validate
     * @param _amount The withdrawal amount (fixed for this Mixer instance)
     * @param _mode The withdrawal mode (0 for ETH, 1 for Token)
     */
    function withdraw(
        AintiVirusMixer.WithdrawalProof calldata _proof,
        uint256 _amount,
        uint256 _mode
    ) public nonReentrant {
        // Validate and get mixer address
        address mixerAddress = _getMixerRoute(_mode, _amount);
        
        // Validate proof and state in the specific Mixer, get recipient from proof
        AintiVirusMixer mixerContract = AintiVirusMixer(mixerAddress);
        address payable recipient = payable(mixerContract.validateWithdraw(_proof));

        // Factory sends the funds
        if (_mode == uint256(AssetMode.ETH)) {
            recipient.sendValue(_amount);
        } else {
            SafeERC20.safeTransfer(mixToken, recipient, _amount);
        }

        emit Withdrawal(recipient, bytes32(_proof.pubSignals[0]));
    }

    // ============ STAKING FUNCTIONS ============

    /**
     * @dev Stake ETH (Factory holds funds, Staking manages state)
     */
    function stakeEther(uint256 amount) public payable nonReentrant {
        require(amount > 0, "Amount must be greater than zero");
        require(msg.value == amount, "ETH amount must equal stake amount exactly");

        // Delegate state management to Staking (validates season and duplicate staking)
        staking.stakeState(msg.sender, uint256(AssetMode.ETH), amount);
    }

    /**
     * @dev Stake tokens (Factory holds funds, Staking manages state)
     */
    function stakeToken(uint256 amount) public nonReentrant {
        require(amount > 0, "Amount must be greater than zero");
        require(
            mixToken.balanceOf(msg.sender) >= amount,
            "Insufficient token balance"
        );

        // Transfer tokens to Factory
        SafeERC20.safeTransferFrom(mixToken, msg.sender, address(this), amount);

        // Delegate state management to Staking (validates season and duplicate staking)
        staking.stakeState(msg.sender, uint256(AssetMode.TOKEN), amount);
    }

    /**
     * @dev Claim ETH rewards (Factory sends funds, Staking validates state)
     */
    function claimEth(uint256 seasonId) public nonReentrant {
        // Validate and update state in Staking, get reward amount
        uint256 ethReward = staking.claimState(msg.sender, uint256(AssetMode.ETH), seasonId);

        // Factory sends the funds
        payable(msg.sender).sendValue(ethReward);
    }

    /**
     * @dev Claim token rewards (Factory sends funds, Staking validates state)
     */
    function claimToken(uint256 seasonId) public nonReentrant {
        // Validate and update state in Staking, get reward amount
        uint256 tokenReward = staking.claimState(msg.sender, uint256(AssetMode.TOKEN), seasonId);

        // Factory sends the funds
        SafeERC20.safeTransfer(mixToken, msg.sender, tokenReward);
    }

    /**
     * @dev Unstake ETH (Factory sends funds, Staking updates state)
     */
    function unstakeEth() public nonReentrant {
        // Update state in Staking, get release amount
        uint256 releaseAmount = staking.unstakeState(msg.sender, uint256(AssetMode.ETH));

        // Factory sends the funds
        payable(msg.sender).sendValue(releaseAmount);
    }

    /**
     * @dev Unstake tokens (Factory sends funds, Staking updates state)
     */
    function unstakeToken() public nonReentrant {
        // Update state in Staking, get release amount
        uint256 releaseAmount = staking.unstakeState(msg.sender, uint256(AssetMode.TOKEN));

        // Factory sends the funds
        SafeERC20.safeTransfer(mixToken, msg.sender, releaseAmount);
    }

    // ============ ADMIN FUNCTIONS ============

    function setStakingSeasonPeriod(uint256 _period) external onlyRole(OPERATOR_ROLE) {
        staking.setStakingSeasonPeriod(_period);
    }

    function startStakeSeason() external onlyRole(OPERATOR_ROLE) {
        staking.startStakeSeason();
    }

    // ============ VIEW FUNCTIONS ============
    
    /**
     * @dev Get the Mixer address for a specific mode and amount
     * @param _mode The mode (0 for ETH, 1 for Token)
     * @param _amount The fixed amount
     * @return The Mixer contract address, or address(0) if not deployed
     */
    function getMixer(uint256 _mode, uint256 _amount) public view returns (address) {
        return mixers[_mode][_amount];
    }

    function getCurrentStakeSeason() public view returns (uint256) {
        return staking.getCurrentStakeSeason();
    }

    receive() external payable {}
}


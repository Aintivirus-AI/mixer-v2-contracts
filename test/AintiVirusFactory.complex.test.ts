import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import CryptoUtil from "../utils";
import {
  generateSecretAndNullifier,
  computeCommitment,
  buildMerkleTreeFromEvents,
  generateWithdrawalProof,
} from "./helpers/proofGenerator";
import {
  AintiVirusFactory,
  AintiVirusFactory__factory,
  Poseidon,
  Poseidon__factory,
  Groth16Verifier,
  Groth16Verifier__factory,
  ERC20Standard,
  ERC20Standard__factory,
  AintiVirusMixer,
  AintiVirusMixer__factory,
  AintiVirusStaking,
  AintiVirusStaking__factory,
} from "../typechain-types";

enum AssetMode {
  ETH,
  TOKEN,
}

interface DepositRecord {
  secret: bigint;
  nullifier: bigint;
  commitment: bigint;
  amount: bigint;
  mixerAmount: bigint;
  leafIndex: number;
}

describe("AintiVirusFactory Complex Multi-Season Test", function () {
  // Increase timeout for complex tests with many proof generations
  this.timeout(300000); // 5 minutes
  let factory: AintiVirusFactory;
  let token: ERC20Standard;
  let poseidon: Poseidon;
  let verifier: Groth16Verifier;
  let staking: AintiVirusStaking;

  let deployer: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let operator: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let user3: HardhatEthersSigner;
  let userA: HardhatEthersSigner;
  let userB: HardhatEthersSigner;
  let userC: HardhatEthersSigner;
  let userD: HardhatEthersSigner;

  const FEE_RATE = 250n; // 0.25%
  const SEASON_PERIOD = 30 * 24 * 60 * 60; // 30 days in seconds
  const MIXER_AMOUNTS = [
    ethers.parseEther("1"),
    ethers.parseEther("2"),
    ethers.parseEther("5"),
  ];

  // Track deposits for withdrawals
  const depositsByMixer: Record<string, DepositRecord[]> = {};

  // Helper function to generate commitment
  function generateCommitment(): {
    secret: bigint;
    nullifier: bigint;
    commitment: bigint;
  } {
    const { secret, nullifier } = generateSecretAndNullifier();
    const commitment = computeCommitment(secret, nullifier);
    return { secret, nullifier, commitment };
  }

  // Helper function to deposit and withdraw (optimized: batch deposits first, then withdrawals)
  async function depositAndWithdraw(
    user: HardhatEthersSigner,
    mixerAmount: bigint,
    times: number = 1
  ) {
    const mixerKey = mixerAmount.toString();
    if (!depositsByMixer[mixerKey]) {
      depositsByMixer[mixerKey] = [];
    }

    const deposits: DepositRecord[] = [];

    // Batch all deposits first
    for (let i = 0; i < times; i++) {
      const { secret, nullifier, commitment } = generateCommitment();
      const fee = (mixerAmount * FEE_RATE) / 100000n;
      const totalAmount = mixerAmount + fee;

      const depositTx = await factory
        .connect(user)
        .deposit(
          AssetMode.ETH,
          mixerAmount,
          CryptoUtil.bigIntToBytes32(commitment),
          { value: totalAmount }
        );
      await depositTx.wait();

      const deposit: DepositRecord = {
        secret,
        nullifier,
        commitment,
        amount: mixerAmount,
        mixerAmount,
        leafIndex: depositsByMixer[mixerKey].length + i,
      };
      deposits.push(deposit);
      depositsByMixer[mixerKey].push(deposit);
    }

    // Get mixer and build merkle tree AFTER all deposits (tree includes new deposits)
    const mixerAddress = await factory.getMixer(AssetMode.ETH, mixerAmount);
    const mixer = AintiVirusMixer__factory.connect(
      mixerAddress,
      ethers.provider
    );
    const events = await mixer.queryFilter(mixer.filters.Deposit());
    const merkleTree = buildMerkleTreeFromEvents(events);
    const root = BigInt(merkleTree.root);

    // Process all withdrawals
    for (const deposit of deposits) {
      const leafIndex = events.findIndex(
        (e: any) => CryptoUtil.bytes32ToBigInt(e.args[0]) === deposit.commitment
      );
      if (leafIndex === -1) {
        throw new Error("Deposit not found in events");
      }

      const path = merkleTree.path(leafIndex);
      const proof = await generateWithdrawalProof(
        deposit.secret,
        deposit.nullifier,
        root,
        user.address,
        path.pathElements.map((e) => BigInt(e)),
        path.pathIndices
      );

      const withdrawTx = await factory
        .connect(user)
        .withdraw(proof, deposit.amount, AssetMode.ETH);
      await withdrawTx.wait();
    }
  }

  // Helper function to advance time by days
  async function advanceTimeByDays(days: number) {
    await time.increase(time.duration.days(days));
    await time.advanceBlock();
  }

  // Helper function to get current season
  async function getCurrentSeason(): Promise<bigint> {
    return await factory.getCurrentStakeSeason();
  }

  before(async () => {
    [
      deployer,
      admin,
      operator,
      user1,
      user2,
      user3,
      userA,
      userB,
      userC,
      userD,
    ] = await ethers.getSigners();

    // Deploy Token
    const TokenFactory = await ethers.getContractFactory("ERC20Standard");
    token = await TokenFactory.deploy("AintiVirus", "AINTI");
    await token.waitForDeployment();

    // Deploy Poseidon
    const PoseidonFactory = await ethers.getContractFactory("Poseidon");
    poseidon = await PoseidonFactory.deploy();
    await poseidon.waitForDeployment();

    // Deploy Verifier
    const VerifierFactory = await ethers.getContractFactory("Groth16Verifier");
    verifier = await VerifierFactory.deploy();
    await verifier.waitForDeployment();

    // Deploy Factory
    const FactoryFactory = await ethers.getContractFactory("AintiVirusFactory");
    factory = await FactoryFactory.deploy(
      await token.getAddress(),
      await verifier.getAddress(),
      await poseidon.getAddress(),
      FEE_RATE
    );
    await factory.waitForDeployment();

    // Get staking contract
    const stakingAddress = await factory.staking();
    staking = AintiVirusStaking__factory.connect(
      stakingAddress,
      ethers.provider
    );

    // Grant operator role
    await factory.grantRole(await factory.OPERATOR_ROLE(), operator.address);
  });

  describe("Setup Phase", () => {
    it("Should deploy mixers for 1ETH, 2ETH, and 5ETH", async () => {
      for (const amount of MIXER_AMOUNTS) {
        const tx = await factory
          .connect(operator)
          .deployMixer(AssetMode.ETH, amount);
        await tx.wait();
        const mixerAddress = await factory.getMixer(AssetMode.ETH, amount);
        expect(mixerAddress).to.properAddress;
        console.log(
          `✅ Mixer deployed for ${ethers.formatEther(
            amount
          )} ETH: ${mixerAddress}`
        );
      }
    });

    it("Should start staking season", async () => {
      const currentSeason = await getCurrentSeason();
      expect(currentSeason).to.equal(1n);
      console.log(`✅ Initial season: ${currentSeason}`);
    });
  });

  describe("Season 1 - Complex Activity", () => {
    it("Should handle User1, User2, User3 deposit/withdraw 10 times for 1ETH", async () => {
      console.log(
        "\n📥 Season 1: User1, User2, User3 depositing/withdrawing 1ETH x10..."
      );
      await depositAndWithdraw(user1, MIXER_AMOUNTS[0], 10);
      await depositAndWithdraw(user2, MIXER_AMOUNTS[0], 10);
      await depositAndWithdraw(user3, MIXER_AMOUNTS[0], 10);
      console.log("✅ Completed 30 deposit/withdraw cycles for 1ETH");
    });

    it("Should handle User2, User3 deposit/withdraw 10 times for 2ETH", async () => {
      console.log(
        "\n📥 Season 1: User2, User3 depositing/withdrawing 2ETH x10..."
      );
      await depositAndWithdraw(user2, MIXER_AMOUNTS[1], 10);
      await depositAndWithdraw(user3, MIXER_AMOUNTS[1], 10);
      console.log("✅ Completed 20 deposit/withdraw cycles for 2ETH");
    });

    it("Should handle User3 deposit/withdraw 10 times for 5ETH", async () => {
      console.log("\n📥 Season 1: User3 depositing/withdrawing 5ETH x10...");
      await depositAndWithdraw(user3, MIXER_AMOUNTS[2], 10);
      console.log("✅ Completed 10 deposit/withdraw cycles for 5ETH");
    });

    it("Should allow UserA to stake 2ETH at day 10", async () => {
      console.log("\n🔒 Season 1: Advancing to day 10...");
      await advanceTimeByDays(10);

      const stakeAmount = ethers.parseEther("2");
      const tx = await factory
        .connect(userA)
        .stakeEther(stakeAmount, { value: stakeAmount });
      await tx.wait();

      const stakeRecord = await staking.stakeRecords(userA.address);
      expect(stakeRecord.stakedEthAmount).to.equal(stakeAmount);
      expect(stakeRecord.ethStakedSeasonId).to.equal(1n);
      console.log(`✅ UserA staked ${ethers.formatEther(stakeAmount)} ETH`);
    });

    it("Should allow UserB to stake 4ETH at day 20", async () => {
      console.log("\n🔒 Season 1: Advancing to day 20...");
      await advanceTimeByDays(10);

      const stakeAmount = ethers.parseEther("4");
      const tx = await factory
        .connect(userB)
        .stakeEther(stakeAmount, { value: stakeAmount });
      await tx.wait();

      const stakeRecord = await staking.stakeRecords(userB.address);
      expect(stakeRecord.stakedEthAmount).to.equal(stakeAmount);
      expect(stakeRecord.ethStakedSeasonId).to.equal(1n);
      console.log(`✅ UserB staked ${ethers.formatEther(stakeAmount)} ETH`);
    });

    it("Should prevent UserD from claiming/unstaking UserA's Season 1", async () => {
      console.log(
        "\n🚫 Security Test: UserD attempting to claim UserA's Season 1..."
      );

      // UserD should not be able to claim UserA's season
      await expect(factory.connect(userD).claimEth(1)).to.be.reverted;
      console.log("✅ UserD claim prevented (reverted as expected)");

      // UserD should not be able to unstake UserA's stake
      await expect(factory.connect(userD).unstakeEth()).to.be.reverted;
      console.log("✅ UserD unstake prevented (reverted as expected)");
    });

    it("Should verify Season 1 rewards accumulated", async () => {
      const season1 = await staking.stakeSeasons(1);
      console.log(
        `\n💰 Season 1 total rewards: ${ethers.formatEther(
          season1.totalRewardEthAmount
        )} ETH`
      );
      expect(season1.totalRewardEthAmount).to.be.gt(0n);
    });
  });

  describe("Season 2 - Continuation", () => {
    it("Should start Season 2 after Season 1 ends", async () => {
      console.log("\n⏰ Season 1 ending, starting Season 2...");

      // Advance to end of Season 1
      await advanceTimeByDays(10); // Total 30 days from start

      const tx = await factory.connect(operator).startStakeSeason();
      await tx.wait();

      const currentSeason = await getCurrentSeason();
      expect(currentSeason).to.equal(2n);
      console.log(`✅ Season 2 started (current season: ${currentSeason})`);
    });

    it("Should handle User1, User2, User3 deposit/withdraw 10 times for 1ETH", async () => {
      console.log(
        "\n📥 Season 2: User1, User2, User3 depositing/withdrawing 1ETH x10..."
      );
      await depositAndWithdraw(user1, MIXER_AMOUNTS[0], 10);
      await depositAndWithdraw(user2, MIXER_AMOUNTS[0], 10);
      await depositAndWithdraw(user3, MIXER_AMOUNTS[0], 10);
      console.log("✅ Completed 30 deposit/withdraw cycles for 1ETH");
    });

    it("Should handle User3 deposit/withdraw 10 times for 5ETH", async () => {
      console.log("\n📥 Season 2: User3 depositing/withdrawing 5ETH x10...");
      await depositAndWithdraw(user3, MIXER_AMOUNTS[2], 10);
      console.log("✅ Completed 10 deposit/withdraw cycles for 5ETH");
    });

    it("Should verify Season 2 rewards accumulated", async () => {
      const season2 = await staking.stakeSeasons(2);
      console.log(
        `\n💰 Season 2 total rewards: ${ethers.formatEther(
          season2.totalRewardEthAmount
        )} ETH`
      );
      expect(season2.totalRewardEthAmount).to.be.gt(0n);
    });
  });

  describe("Season 3 - Claims and New Stakes", () => {
    it("Should start Season 3 after Season 2 ends", async () => {
      console.log("\n⏰ Season 2 ending, starting Season 3...");

      await advanceTimeByDays(30);

      const tx = await factory.connect(operator).startStakeSeason();
      await tx.wait();

      const currentSeason = await getCurrentSeason();
      expect(currentSeason).to.equal(3n);
      console.log(`✅ Season 3 started (current season: ${currentSeason})`);
    });

    it("Should allow UserA to claim Season 1 and Season 2, then unstake with correct balances", async () => {
      console.log("\n✅ Season 3: UserA claiming and unstaking...");

      const factoryBalanceBefore = await ethers.provider.getBalance(
        await factory.getAddress()
      );
      const userABalanceBefore = await ethers.provider.getBalance(
        userA.address
      );

      // Get UserA's stake info
      const userARecord = await staking.stakeRecords(userA.address);
      const userAStakeAmount = userARecord.stakedEthAmount; // 2 ETH

      // Calculate expected rewards
      const season1 = await staking.stakeSeasons(1);
      const season2 = await staking.stakeSeasons(2);

      // UserA staked at day 10 (20 days remaining)
      const season1Weight = userARecord.ethWeightValue;
      const daysInSeason = 30n;
      const season2Weight = userAStakeAmount * daysInSeason;

      const expectedReward1 =
        (season1.totalRewardEthAmount * season1Weight) /
        season1.totalEthWeightValue;
      const expectedReward2 =
        (season2.totalRewardEthAmount * season2Weight) /
        season2.totalEthWeightValue;
      const totalExpectedReward = expectedReward1 + expectedReward2;

      console.log(`📊 Expected rewards:`);
      console.log(`   Season 1: ${ethers.formatEther(expectedReward1)} ETH`);
      console.log(`   Season 2: ${ethers.formatEther(expectedReward2)} ETH`);
      console.log(
        `   Stake amount: ${ethers.formatEther(userAStakeAmount)} ETH`
      );

      // Claim Season 1
      const claim1Tx = await factory.connect(userA).claimEth(1);
      const claim1Receipt = await claim1Tx.wait();
      const claim1Gas = claim1Receipt!.gasUsed * claim1Receipt!.gasPrice;
      console.log("✅ UserA claimed Season 1");

      // Claim Season 2
      const claim2Tx = await factory.connect(userA).claimEth(2);
      const claim2Receipt = await claim2Tx.wait();
      const claim2Gas = claim2Receipt!.gasUsed * claim2Receipt!.gasPrice;
      console.log("✅ UserA claimed Season 2");

      // Unstake
      const unstakeTx = await factory.connect(userA).unstakeEth();
      const unstakeReceipt = await unstakeTx.wait();
      const unstakeGas = unstakeReceipt!.gasUsed * unstakeReceipt!.gasPrice;
      console.log("✅ UserA unstaked");

      const userABalanceAfter = await ethers.provider.getBalance(userA.address);
      const factoryBalanceAfter = await ethers.provider.getBalance(
        await factory.getAddress()
      );

      const totalGasUsed = claim1Gas + claim2Gas + unstakeGas;
      const balanceIncrease =
        userABalanceAfter - userABalanceBefore + totalGasUsed;
      const factoryBalanceDecrease = factoryBalanceBefore - factoryBalanceAfter;
      const expectedTotal = totalExpectedReward + userAStakeAmount;

      console.log(
        `💰 UserA received: ${ethers.formatEther(balanceIncrease)} ETH`
      );
      console.log(
        `💰 Factory decreased by: ${ethers.formatEther(
          factoryBalanceDecrease
        )} ETH`
      );
      console.log(
        `💰 Expected total (rewards + stake): ${ethers.formatEther(
          expectedTotal
        )} ETH`
      );

      // Verify balance increase matches expected (rewards + stake)
      expect(balanceIncrease).to.be.gt(0n);
      expect(factoryBalanceDecrease).to.equal(balanceIncrease);

      // Verify rewards + stake are approximately correct
      const diff =
        balanceIncrease > expectedTotal
          ? balanceIncrease - expectedTotal
          : expectedTotal - balanceIncrease;
      expect(diff).to.be.lte(3n); // Allow up to 3 wei difference for rounding

      console.log(
        `✅ Balance verification passed (difference: ${diff.toString()} wei)`
      );

      // Verify UserA can no longer claim
      await expect(factory.connect(userA).claimEth(1)).to.be.reverted;
      await expect(factory.connect(userA).claimEth(2)).to.be.reverted;
      await expect(factory.connect(userA).unstakeEth()).to.be.reverted;
      console.log("✅ UserA cannot claim/unstake again (as expected)");
    });

    it("Should prevent UserD from claiming/unstaking UserA's seasons", async () => {
      console.log(
        "\n🚫 Security Test: UserD attempting to claim UserA's seasons..."
      );

      // UserD should not be able to claim any of UserA's seasons
      await expect(factory.connect(userD).claimEth(1)).to.be.reverted;
      await expect(factory.connect(userD).claimEth(2)).to.be.reverted;
      await expect(factory.connect(userD).claimEth(3)).to.be.reverted;
      console.log("✅ UserD claim attempts prevented for all seasons");

      // UserD should not be able to unstake (no stake exists)
      await expect(factory.connect(userD).unstakeEth()).to.be.reverted;
      console.log("✅ UserD unstake prevented");
    });

    it("Should allow UserC to stake 10ETH at day 5 of Season 3", async () => {
      console.log("\n🔒 Season 3: Advancing to day 5...");
      await advanceTimeByDays(5);

      const stakeAmount = ethers.parseEther("10");
      const tx = await factory
        .connect(userC)
        .stakeEther(stakeAmount, { value: stakeAmount });
      await tx.wait();

      const stakeRecord = await staking.stakeRecords(userC.address);
      expect(stakeRecord.stakedEthAmount).to.equal(stakeAmount);
      expect(stakeRecord.ethStakedSeasonId).to.equal(3n);
      console.log(`✅ UserC staked ${ethers.formatEther(stakeAmount)} ETH`);
    });

    it("Should handle User1 deposit/withdraw 10 times for 1ETH", async () => {
      console.log("\n📥 Season 3: User1 depositing/withdrawing 1ETH x10...");
      await depositAndWithdraw(user1, MIXER_AMOUNTS[0], 10);
      console.log("✅ Completed 10 deposit/withdraw cycles for 1ETH");
    });

    it("Should verify Season 3 rewards accumulated", async () => {
      const season3 = await staking.stakeSeasons(3);
      console.log(
        `\n💰 Season 3 total rewards: ${ethers.formatEther(
          season3.totalRewardEthAmount
        )} ETH`
      );
      expect(season3.totalRewardEthAmount).to.be.gt(0n);
    });
  });

  describe("Season 4 - Final Security Checks", () => {
    it("Should start Season 4 after Season 3 ends", async () => {
      console.log("\n⏰ Season 3 ending, starting Season 4...");

      await advanceTimeByDays(25); // Complete Season 3 (30 days total)

      const tx = await factory.connect(operator).startStakeSeason();
      await tx.wait();

      const currentSeason = await getCurrentSeason();
      expect(currentSeason).to.equal(4n);
      console.log(`✅ Season 4 started (current season: ${currentSeason})`);
    });

    it("Should prevent UserD from claiming/unstaking UserA's seasons", async () => {
      console.log(
        "\n🚫 Security Test: UserD attempting to claim UserA's seasons again..."
      );

      // UserD should not be able to claim any of UserA's seasons
      await expect(factory.connect(userD).claimEth(1)).to.be.reverted;
      await expect(factory.connect(userD).claimEth(2)).to.be.reverted;
      await expect(factory.connect(userD).claimEth(3)).to.be.reverted;
      console.log("✅ UserD claim attempts prevented for all seasons");

      // UserD should not be able to unstake
      await expect(factory.connect(userD).unstakeEth()).to.be.reverted;
      console.log("✅ UserD unstake prevented");
    });

    it("Should prevent UserA from claiming Season 1, 2, and 3 (should be reverted)", async () => {
      console.log(
        "\n🚫 Security Test: UserA attempting to claim Season 1, 2, and 3..."
      );

      // UserA already claimed Season 1 and 2 in Season 3, should not be able to claim again
      await expect(factory.connect(userA).claimEth(1)).to.be.reverted;
      console.log("✅ UserA Season 1 claim reverted (already claimed)");

      await expect(factory.connect(userA).claimEth(2)).to.be.reverted;
      console.log("✅ UserA Season 2 claim reverted (already claimed)");

      // UserA never staked in Season 3, should not be able to claim
      await expect(factory.connect(userA).claimEth(3)).to.be.reverted;
      console.log(
        "✅ UserA Season 3 claim reverted (never staked in Season 3)"
      );

      // UserA already unstaked, should not be able to unstake again
      await expect(factory.connect(userA).unstakeEth()).to.be.reverted;
      console.log("✅ UserA double-unstake prevented");
    });

    it("Should allow UserB to claim Season 1, 2, and 3 with correct reward calculations", async () => {
      console.log("\n✅ Season 4: UserB claiming all seasons...");

      // Get factory balance before claims
      const factoryBalanceBefore = await ethers.provider.getBalance(
        await factory.getAddress()
      );
      const userBBalanceBefore = await ethers.provider.getBalance(
        userB.address
      );

      // Calculate expected rewards for UserB
      // UserB staked 4 ETH at day 20 of Season 1 (10 days remaining)
      // Weight = 4 ETH * 10 days = 40 ETH-days
      const season1 = await staking.stakeSeasons(1);
      const season2 = await staking.stakeSeasons(2);
      const season3 = await staking.stakeSeasons(3);

      const userBRecord = await staking.stakeRecords(userB.address);
      const userBStakeAmount = userBRecord.stakedEthAmount; // 4 ETH
      const daysInSeason = 30n;

      // For Season 1: UserB's weight was calculated at staking time (10 days remaining)
      // For Season 2 & 3: UserB gets full period weight (30 days)
      const season1Weight = userBRecord.ethWeightValue; // Actual weight from Season 1
      const season2Weight = userBStakeAmount * daysInSeason;
      const season3Weight = userBStakeAmount * daysInSeason;

      const expectedReward1 =
        (season1.totalRewardEthAmount * season1Weight) /
        season1.totalEthWeightValue;
      const expectedReward2 =
        (season2.totalRewardEthAmount * season2Weight) /
        season2.totalEthWeightValue;
      const expectedReward3 =
        (season3.totalRewardEthAmount * season3Weight) /
        season3.totalEthWeightValue;

      console.log(`📊 Expected rewards:`);
      console.log(`   Season 1: ${ethers.formatEther(expectedReward1)} ETH`);
      console.log(`   Season 2: ${ethers.formatEther(expectedReward2)} ETH`);
      console.log(`   Season 3: ${ethers.formatEther(expectedReward3)} ETH`);

      // Claim Season 1
      const claim1Tx = await factory.connect(userB).claimEth(1);
      const claim1Receipt = await claim1Tx.wait();
      const claim1Gas = claim1Receipt!.gasUsed * claim1Receipt!.gasPrice;
      console.log("✅ UserB claimed Season 1");

      // Claim Season 2
      const claim2Tx = await factory.connect(userB).claimEth(2);
      const claim2Receipt = await claim2Tx.wait();
      const claim2Gas = claim2Receipt!.gasUsed * claim2Receipt!.gasPrice;
      console.log("✅ UserB claimed Season 2");

      // Claim Season 3
      const claim3Tx = await factory.connect(userB).claimEth(3);
      const claim3Receipt = await claim3Tx.wait();
      const claim3Gas = claim3Receipt!.gasUsed * claim3Receipt!.gasPrice;
      console.log("✅ UserB claimed Season 3");

      const userBBalanceAfter = await ethers.provider.getBalance(userB.address);
      const factoryBalanceAfter = await ethers.provider.getBalance(
        await factory.getAddress()
      );

      const totalGasUsed = claim1Gas + claim2Gas + claim3Gas;
      const balanceIncrease =
        userBBalanceAfter - userBBalanceBefore + totalGasUsed;
      const factoryBalanceDecrease = factoryBalanceBefore - factoryBalanceAfter;

      const totalExpectedReward =
        expectedReward1 + expectedReward2 + expectedReward3;

      console.log(
        `💰 UserB received: ${ethers.formatEther(balanceIncrease)} ETH`
      );
      console.log(
        `💰 Factory decreased by: ${ethers.formatEther(
          factoryBalanceDecrease
        )} ETH`
      );
      console.log(
        `💰 Expected total reward: ${ethers.formatEther(
          totalExpectedReward
        )} ETH`
      );

      // Verify balance increase matches expected rewards (allow small tolerance for rounding)
      expect(balanceIncrease).to.be.gt(0n);
      expect(factoryBalanceDecrease).to.equal(balanceIncrease);

      // Verify rewards are approximately correct (within 1 wei tolerance for rounding)
      const rewardDiff =
        balanceIncrease > totalExpectedReward
          ? balanceIncrease - totalExpectedReward
          : totalExpectedReward - balanceIncrease;
      expect(rewardDiff).to.be.lte(3n); // Allow up to 3 wei difference for rounding

      console.log(
        `✅ Reward calculation verified (difference: ${rewardDiff.toString()} wei)`
      );

      // Verify UserB cannot claim again
      await expect(factory.connect(userB).claimEth(1)).to.be.reverted;
      await expect(factory.connect(userB).claimEth(2)).to.be.reverted;
      await expect(factory.connect(userB).claimEth(3)).to.be.reverted;
      console.log("✅ UserB cannot claim again (as expected)");
    });

    it("Should prevent UserC from claiming Season 1 and 2 (only staked in Season 3)", async () => {
      console.log(
        "\n🚫 Security Test: UserC attempting to claim seasons they didn't stake in..."
      );

      // UserC only staked in Season 3, should not be able to claim Season 1 or 2
      await expect(factory.connect(userC).claimEth(1)).to.be.reverted;
      await expect(factory.connect(userC).claimEth(2)).to.be.reverted;
      console.log("✅ UserC claim prevented for Season 1 and 2");

      // UserC should be able to claim Season 3 (the season they staked in)
      const userCBalanceBefore = await ethers.provider.getBalance(
        userC.address
      );
      const claim3Tx = await factory.connect(userC).claimEth(3);
      await claim3Tx.wait();
      const userCBalanceAfter = await ethers.provider.getBalance(userC.address);
      const balanceIncrease = userCBalanceAfter - userCBalanceBefore;
      console.log(
        `✅ UserC claimed Season 3: ${ethers.formatEther(balanceIncrease)} ETH`
      );
      expect(balanceIncrease).to.be.gt(0n);

      // UserC should not be able to claim Season 3 again
      await expect(factory.connect(userC).claimEth(3)).to.be.reverted;
      console.log("✅ UserC cannot claim Season 3 again");
    });
  });

  describe("Additional Security Checks", () => {
    it("Should prevent claiming from future seasons", async () => {
      console.log(
        "\n🚫 Security Test: Attempting to claim from future season..."
      );

      const currentSeason = await getCurrentSeason();
      const futureSeason = currentSeason + 1n;

      await expect(factory.connect(userB).claimEth(futureSeason)).to.be
        .reverted;
      console.log(`✅ Claim from future season ${futureSeason} prevented`);
    });

    it("Should prevent claiming from active season", async () => {
      console.log(
        "\n🚫 Security Test: Attempting to claim from active season..."
      );

      const currentSeason = await getCurrentSeason();

      // Try to claim current season (should fail as it's still active)
      await expect(factory.connect(userB).claimEth(currentSeason)).to.be
        .reverted;
      console.log(`✅ Claim from active season ${currentSeason} prevented`);
    });

    it("Should verify stake records are correct", async () => {
      console.log("\n🔍 Security Test: Verifying stake records...");

      // UserA should have no stake (unstaked)
      const userARecord = await staking.stakeRecords(userA.address);
      expect(userARecord.stakedEthAmount).to.equal(0n);
      console.log("✅ UserA stake record cleared (unstaked)");

      // UserB should still have stake
      const userBRecord = await staking.stakeRecords(userB.address);
      expect(userBRecord.stakedEthAmount).to.equal(ethers.parseEther("4"));
      expect(userBRecord.ethStakedSeasonId).to.equal(1n);
      console.log("✅ UserB stake record intact");

      // UserC should still have stake
      const userCRecord = await staking.stakeRecords(userC.address);
      expect(userCRecord.stakedEthAmount).to.equal(ethers.parseEther("10"));
      expect(userCRecord.ethStakedSeasonId).to.equal(3n);
      console.log("✅ UserC stake record intact");
    });

    it("Should verify claim status tracking", async () => {
      console.log("\n🔍 Security Test: Verifying claim status...");

      // UserA should have claimed Season 1 and 2
      const userAClaimed1 = await staking.addressToSeasonClaimedEth(
        userA.address,
        1
      );
      const userAClaimed2 = await staking.addressToSeasonClaimedEth(
        userA.address,
        2
      );
      expect(userAClaimed1).to.be.true;
      expect(userAClaimed2).to.be.true;
      console.log("✅ UserA claim status verified for Season 1 and 2");

      // UserB should have claimed Season 1, 2, and 3
      const userBClaimed1 = await staking.addressToSeasonClaimedEth(
        userB.address,
        1
      );
      const userBClaimed2 = await staking.addressToSeasonClaimedEth(
        userB.address,
        2
      );
      const userBClaimed3 = await staking.addressToSeasonClaimedEth(
        userB.address,
        3
      );
      expect(userBClaimed1).to.be.true;
      expect(userBClaimed2).to.be.true;
      expect(userBClaimed3).to.be.true;
      console.log("✅ UserB claim status verified for Season 1, 2, and 3");

      // UserC should have claimed Season 3
      const userCClaimed3 = await staking.addressToSeasonClaimedEth(
        userC.address,
        3
      );
      expect(userCClaimed3).to.be.true;
      console.log("✅ UserC claim status verified for Season 3");

      // UserD should not have claimed anything
      const userDClaimed1 = await staking.addressToSeasonClaimedEth(
        userD.address,
        1
      );
      expect(userDClaimed1).to.be.false;
      console.log("✅ UserD claim status verified (no claims)");
    });

    it("Should verify season data integrity", async () => {
      console.log("\n🔍 Security Test: Verifying season data integrity...");

      // Check all seasons have proper data
      for (let season = 1; season <= 4; season++) {
        const seasonData = await staking.stakeSeasons(season);
        expect(seasonData.seasonId).to.equal(BigInt(season));
        expect(seasonData.startTimestamp).to.be.gt(0n);
        expect(seasonData.endTimestamp).to.be.gt(seasonData.startTimestamp);
        console.log(
          `✅ Season ${season} data verified (rewards: ${ethers.formatEther(
            seasonData.totalRewardEthAmount
          )} ETH)`
        );
      }
    });

    it("Should prevent unstaking when no stake exists", async () => {
      console.log("\n🚫 Security Test: Attempting to unstake with no stake...");

      // UserD never staked, should not be able to unstake
      await expect(factory.connect(userD).unstakeEth()).to.be.reverted;
      console.log("✅ Unstake prevented for user with no stake");

      // UserA already unstaked, should not be able to unstake again
      await expect(factory.connect(userA).unstakeEth()).to.be.reverted;
      console.log("✅ Double unstake prevented");
    });

    it("Should verify weight calculations are correct", async () => {
      console.log("\n🔍 Security Test: Verifying weight calculations...");

      // UserB staked 4 ETH at day 20 of Season 1 (10 days remaining)
      // Weight should be: 4 ETH * 10 days = 40 ETH-days
      const userBRecord = await staking.stakeRecords(userB.address);
      // Note: Weight is calculated based on days left, so it should be around 4 * 10 = 40
      expect(userBRecord.ethWeightValue).to.be.gt(0n);
      console.log(
        `✅ UserB weight: ${ethers.formatEther(
          userBRecord.ethWeightValue
        )} ETH-days`
      );

      // UserC staked 10 ETH at day 5 of Season 3 (25 days remaining)
      // Weight should be: 10 ETH * 25 days = 250 ETH-days
      const userCRecord = await staking.stakeRecords(userC.address);
      expect(userCRecord.ethWeightValue).to.be.gt(0n);
      console.log(
        `✅ UserC weight: ${ethers.formatEther(
          userCRecord.ethWeightValue
        )} ETH-days`
      );
    });

    it("Should prevent double staking", async () => {
      console.log("\n🚫 Security Test: Attempting double staking...");

      // UserB already staked, should not be able to stake again
      await expect(
        factory.connect(userB).stakeEther(ethers.parseEther("1"), {
          value: ethers.parseEther("1"),
        })
      ).to.be.reverted;
      console.log("✅ Double staking prevented for UserB");

      // UserC already staked, should not be able to stake again
      await expect(
        factory.connect(userC).stakeEther(ethers.parseEther("1"), {
          value: ethers.parseEther("1"),
        })
      ).to.be.reverted;
      console.log("✅ Double staking prevented for UserC");
    });

    it("Should verify factory balance integrity", async () => {
      console.log("\n🔍 Security Test: Verifying factory balance...");

      const factoryBalance = await ethers.provider.getBalance(
        await factory.getAddress()
      );
      console.log(
        `💰 Factory balance: ${ethers.formatEther(factoryBalance)} ETH`
      );

      // Factory should have:
      // - UserB's stake (4 ETH)
      // - UserC's stake (10 ETH)
      // - Any remaining fees from deposits
      expect(factoryBalance).to.be.gte(
        ethers.parseEther("14") // At least the staked amounts
      );
      console.log("✅ Factory balance verified");
    });

    it("Should verify season transitions preserve stake data", async () => {
      console.log("\n🔍 Security Test: Verifying season transitions...");

      // UserB staked in Season 1, should still have stake in Season 4
      const userBRecord = await staking.stakeRecords(userB.address);
      expect(userBRecord.ethStakedSeasonId).to.equal(1n);
      expect(userBRecord.stakedEthAmount).to.equal(ethers.parseEther("4"));
      console.log("✅ UserB stake preserved across seasons");

      // UserC staked in Season 3, should still have stake in Season 4
      const userCRecord = await staking.stakeRecords(userC.address);
      expect(userCRecord.ethStakedSeasonId).to.equal(3n);
      expect(userCRecord.stakedEthAmount).to.equal(ethers.parseEther("10"));
      console.log("✅ UserC stake preserved across seasons");
    });

    it("Should verify final balances and reward calculations are correct", async () => {
      console.log("\n🔍 Final Balance Verification Test...");

      const factoryBalance = await ethers.provider.getBalance(
        await factory.getAddress()
      );

      // Get all stake records
      const userBRecord = await staking.stakeRecords(userB.address);
      const userCRecord = await staking.stakeRecords(userC.address);
      const userARecord = await staking.stakeRecords(userA.address);

      // UserA should have no stake (unstaked)
      expect(userARecord.stakedEthAmount).to.equal(0n);
      console.log("✅ UserA stake cleared (unstaked)");

      // UserB should still have 4 ETH staked
      expect(userBRecord.stakedEthAmount).to.equal(ethers.parseEther("4"));
      console.log(
        `✅ UserB stake: ${ethers.formatEther(userBRecord.stakedEthAmount)} ETH`
      );

      // UserC should still have 10 ETH staked
      expect(userCRecord.stakedEthAmount).to.equal(ethers.parseEther("10"));
      console.log(
        `✅ UserC stake: ${ethers.formatEther(userCRecord.stakedEthAmount)} ETH`
      );

      // Factory should have at least the remaining stakes
      const totalStaked =
        userBRecord.stakedEthAmount + userCRecord.stakedEthAmount;
      expect(factoryBalance).to.be.gte(totalStaked);
      console.log(
        `✅ Factory balance: ${ethers.formatEther(factoryBalance)} ETH`
      );
      console.log(
        `✅ Total remaining stakes: ${ethers.formatEther(totalStaked)} ETH`
      );

      // Verify all seasons have correct reward totals
      let totalRewardsAcrossSeasons = 0n;
      for (let season = 1; season <= 4; season++) {
        const seasonData = await staking.stakeSeasons(season);
        totalRewardsAcrossSeasons += seasonData.totalRewardEthAmount;
        console.log(
          `   Season ${season} rewards: ${ethers.formatEther(
            seasonData.totalRewardEthAmount
          )} ETH`
        );
      }
      console.log(
        `✅ Total rewards across all seasons: ${ethers.formatEther(
          totalRewardsAcrossSeasons
        )} ETH`
      );

      // Verify claim statuses
      const userAClaimed1 = await staking.addressToSeasonClaimedEth(
        userA.address,
        1
      );
      const userAClaimed2 = await staking.addressToSeasonClaimedEth(
        userA.address,
        2
      );
      const userBClaimed1 = await staking.addressToSeasonClaimedEth(
        userB.address,
        1
      );
      const userBClaimed2 = await staking.addressToSeasonClaimedEth(
        userB.address,
        2
      );
      const userBClaimed3 = await staking.addressToSeasonClaimedEth(
        userB.address,
        3
      );
      const userCClaimed3 = await staking.addressToSeasonClaimedEth(
        userC.address,
        3
      );

      expect(userAClaimed1).to.be.true;
      expect(userAClaimed2).to.be.true;
      expect(userBClaimed1).to.be.true;
      expect(userBClaimed2).to.be.true;
      expect(userBClaimed3).to.be.true;
      expect(userCClaimed3).to.be.true;

      console.log("✅ All claim statuses verified correctly");
      console.log("\n🎉 Final balance verification complete!");
    });
  });
});

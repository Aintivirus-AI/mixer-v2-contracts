import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { poseidon2 } from "poseidon-lite";
import MerkleTree from "fixed-merkle-tree";
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
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("AintiVirusFactory", function () {
  let factory: AintiVirusFactory;
  let token: ERC20Standard;
  let poseidon: Poseidon;
  let verifier: Groth16Verifier;

  let deployer: HardhatEthersSigner;
  let operator: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let user3: HardhatEthersSigner;

  const FEE_RATE = 250n; // 0.25%
  const ETH_AMOUNT = ethers.parseEther("1");
  const TOKEN_AMOUNT = ethers.parseUnits("1000", 18);
  enum AssetMode {
    ETH,
    TOKEN,
  }

  // Test data storage
  const deposits: Array<{
    secret: bigint;
    nullifier: bigint;
    commitment: bigint;
    amount: bigint;
    mode: number;
    leafIndex: number;
  }> = [];

  before(async () => {
    [deployer, operator, user1, user2, user3] = await ethers.getSigners();
  });

  describe("Deployment", () => {
    it("Should deploy Token contract", async () => {
      const TokenFactory = await ethers.getContractFactory("ERC20Standard");
      token = await TokenFactory.deploy("AintiVirus", "AINTI");
      await token.waitForDeployment();
      console.log("✅ Token deployed at:", await token.getAddress());
    });

    it("Should deploy Poseidon hasher", async () => {
      const PoseidonFactory = await ethers.getContractFactory("Poseidon");
      poseidon = await PoseidonFactory.deploy();
      await poseidon.waitForDeployment();
      console.log("✅ Poseidon deployed at:", await poseidon.getAddress());
    });

    it("Should deploy Groth16 Verifier", async () => {
      const VerifierFactory = await ethers.getContractFactory(
        "Groth16Verifier"
      );
      verifier = await VerifierFactory.deploy();
      await verifier.waitForDeployment();
      console.log("✅ Verifier deployed at:", await verifier.getAddress());
    });

    it("Should deploy AintiVirusFactory", async () => {
      const FactoryFactory = await ethers.getContractFactory(
        "AintiVirusFactory"
      );
      factory = await FactoryFactory.deploy(
        await token.getAddress(),
        await verifier.getAddress(),
        await poseidon.getAddress(),
        FEE_RATE
      );
      await factory.waitForDeployment();
      console.log("✅ Factory deployed at:", await factory.getAddress());

      // Grant operator role to operator
      await factory.grantRole(await factory.OPERATOR_ROLE(), operator.address);
    });

    it("Should have correct initial state", async () => {
      expect(await factory.feeRate()).to.equal(FEE_RATE);
      expect(await factory.verifier()).to.equal(await verifier.getAddress());
      expect(await factory.hasher()).to.equal(await poseidon.getAddress());
      expect(await factory.mixToken()).to.equal(await token.getAddress());
    });

    it("Should have deployed Staking contract", async () => {
      const stakingAddress = await factory.staking();
      expect(stakingAddress).to.properAddress;
      console.log("✅ Staking deployed at:", stakingAddress);
    });
  });

  describe("Mixer Deployment", () => {
    it("Should deploy ETH mixer", async () => {
      const tx = await factory
        .connect(operator)
        .deployMixer(AssetMode.ETH, ETH_AMOUNT);
      const receipt = await tx.wait();

      const event = receipt?.logs.find(
        (log: any) => factory.interface.parseLog(log)?.name === "MixerDeployed"
      );
      expect(event).to.not.be.undefined;

      const mixerAddress = await factory.getMixer(0, ETH_AMOUNT);
      expect(mixerAddress).to.properAddress;
      console.log(
        `✅ ETH Mixer deployed at: ${mixerAddress} (Mode: ${AssetMode.ETH}, Amount: ${ETH_AMOUNT})`
      );
    });

    it("Should deploy Token mixer", async () => {
      const tx = await factory
        .connect(operator)
        .deployMixer(AssetMode.TOKEN, TOKEN_AMOUNT);
      await tx.wait();

      const mixerAddress = await factory.getMixer(
        AssetMode.TOKEN,
        TOKEN_AMOUNT
      );
      expect(mixerAddress).to.properAddress;
      console.log(
        `✅ Token Mixer deployed at: ${mixerAddress} (Mode: ${AssetMode.TOKEN}, Amount: ${TOKEN_AMOUNT})`
      );
    });

    it("Should revert when deploying duplicate mixer", async () => {
      await expect(
        factory.connect(operator).deployMixer(AssetMode.ETH, ETH_AMOUNT)
      ).to.be.revertedWith("Mixer already exists for this amount");
    });

    it("Should revert when non-operator tries to deploy", async () => {
      await expect(
        factory
          .connect(user1)
          .deployMixer(AssetMode.ETH, ethers.parseEther("2"))
      ).to.be.revertedWithCustomError(
        factory,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("Should revert with invalid mode", async () => {
      await expect(
        factory.connect(operator).deployMixer(2, ETH_AMOUNT)
      ).to.be.revertedWith("Invalid mode");
    });
  });

  // describe("ETH Deposits", () => {
  //   it("Should deposit ETH successfully", async () => {
  //     const { secret, nullifier, commitment } = generateCommitment();
  //     const fee = (ETH_AMOUNT * FEE_RATE) / 100000n;
  //     const totalAmount = ETH_AMOUNT + fee;

  //     const balanceBefore = await ethers.provider.getBalance(user1.address);
  //     const tx = await factory
  //       .connect(user1)
  //       .deposit(
  //         AssetMode.ETH,
  //         ETH_AMOUNT,
  //         CryptoUtil.bigIntToBytes32(commitment),
  //         {
  //           value: totalAmount,
  //         }
  //       );
  //     const receipt = await tx.wait();
  //     const balanceAfter = await ethers.provider.getBalance(user1.address);

  //     // Check event
  //     const depositEvent = receipt?.logs.find((log: any) => {
  //       try {
  //         const parsed = factory.interface.parseLog(log);
  //         return (
  //           parsed?.name === "Deposit" || parsed?.name === "ContractsDeployed"
  //         );
  //       } catch {
  //         return false;
  //       }
  //     });

  //     // Get mixer and check deposit event
  //     const mixerAddress = await factory.getMixer(AssetMode.ETH, ETH_AMOUNT);
  //     const mixer = AintiVirusMixer__factory.connect(
  //       mixerAddress,
  //       ethers.provider
  //     );
  //     const mixerEvents = await mixer.queryFilter(
  //       mixer.filters.Deposit(),
  //       receipt?.blockNumber
  //     );
  //     console.log(
  //       `ℹ️  Deposit events found: ${mixerEvents.length} at block ${receipt?.blockNumber}`
  //     );
  //     if (mixerEvents.length > 0) {
  //       console.log(
  //         `ℹ️  First commitment: ${mixerEvents[0].args[0].toString()}`
  //       );
  //     }
  //     expect(mixerEvents.length).to.be.greaterThan(0);

  //     deposits.push({
  //       secret,
  //       nullifier,
  //       commitment,
  //       amount: ETH_AMOUNT,
  //       mode: AssetMode.ETH,
  //       leafIndex: deposits.length,
  //     });

  //     expect(balanceAfter).to.be.lessThan(balanceBefore);
  //   });

  //   it("Should revert with insufficient ETH", async () => {
  //     const { commitment } = generateCommitment();
  //     const fee = (ETH_AMOUNT * FEE_RATE) / 100000n;
  //     const insufficientAmount = ETH_AMOUNT + fee - 1n;

  //     await expect(
  //       factory
  //         .connect(user1)
  //         .deposit(0, ETH_AMOUNT, CryptoUtil.bigIntToBytes32(commitment), {
  //           value: insufficientAmount,
  //         })
  //     ).to.be.revertedWith("Insufficient ETH deposit");
  //   });

  //   it("Should revert with non-existent mixer", async () => {
  //     const { commitment } = generateCommitment();
  //     const nonExistentAmount = ethers.parseEther("5");

  //     await expect(
  //       factory
  //         .connect(user1)
  //         .deposit(
  //           AssetMode.ETH,
  //           nonExistentAmount,
  //           CryptoUtil.bigIntToBytes32(commitment),
  //           { value: nonExistentAmount }
  //         )
  //     ).to.be.revertedWith("Mixer not deployed for this mode and amount");
  //   });
  // });

  // describe("Token Deposits", () => {
  //   it("Should transfer tokens to user", async () => {
  //     const transferAmount = ethers.parseUnits("10000", 18);
  //     // Token mints to deployer in constructor, so transfer from deployer
  //     await token.transfer(user2.address, transferAmount);
  //     expect(await token.balanceOf(user2.address)).to.equal(transferAmount);
  //   });

  //   it("Should deposit tokens successfully", async () => {
  //     const { secret, nullifier, commitment } = generateCommitment();
  //     const fee = (TOKEN_AMOUNT * FEE_RATE) / 100000n;
  //     const totalAmount = TOKEN_AMOUNT + fee;

  //     await token
  //       .connect(user2)
  //       .approve(await factory.getAddress(), totalAmount);

  //     const balanceBefore = await token.balanceOf(user2.address);
  //     const tx = await factory
  //       .connect(user2)
  //       .deposit(1, TOKEN_AMOUNT, CryptoUtil.bigIntToBytes32(commitment));
  //     await tx.wait();
  //     const balanceAfter = await token.balanceOf(user2.address);

  //     deposits.push({
  //       secret,
  //       nullifier,
  //       commitment,
  //       amount: TOKEN_AMOUNT,
  //       mode: 1,
  //       leafIndex: deposits.length,
  //     });

  //     expect(balanceAfter).to.equal(balanceBefore - totalAmount);
  //   });

  //   it("Should revert with insufficient token balance", async () => {
  //     const { commitment } = generateCommitment();
  //     // Use the deployed Token mixer amount but from an account with no tokens
  //     const insufficientPayer = user3;
  //     await expect(
  //       factory
  //         .connect(insufficientPayer)
  //         .deposit(1, TOKEN_AMOUNT, CryptoUtil.bigIntToBytes32(commitment))
  //     ).to.be.revertedWith("Insufficient ERC20 balance");
  //   });
  // });

  // describe("ETH Withdrawals", () => {
  //   it("Should withdraw ETH successfully", async () => {
  //     // Skip if no deposits exist
  //     const deposit = deposits.find((d) => d.mode === AssetMode.ETH);
  //     if (!deposit) {
  //       console.log("⚠️  No ETH deposit found, skipping withdrawal test");
  //       return;
  //     }

  //     // Build merkle tree from events
  //     const mixerAddress = await factory.getMixer(AssetMode.ETH, ETH_AMOUNT);
  //     const mixer = AintiVirusMixer__factory.connect(
  //       mixerAddress,
  //       ethers.provider
  //     );
  //     const events = await mixer.queryFilter(mixer.filters.Deposit());
  //     const merkleTree = buildMerkleTreeFromEvents(events);

  //     // Find the correct leaf index
  //     const leafIndex = events.findIndex(
  //       (e: any) => CryptoUtil.bytes32ToBigInt(e.args[0]) === deposit.commitment
  //     );
  //     if (leafIndex === -1) {
  //       console.log(
  //         "⚠️  Deposit not found in events, skipping withdrawal test"
  //       );
  //       return;
  //     }

  //     const path = merkleTree.path(leafIndex);
  //     const root = BigInt(merkleTree.root);
  //     const proof = await generateWithdrawalProof(
  //       deposit.secret,
  //       deposit.nullifier,
  //       root,
  //       user3.address,
  //       path.pathElements.map((e) => BigInt(e)),
  //       path.pathIndices
  //     );

  //     // Note: This test will fail with placeholder proof
  //     // To make it work, implement actual proof generation in proofGenerator.ts
  //     const userBalanceBefore = await ethers.provider.getBalance(user3.address);
  //     const factoryAddress = await factory.getAddress();
  //     const factoryBalanceBefore = await ethers.provider.getBalance(
  //       factoryAddress
  //     );
  //     console.log(
  //       `ℹ️  Before withdraw - user3 balance: ${userBalanceBefore.toString()}, factory balance: ${factoryBalanceBefore.toString()}`
  //     );

  //     // Skip actual withdrawal if proof is placeholder (all zeros)
  //     if (proof.pA[0] === 0n && proof.pA[1] === 0n) {
  //       console.log(
  //         "⚠️  Using placeholder proof - withdrawal will fail. Implement actual proof generation."
  //       );
  //       return;
  //     }

  //     const tx = await factory
  //       .connect(user3)
  //       .withdraw(proof, deposit.amount, AssetMode.ETH);
  //     const receipt = await tx.wait();

  //     const userBalanceAfter = await ethers.provider.getBalance(user3.address);
  //     const factoryBalanceAfter = await ethers.provider.getBalance(
  //       factoryAddress
  //     );
  //     console.log(
  //       `ℹ️  After withdraw - user3 balance: ${userBalanceAfter.toString()}, factory balance: ${factoryBalanceAfter.toString()}`
  //     );

  //     // User balance must increase (minus gas), and factory must lose exactly deposit.amount
  //     expect(userBalanceAfter).to.be.greaterThan(userBalanceBefore);
  //     expect(factoryBalanceBefore - factoryBalanceAfter).to.equal(
  //       deposit.amount
  //     );
  //   });
  // });

  // describe("Staking - ETH", () => {
  //   it("Should stake ETH successfully", async () => {
  //     const stakeAmount = ethers.parseEther("10");
  //     const balanceBefore = await ethers.provider.getBalance(user1.address);

  //     const tx = await factory
  //       .connect(user1)
  //       .stakeEther(stakeAmount, { value: stakeAmount });
  //     await tx.wait();

  //     const balanceAfter = await ethers.provider.getBalance(user1.address);
  //     expect(balanceAfter).to.be.lessThan(balanceBefore);
  //   });

  //   it("Should revert with insufficient ETH", async () => {
  //     const stakeAmount = ethers.parseEther("10");
  //     const insufficientAmount = ethers.parseEther("5");

  //     await expect(
  //       factory
  //         .connect(user1)
  //         .stakeEther(stakeAmount, { value: insufficientAmount })
  //     ).to.be.revertedWith("Insufficient ETH sent");
  //   });

  //   it("Should revert when trying to stake again", async () => {
  //     const stakeAmount = ethers.parseEther("5");

  //     await expect(
  //       factory.connect(user1).stakeEther(stakeAmount, { value: stakeAmount })
  //     ).to.be.revertedWith("User already staked ETH");
  //   });
  // });

  // describe("Staking - Tokens", () => {
  //   it("Should stake tokens successfully", async () => {
  //     const stakeAmount = ethers.parseUnits("1000", 18);
  //     // Transfer tokens from deployer to user2 if needed
  //     const balance = await token.balanceOf(user2.address);
  //     if (balance < stakeAmount) {
  //       await token.transfer(user2.address, stakeAmount);
  //     }
  //     await token
  //       .connect(user2)
  //       .approve(await factory.getAddress(), stakeAmount);

  //     const balanceBefore = await token.balanceOf(user2.address);
  //     await factory.connect(user2).stakeToken(stakeAmount);
  //     const balanceAfter = await token.balanceOf(user2.address);

  //     expect(balanceAfter).to.equal(balanceBefore - stakeAmount);
  //   });

  //   it("Should revert when trying to stake again", async () => {
  //     // user2 already staked in previous test, so this should revert
  //     const stakeAmount = ethers.parseUnits("500", 18);
  //     // Ensure user has balance (though it will fail before transfer due to duplicate staking check)
  //     const balance = await token.balanceOf(user2.address);
  //     if (balance < stakeAmount) {
  //       await token.transfer(user2.address, stakeAmount);
  //     }
  //     await token
  //       .connect(user2)
  //       .approve(await factory.getAddress(), stakeAmount);

  //     await expect(
  //       factory.connect(user2).stakeToken(stakeAmount)
  //     ).to.be.revertedWith("User already staked Token");
  //   });
  // });

  // describe("Staking - Claim Rewards", () => {
  //   it("Should add rewards to staking", async () => {
  //     // First, we need to add some rewards via deposits
  //     const { commitment } = generateCommitment();
  //     const fee = (ETH_AMOUNT * FEE_RATE) / 100000n;
  //     await factory
  //       .connect(user3)
  //       .deposit(0, ETH_AMOUNT, CryptoUtil.bigIntToBytes32(commitment), {
  //         value: ETH_AMOUNT + fee,
  //       });
  //   });

  //   it("Should start new season", async () => {
  //     // Fast forward time to end current season (30 days)
  //     const stakingAddress = await factory.staking();
  //     // Use the interface ABI to call the function
  //     const stakingAbi = [
  //       "function stakingSeasonPeriod() external view returns (uint256)",
  //     ];
  //     const stakingContract = new ethers.Contract(
  //       stakingAddress,
  //       stakingAbi,
  //       ethers.provider
  //     );
  //     const seasonPeriod = await stakingContract.stakingSeasonPeriod();

  //     // Increase time by season period + 1 day to ensure season ends
  //     await ethers.provider.send("evm_increaseTime", [
  //       Number(seasonPeriod) + 86400,
  //     ]);
  //     await ethers.provider.send("evm_mine", []);

  //     // Now we can start a new season
  //     await expect(factory.connect(operator).startStakeSeason()).to.not.be
  //       .reverted;
  //   });
  // });

  describe("Staking - Double Spending Prevention", () => {
    it("double spending", async () => {
      console.log("\n=== Double Spending Prevention Test ===");
      const StakingFactory = await ethers.getContractFactory(
        "AintiVirusStaking"
      );
      const staking = StakingFactory.attach(
        await factory.staking()
      ) as AintiVirusStaking;
      const depositAmount = ethers.parseEther("10");
      console.log(`📦 Deploying mixer for amount: ${depositAmount.toString()}`);
      await factory.connect(operator).deployMixer(AssetMode.ETH, depositAmount);
      const fee = (depositAmount * FEE_RATE) / 100000n;
      console.log(
        `💰 Fee calculated: ${fee.toString()} (${
          Number(FEE_RATE) / 1000
        }% of ${depositAmount.toString()})`
      );
      expect(fee).to.equal(ethers.parseEther("0.025")); // 0.25% of 10 ETH

      // user1 deposits at season 1
      console.log("\n📥 Season 1: user1 depositing...");
      await factory
        .connect(user1)
        .deposit(
          AssetMode.ETH,
          depositAmount,
          CryptoUtil.bigIntToBytes32(generateCommitment().commitment),
          {
            value: depositAmount + fee,
          }
        );
      let { totalRewardEthAmount } = await staking.stakeSeasons(1);
      console.log(
        `   Season 1 total rewards: ${totalRewardEthAmount.toString()}`
      );
      expect(totalRewardEthAmount).to.equal(fee);
      const factoryBalance = await ethers.provider.getBalance(
        await factory.getAddress()
      );
      console.log(`   Factory balance: ${factoryBalance.toString()}`);
      expect(factoryBalance).eq(depositAmount + fee);

      let ethWeightValue, totalEthWeightValue;

      // user2 stakes at season 1
      const user2Stake = ethers.parseEther("1");
      console.log(
        `\n🔒 Season 1: user2 staking ${user2Stake.toString()} ETH...`
      );
      await factory
        .connect(user2)
        .stakeEther(user2Stake, { value: user2Stake });
      ({ ethWeightValue } = await staking.stakeRecords(user2.address));
      ({ totalEthWeightValue } = await staking.stakeSeasons(1));
      console.log(`   user2 weight: ${ethWeightValue.toString()}`);
      console.log(
        `   Season 1 total weight: ${totalEthWeightValue.toString()}`
      );
      expect(ethWeightValue).to.equal(ethers.parseEther("29"));
      expect(totalEthWeightValue).to.equal(ethers.parseEther("29"));

      // operator starts season 2
      console.log("\n⏰ Advancing time by 30 days and starting Season 2...");
      await time.increase(time.duration.days(30));
      await factory.connect(operator).startStakeSeason();
      ({ totalEthWeightValue } = await staking.stakeSeasons(2));
      console.log(
        `   Season 2 total weight: ${totalEthWeightValue.toString()}`
      );
      expect(totalEthWeightValue).to.equal(ethers.parseEther("30"));

      // user3 stakes at season 2
      const user3Stake = ethers.parseEther("1");
      console.log(
        `\n🔒 Season 2: user3 staking ${user3Stake.toString()} ETH...`
      );
      await factory
        .connect(user3)
        .stakeEther(user3Stake, { value: user3Stake });
      ({ ethWeightValue } = await staking.stakeRecords(user3.address));
      ({ totalEthWeightValue } = await staking.stakeSeasons(2));
      console.log(`   user3 weight: ${ethWeightValue.toString()}`);
      console.log(
        `   Season 2 total weight: ${totalEthWeightValue.toString()}`
      );
      expect(ethWeightValue).to.equal(ethers.parseEther("29"));
      expect(totalEthWeightValue).to.equal(ethers.parseEther("59"));

      // user1 deposits at season 2
      console.log("\n📥 Season 2: user1 depositing again...");
      await factory
        .connect(user1)
        .deposit(
          AssetMode.ETH,
          depositAmount,
          CryptoUtil.bigIntToBytes32(generateCommitment().commitment),
          {
            value: depositAmount + fee,
          }
        );
      ({ totalRewardEthAmount } = await staking.stakeSeasons(2));
      console.log(
        `   Season 2 total rewards: ${totalRewardEthAmount.toString()}`
      );
      expect(totalRewardEthAmount).to.equal(ethers.parseEther("0.025")); // 2 fees = 0.025 * 2
      const factoryBalanceAfter = await ethers.provider.getBalance(
        await factory.getAddress()
      );
      console.log(`   Factory balance: ${factoryBalanceAfter.toString()}`);
      expect(factoryBalanceAfter).eq(
        depositAmount * 2n + fee * 2n + user2Stake + user3Stake
      );

      // operator starts season 3
      console.log("\n⏰ Advancing time by 30 days and starting Season 3...");
      await time.increase(time.duration.days(30));
      await factory.connect(operator).startStakeSeason();

      // Test claims - these should work
      console.log("\n✅ Testing valid claims...");
      const user2BalanceBefore = await ethers.provider.getBalance(
        user2.address
      );
      console.log(
        `   user2 balance before claim: ${user2BalanceBefore.toString()}`
      );
      await expect(factory.connect(user2).claimEth(1)).to.changeEtherBalance(
        user2,
        ethers.parseEther("0.025")
      );
      const user2BalanceAfter = await ethers.provider.getBalance(user2.address);
      console.log(
        `   ✅ user2 claimed Season 1: ${
          user2BalanceAfter - user2BalanceBefore
        } wei`
      );

      // Test double spending prevention - user2 should not be able to claim season 1 again
      console.log("\n🚫 Testing double spending prevention...");
      console.log(
        "   Attempting user2 to claim Season 1 again (should fail)..."
      );
      await expect(factory.connect(user2).claimEth(1)).to.be.reverted;
      console.log("   ✅ user2 double claim prevented (reverted as expected)");

      const user3BalanceBefore1 = await ethers.provider.getBalance(
        user3.address
      );
      console.log(
        `   user3 balance before claims: ${user3BalanceBefore1.toString()}`
      );
      console.log(
        `   Attempting user3 to claim Season 1 (should fail - user3 didn't stake in Season 1)...`
      );
      // user3 should NOT be able to claim Season 1 because they didn't stake in that season
      await expect(factory.connect(user3).claimEth(1)).to.be.reverted;
      console.log(
        `   ✅ user3 Season 1 claim prevented (reverted as expected - user3 staked in Season 2, not Season 1)`
      );

      // user3 can claim Season 2 (the season they actually staked in)
      console.log(`   user3 claiming Season 2 (the season they staked in)...`);
      // user3's weight: 29, user2's weight: 30, total weight: 59, total reward: 0.25 ETH
      // user3's reward: (0.025 / 59) * 29 = 0.012288135593 ETH ≈ 12288135593220338 wei
      await expect(factory.connect(user3).claimEth(2)).to.changeEtherBalance(
        user3,
        12288135593220338n
      ); // ≈0.012288 ETH
      const user3BalanceAfterSeason2 = await ethers.provider.getBalance(
        user3.address
      );
      console.log(
        `   ✅ user3 claimed Season 2: ${
          user3BalanceAfterSeason2 - user3BalanceBefore1
        } wei`
      );
      // user3 already tried to claim Season 1 and it was reverted, so no need to test again

      // Test double spending prevention - user3 should not be able to claim season 2 again
      console.log(
        "   Attempting user3 to claim Season 2 again (should fail)..."
      );
      await expect(factory.connect(user3).claimEth(2)).to.be.reverted;
      console.log(
        "   ✅ user3 Season 2 double claim prevented (reverted as expected)"
      );

      console.log("\n=== Double Spending Prevention Test Complete ===\n");
    });
  });

  describe("Admin Functions", () => {
    it("Should update fee rate", async () => {
      const newFeeRate = 500n; // 0.5%
      await factory.connect(operator).setFeeRate(newFeeRate);
      expect(await factory.feeRate()).to.equal(newFeeRate);
    });

    it("Should revert when non-operator tries to update fee rate", async () => {
      await expect(
        factory.connect(user1).setFeeRate(1000n)
      ).to.be.revertedWithCustomError(
        factory,
        "AccessControlUnauthorizedAccount"
      );
    });

    it("Should update verifier", async () => {
      const newVerifier = await (
        await ethers.getContractFactory("Groth16Verifier")
      ).deploy();
      await newVerifier.waitForDeployment();
      await factory
        .connect(operator)
        .setVerifier(await newVerifier.getAddress());
      expect(await factory.verifier()).to.equal(await newVerifier.getAddress());
    });

    it("Should update hasher", async () => {
      const newHasher = await (
        await ethers.getContractFactory("Poseidon")
      ).deploy();
      await newHasher.waitForDeployment();
      await factory.connect(operator).setHasher(await newHasher.getAddress());
      expect(await factory.hasher()).to.equal(await newHasher.getAddress());
    });

    it("Should set staking season period", async () => {
      const newPeriod = 60 * 24 * 60 * 60; // 60 days
      await factory.connect(operator).setStakingSeasonPeriod(newPeriod);
      // Verify by checking staking contract
      const staking = await factory.staking();
      // Note: Would need to read from staking contract directly
    });
  });

  describe("View Functions", () => {
    it("Should get mixer address", async () => {
      const mixerAddress = await factory.getMixer(0, ETH_AMOUNT);
      expect(mixerAddress).to.properAddress;
    });

    it("Should return zero address for non-existent mixer", async () => {
      const mixerAddress = await factory.getMixer(0, ethers.parseEther("999"));
      expect(mixerAddress).to.equal(ethers.ZeroAddress);
    });

    it("Should calculate deposit amount with fees", async () => {
      const amount = ethers.parseEther("1");
      const total = await factory.calculateDepositAmount(amount);
      const currentFeeRate = await factory.feeRate();
      const expectedFee = (amount * currentFeeRate) / 100000n;
      expect(total).to.equal(amount + expectedFee);
    });

    it("Should get current stake season", async () => {
      const season = await factory.getCurrentStakeSeason();
      expect(season).to.be.greaterThan(0n);
    });
  });

  // Helper functions
  function generateCommitment(): {
    secret: bigint;
    nullifier: bigint;
    commitment: bigint;
  } {
    const { secret, nullifier } = generateSecretAndNullifier();
    const commitment = computeCommitment(secret, nullifier);
    return { secret, nullifier, commitment };
  }
});

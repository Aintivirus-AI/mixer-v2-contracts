import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import CryptoUtil from "../utils";
import {
  generateSecretAndNullifier,
  computeCommitment,
  computeNullifierHash,
  buildMerkleTreeFromEvents,
  generateWithdrawalProof,
} from "./helpers/proofGenerator";
import {
  AintiVirusFactory,
  AintiVirusFactory__factory,
  AintiVirusMixer,
  Poseidon,
  Poseidon__factory,
  Groth16Verifier,
  Groth16Verifier__factory,
  ERC20Standard,
  ERC20Standard__factory,
  AintiVirusMixer__factory,
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

describe("AintiVirusFactory full flow", function () {
  let factory: AintiVirusFactory;
  let token: ERC20Standard;
  let poseidon: Poseidon;
  let verifier: Groth16Verifier;
  let deployer: HardhatEthersSigner;
  let operator: HardhatEthersSigner;
  let userA: HardhatEthersSigner;
  let userB: HardhatEthersSigner;
  let userC: HardhatEthersSigner;
  let recipient: HardhatEthersSigner;

  const FEE_RATE = 250n; // 0.25%
  const MIXER_AMOUNTS = [ethers.parseEther("1"), ethers.parseEther("5")];

  const depositsByMixer: Record<string, DepositRecord[]> = {};

  before(async () => {
    [deployer, operator, userA, userB, userC, recipient] =
      await ethers.getSigners();

    const TokenFactory = (await ethers.getContractFactory(
      "ERC20Standard"
    )) as ERC20Standard__factory;
    token = await TokenFactory.deploy("AintiVirus", "AINTI");
    await token.waitForDeployment();

    const PoseidonFactory = (await ethers.getContractFactory(
      "Poseidon"
    )) as Poseidon__factory;
    poseidon = await PoseidonFactory.deploy();
    await poseidon.waitForDeployment();

    const VerifierFactory = (await ethers.getContractFactory(
      "Groth16Verifier"
    )) as Groth16Verifier__factory;
    verifier = await VerifierFactory.deploy();
    await verifier.waitForDeployment();

    const FactoryFactory = (await ethers.getContractFactory(
      "AintiVirusFactory"
    )) as AintiVirusFactory__factory;
    factory = await FactoryFactory.deploy(
      await token.getAddress(),
      await verifier.getAddress(),
      await poseidon.getAddress(),
      FEE_RATE
    );
    await factory.waitForDeployment();

    await factory.grantRole(await factory.OPERATOR_ROLE(), operator.address);
  });

  describe("Deploy mixers", () => {
    it("deploys 1 ETH and 5 ETH mixers", async () => {
      for (const amount of MIXER_AMOUNTS) {
        const tx = await factory
          .connect(operator)
          .deployMixer(AssetMode.ETH, amount);
        await tx.wait();
        const addr = await factory.getMixer(AssetMode.ETH, amount);
        expect(addr).to.properAddress;
        console.log(`✅ Mixer deployed for amount ${amount}: ${addr}`);
      }
    });
  });

  describe("Deposits (20 each mixer)", () => {
    it("makes 20 deposits per mixer", async () => {
      for (const amount of MIXER_AMOUNTS) {
        const deposits: DepositRecord[] = [];
        for (let i = 0; i < 20; i++) {
          const { secret, nullifier } = generateSecretAndNullifier();
          const commitment = computeCommitment(secret, nullifier);
          const fee = (amount * FEE_RATE) / 100000n;
          const total = amount + fee;
          const tx = await factory
            .connect(userA)
            .deposit(
              AssetMode.ETH,
              amount,
              CryptoUtil.bigIntToBytes32(commitment),
              { value: total }
            );
          await tx.wait();
          deposits.push({
            secret,
            nullifier,
            commitment,
            amount,
            mixerAmount: amount,
            leafIndex: deposits.length,
          });
        }
        depositsByMixer[amount.toString()] = deposits;
        const mixerAddress = await factory.getMixer(AssetMode.ETH, amount);
        const mixer = AintiVirusMixer__factory.connect(
          mixerAddress,
          ethers.provider
        );
        const events = await mixer.queryFilter(mixer.filters.Deposit());
        expect(events.length).to.equal(20);
        console.log(
          `ℹ️  Mixer ${amount} has ${
            events.length
          } deposits. Factory balance: ${await ethers.provider.getBalance(
            await factory.getAddress()
          )}`
        );
      }
    });
  });

  describe("Withdrawals (20 each mixer)", () => {
    it("withdraws all deposits to recipient", async () => {
      for (const amount of MIXER_AMOUNTS) {
        const mixerAddress = await factory.getMixer(AssetMode.ETH, amount);
        const mixer = AintiVirusMixer__factory.connect(
          mixerAddress,
          ethers.provider
        );
        const events = await mixer.queryFilter(mixer.filters.Deposit());
        const merkleTree = buildMerkleTreeFromEvents(events);
        const factoryAddr = await factory.getAddress();
        const factoryBalanceBefore = await ethers.provider.getBalance(
          factoryAddr
        );
        const recipientBalanceBefore = await ethers.provider.getBalance(
          recipient.address
        );

        for (let i = 0; i < events.length; i++) {
          const deposit = depositsByMixer[amount.toString()][i];
          const leafIndex = events.findIndex(
            (e: any) =>
              CryptoUtil.bytes32ToBigInt(e.args[0]) === deposit.commitment
          );
          const path = merkleTree.path(leafIndex);
          const root = BigInt(merkleTree.root);

          const proof = await generateWithdrawalProof(
            deposit.secret,
            deposit.nullifier,
            root,
            recipient.address,
            path.pathElements.map((e) => BigInt(e)),
            path.pathIndices
          );
          const tx = await factory
            .connect(recipient)
            .withdraw(proof, deposit.amount, AssetMode.ETH);
          await tx.wait();
        }

        const factoryBalanceAfter = await ethers.provider.getBalance(
          factoryAddr
        );
        const recipientBalanceAfter = await ethers.provider.getBalance(
          recipient.address
        );
        console.log(
          `ℹ️  Withdrawn all from mixer ${amount}. Factory Δ: ${
            factoryBalanceBefore - factoryBalanceAfter
          }, Recipient Δ: ${recipientBalanceAfter - recipientBalanceBefore}`
        );

        expect(factoryBalanceBefore - factoryBalanceAfter).to.equal(
          BigInt(events.length) * amount
        );
        expect(recipientBalanceAfter).to.be.greaterThan(recipientBalanceBefore);
      }
    });
  });

  describe("Staking end-to-end", () => {
    const stakeAmount = ethers.parseEther("1");
    let totalRewardsClaimed = 0n;

    it("stakes 3 users with 10 day gaps", async () => {
      const stakers = [userA, userB, userC];
      for (let i = 0; i < stakers.length; i++) {
        const staker = stakers[i];
        const tx = await factory
          .connect(staker)
          .stakeEther(stakeAmount, { value: stakeAmount });
        await tx.wait();
        console.log(`ℹ️  Staked ${stakeAmount} from ${staker.address}`);
        if (i < stakers.length - 1) {
          await ethers.provider.send("evm_increaseTime", [10 * 24 * 3600]);
          await ethers.provider.send("evm_mine", []);
        }
      }
    });

    it("ends season after 30 days, claims rewards, and unstakes", async () => {
      await ethers.provider.send("evm_increaseTime", [30 * 24 * 3600]);
      await ethers.provider.send("evm_mine", []);

      const factoryAddr = await factory.getAddress();
      const factoryBalanceBefore = await ethers.provider.getBalance(
        factoryAddr
      );

      await factory.connect(operator).startStakeSeason();

      const stakers = [userA, userB, userC];
      let totalUnstaked = 0n;
      for (const staker of stakers) {
        // ---- Claim rewards ----
        const factoryBeforeClaim = await ethers.provider.getBalance(
          factoryAddr
        );
        const claimTx = await factory.connect(staker).claimEth(1);
        await claimTx.wait();
        const factoryAfterClaim = await ethers.provider.getBalance(factoryAddr);
        const claimed = factoryBeforeClaim - factoryAfterClaim;
        totalRewardsClaimed += claimed;
        console.log(
          `ℹ️  Staker ${
            staker.address
          } claimed reward: ${claimed.toString()} wei`
        );

        // ---- Unstake ----
        const factoryBeforeUnstake = await ethers.provider.getBalance(
          factoryAddr
        );
        const unstakeTx = await factory.connect(staker).unstakeEth();
        await unstakeTx.wait();
        const factoryAfterUnstake = await ethers.provider.getBalance(
          factoryAddr
        );
        const unstaked = factoryBeforeUnstake - factoryAfterUnstake;
        totalUnstaked += unstaked;
        console.log(
          `ℹ️  Staker ${staker.address} unstaked: ${unstaked.toString()} wei`
        );
      }

      const factoryBalanceAfter = await ethers.provider.getBalance(factoryAddr);
      const expectedDrop = totalUnstaked + totalRewardsClaimed;
      console.log(
        `ℹ️  Factory balance drop after claims/unstake: ${
          factoryBalanceBefore - factoryBalanceAfter
        }, expected (rewards + unstake): ${expectedDrop}`
      );
      expect(factoryBalanceBefore - factoryBalanceAfter).to.be.gte(
        totalUnstaked
      );
    });
  });
});

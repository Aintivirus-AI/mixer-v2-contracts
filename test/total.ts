import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
    AintiVirusMixer,
    AintiVirusMixer__factory,
    Poseidon,
    Poseidon__factory,
    Groth16Verifier,
    Groth16Verifier__factory,
    ERC20Standard,
    ERC20Standard__factory
} from "../typechain-types";

import MerkleTreeClient from "../MerkleTree";
import ZkSnark from "../zksnark/ZkSnark";
import CryptoUtil from "../utils";

describe("AintiVirusMixer", function () {
    let token: ERC20Standard;
    let poseidon: Poseidon;
    let verifier: Groth16Verifier;
    let mixer: AintiVirusMixer;

    let deployer: HardhatEthersSigner;
    let user1: HardhatEthersSigner;
    let user2: HardhatEthersSigner;

    const deposits: { secret: bigint, nullifier: bigint, commitment: bigint, amount: bigint, mode: number }[] = [];

    before(async () => {
        [deployer, user1, user2] = await ethers.getSigners();
    });

    describe("Deployment", () => {
        it("Should deploy the base token contract successfully", async () => {
            const TokenFactory = (await ethers.getContractFactory("ERC20Standard")) as ERC20Standard__factory;

            token = await TokenFactory.deploy("AintiVirus", "AINTI");
            await token.waitForDeployment();

            const address = await token.getAddress();
            console.log("✅ Token deployed at:", address);

            expect(address).to.properAddress;
        })

        it("Should deploy the Poseidon hasher contract successfully", async () => {
            const PoseidonFactory = (await ethers.getContractFactory("Poseidon")) as Poseidon__factory;

            poseidon = await PoseidonFactory.deploy();
            await poseidon.waitForDeployment();

            const address = await poseidon.getAddress();
            console.log("✅ Poseidon hasher deployed at:", address);

            expect(address).to.properAddress;
        })

        it("Should deploy the Groth16 verifier contract successfully", async () => {
            const Groth16VerifierFactory = (await ethers.getContractFactory("Groth16Verifier")) as Groth16Verifier__factory;

            verifier = await Groth16VerifierFactory.deploy();
            await verifier.waitForDeployment();

            const address = await verifier.getAddress();
            console.log("✅ Verifier deployed at:", address);

            expect(address).to.properAddress;
        })

        it("Should deploy the AintiVirusMixer contract successfully", async () => {
            const MixerFactory = (await ethers.getContractFactory(
                "AintiVirusMixer",
                deployer
            )) as AintiVirusMixer__factory;

            // If your constructor has parameters, include them here
            // Example:
            // mixer = await MixerFactory.deploy(param1, param2);
            mixer = await MixerFactory.deploy(
                (await token.getAddress()),
                (await verifier.getAddress()),
                (await poseidon.getAddress())
            );

            await mixer.waitForDeployment();

            const address = await mixer.getAddress();
            console.log("✅ Mixer deployed at:", address);

            expect(address).to.properAddress;
        });

        it("User1 ETH balance should be equal with User2", async () => {
            const balance1 = await ethers.provider.getBalance(user1.address);
            const balance2 = await ethers.provider.getBalance(user2.address);

            expect(balance1).to.equal(balance2);
        })

        it("User1 token balance should be 0", async () => {
            const balance = await token.balanceOf(user1.address);

            expect(balance).to.equal(BigInt(0));
        })

        it("Deposit", async () => {
            for (let i = 0; i < 5; i++) {
                const depositAmount = ethers.parseEther("1");
                const mode = 1; // ETH to ETH

                const { secret, nullifier, commitment } = await generateAndDeposit(depositAmount, mode);
                deposits.push({ secret, nullifier, commitment, amount: depositAmount, mode });
            }

            for (let i = 0; i < 5; i++) {
                const tokenDecimals = await token.decimals();
                const depositAmount = ethers.parseUnits("1000", tokenDecimals);
                const mode = 2; // AINTI to AINTI

                // Approve AINTI to mixer
                const tx = await token.approve((await mixer.getAddress()), depositAmount);
                await tx.wait();

                const { secret, nullifier, commitment } = await generateAndDeposit(depositAmount, mode);
                deposits.push({ secret, nullifier, commitment, amount: depositAmount, mode });
            }
        });

        // it("Insert leaf(commitment) from Solana", async () => {
        //     const { secret, nullifier } = ZkSnark.generateSecretAndNullifier();
        //     const commitment = ZkSnark.computeCommitment(secret, nullifier, BigInt(100), 3);

        //     const tx = await mixer.insertLeafFromSolana(
        //         CryptoUtil.bigIntToBytes32(commitment)
        //     );
        //     await tx.wait();
        // })

        it("Parse events / Rebuild merkle tree", async () => {
            const filter = await mixer.filters.Deposit();
            const events = await mixer.queryFilter(filter, 0, "latest");

            const merkleTree = new MerkleTreeClient(24);

            for (const event of events) {
                merkleTree.insert(
                    CryptoUtil.bytes32ToBigInt(event.args[0])
                );
            }

            const { pathElements, pathIndices } = merkleTree.getProof(events.length - 1);

            expect(events.length).greaterThan(0);
            expect(pathElements.length).greaterThan(0);
            expect(pathIndices.length).greaterThan(0);
        })

        it("Withdraw", async () => {
            for (const deposit of deposits) {
                const filter = await mixer.filters.Deposit();
                const events = await mixer.queryFilter(filter, 0, "latest");

                const merkleTree = new MerkleTreeClient(24);

                for (const event of events) {
                    merkleTree.insert(
                        CryptoUtil.bytes32ToBigInt(event.args[0])
                    );
                }

                const leafIndex = events.findIndex(event => event.args[0] === CryptoUtil.bigIntToBytes32(deposit.commitment))
                const { pathElements, pathIndices } = merkleTree.getProof(leafIndex);
                const root = merkleTree.getRoot();

                await withdraw(
                    deposit.secret,
                    deposit.nullifier,
                    deposit.amount,
                    deposit.commitment,
                    deposit.mode,
                    root,
                    pathElements,
                    pathIndices,
                    user1.address
                );
            }
        })

        it("User1 ETH balance should be greater than User2", async () => {
            const balance1 = await ethers.provider.getBalance(user1.address);
            const balance2 = await ethers.provider.getBalance(user2.address);

            expect(balance1).to.greaterThan(balance2);
        })

        it("User1 token balance should be greater than 0", async () => {
            const balance = await token.balanceOf(user1.address);

            expect(balance).to.greaterThan(BigInt(0));
        })
    });

    const generateAndDeposit = async (amount: bigint, mode: number)
        : Promise<{ secret: bigint, nullifier: bigint, commitment: bigint }> => {
        const { secret, nullifier } = ZkSnark.generateSecretAndNullifier();

        const commitment = ZkSnark.computeCommitment(secret, nullifier, amount, mode);

        const tx = await mixer.deposit(
            BigInt(mode),
            amount,
            CryptoUtil.bigIntToBytes32(commitment),
            { value: mode === 1 || mode === 3 ? amount : 0 }
        );

        await tx.wait();

        return { secret, nullifier, commitment };
    }

    const withdraw = async (
        secret: bigint,
        nullifier: bigint,
        amount: bigint,
        commitment: bigint,
        mode: number,
        root: bigint,
        pathElements: bigint[],
        pathIndicies: number[],
        recipient: string
    ) => {
        const { calldata } = await ZkSnark.createWithdrawalProof(secret, nullifier, amount, commitment, mode, root, pathElements, pathIndicies);

        const tx = await mixer.withdraw(
            {
                pA: [BigInt(calldata.a[0]), BigInt(calldata.a[1])],
                pB: [
                    [BigInt(calldata.b[0][0]), BigInt(calldata.b[0][1])],
                    [BigInt(calldata.b[1][0]), BigInt(calldata.b[1][1])]
                ],
                pC: [BigInt(calldata.c[0]), BigInt(calldata.c[1])],
                pubSignals: calldata.psInput.map((x) => BigInt(x))
            },
            recipient
        );

        await tx.wait();
    }
});

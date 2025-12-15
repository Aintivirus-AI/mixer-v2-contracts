import { poseidon2 } from "poseidon-lite";
import MerkleTree from "fixed-merkle-tree";
import { readFileSync } from "fs";
import * as snarkjs from "snarkjs";
import { ethers } from "hardhat";
import CryptoUtil from "../../utils";

const calculateWitness = require("../../zk-circuit/build/mixer_js/witness_calculator.js");

export interface WithdrawalProof {
  pA: [bigint, bigint];
  pB: [[bigint, bigint], [bigint, bigint]];
  pC: [bigint, bigint];
  pubSignals: [bigint, bigint, bigint];
}

/**
 * Generate secret and nullifier for a deposit
 */
export function generateSecretAndNullifier(): {
  secret: bigint;
  nullifier: bigint;
} {
  const secretBytes = ethers.randomBytes(32);
  const nullifierBytes = ethers.randomBytes(32);
  const secret = BigInt(ethers.hexlify(secretBytes));
  const nullifier = BigInt(ethers.hexlify(nullifierBytes));
  return { secret, nullifier };
}

/**
 * Compute commitment hash: Poseidon(secret, nullifier)
 */
export function computeCommitment(secret: bigint, nullifier: bigint): bigint {
  return poseidon2([secret, nullifier]);
}

/**
 * Compute nullifier hash: Poseidon(nullifier, 0)
 */
export function computeNullifierHash(nullifier: bigint): bigint {
  return poseidon2([nullifier, 0n]);
}

/**
 * Build merkle tree from deposit events
 */
export function buildMerkleTreeFromEvents(events: any[]): MerkleTree {
  const tree = new MerkleTree(24, [], {
    hashFunction: (left: string | number, right: string | number) => {
      return poseidon2([BigInt(left), BigInt(right)]).toString();
    },
    zeroElement: "0",
  });

  for (const event of events) {
    const commitment = CryptoUtil.bytes32ToBigInt(event.args[0]);
    tree.insert(commitment.toString());
  }

  return tree;
}

/**
 * Generate withdrawal proof
 * Note: This is a mock implementation. In production, you need to:
 * 1. Use the compiled circuit WASM to generate witness
 * 2. Use snarkjs to generate the actual proof
 * 3. Format according to your circuit's output
 */
// export async function generateWithdrawalProof(
//   secret: bigint,
//   nullifier: bigint,
//   root: bigint,
//   recipient: string,
//   pathElements: bigint[],
//   pathIndices: number[]
// ): Promise<WithdrawalProof> {
//   // Compute commitment and nullifier hash
//   const commitment = computeCommitment(secret, nullifier);
//   const nullifierHash = computeNullifierHash(nullifier);
//   const recipientBigInt = BigInt(recipient);

//   // TODO: Replace this with actual snarkjs proof generation
//   // For now, this is a placeholder that matches the structure
//   // In production, you would:
//   // 1. Load the circuit WASM
//   // 2. Generate witness from inputs
//   // 3. Use snarkjs.groth16.prove() to generate proof
//   // 4. Format the proof according to your circuit

//   return {
//     pA: [0n, 0n], // Placeholder - replace with actual proof
//     pB: [
//       [0n, 0n],
//       [0n, 0n],
//     ], // Placeholder - replace with actual proof
//     pC: [0n, 0n], // Placeholder - replace with actual proof
//     pubSignals: [
//       nullifierHash, // pubSignals[0]
//       recipientBigInt, // pubSignals[1]
//       root, // pubSignals[2]
//     ],
//   };
// }

// Example of how to use snarkjs for actual proof generation:

export async function generateWithdrawalProof(
  secret: bigint,
  nullifier: bigint,
  root: bigint,
  recipient: string,
  pathElements: bigint[],
  pathIndices: number[]
): Promise<WithdrawalProof> {
  // Load circuit artifacts
  const wasm = readFileSync("zk-circuit/build/mixer_js/mixer.wasm");
  const zkey = readFileSync("zk-circuit/build/mixer_0001.zkey");

  // Prepare inputs
  const input = {
    secret: secret.toString(),
    nullifier: nullifier.toString(),
    root: root.toString(),
    recipient: BigInt(recipient).toString(),
    pathElements: pathElements.map((e) => e.toString()),
    pathIndices: pathIndices.map((i) => i.toString()),
  };

  // Generate witness

  const witnessCalculator = await calculateWitness(wasm);
  const witness = await witnessCalculator.calculateWTNSBin(input, 0);

  // Generate proof
  const { proof, publicSignals } = await snarkjs.groth16.prove(zkey, witness);

  return {
    pA: [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])],
    pB: [
      [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
      [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
    ],
    pC: [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])],
    pubSignals: publicSignals.map((x: string) => BigInt(x)) as [
      bigint,
      bigint,
      bigint
    ],
  };
}

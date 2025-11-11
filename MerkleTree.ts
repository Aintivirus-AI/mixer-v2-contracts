import MerkleTree from "fixed-merkle-tree";
import { poseidon2 } from "poseidon-lite";

export default class MerkleTreeClient {
    levels: number;
    fixedMerkleTree: MerkleTree;

    constructor(levels: number) {
        this.levels = levels;

        this.fixedMerkleTree = new MerkleTree(24, [], {
            hashFunction: (left: string | number, right: string | number) => poseidon2([BigInt(left), BigInt(right)]).toString(),
            zeroElement: BigInt(0).toString()
        })
    }

    insert(leaf: bigint) {
        this.fixedMerkleTree.insert(leaf.toString());
    }

    getRoot(): bigint {
        return BigInt(this.fixedMerkleTree.root);
    }

    zeros(): bigint[] {
        return this.fixedMerkleTree.zeros.map(z => BigInt(z));
    }

    getProof(index: number): { pathElements: bigint[]; pathIndices: number[] } {
        const { pathElements, pathIndices } = this.fixedMerkleTree.path(index)

        // const proof = this.fixedMerkleTree.proof(leaf.toString());
        // return {
        //     pathElements: proof.pathElements.map(e => BigInt(e)),
        //     pathIndices: proof.pathIndices
        // };

        return {
            pathElements: pathElements.map(e => BigInt(e)),
            pathIndices
        };
    }
}
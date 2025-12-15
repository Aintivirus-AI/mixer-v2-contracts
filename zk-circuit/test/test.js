const snarkjs = require("snarkjs");
const fs = require("fs");
const path = require("path");

async function testCircuit() {
    console.log("Testing Mixer Circuit...\n");

    // Check if build files exist
    const wasmPath = path.join(__dirname, "../build/mixer_js/mixer.wasm");
    const zkeyPath = path.join(__dirname, "../build/mixer_0001.zkey");
    const inputPath = path.join(__dirname, "../inputs/example_input.json");

    if (!fs.existsSync(wasmPath)) {
        console.error("Error: Circuit not compiled. Run 'npm run compile' first.");
        return;
    }

    if (!fs.existsSync(zkeyPath)) {
        console.error("Error: Trusted setup not generated. Run the setup commands first.");
        return;
    }

    if (!fs.existsSync(inputPath)) {
        console.error("Error: Input file not found.");
        return;
    }

    // Load input
    const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    console.log("Input loaded:", input);

    // Generate witness
    console.log("\nGenerating witness...");
    const { calculateWitness } = require(path.join(__dirname, "../build/mixer_js/witness_calculator"));
    const wasm = fs.readFileSync(wasmPath);
    const witnessCalculator = await calculateWitness(wasm);
    const witness = await witnessCalculator.calculateWTNSBin(input, 0);
    const witnessPath = path.join(__dirname, "../build/witness.wtns");
    fs.writeFileSync(witnessPath, witness);
    console.log("Witness generated!");

    // Generate proof
    console.log("\nGenerating proof...");
    const { proof, publicSignals } = await snarkjs.groth16.prove(zkeyPath, witnessPath);
    console.log("Proof generated!");

    // Save proof and public signals
    const proofPath = path.join(__dirname, "../build/proof.json");
    const publicPath = path.join(__dirname, "../build/public.json");
    fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2));
    fs.writeFileSync(publicPath, JSON.stringify(publicSignals, null, 2));
    console.log("\nProof saved to:", proofPath);
    console.log("Public signals saved to:", publicPath);

    // Verify proof
    console.log("\nVerifying proof...");
    const vkey = JSON.parse(fs.readFileSync(path.join(__dirname, "../build/verification_key.json"), "utf8"));
    const verified = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    
    if (verified) {
        console.log("✓ Proof verified successfully!");
        console.log("\nPublic Signals:");
        console.log("  [0] nullifierHash:", publicSignals[0]);
        console.log("  [1] recipientAddress:", publicSignals[1]);
        console.log("  [2] relayer:", publicSignals[2]);
        console.log("  [3] root:", publicSignals[3]);
    } else {
        console.error("✗ Proof verification failed!");
    }
}

testCircuit().catch(console.error);


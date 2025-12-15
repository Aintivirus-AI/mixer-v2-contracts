# Verifier Contract

**IMPORTANT:** This contract is auto-generated from the Circom circuit using snarkjs.

After updating the circuit in `zk-circuit/circuits/mixer.circom`, you must regenerate this contract:

```bash
cd zk-circuit
snarkjs zkey export solidityverifier build/mixer_0001.zkey ../contracts/verifiers/Verifier.sol
```

The current circuit outputs 3 public signals:
- `[0]` nullifierHash
- `[1]` recipientAddress  
- `[2]` rootOutput

Make sure the generated Verifier contract matches the `IVerifier` interface which expects `uint[3] calldata _pubSignals`.


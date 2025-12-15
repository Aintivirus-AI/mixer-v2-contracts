# Test Inputs

Place test input JSON files here for circuit testing.

## Example Input Format

```json
{
  "secret": "1234567890",
  "nullifier": "9876543210",
  "pathElements": ["0x...", "0x...", ...],
  "pathIndices": [0, 1, 0, ...],
  "recipient": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "relayer": "0x0000000000000000000000000000000000000000"
}
```

These inputs are used for:
- Testing circuit compilation
- Generating test proofs
- Verifying circuit correctness


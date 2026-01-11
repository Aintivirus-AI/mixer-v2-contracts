import { ethers } from "hardhat";
import hre from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);
  console.log(
    "Account balance:",
    (await ethers.provider.getBalance(deployer.address)).toString()
  );

  // Configuration
  const FEE_RATE = 250n; // 0.25% in basis points (250 / 100000)
  const TOKEN_NAME = process.env.TOKEN_NAME || "AintiVirus";
  const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL || "AINTI";
  const EXISTING_TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;

  // Use existing token or deploy new one
  let tokenAddress: string;
  if (EXISTING_TOKEN_ADDRESS) {
    console.log("\n📦 Using existing token at:", EXISTING_TOKEN_ADDRESS);
    tokenAddress = EXISTING_TOKEN_ADDRESS;

    // Verify the token contract exists and is valid
    const code = await ethers.provider.getCode(tokenAddress);
    if (code === "0x") {
      throw new Error(`No contract found at token address: ${tokenAddress}`);
    }
    console.log("✅ Token contract verified");
  } else {
    // Deploy Token
    console.log("\n📦 Deploying ERC20Standard token...");
    const TokenFactory = await ethers.getContractFactory("ERC20Standard");
    const token = await TokenFactory.deploy(TOKEN_NAME, TOKEN_SYMBOL);
    await token.waitForDeployment();
    tokenAddress = await token.getAddress();
    console.log("✅ Token deployed at:", tokenAddress);
  }

  // Deploy Poseidon
  // Note: The Poseidon library has a public function, so Hardhat can deploy it as a contract
  console.log("\n🔐 Deploying Poseidon hasher...");
  const PoseidonFactory = await ethers.getContractFactory("Poseidon");
  const poseidon = await PoseidonFactory.deploy();
  await poseidon.waitForDeployment();
  const poseidonAddress = await poseidon.getAddress();
  console.log("✅ Poseidon deployed at:", poseidonAddress);

  // Deploy Verifier
  console.log("\n✅ Deploying Groth16Verifier...");
  const VerifierFactory = await ethers.getContractFactory("Groth16Verifier");
  const verifier = await VerifierFactory.deploy();
  await verifier.waitForDeployment();
  const verifierAddress = await verifier.getAddress();
  console.log("✅ Verifier deployed at:", verifierAddress);

  // Deploy Factory
  console.log("\n🏭 Deploying AintiVirusFactory...");
  const FactoryFactory = await ethers.getContractFactory("AintiVirusFactory");
  const factory = await FactoryFactory.deploy(
    tokenAddress,
    verifierAddress,
    poseidonAddress,
    FEE_RATE
  );
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("✅ Factory deployed at:", factoryAddress);

  // Get staking contract address
  const stakingAddress = await factory.staking();
  console.log("✅ Staking contract deployed at:", stakingAddress);

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("📋 DEPLOYMENT SUMMARY");
  console.log("=".repeat(60));
  console.log(
    `Token (${TOKEN_SYMBOL}):     ${tokenAddress}${
      EXISTING_TOKEN_ADDRESS ? " (existing)" : ""
    }`
  );
  console.log(`Poseidon:                   ${poseidonAddress}`);
  console.log(`Verifier:                   ${verifierAddress}`);
  console.log(`Factory:                    ${factoryAddress}`);
  console.log(`Staking:                    ${stakingAddress}`);
  console.log(
    `Fee Rate:                   ${FEE_RATE} (${Number(FEE_RATE) / 1000}%)`
  );
  console.log("=".repeat(60));

  // Optional: Deploy mixers if specified
  const deployMixers = process.env.DEPLOY_MIXERS === "true";
  if (deployMixers) {
    console.log("\n🔧 Deploying mixers...");
    const operator = deployer; // In production, use a separate operator account

    // Check if deployer has OPERATOR_ROLE
    const OPERATOR_ROLE = await factory.OPERATOR_ROLE();
    const hasRole = await factory.hasRole(OPERATOR_ROLE, deployer.address);

    if (!hasRole) {
      console.log(
        "⚠️  Deployer doesn't have OPERATOR_ROLE. Skipping mixer deployment."
      );
      console.log(
        "   Grant OPERATOR_ROLE to an address and deploy mixers separately."
      );
    } else {
      const mixerAmounts = process.env.MIXER_AMOUNTS
        ? process.env.MIXER_AMOUNTS.split(",").map((amt) =>
            ethers.parseEther(amt.trim())
          )
        : [
            ethers.parseEther("1"),
            ethers.parseEther("2"),
            ethers.parseEther("5"),
          ];

      for (const amount of mixerAmounts) {
        try {
          const tx = await factory.connect(operator).deployMixer(0, amount); // 0 = ETH mode
          await tx.wait();
          const mixerAddress = await factory.getMixer(0, amount);
          console.log(
            `✅ Mixer deployed for ${ethers.formatEther(
              amount
            )} ETH: ${mixerAddress}`
          );
        } catch (error: any) {
          console.error(
            `❌ Failed to deploy mixer for ${ethers.formatEther(amount)} ETH:`,
            error.message
          );
        }
      }
    }
  }

  // Contract Verification
  const shouldVerify =
    process.env.ETHERSCAN_API_KEY && process.env.VERIFY_CONTRACTS !== "false";

  if (shouldVerify) {
    console.log("\n🔍 Verifying contracts on Etherscan...");

    // Wait a bit for Etherscan to index the contracts
    console.log("⏳ Waiting for block confirmations...");
    await new Promise((resolve) => setTimeout(resolve, 20000)); // 20 seconds

    // Verify Poseidon (no constructor args)
    try {
      console.log("\n🔍 Verifying Poseidon...");
      await hre.run("verify:verify", {
        address: poseidonAddress,
        constructorArguments: [],
      });
      console.log("✅ Poseidon verified");
    } catch (error: any) {
      if (error.message.includes("Already Verified")) {
        console.log("✅ Poseidon already verified");
      } else {
        console.log(`⚠️  Poseidon verification failed: ${error.message}`);
      }
    }

    // Verify Verifier (no constructor args)
    try {
      console.log("\n🔍 Verifying Groth16Verifier...");
      await hre.run("verify:verify", {
        address: verifierAddress,
        constructorArguments: [],
      });
      console.log("✅ Verifier verified");
    } catch (error: any) {
      if (error.message.includes("Already Verified")) {
        console.log("✅ Verifier already verified");
      } else {
        console.log(`⚠️  Verifier verification failed: ${error.message}`);
      }
    }

    // Verify Token (only if we deployed it, not if using existing)
    if (!EXISTING_TOKEN_ADDRESS) {
      try {
        console.log("\n🔍 Verifying Token...");
        await hre.run("verify:verify", {
          address: tokenAddress,
          constructorArguments: [TOKEN_NAME, TOKEN_SYMBOL],
        });
        console.log("✅ Token verified");
      } catch (error: any) {
        if (error.message.includes("Already Verified")) {
          console.log("✅ Token already verified");
        } else {
          console.log(`⚠️  Token verification failed: ${error.message}`);
        }
      }
    }

    // Verify Factory (has constructor args)
    try {
      console.log("\n🔍 Verifying AintiVirusFactory...");
      await hre.run("verify:verify", {
        address: factoryAddress,
        constructorArguments: [
          tokenAddress,
          verifierAddress,
          poseidonAddress,
          FEE_RATE,
        ],
      });
      console.log("✅ Factory verified");
    } catch (error: any) {
      if (error.message.includes("Already Verified")) {
        console.log("✅ Factory already verified");
      } else {
        console.log(`⚠️  Factory verification failed: ${error.message}`);
      }
    }

    // Verify Staking (deployed by Factory, constructor takes Factory address)
    try {
      console.log("\n🔍 Verifying AintiVirusStaking...");
      await hre.run("verify:verify", {
        address: stakingAddress,
        constructorArguments: [factoryAddress],
      });
      console.log("✅ Staking verified");
    } catch (error: any) {
      if (error.message.includes("Already Verified")) {
        console.log("✅ Staking already verified");
      } else {
        console.log(`⚠️  Staking verification failed: ${error.message}`);
      }
    }

    console.log("\n✅ Verification process complete!");
  } else {
    if (!process.env.ETHERSCAN_API_KEY) {
      console.log("\n⚠️  Skipping verification: ETHERSCAN_API_KEY not set");
    } else {
      console.log("\n⚠️  Skipping verification: VERIFY_CONTRACTS=false");
    }
  }

  console.log("\n✨ Deployment complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

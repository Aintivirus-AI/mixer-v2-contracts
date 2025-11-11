import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import dotenv from "dotenv";

dotenv.config();
const config: HardhatUserConfig = {
    solidity: "0.8.28",
    networks: {
        mainnet: {
            url: "https://mainnet.infura.io/v3/f7a4b78abc4a432e854e137c7fc70186",
            // url: "https://ethereum-rpc.publicnode.com",
            accounts: [process.env.PRIVKEY as string],
            gas: "auto",
            gasMultiplier: 1.2,
            gasPrice: 50_000_000_000,
            blockGasLimit: 0x1fffffffffffff
        },
        localnode: {
			url: "http://127.0.0.1:8545",
			accounts: [
                "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
                "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
                "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
            ],
			blockGasLimit: 0x1fffffffffffff
		}
    },
    etherscan: {
        apiKey: "1FTHWYZGTW9TKZA72FTFDBY13UUIRP3SMI" // Etherscan
    }
};

export default config;

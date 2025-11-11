import { ethers } from "ethers";
import { randomBytes } from "crypto";
import bs58 from 'bs58'

export default class CryptoUtil {
    static generate32BytesRandomHash = () => {
        const randomBytesString = randomBytes(32)
        const hashString = randomBytesString.toString('hex')

        return hashString
    }

    static bigIntToBytes32 = (value: bigint) => {
        return ethers.zeroPadValue(ethers.toBeHex(value), 32)
    }

    static bytes32ToBigInt = (value: string) => {
        const bytes = ethers.getBytes(value)
        return ethers.toBigInt(bytes)
    }

    static bigIntToUint8Array32(value: bigint): number[] {
        const hex = value.toString(16).padStart(64, '0');
        const result: number[] = [];

        for (let i = 0; i < hex.length; i += 2) {
            result.push(parseInt(hex.substring(i, i + 2), 16));
        }

        return result;
    }

    static ethereumAddressToBigInt = (address: string) => {
        return BigInt(ethers.hexlify(ethers.getAddress(address)))
    }

    static bigIntToEthereumAddress = (value: bigint) => {
        const addressHex = BigInt(value).toString(16).padStart(40, '0')
        const address = '0x' + addressHex

        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
            throw new Error('Recovered currency is not a valid Ethereum address');
        }

        return ethers.getAddress(address)
    }

    static bs58AddressToBigInt = (address: string) => {
        return BigInt('0x' + Buffer.from(bs58.decode(address)).toString('hex'))
    }

    static toSafeTransaction = (transaction: ethers.ContractTransaction | ethers.Transaction | ethers.TransactionRequest) => {
        return JSON.parse(
            JSON.stringify(transaction, (_key, value) =>
                typeof value === 'bigint' ? value.toString() : value
            )
        )
    }
}
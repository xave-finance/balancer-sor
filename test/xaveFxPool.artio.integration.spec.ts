// yarn test:only test/xaveFxPool.integration.spec.ts
import dotenv from 'dotenv';
import { JsonRpcProvider } from '@ethersproject/providers';
import { PoolFilter, SOR, SubgraphPoolBase, SwapTypes } from '../src';
import { ADDRESSES, Network, SOR_CONFIG } from './testScripts/constants';
import { parseFixed } from '@ethersproject/bignumber';
import { expect } from 'chai';
import { Vault, Vault__factory } from '@balancer-labs/typechain';
import { AddressZero } from '@ethersproject/constants';
import { setUp } from './testScripts/utils';

dotenv.config();

let sor: SOR;
const networkId = Network.ARTIO;
const jsonRpcUrl = process.env.RPC_URL_ARTIO;
const rpcUrl = 'http://127.0.0.1:8139';
const blocknumber = 2258323;

let vault: Vault;

const SWAP_AMOUNT_IN_NUMERAIRE = '10';

const poolsStub: SubgraphPoolBase[] = [
    <SubgraphPoolBase>{
        id: '0x246f19459453518a86a493f2030056532d81e330000200000000000000000018',
        address: '0x246f19459453518a86a493f2030056532d81e330',
        swapFee: '0',
        poolType: 'FX',
        totalShares: '10127168.217853595061660665',
        swapEnabled: true,
        totalWeight: '0',
        tokens: [
            {
                address: '0x45cb13b18a6cbb03a0367fb91cf27bacc069d46d',
                balance: '6101054.602054477099734172',
                decimals: 18,
                priceRate: '1',
                weight: null,
                // "symbol": "NECT_mock",
                token: {
                    latestFXPrice: '1',
                    fxOracleDecimals: 0,
                },
            },
            {
                address: '0xa0e91e69b43021b3c6748cfe16296ff4b933bd00',
                decimals: 18,
                // "symbol": "HONEY_mock",
                balance: '4026113.615799117961926493',
                priceRate: '1',
                weight: null,
                token: {
                    latestFXPrice: '1',
                    fxOracleDecimals: 0,
                },
            },
        ],
    },
    <SubgraphPoolBase>{
        id: '0x4c6aac835c516b68b6a2db50b65216dd8d250f8e000200000000000000000017',
        address: '0x4c6aac835c516b68b6a2db50b65216dd8d250f8e',
        swapFee: '0',
        poolType: 'FX',
        totalShares: '10483794.004506793230443968',
        swapEnabled: true,
        totalWeight: '0',
        tokens: [
            {
                address: '0xa0e91e69b43021b3c6748cfe16296ff4b933bd00',
                decimals: 18,
                // "symbol": "HONEY_mock",
                balance: '9368630.356720793230443968',
                priceRate: '1',
                weight: null,
                token: {
                    latestFXPrice: '1',
                    fxOracleDecimals: 0,
                },
            },
            {
                address: '0xf5c462bf81a6b6af0f87749eface2453c35cb519',
                decimals: 6,
                // "name": "USDC_mock",
                balance: '1115163.647786',
                priceRate: '1',
                weight: null,
                token: {
                    latestFXPrice: '1',
                    fxOracleDecimals: 0,
                },
            },
        ],
    },
    <SubgraphPoolBase>{
        id: '0x5730bc94e581b3f9ae44b721ff7b1a1afe46d350000200000000000000000016',
        address: '0x5730bc94e581b3f9ae44b721ff7b1a1afe46d350',
        swapFee: '0',
        poolType: 'FX',
        totalShares: '10134881.22916366614112',
        swapEnabled: true,
        totalWeight: '0',
        tokens: [
            {
                address: '0x9e11bf9d712fe1f9117688924223edc139181183',
                decimals: 6,
                // "symbol": "XSGD_mock",
                balance: '4270427.443742',
                priceRate: '1',
                weight: null,
                token: {
                    latestFXPrice: '0.74310736',
                    fxOracleDecimals: 0,
                },
            },
            {
                address: '0xf5c462bf81a6b6af0f87749eface2453c35cb519',
                decimals: 6,
                // "symbol": "USDC_mock",
                balance: '6961495.165373',
                priceRate: '1',
                weight: null,
                token: {
                    latestFXPrice: '1',
                    fxOracleDecimals: 0,
                },
            },
        ],
    },
];

const test = 'FX' in PoolFilter;

describe('[ARTIO] xaveFxPool: Multi-hop different quote token tests', () => {
    context('test swaps vs queryBatchSwap', () => {
        // Setup chain
        before(async function () {
            const provider = new JsonRpcProvider(rpcUrl, networkId);

            vault = Vault__factory.connect(
                SOR_CONFIG[networkId].vault,
                provider
            );
            sor = await setUp(
                networkId,
                provider,
                poolsStub,
                jsonRpcUrl as string,
                blocknumber
            );

            await sor.fetchPools();
        });

        const tokenIn = ADDRESSES[Network.ARTIO].NECT.address;
        const tokenOut = ADDRESSES[Network.ARTIO].XSGD.address;

        const funds = {
            sender: AddressZero,
            recipient: AddressZero,
            fromInternalBalance: false,
            toInternalBalance: false,
        };

        it('ExactIn', async function () {
            if (!test) this.skip();

            const swapType = SwapTypes.SwapExactIn;
            // swapAmount is tokenIn, expect tokenOut
            const swapAmount = parseFixed(SWAP_AMOUNT_IN_NUMERAIRE, 18);

            const swapInfo = await sor.getSwaps(
                tokenIn,
                tokenOut,
                swapType,
                swapAmount
            );
            if (swapInfo.swaps.length === 0) {
                console.log('No swaps found');
                return;
            }
            const queryResult = await vault.callStatic.queryBatchSwap(
                swapType,
                swapInfo.swaps,
                swapInfo.tokenAddresses,
                funds
            );

            console.log('swapInfo', swapInfo);
            console.log('queryResult', queryResult);

            // expect(swapInfo.swapAmount.toString()).to.eq(
            //     queryResult[0].toString()
            // );

            expect(swapInfo.returnAmount.toString()).to.be.eq(
                queryResult[1].abs().toString()
            );
        });

        // it('ExactOut', async function () {
        //     if (!test) this.skip();

        //     const swapType = SwapTypes.SwapExactOut;
        //     // swapAmount is tokenOut, expect tokenIn
        //     const swapAmount = parseFixed(SWAP_AMOUNT_IN_NUMERAIRE, 18);
        //     const swapInfo = await sor.getSwaps(
        //         tokenIn,
        //         tokenOut,
        //         swapType,
        //         swapAmount
        //     );

        //     const queryResult = await vault.callStatic.queryBatchSwap(
        //         swapType,
        //         swapInfo.swaps,
        //         swapInfo.tokenAddresses,
        //         funds
        //     );

        //     expect(swapInfo.returnAmount.toString()).to.be.eq(
        //         queryResult[0].abs().toString()
        //     );
        //     expect(swapInfo.swapAmount.toString()).to.eq(
        //         queryResult[1].abs().toString()
        //     );
        // });
    });
});

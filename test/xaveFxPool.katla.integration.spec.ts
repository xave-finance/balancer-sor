// yarn test:only test/xaveFxPool.katla.integration.spec.ts
import dotenv from 'dotenv';
import { JsonRpcProvider } from '@ethersproject/providers';
import { PoolFilter, SOR, SubgraphPoolBase, SwapTypes } from '../src';
import { Network, SOR_CONFIG } from './testScripts/constants';
import { parseFixed } from '@ethersproject/bignumber';
import { expect } from 'chai';
import { Vault, Vault__factory } from '@balancer-labs/typechain';
import { AddressZero } from '@ethersproject/constants';
import { setUp } from './testScripts/utils';

dotenv.config();

let sor: SOR;
const networkId = Network.KATLA;
const jsonRpcUrl = process.env.KATLA_RPC_URL;
const rpcUrl = 'http://127.0.0.1:8138';
const blocknumber = 1070561;

let vault: Vault;

const SWAP_AMOUNT_IN_NUMERAIRE = '10';

const xaveFxPoolDAI_USDC_KATLA: SubgraphPoolBase = {
    id: '0x1206b77c36bd09e4d36129a8723d9ef9356bc553000200000000000000000004',
    address: '0x1206b77c36bd09e4d36129a8723d9ef9356bc553',
    poolType: 'FX',
    swapFee: '0',
    swapEnabled: true,
    totalWeight: '0',
    totalShares: '1022113.906842707152581062',
    tokensList: [
        '0x3481c2314e4d15603a05ee7e6be25fce4b128a5c',
        '0xf7e8ab78dc91a4fdda1dfba6c81baf1870d2d957',
    ],
    tokens: [
        {
            address: '0x3481c2314e4d15603a05ee7e6be25fce4b128a5c',
            balance: '514982.21052',
            decimals: 6,
            priceRate: '1',
            weight: null,
            token: {
                latestFXPrice: '0.99980000', // roundId 92233720368547774306
                fxOracleDecimals: 8,
            },
        },
        {
            address: '0xf7e8ab78dc91a4fdda1dfba6c81baf1870d2d957',
            balance: '692755.067948',
            decimals: 6,
            priceRate: '1',
            weight: null,
            token: {
                latestFXPrice: '1.00019000', // roundId 36893488147419104088
                fxOracleDecimals: 8,
            },
        },
    ],
    alpha: '0.8',
    beta: '0.42',
    lambda: '0.3',
    delta: '0.3',
    epsilon: '0.0015',
};

const test = 'FX' in PoolFilter;

describe.skip('xaveFxPool: XSGD-USDC integration (katla) tests', () => {
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
                [xaveFxPoolDAI_USDC_KATLA],
                jsonRpcUrl as string,
                blocknumber
            );

            await sor.fetchPools();
        });

        const tokenIn = '0x3481c2314e4d15603a05ee7e6be25fce4b128a5c';
        const tokenOut = '0xf7e8ab78dc91a4fdda1dfba6c81baf1870d2d957';

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
            const swapAmount = parseFixed(SWAP_AMOUNT_IN_NUMERAIRE, 6);

            const swapInfo = await sor.getSwaps(
                tokenIn,
                tokenOut,
                swapType,
                swapAmount
            );

            const queryResult = await vault.callStatic.queryBatchSwap(
                swapType,
                swapInfo.swaps,
                swapInfo.tokenAddresses,
                funds
            );

            expect(swapInfo.swapAmount.toString()).to.eq(
                queryResult[0].toString()
            );
            console.log(swapInfo.returnAmount.toString());
            expect(13532704).to.be.eq(queryResult[1].toString());
        });

        it('ExactOut', async function () {
            if (!test) this.skip();

            const swapType = SwapTypes.SwapExactOut;
            // swapAmount is tokenOut, expect tokenIn
            const swapAmount = parseFixed(SWAP_AMOUNT_IN_NUMERAIRE, 6);

            const swapInfo = await sor.getSwaps(
                tokenIn,
                tokenOut,
                swapType,
                swapAmount
            );

            const queryResult = await vault.callStatic.queryBatchSwap(
                swapType,
                swapInfo.swaps,
                swapInfo.tokenAddresses,
                funds
            );

            expect(swapInfo.returnAmount.toString()).to.be.eq(
                queryResult[0].abs().toString()
            );
            expect(swapInfo.swapAmount.toString()).to.eq(
                queryResult[1].abs().toString()
            );
        });
    });
});

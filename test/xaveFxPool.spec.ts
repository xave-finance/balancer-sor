// yarn test:only test/xaveFxPool.spec.ts
import { expect } from 'chai';
import { parseFixed, BigNumber } from '@ethersproject/bignumber';
import { bnum, ZERO } from '../src/utils/bignumber';
import { PoolTypes } from '../src';
// Add new PoolType
import { FxPool, FxPoolPairData } from '../src/pools/xaveFxPool/fxPool';
import {
    ALMOST_ZERO,
    spotPriceBeforeSwap,
    viewRawAmount,
    _spotPriceAfterSwapExactTokenInForTokenOut,
} from '../src/pools/xaveFxPool/fxPoolMath';

// Add new pool test data in Subgraph Schema format
import testPools from './testData/fxPool/fxPool.json';
import testCases from './testData/fxPool/fxPoolTestCases.json';

type TestCaseType = {
    testNo: string;
    description: string;
    swapType: string;
    givenAmount: string;
    tokenIn: string;
    tokenOut: string;
    expectedSpotPriceBeforeSwap: string;
    expectedSpotPriceAfterSwap: string;
    expectedSwapOutput: string;
    expectedDerivativeSpotPriceAfterSwap: string;
};

describe('Test for fxPools', () => {
    context('parsePoolPairData', () => {
        it(`should correctly parse token > token`, async () => {
            // It's useful to use tokens with <18 decimals for some tests to make sure scaling is ok
            const poolData = testPools.pools[0];

            const newPool = FxPool.fromPool(poolData);

            const poolPairData = newPool.parsePoolPairData(
                newPool.tokens[0].address, // tokenIn, USDC
                newPool.tokens[1].address // tokenOut, XSGD
            );

            console.log(poolData.beta);

            expect(poolPairData.id).to.eq(poolData.id);
            expect(poolPairData.poolType).to.eq(PoolTypes.Fx);

            expect(poolPairData.alpha).to.eq(
                parseFixed(poolData.alpha, 18).toBigInt()
            );
            expect(poolPairData.beta).to.eq(
                parseFixed(poolData.beta, 18).toBigInt()
            );
            expect(poolPairData.lambda).to.eq(
                parseFixed(poolData.lambda, 18).toBigInt()
            );
            expect(poolPairData.delta).to.eq(
                parseFixed(poolData.delta, 18).toBigInt()
            );
            expect(poolPairData.epsilon).to.eq(
                parseFixed(poolData.epsilon, 18).toBigInt()
            );
        });
    });

    // All pools are weighted 50:50.
    // Max value to swap before halting is defined as
    // maxLimit  = [(1 + alpha) * oGLiq * 0.5] - token value in numeraire
    //@todo
    // context('limit amounts', () => {
    //     it.skip(`getLimitAmountSwap, token to token`, async () => {
    //         // Test limit amounts against expected values
    //         const poolData = testPools.pools[0];
    //         const newPool = FxPool.fromPool(poolData);
    //         const poolPairData = newPool.parsePoolPairData(
    //             newPool.tokens[0].address, // tokenIn
    //             newPool.tokens[1].address // tokenOut
    //         );

    //         const reservesInNumeraire = poolBalancesToNumeraire(poolPairData);
    //         const alphaValue = Number(formatFixed(poolPairData.alpha, 18));
    //         const maxLimit =
    //             (1 + alphaValue) * reservesInNumeraire._oGLiq * 0.5;

    //         const maxLimitAmountForTokenIn =
    //             maxLimit - reservesInNumeraire.tokenInReservesInNumeraire;

    //         const maxLimitAmountForTokenOut =
    //             maxLimit - reservesInNumeraire.tokenOutReservesInNumeraire;

    //         const expectedLimitForTokenIn = bnum(
    //             viewRawAmount(
    //                 BigInt(maxLimitAmountForTokenIn),
    //                 poolPairData.tokenInLatestFXPrice
    //             ).toString()
    //         );

    //         const expectedLimitForTokenOut = bnum(
    //             viewRawAmount(
    //                 BigInt(maxLimitAmountForTokenOut),
    //                 poolPairData.tokenOutLatestFXPrice
    //             ).toString()
    //         );

    //         let amount = newPool.getLimitAmountSwap(
    //             poolPairData,
    //             SwapTypes.SwapExactIn
    //         );

    //         expect(amount.toString()).to.equals(
    //             expectedLimitForTokenIn.toString()
    //         );

    //         amount = newPool.getLimitAmountSwap(
    //             poolPairData,
    //             SwapTypes.SwapExactOut
    //         );

    //         expect(amount.toString()).to.equals(
    //             expectedLimitForTokenOut.toString()
    //         );
    //     });
    // });

    // copied from the other implementations of the other project
    context('class functions', () => {
        it('getNormalizedLiquidity', async () => {
            const poolData = testPools.pools[0];
            const newPool = FxPool.fromPool(poolData);
            const poolPairData = newPool.parsePoolPairData(
                newPool.tokens[0].address, // tokenIn, USDC
                newPool.tokens[1].address // tokenOut, XSGD
            );

            expect(
                newPool.getNormalizedLiquidity(poolPairData).toNumber()
            ).to.equals(1 / ALMOST_ZERO);
        });
    });

    context('Test Swaps', () => {
        context('FxPool Test Cases', () => {
            const testCasesArray: TestCaseType[] = testCases as TestCaseType[];

            for (const testCase of testCasesArray) {
                it(`Test Case No. ${testCase.testNo} - ${testCase.description}`, async () => {
                    const givenAmount = bnum(testCase.givenAmount); // decimal is 6 for xsgd and usdc

                    const poolData = testPools.pools[0];
                    const newPool = FxPool.fromPool(poolData);

                    const poolPairData = newPool.parsePoolPairData(
                        testCase.tokenIn === 'USDC'
                            ? newPool.tokens[0].address
                            : newPool.tokens[1].address, // tokenIn
                        testCase.tokenOut === 'USDC'
                            ? newPool.tokens[0].address
                            : newPool.tokens[1].address // tokenOut
                    );

                    const spotPriceBeforeSwapValue = spotPriceBeforeSwap(
                        bnum(1),
                        poolPairData
                    );

                    console.log(
                        'spotPriceBeforeSwapValue: ',
                        spotPriceBeforeSwapValue
                    );

                    expect(spotPriceBeforeSwapValue.toFixed(9)).to.equals(
                        testCase.expectedSpotPriceBeforeSwap
                    );

                    if (testCase.swapType === 'OriginSwap') {
                        let amountOut;

                        if (testCase.testNo === '9') {
                            // CurveMathRevert.SwapConvergenceFailed
                            const amountOut = newPool._exactTokenInForTokenOut(
                                poolPairData,
                                givenAmount
                            );
                            expect(amountOut.toNumber()).to.eq(ZERO.toNumber());
                        } else {
                            amountOut = newPool._exactTokenInForTokenOut(
                                poolPairData,
                                givenAmount
                            );

                            expect(amountOut.toNumber()).to.be.closeTo(
                                viewRawAmount(
                                    parseFixed(
                                        testCase.expectedSwapOutput,
                                        18
                                    ).toBigInt(),
                                    poolPairData.tokenOutLatestFXPrice
                                ).toNumber(),
                                10000
                            ); // rounded off

                            const _spotPriceAfterSwapExactTokenInForTokenOut =
                                newPool._spotPriceAfterSwapExactTokenInForTokenOut(
                                    poolPairData,
                                    givenAmount
                                );
                            console.log(
                                'spotprice: ',
                                _spotPriceAfterSwapExactTokenInForTokenOut
                            );
                            expect(
                                Number(
                                    _spotPriceAfterSwapExactTokenInForTokenOut
                                        .toNumber()
                                        .toFixed(9)
                                )
                            ).to.be.equals(
                                Number(testCase.expectedSpotPriceAfterSwap)
                            );

                            const derivative = newPool
                                ._derivativeSpotPriceAfterSwapExactTokenInForTokenOut(
                                    poolPairData,
                                    givenAmount
                                )
                                .toNumber();
                            console.log('calculated derivative: ', derivative);
                            expect(derivative).to.be.closeTo(
                                Number(
                                    testCase.expectedDerivativeSpotPriceAfterSwap
                                ),
                                0.001 // adjustment
                            );
                        }
                    } else {
                        let amountIn;

                        if (testCase.testNo === '12') {
                            // CurveMathRevert.LowerHalt
                            const amountIn = newPool._tokenInForExactTokenOut(
                                poolPairData,
                                givenAmount
                            );

                            expect(amountIn.toNumber()).to.eq(ZERO.toNumber());
                        } else {
                            console.log('given amount: ', givenAmount);
                            amountIn = newPool._tokenInForExactTokenOut(
                                poolPairData,
                                givenAmount
                            );

                            console.log(
                                `test no. ${
                                    testCase.testNo
                                } amount in : ${amountIn.toNumber()}, raw amount: ${
                                    Number(testCase.expectedSwapOutput) /
                                    Number(poolPairData.tokenInLatestFXPrice)
                                }`
                            );

                            expect(amountIn.toNumber()).to.be.closeTo(
                                Number(testCase.expectedSwapOutput) /
                                    Number(poolPairData.tokenInLatestFXPrice),
                                2000000
                            ); // rounded off, decimal adjustment

                            const _spotPriceAfterSwapTokenInForExactTokenOut =
                                newPool._spotPriceAfterSwapTokenInForExactTokenOut(
                                    poolPairData,
                                    givenAmount
                                );

                            expect(
                                Number(
                                    _spotPriceAfterSwapTokenInForExactTokenOut
                                        .toNumber()
                                        .toFixed(9)
                                )
                            ).to.be.closeTo(
                                Number(testCase.expectedSpotPriceAfterSwap),
                                0.00001 // adjusted for test number 11
                            );

                            const derivative = newPool
                                ._derivativeSpotPriceAfterSwapTokenInForExactTokenOut(
                                    poolPairData,
                                    givenAmount
                                )
                                .toNumber();

                            expect(derivative).to.be.closeTo(
                                Number(
                                    testCase.expectedDerivativeSpotPriceAfterSwap
                                ),
                                0.001 // adjustment
                            );
                        }
                    }
                });
            }
        });
    });

    context('_spotPriceAfterSwapExactTokenInForTokenOut', () => {
        it('should return sp for 0 amount', () => {
            const amount = bnum(0);
            const poolPairData: FxPoolPairData = {
                id: '0x726e324c29a1e49309672b244bdc4ff62a270407000200000000000000000702',
                address: '0x726e324c29a1e49309672b244bdc4ff62a270407',
                poolType: 8,
                tokenIn: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
                tokenOut: '0xdc3326e71d45186f113a2f448984ca0e8d201995',
                decimalsIn: 6,
                decimalsOut: 6,
                balanceIn: BigNumber.from('0xbf24ffac00'),
                balanceOut: BigNumber.from('0x59bbba58b6'),
                swapFee: BigNumber.from('0x25'),
                alpha: BigInt('0x0b1a2bc2ec500000'),
                beta: BigInt('0x06a94d74f4300000'),
                lambda: BigInt('0x0429d069189e0000'),
                delta: BigInt('0x03cb71f51fc55800'),
                epsilon: BigInt('0x01c6bf52634000'),
                tokenInLatestFXPrice: BigInt('99963085000000'),
                tokenOutLatestFXPrice: BigInt('74200489000000'),
            };
            const sp = _spotPriceAfterSwapExactTokenInForTokenOut(
                poolPairData,
                amount
            );

            expect(sp.isNaN()).to.be.false;
        });
    });
});

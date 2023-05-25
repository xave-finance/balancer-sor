import { getAddress } from '@ethersproject/address';
import { BigNumber, formatFixed, parseFixed } from '@ethersproject/bignumber';
import { Zero } from '@ethersproject/constants';
import { BigNumber as OldBigNumber, ZERO, bnum } from '../../utils/bignumber';
import { isSameAddress } from '../../utils';
import { universalNormalizedLiquidity } from '../liquidity';
import {
    PoolBase,
    PoolPairBase,
    PoolTypes,
    SubgraphPoolBase,
    SubgraphToken,
    SwapTypes,
} from '../../types';
import {
    poolBalancesToNumeraire,
    viewRawAmount,
    _derivativeSpotPriceAfterSwapExactTokenInForTokenOut,
    _derivativeSpotPriceAfterSwapTokenInForExactTokenOut,
    _exactTokenInForTokenOut,
    _spotPriceAfterSwapExactTokenInForTokenOut,
    _spotPriceAfterSwapTokenInForExactTokenOut,
    _tokenInForExactTokenOut,
} from './fxPoolMath';
import { BONE } from '../../utils/basicOperations';

type FxPoolToken = Pick<
    SubgraphToken,
    'address' | 'balance' | 'decimals' | 'token'
>;

export type FxPoolPairData = PoolPairBase & {
    alpha: bigint;
    beta: bigint;
    lambda: bigint;
    delta: bigint;
    epsilon: bigint;
    tokenInLatestFXPrice: bigint;
    tokenOutLatestFXPrice: bigint;
};

export class FxPool implements PoolBase<FxPoolPairData> {
    poolType: PoolTypes = PoolTypes.Fx;
    id: string;
    address: string;
    swapFee: BigNumber; // from balancer
    totalShares: BigNumber; // from balancer
    tokens: FxPoolToken[];
    tokensList: string[];
    alpha: bigint;
    beta: bigint;
    lambda: bigint;
    delta: bigint;
    epsilon: bigint;

    static fromPool(pool: SubgraphPoolBase): FxPool {
        if (
            !pool.alpha ||
            !pool.beta ||
            !pool.lambda ||
            !pool.delta ||
            !pool.epsilon
        )
            throw new Error('FX Pool Missing Subgraph Field');
        return new FxPool(
            pool.id,
            pool.address,
            pool.swapFee,
            pool.totalShares,
            pool.tokens,
            pool.tokensList,
            bnum(pool.alpha), //@todo check
            pool.beta,
            pool.lambda,
            pool.delta,
            pool.epsilon
        );
    }

    constructor(
        id: string,
        address: string,
        swapFee: string,
        totalShares: string,
        tokens: FxPoolToken[],
        tokensList: string[],
        alpha: OldBigNumber,
        beta: string,
        lambda: string,
        delta: string,
        epsilon: string
    ) {
        this.id = id;
        this.address = address;
        this.swapFee = parseFixed(swapFee, 18);
        this.totalShares = parseFixed(totalShares, 18);
        this.tokens = tokens;
        this.tokensList = tokensList;
        this.alpha = parseFixed(alpha.toString(), 18).toBigInt();
        this.beta = parseFixed(beta, 18).toBigInt();
        this.lambda = parseFixed(lambda, 18).toBigInt();
        this.delta = parseFixed(delta, 18).toBigInt();
        this.epsilon = parseFixed(epsilon, 18).toBigInt();
    }
    updateTotalShares: (newTotalShares: BigNumber) => void;
    mainIndex?: number | undefined;
    isLBP?: boolean | undefined;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _calcTokensOutGivenExactBptIn(bptAmountIn: BigNumber): BigNumber[] {
        // Will copy over other implementations, not supporting BPT tokens atm
        return new Array(this.tokens.length).fill(Zero);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _calcBptOutGivenExactTokensIn(amountsIn: BigNumber[]): BigNumber {
        // Will copy over other implementations, not supporting BPT tokens atm
        return Zero;
    }

    parsePoolPairData(tokenIn: string, tokenOut: string): FxPoolPairData {
        const tokenIndexIn = this.tokens.findIndex(
            (t) => getAddress(t.address) === getAddress(tokenIn)
        );
        if (tokenIndexIn < 0) throw 'Pool does not contain tokenIn';
        const tI = this.tokens[tokenIndexIn];
        const balanceIn = tI.balance;
        const decimalsIn = tI.decimals;

        const tokenIndexOut = this.tokens.findIndex(
            (t) => getAddress(t.address) === getAddress(tokenOut)
        );

        if (tokenIndexOut < 0) throw 'Pool does not contain tokenOut';
        const tO = this.tokens[tokenIndexOut];
        const balanceOut = tO.balance;
        const decimalsOut = tO.decimals;

        if (!tO.token?.latestFXPrice || !tI.token?.latestFXPrice)
            throw 'FX Pool Missing LatestFxPrice';

        const poolPairData: FxPoolPairData = {
            id: this.id,
            address: this.address,
            poolType: this.poolType,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            decimalsIn: Number(decimalsIn),
            decimalsOut: Number(decimalsOut),
            balanceIn: parseFixed(balanceIn, 18), // subgraph balance is in number convert to wei
            balanceOut: parseFixed(balanceOut, 18), // subgraph balance is in number convert to wei
            swapFee: this.swapFee,
            alpha: this.alpha,
            beta: this.beta,
            lambda: this.lambda,
            delta: this.delta,
            epsilon: this.epsilon,
            tokenInLatestFXPrice: parseFixed(
                tI.token.latestFXPrice,
                18
            ).toBigInt(), // decimals is formatted from subgraph in rate we get from the chainlink oracle
            tokenOutLatestFXPrice: parseFixed(
                tO.token.latestFXPrice,
                18
            ).toBigInt(), // decimals is formatted from subgraph in rate we get from the chainlink oracle
        };

        return poolPairData;
    }

    // Normalized liquidity is an abstract term that can be thought of the
    // inverse of the slippage. It is proportional to the token balances in the
    // pool but also depends on the shape of the invariant curve.
    // As a standard, we define normalized liquidity in tokenOut
    getNormalizedLiquidity(poolPairData: FxPoolPairData): OldBigNumber {
        return universalNormalizedLiquidity(
            this._derivativeSpotPriceAfterSwapExactTokenInForTokenOut(
                poolPairData,
                ZERO
            )
        );
    }

    /*
    Fx pool logic has an alpha region where it halts swaps.
    maxLimit  = [(1 + alpha) * oGLiq * 0.5] - token value in numeraire
    */
    getLimitAmountSwap(
        poolPairData: FxPoolPairData,
        swapType: SwapTypes
    ): OldBigNumber {
        try {
            const parsedReserves = poolBalancesToNumeraire(poolPairData);

            const alphaValue = parseFixed(
                poolPairData.alpha.toString(),
                18
            ).toBigInt();

            const maxLimit =
                (BONE + alphaValue) *
                parsedReserves._oGLiq *
                parseFixed('0.5', 18).toBigInt();
            18;

            if (swapType === SwapTypes.SwapExactIn) {
                const maxLimitAmount =
                    maxLimit - parsedReserves.tokenInReservesInNumeraire;

                return bnum(
                    viewRawAmount(
                        BigInt(maxLimitAmount),
                        poolPairData.tokenInLatestFXPrice
                    ).toString()
                );
            } else {
                const maxLimitAmount =
                    maxLimit - parsedReserves.tokenOutReservesInNumeraire;

                return bnum(
                    viewRawAmount(
                        BigInt(maxLimitAmount),
                        poolPairData.tokenOutLatestFXPrice
                    ).toString()
                );
            }
        } catch {
            return ZERO;
        }
    }

    // Updates the balance of a given token for the pool
    updateTokenBalanceForPool(token: string, newBalance: BigNumber): void {
        // token is BPT
        if (this.address == token) {
            this.totalShares = newBalance;
        } else {
            // token is underlying in the pool
            const T = this.tokens.find((t) => isSameAddress(t.address, token));
            if (!T) throw Error('Pool does not contain this token');
            T.balance = formatFixed(newBalance, T.decimals);
        }
    }

    _exactTokenInForTokenOut(
        poolPairData: FxPoolPairData,
        amount: OldBigNumber
    ): OldBigNumber {
        try {
            return _exactTokenInForTokenOut(amount, poolPairData);
        } catch {
            return ZERO;
        }
    }

    _tokenInForExactTokenOut(
        poolPairData: FxPoolPairData,
        amount: OldBigNumber
    ): OldBigNumber {
        try {
            return _tokenInForExactTokenOut(amount, poolPairData);
        } catch {
            console.log('Catch zero for _tokenInForExactTokenOut');
            return ZERO;
        }
    }

    _spotPriceAfterSwapExactTokenInForTokenOut(
        poolPairData: FxPoolPairData,
        amount: OldBigNumber
    ): OldBigNumber {
        try {
            return _spotPriceAfterSwapExactTokenInForTokenOut(
                poolPairData,
                amount
            );
        } catch {
            console.log(
                '_spotPriceAfterSwapExactTokenInForTokenOut - catch zero'
            );
            return ZERO;
        }
    }

    _spotPriceAfterSwapTokenInForExactTokenOut(
        poolPairData: FxPoolPairData,
        amount: OldBigNumber
    ): OldBigNumber {
        try {
            return _spotPriceAfterSwapTokenInForExactTokenOut(
                poolPairData,
                amount
            );
        } catch {
            return ZERO;
        }
    }

    _derivativeSpotPriceAfterSwapExactTokenInForTokenOut(
        poolPairData: FxPoolPairData,
        amount: OldBigNumber
    ): OldBigNumber {
        try {
            return _derivativeSpotPriceAfterSwapExactTokenInForTokenOut(
                amount,
                poolPairData
            );
        } catch {
            return ZERO;
        }
    }

    _derivativeSpotPriceAfterSwapTokenInForExactTokenOut(
        poolPairData: FxPoolPairData,
        amount: OldBigNumber
    ): OldBigNumber {
        try {
            return _derivativeSpotPriceAfterSwapTokenInForExactTokenOut(
                amount,
                poolPairData
            );
        } catch {
            return ZERO;
        }
    }
}

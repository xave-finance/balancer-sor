import { ONE, BZERO } from '../../utils/basicOperations';
import { BigNumber as OldBigNumber, bnum, scale } from '../../utils/bignumber';
import { FxPoolPairData } from './fxPool';
import { parseFixed } from '@ethersproject/bignumber';

/**
 * General Flow:
 * Everything goes on either the ExactIn (origin swap) function and ExactOut (target swap) functions.
 * It goes in as OldBigNumber, converted to bigint and does all the calculations in bigint
 * then it returns it back as OldBigNumber based on how the SOR needs it
 */

/*****  CONSTANTS  *****/
export const CURVEMATH_MAX_DIFF = -0.000001000000000000024;
export const NEGATIVE_ONE = BigInt('-1');

export const ONE_TO_THE_SECOND_NUM = 100;
export const ONE_TO_THE_SECOND = BigInt(`${ONE_TO_THE_SECOND_NUM}`);
export const ONE_TO_THE_EIGHT_NUM = 100000000;
export const ONE_TO_THE_EIGHT = BigInt(`${ONE_TO_THE_EIGHT_NUM}`);
export const ONE_TO_THE_SIX_NUM = 1000000;
export const ONE_TO_THE_SIX = BigInt(`${ONE_TO_THE_SIX_NUM}`);
export const ONE_TO_THE_THIRTEEN_NUM = 10000000000000;

export const ONE_TO_THE_THIRTEEN = BigInt(`${ONE_TO_THE_THIRTEEN_NUM}`);
export const ONE_ETHER = scale(bnum('1'), 18); // 1 ether in wei
export const ALMOST_ZERO = 0.0000000000000000001; // swapping within beta region has no slippage
const CURVEMATH_MAX = '0.25'; // CURVEMATH MAX from contract
const CURVEMATH_MAX_BIGINT = parseFixed(CURVEMATH_MAX, 18).toBigInt(); // CURVEMATH_MAX converted to wei

// helper for getting the absolute value of a bigint type
// doing eslint disable to handle negative zero if it appears
// eslint-disable-next-line no-compare-neg-zero
const abs = (n): bigint => (n === -0 || n < BZERO ? -n : n);

// Messages simulating reverts from the contract
export enum CurveMathRevert {
    LowerHalt = 'CurveMath/lower-halt',
    UpperHalt = 'CurveMath/upper-halt',
    SwapInvariantViolation = 'CurveMath/swap-invariant-violation',
    SwapConvergenceFailed = 'CurveMath/swap-convergence-failed',
    CannotSwap = 'CannotSwap',
}

/*****  INTERFACES  *****/

interface ParsedFxPoolData {
    alpha: bigint;
    beta: bigint;
    delta: bigint;
    epsilon: bigint;
    lambda: bigint;
    baseTokenRate: bigint;
    _oGLiq: bigint;
    _nGLiq: bigint;
    _oBals: bigint[];
    _nBals: bigint[];
    givenAmountInNumeraire: bigint;
}

interface ReservesInNumeraire {
    tokenInReservesInNumeraire: bigint;
    tokenOutReservesInNumeraire: bigint;
    _oGLiq: bigint;
}

// checks if the token is the quote token, must be updated if we will be supporting other quote tokens
const isUSDC = (address: string) => {
    if (
        address == '0x2791bca1f2de4661ed88a30c99a7a9449aa84174' ||
        address == '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
    ) {
        return true;
    } else {
        return false;
    }
};

/*****  HELPER FUNCTIONS  *****/
// calculate given amount in numeraire and returns a BigInt type of the numeraire in wei
const calculateGivenAmountInNumeraire = (
    isOriginSwap: boolean,
    poolPairData: FxPoolPairData,
    amount: OldBigNumber
): bigint => {
    let calculatedNumeraireAmount;

    if (isOriginSwap) {
        // tokenIn is given
        calculatedNumeraireAmount = viewNumeraireAmount(
            amount,
            poolPairData.tokenInLatestFXPrice
        );
    } else {
        // tokenOut is given
        calculatedNumeraireAmount = viewNumeraireAmount(
            amount,
            poolPairData.tokenOutLatestFXPrice
        );
    }

    return calculatedNumeraireAmount;
};

// convert pool balances to numeraire, it will return both quote and base token balances in the fxpool
export const poolBalancesToNumeraire = (
    poolPairData: FxPoolPairData
): ReservesInNumeraire => {
    let tokenInNumeraire, tokenOutNumeraire;

    if (isUSDC(poolPairData.tokenIn)) {
        tokenInNumeraire =
            viewNumeraireAmount(
                bnum(poolPairData.balanceIn.toString()),
                poolPairData.tokenInLatestFXPrice
            ) / getBaseDecimals(poolPairData.decimalsIn);

        tokenOutNumeraire =
            viewNumeraireAmount(
                bnum(poolPairData.balanceOut.toString()),
                poolPairData.tokenOutLatestFXPrice
            ) / getBaseDecimals(poolPairData.decimalsOut);
    } else {
        tokenInNumeraire =
            viewNumeraireAmount(
                bnum(poolPairData.balanceOut.toString()),
                poolPairData.tokenOutLatestFXPrice
            ) / getBaseDecimals(poolPairData.decimalsOut);

        tokenOutNumeraire =
            viewNumeraireAmount(
                bnum(poolPairData.balanceIn.toString()),
                poolPairData.tokenInLatestFXPrice
            ) / getBaseDecimals(poolPairData.decimalsIn);
    }

    console.log(
        `
        poolBalancesToNumeraire
        tokenInNumeraire: ${parseFixed(
            tokenInNumeraire,
            18
        ).toBigInt()}, tokenOutNumeraire: ${parseFixed(
            tokenOutNumeraire,
            18
        ).toBigInt()}`
    );

    return {
        tokenInReservesInNumeraire: parseFixed(tokenInNumeraire, 18).toBigInt(),
        tokenOutReservesInNumeraire: parseFixed(
            tokenOutNumeraire,
            18
        ).toBigInt(),
        _oGLiq: parseFixed(tokenInNumeraire + tokenOutNumeraire, 18).toBigInt(),
    };
};

// everything is in order of USDC, base token
// this function formats the values to BigInt and work with it on the fxpool functions
const getParsedFxPoolData = (
    amount: OldBigNumber,
    poolPairData: FxPoolPairData,
    isOriginSwap: boolean
): ParsedFxPoolData => {
    // reserves are in raw amount, they converted to numeraire

    const baseReserves = isUSDC(poolPairData.tokenIn)
        ? viewNumeraireAmount(
              bnum(poolPairData.balanceOut.toString()),
              poolPairData.tokenOutLatestFXPrice
          )
        : viewNumeraireAmount(
              bnum(poolPairData.balanceIn.toString()),
              poolPairData.tokenInLatestFXPrice
          );

    console.log(`getParsedFxPoolData - baseReserves: ${baseReserves}`);

    // reserves are not in wei
    const usdcReserves = isUSDC(poolPairData.tokenIn)
        ? viewNumeraireAmount(
              bnum(poolPairData.balanceIn.toString()),
              poolPairData.tokenInLatestFXPrice
          )
        : viewNumeraireAmount(
              bnum(poolPairData.balanceOut.toString()),
              poolPairData.tokenOutLatestFXPrice
          );

    console.log(`getParsedFxPoolData - usdcReserves: ${usdcReserves}`);

    // rate is converted from chainlink to the actual rate in decimals
    const baseTokenRate = isUSDC(poolPairData.tokenIn)
        ? poolPairData.tokenOutLatestFXPrice
        : poolPairData.tokenInLatestFXPrice;

    // given amount in or out converted to numeraire
    const givenAmountInNumeraire = calculateGivenAmountInNumeraire(
        isOriginSwap,
        poolPairData,
        amount
    );
    return {
        alpha: poolPairData.alpha,
        beta: poolPairData.beta,
        delta: poolPairData.delta,
        epsilon: poolPairData.epsilon,
        lambda: poolPairData.lambda,
        baseTokenRate: baseTokenRate,
        _oGLiq: baseReserves + usdcReserves,
        _nGLiq: baseReserves + usdcReserves,
        _oBals: [usdcReserves, baseReserves],
        _nBals: isUSDC(poolPairData.tokenIn)
            ? [
                  usdcReserves + givenAmountInNumeraire,
                  baseReserves - givenAmountInNumeraire,
              ]
            : [
                  usdcReserves - givenAmountInNumeraire,
                  baseReserves + givenAmountInNumeraire,
              ],

        givenAmountInNumeraire: givenAmountInNumeraire,
    };
};

// get base decimals for
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
// returns token decimals in BigInt and in wei
export const getBaseDecimals = (decimals: number): bigint => {
    switch (decimals) {
        case 6: {
            return ONE_TO_THE_SIX;
        }

        case 2: {
            return ONE_TO_THE_SECOND;
        }

        case 18: {
            return BigInt(ONE_ETHER.toString());
        }

        default: {
            return BigInt(ONE_ETHER.toString());
        }
    }
};

/*****  ASSIMILATOR FUNCTIONS  *****/
// calculations are from the BaseToUsdAssimilator
// returns the dollar value of the amount in BigNumber type from BigNumber.js
export const viewRawAmount = (_amount: bigint, rate: bigint): OldBigNumber => {
    console.log(`viewRawAmount - rate: ${rate}`);
    console.log(`viewRawAmount - _amount: ${_amount}`);
    console.log(`viewRawAmount - _amount/ rate: ${_amount / rate}`);

    return bnum(_amount.toString())
        .dividedBy(bnum(rate.toString()))
        .dividedBy(ONE_ETHER);
};

// returns the numeraire amount in wei and BigInt type
const viewNumeraireAmount = (_amount: OldBigNumber, rate: bigint): bigint => {
    const amountInWei = BigInt(scale(_amount, 18).toString());
    return (amountInWei * rate) / ONE;
};

/*****  CURVE MATH  *****/
// calculations are from CurveMath.sol, working with BigInt
const calculateMicroFee = (
    _bal: bigint,
    _ideal: bigint,
    _beta: bigint,
    _delta: bigint
): bigint => {
    let _threshold: bigint, _feeMargin: bigint;
    let fee_ = BigInt(0);

    if (_bal < _ideal) {
        _threshold = _ideal * (ONE - _beta); // CURVEMATH ONE

        if (_bal < _threshold) {
            _feeMargin = _threshold - _bal;
            fee_ = _feeMargin / _ideal;
            fee_ = (fee_ * _delta) / ONE;

            console.log(
                `microfee - fee_ ${fee_}, CURVEMATH_MAX_BIGINT - ${CURVEMATH_MAX_BIGINT}`
            );

            if (fee_ > CURVEMATH_MAX_BIGINT) {
                fee_ = CURVEMATH_MAX_BIGINT;
            }

            fee_ = fee_ * _feeMargin;
            fee_ = BZERO;
        }
    } else {
        _threshold = _ideal * (ONE + _beta); // CURVEMATH_ONE

        if (_bal > _threshold) {
            _feeMargin = _bal - _threshold;

            fee_ = _feeMargin / _ideal;
            fee_ = (fee_ * _delta) / ONE;

            console.log(
                `microfee - fee_ ${fee_}, CURVEMATH_MAX_BIGINT - ${CURVEMATH_MAX_BIGINT}`
            );
            if (fee_ > CURVEMATH_MAX_BIGINT) fee_ = CURVEMATH_MAX_BIGINT;

            fee_ = fee_ * _feeMargin;
        } else {
            fee_ = BZERO;
        }
    }

    return fee_;
};

// calculations are from CurveMath.sol, working with BigInt
const calculateFee = (
    _gLiq: bigint,
    _bals: bigint[],
    _beta: bigint,
    _delta: bigint,
    _weights: bigint[]
): bigint => {
    const _length = _bals.length;
    let psi_ = BZERO;
    // @todo check decimals for multiplication
    for (let i = 0; i < _length; i++) {
        const _ideal = _gLiq * _weights[i];

        // keep away from wei values like how the contract do it
        psi_ = psi_ + calculateMicroFee(_bals[i], _ideal, _beta, _delta);
        console.log(
            `${i} psi - ${psi_} _gLiq - ${_gLiq},  _weights - ${_weights[i]}`
        );
    }

    return psi_;
};

// return outputAmount and ngliq
// calculations are from CurveMath.sol, working with BigInt
const calculateTrade = (
    _oGLiq: bigint,
    _nGLiq: bigint,
    _oBals: bigint[],
    _nBals: bigint[],
    _inputAmt: bigint,
    _outputIndex: number,
    poolPairData: ParsedFxPoolData
): [bigint, bigint] => {
    let outputAmt_;
    const _weights: bigint[] = [
        parseFixed('0.5', 18).toBigInt(),
        parseFixed('0.5', 18).toBigInt(),
    ]; // const for now since all weights are 0.5

    const alpha = poolPairData.alpha;
    const beta = poolPairData.beta;
    const delta = poolPairData.delta;
    const lambda = poolPairData.lambda;

    outputAmt_ = -_inputAmt;

    const _omega = calculateFee(_oGLiq, _oBals, beta, delta, _weights);
    console.log('calculateTrade - omega: ', _omega);
    console.log('calculateTrade - outputAmt: ', outputAmt_);
    let _psi: bigint;

    for (let i = 0; i < 32; i++) {
        _psi = calculateFee(_nGLiq, _nBals, beta, delta, _weights);

        const prevAmount = outputAmt_;

        outputAmt_ =
            _omega < _psi
                ? -(_inputAmt + (_omega - _psi))
                : -(_inputAmt + lambda * (_omega - _psi));

        console.log(
            'calculateTrade - outputAmt after checking omega and psi: ',
            outputAmt_
        );

        // @todo check

        if (
            outputAmt_ / ONE_TO_THE_THIRTEEN ==
            prevAmount / ONE_TO_THE_THIRTEEN
        ) {
            _nGLiq = _oGLiq + _inputAmt + outputAmt_;
            console.log('calculateTrade after conditional - oGLiq: ', _oGLiq);
            console.log('calculateTrade after conditional - nGLiq: ', _nGLiq);

            _nBals[_outputIndex] = _oBals[_outputIndex] + outputAmt_;
            console.log(
                'calculateTrade after conditional  - output balance: ',
                _nBals[_outputIndex]
            );

            // throws error already, removed if statement
            enforceSwapInvariant(_oGLiq, _omega, _nGLiq, _psi);
            enforceHalts(_oGLiq, _nGLiq, _oBals, _nBals, _weights, alpha);

            console.log('calculate trade - output: ', outputAmt_);

            return [outputAmt_, _nGLiq];
        } else {
            _nGLiq = _oGLiq + _inputAmt + outputAmt_;

            _nBals[_outputIndex] = _oBals[_outputIndex] + outputAmt_;
        }
    }

    throw new Error(CurveMathRevert.SwapConvergenceFailed);
};

// invariant enforcement
// calculations are from CurveMath.sol, working with BigInt
const enforceHalts = (
    _oGLiq: bigint,
    _nGLiq: bigint,
    _oBals: bigint[],
    _nBals: bigint[],
    _weights: bigint[],
    alpha: bigint
): boolean => {
    const _length = _nBals.length;
    const _alpha = alpha;

    for (let i = 0; i < _length; i++) {
        const _nIdeal = (_nGLiq * _weights[i]) / ONE;
        console.log('enforce halts - nIdeal: ', _nIdeal);
        console.log('enforce halts - nGLiq: ', _nGLiq);

        if (_nBals[i] > _nIdeal) {
            const _upperAlpha = ONE + _alpha;

            const _nHalt = (_nIdeal * _upperAlpha) / ONE;
            console.log(`enforceHalts oHalt - _upperAlpha: ${_upperAlpha}`);
            console.log(`enforceHalts - _nBals[i]  ${_nBals[i]}`);
            console.log(`enforceHalts - _oBals[i]  ${_oBals[i]}`);
            console.log(`enforceHalts - _nHalt  ${_nHalt}`);

            console.log(
                'enforceHalts - _nBals[i] > _nHalt',
                _nBals[i] > _nHalt
            );

            if (_nBals[i] > _nHalt) {
                const _oHalt = (_oGLiq * _weights[i] * _upperAlpha) / ONE / ONE;

                if (_oBals[i] < _oHalt) {
                    throw new Error(CurveMathRevert.UpperHalt);
                }
                if (_nBals[i] - _nHalt > _oBals[i] - _oHalt) {
                    throw new Error(CurveMathRevert.UpperHalt);
                }
            }
        } else {
            const _lowerAlpha = ONE - _alpha;

            const _nHalt = (_nIdeal * _lowerAlpha) / ONE;

            if (_nBals[i] < _nHalt) {
                let _oHalt = _oGLiq * _weights[i];
                _oHalt = (_oHalt * _lowerAlpha) / ONE / ONE; // @todo
                console.log(`enforceHalts oHalt - _lowerAlpha: ${_lowerAlpha}`);
                console.log(`enforceHalts - _oBals[i]  ${_oBals[i]}`);
                console.log(`enforceHalts - _oHalt  ${_oHalt}`);
                console.log(`enforceHalts - _nHalt  ${_oHalt}`);

                if (_oBals[i] > _oHalt) {
                    console.log('1');
                    console.log('lower halt - _oBals[i]: ', _oBals[i]);
                    console.log('lower halt - _oHalt: ', _oHalt);
                    throw new Error(CurveMathRevert.LowerHalt);
                }

                if (_nHalt - _nBals[i] > _oHalt - _oBals[i]) {
                    console.log('2');
                    throw new Error(CurveMathRevert.LowerHalt);
                }
            }
        }
    }
    return true;
};

// calculations are from CurveMath.sol, working with BigInt
const enforceSwapInvariant = (
    _oGLiq: bigint,
    _omega: bigint,
    _nGLiq: bigint,
    _psi: bigint
): boolean => {
    const _nextUtil = _nGLiq - _psi;

    const _prevUtil = _oGLiq - _omega;

    const _diff = _nextUtil - _prevUtil;

    // from int128 private constant MAX_DIFF = -0x10C6F7A0B5EE converted to plain decimals
    if (0 < _diff || _diff >= CURVEMATH_MAX_DIFF) {
        return true;
    } else {
        throw new Error(CurveMathRevert.SwapInvariantViolation);
    }
};

/*****  SWAP FUNCTION  *****/

// origin swap
export function _exactTokenInForTokenOut(
    amount: OldBigNumber,
    poolPairData: FxPoolPairData
): OldBigNumber {
    const parsedFxPoolData = getParsedFxPoolData(amount, poolPairData, true);

    console.log(`origin swap - amount: ${amount.toString()}`);
    const targetAmountInNumeraire = parsedFxPoolData.givenAmountInNumeraire;

    console.log(
        `origin swap - targetAmountInNumeraire: ${targetAmountInNumeraire}`
    );

    if (poolPairData.tokenIn === poolPairData.tokenOut) {
        return viewRawAmount(
            targetAmountInNumeraire,
            poolPairData.tokenInLatestFXPrice
        ); // must be the token out
    }

    const _oGLiq = parsedFxPoolData._oGLiq;
    const _nGLiq = parsedFxPoolData._nGLiq;
    const _oBals = parsedFxPoolData._oBals;
    const _nBals = parsedFxPoolData._nBals;

    console.log(`
    _exactTokenInForTokenOut - bals and liqs:
    _oGLiq: ${_oGLiq}
    _nGLiq: ${_nGLiq}
    _oBals: ${_nBals}
    `);

    const _amt = calculateTrade(
        _oGLiq, // _oGLiq
        _nGLiq, // _nGLiq
        _oBals, // _oBals
        _nBals, // _nBals
        targetAmountInNumeraire, // input amount
        isUSDC(poolPairData.tokenIn) ? 1 : 0, // if USDC return base token (index 1), else return 0 for USDC out
        parsedFxPoolData
    );
    console.log(`_exactTokenInForTokenOut - _amt[0]: ${_amt[0]}`);

    if (_amt === undefined) {
        throw new Error(CurveMathRevert.CannotSwap);
    } else {
        const epsilon = parsedFxPoolData.epsilon;

        const _amtWithFee = (_amt[0] * (ONE - epsilon)) / ONE; // fee retained by the pool
        console.log('_exactTokenInForTokenOut - _amtWithFee', _amtWithFee);
        // console.log(
        //     '_exactTokenInForTokenOut return amount',
        //     viewRawAmount(_amtWithFee, poolPairData.tokenOutLatestFXPrice)
        // );
        return viewRawAmount(_amtWithFee, poolPairData.tokenOutLatestFXPrice);
    }
}

// target swap
export function _tokenInForExactTokenOut(
    amount: OldBigNumber,
    poolPairData: FxPoolPairData
): OldBigNumber {
    console.log(`target swap - amount: ${amount.toString()}`);
    // const amountIn = scale(amount, poolPairData.decimalsOut);
    const parsedFxPoolData = getParsedFxPoolData(amount, poolPairData, false);
    const targetAmountInNumeraire = -parsedFxPoolData.givenAmountInNumeraire;

    console.log(
        `target swap - targetAmountInNumeraire: ${targetAmountInNumeraire}`
    );

    if (poolPairData.tokenIn === poolPairData.tokenOut) {
        viewRawAmount(
            // poolPairData.tokenOut as TokenSymbol,
            targetAmountInNumeraire,
            poolPairData.tokenOutLatestFXPrice
        ); // must be the token out
    }

    const _oGLiq = parsedFxPoolData._oGLiq;
    const _nGLiq = parsedFxPoolData._nGLiq;
    const _oBals = parsedFxPoolData._oBals;
    const _nBals = parsedFxPoolData._nBals;

    console.log(`
    _tokenInForExactTokenOut - bals and liqs:
    _oGLiq: ${_oGLiq}
    _nGLiq: ${_nGLiq}
    _oBals: ${_nBals}
    `);

    const _amt = calculateTrade(
        _oGLiq, // _oGLiq
        _nGLiq, // _nGLiq
        _oBals, // _oBals
        _nBals, // _nBals
        targetAmountInNumeraire,
        isUSDC(poolPairData.tokenIn) ? 0 : 1, // if USDC return 0 else return 1 for base token
        parsedFxPoolData
    );

    console.log(`_tokenInForExactTokenOut - _amt[0]: ${_amt[0]}`);

    if (_amt === undefined) {
        throw new Error(CurveMathRevert.CannotSwap);
    } else {
        const epsilon = poolPairData.epsilon;

        const _amtWithFee = (_amt[0] * (ONE + epsilon)) / ONE; // fee retained by the pool
        console.log(
            '_tokenInForExactTokenOut - ONE + epsilon: ',
            ONE + epsilon
        );

        console.log(
            '_tokenInForExactTokenOut - outputAmount w/o fee: ',
            _amt[0]
        );
        console.log(
            '_tokenInForExactTokenOut - outputAmount with fee: ',
            _amtWithFee
        );

        // console.log(
        //     '_tokenInForExactTokenOut return amount',
        //     viewRawAmount(_amtWithFee, poolPairData.tokenInLatestFXPrice)
        // );
        return viewRawAmount(_amtWithFee, poolPairData.tokenInLatestFXPrice); // must be the token out
    }
}

/*****  SOR CALCULATORS *****/

export const spotPriceBeforeSwap = (
    amount: OldBigNumber,
    poolPairData: FxPoolPairData
): OldBigNumber => {
    // input amount 1 XSGD to get the output in USDC
    const parsedFxPoolData = getParsedFxPoolData(amount, poolPairData, true);

    const _oGLiq = parsedFxPoolData._oGLiq;
    const _nGLiq = parsedFxPoolData._nGLiq;
    const _oBals = parsedFxPoolData._oBals;
    const _nBals = parsedFxPoolData._nBals;

    const outputAmountInNumeraire = calculateTrade(
        _oGLiq, // _oGLiq
        _nGLiq, // _nGLiq
        _oBals, // _oBals
        _nBals, // _nBals
        ONE, // one ether in wei
        0, // always output in USDC
        parsedFxPoolData
    );

    // @todo change ONE to be more dynamic
    const checkValue = bnum(
        (
            ((abs(outputAmountInNumeraire[0]) *
                (ONE - parsedFxPoolData.epsilon)) /
                abs(ONE)) *
            parsedFxPoolData.baseTokenRate
        ).toString()
    );

    return checkValue.dividedBy(ONE_ETHER).dividedBy(ONE_ETHER);
};

// spot price after origin swap
export const _spotPriceAfterSwapExactTokenInForTokenOut = (
    poolPairData: FxPoolPairData,
    amount: OldBigNumber
): OldBigNumber => {
    console.log('_spotPriceAfterSwapExactTokenInForTokenOut fx math in');
    const parsedFxPoolData = getParsedFxPoolData(amount, poolPairData, true);

    const targetAmountInNumeraire = parsedFxPoolData.givenAmountInNumeraire;
    console.log(
        'spot price - targetAmountInNumeraire: ',
        targetAmountInNumeraire
    );

    const _oGLiq = parsedFxPoolData._oGLiq;
    const _nBals = parsedFxPoolData._nBals;
    const currentRate = parsedFxPoolData.baseTokenRate;
    const beta = parsedFxPoolData.beta;
    const epsilon = parsedFxPoolData.epsilon;
    const _nGLiq = parsedFxPoolData._nGLiq;
    const _oBals = parsedFxPoolData._oBals;

    const outputAfterTrade = calculateTrade(
        _oGLiq, // _oGLiq
        _nGLiq, // _nGLiq
        _oBals, // _oBals
        _nBals, // _nBals
        targetAmountInNumeraire, // input amount
        isUSDC(poolPairData.tokenIn) ? 1 : 0, // if USDC return base token (index 1), else return 0 for USDC out
        parsedFxPoolData
    );

    const outputAmount = outputAfterTrade[0];

    // Divide by 2 instead of multiplying with 0.5
    const maxBetaLimit: bigint = (((ONE + beta) / BigInt(2)) * _oGLiq) / ONE;
    console.log(
        '_spotPriceAfterSwapExactTokenInForTokenOut - maxBetaLimit: ',
        maxBetaLimit
    );
    // Divide by 2 instead of multiplying with 0.5
    const minBetaLimit: bigint = (((ONE - beta) / BigInt(2)) * _oGLiq) / ONE;
    console.log(
        '_spotPriceAfterSwapExactTokenInForTokenOut - minBetaLimit',
        minBetaLimit
    );

    if (isUSDC(poolPairData.tokenIn)) {
        // token[0] to token [1] in originswap
        const oBals0after = _nBals[0];
        const oBals1after = _nBals[1];

        if (oBals1after < minBetaLimit && oBals0after > maxBetaLimit) {
            // returns 0 because  Math.abs(targetAmountInNumeraire)) * currentRate
            // used that function with a 0 amount to get a market spot price for the pool
            // which is used in front end display.
            console.log(
                '_spotPriceAfterSwapExactTokenInForTokenOut : scenario 1'
            );
            return amount.isZero()
                ? spotPriceBeforeSwap(amount, poolPairData)
                : bnum(
                      (
                          (abs(outputAmount * (ONE - epsilon)) /
                              abs(targetAmountInNumeraire)) *
                          currentRate
                      ).toString()
                  )
                      .dividedBy(ONE_ETHER)
                      .dividedBy(ONE_ETHER); //@todo check
        } else {
            console.log(
                '_spotPriceAfterSwapExactTokenInForTokenOut : scenario 2'
            );
            // @todo check with other scenarios
            return bnum((currentRate * (ONE - epsilon)).toString())
                .dividedBy(ONE_ETHER)
                .dividedBy(ONE_ETHER);
        }
    } else {
        // if usdc is tokenOut
        //  token[1] to token [0] in originswap
        const oBals0after = _nBals[1];
        const oBals1after = _nBals[0];

        if (oBals1after < minBetaLimit && oBals0after > maxBetaLimit) {
            console.log(
                '_spotPriceAfterSwapExactTokenInForTokenOut : scenario 3'
            );
            if (amount.isZero())
                return spotPriceBeforeSwap(amount, poolPairData);

            const ratioOfOutputAndInput =
                abs(outputAmount * (ONE - epsilon)) /
                abs(targetAmountInNumeraire);

            return bnum((ratioOfOutputAndInput * currentRate).toString())
                .dividedBy(ONE_ETHER)
                .dividedBy(ONE_ETHER);
        } else {
            console.log(
                '_spotPriceAfterSwapExactTokenInForTokenOut : scenario 4'
            );
            return bnum((currentRate * (ONE - epsilon)).toString())
                .dividedBy(ONE_ETHER)
                .dividedBy(ONE_ETHER);
        }
    }
};

// spot price after target swap
// the less the normalized liquidity
// we must have a absolute of the derivative price
export const _spotPriceAfterSwapTokenInForExactTokenOut = (
    poolPairData: FxPoolPairData,
    amount: OldBigNumber
): OldBigNumber => {
    const parsedFxPoolData = getParsedFxPoolData(amount, poolPairData, false);

    const targetAmountInNumeraire = -parsedFxPoolData.givenAmountInNumeraire;

    const _oGLiq = parsedFxPoolData._oGLiq;
    const _nBals = parsedFxPoolData._nBals;
    const currentRate = parsedFxPoolData.baseTokenRate;

    const beta = parsedFxPoolData.beta;
    const epsilon = parsedFxPoolData.epsilon;

    const _nGLiq = parsedFxPoolData._nGLiq;
    const _oBals = parsedFxPoolData._oBals;

    const outputAfterTrade = calculateTrade(
        _oGLiq, // _oGLiq
        _nGLiq, // _nGLiq
        _oBals, // _oBals
        _nBals, // _nBals
        targetAmountInNumeraire, // input amount
        isUSDC(poolPairData.tokenIn) ? 0 : 1, // if USDC return 0 else return 1 for base token
        parsedFxPoolData
    );

    const outputAmount = outputAfterTrade[0];

    // Divide by 2 instead of multiplying with 0.5
    const maxBetaLimit: bigint = ((ONE + beta) / BigInt(2)) * _oGLiq;
    const minBetaLimit: bigint = ((ONE - beta) / BigInt(2)) * _oGLiq;

    if (isUSDC(poolPairData.tokenIn)) {
        // token[0] to token [1] in originswap
        const oBals0after = _nBals[0];
        const oBals1after = _nBals[1];

        if (oBals1after < minBetaLimit && oBals0after > maxBetaLimit) {
            console.log(
                '_spotPriceAfterSwapTokenInForExactTokenOut : scenario 1'
            );
            return bnum(
                (
                    (abs(targetAmountInNumeraire) /
                        abs(outputAmount * (ONE + epsilon))) *
                    currentRate
                ).toString()
            )
                .dividedBy(ONE_ETHER)
                .dividedBy(ONE_ETHER);
        } else {
            console.log(
                '_spotPriceAfterSwapTokenInForExactTokenOut : scenario 2'
            );
            return bnum((currentRate * (ONE - epsilon)).toString())
                .dividedBy(ONE_ETHER)
                .dividedBy(ONE_ETHER);
        }
    } else {
        //  token[1] to token [0] in originswap
        const oBals0after = _nBals[0];
        const oBals1after = _nBals[1];

        const isBeyondMinBeta = oBals0after < minBetaLimit;
        const isBeyondMaxBeta = oBals1after > maxBetaLimit;

        if (isBeyondMinBeta && isBeyondMaxBeta) {
            console.log(
                '_spotPriceAfterSwapTokenInForExactTokenOut : scenario 3'
            );
            return bnum(
                (
                    (abs(targetAmountInNumeraire) /
                        abs(outputAmount * (ONE + epsilon))) *
                    currentRate
                ).toString()
            )
                .dividedBy(ONE_ETHER)
                .dividedBy(ONE_ETHER);
        } else {
            console.log(
                '_spotPriceAfterSwapTokenInForExactTokenOut : scenario 4'
            );
            return bnum((currentRate * (ONE - epsilon)).toString())
                .dividedBy(ONE_ETHER)
                .dividedBy(ONE_ETHER);
        }
    }
};

// origin swap
export const _derivativeSpotPriceAfterSwapExactTokenInForTokenOut = (
    amount: OldBigNumber,
    poolPairData: FxPoolPairData
): OldBigNumber => {
    // @todo check and fix
    const x = spotPriceBeforeSwap(bnum('1'), poolPairData);
    console.log(
        '_derivativeSpotPriceAfterSwapExactTokenInForTokenOut - x: ',
        x
    );
    const y = _spotPriceAfterSwapExactTokenInForTokenOut(poolPairData, amount);
    const yMinusX = y.minus(x);
    console.log(
        '_derivativeSpotPriceAfterSwapExactTokenInForTokenOut - y: ',
        y
    );
    const ans = yMinusX.div(x);
    return ans.isZero() ? bnum(ALMOST_ZERO) : ans.abs();
};

// target swap
export const _derivativeSpotPriceAfterSwapTokenInForExactTokenOut = (
    amount: OldBigNumber,
    poolPairData: FxPoolPairData
): OldBigNumber => {
    // @todo check and fix
    const x = spotPriceBeforeSwap(bnum('1'), poolPairData);
    console.log(
        '_derivativeSpotPriceAfterSwapTokenInForExactTokenOut - x: ',
        x
    );
    const y = _spotPriceAfterSwapTokenInForExactTokenOut(poolPairData, amount);
    console.log(
        '_derivativeSpotPriceAfterSwapTokenInForExactTokenOut - y: ',
        y
    );
    const yMinusX = y.minus(x);
    const ans = yMinusX.div(x);
    return ans.abs();
};

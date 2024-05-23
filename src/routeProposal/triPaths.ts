import { PoolDictionary, NewPath, PoolBase, PoolPairBase } from '../types';
import { createPath, getHighestLiquidityPool } from './filtering';

type TokenWithPools = {
    token: string;
    mostLiquidPoolIn: PoolBase<PoolPairBase> | null;
    mostLiquidPoolOut: PoolBase<PoolPairBase> | null;
};

/**
 * For each midpool construct 3 hop paths like: tokenIn[poolA]tokenA[MidPool]tokenB[poolB]tokenOut.
 * tokenA/B are midpool pool tokens.
 * poolA/B are most liquid pools connecting tokenIn/Out to tokenA/B.
 * @param tokenIn
 * @param tokenOut
 * @param poolsAllDict
 * @param midPoolsId
 * @returns
 */
export function getTriPaths(
    tokenIn: string,
    tokenOut: string,
    poolsAllDict: PoolDictionary,
    midPoolsId: string[]
): NewPath[] {
    const triPaths: NewPath[] = [];
    midPoolsId.forEach((midPoolId) => {
        const midPoolTriPaths = getMidPoolTriPaths(
            tokenIn,
            tokenOut,
            poolsAllDict,
            midPoolId
        );
        triPaths.push(...midPoolTriPaths);
    });
    return triPaths;
}

function getMidPoolTriPaths(
    tokenIn: string,
    tokenOut: string,
    poolsAllDict: PoolDictionary,
    midPoolId: string
): NewPath[] {
    // We only want to use a pool as middle hop if tokenIn/Out aren't it's pool tokens as normal algo should take care of that path.
    const midPool = getValidPool(tokenIn, tokenOut, poolsAllDict, midPoolId);
    if (midPool === null) return [];
    // For each midPool pool token find the most liquid pool connecting tokenIn/Out
    const tokenPools = getTokenPools(tokenIn, tokenOut, poolsAllDict, midPool);
    // Construct all possible paths via midPool using most liquid connecting pools
    return constructPaths(tokenIn, tokenOut, tokenPools, midPool);
}

export interface PoolSimple {
    id: string; // Added pool ID
    tokens: string[];
}

export function findSwapPathPools(
    tX: string,
    tY: string,
    pools: PoolSimple[]
): string[] {
    const graph: Record<string, string[]> = {};

    // Build graph from pools (including pool IDs in edges)
    for (const pool of pools) {
        for (let i = 0; i < pool.tokens.length; i++) {
            for (let j = i + 1; j < pool.tokens.length; j++) {
                const token1 = pool.tokens[i];
                const token2 = pool.tokens[j];
                graph[token1] = graph[token1] || [];
                // Edge now includes pool ID:
                graph[token1].push(`${token2}@${pool.id}`);
                graph[token2] = graph[token2] || [];
                graph[token2].push(`${token1}@${pool.id}`);
            }
        }
    }

    const queue: [string, [string, string][]][] = [[tX, []]]; // Queue with path (token, [token, poolId][])
    const visited = new Set<string>([tX]);

    while (queue.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const [currentToken, path] = queue.shift()!;
        if (currentToken === tY) {
            return path.map((p) => p[1]); // Path found - return only the poolIds
        }

        for (const neighborWithPool of graph[currentToken] || []) {
            const [neighbor, poolId] = neighborWithPool.split('@');
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push([neighbor, [...path, [currentToken, poolId]]]);
            }
        }
    }

    return []; // No path found
}

/**
 * Construct all possible paths for tokenIn>tokenOut via midPool using most liquid connecting pools
 * @param tokenIn
 * @param tokenOut
 * @param tokensWithPools
 * @param midPool
 * @returns
 */
function constructPaths(
    tokenIn: string,
    tokenOut: string,
    tokensWithPools: TokenWithPools[],
    midPool: PoolBase<PoolPairBase>
): NewPath[] {
    const paths: NewPath[] = [];
    // For each valid mostLiquidPoolIn create a path via midPool and any valid mostLiquidPoolOut
    tokensWithPools.forEach((tokenWithPoolsIn, i) => {
        const mostLiquidPoolIn = tokenWithPoolsIn.mostLiquidPoolIn;
        if (!mostLiquidPoolIn) return;
        const remainingTokensWithPools = [
            ...tokensWithPools.slice(0, i),
            ...tokensWithPools.slice(i + 1),
        ];
        remainingTokensWithPools.forEach((tokenWithPoolsOut) => {
            if (!tokenWithPoolsOut.mostLiquidPoolOut) return;
            // console.log(
            //     `tokenIn[${mostLiquidPoolIn.id}]${tokenWithPoolsIn.token}[${midPool.id}]${tokenWithPoolsOut.token}[${tokenWithPoolsOut.mostLiquidPoolOut.id}]tokenOut`
            // );
            const tokens = [
                tokenIn,
                tokenWithPoolsIn.token,
                tokenWithPoolsOut.token,
                tokenOut,
            ];
            const pools = [
                mostLiquidPoolIn,
                midPool,
                tokenWithPoolsOut.mostLiquidPoolOut,
            ];
            paths.push(createPath(tokens, pools));
        });
    });
    return paths;
}

/**
 * For each token in pool find the most liquid pool connecting tokenIn/Out
 * @param tokenIn
 * @param tokenOut
 * @param poolsAllDict
 * @param pool
 * @returns
 */
function getTokenPools(
    tokenIn: string,
    tokenOut: string,
    poolsAllDict: PoolDictionary,
    pool: PoolBase<PoolPairBase>
): TokenWithPools[] {
    const tokenPools: TokenWithPools[] = pool.tokensList.map((token) => {
        return { token, mostLiquidPoolIn: null, mostLiquidPoolOut: null };
    });

    tokenPools.forEach((t) => {
        const mostLiquidInId = getHighestLiquidityPool(
            tokenIn,
            t.token,
            poolsAllDict
        );
        const mostLiquidOutId = getHighestLiquidityPool(
            t.token,
            tokenOut,
            poolsAllDict
        );
        t.mostLiquidPoolIn = mostLiquidInId
            ? poolsAllDict[mostLiquidInId]
            : null;
        t.mostLiquidPoolOut = mostLiquidOutId
            ? poolsAllDict[mostLiquidOutId]
            : null;
    });
    return tokenPools;
}

/**
 * We only want to use a pool as middle hop if tokenIn/Out aren't it's pool tokens as normal algo should take care of that path.
 * @param tokenIn
 * @param tokenOut
 * @param poolsAllDict
 * @param poolId
 * @returns
 */
function getValidPool(
    tokenIn: string,
    tokenOut: string,
    poolsAllDict: PoolDictionary,
    poolId: string
): PoolBase<PoolPairBase> | null {
    const pool = poolsAllDict[poolId];
    if (!pool) return null;
    if (
        pool.tokensList.some(
            (t) =>
                t.toLowerCase() === tokenIn.toLowerCase() ||
                t.toLowerCase() === tokenOut.toLowerCase()
        )
    ) {
        return null;
    }
    return pool;
}

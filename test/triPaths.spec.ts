import { expect } from 'chai';
import { findSwapPathPools, PoolSimple } from '../src/routeProposal/triPaths';

describe('TriPaths Dynamic', () => {
    it('should find mid pools', () => {
        const pools: PoolSimple[] = [
            { id: 'pool1', tokens: ['tA', 'tB', 'tC', 'tX'] },
            { id: 'pool2', tokens: ['tB', 'tX', 'tD'] },
            { id: 'pool3', tokens: ['tD', 'tE', 'tB'] },
            { id: 'pool4', tokens: ['tE', 'tY'] },
        ];

        expect(findSwapPathPools('tD', 'tB', pools)).to.deep.eq(['pool2']);
        expect(findSwapPathPools('tX', 'tY', pools)).to.deep.eq([
            'pool1',
            'pool3',
            'pool4',
        ]);
        expect(findSwapPathPools('tD', 'tA', pools)).to.deep.eq([
            'pool2',
            'pool1',
        ]);
        expect(findSwapPathPools('tZ', 'tY', pools)).to.deep.eq([]);
    });
});

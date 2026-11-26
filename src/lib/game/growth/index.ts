import { OrganicGrowthLayer } from './organic';
import type { GrowthContext, GrowthLayer, GrowthMode } from './types';

export * from './types';
export { OrganicGrowthLayer };

export function createGrowthLayer(_mode: GrowthMode, context: GrowthContext): GrowthLayer {
	return new OrganicGrowthLayer(context);
}

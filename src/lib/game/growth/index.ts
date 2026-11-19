import { CircularGrowthLayer } from './circular';
import { OrganicGrowthLayer } from './organic';
import { SmoothGrowthLayer } from './smooth';
import type { GrowthContext, GrowthLayer, GrowthMode } from './types';

export * from './types';
export { CircularGrowthLayer, OrganicGrowthLayer, SmoothGrowthLayer };

export function createGrowthLayer(mode: GrowthMode, context: GrowthContext): GrowthLayer {
	switch (mode) {
		case 'circular':
			return new CircularGrowthLayer(context);
		case 'smooth':
			return new SmoothGrowthLayer(context);
		case 'organic':
			return new OrganicGrowthLayer(context);
	}
}

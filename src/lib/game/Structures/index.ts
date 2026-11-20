/**
 * Structures are persistent map objects that anchor or modify territory.
 *
 * State structures anchor protected mainland and project a large defensive
 * aura. Buildable structures are bought as cards and dropped onto controlled
 * territory. Any structure whose cell is captured is razed.
 *
 * Each type's definition lives in its own file in this folder.
 */

export * from './types';
export * from './definitions';
export * from './registry';
export * from './state';
export * from './artillery';
export * from './barracks';
export * from './fortification';
export * from './jammer';
export * from './command-post';
export * from './war-academy';

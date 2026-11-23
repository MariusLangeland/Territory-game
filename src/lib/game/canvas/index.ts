/**
 * Helpers behind GameCanvas: the render/frame loop, pointer and camera input,
 * the 2D structure overlay, and the shared canvas contract types.
 *
 * GameCanvas itself only wires Svelte props and canvases to these controllers.
 */
export type { HoverInfo, RemoteVisual } from './types';
export { CanvasFrameLoop, type CanvasFrameLoopHost } from './frame-loop';
export { CanvasPointerInput, type CanvasInputHost } from './input';
export { StructureOverlay, type StructureOverlayFrame } from './structure-overlay';

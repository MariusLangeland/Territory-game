import { PALETTE } from '../constants';
import type { TerritorySimulation } from '../simulation';
import { MapCamera } from './camera';
import { TERRITORY_SHADER } from './territory.wgsl';

const UNIFORM_FLOATS = 16;
const MAX_DEVICE_PIXEL_RATIO = 2;
const UPLOAD_TILE_SIZE = 64;

export class WebGPUUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'WebGPUUnavailableError';
	}
}

export interface RendererFrameStats {
	fps: number;
	uploadedPixels: number;
	frames: number;
}

/**
 * Owns the GPU resources and the authoritative CPU-side control texture.
 *
 * The CPU texture is the single source of truth for visuals. Simulation
 * changes are written in-place and only the changed bounding rectangle is
 * uploaded, so a busy tick touches kilobytes instead of the full 8 MiB map.
 */
export class TerritoryRenderer {
	readonly camera: MapCamera;
	readonly stats: RendererFrameStats = { fps: 0, uploadedPixels: 0, frames: 0 };
	hover: { x: number; y: number } | null = null;
	onDeviceLost?: (message: string) => void;

	private readonly device: GPUDevice;
	private readonly context: GPUCanvasContext;
	private readonly format: GPUTextureFormat;
	private readonly pipeline: GPURenderPipeline;
	private readonly mapTexture: GPUTexture;
	private readonly paletteTexture: GPUTexture;
	private readonly sampler: GPUSampler;
	private readonly uniformBuffer: GPUBuffer;
	private readonly bindGroup: GPUBindGroup;
	private readonly controlPixels: Uint8Array;
	private readonly uniformData = new Float32Array(UNIFORM_FLOATS);
	private readonly tilesX: number;
	private readonly tilesY: number;
	private readonly tileMarks: Uint32Array;
	private readonly dirtyRows: Uint8Array;

	private tileGeneration = 0;
	private fullUploadNeeded = false;
	private lastFrameTime = performance.now();
	private frameAccumulator = 0;
	private frameCounter = 0;
	private uploadedPixelsThisSecond = 0;
	private destroyed = false;

	private constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly simulation: TerritorySimulation,
		device: GPUDevice,
		context: GPUCanvasContext,
		format: GPUTextureFormat,
		pipeline: GPURenderPipeline,
		mapTexture: GPUTexture,
		paletteTexture: GPUTexture,
		sampler: GPUSampler,
		uniformBuffer: GPUBuffer,
		bindGroup: GPUBindGroup
	) {
		this.device = device;
		this.context = context;
		this.format = format;
		this.pipeline = pipeline;
		this.mapTexture = mapTexture;
		this.paletteTexture = paletteTexture;
		this.sampler = sampler;
		this.uniformBuffer = uniformBuffer;
		this.bindGroup = bindGroup;
		this.camera = new MapCamera(simulation.width, simulation.height);

		this.controlPixels = new Uint8Array(simulation.width * simulation.height * 4);
		this.tilesX = Math.ceil(simulation.width / UPLOAD_TILE_SIZE);
		this.tilesY = Math.ceil(simulation.height / UPLOAD_TILE_SIZE);
		this.tileMarks = new Uint32Array(this.tilesX * this.tilesY);
		this.dirtyRows = new Uint8Array(this.tilesY);
		this.buildControlTexture();
		this.uploadFullTexture();
		this.resize();
	}

	static async create(
		canvas: HTMLCanvasElement,
		simulation: TerritorySimulation
	): Promise<TerritoryRenderer> {
		if (!('gpu' in navigator) || !navigator.gpu) {
			throw new WebGPUUnavailableError(
				'WebGPU is not available in this browser. Use a current Chromium-based browser or enable WebGPU.'
			);
		}

		const adapter = await navigator.gpu.requestAdapter({
			powerPreference: 'high-performance'
		});
		if (!adapter) {
			throw new WebGPUUnavailableError(
				'WebGPU could not find a compatible graphics adapter. Check browser hardware acceleration.'
			);
		}

		const device = await adapter.requestDevice();
		const context = canvas.getContext('webgpu');
		if (!context) {
			throw new WebGPUUnavailableError('Could not create a WebGPU canvas context.');
		}

		const format = navigator.gpu.getPreferredCanvasFormat();
		context.configure({
			device,
			format,
			alphaMode: 'opaque'
		});

		const shaderModule = device.createShaderModule({
			code: TERRITORY_SHADER,
			label: 'territory-map-shader'
		});
		const compilation = await shaderModule.getCompilationInfo();
		const errors = compilation.messages.filter((message) => message.type === 'error');
		if (errors.length > 0) {
			throw new Error(
				`Territory shader failed to compile:\n${errors.map((e) => e.message).join('\n')}`
			);
		}

		const pipeline = device.createRenderPipeline({
			label: 'territory-map-pipeline',
			layout: 'auto',
			vertex: { module: shaderModule, entryPoint: 'vs' },
			fragment: {
				module: shaderModule,
				entryPoint: 'fs',
				targets: [{ format }]
			},
			primitive: { topology: 'triangle-list' }
		});

		const mapTexture = device.createTexture({
			label: 'territory-control',
			size: { width: simulation.width, height: simulation.height },
			format: 'rgba8unorm',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
		});

		const paletteTexture = device.createTexture({
			label: 'territory-palette',
			size: { width: 256, height: 1 },
			format: 'rgba8unorm',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
		});
		const paletteData = new Uint8Array(256 * 4);
		for (let i = 0; i < 256; i++) {
			const color = PALETTE[i] ?? { rgb: [0, 0, 0] as const };
			paletteData[i * 4] = color.rgb[0];
			paletteData[i * 4 + 1] = color.rgb[1];
			paletteData[i * 4 + 2] = color.rgb[2];
			paletteData[i * 4 + 3] = 255;
		}
		device.queue.writeTexture(
			{ texture: paletteTexture },
			paletteData,
			{ bytesPerRow: 256 * 4 },
			{ width: 256, height: 1 }
		);

		const sampler = device.createSampler({
			label: 'territory-nearest',
			magFilter: 'nearest',
			minFilter: 'nearest',
			mipmapFilter: 'nearest',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge'
		});

		const uniformBuffer = device.createBuffer({
			label: 'territory-uniforms',
			size: UNIFORM_FLOATS * 4,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
		});

		const bindGroup = device.createBindGroup({
			label: 'territory-bind-group',
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 1, resource: mapTexture.createView() },
				{ binding: 2, resource: paletteTexture.createView() },
				{ binding: 3, resource: sampler }
			]
		});

		const renderer = new TerritoryRenderer(
			canvas,
			simulation,
			device,
			context,
			format,
			pipeline,
			mapTexture,
			paletteTexture,
			sampler,
			uniformBuffer,
			bindGroup
		);

		void device.lost.then((info) => {
			if (renderer.destroyed || info.reason === 'destroyed') return;
			renderer.onDeviceLost?.(info.message || 'The GPU device was lost.');
		});

		return renderer;
	}

	/**
	 * Apply a completed simulation tick. Must be called before the next tick so
	 * the packed change buffer is still valid.
	 */
	applyChanges(changes: Uint32Array, count: number, overflow = false): void {
		if (overflow) {
			this.rebuildFromSimulation();
			this.fullUploadNeeded = true;
			this.uploadDirty();
			return;
		}

		const width = this.simulation.width;
		const height = this.simulation.height;
		if (count === 0) return;

		this.tileGeneration = (this.tileGeneration + 1) >>> 0 || 1;
		this.dirtyRows.fill(0);

		for (let i = 0; i < count; i++) {
			const packed = changes[i];
			const owner = packed >>> 21;
			const index = packed & 0x1f_ffff;
			const x = index % width;
			const y = (index - x) / width;
			if (x < 0 || y < 0 || x >= width || y >= height) continue;

			this.controlPixels[index * 4] = owner;

			const tileX = Math.floor(x / UPLOAD_TILE_SIZE);
			const tileY = Math.floor(y / UPLOAD_TILE_SIZE);
			const tileIndex = tileY * this.tilesX + tileX;
			if (this.tileMarks[tileIndex] !== this.tileGeneration) {
				this.tileMarks[tileIndex] = this.tileGeneration;
				this.dirtyRows[tileY] = 1;
			}
		}

		this.uploadDirty();
	}

	/** Full resync, for reconnects, GPU reset, or a dropped change batch. */
	rebuildFromSimulation(): void {
		const { owners, terrain, terrainShade } = this.simulation;
		for (let i = 0; i < owners.length; i++) {
			const offset = i * 4;
			this.controlPixels[offset] = owners[i];
			this.controlPixels[offset + 1] = terrain[i] ? 255 : 0;
			this.controlPixels[offset + 2] = terrainShade[i];
			this.controlPixels[offset + 3] = 255;
		}
		this.fullUploadNeeded = true;
	}

	render(now = performance.now()): void {
		if (this.destroyed) return;
		this.resize();

		const dpr = this.currentDpr();
		const width = this.canvas.width;
		const height = this.canvas.height;
		const u = this.uniformData;

		u[0] = width;
		u[1] = height;
		u[2] = this.camera.centerX;
		u[3] = this.camera.centerY;
		u[4] = this.simulation.width;
		u[5] = this.simulation.height;
		u[6] = this.hover?.x ?? -1;
		u[7] = this.hover?.y ?? -1;
		u[8] = this.camera.scale * dpr;
		u[9] = now / 1000;
		u[10] = this.camera.zoom;
		u[11] = dpr;

		this.device.queue.writeBuffer(this.uniformBuffer, 0, u);

		const encoder = this.device.createCommandEncoder();
		const pass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: this.context.getCurrentTexture().createView(),
					clearValue: { r: 0.003, g: 0.009, b: 0.017, a: 1 },
					loadOp: 'clear',
					storeOp: 'store'
				}
			]
		});
		pass.setPipeline(this.pipeline);
		pass.setBindGroup(0, this.bindGroup);
		pass.draw(3);
		pass.end();
		this.device.queue.submit([encoder.finish()]);

		this.frameCounter++;
		this.frameAccumulator += now - this.lastFrameTime;
		this.lastFrameTime = now;
		if (this.frameAccumulator >= 1000) {
			this.stats.fps = Math.round((this.frameCounter * 1000) / this.frameAccumulator);
			this.stats.uploadedPixels = this.uploadedPixelsThisSecond;
			this.stats.frames += this.frameCounter;
			this.frameCounter = 0;
			this.frameAccumulator = 0;
			this.uploadedPixelsThisSecond = 0;
		}
	}

	resize(): void {
		const dpr = this.currentDpr();
		const cssWidth = Math.max(1, this.canvas.clientWidth);
		const cssHeight = Math.max(1, this.canvas.clientHeight);
		const width = Math.max(1, Math.round(cssWidth * dpr));
		const height = Math.max(1, Math.round(cssHeight * dpr));

		if (this.canvas.width !== width || this.canvas.height !== height) {
			this.canvas.width = width;
			this.canvas.height = height;
		}

		this.camera.setViewport(cssWidth, cssHeight);
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.mapTexture.destroy();
		this.paletteTexture.destroy();
		this.uniformBuffer.destroy();
		this.device.destroy();
	}

	private buildControlTexture(): void {
		const { owners, terrain, terrainShade } = this.simulation;
		for (let i = 0; i < owners.length; i++) {
			const offset = i * 4;
			this.controlPixels[offset] = owners[i];
			this.controlPixels[offset + 1] = terrain[i] ? 255 : 0;
			this.controlPixels[offset + 2] = terrainShade[i];
			this.controlPixels[offset + 3] = 255;
		}
	}

	private uploadFullTexture(): void {
		const { width, height } = this.simulation;
		this.device.queue.writeTexture(
			{ texture: this.mapTexture },
			this.controlPixels,
			{ bytesPerRow: width * 4, rowsPerImage: height },
			{ width, height }
		);
		this.fullUploadNeeded = false;
		this.uploadedPixelsThisSecond += width * height;
	}

	/**
	 * Changes from one tick are collected into 64x64 upload tiles. Adjacent
	 * dirty tiles on the same row become a single strip upload. This keeps far
	 * apart bot battles from inflating a single global dirty rectangle.
	 */
	private uploadDirty(): void {
		if (this.fullUploadNeeded) {
			this.uploadFullTexture();
			return;
		}

		const width = this.simulation.width;
		const height = this.simulation.height;
		const bytesPerRow = width * 4;

		for (let tileY = 0; tileY < this.tilesY; tileY++) {
			if (!this.dirtyRows[tileY]) continue;

			for (let tileX = 0; tileX < this.tilesX; tileX++) {
				const markIndex = tileY * this.tilesX + tileX;
				if (this.tileMarks[markIndex] !== this.tileGeneration) continue;

				let runEnd = tileX + 1;
				while (
					runEnd < this.tilesX &&
					this.tileMarks[tileY * this.tilesX + runEnd] === this.tileGeneration
				) {
					runEnd++;
				}

				const x = tileX * UPLOAD_TILE_SIZE;
				const y = tileY * UPLOAD_TILE_SIZE;
				const w = Math.min((runEnd - tileX) * UPLOAD_TILE_SIZE, width - x);
				const h = Math.min(UPLOAD_TILE_SIZE, height - y);

				this.device.queue.writeTexture(
					{ texture: this.mapTexture, origin: { x, y } },
					this.controlPixels,
					{
						offset: (y * width + x) * 4,
						bytesPerRow,
						rowsPerImage: h
					},
					{ width: w, height: h }
				);

				this.uploadedPixelsThisSecond += w * h;
				tileX = runEnd - 1;
			}
		}
	}

	private currentDpr(): number {
		const native = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
		return Math.min(MAX_DEVICE_PIXEL_RATIO, Math.max(1, native));
	}
}

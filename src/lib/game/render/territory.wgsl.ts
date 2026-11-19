export const TERRITORY_SHADER = /* wgsl */ `
struct Uniforms {
  resolution: vec2<f32>,
  camera: vec2<f32>,
  mapSize: vec2<f32>,
  hover: vec2<f32>,
  scale: f32,
  time: f32,
  zoom: f32,
  dpr: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var mapTexture: texture_2d<f32>;
@group(0) @binding(2) var paletteTexture: texture_2d<f32>;
@group(0) @binding(3) var mapSampler: sampler;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  var out: VertexOut;
  out.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return out;
}

fn controlAt(uv: vec2<f32>) -> vec4<f32> {
  return textureSampleLevel(mapTexture, mapSampler, uv, 0.0);
}

fn ownerAt(uv: vec2<f32>) -> u32 {
  return u32(round(controlAt(uv).r * 255.0));
}

fn paletteAt(owner: u32) -> vec3<f32> {
  let index = (f32(owner) + 0.5) / 256.0;
  return textureSampleLevel(paletteTexture, mapSampler, vec2<f32>(index, 0.5), 0.0).rgb;
}

fn screenGrid(mapPos: vec2<f32>, spacing: f32, width: f32) -> f32 {
  let cell = fract(mapPos / spacing);
  let distanceToLine = abs(cell - vec2<f32>(0.5)) * 2.0;
  let edge = max(distanceToLine.x, distanceToLine.y);
  return smoothstep(1.0 - width, 1.0, edge);
}

@fragment
fn fs(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
  let screen = fragCoord.xy;
  let mapPos = u.camera + (screen - u.resolution * 0.5) / max(u.scale, 0.0001);

  let insideMap = mapPos.x >= 0.0 && mapPos.y >= 0.0 &&
    mapPos.x < u.mapSize.x && mapPos.y < u.mapSize.y;

  if (!insideMap) {
    // Deep water beyond the atlas edge, with a coordinate grid for orientation.
    let distanceToMap = max(
      max(-mapPos.x, mapPos.x - u.mapSize.x),
      max(-mapPos.y, mapPos.y - u.mapSize.y)
    );
    let grid = screenGrid(mapPos, 256.0, 0.035);
    let shimmer = sin(mapPos.x * 0.011 + u.time * 0.18) * cos(mapPos.y * 0.014 - u.time * 0.13);
    var color = vec3<f32>(0.006, 0.015, 0.026) + shimmer * 0.004;
    color += vec3<f32>(0.05, 0.15, 0.16) * grid * 0.35;
    color += vec3<f32>(0.14, 0.33, 0.33) * (1.0 - smoothstep(0.0, 7.0, distanceToMap)) * 0.22;
    return vec4<f32>(color, 1.0);
  }

  let mapPixel = floor(mapPos);
  let uv = (mapPixel + vec2<f32>(0.5)) / u.mapSize;
  let texel = vec2<f32>(1.0) / u.mapSize;

  let control = controlAt(uv);
  let owner = u32(round(control.r * 255.0));
  let isLand = control.g > 0.5;
  let shade = control.b;

  let west = controlAt(uv - vec2<f32>(texel.x, 0.0));
  let east = controlAt(uv + vec2<f32>(texel.x, 0.0));
  let north = controlAt(uv - vec2<f32>(0.0, texel.y));
  let south = controlAt(uv + vec2<f32>(0.0, texel.y));

  let westOwner = u32(round(west.r * 255.0));
  let eastOwner = u32(round(east.r * 255.0));
  let northOwner = u32(round(north.r * 255.0));
  let southOwner = u32(round(south.r * 255.0));

  let neighbourLand =
    west.g > 0.5 || east.g > 0.5 || north.g > 0.5 || south.g > 0.5;
  let neighbourOcean =
    west.g < 0.5 || east.g < 0.5 || north.g < 0.5 || south.g < 0.5;

  var color: vec3<f32>;

  if (isLand) {
    let base = paletteAt(owner);
    let tint = 0.64 + shade * 0.52;
    color = base * tint;

    // A one-pixel territory frontier. A player border and an unclaimed-land
    // border use the same deterministic comparison, which keeps the map legible.
    let ownerEdge =
      (west.g > 0.5 && westOwner != owner) ||
      (east.g > 0.5 && eastOwner != owner) ||
      (north.g > 0.5 && northOwner != owner) ||
      (south.g > 0.5 && southOwner != owner);

    if (ownerEdge) {
      color = mix(color, color * 0.34, 0.78);
    }

    if (neighbourOcean) {
      color = mix(color, vec3<f32>(0.82, 0.88, 0.69), 0.34);
    }

    // Fine relief grain keeps huge single-colour territories from looking flat.
    let grain = fract(sin(dot(mapPixel, vec2<f32>(12.9898, 78.233))) * 43758.5453);
    color += (grain - 0.5) * 0.034;

    // Elevation contours are derived from the stored terrain shade. They stay
    // cheap, deterministic, and unchanged by ownership changes.
    let contourDistance = abs(fract(control.b * 22.0 + 0.5) - 0.5);
    let contour = 1.0 - smoothstep(0.0, 0.055, contourDistance);
    color = mix(color, color * 0.82, contour * 0.42);

    // At combat zoom, expose the pixel grid so the raster nature of the world
    // reads clearly without turning the zoomed-out atlas into moiré.
    let pixelLineX = 1.0 - smoothstep(0.0, 0.08, abs(fract(mapPos.x + 0.5) - 0.5));
    let pixelLineY = 1.0 - smoothstep(0.0, 0.08, abs(fract(mapPos.y + 0.5) - 0.5));
    let pixelGrid = max(pixelLineX, pixelLineY) * smoothstep(1.4, 3.4, u.zoom);
    color *= 1.0 - pixelGrid * 0.075;
  } else {
    let waveA = sin(mapPos.x * 0.042 + u.time * 0.55) * cos(mapPos.y * 0.038 - u.time * 0.41);
    let waveB = sin((mapPos.x + mapPos.y) * 0.012 - u.time * 0.24);
    let water = clamp(0.5 + waveA * 0.22 + waveB * 0.18, 0.0, 1.0);
    color = mix(vec3<f32>(0.012, 0.047, 0.077), vec3<f32>(0.031, 0.111, 0.145), water);

    if (neighbourLand) {
      color = mix(color, vec3<f32>(0.22, 0.48, 0.47), 0.34);
    }

    let grid = screenGrid(mapPos, 192.0, 0.018);
    color += vec3<f32>(0.09, 0.22, 0.23) * grid * 0.24;
  }

  let edgeDistance = min(
    min(mapPos.x, u.mapSize.x - mapPos.x),
    min(mapPos.y, u.mapSize.y - mapPos.y)
  );
  color = mix(color, vec3<f32>(0.37, 0.57, 0.52), (1.0 - smoothstep(0.0, 2.5, edgeDistance)) * 0.45);

  if (u.hover.x >= 0.0) {
    let delta = abs(mapPos - (u.hover + vec2<f32>(0.5)));
    let halfSize = 7.0 * u.dpr / max(u.scale, 0.0001);
    let thickness = max(1.0 * u.dpr / max(u.scale, 0.0001), halfSize * 0.10);
    let box = max(delta.x, delta.y);
    if (box < halfSize && box > halfSize - thickness) {
      color = mix(color, vec3<f32>(1.0, 0.91, 0.66), 0.94);
    }
    if (delta.x < thickness * 0.55 && delta.y < halfSize * 0.55) {
      color = mix(color, vec3<f32>(1.0, 0.91, 0.66), 0.85);
    }
    if (delta.y < thickness * 0.55 && delta.x < halfSize * 0.55) {
      color = mix(color, vec3<f32>(1.0, 0.91, 0.66), 0.85);
    }
  }

  // Soft centre glow and darker edges keep the HUD readable.
  let screenUv = screen / u.resolution;
  let vignette = 1.0 - smoothstep(0.2, 0.78, distance(screenUv, vec2<f32>(0.5, 0.5)));
  color *= 0.84 + vignette * 0.22;

  return vec4<f32>(color, 1.0);
}
`;

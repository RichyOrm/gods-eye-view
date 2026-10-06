/**
 * Guard against WebGL maximumTextureSize violations on high-resolution displays
 * and constrained GPUs (#905).
 *
 * Cesium's GlobeDepth and FramebufferManager allocate framebuffer depth and color
 * textures matching the canvas drawing buffer dimensions (canvas.width / canvas.height).
 *
 * When the canvas drawing buffer exceeds the WebGL context's maximum texture size
 * (e.g. 2048 on software/ANGLE fallbacks or integrated GPUs when entering fullscreen on
 * a 2560x1440 or 4K display), Cesium's Texture constructor throws DeveloperError:
 *
 *   DeveloperError: Width must be less than or equal to the maximum texture size (2048). Check maximumTextureSize.
 *
 * This terminates Cesium's render loop and crashes the application with a fatal error banner.
 *
 * We mitigate this by clamping the canvas resolution scale and drawing buffer dimensions
 * during widget resize so that neither drawing buffer dimension can exceed
 * scene.context.maximumTextureSize.
 *
 * @module app/textureSizeCompat
 */

/**
 * Calculate the maximum allowable resolution scale for the canvas dimensions.
 * @param {object} input Sizing parameters.
 * @param {number} input.clientWidth Canvas client width in CSS pixels.
 * @param {number} input.clientHeight Canvas client height in CSS pixels.
 * @param {number} [input.pixelRatio] Effective device pixel ratio.
 * @param {number} input.maxTextureSize Context maximum texture size in pixels.
 * @returns {number} Clamped resolution scale multiplier (<= 1.0).
 */
export function calculateMaxAllowedResolutionScale({
  clientWidth,
  clientHeight,
  pixelRatio = 1,
  maxTextureSize,
}) {
  if (!Number.isFinite(maxTextureSize) || maxTextureSize <= 0) return 1;
  if (!Number.isFinite(clientWidth) || !Number.isFinite(clientHeight)) return 1;
  if (clientWidth <= 0 || clientHeight <= 0) return 1;

  const effectiveRatio =
    Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const maxDimension = Math.max(clientWidth, clientHeight) * effectiveRatio;
  if (maxDimension <= maxTextureSize) return 1;

  return maxTextureSize / maxDimension;
}

/**
 * Apply the maximum texture size guard to the Cesium viewer.
 * @param {object} viewer Cesium.Viewer instance.
 */
export function applyTextureSizeWorkaround(viewer) {
  const widget = viewer?.cesiumWidget;
  const scene = viewer?.scene;
  const maxTextureSize = scene?.context?.maximumTextureSize;
  if (!widget || !Number.isFinite(maxTextureSize) || maxTextureSize <= 0)
    return;

  const originalResize = widget.resize.bind(widget);
  widget.resize = function () {
    const canvas = widget._canvas;
    if (canvas && canvas.clientWidth > 0 && canvas.clientHeight > 0) {
      const baseRatio = widget._useBrowserRecommendedResolution
        ? 1
        : globalThis.window?.devicePixelRatio || 1;
      const currentScale = widget._resolutionScale || 1;
      const targetWidth = canvas.clientWidth * baseRatio * currentScale;
      const targetHeight = canvas.clientHeight * baseRatio * currentScale;

      if (targetWidth > maxTextureSize || targetHeight > maxTextureSize) {
        const clampRatio = Math.min(
          maxTextureSize / (canvas.clientWidth * baseRatio),
          maxTextureSize / (canvas.clientHeight * baseRatio),
        );
        widget._resolutionScale = Math.min(currentScale, clampRatio);
      }
    }

    originalResize();

    if (canvas) {
      if (canvas.width > maxTextureSize) canvas.width = maxTextureSize;
      if (canvas.height > maxTextureSize) canvas.height = maxTextureSize;
    }
  };

  if (scene?.preRender?.addEventListener) {
    scene.preRender.addEventListener(() => {
      const canvas = viewer?.canvas;
      if (canvas) {
        if (canvas.width > maxTextureSize) canvas.width = maxTextureSize;
        if (canvas.height > maxTextureSize) canvas.height = maxTextureSize;
      }
    });
  }

  try {
    widget.resize();
  } catch {
    /* ignore during headless/early initialization */
  }
}

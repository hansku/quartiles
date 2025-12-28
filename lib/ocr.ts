/**
 * Optimized OCR system with:
 * 1. Worker pool for parallel processing
 * 2. Early exit on high confidence results
 * 3. Efficient strategy ordering
 * 
 * CRITICAL RULE: NO WORKAROUNDS, NO FALLBACKS, NO HARDCODED SOLUTIONS
 * - Do not add post-processing corrections for specific misreads
 * - Do not add hardcoded mappings or substitutions
 * - Do not add fallback logic that masks root causes
 * - Fix the root cause: improve preprocessing, OCR parameters, or image quality
 * - If OCR misreads, improve the actual OCR accuracy, don't patch the results
 */

import { createWorker, Worker } from 'tesseract.js';
import {
  detectTileRegions,
  preprocessImage,
  extractRegion,
  loadImageToCanvas,
  type TileRegion,
  type DetectionResult,
  type DebugImage
} from './tile-detector';

export type PreprocessingMode = 'original' | 'binary' | 'contrast' | 'adaptive' | 'auto';
export type ScalingMode = 'none' | 'auto';

interface OCRStrategy {
  name: string;
  preprocessing: 'contrast' | 'binary' | 'adaptive' | 'original';
  psmMode: number;
  confidenceThreshold: number;
}

// Build strategies based on preprocessing mode
function getStrategies(preprocessingMode: PreprocessingMode): OCRStrategy[] {
  if (preprocessingMode === 'auto') {
    // Try all preprocessing modes, ordered by typical effectiveness
    return [
      { name: 'binary-psm7', preprocessing: 'binary', psmMode: 7, confidenceThreshold: 5 },
      { name: 'binary-psm8', preprocessing: 'binary', psmMode: 8, confidenceThreshold: 5 },
      { name: 'contrast-psm7', preprocessing: 'contrast', psmMode: 7, confidenceThreshold: 5 },
      { name: 'contrast-psm8', preprocessing: 'contrast', psmMode: 8, confidenceThreshold: 5 },
      { name: 'adaptive-psm7', preprocessing: 'adaptive', psmMode: 7, confidenceThreshold: 5 },
      { name: 'adaptive-psm8', preprocessing: 'adaptive', psmMode: 8, confidenceThreshold: 5 },
      { name: 'original-psm7', preprocessing: 'original', psmMode: 7, confidenceThreshold: 5 },
      { name: 'original-psm8', preprocessing: 'original', psmMode: 8, confidenceThreshold: 5 },
    ];
  }
  
  // Use only the specified preprocessing mode with both PSM modes
  return [
    { name: `${preprocessingMode}-psm7`, preprocessing: preprocessingMode, psmMode: 7, confidenceThreshold: 5 },
    { name: `${preprocessingMode}-psm8`, preprocessing: preprocessingMode, psmMode: 8, confidenceThreshold: 5 },
  ];
}

// High confidence threshold - if we exceed this, skip remaining strategies for the tile
const HIGH_CONFIDENCE_THRESHOLD = 80;

// Number of workers in the pool
const WORKER_POOL_SIZE = 4;

/**
 * Worker pool for efficient OCR processing
 */
class WorkerPool {
  private workers: Worker[] = [];
  private available: Worker[] = [];
  private waiting: ((worker: Worker) => void)[] = [];
  private initialized = false;

  async initialize(size: number = WORKER_POOL_SIZE): Promise<void> {
    if (this.initialized) return;
    
    console.log(`Initializing worker pool with ${size} workers...`);
    const startTime = performance.now();
    
    // Create all workers in parallel
    this.workers = await Promise.all(
      Array(size).fill(0).map(() => createWorker('eng'))
    );
    this.available = [...this.workers];
    this.initialized = true;
    
    console.log(`Worker pool initialized in ${(performance.now() - startTime).toFixed(0)}ms`);
  }

  async acquire(): Promise<Worker> {
    if (this.available.length > 0) {
      return this.available.pop()!;
    }
    
    // Wait for a worker to become available
    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(worker: Worker): void {
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift()!;
      resolve(worker);
    } else {
      this.available.push(worker);
    }
  }

  async terminate(): Promise<void> {
    await Promise.all(this.workers.map(w => w.terminate()));
    this.workers = [];
    this.available = [];
    this.initialized = false;
  }
}

/**
 * Convert canvas to data URL for debugging
 */
function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}

/**
 * Prepare a tile region for OCR - extract, scale, and preprocess
 */
function prepareTileForOCR(
  canvas: HTMLCanvasElement,
  region: TileRegion,
  strategy: OCRStrategy,
  tileIndex: number,
  scalingMode: ScalingMode = 'none',
  debugImages?: DebugImage[]
): HTMLCanvasElement {
  // Extract the region - use minimal crop to avoid reading adjacent tiles
  const crop = 1;
  const croppedRegion: TileRegion = {
    x: Math.max(0, region.x + crop),
    y: Math.max(0, region.y + crop),
    width: Math.max(1, Math.min(canvas.width - (region.x + crop), region.width - crop * 2)),
    height: Math.max(1, Math.min(canvas.height - (region.y + crop), region.height - crop * 2)),
  };
  
  const regionCanvas = extractRegion(canvas, croppedRegion);
  
  // Debug: capture original region
  if (debugImages) {
    debugImages.push({
      tileIndex,
      step: 'original-region',
      imageData: canvasToDataUrl(regionCanvas),
      description: `Original region (${regionCanvas.width}x${regionCanvas.height}px)`
    });
  }
  
  // Scale to optimal size for OCR (only if auto scaling is enabled)
  let finalCanvas = regionCanvas;
  
  if (scalingMode === 'auto') {
    const minSize = 150;
    const maxSize = 300;
    const optimalSize = 250;
    
    const currentMin = Math.min(regionCanvas.width, regionCanvas.height);
    const currentMax = Math.max(regionCanvas.width, regionCanvas.height);
    
    if (currentMin < minSize) {
      const scale = Math.min(5, minSize / currentMin);
      const scaledCanvas = document.createElement('canvas');
      scaledCanvas.width = Math.round(regionCanvas.width * scale);
      scaledCanvas.height = Math.round(regionCanvas.height * scale);
      const ctx = scaledCanvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(regionCanvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
        finalCanvas = scaledCanvas;
        if (debugImages) {
          debugImages.push({
            tileIndex,
            step: 'scaled-up',
            imageData: canvasToDataUrl(finalCanvas),
            description: `Scaled up ${scale.toFixed(2)}x (${finalCanvas.width}x${finalCanvas.height}px)`
          });
        }
      }
    } else if (currentMax > maxSize) {
      const scale = optimalSize / currentMax;
      const scaledCanvas = document.createElement('canvas');
      scaledCanvas.width = Math.round(regionCanvas.width * scale);
      scaledCanvas.height = Math.round(regionCanvas.height * scale);
      const ctx = scaledCanvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(regionCanvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
        finalCanvas = scaledCanvas;
        if (debugImages) {
          debugImages.push({
            tileIndex,
            step: 'scaled-down',
            imageData: canvasToDataUrl(finalCanvas),
            description: `Scaled down ${scale.toFixed(2)}x (${finalCanvas.width}x${finalCanvas.height}px)`
          });
        }
      }
    } else if (debugImages) {
      debugImages.push({
        tileIndex,
        step: 'no-scaling',
        imageData: canvasToDataUrl(finalCanvas),
        description: `No scaling needed (${finalCanvas.width}x${finalCanvas.height}px)`
      });
    }
  } else if (debugImages) {
    debugImages.push({
      tileIndex,
      step: 'scaling-disabled',
      imageData: canvasToDataUrl(finalCanvas),
      description: `Scaling disabled (${finalCanvas.width}x${finalCanvas.height}px)`
    });
  }
  
  // Preprocess the region
  const processed = preprocessImage(finalCanvas, strategy.preprocessing);
  
  if (debugImages) {
    debugImages.push({
      tileIndex,
      step: `preprocessed-${strategy.preprocessing}`,
      imageData: canvasToDataUrl(processed),
      description: `Preprocessed: ${strategy.preprocessing} (PSM ${strategy.psmMode})`
    });
  }
  
  return processed;
}

/**
 * Parse OCR result to extract text and confidence
 */
function parseOCRResult(data: any): { text: string | null; confidence: number } {
  const fullText = (data.text || '').trim().toLowerCase();
  const words = data.words || [];
  const lines = data.lines || [];
  const symbols = data.symbols || [];
  
  // Collect all candidates
  const candidates: Array<{ text: string; conf: number }> = [];
  
  // From full text
  if (fullText) {
    const cleaned = fullText.replace(/[^a-z]/g, '').trim();
    if (cleaned.length >= 2 && cleaned.length <= 10) {
      candidates.push({ text: cleaned, conf: 60 });
    }
  }
  
  // From lines
  for (const line of lines) {
    const text = (line.text || '').trim().toLowerCase();
    if (text) {
      const cleaned = text.replace(/[^a-z]/g, '').trim();
      if (cleaned.length >= 2 && cleaned.length <= 10) {
        candidates.push({ text: cleaned, conf: line.confidence || 50 });
      }
    }
  }
  
  // From words
  for (const word of words) {
    const text = (word.text || '').trim().toLowerCase();
    if (text) {
      const cleaned = text.replace(/[^a-z]/g, '').trim();
      if (cleaned.length >= 2 && cleaned.length <= 10) {
        candidates.push({ text: cleaned, conf: word.confidence || 30 });
      }
    }
  }
  
  // From symbols - most reliable for short tiles
  const sortedSymbols = [...symbols]
    .filter(s => /^[a-z]$/.test((s.text || '').trim().toLowerCase()))
    .sort((a, b) => (a.bbox?.x0 || 0) - (b.bbox?.x0 || 0));
  
  let symbolText = '';
  let symbolConfSum = 0;
  const symbolConfs: number[] = [];
  
  // Debug: log symbol details including alternatives
  if (sortedSymbols.length > 0) {
    const symbolDetails = sortedSymbols.map(s => {
      const char = (s.text || '').trim().toLowerCase();
      const conf = (s.confidence || 0).toFixed(1);
      const choices = s.choices?.slice(0, 3).map((c: any) => `${c.text}:${c.confidence?.toFixed(0)}`).join(',') || 'no-alts';
      return `${char}(${conf}%)[${choices}]`;
    }).join(' ');
    console.log(`Symbols: ${symbolDetails}`);
  }
  
  for (const symbol of sortedSymbols) {
    const text = (symbol.text || '').trim().toLowerCase();
    const conf = symbol.confidence || 0;
    symbolText += text;
    symbolConfSum += conf;
    symbolConfs.push(conf);
  }
  
  if (symbolText.length >= 2 && symbolText.length <= 10) {
    const avgConf = symbolConfs.length > 0 ? symbolConfSum / symbolConfs.length : 35;
    const minConf = symbolConfs.length > 0 ? Math.min(...symbolConfs) : 0;
    const qualityBonus = minConf > 40 ? 20 : minConf > 30 ? 10 : 0;
    const boostedConf = symbolText.length <= 3 
      ? avgConf + 40 + qualityBonus
      : avgConf + 25 + qualityBonus;
    
    candidates.push({ text: symbolText, conf: boostedConf });
  }
  
  // Prefer symbol-based results for short tiles
  if (symbolText.length >= 2) {
    const avgConf = symbolConfs.length > 0 ? symbolConfSum / symbolConfs.length : 50;
    return { text: symbolText, confidence: avgConf };
  }
  
  // Fallback to best candidate
  if (candidates.length > 0) {
    const unique = new Map<string, number>();
    for (const cand of candidates) {
      const existing = unique.get(cand.text);
      if (!existing || cand.conf > existing) {
        unique.set(cand.text, cand.conf);
      }
    }
    
    const uniqueCandidates = Array.from(unique.entries())
      .map(([text, conf]) => ({ text, conf }))
      .sort((a, b) => b.conf - a.conf);
    
    return { text: uniqueCandidates[0].text, confidence: uniqueCandidates[0].conf };
  }
  
  return { text: null, confidence: 0 };
}

/**
 * Result from a single tile OCR
 */
interface TileResult {
  text: string | null;
  confidence: number;
  strategy: string;
}

/**
 * OCR a single tile with a worker
 */
async function ocrTile(
  worker: Worker,
  processedCanvas: HTMLCanvasElement,
  strategy: OCRStrategy
): Promise<{ text: string | null; confidence: number }> {
  try {
    // Set OCR parameters (only runtime-changeable ones)
    await worker.setParameters({
      tessedit_pageseg_mode: strategy.psmMode,
      tessedit_char_whitelist: 'abcdefghijklmnopqrstuvwxyz',
    } as any);
    
    const { data } = await worker.recognize(processedCanvas);
    return parseOCRResult(data);
  } catch (error) {
    console.warn('OCR failed:', error);
    return { text: null, confidence: 0 };
  }
}

/**
 * Process a batch of tiles in parallel using the worker pool
 */
async function processTilesBatch(
  pool: WorkerPool,
  tiles: Array<{
    index: number;
    canvas: HTMLCanvasElement;
    strategy: OCRStrategy;
  }>
): Promise<Array<{ index: number; result: TileResult }>> {
  const results = await Promise.all(
    tiles.map(async (tile) => {
      const worker = await pool.acquire();
      try {
        const { text, confidence } = await ocrTile(worker, tile.canvas, tile.strategy);
        return {
          index: tile.index,
          result: { text, confidence, strategy: tile.strategy.name }
        };
      } finally {
        pool.release(worker);
      }
    })
  );
  return results;
}

/**
 * Main extraction function - optimized with worker pool and early exit
 */
export async function extractTilesFromImage(
  imageFile: File,
  psmMode: number = 6,
  expectedRows: number = 5,
  expectedCols: number = 4,
  enableDebug: boolean = false,
  preprocessingMode: PreprocessingMode = 'original',
  scalingMode: ScalingMode = 'none'
): Promise<DetectionResult> {
  const totalStartTime = performance.now();
  
  // Load the image
  const canvas = await loadImageToCanvas(imageFile);
  
  // Detect tile regions
  const regions = await detectTileRegions(imageFile, expectedRows, expectedCols);
  
  if (regions.length === 0) {
    return { tiles: [], regions: [], method: 'none' };
  }
  
  // Get strategies based on preprocessing mode
  const strategies = getStrategies(preprocessingMode);
  console.log(`Using preprocessing mode: ${preprocessingMode} (${strategies.length} strategies)`);
  
  // Initialize worker pool
  const pool = new WorkerPool();
  await pool.initialize(WORKER_POOL_SIZE);
  
  try {
    // Track best results per tile and whether tile is "done" (high confidence)
    const bestResults: (TileResult | null)[] = new Array(regions.length).fill(null);
    const tilesDone: boolean[] = new Array(regions.length).fill(false);
    const allDebugImages: DebugImage[] = [];
    
    // Process strategies in order
    for (const strategy of strategies) {
      // Find tiles that still need processing
      const tilesToProcess: number[] = [];
      for (let i = 0; i < regions.length; i++) {
        if (!tilesDone[i]) {
          tilesToProcess.push(i);
        }
      }
      
      // Skip strategy if all tiles are done
      if (tilesToProcess.length === 0) {
        console.log(`Skipping ${strategy.name} - all tiles have high confidence results`);
        break;
      }
      
      console.log(`Running ${strategy.name} on ${tilesToProcess.length} tiles...`);
      const strategyStartTime = performance.now();
      
      // Prepare all tiles for this strategy
      const preparedTiles = tilesToProcess.map(tileIndex => ({
        index: tileIndex,
        canvas: prepareTileForOCR(
          canvas,
          regions[tileIndex],
          strategy,
          tileIndex,
          scalingMode,
          enableDebug ? allDebugImages : undefined
        ),
        strategy
      }));
      
      // Process tiles in parallel using worker pool
      const strategyResults = await processTilesBatch(pool, preparedTiles);
      
      // Update best results
      for (const { index, result } of strategyResults) {
        const currentBest = bestResults[index];
        
        // Update if this result is better
        if (result.text && (!currentBest || !currentBest.text || result.confidence > currentBest.confidence)) {
          bestResults[index] = result;
          
          // Mark tile as done if high confidence
          if (result.confidence >= HIGH_CONFIDENCE_THRESHOLD) {
            tilesDone[index] = true;
          }
        }
      }
      
      console.log(`${strategy.name} completed in ${(performance.now() - strategyStartTime).toFixed(0)}ms`);
    }
    
    // Collect final results
    const finalTiles: string[] = [];
    const usedStrategies: string[] = [];
    
    for (let i = 0; i < regions.length; i++) {
      const best = bestResults[i];
      if (best?.text) {
        finalTiles.push(best.text);
        usedStrategies.push(best.strategy);
      }
    }
    
    // Log stats
    const strategyUsage = usedStrategies.reduce((acc, s) => {
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log('Strategy usage per tile:', strategyUsage);
    console.log('Detected tiles:', finalTiles);
    console.log(`Total time: ${(performance.now() - totalStartTime).toFixed(0)}ms`);
    
    return {
      tiles: finalTiles,
      regions,
      method: 'per-tile-best-optimized',
      debugImages: enableDebug ? allDebugImages : undefined
    };
  } finally {
    // Always terminate the worker pool
    await pool.terminate();
  }
}

/**
 * Extract tiles with automatic grid detection
 * Tries different grid configurations if the default doesn't work
 */
export async function extractTilesAuto(
  imageFile: File
): Promise<DetectionResult> {
  const gridConfigs = [
    { rows: 5, cols: 4 }, // Most common
    { rows: 4, cols: 5 },
    { rows: 6, cols: 4 },
    { rows: 4, cols: 6 },
  ];
  
  let bestResult: DetectionResult = { tiles: [], regions: [], method: 'none' };
  
  for (const config of gridConfigs) {
    try {
      const result = await extractTilesFromImage(
        imageFile,
        6,
        config.rows,
        config.cols
      );
      
      if (result.tiles.length > bestResult.tiles.length) {
        bestResult = result;
      }
      
      // If we got a good result (15+ tiles), use it
      if (result.tiles.length >= 15) {
        break;
      }
    } catch (error) {
      console.warn(`Grid config ${config.rows}x${config.cols} failed:`, error);
    }
  }
  
  return bestResult;
}

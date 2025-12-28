/**
 * Improved OCR system that:
 * 1. Detects individual tile regions first
 * 2. Preprocesses each region separately
 * 3. Runs OCR on each tile with optimized settings
 * 4. Tries multiple strategies and picks the best result
 * 
 * CRITICAL RULE: NO WORKAROUNDS, NO FALLBACKS, NO HARDCODED SOLUTIONS
 * - Do not add post-processing corrections for specific misreads
 * - Do not add hardcoded mappings or substitutions
 * - Do not add fallback logic that masks root causes
 * - Fix the root cause: improve preprocessing, OCR parameters, or image quality
 * - If OCR misreads, improve the actual OCR accuracy, don't patch the results
 */

import { createWorker } from 'tesseract.js';
import {
  detectTileRegions,
  preprocessImage,
  extractRegion,
  loadImageToCanvas,
  type TileRegion,
  type DetectionResult,
  type DebugImage
} from './tile-detector';

interface OCRStrategy {
  name: string;
  preprocessing: 'contrast' | 'binary' | 'adaptive' | 'original';
  psmMode: number;
  confidenceThreshold: number;
}

const STRATEGIES: OCRStrategy[] = [
  // Binary preprocessing first (pure black/white) - often best for character recognition
  { name: 'binary-psm7', preprocessing: 'binary', psmMode: 7, confidenceThreshold: 5 },
  { name: 'binary-psm8', preprocessing: 'binary', psmMode: 8, confidenceThreshold: 5 },
  // Contrast preprocessing - good for enhancing text visibility
  { name: 'contrast-psm7', preprocessing: 'contrast', psmMode: 7, confidenceThreshold: 5 },
  { name: 'contrast-psm8', preprocessing: 'contrast', psmMode: 8, confidenceThreshold: 5 },
  // Adaptive and original preprocessing variants
  { name: 'adaptive-psm7', preprocessing: 'adaptive', psmMode: 7, confidenceThreshold: 5 },
  { name: 'adaptive-psm8', preprocessing: 'adaptive', psmMode: 8, confidenceThreshold: 5 },
  { name: 'original-psm7', preprocessing: 'original', psmMode: 7, confidenceThreshold: 5 },
  { name: 'original-psm8', preprocessing: 'original', psmMode: 8, confidenceThreshold: 5 },
];


/**
 * Convert canvas to data URL for debugging
 */
function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}

/**
 * OCR a single tile region - returns text and confidence
 */
async function ocrTileRegionWithConfidence(
  worker: any,
  canvas: HTMLCanvasElement,
  region: TileRegion,
  strategy: OCRStrategy,
  tileIndex: number,
  debugImages?: DebugImage[]
): Promise<{ text: string | null; confidence: number }> {
  try {
    // Extract the region - use minimal crop to avoid reading adjacent tiles
    // Reduce crop to preserve full characters, especially for 3-4 char tiles
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
    
    // Scale to optimal size for OCR - Tesseract works best around 200-300 DPI
    // Scale up if too small, scale down if too large
    let finalCanvas = regionCanvas;
    const minSize = 150; // Minimum size for reliable OCR
    const maxSize = 300; // Maximum size - larger images can reduce OCR accuracy
    const optimalSize = 250; // Target size for best OCR accuracy
    
    const currentMin = Math.min(regionCanvas.width, regionCanvas.height);
    const currentMax = Math.max(regionCanvas.width, regionCanvas.height);
    
    if (currentMin < minSize) {
      // Scale up if too small
      const scale = Math.min(5, minSize / currentMin);
      const scaledCanvas = document.createElement('canvas');
      scaledCanvas.width = Math.round(regionCanvas.width * scale);
      scaledCanvas.height = Math.round(regionCanvas.height * scale);
      const ctx = scaledCanvas.getContext('2d');
      if (ctx) {
        // Nearest neighbor scaling - preserves letter shapes exactly
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(regionCanvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
        finalCanvas = scaledCanvas;
        // Debug: capture scaled up
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
      // Scale down if too large - use bilinear for downscaling to avoid aliasing
      const scale = optimalSize / currentMax;
      const scaledCanvas = document.createElement('canvas');
      scaledCanvas.width = Math.round(regionCanvas.width * scale);
      scaledCanvas.height = Math.round(regionCanvas.height * scale);
      const ctx = scaledCanvas.getContext('2d');
      if (ctx) {
        // Bilinear scaling for downscaling - smoother results
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(regionCanvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
        finalCanvas = scaledCanvas;
        // Debug: capture scaled down
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
      // Debug: capture if no scaling needed
      debugImages.push({
        tileIndex,
        step: 'no-scaling',
        imageData: canvasToDataUrl(finalCanvas),
        description: `No scaling needed (${finalCanvas.width}x${finalCanvas.height}px)`
      });
    }
    
    // Preprocess the region
    const processed = preprocessImage(finalCanvas, strategy.preprocessing);
    
    // Debug: capture preprocessed image
    if (debugImages) {
      debugImages.push({
        tileIndex,
        step: `preprocessed-${strategy.preprocessing}`,
        imageData: canvasToDataUrl(processed),
        description: `Preprocessed: ${strategy.preprocessing} (PSM ${strategy.psmMode})`
      });
    }
    
    // Set OCR parameters - match the working test page exactly
    await worker.setParameters({
      tessedit_pageseg_mode: strategy.psmMode,
      tessedit_char_whitelist: 'abcdefghijklmnopqrstuvwxyz',
      tessedit_ocr_engine_mode: '1',
      load_system_dawg: '0',
      load_freq_dawg: '0',
      load_unambig_dawg: '0',
      load_punc_dawg: '0',
      load_number_dawg: '0',
      load_bigram_dawg: '0',
    } as any);
    
    // Run OCR
    const { data } = await worker.recognize(processed);
    
    // Get all text - try multiple sources, be very permissive
    const fullText = (data.text || '').trim().toLowerCase();
    const words = data.words || [];
    const lines = data.lines || [];
    const symbols = data.symbols || [];
    
    // Collect all candidates - be very permissive
    const candidates: Array<{ text: string; conf: number }> = [];
    
    // From full text (most reliable)
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
    
    // From words (accept any confidence)
    for (const word of words) {
      const text = (word.text || '').trim().toLowerCase();
      if (text) {
        const cleaned = text.replace(/[^a-z]/g, '').trim();
        if (cleaned.length >= 2 && cleaned.length <= 10) {
          candidates.push({ text: cleaned, conf: word.confidence || 30 });
        }
      }
    }
    
    // From symbols (assemble characters) - CRITICAL for accurate character detection
    // This is the most reliable source for short tiles (2-3 chars)
    // Use simple processing that matches the working test page exactly
    const sortedSymbols = [...symbols]
      .filter(s => /^[a-z]$/.test((s.text || '').trim().toLowerCase()))
      .sort((a, b) => (a.bbox?.x0 || 0) - (b.bbox?.x0 || 0));
    
    // Build symbol text directly - trust OCR output without complex alternative checking
    let symbolText = '';
    let symbolConfSum = 0;
    const symbolConfs: number[] = [];
    
    for (const symbol of sortedSymbols) {
      const text = (symbol.text || '').trim().toLowerCase();
      const conf = symbol.confidence || 0;
      symbolText += text;
      symbolConfSum += conf;
      symbolConfs.push(conf);
    }
    
    if (symbolText.length >= 2 && symbolText.length <= 10) {
      const avgConf = symbolConfs.length > 0 ? symbolConfSum / symbolConfs.length : 35;
      // Calculate quality score: average confidence + bonus for consistent high confidence
      const minConf = symbolConfs.length > 0 ? Math.min(...symbolConfs) : 0;
      const qualityBonus = minConf > 40 ? 20 : minConf > 30 ? 10 : 0;
      
      // Very high boost for symbol-based results - they're most accurate for character recognition
      const boostedConf = symbolText.length <= 3 
        ? avgConf + 40 + qualityBonus  // Very high boost for 2-3 char tiles
        : avgConf + 25 + qualityBonus; // High boost for longer tiles
      
      candidates.push({ text: symbolText, conf: boostedConf });
    }
    
    // CRITICAL: If we have a symbol-based result, ALWAYS use it
    // Symbol-based results are character-level and most accurate for short tiles
    // This matches exactly what the working test page does
    if (symbolText.length >= 2) {
      const avgConf = symbolConfs.length > 0 ? symbolConfSum / symbolConfs.length : 50;
      return { text: symbolText, confidence: avgConf };
    }
    
    // Fallback: if no symbol result, use best candidate from fullText/words/lines
    if (candidates.length > 0) {
      // Remove duplicates, keeping highest confidence
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
  } catch (error) {
    console.warn(`OCR failed for region ${region.x},${region.y}:`, error);
    return { text: null, confidence: 0 };
  }
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
 * Try a single strategy on all tile regions
 * Creates a new worker for EACH tile to avoid state persistence issues
 * Returns results with confidence scores for per-tile comparison
 */
async function tryStrategy(
  canvas: HTMLCanvasElement,
  regions: TileRegion[],
  strategy: OCRStrategy,
  debugImages?: DebugImage[]
): Promise<TileResult[]> {
  const results: TileResult[] = [];
  
  // Process each tile with a fresh worker to avoid state persistence
  // This matches how the test page works and ensures consistent OCR results
  for (let i = 0; i < regions.length; i++) {
    const worker = await createWorker('eng');
    try {
      const region = regions[i];
      const { text, confidence } = await ocrTileRegionWithConfidence(worker, canvas, region, strategy, i, debugImages);
      results.push({ text, confidence, strategy: strategy.name });
    } finally {
      await worker.terminate();
    }
  }
  
  return results;
}

/**
 * Main extraction function - tries multiple strategies and picks BEST result for EACH tile
 */
export async function extractTilesFromImage(
  imageFile: File,
  psmMode: number = 6,
  expectedRows: number = 5,
  expectedCols: number = 4,
  enableDebug: boolean = false
): Promise<DetectionResult> {
  // Load the image
  const canvas = await loadImageToCanvas(imageFile);
  
  // Detect tile regions
  const regions = await detectTileRegions(imageFile, expectedRows, expectedCols);
  
  if (regions.length === 0) {
    return { tiles: [], regions: [], method: 'none' };
  }
  
  // Collect results from ALL strategies for EACH tile position
  // Structure: perTileResults[tileIndex] = array of results from different strategies
  const perTileResults: TileResult[][] = regions.map(() => []);
  const allDebugImages: DebugImage[] = [];
  
  for (const strategy of STRATEGIES) {
    try {
      const strategyDebugImages: DebugImage[] = [];
      const strategyResults = await tryStrategy(
        canvas, 
        regions, 
        strategy, 
        enableDebug ? strategyDebugImages : undefined
      );
      
      // Add each tile's result to the per-tile collection
      for (let i = 0; i < strategyResults.length; i++) {
        perTileResults[i].push(strategyResults[i]);
      }
      
      if (enableDebug) {
        allDebugImages.push(...strategyDebugImages);
      }
    } catch (error) {
      console.warn(`Strategy ${strategy.name} failed:`, error);
    }
  }
  
  // For EACH tile, pick the BEST result across all strategies
  const finalTiles: string[] = [];
  const usedStrategies: string[] = [];
  
  for (let i = 0; i < regions.length; i++) {
    const tileResults = perTileResults[i];
    
    if (tileResults.length === 0) {
      continue;
    }
    
    // Filter to results that have text
    const validResults = tileResults.filter(r => r.text !== null);
    
    if (validResults.length === 0) {
      continue;
    }
    
    // Sort by confidence (highest first)
    validResults.sort((a, b) => b.confidence - a.confidence);
    
    // Pick the best result for this tile
    const best = validResults[0];
    if (best.text) {
      finalTiles.push(best.text);
      usedStrategies.push(best.strategy);
    }
  }
  
  // Log which strategies were used
  const strategyUsage = usedStrategies.reduce((acc, s) => {
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log('Strategy usage per tile:', strategyUsage);
  console.log('Detected tiles:', finalTiles);
  
  return {
    tiles: finalTiles,
    regions,
    method: 'per-tile-best',
    debugImages: enableDebug ? allDebugImages : undefined
  };
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


'use client';

import { useState, useRef, useEffect } from 'react';
import { extractTilesFromImage, PreprocessingMode, ScalingMode } from '@/lib/ocr';
import { solveQuartiles, WordResult } from '@/lib/solver';
import { DictionaryType } from '@/lib/dictionary';
import type { DebugImage } from '@/lib/tile-detector';

// Settings interface for localStorage persistence
interface AppSettings {
  dictType: DictionaryType;
  minLength: number;
  psmMode: number;
  showDebug: boolean;
  preprocessingMode: PreprocessingMode;
  scalingMode: ScalingMode;
}

const DEFAULT_SETTINGS: AppSettings = {
  dictType: 'twl06',
  minLength: 2,
  psmMode: 6,
  showDebug: false,
  preprocessingMode: 'original',
  scalingMode: 'none',
};

const SETTINGS_KEY = 'quartiles-solver-settings';

function loadSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.warn('Failed to load settings:', e);
  }
  return DEFAULT_SETTINGS;
}

function saveSettings(settings: AppSettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('Failed to save settings:', e);
  }
}

export default function Home() {
  const [tiles, setTiles] = useState<string[]>([]);
  const [manualTiles, setManualTiles] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [solving, setSolving] = useState(false);
  const [results, setResults] = useState<Record<number, WordResult[]>>({});
  const [totalFound, setTotalFound] = useState(0);
  const [questionableCount, setQuestionableCount] = useState(0);
  const [dictionarySize, setDictionarySize] = useState(0);
  const [dictType, setDictType] = useState<DictionaryType>(DEFAULT_SETTINGS.dictType);
  const [minLength, setMinLength] = useState(DEFAULT_SETTINGS.minLength);
  const [psmMode, setPsmMode] = useState(DEFAULT_SETTINGS.psmMode);
  const [error, setError] = useState<string>('');
  const [imagePreview, setImagePreview] = useState<string>('');
  const [ocrStatus, setOcrStatus] = useState<string>('');
  const [showDebug, setShowDebug] = useState(DEFAULT_SETTINGS.showDebug);
  const [preprocessingMode, setPreprocessingMode] = useState<PreprocessingMode>(DEFAULT_SETTINGS.preprocessingMode);
  const [scalingMode, setScalingMode] = useState<ScalingMode>(DEFAULT_SETTINGS.scalingMode);
  const [debugImages, setDebugImages] = useState<DebugImage[]>([]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load settings from localStorage on mount
  useEffect(() => {
    const settings = loadSettings();
    setDictType(settings.dictType);
    setMinLength(settings.minLength);
    setPsmMode(settings.psmMode);
    setShowDebug(settings.showDebug);
    setPreprocessingMode(settings.preprocessingMode);
    setScalingMode(settings.scalingMode);
    setSettingsLoaded(true);
  }, []);

  // Save settings to localStorage when they change
  useEffect(() => {
    if (!settingsLoaded) return; // Don't save during initial load
    saveSettings({ dictType, minLength, psmMode, showDebug, preprocessingMode, scalingMode });
  }, [dictType, minLength, psmMode, showDebug, preprocessingMode, scalingMode, settingsLoaded]);

  // Process a file with OCR
  const processFile = async (file: File, preprocessing: PreprocessingMode, scaling: ScalingMode) => {
    setLoading(true);
    setError('');
    setOcrStatus('Starting OCR...');
    setDebugImages([]);
    
    try {
      setOcrStatus('Detecting tile regions...');
      const result = await extractTilesFromImage(
        file, 
        psmMode,
        5, // expectedRows
        4, // expectedCols
        showDebug, // enableDebug
        preprocessing,
        scaling
      );
      if (result.tiles.length === 0) {
        setError('No tiles found in the image. Try a different preprocessing mode or use manual entry.');
        setOcrStatus('');
      } else {
        setTiles(result.tiles);
        // Prefill manual entry box with detected tiles for easy editing
        setManualTiles(result.tiles.join(' '));
        setOcrStatus(`✓ Extracted ${result.tiles.length} tiles (${preprocessing}${scaling === 'auto' ? ', auto-scaled' : ''})`);
        // Set debug images if available
        if (result.debugImages) {
          setDebugImages(result.debugImages);
        }
      }
    } catch (err) {
      setError(`OCR failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setOcrStatus('');
    } finally {
      setLoading(false);
    }
  };

  // Re-process when preprocessing or scaling mode changes and we have a file
  useEffect(() => {
    if (!settingsLoaded || !currentFile || loading) return;
    processFile(currentFile, preprocessingMode, scalingMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preprocessingMode, scalingMode]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset the file input so the same file can be re-uploaded
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    // Clean up previous preview URL
    if (imagePreview) {
      URL.revokeObjectURL(imagePreview);
    }

    // Create preview URL and store the file
    const previewUrl = URL.createObjectURL(file);
    setImagePreview(previewUrl);
    setCurrentFile(file);

    // Process the file
    await processFile(file, preprocessingMode, scalingMode);
  };

  const handleManualTiles = () => {
    const tileList = manualTiles
      .split(/\s+/)
      .map(t => t.trim().toLowerCase())
      .filter(t => t.length >= 2);
    
    if (tileList.length === 0) {
      setError('Please enter at least one tile (2+ characters each)');
      return;
    }
    
    setTiles(tileList);
    setError('');
  };

  const handleSolve = async () => {
    if (tiles.length === 0) {
      setError('Please provide tiles first (upload image or enter manually)');
      return;
    }

    setSolving(true);
    setError('');
    
    try {
      const solveResult = await solveQuartiles(tiles, dictType, minLength);
      setResults(solveResult.results);
      setTotalFound(solveResult.totalFound);
      setQuestionableCount(solveResult.questionableCount);
      setDictionarySize(solveResult.dictionarySize);
    } catch (err) {
      setError(`Solving failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSolving(false);
    }
  };

  // Cleanup image preview URL on unmount
  useEffect(() => {
    return () => {
      if (imagePreview) {
        URL.revokeObjectURL(imagePreview);
      }
    };
  }, [imagePreview]);

  const formatTilesGrid = (tiles: string[]) => {
    const cols = 4;
    const rows: string[][] = [];
    for (let i = 0; i < tiles.length; i += cols) {
      rows.push(tiles.slice(i, i + cols));
    }
    return rows;
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold text-gray-900 dark:text-white mb-2">
            🧩 Quartiles Solver
          </h1>
          <p className="text-gray-600 dark:text-gray-300 text-lg">
            Find all valid word combinations from puzzle tiles
          </p>
        </div>

        {/* Main Content */}
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          {/* Input Section */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
            <h2 className="text-2xl font-semibold mb-4 text-gray-800 dark:text-white">Input Tiles</h2>
            
            {/* Image Upload */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Upload Puzzle Image
              </label>
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? 'Processing...' : 'Choose Image'}
                </button>
                <select
                  value={preprocessingMode}
                  onChange={(e) => setPreprocessingMode(e.target.value as PreprocessingMode)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  title="Image preprocessing for OCR"
                >
                  <option value="original">No Processing</option>
                  <option value="binary">Binary (B&W)</option>
                  <option value="contrast">Contrast</option>
                  <option value="adaptive">Adaptive</option>
                  <option value="auto">Auto (Try All)</option>
                </select>
                <select
                  value={scalingMode}
                  onChange={(e) => setScalingMode(e.target.value as ScalingMode)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  title="Tile scaling for OCR"
                >
                  <option value="none">No Scaling</option>
                  <option value="auto">Auto Scale</option>
                </select>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={showDebug}
                    onChange={(e) => setShowDebug(e.target.checked)}
                    className="rounded"
                  />
                  <span>Debug</span>
                </label>
              </div>
              {imagePreview && (
                <div className="mt-4 border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden bg-gray-50 dark:bg-gray-700">
                  <img
                    src={imagePreview}
                    alt="Uploaded puzzle"
                    className="w-full h-auto max-h-64 object-contain"
                    style={{ imageRendering: 'crisp-edges' }}
                  />
                </div>
              )}
              {ocrStatus && (
                <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <div className="flex items-center gap-2">
                    {loading && (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                    )}
                    <span className="text-sm text-blue-700 dark:text-blue-300 font-medium">{ocrStatus}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Manual Entry */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Or Enter Tiles Manually
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualTiles}
                  onChange={(e) => setManualTiles(e.target.value)}
                  placeholder="cli ta ous ci sul ni con da..."
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleManualTiles();
                    }
                  }}
                />
                <button
                  onClick={handleManualTiles}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                >
                  Set
                </button>
              </div>
            </div>

            {/* Settings */}
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Dictionary
                </label>
                <select
                  value={dictType}
                  onChange={(e) => setDictType(e.target.value as DictionaryType)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="twl06">TWL06 (Tournament Word List)</option>
                  <option value="enable">ENABLE</option>
                  <option value="both">Both (Maximum Coverage)</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Minimum Word Length: {minLength}
                </label>
                <input
                  type="range"
                  min="2"
                  max="10"
                  value={minLength}
                  onChange={(e) => setMinLength(Number(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>

            {/* Solve Button */}
            <button
              onClick={handleSolve}
              disabled={tiles.length === 0 || solving}
              className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-semibold hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg"
            >
              {solving ? 'Solving...' : 'Solve Puzzle'}
            </button>

            {/* Error Display */}
            {error && (
              <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
                {error}
              </div>
            )}
          </div>

          {/* Tiles Display */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
            <h2 className="text-2xl font-semibold mb-4 text-gray-800 dark:text-white">
              Extracted Tiles ({tiles.length})
            </h2>
            {tiles.length > 0 ? (
              <div className="space-y-2">
                {formatTilesGrid(tiles).map((row, i) => (
                  <div key={i} className="flex gap-2 flex-wrap">
                    {row.map((tile, j) => (
                      <span
                        key={j}
                        className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-lg font-mono text-sm font-semibold"
                      >
                        {tile}
                      </span>
                    ))}
                  </div>
                ))}
                <div className="mt-4 text-sm text-gray-600 dark:text-gray-400">
                  <p>Tiles: {tiles.join(', ')}</p>
                </div>
              </div>
            ) : (
              <p className="text-gray-400 dark:text-gray-500 italic">No tiles loaded yet</p>
            )}
          </div>
        </div>

        {/* Debug Images Section */}
        {showDebug && debugImages.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 mb-6">
            <h2 className="text-2xl font-semibold mb-4 text-gray-800 dark:text-white">Debug: Image Processing Steps</h2>
            <div className="space-y-6">
              {Array.from({ length: 20 }, (_, tileIdx) => {
                const tileDebugImages = debugImages.filter(img => img.tileIndex === tileIdx);
                if (tileDebugImages.length === 0) return null;
                
                return (
                  <div key={tileIdx} className="border border-gray-200 dark:border-gray-600 rounded-lg p-4">
                    <h3 className="text-lg font-semibold mb-3 text-gray-700 dark:text-gray-200">
                      Tile {tileIdx + 1} {tiles[tileIdx] && `(detected: "${tiles[tileIdx]}")`}
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {tileDebugImages.map((img, idx) => (
                        <div key={idx} className="space-y-2">
                          <div className="border border-gray-300 dark:border-gray-600 rounded overflow-hidden bg-gray-50 dark:bg-gray-700">
                            <img
                              src={img.imageData}
                              alt={img.description}
                              className="w-full h-auto"
                              style={{ imageRendering: 'pixelated' }}
                            />
                          </div>
                          <p className="text-xs text-gray-600 dark:text-gray-400 font-mono">{img.step}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-500">{img.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Results Section */}
        {totalFound > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
            <div className="mb-6">
              <h2 className="text-2xl font-semibold mb-2 text-gray-800 dark:text-white">Results</h2>
              <div className="flex gap-4 text-sm text-gray-600 dark:text-gray-400">
                <span>Total words: <strong className="text-gray-900 dark:text-white">{totalFound}</strong></span>
                <span>Dictionary: <strong className="text-gray-900 dark:text-white">{dictionarySize.toLocaleString()}</strong> words</span>
                {questionableCount > 0 && (
                  <span className="text-amber-600 dark:text-amber-400">
                    Review needed: <strong>{questionableCount}</strong>
                  </span>
                )}
              </div>
            </div>

            {[1, 2, 3, 4].map((numTiles) => {
              const tileResults = results[numTiles] || [];
              if (tileResults.length === 0) return null;

              return (
                <div key={numTiles} className="mb-8">
                  <h3 className="text-xl font-semibold mb-3 text-gray-700 dark:text-gray-200">
                    {numTiles} Tile Combination{numTiles > 1 ? 's' : ''} ({tileResults.length})
                  </h3>
                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                    <div 
                      className={`font-mono text-sm gap-6 ${
                        numTiles === 4 
                          ? 'columns-1' 
                          : 'columns-1 sm:columns-2 md:columns-3 lg:columns-4'
                      }`}
                      style={{ columnFill: 'balance' }}
                    >
                      {tileResults.map((result, idx) => {
                        const leftSide = result.tiles.join(' + ');
                        const hasTags = result.tags.length > 0;
                        return (
                          <div
                            key={idx}
                            className={`py-0.5 break-inside-avoid whitespace-nowrap flex ${
                              hasTags ? 'text-amber-700 dark:text-amber-400' : 'text-gray-800 dark:text-gray-200'
                            }`}
                          >
                            <span 
                              className="text-gray-500 dark:text-gray-400 text-right"
                              style={{ 
                                minWidth: numTiles === 1 ? '2.5rem' : numTiles === 2 ? '5.5rem' : numTiles === 3 ? '9rem' : '12.5rem'
                              }}
                            >
                              {leftSide}
                            </span>
                            <span className="text-gray-400 dark:text-gray-500 mx-1">=</span>
                            <span className="font-semibold">{result.word}</span>
                            {hasTags && (
                              <span className="text-xs text-amber-600 dark:text-amber-400 ml-1">
                                [{result.tags.join(', ')}]
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}


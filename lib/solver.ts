import { filterWords, classifyWord, loadDictionary, DictionaryType } from './dictionary';

export interface WordResult {
  tiles: string[];
  word: string;
  tags: string[];
}

export interface SolveResult {
  results: Record<number, WordResult[]>;
  totalFound: number;
  questionableCount: number;
  dictionarySize: number;
}

// Yield to main thread every N iterations to prevent UI freeze
const YIELD_INTERVAL = 1000;

/**
 * Detect if running on a mobile device
 */
function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 0 && /MacIntel/.test(navigator.platform));
}

/**
 * Yield to the main thread to prevent UI freeze
 */
function yieldToMain(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function* generateCombinations(tiles: string[], maxLength: number = 4): Generator<[string[], string]> {
  function* permute(arr: string[], length: number, current: string[] = []): Generator<[string[], string]> {
    if (current.length === length) {
      yield [[...current], current.join('')];
      return;
    }
    
    for (let i = 0; i < arr.length; i++) {
      const remaining = [...arr.slice(0, i), ...arr.slice(i + 1)];
      current.push(arr[i]);
      yield* permute(remaining, length, current);
      current.pop();
    }
  }
  
  for (let r = 1; r <= maxLength; r++) {
    yield* permute(tiles, r);
  }
}

export async function solveQuartiles(
  tiles: string[],
  dictType: DictionaryType = 'twl06',
  minLength: number = 2
): Promise<SolveResult> {
  // Load dictionary
  const allWords = await loadDictionary(dictType);
  const validWords = filterWords(allWords);
  
  // Find all combinations
  const organized: Record<number, WordResult[]> = {
    1: [],
    2: [],
    3: [],
    4: []
  };
  
  const seenWords = new Set<string>();
  const isMobile = isMobileDevice();
  
  // Use smaller yield interval on mobile for smoother UI
  const yieldInterval = isMobile ? YIELD_INTERVAL / 2 : YIELD_INTERVAL;
  let iterationCount = 0;
  
  for (const [tilesCombo, word] of generateCombinations(tiles, 4)) {
    // Periodically yield to main thread to prevent UI freeze
    iterationCount++;
    if (iterationCount % yieldInterval === 0) {
      await yieldToMain();
    }
    
    if (word.length < minLength) continue;
    if (!validWords.has(word)) continue;
    if (seenWords.has(word)) continue;
    
    seenWords.add(word);
    const tags = classifyWord(word);
    organized[tilesCombo.length].push({
      tiles: tilesCombo,
      word,
      tags
    });
  }
  
  // Sort results
  for (const numTiles of [1, 2, 3, 4] as const) {
    organized[numTiles].sort((a, b) => {
      const aHasTags = a.tags.length > 0;
      const bHasTags = b.tags.length > 0;
      if (aHasTags !== bHasTags) {
        return aHasTags ? 1 : -1;
      }
      return a.word.localeCompare(b.word);
    });
  }
  
  const totalFound = Object.values(organized).reduce((sum, arr) => sum + arr.length, 0);
  const questionableCount = Object.values(organized).reduce(
    (sum, arr) => sum + arr.filter(r => r.tags.length > 0).length,
    0
  );
  
  return {
    results: organized,
    totalFound,
    questionableCount,
    dictionarySize: validWords.size
  };
}


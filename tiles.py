"""
Quartiles Solver

Solves Quartiles word puzzles by finding valid word combinations from tiles.
Uses TWL06 dictionary with minimal filtering to avoid false negatives.
"""

import argparse
import itertools
import os
import subprocess
import sys
import urllib.request
from typing import List, Set, Tuple, Dict

DEFAULT_TILES = [
    "far", "ci", "ca", "lly", "rec", "ep", "tac", "les", "cap", "itu",
    "la", "te", "jou", "rn", "al", "ing", "aft", "er", "tho", "ught"
]

DICTIONARY_URL = 'https://raw.githubusercontent.com/jessicatysu/scrabble/master/TWL06.txt'
DICTIONARY_FILENAME = 'twl06.txt'


def load_dictionary() -> Set[str]:
    if not os.path.exists(DICTIONARY_FILENAME):
        print(f"Downloading dictionary from {DICTIONARY_URL}...")
        try:
            urllib.request.urlretrieve(DICTIONARY_URL, DICTIONARY_FILENAME)
        except Exception as e:
            print(f"Error: Failed to download dictionary: {e}")
            return set()

    try:
        with open(DICTIONARY_FILENAME, 'r') as f:
            return set(word.strip().lower() for word in f if len(word.strip()) >= 2)
    except FileNotFoundError:
        print(f"Error: Dictionary file '{DICTIONARY_FILENAME}' not found.")
        return set()


def classify_word(word: str) -> List[str]:
    tags = []
    if len(word) <= 3 and all(c in 'bcdfghjklmnpqrstvwxyz' for c in word):
        tags.append('abbreviation')
    return tags


def filter_words(words: Set[str]) -> Set[str]:
    filtered = set()
    profanity = {'fuck', 'shit', 'bitch', 'dick', 'piss', 'cock', 'cunt', 'twat', 'ass', 'damn', 'hell'}
    for word in words:
        if word.isalpha() and word not in profanity:
            filtered.add(word)
    return filtered


def extract_tiles_from_image(image_path: str, psm_mode: int = 6) -> List[str]:
    print(f"Extracting tiles from '{image_path}' using Tesseract (PSM {psm_mode})...")
    try:
        result = subprocess.run(
            ['tesseract', image_path, 'stdout', '--psm', str(psm_mode), 'tsv'],
            capture_output=True,
            text=True,
            check=True
        )

        tiles = []
        lines = result.stdout.strip().split('\n')
        
        if len(lines) > 0:
            header = lines[0].split('\t')
            try:
                conf_idx = header.index('conf')
                text_idx = header.index('text')
            except ValueError:
                print("Error: Unexpected TSV format from Tesseract.")
                return []

            for line in lines[1:]:
                parts = line.split('\t')
                if len(parts) <= max(conf_idx, text_idx):
                    continue
                
                conf_str = parts[conf_idx]
                text = parts[text_idx]
                
                if not text.strip() or conf_str == '-1':
                    continue
                    
                try:
                    conf = float(conf_str)
                except ValueError:
                    continue

                if conf < 70:
                    continue

                if any(c.isupper() for c in text):
                    continue
                    
                cleaned = ''.join(filter(str.isalpha, text)).lower()
                
                if len(cleaned) >= 2:
                    tiles.append(cleaned)
        
        return tiles

    except subprocess.CalledProcessError as e:
        print(f"Error: Tesseract command failed: {e}")
        return []
    except FileNotFoundError:
        print("Error: 'tesseract' command not found. Please install tesseract-ocr.")
        print("       macOS: brew install tesseract")
        return []


def find_combinations(tiles: List[str], max_length: int = 4) -> List[Tuple[Tuple[str, ...], str]]:
    results = []
    for r in range(1, max_length + 1):
        for combo in itertools.permutations(tiles, r):
            results.append((combo, ''.join(combo)))
    return results


def print_tiles_grid(tiles: List[str]):
    cols = 4
    for i in range(0, len(tiles), cols):
        row = tiles[i:i+cols]
        formatted_row = '  '.join(f'{t:8}' for t in row)
        print(f"  {formatted_row}")


def main():
    parser = argparse.ArgumentParser(description='Solve Quartiles puzzle.')
    parser.add_argument('image_path', nargs='?', help='Path to the puzzle image (optional)')
    parser.add_argument('--min-length', type=int, default=2,
                       help='Minimum word length to include (default: 2)')
    parser.add_argument('--tiles', type=str, nargs='+',
                       help='Manually specify tiles (space-separated). Overrides image extraction.')
    parser.add_argument('--ocr-psm', type=int, default=6, choices=[4, 6, 11],
                       help='Tesseract PSM mode: 6=uniform block (default), 4=single column, 11=sparse text')
    args = parser.parse_args()

    if args.tiles:
        tiles = [t.lower().strip() for t in args.tiles]
        print(f"Using manually specified tiles ({len(tiles)} total):")
        print()
        print_tiles_grid(tiles)
        print()
        print(f"Tiles list: {tiles}")
    elif args.image_path:
        if not os.path.exists(args.image_path):
            print(f"Error: File '{args.image_path}' not found.")
            sys.exit(1)
        tiles = extract_tiles_from_image(args.image_path, args.ocr_psm)
        if not tiles:
            print("Error: No tiles found in the image or OCR failed.")
            print("Tip: Try --ocr-psm 6 or --ocr-psm 11, or use --tiles to specify manually")
            sys.exit(1)
        print(f"Found {len(tiles)} tiles:")
        print()
        print_tiles_grid(tiles)
        print()
        print(f"Tiles list: {tiles}")
        print("Tip: If tiles look incorrect, try --ocr-psm 6 or --ocr-psm 11, or use --tiles to override")
    else:
        print("No image provided. Using default demo tiles.")
        tiles = DEFAULT_TILES

    print("Loading dictionary...")
    all_words = load_dictionary()
    if not all_words:
        print("Error: Could not load TWL06 dictionary. Exiting.")
        sys.exit(1)
    
    print(f"Loaded {len(all_words)} words from TWL06.")
    print("Applying minimal filter (only profanity excluded)...")
    valid_words = filter_words(all_words)
    print(f"Using {len(valid_words)} words.")

    print("Finding combinations...")
    all_combinations = find_combinations(tiles)

    organized: Dict[int, List[Tuple[Tuple[str, ...], str, List[str]]]] = {1: [], 2: [], 3: [], 4: []}
    
    for tiles_combo, word in all_combinations:
        if len(word) < args.min_length:
            continue
        if word in valid_words:
            tags = classify_word(word)
            organized[len(tiles_combo)].append((tiles_combo, word, tags))

    total_found = 0
    questionable_count = 0
    
    for num_tiles in range(1, 5):
        if organized[num_tiles]:
            print(f"\n--- {num_tiles} Tile Combinations ---")
            
            unique_entries = {}
            for tiles_combo, word, tags in organized[num_tiles]:
                if word not in unique_entries:
                    unique_entries[word] = (tiles_combo, tags)
            
            sorted_words = sorted(unique_entries.keys(), 
                                key=lambda w: (len(unique_entries[w][1]) > 0, w))
            
            # Calculate max width for alignment
            max_width = max(len(' + '.join(unique_entries[w][0])) for w in sorted_words)
            
            for word in sorted_words:
                tiles_combo, tags = unique_entries[word]
                left_side = ' + '.join(tiles_combo)
                if tags:
                    tag_str = ' [' + ', '.join(tags) + ']'
                    print(f"{left_side:<{max_width}} = {word}{tag_str}")
                    questionable_count += 1
                else:
                    print(f"{left_side:<{max_width}} = {word}")
                
            total_found += len(unique_entries)
            questionable = sum(1 for w in unique_entries if len(unique_entries[w][1]) > 0)
            print(f"Count: {len(unique_entries)} ({questionable} may need review)")

    print("\n" + "="*30)
    print(f"SUMMARY")
    print("="*30)
    print(f"Total words found: {total_found}")
    if questionable_count > 0:
        print(f"Words needing review: {questionable_count} (marked with [abbreviation])")
    if args.min_length > 2:
        print(f"Minimum length: {args.min_length}")
    print("="*30)


if __name__ == "__main__":
    main()

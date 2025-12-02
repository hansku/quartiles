"""
Quartiles Solver
================

A robust solver for the "Quartiles" word puzzle game.

This script identifies valid English words formed by combining a set of "tiles" (syllables/word parts).
It supports:
1.  **Image Input**: Automatically extracts tiles from a screenshot using OCR (Tesseract).
2.  **Dictionary Validation**: Uses the TWL06 (Tournament Word List) dictionary for high accuracy.
3.  **Permutation Logic**: Efficiently generates and checks all possible tile combinations.

Usage:
    python3 tiles.py [image_path]

    Example:
        python3 tiles.py tiles.png
        python3 tiles.py  # Uses default fallback tiles if no image provided

Dependencies:
    - python3
    - tesseract (for OCR)
"""

import argparse
import itertools
import os
import subprocess
import sys
import urllib.request
from typing import List, Set, Tuple, Dict

# Default tiles to use if no image is provided (Fallback/Demo mode)
DEFAULT_TILES = [
    "far", "ci", "ca", "lly", "rec", "ep", "tac", "les", "cap", "itu",
    "la", "te", "jou", "rn", "al", "ing", "aft", "er", "tho", "ught"
]

# Configuration
DICTIONARY_URL = 'https://raw.githubusercontent.com/jessicatysu/scrabble/master/TWL06.txt'
DICTIONARY_FILENAME = 'twl06.txt'


def load_dictionary() -> Set[str]:
    """
    Loads the TWL06 dictionary from a local file, downloading it if necessary.

    Returns:
        Set[str]: A set of valid English words (lowercase).
    """
    if not os.path.exists(DICTIONARY_FILENAME):
        print(f"Downloading dictionary from {DICTIONARY_URL}...")
        try:
            urllib.request.urlretrieve(DICTIONARY_URL, DICTIONARY_FILENAME)
        except Exception as e:
            print(f"Error: Failed to download dictionary: {e}")
            return set()

    try:
        with open(DICTIONARY_FILENAME, 'r') as f:
            # Filter for words with at least 2 letters to avoid noise
            return set(word.strip().lower() for word in f if len(word.strip()) >= 2)
    except FileNotFoundError:
        print(f"Error: Dictionary file '{DICTIONARY_FILENAME}' not found.")
        return set()


def extract_tiles_from_image(image_path: str) -> List[str]:
    """
    Extracts text tiles from a given image using Tesseract OCR.

    Args:
        image_path (str): Path to the input image file.

    Returns:
        List[str]: A list of extracted tiles (strings).
    """
    print(f"Extracting tiles from '{image_path}' using Tesseract...")
    try:
        # Run tesseract to extract text to TSV format (includes confidence scores)
        # Use --psm 4 (Single column of text of variable sizes)
        result = subprocess.run(
            ['tesseract', image_path, 'stdout', '--psm', '4', 'tsv'],
            capture_output=True,
            text=True,
            check=True
        )

        # Process TSV output
        # TSV header: level page_num block_num par_num line_num word_num left top width height conf text
        tiles = []
        raw_lines = result.stdout.strip().split('\n')
        
        # Skip header row
        if len(raw_lines) > 0:
            # Find the index of 'conf' and 'text' columns
            header = raw_lines[0].split('\t')
            try:
                conf_idx = header.index('conf')
                text_idx = header.index('text')
            except ValueError:
                print("Error: Unexpected TSV format from Tesseract.")
                return []

            for line in raw_lines[1:]:
                parts = line.split('\t')
                # Ensure line has enough columns
                if len(parts) <= max(conf_idx, text_idx):
                    continue
                
                conf_str = parts[conf_idx]
                text = parts[text_idx]
                
                # Skip empty text or invalid confidence
                if not text.strip() or conf_str == '-1':
                    continue
                    
                try:
                    conf = float(conf_str)
                except ValueError:
                    continue

                # Filter by confidence (threshold 60%)
                if conf < 60:
                    continue

                # Clean and filter text
                # Check for uppercase BEFORE cleaning (noise often has mixed case)
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
    """
    Generates all possible permutations of tiles up to a maximum length.

    Args:
        tiles (List[str]): The list of available tiles.
        max_length (int): The maximum number of tiles to combine (default: 4).

    Returns:
        List[Tuple[Tuple[str, ...], str]]: A list of tuples, where each tuple contains:
            - The tuple of tiles used (e.g., ('jou', 'rn', 'al'))
            - The combined word string (e.g., 'journal')
    """
    results = []
    # Generate permutations of length 1 to max_length
    for r in range(1, max_length + 1):
        for combo in itertools.permutations(tiles, r):
            word = ''.join(combo)
            results.append((combo, word))
    return results


def main():
    """
    Main execution function.
    """
    parser = argparse.ArgumentParser(description='Solve Quartiles puzzle.')
    parser.add_argument('image_path', nargs='?', help='Path to the puzzle image (optional)')
    args = parser.parse_args()

    # 1. Determine Tiles Source
    if args.image_path:
        if not os.path.exists(args.image_path):
            print(f"Error: File '{args.image_path}' not found.")
            sys.exit(1)
        tiles = extract_tiles_from_image(args.image_path)
        if not tiles:
            print("Error: No tiles found in the image or OCR failed.")
            sys.exit(1)
        print(f"Found {len(tiles)} tiles: {tiles}")
    else:
        print("No image provided. Using default demo tiles.")
        tiles = DEFAULT_TILES

    # 2. Load Dictionary
    valid_words = load_dictionary()
    if not valid_words:
        print("Error: Could not load dictionary. Exiting.")
        sys.exit(1)

    # 3. Find Combinations
    print("Finding combinations...")
    all_combinations = find_combinations(tiles)

    # 4. Filter and Organize Results
    # Structure: { num_tiles: [(tile_combo, word), ...] }
    organized: Dict[int, List[Tuple[Tuple[str, ...], str]]] = {1: [], 2: [], 3: [], 4: []}
    
    for tiles_combo, word in all_combinations:
        if word in valid_words:
            organized[len(tiles_combo)].append((tiles_combo, word))

    # 5. Print Results
    total_found = 0
    for num_tiles in range(1, 5):
        if organized[num_tiles]:
            print(f"\n--- {num_tiles} Tile Combinations ---")
            
            # Deduplicate by word to avoid printing same word multiple times if tiles repeat
            unique_entries = {}
            for tiles_combo, word in organized[num_tiles]:
                if word not in unique_entries:
                    unique_entries[word] = tiles_combo
            
            # Sort alphabetically
            sorted_words = sorted(unique_entries.keys())
            
            for word in sorted_words:
                tiles_combo = unique_entries[word]
                print(f"{' + '.join(tiles_combo)} = {word}")
                
            total_found += len(unique_entries)
            print(f"Count: {len(unique_entries)}")

    # 6. Summary
    print("\n" + "="*30)
    print(f"SUMMARY")
    print("="*30)
    print(f"Total real words found: {total_found}")
    print("="*30)


if __name__ == "__main__":
    main()

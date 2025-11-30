from itertools import permutations
import urllib.request
import os
import argparse
import subprocess
import sys

def load_dictionary():
    dictionary_path = 'twl06.txt'
    url = 'https://raw.githubusercontent.com/jessicatysu/scrabble/master/TWL06.txt'
    
    if not os.path.exists(dictionary_path):
        print("Downloading TWL06 dictionary...")
        try:
            urllib.request.urlretrieve(url, dictionary_path)
        except Exception as e:
            print(f"Failed to download dictionary: {e}")
            return set()

    try:
        with open(dictionary_path, 'r') as f:
            # Filter for words with at least 2 letters
            return set(word.strip().lower() for word in f if len(word.strip()) >= 2)
    except FileNotFoundError:
        return set()

def extract_tiles_from_image(image_path):
    print(f"Extracting tiles from {image_path}...")
    try:
        # Run tesseract to extract text
        result = subprocess.run(
            ['tesseract', image_path, 'stdout'],
            capture_output=True,
            text=True,
            check=True
        )
        
        # Process output: split by lines, strip whitespace, remove empty lines
        raw_text = result.stdout
        tiles = [line.strip().lower() for line in raw_text.split('\n') if line.strip()]
        
        # Filter out any non-alphabetic characters if necessary, or just trust tesseract
        # For now, let's keep it simple and just take the lines as tiles
        return tiles
        
    except subprocess.CalledProcessError as e:
        print(f"Error running tesseract: {e}")
        return []
    except FileNotFoundError:
        print("Error: tesseract not found. Please install tesseract-ocr.")
        return []

def find_combinations(tiles, max_length=4):
    results = []
    for r in range(1, max_length + 1):
        for combo in permutations(tiles, r):
            word = ''.join(combo)
            results.append((combo, word))
    return results

def main():
    parser = argparse.ArgumentParser(description='Solve Quartiles puzzle.')
    parser.add_argument('image_path', nargs='?', help='Path to the puzzle image (optional)')
    args = parser.parse_args()

    if args.image_path:
        if not os.path.exists(args.image_path):
            print(f"Error: File '{args.image_path}' not found.")
            sys.exit(1)
        tiles = extract_tiles_from_image(args.image_path)
        if not tiles:
            print("No tiles found in the image.")
            sys.exit(1)
        print(f"Found tiles: {tiles}")
    else:
        # Default tiles (fallback)
        print("No image provided. Using default tiles.")
        tiles = ["far", "ci", "ca", "lly", "rec", "ep", "tac", "les", "cap", "itu", "la", "te", "jou", "rn", "al", "ing", "aft", "er", "tho", "ught"]

    valid_words = load_dictionary()
    if not valid_words:
        print("Could not load dictionary.")
        sys.exit(1)

    # Find and organize all combinations
    all_combinations = find_combinations(tiles)

    # Filter for real words and group by number of tiles used
    organized = {1: [], 2: [], 3: [], 4: []}
    for tiles_combo, word in all_combinations:
        if word in valid_words:
            organized[len(tiles_combo)].append((tiles_combo, word))

    # Print the results
    for num_tiles in range(1, 5):
        if organized[num_tiles]:
            print(f"\n--- {num_tiles} Tile Combinations ---")
            
            # Deduplicate and sort
            unique_entries = {}
            for tiles_combo, word in organized[num_tiles]:
                if word not in unique_entries:
                    unique_entries[word] = tiles_combo
            
            # Sort by word
            sorted_words = sorted(unique_entries.keys())
            
            for word in sorted_words:
                tiles_combo = unique_entries[word]
                print(f"{' + '.join(tiles_combo)} = {word}")

    # Print summary
    print("\nSummary:")
    total = 0
    for num_tiles in range(1, 5):
        # Count unique words for the summary
        unique_words = set(word for _, word in organized[num_tiles])
        count = len(unique_words)
        total += count
        print(f"Number of {num_tiles}-tile combinations: {count}")
    print(f"Total real words found: {total}")

if __name__ == "__main__":
    main()

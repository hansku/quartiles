# Quartiles Solver 🧩

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.8%2B-blue)

**Quartiles Solver** is a powerful, automated tool designed to crack the "Quartiles" word puzzle game. Whether you're stuck on a tricky day or just want to see the magic of combinatorics in action, this solver has you covered.

## ✨ Features

- **📸 Image Recognition**: Simply feed it a screenshot of the puzzle, and it uses Tesseract OCR to read the tiles automatically.
- **🧹 Smart Noise Filtering**: Uses confidence scores to automatically filter out UI elements and visual artifacts (like 'ey').
- **📚 Tournament-Grade Dictionary**: Powered by the **TWL06** (Tournament Word List) dictionary to ensure every found word is legitimate.
- **⚡️ Blazing Fast**: efficiently generates and checks thousands of permutations in milliseconds.
- **🔍 Side-by-Side Comparison**: (Optional) Can be configured to check against multiple dictionaries to find even the most obscure words.

## 🚀 Installation

### Prerequisites

1.  **Python 3.8+**: Make sure you have Python installed.
2.  **Tesseract OCR (v4.0+)**: Required for image recognition and TSV output.
    -   **macOS**: `brew install tesseract`
    -   **Ubuntu**: `sudo apt-get install tesseract-ocr`
    -   **Windows**: [Download Installer](https://github.com/UB-Mannheim/tesseract/wiki)

### Setup

1.  Clone the repository:
    ```bash
    git clone https://github.com/hansku/quartiles-solver.git
    cd quartiles-solver
    ```

2.  (Optional) Create a virtual environment:
    ```bash
    python3 -m venv venv
    source venv/bin/activate
    ```

## 🎮 How to Use

### 1. The Easy Way (Image Input)

Take a screenshot of your Quartiles puzzle (crop it to just the tiles if possible for best results) and save it as `tiles.png`.

Run the solver:

```bash
python3 tiles.py tiles.png
```

The script will:
1.  Read the tiles from the image.
2.  Download the dictionary (first run only).
3.  Print all valid 1, 2, 3, and 4-tile combinations!

### 2. The Manual Way (Demo Mode)

If you don't provide an image, the script runs in demo mode with a default set of tiles:

```bash
python3 tiles.py
```

## 🤝 Contributing

Got a better dictionary? Found a bug in the OCR? Pull requests are welcome!

1.  Fork the repo.
2.  Create a new branch (`git checkout -b feature/amazing-feature`).
3.  Commit your changes.
4.  Push to the branch.
5.  Open a Pull Request.

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

*Happy Solving!* 🕵️‍♂️

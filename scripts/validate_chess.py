#!/usr/bin/env python3
"""Check every workbook page: mate in one, or a line that wins a piece."""

import json
import sys
from pathlib import Path

import chess
import chess.engine

ROOT = Path(__file__).resolve().parents[1]
CHESS = ROOT / "chess"
ENGINE = "/usr/games/stockfish"
VALUES = {
    chess.PAWN: 1,
    chess.KNIGHT: 3,
    chess.BISHOP: 3,
    chess.ROOK: 5,
    chess.QUEEN: 9,
}


def material(board):
    total = 0
    for piece in board.piece_map().values():
        value = VALUES.get(piece.piece_type, 0)
        total += value if piece.color == chess.WHITE else -value
    return total


def mates(board):
    found = []
    for move in list(board.legal_moves):
        board.push(move)
        if board.is_checkmate():
            found.append(move)
        board.pop()
    return found


def main():
    catalog = json.loads((CHESS / "catalog.json").read_text())
    engine = chess.engine.SimpleEngine.popen_uci(ENGINE)
    failed = False
    try:
        for entry in catalog:
            data = json.loads((CHESS / entry["file"]).read_text())
            print(f"\nPage {data['page']} {data['title']} ({data['goal']})")
            if len(data["puzzles"]) != 6:
                print("  expected 6 puzzles")
                failed = True
            for puzzle in data["puzzles"]:
                board = chess.Board(puzzle["fen"])
                label = f"  diagram {puzzle['id']}"
                if not board.is_valid() or board.turn != chess.WHITE:
                    print(label, "invalid", board.status())
                    failed = True
                    continue
                if data["goal"] == "mate":
                    found = mates(board)
                    sans = [board.san(move) for move in found]
                    print(label, "mates", sans)
                    if not found:
                        failed = True
                    for san in puzzle.get("solutions", []):
                        if san not in sans:
                            print(label, "listed", san, "is not mate")
                            failed = True
                    uci = puzzle["line"][0]
                    move = chess.Move.from_uci(uci)
                    if move not in found:
                        print(label, "line", uci, "is not mate")
                        failed = True
                else:
                    start = material(board)
                    info = engine.analyse(board, chess.engine.Limit(depth=12))
                    score = info["score"].white()
                    cp = score.score(mate_score=10000)
                    pv = info.get("pv", [])
                    print(label, "mat", start, "cp", cp, "best", pv[0].uci() if pv else None)
                    if start < -2 or start > 2:
                        print(label, "material is not level")
                        failed = True
                    if cp is None or cp < 250:
                        print(label, "not a clear win")
                        failed = True
                    line = puzzle.get("line") or []
                    if line and pv and chess.Move.from_uci(line[0]) != pv[0]:
                        # The stored move must still be a clear win, even if it is not unique.
                        board.push(chess.Move.from_uci(line[0]))
                        reply = engine.analyse(board, chess.engine.Limit(depth=10))
                        white = reply["score"].white().score(mate_score=10000)
                        print(label, "stored", line[0], "leaves", white)
                        if white is None or white < 250:
                            failed = True
    finally:
        engine.quit()
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

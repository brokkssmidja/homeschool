import { Chess } from "./vendor/chess.js";
import { Chessground } from "./vendor/chessground.min.js";

const STORAGE_KEY = "inga-chess-v1";
const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };

const listView = document.getElementById("view-list");
const playView = document.getElementById("view-play");
const checkView = document.getElementById("view-check");

const catalog = await fetch("catalog.json").then((res) => res.json());
const pages = new Map();
for (const entry of catalog) {
  pages.set(entry.id, { ...entry, data: await fetch(entry.file).then((res) => res.json()) });
}

let enginePromise;
let play = null;

function loadScores() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "");
    if (data && data.v === 1 && data.pages) return data;
  } catch { /* a bad save starts over */ }
  return { v: 1, pages: {} };
}

function saveScores(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function solvedSet(pageNumber) {
  const data = loadScores();
  const row = data.pages[String(pageNumber)];
  return new Set(row && Array.isArray(row.solved) ? row.solved : []);
}

function rememberSolve(pageNumber, puzzleId) {
  const data = loadScores();
  const key = String(pageNumber);
  const row = data.pages[key] || { solved: [] };
  if (!row.solved.includes(puzzleId)) row.solved.push(puzzleId);
  data.pages[key] = row;
  saveScores(data);
  return row.solved.length;
}

function show(name) {
  listView.hidden = name !== "list";
  playView.hidden = name !== "play";
  checkView.hidden = name !== "check";
}

function dests(chess) {
  const map = new Map();
  for (const move of chess.moves({ verbose: true })) {
    const list = map.get(move.from) || [];
    list.push(move.to);
    map.set(move.from, list);
  }
  return map;
}

function material(chess) {
  let total = 0;
  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece || piece.type === "k") continue;
      const value = PIECE_VALUE[piece.type];
      total += piece.color === "w" ? value : -value;
    }
  }
  return total;
}

function toWhite(score, sideToMove) {
  const value = score.type === "mate"
    ? (score.value > 0 ? 100000 - score.value : -100000 - score.value)
    : score.value;
  return sideToMove === "w" ? value : -value;
}

function ensureEngine() {
  if (!enginePromise) enginePromise = startEngine();
  return enginePromise;
}

function startEngine() {
  const worker = new Worker(new URL("./vendor/stockfish.js", import.meta.url));
  let last = null;
  let waiter = null;
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("engine")), 8000);
    const boot = (event) => {
      const line = String(event.data);
      if (line === "uciok") {
        clearTimeout(timer);
        worker.removeEventListener("message", boot);
        worker.postMessage("setoption name Threads value 1");
        worker.postMessage("setoption name Hash value 16");
        resolve(worker);
      }
    };
    worker.addEventListener("message", boot);
    worker.postMessage("uci");
  });
  worker.addEventListener("message", (event) => {
    const line = String(event.data);
    const scored = line.match(/score (cp|mate) (-?\d+)/);
    if (scored) last = { type: scored[1], value: Number(scored[2]) };
    if (line.startsWith("bestmove") && waiter) {
      const done = waiter;
      waiter = null;
      done({ move: line.split(/\s+/)[1], score: last });
    }
  });
  let chain = ready;
  return {
    best(fen) {
      const run = chain.then(() => new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiter = null;
          reject(new Error("engine"));
        }, 8000);
        waiter = (result) => {
          clearTimeout(timer);
          resolve(result);
        };
        last = null;
        worker.postMessage(`position fen ${fen}`);
        worker.postMessage("go movetime 700");
      }));
      chain = run.then(() => {}, () => {});
      return run;
    },
  };
}

function renderList() {
  const groups = [];
  for (const entry of catalog) {
    const found = groups.find((group) => group.title === entry.title);
    if (found) found.pages.push(entry);
    else groups.push({ title: entry.title, pages: [entry] });
  }
  listView.innerHTML = `
    <div class="wrap">
      <p class="kicker">Chess</p>
      <h1>Inga’s tactics</h1>
      <p class="lede">Six diagrams from one workbook page. Set the pieces here, then find the move.</p>
      ${groups.map((group) => `
        <section class="group">
          <h2>${escapeHtml(group.title)}</h2>
          ${group.pages.map((entry) => {
            const solved = solvedSet(entry.page);
            const score = solved.size;
            const done = score === 6;
            return `<a class="page-link" href="#/page/${entry.id}">
              <strong>Page ${entry.page}</strong>
              <span class="score-pill ${done ? "done" : ""}">Score ${score} / 6${done ? " · done" : ""}</span>
              <span>${escapeHtml(entry.title)}</span>
            </a>`;
          }).join("")}
        </section>`).join("")}
    </div>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

function openPlay(id) {
  const entry = pages.get(id);
  if (!entry) { location.hash = "#/"; return; }
  play = {
    entry,
    index: 0,
    chess: null,
    ground: null,
    busy: false,
    revealed: false,
    startMaterial: 0,
    note: "",
    tone: "",
  };
  show("play");
  mountPuzzle();
}

function mountPuzzle() {
  const { entry } = play;
  const puzzle = entry.data.puzzles[play.index];
  play.chess = new Chess(puzzle.fen);
  play.busy = false;
  play.revealed = false;
  play.hinted = false;
  play.startMaterial = material(play.chess);
  play.note = puzzleGoal(entry.data.goal);
  play.tone = "";
  const solved = solvedSet(entry.page);
  playView.innerHTML = `
    <div class="wrap">
      <div class="play-top">
        <div>
          <p class="kicker">Page ${entry.page} · ${play.index + 1} of 6</p>
          <h1>${escapeHtml(entry.title)}</h1>
        </div>
        <p class="score-pill">Score ${solved.size} / 6</p>
      </div>
      <div class="stage">
        <div class="board-wrap"><div id="board"></div></div>
        <div class="side">
          <p id="note" class="note"></p>
          <div class="actions">
            <button type="button" class="quiet" id="hint">Hint</button>
            <button type="button" class="quiet" id="solve">Show the answer</button>
            <button type="button" class="go" id="next" hidden>Next</button>
          </div>
          <p class="lede"><a href="#/check/${entry.id}">Check these diagrams</a> · <a href="#/">All pages</a></p>
        </div>
      </div>
    </div>`;
  play.ground = Chessground(document.getElementById("board"), {
    fen: play.chess.fen(),
    orientation: "white",
    coordinates: true,
    movable: { color: "white", free: false, dests: dests(play.chess), events: { after: onMove } },
    draggable: { enabled: true, showGhost: true },
    selectable: { enabled: true },
    animation: { enabled: true },
  });
  paintNote();
  document.getElementById("hint").onclick = () => hint();
  document.getElementById("solve").onclick = () => showAnswer();
  document.getElementById("next").onclick = () => advance();
}

function puzzleGoal(goal) {
  return goal === "mate" ? "White to move. Mate in one." : "White to move. Win the trapped piece.";
}

function paintNote() {
  const note = document.getElementById("note");
  if (!note) return;
  note.textContent = play.note;
  note.className = `note ${play.tone}`;
}

function setMovable(on) {
  play.ground.set({
    fen: play.chess.fen(),
    movable: on ? { color: "white", dests: dests(play.chess) } : { color: undefined, dests: new Map() },
  });
}

async function onMove(from, to) {
  if (!play || play.busy) return;
  const puzzle = play.entry.data.puzzles[play.index];
  const before = play.chess.fen();
  const played = play.chess.move({ from, to, promotion: "q" });
  if (!played) {
    play.ground.set({ fen: before });
    return;
  }
  play.busy = true;
  setMovable(false);
  play.note = "Checking…";
  play.tone = "";
  paintNote();
  const ok = await accepts(puzzle, before, played, play.chess);
  if (!ok) {
    play.chess.undo();
    play.note = "Try again.";
    play.tone = "bad";
    play.busy = false;
    setMovable(true);
    paintNote();
    return;
  }
  await afterAccepted(puzzle);
}

function uciOf(played) {
  return played.from + played.to + (played.promotion || "");
}

/** White moves sit on even indexes of the stored line. The first one is the key move. */
function onTheLine(puzzle, chess, uci) {
  const index = chess.history().length - 1;
  return Boolean(puzzle.line && puzzle.line[index] === uci);
}

async function accepts(puzzle, before, played, chess) {
  if (play.entry.data.goal === "mate") return chess.isCheckmate();
  const uci = uciOf(played);
  if (onTheLine(puzzle, chess, uci)) return true;
  try {
    const brain = await ensureEngine();
    const best = await brain.best(before);
    const reply = await brain.best(chess.fen());
    const bestWhite = toWhite(best.score || { type: "cp", value: 0 }, "w");
    const playedWhite = toWhite(reply.score || { type: "cp", value: 0 }, chess.turn());
    return playedWhite >= 180 && playedWhite >= bestWhite - 120;
  } catch {
    return false;
  }
}

async function afterAccepted() {
  if (play.entry.data.goal === "mate") {
    if (play.chess.isCheckmate()) finish(true, play.revealed ? "That’s the answer." : "Mate.");
    else {
      play.chess.undo();
      play.note = "Try again.";
      play.tone = "bad";
      play.busy = false;
      setMovable(true);
      paintNote();
    }
    return;
  }
  const gained = material(play.chess) >= play.startMaterial + 2;
  const scripted = play.entry.data.puzzles[play.index].line?.[play.chess.history().length];
  let replyUci = null;
  if (scripted) {
    const probe = new Chess(play.chess.fen());
    const legal = probe.move({ from: scripted.slice(0, 2), to: scripted.slice(2, 4), promotion: scripted[4] || "q" });
    if (legal) replyUci = scripted;
  }
  if (!replyUci) {
    try {
      const brain = await ensureEngine();
      const reply = await brain.best(play.chess.fen());
      replyUci = reply.move;
    } catch { /* a capture that already wins can stand on its own */ }
  }
  if (replyUci && replyUci !== "(none)") {
    const copy = new Chess(play.chess.fen());
    const replyMove = copy.move({ from: replyUci.slice(0, 2), to: replyUci.slice(2, 4), promotion: replyUci[4] || "q" });
    if (replyMove && material(copy) < play.startMaterial + 2) {
      play.chess.move({ from: replyUci.slice(0, 2), to: replyUci.slice(2, 4), promotion: replyUci[4] || "q" });
      play.ground.set({ fen: play.chess.fen() });
      play.note = "Your move.";
      play.tone = "";
      play.busy = false;
      setMovable(true);
      paintNote();
      return;
    }
  }
  if (gained) {
    if (replyUci && replyUci !== "(none)") {
      play.chess.move({ from: replyUci.slice(0, 2), to: replyUci.slice(2, 4), promotion: replyUci[4] || "q" });
      play.ground.set({ fen: play.chess.fen() });
    }
    finish(true, "That’s the piece.");
    return;
  }
  if (replyUci && replyUci !== "(none)") {
    play.chess.move({ from: replyUci.slice(0, 2), to: replyUci.slice(2, 4), promotion: replyUci[4] || "q" });
    play.ground.set({ fen: play.chess.fen() });
  }
  play.note = "Keep going.";
  play.tone = "good";
  play.busy = false;
  setMovable(true);
  paintNote();
}

function finish(scored, message) {
  const puzzle = play.entry.data.puzzles[play.index];
  if (scored && !play.revealed) rememberSolve(play.entry.page, puzzle.id);
  const solved = solvedSet(play.entry.page);
  play.note = message;
  play.tone = "good";
  play.busy = true;
  setMovable(false);
  paintNote();
  const score = playView.querySelector(".score-pill");
  if (score) score.textContent = `Score ${solved.size} / 6`;
  const next = document.getElementById("next");
  next.hidden = false;
  next.textContent = play.index === 5 ? "Back to the pages" : "Next diagram";
}

function advance() {
  if (play.index >= 5) {
    location.hash = "#/";
    return;
  }
  play.index += 1;
  mountPuzzle();
}

async function hint() {
  if (!play || play.busy) return;
  const puzzle = play.entry.data.puzzles[play.index];
  const step = puzzle.line && puzzle.line[play.chess.history().length];
  let from = step ? step.slice(0, 2) : "";
  let to = step ? step.slice(2, 4) : "";
  if (!step && play.chess.history().length) {
    try {
      const brain = await ensureEngine();
      const best = await brain.best(play.chess.fen());
      if (best.move && best.move !== "(none)") {
        from = best.move.slice(0, 2);
        to = best.move.slice(2, 4);
      }
    } catch { /* the stored first move is enough on diagram 1 */ }
  }
  const shapes = [];
  if (from) shapes.push({ orig: from, brush: "green" });
  if (play.hinted && to) shapes.push({ orig: from, dest: to, brush: "green" });
  const showingMove = play.hinted && Boolean(to);
  play.hinted = true;
  play.ground.set({ drawable: { autoShapes: shapes } });
  play.note = showingMove ? "Try that square." : "Use this piece.";
  play.tone = "";
  paintNote();
}

async function showAnswer() {
  if (!play || play.busy) return;
  play.revealed = true;
  play.busy = true;
  const puzzle = play.entry.data.puzzles[play.index];
  if (play.chess.history().length === 0 && puzzle.line && puzzle.line[0]) {
    const uci = puzzle.line[0];
    play.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" });
    play.ground.set({ fen: play.chess.fen() });
  }
  await afterAccepted(puzzle);
  play.revealed = true;
  if (play.entry.data.goal === "mate" && play.chess.isCheckmate()) {
    play.note = "That’s the answer.";
    paintNote();
  }
}

function openCheck(id) {
  const entry = pages.get(id);
  if (!entry) { location.hash = "#/"; return; }
  show("check");
  const cards = entry.data.puzzles.map((puzzle, index) => `
    <article class="check-card">
      <h3>Diagram ${index + 1}</h3>
      <div class="mini"><div id="mini-${index}"></div></div>
      <input class="fen" id="fen-${index}" value="${escapeHtml(puzzle.fen)}" aria-label="FEN for diagram ${index + 1}" spellcheck="false">
    </article>`).join("");
  checkView.innerHTML = `
    <div class="wrap">
      <div class="check-top">
        <div>
          <p class="kicker">Check view · page ${entry.page}</p>
          <h1>${escapeHtml(entry.title)}</h1>
        </div>
        <p><a href="#/page/${entry.id}">Solve</a> · <a href="#/">Pages</a></p>
      </div>
      <img class="photo" alt="Workbook page ${entry.page}" src="${entry.data.photo}">
      <div class="checks">${cards}</div>
    </div>`;
  const photo = checkView.querySelector(".photo");
  photo.addEventListener("error", () => {
    const note = document.createElement("p");
    note.className = "missing";
    note.textContent = "The workbook photo is not in the photos folder yet.";
    photo.replaceWith(note);
  });
  entry.data.puzzles.forEach((puzzle, index) => {
    const ground = Chessground(document.getElementById(`mini-${index}`), {
      fen: puzzle.fen,
      orientation: "white",
      coordinates: true,
      movable: { color: undefined },
      draggable: { enabled: false },
      selectable: { enabled: false },
    });
    document.getElementById(`fen-${index}`).addEventListener("input", (event) => {
      try {
        const next = new Chess(event.target.value.trim());
        ground.set({ fen: next.fen() });
      } catch { /* keep the last board that parsed */ }
    });
  });
}

function route() {
  const hash = location.hash || "#/";
  const page = hash.match(/^#\/page\/([0-9]+)$/);
  const check = hash.match(/^#\/check\/([0-9]+)$/);
  if (page) openPlay(page[1]);
  else if (check) openCheck(check[1]);
  else { show("list"); renderList(); }
}

window.addEventListener("hashchange", route);
route();

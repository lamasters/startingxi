# Soccer Lineup Builder

A browser-based soccer lineup manager built with React, TypeScript, and Vite.

## Features

- **Formation selector** — choose from `4-4-2`, `4-3-3`, `3-4-3`, `4-2-3-1`, `3-5-2`, and `5-3-2`
- **Interactive pitch** — player positions are rendered on a scaled soccer pitch, including the goalkeeper
- **Squad management** — add players with a primary (assigned) position and a list of preferred positions
- **Auto-assignment** — unassigned players are automatically placed into the best matching slot based on their primary and preferred positions
- **Manual assignment** — override auto-placement by pinning any player to a specific position
- **Subs support** — multiple players assigned to the same slot are shown together, representing starters and subs
- **Bench** — players who don't match any slot, or who have been manually removed from the lineup, appear on the bench
- **Hover tooltips** — hovering a player's name on the pitch shows their preferred positions
- **Share via URL** — the full lineup state (formation, players, positions, bench) is encoded into the URL so it can be copied and shared; the recipient opens the exact same lineup
- **Export as PNG** — download the current pitch as a high-resolution PNG, with unassign buttons and the bench hidden from the export

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- npm 9 or later

### Install

```bash
npm install
```

### Run locally

```bash
npm run dev
```

Open the URL printed in the terminal (default: `http://localhost:5173`).

### Build for production

```bash
npm run build
```

Output is written to `dist/`.

## Usage

1. **Pick a formation** from the dropdown at the top of the control panel.
2. **Add players** — enter a name, select their assigned position, and optionally list preferred positions (comma-separated, e.g. `M-C, M-R`).
3. Players are **automatically placed** on the pitch. Use the **Manual lineup assignment** panel to override any placement.
4. Click **x** next to a player on the pitch to move them to the bench.
5. Use the **squad list** to reassign or remove players at any time.
6. Copy the **Shareable URL** to send the full lineup to someone else.
7. Click **Export PNG** to download an image of the pitch.

## Tech Stack

- [React 19](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vitejs.dev/)
- [html-to-image](https://github.com/bubkoo/html-to-image) — PNG export

## License

MIT

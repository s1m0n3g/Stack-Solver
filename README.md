# Stack Solver Web

Stack Solver Web is a browser-based pallet loading optimizer built with Node.js and vanilla web technologies. It is a port of the original WPF desktop application, enabling you to calculate optimal box layouts directly from any device with a modern browser.

## Features

- 📦 **Multiple box types & Excel import** – plan layouts for several box sizes at once and populate them via spreadsheet uploads.
- 📐 **Automatic orientation selection** – evaluates both pallet orientations and picks the configuration that maximises the occupied area.
- 📊 **Detailed metrics** – displays efficiency, number of boxes per level, total weight, and more.
- 🖼️ **Interactive layout preview** – renders a scaled top-down view of the pallet showing both box orientations.
- 🧱 **3D pallet visualisation** – reproduces the original desktop app's 3D stack preview directly in the browser using WebGL.
- 🌐 **Browser access** – calculate layouts instantly in the browser with no round-trips to the server.

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the development server:

   ```bash
   npm run dev
   ```

   The application becomes available at [http://localhost:3000](http://localhost:3000).

3. For production use you can run the lightweight server directly:

   ```bash
   npm start
   ```

## Project structure

```
.
├── public/           # Static assets served by Express (HTML, CSS, JS)
├── shared/
│   └── solver.js     # Core optimisation logic shared by the UI and API
├── server.js         # Express server exposing the web UI and API endpoint
├── package.json      # Project metadata and scripts
└── README.md
```

## API

The browser UI reuses the same solver module locally, so results are available even if the API is unreachable. For integrations, a REST endpoint remains available at `POST /api/solve`. You can submit either a single `box` object or a `boxes` array to evaluate multiple layouts at once. Example payload:

```json
{
  "pallet": {
    "length": 120,
    "width": 100,
    "height": 15,
    "maxHeight": 180,
    "weight": 25,
    "maxWeight": 1000
  },
  "boxes": [
    {
      "label": "Cartons 40×30×20",
      "length": 40,
      "width": 30,
      "height": 20,
      "weight": 10,
      "quantity": 180
    },
    {
      "label": "Mixed totes",
      "length": 50,
      "width": 40,
      "height": 25,
      "weight": 12.5
    }
  ]
}
```

The response contains pallet metrics, arrangement details, and layout arrays for custom visualisations. Multi-box requests return a `results` array (one element per box type) alongside a high-level `summary` with totals:

- `layout` – placements for a single pallet level (useful for 2D projections).
- `layout3d` – placements repeated for each stack level with height data for 3D rendering.
- `summary` – aggregated totals such as boxes placed, load weight, tallest stack height, and unplaced quantities.

### Excel import

The browser UI accepts `.xlsx` and `.xls` files with columns for **length**, **width**, **height**, and **weight**. Optional columns such as **label/name** and **quantity** are detected automatically and mapped to solver inputs, allowing you to prepare box masters directly in spreadsheet form.

## License

Distributed under the MIT License. See `LICENSE` for more information.

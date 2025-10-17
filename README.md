# Stack Solver Web

Stack Solver Web is a browser-based pallet loading optimizer built with Node.js and vanilla web technologies. It is a port of the original WPF desktop application, enabling you to calculate optimal box layouts directly from any device with a modern browser.

## Features

- 📦 **Single box type optimisation** – determine the best arrangement for a single box size on a pallet.
- 📐 **Automatic orientation selection** – evaluates both pallet orientations and picks the configuration that maximises the occupied area.
- 📊 **Detailed metrics** – displays efficiency, number of boxes per level, total weight, and more.
- 🖼️ **Interactive layout preview** – renders a scaled top-down view of the pallet showing both box orientations.
- 🧱 **3D pallet visualisation** – reproduces the original desktop app's 3D stack preview directly in the browser using WebGL.
- 🌐 **Browser access** – run the solver locally as a Node.js web server without requiring Windows or WPF.

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
├── src/
│   └── solver.js     # Core optimisation logic translated from the WPF app
├── server.js         # Express server exposing the web UI and API endpoint
├── package.json      # Project metadata and scripts
└── README.md
```

## API

A REST endpoint is available at `POST /api/solve` for programmatic access. Example payload:

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
  "box": {
    "length": 40,
    "width": 30,
    "height": 20,
    "weight": 10
  }
}
```

The response contains pallet metrics, arrangement details, and layout arrays for custom visualisations:

- `layout` – placements for a single pallet level (useful for 2D projections).
- `layout3d` – placements repeated for each stack level with height data for 3D rendering.

## License

Distributed under the MIT License. See `LICENSE` for more information.

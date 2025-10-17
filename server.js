import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import { solveStacking } from './shared/solver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));

app.post('/api/solve', (req, res) => {
  try {
    const solution = solveStacking(req.body);
    res.json({ ok: true, data: solution });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Stack Solver web server running on http://localhost:${PORT}`);
});

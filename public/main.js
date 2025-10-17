import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js?module';
import * as XLSX from 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';
import { solveStacking } from '../shared/solver.js';

const form = document.getElementById('stack-form');
const resultsPanel = document.getElementById('results-panel');
const summary = document.getElementById('result-summary');
const metricsContainer = document.getElementById('result-metrics');
const layoutPanel = document.getElementById('layout-panel');
const canvas = document.getElementById('layout-canvas');
const legend = document.getElementById('layout-legend');
const viewer3d = document.getElementById('viewer3d');
const metricTemplate = document.getElementById('metric-template');
const solutionTabs = document.getElementById('solution-tabs');
const boxesContainer = document.getElementById('boxes-container');
const boxTemplate = document.getElementById('box-row-template');
const addBoxButton = document.getElementById('add-box');
const importExcelButton = document.getElementById('import-excel');
const excelInput = document.getElementById('excel-input');
const boxFeedback = document.getElementById('box-feedback');

const colors = {
  lengthwise: '#1f6feb',
  widthwise: '#d83b7d',
};

let threeState = null;
let currentSolutionSet = null;
let selectedSolutionIndex = 0;

initialiseBoxes();
setViewerPlaceholder('The interactive 3D preview will appear once a valid layout is generated.');

form.addEventListener('submit', (event) => {
  event.preventDefault();
  clearBoxFeedback();

  try {
    const payload = buildPayload();
    const result = solveStacking(payload);
    renderResult(result);
  } catch (error) {
    renderError(error.message);
  }
});

addBoxButton.addEventListener('click', () => {
  addBoxRow();
  updateRemoveButtons();
  setBoxFeedback('Added a new box type.');
});

boxesContainer.addEventListener('click', (event) => {
  if (!(event.target instanceof HTMLElement)) {
    return;
  }

  if (event.target.classList.contains('remove-box')) {
    const row = event.target.closest('.box-row');
    if (row) {
      row.remove();
      ensureAtLeastOneBox();
      updateRemoveButtons();
      setBoxFeedback('Box type removed.');
    }
  }
});

importExcelButton.addEventListener('click', () => {
  excelInput.click();
});

excelInput.addEventListener('change', async (event) => {
  const [file] = event.target.files || [];
  excelInput.value = '';

  if (!file) {
    return;
  }

  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const [sheetName] = workbook.SheetNames;
    if (!sheetName) {
      throw new Error('The workbook does not contain any worksheets.');
    }

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
    const entries = parseWorksheet(rows);

    if (!entries.length) {
      throw new Error('No valid box rows were found in the worksheet.');
    }

    boxesContainer.innerHTML = '';
    for (const entry of entries) {
      addBoxRow(entry);
    }
    updateRemoveButtons();
    setBoxFeedback(`Imported ${entries.length} box type${entries.length === 1 ? '' : 's'} from “${file.name}”.`);
  } catch (error) {
    setBoxFeedback(error.message, 'error');
  }
});

function initialiseBoxes() {
  boxesContainer.innerHTML = '';
  addBoxRow({
    label: 'Box 40×30×20',
    length: 40,
    width: 30,
    height: 20,
    weight: 10,
  });
  updateRemoveButtons();
  clearBoxFeedback();
}

function addBoxRow(values = {}) {
  const fragment = boxTemplate.content.cloneNode(true);
  const fieldset = fragment.querySelector('.box-row');
  if (!fieldset) {
    return;
  }

  const inputs = fieldset.querySelectorAll('input');
  inputs.forEach((input) => {
    const name = input.name;
    if (Object.prototype.hasOwnProperty.call(values, name) && values[name] !== undefined && values[name] !== null) {
      const value = values[name];
      input.value = typeof value === 'number' ? String(value) : String(value);
    } else if (!input.value) {
      input.value = '';
    }
  });

  boxesContainer.appendChild(fieldset);
}

function ensureAtLeastOneBox() {
  if (!boxesContainer.querySelector('.box-row')) {
    addBoxRow();
  }
}

function updateRemoveButtons() {
  const rows = boxesContainer.querySelectorAll('.box-row');
  const disable = rows.length <= 1;
  rows.forEach((row) => {
    const button = row.querySelector('.remove-box');
    if (button) {
      button.disabled = disable;
      button.setAttribute('aria-disabled', disable ? 'true' : 'false');
    }
  });
}

function clearBoxFeedback() {
  setBoxFeedback('');
}

function setBoxFeedback(message, type = 'info') {
  if (!boxFeedback) {
    return;
  }

  boxFeedback.textContent = message;
  if (type === 'error') {
    boxFeedback.classList.add('form-feedback--error');
  } else {
    boxFeedback.classList.remove('form-feedback--error');
  }
}

function buildPayload() {
  const formData = new FormData(form);
  const pallet = {};

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('pallet.')) {
      continue;
    }
    const [, field] = key.split('.');
    pallet[field] = value;
  }

  const boxes = readBoxes();
  return { pallet, boxes };
}

function readBoxes() {
  const rows = Array.from(boxesContainer.querySelectorAll('.box-row'));
  if (!rows.length) {
    throw new Error('Add at least one box type before calculating the layout.');
  }

  const boxes = [];
  for (let index = 0; index < rows.length; index += 1) {
    boxes.push(readBoxRow(rows[index], index));
  }
  return boxes;
}

function readBoxRow(row, index) {
  const inputs = row.querySelectorAll('input');
  const values = {};
  inputs.forEach((input) => {
    values[input.name] = input.value.trim();
  });

  const label = values.label || '';
  const descriptor = label || `Box type ${index + 1}`;
  const requiredFields = [
    ['length', 'Length'],
    ['width', 'Width'],
    ['height', 'Height'],
    ['weight', 'Weight'],
  ];

  for (const [field, friendly] of requiredFields) {
    if (!values[field]) {
      throw new Error(`${descriptor}: ${friendly} is required.`);
    }
  }

  const payload = {
    label,
    length: values.length,
    width: values.width,
    height: values.height,
    weight: values.weight,
  };

  if (values.quantity) {
    payload.quantity = values.quantity;
  }

  return payload;
}

function parseWorksheet(rows) {
  if (!rows || rows.length === 0) {
    throw new Error('The worksheet is empty.');
  }

  const header = rows[0].map((cell) => normaliseHeader(cell));
  const findIndex = (aliases) => header.findIndex((value) => aliases.includes(value));

  const lengthIndex = findIndex(['length', 'len', 'l', 'lunghezza']);
  const widthIndex = findIndex(['width', 'wid', 'w', 'larghezza']);
  const heightIndex = findIndex(['height', 'h', 'altezza']);
  const weightIndex = findIndex(['weight', 'kg', 'peso']);
  const labelIndex = findIndex(['label', 'name', 'description', 'box', 'codice']);
  const quantityIndex = findIndex(['quantity', 'qty', 'qta', 'quantita']);

  if (lengthIndex === -1 || widthIndex === -1 || heightIndex === -1 || weightIndex === -1) {
    throw new Error('The worksheet must include length, width, height, and weight columns.');
  }

  const entries = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const length = normaliseNumericCell(row[lengthIndex]);
    const width = normaliseNumericCell(row[widthIndex]);
    const height = normaliseNumericCell(row[heightIndex]);
    const weight = normaliseNumericCell(row[weightIndex]);

    if (length === null || width === null || height === null || weight === null) {
      continue;
    }

    const entry = { length, width, height, weight };

    if (labelIndex !== -1) {
      entry.label = String(row[labelIndex] ?? '').trim();
    }

    if (quantityIndex !== -1) {
      const quantityValue = normaliseNumericCell(row[quantityIndex]);
      if (quantityValue !== null) {
        entry.quantity = Math.floor(quantityValue);
      }
    }

    entries.push(entry);
  }

  return entries;
}

function normaliseHeader(value) {
  return String(value ?? '').trim().toLowerCase();
}

function normaliseNumericCell(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const normalised = String(value).trim().replace(',', '.');
  if (!normalised) {
    return null;
  }

  const number = Number(normalised);
  return Number.isFinite(number) ? number : null;
}

function renderError(message) {
  currentSolutionSet = null;
  selectedSolutionIndex = 0;
  resultsPanel.hidden = false;
  layoutPanel.hidden = true;
  summary.innerHTML = `<span class="error">${message}</span>`;
  metricsContainer.innerHTML = '';
  solutionTabs.hidden = true;
  solutionTabs.innerHTML = '';
  legend.innerHTML = '';
  setViewerPlaceholder('3D preview unavailable until a valid layout is generated.');
}

function renderResult(rawResult) {
  const solution = normaliseSolution(rawResult);
  currentSolutionSet = solution;
  selectedSolutionIndex = 0;

  resultsPanel.hidden = false;
  summary.innerHTML = buildSummaryText(solution);

  renderTabs(solution);
  renderSelectedSolution();
}

function normaliseSolution(rawResult) {
  if (!rawResult) {
    throw new Error('Solver returned an empty response.');
  }

  if (Array.isArray(rawResult.results) && rawResult.results.length) {
    return {
      mode: rawResult.mode || (rawResult.results.length > 1 ? 'multi' : 'single'),
      pallet: rawResult.pallet,
      results: rawResult.results,
      summary: rawResult.summary || buildSolutionSummary(rawResult.results, rawResult.pallet),
    };
  }

  if (!rawResult.metrics) {
    throw new Error('Solver response is missing metrics.');
  }

  const summary = buildSolutionSummary([rawResult], rawResult.pallet);
  return {
    mode: 'single',
    pallet: rawResult.pallet,
    results: [rawResult],
    summary,
  };
}

function buildSolutionSummary(results, pallet) {
  const totalBoxes = results.reduce((sum, entry) => sum + (entry.metrics?.totalBoxes ?? 0), 0);
  const totalLoadWeight = results.reduce((sum, entry) => sum + (entry.metrics?.loadWeight ?? 0), 0);
  const totalWeight = pallet ? pallet.weight + totalLoadWeight : totalLoadWeight;
  const maxHeight = results.reduce(
    (max, entry) => Math.max(max, entry.metrics?.totalHeight ?? 0),
    pallet?.height ?? 0,
  );
  const unplacedBoxes = results.reduce((sum, entry) => sum + (entry.metrics?.quantityShortfall ?? 0), 0);

  return {
    totalBoxes,
    totalLayouts: results.length,
    totalLoadWeight,
    totalWeight,
    maxHeight,
    unplacedBoxes,
  };
}

function buildSummaryText(solution) {
  if (!solution.results.length) {
    return 'No layout data available.';
  }

  if (solution.results.length === 1) {
    const entry = solution.results[0];
    const metrics = entry.metrics;
    const orientationLabel = entry.orientation === 'length-first'
      ? 'Align boxes with pallet length first'
      : 'Rotate pallet: best fit aligns with width first';

    const labelPrefix = entry.meta?.displayName ? `<strong>${entry.meta.displayName}</strong>: ` : '';

    return `${labelPrefix}<strong>${formatNumber(metrics.totalBoxes)}</strong> boxes arranged across `
      + `<strong>${metrics.levels}</strong> level${metrics.levels === 1 ? '' : 's'}. `
      + `Strategy: ${orientationLabel}.`;
  }

  const { totalBoxes, totalLayouts, totalLoadWeight, totalWeight, maxHeight, unplacedBoxes } = solution.summary;
  const parts = [
    `<strong>${formatNumber(totalBoxes)}</strong> boxes optimised across `
      + `<strong>${totalLayouts}</strong> box type${totalLayouts === 1 ? '' : 's'}.`,
    `Combined load weight: ${formatNumber(totalLoadWeight)} kg (total ${formatNumber(totalWeight)} kg including the pallet).`,
    `Tallest stack height: ${formatNumber(maxHeight)} cm.`,
  ];

  if (unplacedBoxes > 0) {
    parts.push(`${formatNumber(unplacedBoxes)} box${unplacedBoxes === 1 ? '' : 'es'} could not be placed due to constraints.`);
  }

  parts.push('Select a box type below to inspect its layout.');
  return parts.join(' ');
}

function renderTabs(solution) {
  solutionTabs.innerHTML = '';

  if (solution.results.length <= 1) {
    solutionTabs.hidden = true;
    return;
  }

  solutionTabs.hidden = false;
  solution.results.forEach((entry, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = entry.meta?.displayName || `Box ${index + 1}`;
    button.dataset.index = String(index);
    button.setAttribute('aria-pressed', index === selectedSolutionIndex ? 'true' : 'false');
    button.addEventListener('click', () => {
      selectSolution(index);
    });
    solutionTabs.appendChild(button);
  });
}

function selectSolution(index) {
  if (!currentSolutionSet) {
    return;
  }

  selectedSolutionIndex = index;
  updateTabSelection();
  renderSelectedSolution();
}

function updateTabSelection() {
  const buttons = solutionTabs.querySelectorAll('button');
  buttons.forEach((button, index) => {
    button.setAttribute('aria-pressed', index === selectedSolutionIndex ? 'true' : 'false');
  });
}

function renderSelectedSolution() {
  if (!currentSolutionSet || !currentSolutionSet.results.length) {
    renderError('No layout data available.');
    return;
  }

  const entry = currentSolutionSet.results[selectedSolutionIndex] || currentSolutionSet.results[0];
  updateTabSelection();
  renderMetrics(entry);
  renderVisuals(entry);
}

function renderMetrics(entry) {
  const metrics = entry.metrics;
  const rows = [];

  if (entry.meta?.displayName) {
    rows.push(['Box type', entry.meta.displayName]);
  }

  if (typeof metrics.quantityRequested === 'number') {
    rows.push(['Quantity requested', formatNumber(metrics.quantityRequested)]);
  }

  if (metrics.quantityShortfall > 0) {
    rows.push(['Unplaced quantity', formatNumber(metrics.quantityShortfall)]);
  }

  rows.push(['Orientation', orientationDescription(entry)]);
  rows.push(['Boxes per full level', metrics.boxesPerLevel]);
  rows.push(['Full levels', metrics.fullLevels]);
  rows.push(['Levels used', metrics.levels]);
  rows.push(['Boxes on final level', metrics.lastLevelBoxes]);
  rows.push(['Total boxes placed', metrics.totalBoxes]);
  rows.push(['Cargo footprint', `${formatNumber(metrics.cargoLength)} × ${formatNumber(metrics.cargoWidth)} cm`]);
  rows.push(['Offsets (x, y)', `${formatNumber(metrics.offsetX)} cm, ${formatNumber(metrics.offsetY)} cm`]);
  rows.push(['Total height', `${formatNumber(metrics.totalHeight)} cm`]);
  rows.push(['Occupied area', `${formatNumber(metrics.areaOccupied)} cm²`]);
  rows.push(['Unused area', `${formatNumber(metrics.unusedArea)} cm²`]);
  rows.push(['Efficiency', `${metrics.efficiency.toFixed(2)} %`]);
  rows.push(['Load weight', `${formatNumber(metrics.loadWeight)} kg`]);
  rows.push(['Combined weight', `${formatNumber(metrics.totalWeight)} kg`]);

  metricsContainer.innerHTML = '';
  rows.forEach(([label, value]) => {
    const fragment = metricTemplate.content.cloneNode(true);
    fragment.querySelector('dt').textContent = label;
    fragment.querySelector('dd').textContent = value;
    metricsContainer.appendChild(fragment);
  });
}

function orientationDescription(entry) {
  return entry.orientation === 'length-first'
    ? 'Length first (align to pallet length)'
    : 'Width first (rotate pallet)';
}

function renderVisuals(entry) {
  const { layout, arrangement, pallet, metrics, layout3d } = entry;

  if (!layout || layout.length === 0) {
    layoutPanel.hidden = true;
    legend.innerHTML = '';
    setViewerPlaceholder('3D preview unavailable until a valid layout is generated.');
    return;
  }

  layoutPanel.hidden = false;
  drawLayout(canvas, layout, pallet, metrics);
  updateLegend(arrangement);
  render3D(layout3d, pallet, metrics);
}

function formatNumber(value) {
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

function updateLegend(arrangement) {
  legend.innerHTML = '';

  if (!arrangement) {
    return;
  }

  const entries = [
    { label: `Lengthwise (${arrangement.orientation1Columns} columns)`, color: colors.lengthwise },
    { label: `Widthwise (${arrangement.orientation2Columns} columns)`, color: colors.widthwise },
  ];

  entries.forEach((entry) => {
    const span = document.createElement('span');
    span.textContent = entry.label;
    span.style.color = entry.color;
    legend.appendChild(span);
  });
}

function drawLayout(canvasElement, layout, pallet, metrics) {
  const ctx = canvasElement.getContext('2d');
  const padding = 30;
  const scaleX = (canvasElement.width - padding * 2) / pallet.orientedLength;
  const scaleY = (canvasElement.height - padding * 2) / pallet.orientedWidth;
  const scale = Math.min(scaleX, scaleY);

  ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  ctx.save();
  ctx.translate(
    (canvasElement.width - pallet.orientedLength * scale) / 2,
    (canvasElement.height - pallet.orientedWidth * scale) / 2,
  );

  ctx.fillStyle = 'rgba(15, 23, 42, 0.04)';
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(0, 0, pallet.orientedLength * scale, pallet.orientedWidth * scale);
  ctx.fill();
  ctx.stroke();

  for (const box of layout) {
    const x = box.x * scale;
    const y = box.y * scale;
    ctx.fillStyle = colors[box.orientation] || colors.lengthwise;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x, y, box.length * scale, box.width * scale);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.strokeRect(x, y, box.length * scale, box.width * scale);
  }

  ctx.restore();
}

function ensureThreeContext() {
  if (threeState) {
    return threeState;
  }

  const width = viewer3d.clientWidth || viewer3d.offsetWidth || 640;
  const height = viewer3d.clientHeight || viewer3d.offsetHeight || 420;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf8fafc);

  const camera = new THREE.PerspectiveCamera(45, width / height, 1, 5000);

  viewer3d.innerHTML = '';
  viewer3d.dataset.state = 'ready';
  viewer3d.dataset.placeholder = '';
  viewer3d.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2;

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.55);
  fillLight.position.set(300, 400, 200);
  const rimLight = new THREE.DirectionalLight(0xffffff, 0.35);
  rimLight.position.set(-250, 300, -220);

  scene.add(ambientLight, fillLight, rimLight);

  const resizeHandler = () => {
    if (!threeState) {
      return;
    }
    const newWidth = viewer3d.clientWidth || viewer3d.offsetWidth || width;
    const newHeight = viewer3d.clientHeight || viewer3d.offsetHeight || height || 1;
    renderer.setSize(newWidth, newHeight);
    camera.aspect = newWidth / newHeight;
    camera.updateProjectionMatrix();
  };

  window.addEventListener('resize', resizeHandler);

  threeState = {
    renderer,
    scene,
    camera,
    controls,
    resizeHandler,
    animationId: null,
    group: null,
    grid: null,
  };

  startThreeLoop();
  return threeState;
}

function startThreeLoop() {
  if (!threeState) {
    return;
  }

  if (threeState.animationId) {
    cancelAnimationFrame(threeState.animationId);
  }

  const loop = () => {
    if (!threeState) {
      return;
    }
    threeState.controls.update();
    threeState.renderer.render(threeState.scene, threeState.camera);
    threeState.animationId = requestAnimationFrame(loop);
  };

  loop();
}

function setViewerPlaceholder(message) {
  teardownThree();
  viewer3d.dataset.state = 'empty';
  viewer3d.dataset.placeholder = message;
  viewer3d.innerHTML = '';
}

function teardownThree() {
  if (!threeState) {
    return;
  }

  cancelAnimationFrame(threeState.animationId);
  window.removeEventListener('resize', threeState.resizeHandler);

  if (threeState.group) {
    disposeThreeGroup(threeState.group);
    threeState.scene.remove(threeState.group);
  }

  if (threeState.grid) {
    threeState.scene.remove(threeState.grid);
    threeState.grid.geometry.dispose();
  }

  threeState.controls.dispose();
  threeState.renderer.dispose();
  threeState = null;
}

function disposeThreeGroup(group) {
  group.traverse((child) => {
    if ('geometry' in child && child.geometry) {
      child.geometry.dispose();
    }
    if ('material' in child && child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose && material.dispose());
      } else if (child.material.dispose) {
        child.material.dispose();
      }
    }
  });
}

function render3D(layout3d, pallet, metrics) {
  if (!layout3d || layout3d.length === 0) {
    setViewerPlaceholder('3D preview unavailable until a valid layout is generated.');
    return;
  }

  const state = ensureThreeContext();
  const { scene } = state;

  if (state.group) {
    disposeThreeGroup(state.group);
    scene.remove(state.group);
    state.group = null;
  }

  if (state.grid) {
    scene.remove(state.grid);
    state.grid.geometry.dispose();
    state.grid = null;
  }

  const group = new THREE.Group();

  const palletMesh = new THREE.Mesh(
    new THREE.BoxGeometry(pallet.orientedLength, pallet.height, pallet.orientedWidth),
    new THREE.MeshStandardMaterial({
      color: 0x64748b,
      transparent: true,
      opacity: 0.5,
      roughness: 0.85,
      metalness: 0.05,
    }),
  );
  palletMesh.position.set(
    pallet.orientedLength / 2,
    pallet.height / 2,
    pallet.orientedWidth / 2,
  );
  group.add(palletMesh);

  const orientationMaterials = {
    lengthwise: new THREE.MeshStandardMaterial({
      color: new THREE.Color(colors.lengthwise),
      transparent: true,
      opacity: 0.92,
    }),
    widthwise: new THREE.MeshStandardMaterial({
      color: new THREE.Color(colors.widthwise),
      transparent: true,
      opacity: 0.92,
    }),
  };

  for (const placement of layout3d) {
    const geometry = new THREE.BoxGeometry(placement.length, placement.height, placement.width);
    const material = orientationMaterials[placement.orientation] || orientationMaterials.lengthwise;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(
      placement.x + placement.length / 2,
      placement.z + placement.height / 2,
      placement.y + placement.width / 2,
    );
    group.add(mesh);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }),
    );
    edges.position.copy(mesh.position);
    group.add(edges);
  }

  scene.add(group);
  state.group = group;

  const gridSize = Math.max(pallet.orientedLength, pallet.orientedWidth) * 1.4;
  const gridDivisions = Math.max(10, Math.ceil(gridSize / 10));
  const grid = new THREE.GridHelper(gridSize, gridDivisions, 0xd0d7de, 0xe2e8f0);
  grid.position.set(pallet.orientedLength / 2, 0, pallet.orientedWidth / 2);
  scene.add(grid);
  state.grid = grid;

  positionCamera(state, pallet, metrics);
  startThreeLoop();
}

function positionCamera(state, pallet, metrics) {
  const { camera, controls } = state;
  const maxDimension = Math.max(
    pallet.orientedLength,
    pallet.orientedWidth,
    metrics.totalHeight,
  );
  const distance = maxDimension * 1.45 + 120;
  camera.position.set(distance, distance, distance);
  camera.near = 0.1;
  camera.far = Math.max(1000, distance * 6);
  camera.updateProjectionMatrix();
  controls.target.set(
    pallet.orientedLength / 2,
    metrics.totalHeight / 2,
    pallet.orientedWidth / 2,
  );
  controls.update();
}

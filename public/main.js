import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as XLSX from 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';
import { templateWorkbookBase64 } from './templateWorkbook.js';
import { solveStacking, combineSolutions } from '../shared/solver.js';

const form = document.getElementById('stack-form');
const resultsPanel = document.getElementById('results-panel');
const summary = document.getElementById('result-summary');
const metricsContainer = document.getElementById('result-metrics');
const layoutPanel = document.getElementById('layout-panel');
const canvas = document.getElementById('layout-canvas');
const legend = document.getElementById('layout-legend');
const viewer3d = document.getElementById('viewer3d');
const topViewContainer = document.getElementById('top-view-container');
const toggleTopViewButton = document.getElementById('toggle-top-view');
const toggle3dViewButton = document.getElementById('toggle-3d-view');
const metricTemplate = document.getElementById('metric-template');
const solutionTabs = document.getElementById('solution-tabs');
const boxesContainer = document.getElementById('boxes-container');
const boxTemplate = document.getElementById('box-row-template');
const addBoxButton = document.getElementById('add-box');
const importExcelButton = document.getElementById('import-excel');
const downloadTemplateButton = document.getElementById('download-template');
const excelInput = document.getElementById('excel-input');
const boxFeedback = document.getElementById('box-feedback');
const stagingPanel = document.getElementById('staging-panel');
const stagingBoxes = document.getElementById('staging-boxes');
const stagingStatus = document.getElementById('staging-status');
const unplacedPanel = document.getElementById('unplaced-panel');
const unplacedShelf = document.getElementById('unplaced-shelf');
const unplacedTotal = document.getElementById('unplaced-total');

const colors = {
  lengthwise: '#1f6feb',
  widthwise: '#d83b7d',
};

let threeState = null;
let currentSolutionSet = null;
let selectedSolutionIndices = new Set();
let topViewVisible = true;
let threeViewVisible = true;
let lastVisualEntry = null;
let baseGroundStats = new Map();
let currentGroundStats = new Map();

initialiseBoxes();
setViewerPlaceholder('The interactive 3D preview will appear once a valid layout is generated.');
initialiseViewToggles();

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
      updateBoxRowStatuses(currentSolutionSet);
      updateGroundDraft();
    }
  }
});

boxesContainer.addEventListener('input', () => {
  updateGroundDraft();
});

importExcelButton.addEventListener('click', () => {
  excelInput.click();
});

if (downloadTemplateButton) {
  downloadTemplateButton.addEventListener('click', () => {
    try {
      downloadTemplateWorkbook();
      setBoxFeedback('Modello Excel di esempio scaricato.');
    } catch (error) {
      console.error(error);
      setBoxFeedback('Non è stato possibile preparare il modello Excel di esempio.', 'error');
    }
  });
}

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
    updateBoxRowStatuses(currentSolutionSet);
    updateGroundDraft();
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
  updateBoxRowStatuses(currentSolutionSet);
  updateGroundDraft();
}

function initialiseViewToggles() {
  if (toggleTopViewButton) {
    toggleTopViewButton.addEventListener('click', () => {
      setTopViewVisibility(!topViewVisible);
    });
  }

  if (toggle3dViewButton) {
    toggle3dViewButton.addEventListener('click', () => {
      setThreeViewVisibility(!threeViewVisible);
    });
  }

  setTopViewVisibility(true);
  setThreeViewVisibility(true);
}

function setTopViewVisibility(visible) {
  topViewVisible = visible;

  if (toggleTopViewButton) {
    toggleTopViewButton.setAttribute('aria-pressed', visible ? 'false' : 'true');
    toggleTopViewButton.textContent = visible ? 'Hide top view' : 'Show top view';
  }

  refreshTopView();
}

function refreshTopView() {
  if (!topViewContainer || !canvas) {
    return;
  }

  const hasLayout = Array.isArray(lastVisualEntry?.layout) && lastVisualEntry.layout.length > 0;

  if (!hasLayout) {
    if (legend) {
      legend.hidden = true;
      legend.innerHTML = '';
    }
    topViewContainer.hidden = true;
    if (toggleTopViewButton) {
      toggleTopViewButton.disabled = true;
    }
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    return;
  }

  if (toggleTopViewButton) {
    toggleTopViewButton.disabled = false;
  }

  if (legend) {
    legend.hidden = !topViewVisible;
  }

  topViewContainer.hidden = !topViewVisible;

  if (!topViewVisible) {
    return;
  }

  drawLayout(canvas, lastVisualEntry.layout, lastVisualEntry.pallet, lastVisualEntry.metrics);
}

function setThreeViewVisibility(visible) {
  threeViewVisible = visible;

  if (toggle3dViewButton) {
    toggle3dViewButton.setAttribute('aria-pressed', visible ? 'false' : 'true');
    toggle3dViewButton.textContent = visible ? 'Hide 3D view' : 'Show 3D view';
  }

  if (!visible) {
    viewer3d.hidden = true;
    setViewerPlaceholder('3D view hidden. Toggle to show the preview.');
    return;
  }

  viewer3d.hidden = false;
  refresh3D();
}

function refresh3D() {
  if (!viewer3d) {
    return;
  }

  const hasLayout3d = Array.isArray(lastVisualEntry?.layout3d) && lastVisualEntry.layout3d.length > 0;

  if (toggle3dViewButton) {
    toggle3dViewButton.disabled = !hasLayout3d;
  }

  if (!hasLayout3d) {
    if (threeViewVisible) {
      viewer3d.hidden = false;
      setViewerPlaceholder('3D preview unavailable until a valid layout is generated.');
    }
    return;
  }

  if (!threeViewVisible) {
    viewer3d.hidden = true;
    return;
  }

  viewer3d.hidden = false;
  render3D(lastVisualEntry.layout3d, lastVisualEntry.pallet, lastVisualEntry.metrics, lastVisualEntry.meta);
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

  clearRowStatus(fieldset);
  boxesContainer.appendChild(fieldset);
  updateBoxRowStatuses(currentSolutionSet);
  updateGroundDraft();
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

function clearRowStatus(row) {
  if (!row) {
    return;
  }
  row.removeAttribute('data-status');
  row.removeAttribute('data-status-label');
}

function updateBoxRowStatuses(solution) {
  const rows = Array.from(boxesContainer.querySelectorAll('.box-row'));
  if (!rows.length) {
    return;
  }

  const statusByIndex = new Map();
  if (solution && Array.isArray(solution.results)) {
    solution.results.forEach((entry) => {
      const sourceIndex = entry?.meta?.sourceIndex ?? entry?.box?.sourceIndex;
      if (typeof sourceIndex !== 'number' || Number.isNaN(sourceIndex)) {
        return;
      }
      const metrics = entry.metrics || {};
      const placed = metrics.totalBoxes ?? 0;
      const requested = typeof metrics.quantityRequested === 'number' && metrics.quantityRequested > 0
        ? metrics.quantityRequested
        : null;
      const shortfall = metrics.quantityShortfall ?? (
        requested !== null
          ? Math.max(0, requested - placed)
          : 0
      );
      statusByIndex.set(sourceIndex, { placed, requested, shortfall });
    });
  }

  rows.forEach((row, index) => {
    const status = statusByIndex.get(index);
    if (!status) {
      clearRowStatus(row);
      return;
    }

    let key = '';
    let label = '';
    if (status.placed <= 0) {
      key = 'unplaced';
      label = 'Non posizionato';
    } else if (status.requested !== null && status.requested > 0 && status.shortfall > 0) {
      key = 'partial';
      label = 'Parziale';
    } else if (status.requested !== null && status.requested > 0) {
      key = 'accepted';
      label = 'Completato';
    } else {
      key = 'accepted';
      label = 'Completato';
    }

    if (key) {
      row.setAttribute('data-status', key);
      row.setAttribute('data-status-label', label);
    } else {
      clearRowStatus(row);
    }
  });
}

function updateGroundDraft() {
  const drafts = collectDraftBoxes();
  const stats = currentGroundStats instanceof Map ? currentGroundStats : new Map();
  renderStagingGround(drafts, stats);
  renderUnplacedShelf(drafts, stats);
}

function collectDraftBoxes() {
  if (!boxesContainer) {
    return [];
  }

  const rows = Array.from(boxesContainer.querySelectorAll('.box-row'));
  return rows.map((row, index) => {
    const readInputValue = (name) => {
      const input = row.querySelector(`input[name="${name}"]`);
      return input ? input.value.trim() : '';
    };

    const parseDimension = (name) => {
      const raw = readInputValue(name);
      if (!raw) {
        return null;
      }
      const normalised = raw.replace(',', '.');
      const number = Number(normalised);
      if (!Number.isFinite(number) || number <= 0) {
        return null;
      }
      return number;
    };

    const parseQuantity = () => {
      const raw = readInputValue('quantity');
      if (!raw) {
        return null;
      }
      const normalised = raw.replace(',', '.');
      const number = Number(normalised);
      if (!Number.isFinite(number) || number < 0) {
        return null;
      }
      return Math.floor(number);
    };

    const labelValue = readInputValue('label');

    return {
      index,
      label: labelValue || `Box ${index + 1}`,
      length: parseDimension('length'),
      width: parseDimension('width'),
      height: parseDimension('height'),
      quantity: parseQuantity(),
    };
  });
}

function formatDraftDimensions(source) {
  if (!source) {
    return '';
  }

  const dimensions = ['length', 'width', 'height']
    .map((key) => {
      const value = Number(source[key]);
      return Number.isFinite(value) && value > 0 ? formatNumber(value) : null;
    });

  if (dimensions.every((value) => typeof value === 'string')) {
    return `${dimensions[0]} × ${dimensions[1]} × ${dimensions[2]} cm`;
  }

  return '';
}

function renderStagingGround(drafts, statsMap) {
  if (!stagingPanel || !stagingBoxes || !stagingStatus) {
    return;
  }

  if (!Array.isArray(drafts) || drafts.length === 0) {
    stagingStatus.textContent = 'Aggiungi almeno una tipologia di scatola per popolare l’area di preparazione.';
    stagingBoxes.innerHTML = '';
    return;
  }

  const map = statsMap instanceof Map ? statsMap : new Map();

  const totalRemaining = drafts.reduce((sum, draft) => {
    const stats = map.get(draft.index);
    if (stats) {
      return sum + Math.max(0, stats.unplaced ?? 0);
    }
    if (typeof draft.quantity === 'number') {
      return sum + Math.max(0, draft.quantity);
    }
    return sum;
  }, 0);

  if (map.size > 0) {
    stagingStatus.textContent = totalRemaining > 0
      ? `Ancora a terra: ${formatNumber(totalRemaining)} pezzi in attesa di ottimizzazione.`
      : 'Tutte le scatole sono state posizionate sul bancale.';
  } else {
    stagingStatus.textContent = 'Le scatole inserite vengono tenute a terra finché non lanci il calcolo.';
  }

  stagingBoxes.innerHTML = '';

  drafts.forEach((draft) => {
    const stats = map.get(draft.index);
    const card = document.createElement('div');
    card.className = 'staging-box';

    const state = (() => {
      if (stats) {
        const placed = stats.placed ?? 0;
        const unplaced = stats.unplaced ?? 0;
        if (unplaced > 0 && placed > 0) {
          return 'partial';
        }
        if (unplaced <= 0 && placed > 0) {
          return 'ready';
        }
        if (unplaced > 0 && placed <= 0) {
          return 'waiting';
        }
        if (placed > 0) {
          return 'ready';
        }
      }
      return 'waiting';
    })();

    card.setAttribute('data-state', state);

    const badge = document.createElement('span');
    badge.className = 'staging-box__badge';
    badge.textContent = state === 'ready'
      ? 'Sul bancale'
      : state === 'partial'
        ? 'Parziale'
        : 'In attesa';
    card.appendChild(badge);

    const label = document.createElement('span');
    label.className = 'staging-box__label';
    label.textContent = stats?.label || draft.label;
    card.appendChild(label);

    const dimsText = formatDraftDimensions(stats?.dimensions || draft);
    if (dimsText) {
      const dims = document.createElement('span');
      dims.className = 'staging-box__dims';
      dims.textContent = dimsText;
      card.appendChild(dims);
    }

    const info = document.createElement('div');
    info.className = 'staging-box__info';

    const requested = typeof stats?.requested === 'number'
      ? stats.requested
      : typeof draft.quantity === 'number'
        ? draft.quantity
        : null;

    if (typeof requested === 'number') {
      const requestedItem = document.createElement('span');
      requestedItem.textContent = `Richiesti: ${formatNumber(requested)}`;
      info.appendChild(requestedItem);
    } else {
      const fillItem = document.createElement('span');
      fillItem.textContent = 'Riempimento fino alla capacità.';
      info.appendChild(fillItem);
    }

    if (stats) {
      const placed = document.createElement('span');
      placed.textContent = `Sul bancale: ${formatNumber(stats.placed ?? 0)}`;
      info.appendChild(placed);

      if ((stats.unplaced ?? 0) > 0) {
        const remaining = document.createElement('span');
        remaining.textContent = `Ancora a terra: ${formatNumber(stats.unplaced ?? 0)}`;
        info.appendChild(remaining);
      } else {
        const clear = document.createElement('span');
        clear.textContent = 'Nessuna scatola a terra.';
        info.appendChild(clear);
      }
    } else if (typeof requested === 'number') {
      const waiting = document.createElement('span');
      waiting.textContent = `In attesa: ${formatNumber(requested)}`;
      info.appendChild(waiting);
    }

    card.appendChild(info);

    const pile = document.createElement('div');
    pile.className = 'staging-box__pile';
    const groundCount = stats ? stats.unplaced ?? 0 : (typeof draft.quantity === 'number' ? draft.quantity : 0);
    const crateCount = Math.min(12, Math.max(0, Math.round(groundCount)));
    for (let index = 0; index < crateCount; index += 1) {
      const crate = document.createElement('span');
      crate.className = 'staging-box__crate';
      pile.appendChild(crate);
    }
    if (groundCount > crateCount) {
      const more = document.createElement('span');
      more.className = 'staging-box__more';
      more.textContent = `+${formatNumber(groundCount - crateCount)}`;
      pile.appendChild(more);
    }
    card.appendChild(pile);

    stagingBoxes.appendChild(card);
  });
}

function renderUnplacedShelf(drafts, statsMap) {
  if (!unplacedPanel || !unplacedShelf || !unplacedTotal) {
    return;
  }

  const map = statsMap instanceof Map ? statsMap : new Map();

  const entries = drafts
    .map((draft) => {
      const stats = map.get(draft.index);
      if (!stats || (stats.unplaced ?? 0) <= 0) {
        return null;
      }

      return {
        label: stats.label || draft.label,
        dimensions: formatDraftDimensions(stats.dimensions || draft),
        unplaced: stats.unplaced ?? 0,
      };
    })
    .filter((entry) => entry !== null);

  const totalUnplaced = entries.reduce((sum, entry) => sum + entry.unplaced, 0);

  if (totalUnplaced <= 0) {
    unplacedPanel.hidden = true;
    unplacedShelf.innerHTML = '';
    unplacedTotal.textContent = 'Totale: 0 pezzi';
    return;
  }

  unplacedPanel.hidden = false;
  unplacedTotal.textContent = `Totale: ${formatNumber(totalUnplaced)} pezzi`;
  unplacedShelf.innerHTML = '';

  entries.forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'unplaced-box';

    const label = document.createElement('span');
    label.className = 'unplaced-box__label';
    label.textContent = entry.label;
    item.appendChild(label);

    if (entry.dimensions) {
      const dims = document.createElement('span');
      dims.className = 'unplaced-box__dims';
      dims.textContent = entry.dimensions;
      item.appendChild(dims);
    }

    const count = document.createElement('span');
    count.className = 'unplaced-box__count';
    count.textContent = `${formatNumber(entry.unplaced)} pezzi fuori pallet`;
    item.appendChild(count);

    const stack = document.createElement('div');
    stack.className = 'unplaced-box__stack';
    const crateCount = Math.min(10, Math.max(0, Math.round(entry.unplaced)));
    for (let index = 0; index < crateCount; index += 1) {
      const cube = document.createElement('span');
      cube.className = 'unplaced-box__crate';
      stack.appendChild(cube);
    }
    if (entry.unplaced > crateCount) {
      const more = document.createElement('span');
      more.className = 'unplaced-box__more';
      more.textContent = `+${formatNumber(entry.unplaced - crateCount)}`;
      stack.appendChild(more);
    }

    item.appendChild(stack);
    unplacedShelf.appendChild(item);
  });
}

function buildGroundStatsFromSolution(solution) {
  if (!solution || !Array.isArray(solution.results)) {
    return new Map();
  }

  const map = new Map();
  solution.results.forEach((entry) => {
    const sourceIndex = entry?.meta?.sourceIndex ?? entry?.box?.sourceIndex;
    if (typeof sourceIndex !== 'number' || Number.isNaN(sourceIndex)) {
      return;
    }

    const metrics = entry.metrics || {};
    const box = entry.box || {};

    map.set(sourceIndex, {
      label: entry.meta?.displayName || `Box ${sourceIndex + 1}`,
      requested: typeof metrics.quantityRequested === 'number' && metrics.quantityRequested >= 0
        ? metrics.quantityRequested
        : null,
      placed: metrics.totalBoxes ?? 0,
      unplaced: metrics.quantityShortfall ?? 0,
      dimensions: {
        length: box.length ?? null,
        width: box.width ?? null,
        height: box.height ?? null,
      },
    });
  });

  return map;
}

function cloneGroundStats(source) {
  if (!(source instanceof Map)) {
    return new Map();
  }

  const clone = new Map();
  source.forEach((value, key) => {
    clone.set(key, value ? { ...value, dimensions: value.dimensions ? { ...value.dimensions } : value.dimensions } : value);
  });
  return clone;
}

function buildGroundStatsForSelection(entry, baseStats) {
  const base = cloneGroundStats(baseStats);
  if (!entry) {
    return base;
  }

  const applyUpdate = (sourceIndex, data) => {
    if (typeof sourceIndex !== 'number' || Number.isNaN(sourceIndex)) {
      return;
    }

    const existing = base.get(sourceIndex) || {};
    const existingDimensions = existing.dimensions || {};
    const mergedDimensions = {
      length: data.dimensions?.length ?? existingDimensions.length ?? null,
      width: data.dimensions?.width ?? existingDimensions.width ?? null,
      height: data.dimensions?.height ?? existingDimensions.height ?? null,
    };

    const requested = data.hasRequested
      ? data.requestedTotal
      : typeof existing.requested === 'number'
        ? existing.requested
        : null;

    base.set(sourceIndex, {
      label: data.label || existing.label || `Box ${sourceIndex + 1}`,
      requested,
      placed: data.placed ?? existing.placed ?? 0,
      unplaced: data.shortfall ?? existing.unplaced ?? 0,
      dimensions: mergedDimensions,
    });
  };

  if (entry.meta?.combined && Array.isArray(entry.metrics?.segments)) {
    const aggregated = new Map();

    entry.metrics.segments.forEach((segment) => {
      const sourceIndex = segment?.sourceIndex;
      if (typeof sourceIndex !== 'number' || Number.isNaN(sourceIndex)) {
        return;
      }

      const current = aggregated.get(sourceIndex) || {
        placed: 0,
        shortfall: 0,
        requestedTotal: 0,
        hasRequested: false,
        label: null,
        dimensions: { length: null, width: null, height: null },
      };

      current.placed += segment.totalBoxes ?? 0;
      current.shortfall += segment.quantityShortfall ?? 0;

      if (typeof segment.quantityRequested === 'number') {
        current.requestedTotal += segment.quantityRequested;
        current.hasRequested = true;
      }

      if (!current.label && segment.label) {
        current.label = segment.label;
      }

      current.dimensions = {
        length: segment.boxLength ?? current.dimensions.length,
        width: segment.boxWidth ?? current.dimensions.width,
        height: segment.boxHeight ?? current.dimensions.height,
      };

      aggregated.set(sourceIndex, current);
    });

    aggregated.forEach((data, sourceIndex) => {
      applyUpdate(sourceIndex, data);
    });

    return base;
  }

  const sourceIndex = entry?.meta?.sourceIndex ?? entry?.box?.sourceIndex;
  if (typeof sourceIndex === 'number' && !Number.isNaN(sourceIndex)) {
    applyUpdate(sourceIndex, {
      placed: entry.metrics?.totalBoxes ?? 0,
      shortfall: entry.metrics?.quantityShortfall ?? 0,
      requestedTotal: entry.metrics?.quantityRequested ?? 0,
      hasRequested: typeof entry.metrics?.quantityRequested === 'number',
      label: entry.meta?.displayName || entry.box?.label || `Box ${sourceIndex + 1}`,
      dimensions: {
        length: entry.box?.length ?? null,
        width: entry.box?.width ?? null,
        height: entry.box?.height ?? null,
      },
    });
  }

  return base;
}

function downloadTemplateWorkbook() {
  const bytes = base64ToUint8Array(templateWorkbookBase64);
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'stack-solver-box-template.xlsx';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function base64ToUint8Array(base64) {
  const normalized = base64.replace(/\s+/g, '');
  const binaryString = atob(normalized);
  const bytes = new Uint8Array(binaryString.length);
  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }
  return bytes;
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
  selectedSolutionIndices = new Set();
  resultsPanel.hidden = false;
  layoutPanel.hidden = true;
  summary.innerHTML = `<span class="error">${message}</span>`;
  metricsContainer.innerHTML = '';
  solutionTabs.hidden = true;
  solutionTabs.innerHTML = '';
  legend.innerHTML = '';
  lastVisualEntry = null;
  refreshTopView();
  if (toggle3dViewButton) {
    toggle3dViewButton.disabled = true;
  }
  const placeholder = threeViewVisible
    ? '3D preview unavailable until a valid layout is generated.'
    : '3D view hidden. Toggle to show the preview.';
  setViewerPlaceholder(placeholder);
  viewer3d.hidden = !threeViewVisible;
  updateBoxRowStatuses(currentSolutionSet);
  baseGroundStats = new Map();
  currentGroundStats = new Map();
  updateGroundDraft();
}

function renderResult(rawResult) {
  const solution = normaliseSolution(rawResult);
  currentSolutionSet = solution;
  selectedSolutionIndices = new Set([0]);

  baseGroundStats = buildGroundStatsFromSolution(solution);
  currentGroundStats = cloneGroundStats(baseGroundStats);
  updateGroundDraft();

  resultsPanel.hidden = false;
  summary.innerHTML = buildSummaryText(solution);

  renderTabs(solution);
  renderSelectedSolution();
  updateBoxRowStatuses(solution);
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

  parts.push('Select one or more box types below to inspect or combine their layouts.');
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
    button.setAttribute('aria-pressed', selectedSolutionIndices.has(index) ? 'true' : 'false');
    button.addEventListener('click', (event) => {
      toggleSolutionSelection(index, event);
    });
    solutionTabs.appendChild(button);
  });
}

function toggleSolutionSelection(index, event) {
  if (!currentSolutionSet) {
    return;
  }

  const next = new Set(selectedSolutionIndices);
  const exclusive = event?.altKey || (event?.detail ?? 1) > 1;

  if (exclusive) {
    next.clear();
    next.add(index);
  } else if (next.has(index)) {
    if (next.size === 1) {
      return;
    }
    next.delete(index);
  } else {
    next.add(index);
  }

  if (!next.size) {
    next.add(index);
  }

  selectedSolutionIndices = next;
  updateTabSelection();
  renderSelectedSolution();
}

function updateTabSelection() {
  const buttons = solutionTabs.querySelectorAll('button');
  buttons.forEach((button, index) => {
    const pressed = selectedSolutionIndices.has(index);
    button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    button.classList.toggle('is-selected', pressed);
  });
}

function renderSelectedSolution() {
  if (!currentSolutionSet || !currentSolutionSet.results.length) {
    renderError('No layout data available.');
    return;
  }

  if (!selectedSolutionIndices.size) {
    selectedSolutionIndices.add(0);
  }

  const orderedIndices = Array.from(selectedSolutionIndices).sort((a, b) => a - b);
  const selectedEntries = orderedIndices
    .map((index) => currentSolutionSet.results[index])
    .filter(Boolean);

  if (!selectedEntries.length) {
    selectedEntries.push(currentSolutionSet.results[0]);
    selectedSolutionIndices = new Set([0]);
  }

  let entry;
  try {
    entry = selectedEntries.length === 1
      ? selectedEntries[0]
      : combineSolutions(selectedEntries, currentSolutionSet.pallet);
  } catch (error) {
    metricsContainer.innerHTML = `<p class="error">${error.message}</p>`;
    layoutPanel.hidden = true;
    legend.innerHTML = '';
    lastVisualEntry = null;
    refreshTopView();
    if (toggle3dViewButton) {
      toggle3dViewButton.disabled = true;
    }
    setViewerPlaceholder('Unable to display the combined layout for the current selection.');
    viewer3d.hidden = !threeViewVisible;
    currentGroundStats = cloneGroundStats(baseGroundStats);
    updateGroundDraft();
    return;
  }

  updateTabSelection();
  currentGroundStats = buildGroundStatsForSelection(entry, baseGroundStats);
  updateGroundDraft();
  renderMetrics(entry);
  renderVisuals(entry);
}

function renderMetrics(entry) {
  const metrics = entry.metrics || {};
  const rows = [];

  if (entry.meta?.combined) {
    rows.push({ label: 'Combined selection', value: `${formatNumber(metrics.layoutCount ?? 0)} box type${(metrics.layoutCount ?? 0) === 1 ? '' : 's'}` });
    if (entry.meta?.displayName) {
      rows.push({ label: 'Label', value: entry.meta.displayName });
    }
    if (typeof metrics.quantityRequested === 'number' && metrics.quantityRequested > 0) {
      rows.push({ label: 'Total quantity requested', value: formatNumber(metrics.quantityRequested) });
    }
    if (metrics.quantityShortfall > 0) {
      rows.push({
        label: 'Total unplaced quantity',
        value: formatNumber(metrics.quantityShortfall),
        modifier: 'metric--danger',
      });
    }
    rows.push({ label: 'Orientation', value: `${orientationDescription(entry)} (base layout)` });
    rows.push({ label: 'Total boxes placed', value: formatNumber(metrics.totalBoxes) });
    rows.push({ label: 'Total stack height', value: `${formatNumber(metrics.totalHeight)} cm` });
    rows.push({ label: 'Combined load weight', value: `${formatNumber(metrics.loadWeight)} kg` });
    rows.push({ label: 'Combined weight incl. pallet', value: `${formatNumber(metrics.totalWeight)} kg` });
    rows.push({ label: 'Max cargo footprint', value: `${formatNumber(metrics.cargoLength)} × ${formatNumber(metrics.cargoWidth)} cm` });
    if (typeof metrics.offsetX === 'number' && typeof metrics.offsetY === 'number') {
      rows.push({ label: 'Bottom layout offsets (x, y)', value: `${formatNumber(metrics.offsetX)} cm, ${formatNumber(metrics.offsetY)} cm` });
    }
    rows.push({ label: 'Best level efficiency', value: `${metrics.efficiency.toFixed(2)} %` });
    if (metrics.unusedArea > 0) {
      rows.push({ label: 'Unused area on best level', value: `${formatNumber(metrics.unusedArea)} cm²` });
    }
    rows.push({
      label: 'Stack strategy',
      value: 'Sorted by box weight so heavier segments are placed closer to the pallet base.',
    });

    if (Array.isArray(metrics.segments)) {
      metrics.segments.forEach((segment, index) => {
        const parts = [
          `${formatNumber(segment.totalBoxes)} boxes`,
          `load ${formatNumber(segment.loadWeight)} kg`,
          `height ${formatNumber(segment.startHeight)}–${formatNumber(segment.endHeight)} cm`,
        ];

        if (typeof segment.quantityRequested === 'number' && segment.quantityRequested > 0) {
          const shortfall = segment.quantityShortfall || 0;
          const fulfilled = segment.totalBoxes;
          const requested = segment.quantityRequested;
          let fulfilment = `${formatNumber(fulfilled)} of ${formatNumber(requested)} fulfilled`;
          if (shortfall > 0) {
            fulfilment += ` (${formatNumber(shortfall)} unplaced)`;
          }
          parts.push(fulfilment);
        }

        rows.push({
          label: segment.label || `Segment ${index + 1}`,
          value: parts.join(' • '),
          swatchColor: entry.meta?.segmentColors?.[index] || segment.color,
        });
      });
    }
  } else {
    if (entry.meta?.displayName) {
      rows.push({ label: 'Box type', value: entry.meta.displayName });
    }

    if (typeof metrics.quantityRequested === 'number') {
      rows.push({ label: 'Quantity requested', value: formatNumber(metrics.quantityRequested) });
    }

    if (metrics.quantityShortfall > 0) {
      rows.push({
        label: 'Unplaced quantity',
        value: formatNumber(metrics.quantityShortfall),
        modifier: 'metric--danger',
      });
    }

    rows.push({ label: 'Orientation', value: orientationDescription(entry) });
    rows.push({ label: 'Boxes per full level', value: formatNumber(metrics.boxesPerLevel) });
    rows.push({ label: 'Full levels', value: formatNumber(metrics.fullLevels) });
    rows.push({ label: 'Levels used', value: formatNumber(metrics.levels) });
    rows.push({ label: 'Boxes on final level', value: formatNumber(metrics.lastLevelBoxes) });
    rows.push({ label: 'Total boxes placed', value: formatNumber(metrics.totalBoxes) });
    rows.push({ label: 'Cargo footprint', value: `${formatNumber(metrics.cargoLength)} × ${formatNumber(metrics.cargoWidth)} cm` });
    rows.push({ label: 'Offsets (x, y)', value: `${formatNumber(metrics.offsetX)} cm, ${formatNumber(metrics.offsetY)} cm` });
    rows.push({ label: 'Total height', value: `${formatNumber(metrics.totalHeight)} cm` });
    rows.push({ label: 'Occupied area', value: `${formatNumber(metrics.areaOccupied)} cm²` });
    rows.push({ label: 'Unused area', value: `${formatNumber(metrics.unusedArea)} cm²` });
    rows.push({ label: 'Efficiency', value: `${metrics.efficiency.toFixed(2)} %` });
    rows.push({ label: 'Load weight', value: `${formatNumber(metrics.loadWeight)} kg` });
    rows.push({ label: 'Combined weight', value: `${formatNumber(metrics.totalWeight)} kg` });
  }

  metricsContainer.innerHTML = '';
  rows.forEach((row) => {
    if (!row || typeof row.label !== 'string') {
      return;
    }
    const fragment = metricTemplate.content.cloneNode(true);
    const metricElement = fragment.querySelector('.metric');
    const dt = fragment.querySelector('dt');
    const dd = fragment.querySelector('dd');
    dt.textContent = row.label;

    if (row.modifier) {
      metricElement.classList.add(row.modifier);
    }

    if (row.swatchColor) {
      metricElement.classList.add('metric--with-swatch');
      dd.innerHTML = '';
      const swatch = document.createElement('span');
      swatch.className = 'metric__swatch';
      swatch.style.backgroundColor = row.swatchColor;
      dd.appendChild(swatch);
      const text = document.createElement('span');
      text.className = 'metric__value-text';
      text.textContent = row.value ?? '';
      dd.appendChild(text);
    } else {
      dd.textContent = row.value ?? '';
    }

    metricsContainer.appendChild(fragment);
  });
}

function orientationDescription(entry) {
  return entry.orientation === 'length-first'
    ? 'Length first (align to pallet length)'
    : 'Width first (rotate pallet)';
}

function renderVisuals(entry) {
  const hasLayout = Array.isArray(entry?.layout) && entry.layout.length > 0;

  if (!hasLayout) {
    lastVisualEntry = null;
    layoutPanel.hidden = true;
    refreshTopView();
    refresh3D();
    return;
  }

  lastVisualEntry = entry;
  layoutPanel.hidden = false;
  updateLegend(entry);
  refreshTopView();
  refresh3D();
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '0';
  }
  return number.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

function updateLegend(entry) {
  legend.innerHTML = '';

  if (!entry) {
    return;
  }

  if (entry.meta?.combined && Array.isArray(entry.metrics?.segments)) {
    entry.metrics.segments.forEach((segment, index) => {
      const span = document.createElement('span');
      const color = entry.meta?.segmentColors?.[index] || segment.color || colors.lengthwise;
      const labelText = segment.label || `Segment ${index + 1}`;
      span.textContent = `${labelText} (${formatNumber(segment.totalBoxes)} boxes)`;
      span.style.color = color;
      legend.appendChild(span);
    });
    return;
  }

  const arrangement = entry.arrangement;
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

function render3D(layout3d, pallet, metrics, meta = {}) {
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

  const segmentMaterials = Array.isArray(meta?.segmentColors) && meta.segmentColors.length
    ? meta.segmentColors.map((hex) => new THREE.MeshStandardMaterial({
      color: new THREE.Color(hex),
      transparent: true,
      opacity: 0.92,
    }))
    : null;

  for (const placement of layout3d) {
    const geometry = new THREE.BoxGeometry(placement.length, placement.height, placement.width);
    let material = orientationMaterials[placement.orientation] || orientationMaterials.lengthwise;
    if (meta?.combined && segmentMaterials && typeof placement.segmentIndex === 'number') {
      const customMaterial = segmentMaterials[placement.segmentIndex % segmentMaterials.length];
      if (customMaterial) {
        material = customMaterial;
      }
    }
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

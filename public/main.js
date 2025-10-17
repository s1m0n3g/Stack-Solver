const form = document.getElementById('stack-form');
const resultsPanel = document.getElementById('results-panel');
const summary = document.getElementById('result-summary');
const metricsContainer = document.getElementById('result-metrics');
const layoutPanel = document.getElementById('layout-panel');
const canvas = document.getElementById('layout-canvas');
const legend = document.getElementById('layout-legend');
const metricTemplate = document.getElementById('metric-template');

const colors = {
  lengthwise: '#1f6feb',
  widthwise: '#d83b7d',
};

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = buildPayload(new FormData(form));

  try {
    const response = await fetch('/api/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    if (!result.ok) {
      throw new Error(result.error || 'Unknown error.');
    }

    renderResult(result.data);
  } catch (error) {
    renderError(error.message);
  }
});

function buildPayload(formData) {
  const payload = { pallet: {}, box: {} };
  for (const [key, value] of formData.entries()) {
    const [section, field] = key.split('.');
    payload[section][field] = value;
  }
  return payload;
}

function renderError(message) {
  resultsPanel.hidden = false;
  layoutPanel.hidden = true;
  summary.innerHTML = `<span class="error">${message}</span>`;
  metricsContainer.innerHTML = '';
}

function renderResult(data) {
  const { pallet, box, metrics, orientation, arrangement, layout } = data;

  resultsPanel.hidden = false;
  layoutPanel.hidden = layout.length === 0;

  const orientationLabel = orientation === 'length-first'
    ? 'Align boxes with pallet length first'
    : 'Rotate pallet: best fit aligns with width first';

  summary.innerHTML = `
    <strong>${metrics.totalBoxes}</strong> boxes arranged across
    <strong>${metrics.levels}</strong> level${metrics.levels === 1 ? '' : 's'}.
    Strategy: ${orientationLabel}.
  `;

  const metricMap = new Map([
    ['Boxes / level', metrics.boxesPerLevel],
    ['Total levels', metrics.levels],
    ['Total boxes', metrics.totalBoxes],
    ['Cargo footprint', `${formatNumber(metrics.cargoLength)} × ${formatNumber(metrics.cargoWidth)} cm`],
    ['Offsets (x, y)', `${formatNumber(metrics.offsetX)} cm, ${formatNumber(metrics.offsetY)} cm`],
    ['Total height', `${formatNumber(metrics.totalHeight)} cm`],
    ['Occupied area', `${formatNumber(metrics.areaOccupied)} cm²`],
    ['Unused area', `${formatNumber(metrics.unusedArea)} cm²`],
    ['Efficiency', `${metrics.efficiency.toFixed(2)} %`],
    ['Load weight', `${formatNumber(metrics.loadWeight)} kg`],
    ['Combined weight', `${formatNumber(metrics.totalWeight)} kg`],
  ]);

  metricsContainer.innerHTML = '';
  for (const [label, value] of metricMap.entries()) {
    const fragment = metricTemplate.content.cloneNode(true);
    fragment.querySelector('dt').textContent = label;
    fragment.querySelector('dd').textContent = value;
    metricsContainer.appendChild(fragment);
  }

  if (!layout.length) {
    return;
  }

  drawLayout(canvas, layout, pallet, metrics);
  updateLegend(arrangement);
}

function formatNumber(value) {
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

function updateLegend(arrangement) {
  legend.innerHTML = '';
  const entries = [
    { label: `Lengthwise (${arrangement.orientation1Columns} columns)`, color: colors.lengthwise },
    { label: `Widthwise (${arrangement.orientation2Columns} columns)`, color: colors.widthwise },
  ];

  for (const entry of entries) {
    const span = document.createElement('span');
    span.textContent = entry.label;
    span.style.color = entry.color;
    legend.appendChild(span);
  }
}

function drawLayout(canvas, layout, pallet, metrics) {
  const ctx = canvas.getContext('2d');
  const padding = 30;
  const scaleX = (canvas.width - padding * 2) / pallet.orientedLength;
  const scaleY = (canvas.height - padding * 2) / pallet.orientedWidth;
  const scale = Math.min(scaleX, scaleY);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate((canvas.width - pallet.orientedLength * scale) / 2, (canvas.height - pallet.orientedWidth * scale) / 2);

  // Draw pallet outline
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
    ctx.fillStyle = colors[box.orientation];
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x, y, box.length * scale, box.width * scale);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.strokeRect(x, y, box.length * scale, box.width * scale);
  }

  ctx.restore();
}

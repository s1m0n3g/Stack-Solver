import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js';

const form = document.getElementById('stack-form');
const resultsPanel = document.getElementById('results-panel');
const summary = document.getElementById('result-summary');
const metricsContainer = document.getElementById('result-metrics');
const layoutPanel = document.getElementById('layout-panel');
const canvas = document.getElementById('layout-canvas');
const legend = document.getElementById('layout-legend');
const viewer3d = document.getElementById('viewer3d');
const metricTemplate = document.getElementById('metric-template');

const colors = {
  lengthwise: '#1f6feb',
  widthwise: '#d83b7d',
};

let threeState = null;
setViewerPlaceholder('The interactive 3D preview will appear once a valid layout is generated.');

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
  setViewerPlaceholder('3D preview unavailable until a valid layout is generated.');
}

function renderResult(data) {
  const { pallet, box, metrics, orientation, arrangement, layout, layout3d } = data;

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
    setViewerPlaceholder('3D preview unavailable until a valid layout is generated.');
    return;
  }

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

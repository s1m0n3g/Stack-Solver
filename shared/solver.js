const requiredPalletFields = ['length', 'width', 'height', 'maxHeight', 'weight', 'maxWeight'];
const requiredBoxFields = ['length', 'width', 'height', 'weight'];

function describeBox(index, label) {
  return label ? `Box "${label}"` : `Box type ${index + 1}`;
}

function toNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Field "${fieldName}" must be a valid number.`);
  }
  return number;
}

function normaliseInputSection(section, fields, sectionName) {
  if (!section || typeof section !== 'object') {
    throw new Error(`${sectionName} details are required.`);
  }
  const result = {};
  for (const field of fields) {
    if (!(field in section)) {
      throw new Error(`${sectionName} is missing the "${field}" field.`);
    }
    result[field] = toNumber(section[field], `${sectionName}.${field}`);
    if (result[field] < 0) {
      throw new Error(`${sectionName}.${field} must be zero or a positive number.`);
    }
  }
  return result;
}

function normaliseBoxEntry(entry, index) {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`${describeBox(index, '')} is not a valid object.`);
  }

  const base = normaliseInputSection(entry, requiredBoxFields, `boxes[${index}]`);
  const label = typeof entry.label === 'string' ? entry.label.trim() : '';

  let quantity = null;
  if ('quantity' in entry && entry.quantity !== undefined && entry.quantity !== null && entry.quantity !== '') {
    const quantityValue = toNumber(entry.quantity, `${describeBox(index, label)} quantity`);
    if (quantityValue < 0) {
      throw new Error(`${describeBox(index, label)} quantity cannot be negative.`);
    }
    if (quantityValue > 0) {
      quantity = Math.floor(quantityValue);
    }
  }

  return {
    ...base,
    label,
    quantity,
    sourceIndex: index,
  };
}

function createBoxDisplayName(box, label) {
  if (label) {
    return label;
  }
  return `${box.length}×${box.width}×${box.height} cm`;
}

function measureLayout(layout) {
  let maxX = 0;
  let maxY = 0;
  let area = 0;
  for (const placement of layout) {
    maxX = Math.max(maxX, placement.x + placement.length);
    maxY = Math.max(maxY, placement.y + placement.width);
    area += placement.length * placement.width;
  }
  return { length: maxX, width: maxY, area };
}

function offsetLayout(layout, offsetX, offsetY) {
  return layout.map((placement) => ({
    ...placement,
    x: placement.x + offsetX,
    y: placement.y + offsetY,
  }));
}

function validateDimensions(pallet, box) {
  const fields = [
    ['length', 'Pallet length'],
    ['width', 'Pallet width'],
    ['height', 'Pallet height'],
    ['maxHeight', 'Pallet maxHeight'],
  ];
  for (const [key, label] of fields) {
    if (pallet[key] <= 0) {
      throw new Error(`${label} must be greater than zero.`);
    }
  }

  const boxFields = [
    ['length', 'Box length'],
    ['width', 'Box width'],
    ['height', 'Box height'],
  ];
  for (const [key, label] of boxFields) {
    if (box[key] <= 0) {
      throw new Error(`${label} must be greater than zero.`);
    }
  }

  if (box.height + pallet.height > pallet.maxHeight) {
    throw new Error('Cargo exceeds allowed height for the pallet.');
  }

  if (Math.max(box.length, box.width) > Math.max(pallet.length, pallet.width)) {
    throw new Error('Box footprint is larger than the pallet.');
  }
}

function calculateOrientation(palletLen, palletWidth, boxLength, boxWidth) {
  const maxBoxesLength = Math.floor(palletLen / boxLength);
  const maxBoxesWidth1 = Math.floor(palletWidth / boxLength);
  const maxBoxesWidth2 = Math.floor(palletWidth / boxWidth);
  const boxArea = boxLength * boxWidth;

  let best = null;
  for (let nrb = maxBoxesLength; nrb >= 0; nrb--) {
    const diff = palletLen - nrb * boxLength;
    const extraColumns = Math.floor(diff / boxWidth);
    const nrBoxesOrientation2 = extraColumns * maxBoxesWidth1;
    const nrBoxesOrientation1 = nrb * maxBoxesWidth2;
    const cargoArea = boxArea * (nrBoxesOrientation1 + nrBoxesOrientation2);

    if (!best || cargoArea > best.cargoArea) {
      best = {
        cargoArea,
        nrBoxesOrientation1,
        nrBoxesOrientation2,
        nrb,
        extraColumns,
        maxBoxesLength,
        maxBoxesWidth1,
        maxBoxesWidth2,
        palletLen,
        palletWidth,
        boxLength,
        boxWidth,
      };
    }
  }

  return best || {
    cargoArea: 0,
    nrBoxesOrientation1: 0,
    nrBoxesOrientation2: 0,
    nrb: 0,
    extraColumns: 0,
    maxBoxesLength,
    maxBoxesWidth1,
    maxBoxesWidth2,
    palletLen,
    palletWidth,
    boxLength,
    boxWidth,
  };
}

function calculateLevels(pallet, box, boxesPerLevel) {
  if (boxesPerLevel === 0) {
    return 0;
  }

  const heightAllowance = pallet.maxHeight - pallet.height;
  const maxLevelsByHeight = Math.floor(heightAllowance / box.height);
  if (maxLevelsByHeight <= 0) {
    return 0;
  }

  if (!pallet.maxWeight) {
    return maxLevelsByHeight;
  }

  const weightAllowance = pallet.maxWeight - pallet.weight;
  if (weightAllowance < 0) {
    return 0;
  }

  const maxLevelsByWeight = Math.floor(weightAllowance / (boxesPerLevel * box.weight));
  if (maxLevelsByWeight <= 0) {
    return 0;
  }

  return Math.min(maxLevelsByHeight, maxLevelsByWeight);
}

function buildLayout(config, box, limit = Infinity) {
  const layout = [];
  const { nrBoxesOrientation1, nrBoxesOrientation2, maxBoxesWidth1, maxBoxesWidth2, nrb, extraColumns } = config;
  let remaining = Number.isFinite(limit) ? limit : Infinity;

  if (nrBoxesOrientation1 > 0 && maxBoxesWidth2 > 0) {
    for (let i = 0; i < nrb && remaining > 0; i++) {
      for (let j = 0; j < maxBoxesWidth2 && remaining > 0; j++) {
        layout.push({
          x: i * box.length,
          y: j * box.width,
          length: box.length,
          width: box.width,
          orientation: 'lengthwise',
        });
        remaining -= 1;
      }
    }
  }

  if (remaining > 0 && nrBoxesOrientation2 > 0 && maxBoxesWidth1 > 0) {
    const startX = nrb * box.length;
    for (let i = 0; i < extraColumns && remaining > 0; i++) {
      for (let j = 0; j < maxBoxesWidth1 && remaining > 0; j++) {
        layout.push({
          x: startX + i * box.width,
          y: j * box.length,
          length: box.width,
          width: box.length,
          orientation: 'widthwise',
        });
        remaining -= 1;
      }
    }
  }

  return layout;
}

function buildStack(layout, levels, box, pallet, totalBoxes) {
  const stack = [];
  const baseHeight = pallet.height;
  let remaining = totalBoxes;

  for (let level = 0; level < levels; level++) {
    const z = baseHeight + level * box.height;
    for (const placement of layout) {
      if (remaining <= 0) {
        return stack;
      }
      stack.push({
        ...placement,
        level,
        z,
        height: box.height,
      });
      remaining -= 1;
    }
  }
  return stack;
}

function formatResult(config, pallet, box, orientation, extras = {}) {
  const boxesPerLevel = config.nrBoxesOrientation1 + config.nrBoxesOrientation2;
  if (boxesPerLevel === 0) {
    throw new Error('No boxes fit on the pallet with the provided dimensions.');
  }

  const nrLevels = calculateLevels(pallet, box, boxesPerLevel);
  if (nrLevels === 0) {
    throw new Error('No stack levels can be placed on the pallet with the provided limits.');
  }

  const quantityValue = typeof extras.quantity === 'number'
    ? extras.quantity
    : typeof box.quantity === 'number'
      ? box.quantity
      : null;

  let quantityRequested = null;
  let targetBoxes = boxesPerLevel * nrLevels;
  if (quantityValue !== null) {
    if (quantityValue <= 0) {
      throw new Error(`${describeBox(extras.sourceIndex ?? box.sourceIndex ?? 0, extras.label ?? box.label)} quantity must be greater than zero.`);
    }
    quantityRequested = Math.floor(quantityValue);
    targetBoxes = Math.min(targetBoxes, quantityRequested);
  }

  if (targetBoxes <= 0) {
    throw new Error('No boxes fit on the pallet with the provided dimensions.');
  }

  const fullLevels = Math.floor(targetBoxes / boxesPerLevel);
  const remainderBoxes = targetBoxes - fullLevels * boxesPerLevel;
  const levels = remainderBoxes > 0 ? fullLevels + 1 : fullLevels;
  const lastLevelBoxes = remainderBoxes > 0 ? remainderBoxes : boxesPerLevel;
  const perLevelLimit = Math.min(boxesPerLevel, targetBoxes);
  const baseLayout = buildLayout(config, box, perLevelLimit);

  if (!baseLayout.length) {
    throw new Error('No boxes fit on the pallet with the provided dimensions.');
  }

  const palletLenUsed = orientation === 1 ? pallet.length : pallet.width;
  const palletWidthUsed = orientation === 1 ? pallet.width : pallet.length;
  const bounds = measureLayout(baseLayout);
  const offsetX = (palletLenUsed - bounds.length) / 2;
  const offsetY = (palletWidthUsed - bounds.width) / 2;
  const layout = offsetLayout(baseLayout, offsetX, offsetY);

  const totalHeight = pallet.height + levels * box.height;
  const areaTotal = palletLenUsed * palletWidthUsed;
  const areaOccupied = bounds.area;
  const efficiency = areaTotal === 0 ? 0 : (areaOccupied / areaTotal) * 100;
  const unusedArea = Math.max(areaTotal - areaOccupied, 0);
  const loadWeight = targetBoxes * box.weight;
  const totalWeight = loadWeight + pallet.weight;
  const layout3d = buildStack(layout, levels, box, pallet, targetBoxes);
  const quantityShortfall = quantityRequested === null ? 0 : Math.max(0, quantityRequested - targetBoxes);
  const label = extras.label ?? box.label ?? '';
  const displayName = createBoxDisplayName(box, label);

  return {
    pallet: {
      ...pallet,
      orientedLength: palletLenUsed,
      orientedWidth: palletWidthUsed,
    },
    box: {
      length: box.length,
      width: box.width,
      height: box.height,
      weight: box.weight,
      label,
      quantity: quantityRequested,
    },
    orientation: orientation === 1 ? 'length-first' : 'width-first',
    metrics: {
      boxesPerLevel,
      levels,
      fullLevels,
      lastLevelBoxes,
      cargoLength: bounds.length,
      cargoWidth: bounds.width,
      offsetX,
      offsetY,
      totalHeight,
      areaTotal,
      areaOccupied,
      efficiency,
      unusedArea,
      loadWeight,
      totalWeight,
      totalBoxes: targetBoxes,
      quantityRequested,
      quantityShortfall,
    },
    arrangement: {
      orientation1Columns: config.nrb,
      orientation1PerColumn: config.maxBoxesWidth2,
      orientation2Columns: config.extraColumns,
      orientation2PerColumn: config.maxBoxesWidth1,
    },
    layout,
    layout3d,
    meta: {
      displayName,
      sourceIndex: extras.sourceIndex ?? box.sourceIndex ?? 0,
    },
  };
}

function buildSolutionsSummary(results, pallet) {
  const totalBoxes = results.reduce((sum, entry) => sum + (entry.metrics.totalBoxes || 0), 0);
  const totalLoadWeight = results.reduce((sum, entry) => sum + (entry.metrics.loadWeight || 0), 0);
  const totalWeight = totalLoadWeight + (pallet.weight || 0);
  const maxHeight = results.reduce((max, entry) => Math.max(max, entry.metrics.totalHeight || 0), pallet.height || 0);
  const unplacedBoxes = results.reduce((sum, entry) => sum + (entry.metrics.quantityShortfall || 0), 0);

  return {
    totalBoxes,
    totalLayouts: results.length,
    totalLoadWeight,
    totalWeight,
    maxHeight,
    unplacedBoxes,
  };
}

export function solveStacking(payload) {
  const pallet = normaliseInputSection(payload.pallet, requiredPalletFields, 'pallet');

  if (Array.isArray(payload.boxes)) {
    if (payload.boxes.length === 0) {
      throw new Error('At least one box type is required.');
    }

    const boxes = payload.boxes.map((entry, index) => normaliseBoxEntry(entry, index));
    const results = boxes.map((box) => {
      validateDimensions(pallet, box);
      const orientation1 = calculateOrientation(pallet.length, pallet.width, box.length, box.width);
      const orientation2 = calculateOrientation(pallet.width, pallet.length, box.length, box.width);
      const bestOrientation = orientation1.cargoArea >= orientation2.cargoArea
        ? { config: orientation1, orientation: 1 }
        : { config: orientation2, orientation: 2 };
      return formatResult(bestOrientation.config, pallet, box, bestOrientation.orientation, {
        label: box.label,
        quantity: box.quantity,
        sourceIndex: box.sourceIndex,
      });
    });

    const summary = buildSolutionsSummary(results, pallet);
    return {
      mode: results.length > 1 ? 'multi' : 'single',
      pallet,
      results,
      summary,
    };
  }

  const boxEntry = normaliseBoxEntry(payload.box || payload, 0);

  validateDimensions(pallet, boxEntry);

  const orientation1 = calculateOrientation(pallet.length, pallet.width, boxEntry.length, boxEntry.width);
  const orientation2 = calculateOrientation(pallet.width, pallet.length, boxEntry.length, boxEntry.width);

  const bestOrientation = orientation1.cargoArea >= orientation2.cargoArea
    ? { config: orientation1, orientation: 1 }
    : { config: orientation2, orientation: 2 };

  const result = formatResult(bestOrientation.config, pallet, boxEntry, bestOrientation.orientation, {
    label: boxEntry.label,
    quantity: boxEntry.quantity,
    sourceIndex: boxEntry.sourceIndex,
  });
  const summary = buildSolutionsSummary([result], pallet);

  return {
    ...result,
    mode: 'single',
    results: [result],
    summary,
  };
}

export function solveStackingDirect(pallet, boxOrBoxes) {
  if (Array.isArray(boxOrBoxes)) {
    return solveStacking({ pallet, boxes: boxOrBoxes });
  }
  return solveStacking({ pallet, box: boxOrBoxes });
}

export default solveStacking;

const requiredPalletFields = ['length', 'width', 'height', 'maxHeight', 'weight', 'maxWeight'];
const requiredBoxFields = ['length', 'width', 'height', 'weight'];

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

function computeCargoFootprint(config, box) {
  const { nrBoxesOrientation1, nrBoxesOrientation2, maxBoxesWidth1, maxBoxesWidth2, nrb, extraColumns } = config;

  let cargoLength = 0;
  if (nrBoxesOrientation1 > 0 && maxBoxesWidth2 > 0) {
    cargoLength += (nrb * box.length);
  }
  if (nrBoxesOrientation2 > 0 && maxBoxesWidth1 > 0) {
    cargoLength += (extraColumns * box.width);
  }

  let cargoWidth = 0;
  if (nrBoxesOrientation1 > 0) {
    cargoWidth = Math.max(cargoWidth, maxBoxesWidth2 * box.width);
  }
  if (nrBoxesOrientation2 > 0) {
    cargoWidth = Math.max(cargoWidth, maxBoxesWidth1 * box.length);
  }

  return { cargoLength, cargoWidth };
}

function buildLayout(config, box, offsets) {
  const layout = [];
  const { nrBoxesOrientation1, nrBoxesOrientation2, maxBoxesWidth1, maxBoxesWidth2, nrb, extraColumns } = config;
  const { offsetX, offsetY } = offsets;

  if (nrBoxesOrientation1 > 0 && maxBoxesWidth2 > 0) {
    for (let i = 0; i < nrb; i++) {
      for (let j = 0; j < maxBoxesWidth2; j++) {
        layout.push({
          x: offsetX + i * box.length,
          y: offsetY + j * box.width,
          length: box.length,
          width: box.width,
          orientation: 'lengthwise',
        });
      }
    }
  }

  if (nrBoxesOrientation2 > 0 && maxBoxesWidth1 > 0) {
    const startX = offsetX + nrb * box.length;
    for (let i = 0; i < extraColumns; i++) {
      for (let j = 0; j < maxBoxesWidth1; j++) {
        layout.push({
          x: startX + i * box.width,
          y: offsetY + j * box.length,
          length: box.width,
          width: box.length,
          orientation: 'widthwise',
        });
      }
    }
  }

  return layout;
}

function buildStack(layout, levels, box, pallet) {
  const stack = [];
  const baseHeight = pallet.height;
  for (let level = 0; level < levels; level++) {
    const z = baseHeight + level * box.height;
    for (const placement of layout) {
      stack.push({
        ...placement,
        level,
        z,
        height: box.height,
      });
    }
  }
  return stack;
}

function formatResult(config, pallet, box, orientation) {
  const boxesPerLevel = config.nrBoxesOrientation1 + config.nrBoxesOrientation2;
  if (boxesPerLevel === 0) {
    throw new Error('No boxes fit on the pallet with the provided dimensions.');
  }

  const nrLevels = calculateLevels(pallet, box, boxesPerLevel);
  if (nrLevels === 0) {
    throw new Error('No stack levels can be placed on the pallet with the provided limits.');
  }

  const palletLenUsed = orientation === 1 ? pallet.length : pallet.width;
  const palletWidthUsed = orientation === 1 ? pallet.width : pallet.length;

  const { cargoLength, cargoWidth } = computeCargoFootprint(config, box);
  const offsetX = (palletLenUsed - cargoLength) / 2;
  const offsetY = (palletWidthUsed - cargoWidth) / 2;

  const totalHeight = pallet.height + nrLevels * box.height;
  const areaTotal = palletLenUsed * palletWidthUsed;
  const areaOccupied = config.cargoArea;
  const efficiency = areaTotal === 0 ? 0 : (areaOccupied / areaTotal) * 100;
  const unusedArea = areaTotal - areaOccupied;
  const loadWeight = nrLevels * boxesPerLevel * box.weight;
  const totalWeight = loadWeight + pallet.weight;

  const layout = buildLayout(config, box, { offsetX, offsetY });
  const layout3d = buildStack(layout, nrLevels, box, pallet);

  return {
    pallet: {
      ...pallet,
      orientedLength: palletLenUsed,
      orientedWidth: palletWidthUsed,
    },
    box: { ...box },
    orientation: orientation === 1 ? 'length-first' : 'width-first',
    metrics: {
      boxesPerLevel,
      levels: nrLevels,
      cargoLength,
      cargoWidth,
      offsetX,
      offsetY,
      totalHeight,
      areaTotal,
      areaOccupied,
      efficiency,
      unusedArea,
      loadWeight,
      totalWeight,
      totalBoxes: nrLevels * boxesPerLevel,
    },
    arrangement: {
      orientation1Columns: config.nrb,
      orientation1PerColumn: config.maxBoxesWidth2,
      orientation2Columns: config.extraColumns,
      orientation2PerColumn: config.maxBoxesWidth1,
    },
    layout,
    layout3d,
  };
}

export function solveStacking(payload) {
  const pallet = normaliseInputSection(payload.pallet, requiredPalletFields, 'pallet');
  const box = normaliseInputSection(payload.box, requiredBoxFields, 'box');

  validateDimensions(pallet, box);

  const orientation1 = calculateOrientation(pallet.length, pallet.width, box.length, box.width);
  const orientation2 = calculateOrientation(pallet.width, pallet.length, box.length, box.width);

  const bestOrientation = orientation1.cargoArea >= orientation2.cargoArea
    ? { config: orientation1, orientation: 1 }
    : { config: orientation2, orientation: 2 };

  return formatResult(bestOrientation.config, pallet, box, bestOrientation.orientation);
}

export function solveStackingDirect(pallet, box) {
  return solveStacking({ pallet, box });
}

export default solveStacking;

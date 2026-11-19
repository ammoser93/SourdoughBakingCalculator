(() => {
  'use strict';

  // Minimal ISO/IEC 18004 QR Code encoder (Byte mode, Error Correction Level L, Versions 1-5)
  const VERSIONS = [
    { version: 1, size: 21, dataCw: 19, ecCw: 7, align: [] },
    { version: 2, size: 25, dataCw: 34, ecCw: 10, align: [6, 18] },
    { version: 3, size: 29, dataCw: 55, ecCw: 15, align: [6, 22] },
    { version: 4, size: 33, dataCw: 80, ecCw: 20, align: [6, 26] },
    { version: 5, size: 37, dataCw: 108, ecCw: 26, align: [6, 30] }
  ];

  // Format info strings for EC Level L (01) and masks 0..7 (pre-XORed with 0x5412)
  const FORMAT_BITS_L = [
    0x77c4, 0x72f3, 0x7daa, 0x789d,
    0x662f, 0x6318, 0x6c41, 0x6976
  ];

  // GF(256) lookup tables (primitive polynomial 0x11D)
  const GF_EXP = new Uint8Array(512);
  const GF_LOG = new Uint8Array(256);
  (() => {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) {
      GF_EXP[i] = GF_EXP[i - 255];
    }
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  function rsGeneratorPoly(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(poly.length + 1).fill(0);
      const factor = GF_EXP[i];
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], factor);
      }
      poly = next;
    }
    return poly;
  }

  function rsComputeEc(data, ecCount) {
    const gen = rsGeneratorPoly(ecCount);
    const rem = new Uint8Array(ecCount);
    for (let i = 0; i < data.length; i++) {
      const factor = data[i] ^ rem[0];
      for (let j = 0; j < ecCount - 1; j++) {
        rem[j] = rem[j + 1];
      }
      rem[ecCount - 1] = 0;
      if (factor !== 0) {
        for (let j = 0; j < ecCount; j++) {
          rem[j] ^= gfMul(gen[j + 1], factor);
        }
      }
    }
    return rem;
  }

  function toUtf8Bytes(text) {
    if (typeof TextEncoder !== 'undefined') {
      return Array.from(new TextEncoder().encode(text));
    }
    const bytes = [];
    for (let i = 0; i < text.length; i++) {
      bytes.push(text.charCodeAt(i) & 0xff);
    }
    return bytes;
  }

  function buildCodewords(bytes, spec) {
    const bits = [];
    const pushBits = (val, len) => {
      for (let i = len - 1; i >= 0; i--) {
        bits.push((val >>> i) & 1);
      }
    };

    // Byte mode (0100) + 8-bit length + payload
    pushBits(0x4, 4);
    pushBits(bytes.length, 8);
    for (let i = 0; i < bytes.length; i++) {
      pushBits(bytes[i], 8);
    }

    const totalDataBits = spec.dataCw * 8;
    const termLen = Math.min(4, totalDataBits - bits.length);
    for (let i = 0; i < termLen; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    const data = new Uint8Array(spec.dataCw);
    let idx = 0;
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      data[idx++] = b;
    }

    const padBytes = [0xec, 0x11];
    let padIdx = 0;
    while (idx < spec.dataCw) {
      data[idx++] = padBytes[padIdx];
      padIdx ^= 1;
    }

    const ec = rsComputeEc(data, spec.ecCw);
    const all = new Uint8Array(spec.dataCw + spec.ecCw);
    all.set(data, 0);
    all.set(ec, spec.dataCw);
    return all;
  }

  function createMatrix(size) {
    const grid = [];
    const reserved = [];
    for (let r = 0; r < size; r++) {
      grid.push(new Uint8Array(size));
      reserved.push(new Uint8Array(size));
    }
    return { grid, reserved, size };
  }

  function setFunctionModule(m, r, c, dark) {
    if (r < 0 || c < 0 || r >= m.size || c >= m.size) return;
    m.grid[r][c] = dark ? 1 : 0;
    m.reserved[r][c] = 1;
  }

  function placeFinder(m, top, left) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = top + dr;
        const c = left + dc;
        if (r < 0 || c < 0 || r >= m.size || c >= m.size) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const dark =
          inOuter &&
          (dr === 0 ||
            dr === 6 ||
            dc === 0 ||
            dc === 6 ||
            (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        setFunctionModule(m, r, c, dark);
      }
    }
  }

  function placeAlignment(m, centerR, centerC) {
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const dark =
          Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
        setFunctionModule(m, centerR + dr, centerC + dc, dark);
      }
    }
  }

  function reserveFormatAreas(m) {
    const n = m.size;
    for (let i = 0; i <= 8; i++) {
      if (i !== 6) {
        m.reserved[8][i] = 1;
        m.reserved[i][8] = 1;
      }
    }
    for (let i = n - 8; i < n; i++) {
      m.reserved[8][i] = 1;
    }
    for (let i = n - 7; i < n; i++) {
      m.reserved[i][8] = 1;
    }
    // Dark module
    setFunctionModule(m, n - 8, 8, true);
  }

  function writeFormatInfo(m, maskIdx) {
    const bits = FORMAT_BITS_L[maskIdx];
    const n = m.size;
    const bitAt = (pos) => ((bits >>> pos) & 1) === 1;

    // Copy 1 (top-left)
    const tlCoords = [
      [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
      [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
    ];
    for (let i = 0; i < 15; i++) {
      const [r, c] = tlCoords[i];
      m.grid[r][c] = bitAt(14 - i) ? 1 : 0;
    }

    // Copy 2 (bottom-left and top-right)
    for (let i = 0; i < 7; i++) {
      m.grid[n - 1 - i][8] = bitAt(14 - i) ? 1 : 0;
    }
    for (let i = 0; i < 8; i++) {
      m.grid[8][n - 8 + i] = bitAt(7 - i) ? 1 : 0;
    }
  }

  function maskPredicate(maskIdx, r, c) {
    switch (maskIdx) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return false;
    }
  }

  function computePenalty(grid, size) {
    let penalty = 0;

    // Rule 1: consecutive runs of 5+
    for (let r = 0; r < size; r++) {
      let runLen = 1;
      for (let c = 1; c < size; c++) {
        if (grid[r][c] === grid[r][c - 1]) {
          runLen++;
        } else {
          if (runLen >= 5) penalty += 3 + (runLen - 5);
          runLen = 1;
        }
      }
      if (runLen >= 5) penalty += 3 + (runLen - 5);
    }

    for (let c = 0; c < size; c++) {
      let runLen = 1;
      for (let r = 1; r < size; r++) {
        if (grid[r][c] === grid[r - 1][c]) {
          runLen++;
        } else {
          if (runLen >= 5) penalty += 3 + (runLen - 5);
          runLen = 1;
        }
      }
      if (runLen >= 5) penalty += 3 + (runLen - 5);
    }

    // Rule 2: 2x2 blocks
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const v = grid[r][c];
        if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) {
          penalty += 3;
        }
      }
    }

    // Rule 4: dark/light balance
    let dark = 0;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c]) dark++;
      }
    }
    const pct = (dark * 100) / (size * size);
    penalty += Math.floor(Math.abs(pct - 50) / 5) * 10;

    return penalty;
  }

  function encode(text) {
    const bytes = toUtf8Bytes(text);
    const spec = VERSIONS.find((v) => bytes.length <= v.dataCw - 2);
    if (!spec) {
      throw new Error('Text too long for QR encoder.');
    }

    const codewords = buildCodewords(bytes, spec);
    const base = createMatrix(spec.size);

    placeFinder(base, 0, 0);
    placeFinder(base, 0, spec.size - 7);
    placeFinder(base, spec.size - 7, 0);

    // Timing patterns
    for (let i = 8; i < spec.size - 8; i++) {
      setFunctionModule(base, 6, i, i % 2 === 0);
      setFunctionModule(base, i, 6, i % 2 === 0);
    }

    // Alignment patterns
    for (const r of spec.align) {
      for (const c of spec.align) {
        if (!base.reserved[r][c]) {
          placeAlignment(base, r, c);
        }
      }
    }

    reserveFormatAreas(base);

    // Place data bits in zig-zag order
    let bitIdx = 0;
    const totalBits = codewords.length * 8;
    let upward = true;

    for (let col = spec.size - 1; col >= 1; col -= 2) {
      if (col === 6) col--;
      for (let step = 0; step < spec.size; step++) {
        const row = upward ? spec.size - 1 - step : step;
        for (let offset = 0; offset < 2; offset++) {
          const c = col - offset;
          if (base.reserved[row][c]) continue;
          let dark = 0;
          if (bitIdx < totalBits) {
            dark = (codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1;
            bitIdx++;
          }
          base.grid[row][c] = dark;
        }
      }
      upward = !upward;
    }

    // Pick lowest-penalty mask
    let bestGrid = null;
    let bestPenalty = Infinity;

    for (let mask = 0; mask < 8; mask++) {
      const candidate = {
        size: spec.size,
        reserved: base.reserved,
        grid: base.grid.map((row) => new Uint8Array(row))
      };

      for (let r = 0; r < spec.size; r++) {
        for (let c = 0; c < spec.size; c++) {
          if (!candidate.reserved[r][c] && maskPredicate(mask, r, c)) {
            candidate.grid[r][c] ^= 1;
          }
        }
      }

      writeFormatInfo(candidate, mask);
      const p = computePenalty(candidate.grid, spec.size);
      if (p < bestPenalty) {
        bestPenalty = p;
        bestGrid = candidate.grid;
      }
    }

    return { size: spec.size, grid: bestGrid };
  }

  function renderToCanvas(canvas, text, options = {}) {
    const {
      pixelSize = 220,
      quietZone = 4,
      darkColor = '#2a211c',
      lightColor = '#ffffff'
    } = options;

    const qr = encode(text);
    const totalModules = qr.size + quietZone * 2;
    const scale = Math.max(2, Math.floor(pixelSize / totalModules));
    const dim = totalModules * scale;

    canvas.width = dim;
    canvas.height = dim;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = lightColor;
    ctx.fillRect(0, 0, dim, dim);

    ctx.fillStyle = darkColor;
    for (let r = 0; r < qr.size; r++) {
      for (let c = 0; c < qr.size; c++) {
        if (qr.grid[r][c]) {
          ctx.fillRect((c + quietZone) * scale, (r + quietZone) * scale, scale, scale);
        }
      }
    }
  }

  window.SimpleQR = { encode, renderToCanvas };
})();

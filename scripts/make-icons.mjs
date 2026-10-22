// Draws a speaker-on-blue-circle icon at 16/48/128 px and writes PNGs (no image deps).
import fs from "fs";
import zlib from "zlib";

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });

function crc32(buf) {
  let c, crc = ~0;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// Coverage of the shape at a point in a 0..1 unit square.
function shape(x, y) {
  const dx = x - 0.5, dy = y - 0.5, r = Math.hypot(dx, dy);
  if (r > 0.48) return null;
  const ay = Math.abs(dy);
  const body = x >= 0.22 && x <= 0.36 && ay <= 0.1;
  const cone = x > 0.36 && x <= 0.54 && ay <= 0.1 + (x - 0.36) * 1.1;
  const ang = Math.atan2(dy, x - 0.5);
  const wave = (rr, w) => Math.abs(Math.hypot(x - 0.5, dy) - rr) < w && Math.abs(ang) < 0.75 && x > 0.55;
  return body || cone || wave(0.13, 0.03) || wave(0.24, 0.03) ? "w" : "b";
}

for (const size of [16, 48, 128]) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const ss = 4;
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let w = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const s = shape((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
        if (s === "w") w++; else if (s === "b") b++;
      }
      const n = ss * ss, a = (w + b) / n, mix = w / Math.max(1, w + b);
      const o = py * (size * 4 + 1) + 1 + px * 4;
      raw[o] = Math.round(43 + (255 - 43) * mix);
      raw[o + 1] = Math.round(76 + (255 - 76) * mix);
      raw[o + 2] = 255;
      raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
  fs.writeFileSync(`${out}/${size}.png`, png);
}

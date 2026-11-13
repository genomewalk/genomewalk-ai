const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function crc32(bytes: Uint8Array, initial = 0) {
  let value = (initial ^ 0xffffffff) >>> 0;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

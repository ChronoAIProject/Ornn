/**
 * Shared tar archive creation utilities.
 * Extracted from skillPackageBuilder for reuse in file update operations.
 * @module utils/tarBuilder
 */

/**
 * Creates a minimal POSIX tar buffer from file entries.
 * Each file gets a 512-byte header followed by content padded to 512 bytes.
 */
export function createTarBuffer(
  entries: Array<{ path: string; content: Uint8Array }>,
): Uint8Array {
  const BLOCK_SIZE = 512;
  const blocks: Uint8Array[] = [];

  for (const entry of entries) {
    const header = buildTarHeader(entry.path, entry.content.length);
    blocks.push(header);

    const contentBlocks = Math.ceil(entry.content.length / BLOCK_SIZE);
    const paddedContent = new Uint8Array(contentBlocks * BLOCK_SIZE);
    paddedContent.set(entry.content);
    blocks.push(paddedContent);
  }

  // End-of-archive marker: two 512-byte blocks of zeros
  blocks.push(new Uint8Array(BLOCK_SIZE * 2));

  return concatUint8Arrays(blocks);
}

/** Build a single 512-byte POSIX tar header. */
export function buildTarHeader(path: string, fileSize: number): Uint8Array {
  const BLOCK_SIZE = 512;
  const header = new Uint8Array(BLOCK_SIZE);
  const encoder = new TextEncoder();

  // File name (0-99)
  header.set(encoder.encode(path).slice(0, 100), 0);
  // File mode (100-107) - 0644
  header.set(encoder.encode("0000644\0"), 100);
  // Owner ID (108-115)
  header.set(encoder.encode("0000000\0"), 108);
  // Group ID (116-123)
  header.set(encoder.encode("0000000\0"), 116);
  // File size in octal (124-135)
  const sizeOctal = fileSize.toString(8).padStart(11, "0") + "\0";
  header.set(encoder.encode(sizeOctal), 124);
  // Modification time (136-147)
  const mtime = Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0";
  header.set(encoder.encode(mtime), 136);
  // Checksum placeholder - spaces (148-155)
  header.set(encoder.encode("        "), 148);
  // Type flag (156) - regular file = '0'
  header[156] = 0x30;
  // USTAR magic (257-262)
  header.set(encoder.encode("ustar\0"), 257);
  // USTAR version (263-264)
  header.set(encoder.encode("00"), 263);

  // Calculate and set checksum
  let checksum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) {
    checksum += header[i];
  }
  const checksumOctal = checksum.toString(8).padStart(6, "0") + "\0 ";
  header.set(encoder.encode(checksumOctal), 148);

  return header;
}

/** Concatenate multiple Uint8Array buffers into one. */
export function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalSize = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

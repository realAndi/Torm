/**
 * Bencode Parser for Torm
 *
 * Bencode is the encoding format used by BitTorrent for .torrent files
 * and tracker responses. It supports 4 types:
 * - Integers: i<number>e (e.g., i42e = 42)
 * - Byte strings: <length>:<data> (e.g., 4:spam = "spam")
 * - Lists: l<contents>e (e.g., l4:spami42ee = ["spam", 42])
 * - Dictionaries: d<contents>e with sorted keys
 */

/**
 * Represents any valid bencode value
 */
export type BencodeValue =
  | number
  | bigint
  | Buffer
  | BencodeValue[]
  | { [key: string]: BencodeValue };

// ASCII character codes for parsing
const CHAR_D = 0x64; // 'd' - dictionary start
const CHAR_E = 0x65; // 'e' - end marker
const CHAR_I = 0x69; // 'i' - integer start
const CHAR_L = 0x6c; // 'l' - list start
const CHAR_COLON = 0x3a; // ':' - string length separator
const CHAR_MINUS = 0x2d; // '-' - negative sign
const CHAR_0 = 0x30; // '0'
const CHAR_9 = 0x39; // '9'

/**
 * Parsing state to track position in the buffer
 */
interface ParseState {
  buffer: Buffer;
  offset: number;
}

/**
 * Check if a character code is a digit (0-9)
 */
function isDigit(charCode: number): boolean {
  return charCode >= CHAR_0 && charCode <= CHAR_9;
}

/**
 * Parse a bencode integer: i<number>e
 * Examples: i42e = 42, i-3e = -3, i0e = 0
 */
function parseInteger(state: ParseState): number | bigint {
  const { buffer } = state;

  // Skip the 'i' marker
  state.offset++;

  if (state.offset >= buffer.length) {
    throw new Error('Unexpected end of input while parsing integer');
  }

  const startOffset = state.offset;
  let isNegative = false;

  // Check for negative sign
  if (buffer[state.offset] === CHAR_MINUS) {
    isNegative = true;
    state.offset++;

    if (state.offset >= buffer.length) {
      throw new Error('Unexpected end of input after negative sign');
    }
  }

  // Must have at least one digit
  if (!isDigit(buffer[state.offset])) {
    throw new Error(
      `Invalid integer: expected digit at position ${state.offset}`
    );
  }

  // Check for leading zeros (not allowed except for i0e)
  const firstDigit = buffer[state.offset];
  state.offset++;

  if (firstDigit === CHAR_0) {
    // If first digit is 0, next must be 'e' (no leading zeros)
    if (state.offset >= buffer.length) {
      throw new Error('Unexpected end of input while parsing integer');
    }
    if (buffer[state.offset] !== CHAR_E) {
      if (isDigit(buffer[state.offset])) {
        throw new Error('Invalid integer: leading zeros not allowed');
      }
    }
    if (isNegative) {
      throw new Error('Invalid integer: negative zero not allowed');
    }
  }

  // Consume remaining digits
  while (state.offset < buffer.length && isDigit(buffer[state.offset])) {
    state.offset++;
  }

  // Check for 'e' terminator
  if (state.offset >= buffer.length || buffer[state.offset] !== CHAR_E) {
    throw new Error(
      `Invalid integer: expected 'e' at position ${state.offset}`
    );
  }

  // Extract the integer string
  const intStr = buffer.subarray(startOffset, state.offset).toString('ascii');
  state.offset++; // Skip 'e'

  // Parse the integer - use BigInt for very large numbers
  const num = parseInt(intStr, 10);
  if (Number.isSafeInteger(num)) {
    return num;
  }

  // Fall back to BigInt for numbers outside safe integer range
  return BigInt(intStr);
}

/**
 * Parse a bencode byte string: <length>:<data>
 * Examples: 4:spam, 0:, 5:hello
 *
 * Returns a Buffer to preserve binary data (important for piece hashes)
 */
function parseByteString(state: ParseState): Buffer {
  const { buffer } = state;

  // Read the length prefix
  const lengthStart = state.offset;

  while (state.offset < buffer.length && isDigit(buffer[state.offset])) {
    state.offset++;
  }

  if (state.offset === lengthStart) {
    throw new Error(
      `Invalid byte string: expected length at position ${state.offset}`
    );
  }

  // Check for colon separator
  if (state.offset >= buffer.length || buffer[state.offset] !== CHAR_COLON) {
    throw new Error(
      `Invalid byte string: expected ':' at position ${state.offset}`
    );
  }

  const lengthStr = buffer
    .subarray(lengthStart, state.offset)
    .toString('ascii');
  const length = parseInt(lengthStr, 10);

  if (length < 0) {
    throw new Error('Invalid byte string: negative length');
  }

  state.offset++; // Skip ':'

  // Check if we have enough bytes
  if (state.offset + length > buffer.length) {
    throw new Error(
      `Invalid byte string: not enough data (expected ${length} bytes, got ${buffer.length - state.offset})`
    );
  }

  // Extract the byte string data
  const data = Buffer.from(
    buffer.subarray(state.offset, state.offset + length)
  );
  state.offset += length;

  return data;
}

/**
 * Parse a bencode list: l<contents>e
 * Examples: le = [], l4:spami42ee = ["spam", 42]
 */
function parseList(state: ParseState): BencodeValue[] {
  const { buffer } = state;

  // Skip the 'l' marker
  state.offset++;

  const list: BencodeValue[] = [];

  while (state.offset < buffer.length && buffer[state.offset] !== CHAR_E) {
    list.push(parseValue(state));
  }

  if (state.offset >= buffer.length) {
    throw new Error('Unexpected end of input while parsing list');
  }

  state.offset++; // Skip 'e'

  return list;
}

/**
 * Parse a bencode dictionary: d<contents>e
 * Keys must be byte strings and appear in sorted order
 * Examples: de = {}, d3:bar4:spam3:fooi42ee = {bar: "spam", foo: 42}
 */
function parseDictionary(state: ParseState): { [key: string]: BencodeValue } {
  const { buffer } = state;

  // Skip the 'd' marker
  state.offset++;

  const dict: { [key: string]: BencodeValue } = {};
  let lastKey: string | null = null;

  while (state.offset < buffer.length && buffer[state.offset] !== CHAR_E) {
    // Keys must be byte strings
    if (!isDigit(buffer[state.offset])) {
      throw new Error(
        `Invalid dictionary: expected string key at position ${state.offset}`
      );
    }

    const keyBuffer = parseByteString(state);
    const key = keyBuffer.toString('utf8');

    // Check key ordering (bencode requires sorted keys)
    if (lastKey !== null && key < lastKey) {
      throw new Error(
        `Invalid dictionary: keys must be sorted (got "${key}" after "${lastKey}")`
      );
    }
    lastKey = key;

    // Parse the value
    const value = parseValue(state);
    dict[key] = value;
  }

  if (state.offset >= buffer.length) {
    throw new Error('Unexpected end of input while parsing dictionary');
  }

  state.offset++; // Skip 'e'

  return dict;
}

/**
 * Parse any bencode value based on the first character
 */
function parseValue(state: ParseState): BencodeValue {
  const { buffer } = state;

  if (state.offset >= buffer.length) {
    throw new Error('Unexpected end of input');
  }

  const firstByte = buffer[state.offset];

  if (firstByte === CHAR_I) {
    return parseInteger(state);
  } else if (firstByte === CHAR_L) {
    return parseList(state);
  } else if (firstByte === CHAR_D) {
    return parseDictionary(state);
  } else if (isDigit(firstByte)) {
    return parseByteString(state);
  } else {
    throw new Error(
      `Invalid bencode: unexpected character '${String.fromCharCode(firstByte)}' at position ${state.offset}`
    );
  }
}

/**
 * Decode bencode data from a Buffer
 *
 * @param data - The bencode-encoded data
 * @returns The decoded JavaScript value
 * @throws Error if the input is malformed
 */
export function decode(data: Buffer): BencodeValue {
  if (!Buffer.isBuffer(data)) {
    throw new Error('Input must be a Buffer');
  }

  if (data.length === 0) {
    throw new Error('Input buffer is empty');
  }

  const state: ParseState = {
    buffer: data,
    offset: 0,
  };

  const value = parseValue(state);

  // Check for trailing data
  if (state.offset < data.length) {
    throw new Error(
      `Unexpected data at position ${state.offset} (expected end of input)`
    );
  }

  return value;
}

/**
 * Encode a JavaScript value to bencode format
 *
 * @param value - The value to encode
 * @returns The bencode-encoded Buffer
 */
export function encode(value: BencodeValue): Buffer {
  if (typeof value === 'number') {
    return encodeInteger(value);
  } else if (typeof value === 'bigint') {
    return encodeBigInt(value);
  } else if (Buffer.isBuffer(value)) {
    return encodeByteString(value);
  } else if (Array.isArray(value)) {
    return encodeList(value);
  } else if (typeof value === 'object' && value !== null) {
    return encodeDictionary(value);
  } else {
    throw new Error(`Cannot encode value of type ${typeof value}`);
  }
}

/**
 * Encode an integer: i<number>e
 */
function encodeInteger(value: number): Buffer {
  if (!Number.isInteger(value)) {
    throw new Error('Cannot encode non-integer number');
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error('Integer out of safe range, use BigInt for large integers');
  }
  return Buffer.from(`i${value}e`, 'ascii');
}

/**
 * Encode a BigInt: i<number>e
 */
function encodeBigInt(value: bigint): Buffer {
  return Buffer.from(`i${value.toString()}e`, 'ascii');
}

/**
 * Encode a byte string: <length>:<data>
 */
function encodeByteString(value: Buffer): Buffer {
  const lengthPrefix = Buffer.from(`${value.length}:`, 'ascii');
  return Buffer.concat([lengthPrefix, value]);
}

/**
 * Encode a list: l<contents>e
 */
function encodeList(value: BencodeValue[]): Buffer {
  const parts: Buffer[] = [Buffer.from('l', 'ascii')];

  for (const item of value) {
    parts.push(encode(item));
  }

  parts.push(Buffer.from('e', 'ascii'));
  return Buffer.concat(parts);
}

/**
 * Encode a dictionary: d<contents>e
 * Keys are sorted lexicographically as raw bytes
 */
function encodeDictionary(value: { [key: string]: BencodeValue }): Buffer {
  const parts: Buffer[] = [Buffer.from('d', 'ascii')];

  // Sort keys lexicographically (as bytes)
  const sortedKeys = Object.keys(value).sort((a, b) => {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    return bufA.compare(bufB);
  });

  for (const key of sortedKeys) {
    // Encode key as byte string
    const keyBuffer = Buffer.from(key, 'utf8');
    parts.push(encodeByteString(keyBuffer));
    // Encode value
    parts.push(encode(value[key]));
  }

  parts.push(Buffer.from('e', 'ascii'));
  return Buffer.concat(parts);
}

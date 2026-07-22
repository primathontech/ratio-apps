import { describe, expect, it } from 'vitest';
import {
  CANVAS_DROPPABLE_ID,
  isPaletteId,
  PALETTE_PREFIX,
  paletteFieldType,
  resolvePaletteIndex,
  resolveReorder,
} from './dnd';

// A canvas with a tall image banner between short rows — the variable-height
// case that made up-drag unreliable. Only the keys matter to the pure logic.
const fields = [
  { key: 'name' }, // 0 (short)
  { key: 'email' }, // 1 (short)
  { key: 'banner' }, // 2 (tall image)
  { key: 'message' }, // 3 (short)
];

describe('isPaletteId / paletteFieldType', () => {
  it('recognises palette drag ids and extracts the field type', () => {
    expect(isPaletteId(`${PALETTE_PREFIX}text`)).toBe(true);
    expect(isPaletteId('name')).toBe(false);
    expect(paletteFieldType(`${PALETTE_PREFIX}image`)).toBe('image');
  });
});

describe('resolveReorder', () => {
  it('moves a bottom row up to the very top', () => {
    expect(resolveReorder('message', 'name', fields)).toEqual({ from: 3, to: 0 });
  });

  it('moves a top row down to the bottom', () => {
    expect(resolveReorder('name', 'message', fields)).toEqual({ from: 0, to: 3 });
  });

  it('handles up-drag across the tall image row (email over banner and past it)', () => {
    // Short row dragged UP onto the tall banner: target is the banner's index.
    expect(resolveReorder('message', 'banner', fields)).toEqual({ from: 3, to: 2 });
    // Dragging the banner itself upward past a short row.
    expect(resolveReorder('banner', 'email', fields)).toEqual({ from: 2, to: 1 });
  });

  it('handles adjacent swaps in both directions', () => {
    expect(resolveReorder('name', 'email', fields)).toEqual({ from: 0, to: 1 });
    expect(resolveReorder('email', 'name', fields)).toEqual({ from: 1, to: 0 });
  });

  it('is a no-op (null) for a palette source, the container, self, or a missing over', () => {
    expect(resolveReorder(`${PALETTE_PREFIX}text`, 'email', fields)).toBeNull();
    expect(resolveReorder('name', CANVAS_DROPPABLE_ID, fields)).toBeNull();
    expect(resolveReorder('name', 'name', fields)).toBeNull();
    expect(resolveReorder('name', null, fields)).toBeNull();
    expect(resolveReorder('ghost', 'email', fields)).toBeNull();
  });
});

describe('resolvePaletteIndex', () => {
  it('inserts at the hovered row index (before it)', () => {
    expect(resolvePaletteIndex('name', fields)).toBe(0);
    expect(resolvePaletteIndex('banner', fields)).toBe(2);
  });

  it('appends on the container, an empty canvas, or an unknown over', () => {
    expect(resolvePaletteIndex(CANVAS_DROPPABLE_ID, fields)).toBe(fields.length);
    expect(resolvePaletteIndex(null, fields)).toBe(fields.length);
    expect(resolvePaletteIndex('ghost', fields)).toBe(fields.length);
    expect(resolvePaletteIndex(CANVAS_DROPPABLE_ID, [])).toBe(0);
  });
});

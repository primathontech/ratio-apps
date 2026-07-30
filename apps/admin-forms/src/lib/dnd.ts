import { type CollisionDetection, closestCorners, pointerWithin } from '@dnd-kit/core';

/**
 * Drag-and-drop wiring for the builder canvas (TDD §4). Pure, framework-free
 * decision logic lives here so the reorder / palette-insert math is unit-testable
 * without simulating pointer gestures; only `canvasCollisionDetection` touches
 * dnd-kit, and it is a thin, deterministic wrapper over `closestCorners`.
 */

/** Draggable id prefix marking a palette source (vs a canvas field key). */
export const PALETTE_PREFIX = 'palette:';

/**
 * Id of the `useDroppable` that wraps the whole canvas. It is the append target
 * for an empty canvas or a drop past the last row — never a reorder target.
 */
export const CANVAS_DROPPABLE_ID = 'builder-canvas';

/** True when a dnd id denotes a palette source rather than a canvas field. */
export function isPaletteId(id: string): boolean {
  return id.startsWith(PALETTE_PREFIX);
}

/** The field type carried by a palette drag id (`palette:text` → `text`). */
export function paletteFieldType(id: string): string {
  return id.slice(PALETTE_PREFIX.length);
}

/**
 * The `{from,to}` a field-to-field drag implies, or `null` when it is a no-op.
 * Only two DISTINCT field keys move; a palette source, the canvas container, a
 * missing `over`, or a self-hover all return `null`. Used by `onDragOver` for
 * live reordering — returning `null` on an unchanged position is what stops a
 * redundant dispatch (and any feedback loop).
 */
export function resolveReorder(
  activeId: string,
  overId: string | null,
  fields: readonly { key: string }[],
): { from: number; to: number } | null {
  if (!overId) return null;
  if (isPaletteId(activeId)) return null;
  if (overId === CANVAS_DROPPABLE_ID || overId === activeId) return null;
  const from = fields.findIndex((f) => f.key === activeId);
  const to = fields.findIndex((f) => f.key === overId);
  if (from === -1 || to === -1 || from === to) return null;
  return { from, to };
}

/**
 * Insertion index for a palette drop. Dropping onto the TOP half of a field
 * inserts BEFORE it (its index); the BOTTOM half inserts AFTER it (index + 1) —
 * this is what lets a drop reach the slot past the last field. Dropping on the
 * container, an empty canvas, or past the last row appends.
 */
export function resolvePaletteIndex(
  overId: string | null,
  fields: readonly { key: string }[],
  insertAfter = false,
): number {
  if (!overId || overId === CANVAS_DROPPABLE_ID) return fields.length;
  const index = fields.findIndex((f) => f.key === overId);
  if (index === -1) return fields.length;
  return insertAfter ? index + 1 : index;
}

/**
 * True when the dragged item's vertical center sits below the hovered row's
 * midpoint — i.e. the user is aiming to drop AFTER that row, not before it. The
 * row and the canvas droppable overlap, so collision always resolves to the row;
 * this midpoint check recovers the "insert after the last field" intent.
 */
export function droppedBelowMidpoint(
  activeRect: { top: number; height: number } | null | undefined,
  overRect: { top: number; height: number } | null | undefined,
): boolean {
  if (!activeRect || !overRect) return false;
  const activeCenter = activeRect.top + activeRect.height / 2;
  const overMid = overRect.top + overRect.height / 2;
  return activeCenter > overMid;
}

/**
 * Collision detection for the canvas. Prefer collisions with the sortable field
 * rows; only fall back to the wrapping `builder-canvas` droppable when NO field
 * collides (empty canvas, or a palette item dragged past the last row).
 *
 * Why not the default detector: the container droppable's rect spans every row,
 * so under a plain detector it can win and resolve `over` to `'builder-canvas'`
 * — which made `onDragEnd` compute `to = findIndex(...) = -1` and silently drop
 * the reorder. Filtering it out unless it is the only hit keeps reorder targets
 * on real rows while still allowing an append onto empty space.
 *
 * Why `closestCorners` over `closestCenter`: for a VARIABLE-height list, center
 * distance biases toward tall rows whose centers sit far from the cursor, so a
 * short row dragged UP over the tall image row often failed to register that row
 * as the target (down-drag happened to work, up-drag didn't). Corner distance
 * scores every droppable by its four corners, so overlapping the top edge of the
 * tall row registers it symmetrically whether approached from above or below.
 */
export const canvasCollisionDetection: CollisionDetection = (args) => {
  // closestCorners always returns a nearest droppable, so gate on the pointer:
  // an empty pointerWithin means the drop landed outside the canvas — cancel it.
  if (pointerWithin(args).length === 0) return [];
  const collisions = closestCorners(args);
  const overItems = collisions.filter((c) => c.id !== CANVAS_DROPPABLE_ID);
  return overItems.length > 0 ? overItems : collisions;
};

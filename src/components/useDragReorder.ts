"use client";

// Press and hold a list item, then drag it to a new place.
//
// - Phone: touch and hold for a moment, then drag. Moving the finger before
//   the hold ends scrolls the page as usual, so the list still scrolls.
// - Computer: click and hold, then move the mouse.
//
// The page scrolls by itself when the item is dragged near the top or bottom
// edge, so a card can be moved past ones that are off screen.

import { useEffect, useRef, useState } from "react";

/** How long to hold before the drag starts. */
const HOLD_MS = { touch: 300, mouse: 250 };
/** Moving further than this before the hold ends cancels it (a scroll or a text selection). */
const SLOP_PX = { touch: 10, mouse: 6 };
/** Space between items, matching the list's gap-3. */
const GAP_PX = 12;
/** Distance from the screen edge where dragging scrolls the page. */
const EDGE_PX = 80;
/** Fields where a press means typing or picking, never dragging. */
const NO_DRAG = "input, select, textarea, label, a, [contenteditable]";

type Kind = "touch" | "mouse";

export interface DragState {
  id: string;
  from: number;
  /** Index the item will land at when let go. */
  to: number;
  /** How far the item has moved down the page, in pixels. */
  dy: number;
  /** Height of the dragged item plus the gap, which the others shift by. */
  shift: number;
}

interface Session {
  kind: Kind;
  id: string;
  from: number;
  startX: number;
  startY: number;
  startScroll: number;
  lastY: number;
  timer: ReturnType<typeof setTimeout>;
  active: boolean;
  /** Each item's middle, in page pixels, measured when the drag starts. */
  mids: number[];
  /** The dragged item's top (page pixels) and height when the drag started. */
  top: number;
  height: number;
  shift: number;
  frame: number;
}

export function useDragReorder(
  ids: string[],
  onDrop: (orderedIds: string[]) => void,
) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const latest = useRef({ ids, onDrop });
  useEffect(() => {
    latest.current = { ids, onDrop };
  });
  // Made once, so the window listeners it adds can be removed again.
  const [ctl] = useState(() => controller(latest, setDrag));
  // Stop a drag that is still going if the list goes away.
  useEffect(() => () => ctl.end(false), [ctl]);

  /** How far to move an item, to follow the pointer or make room. */
  function offset(index: number): number {
    if (!drag) return 0;
    if (index === drag.from) return drag.dy;
    if (index > drag.from && index <= drag.to) return -drag.shift;
    if (index < drag.from && index >= drag.to) return drag.shift;
    return 0;
  }

  return { drag, itemProps: ctl.itemProps, offset };
}

function controller(
  latest: React.RefObject<{
    ids: string[];
    onDrop: (orderedIds: string[]) => void;
  }>,
  setDrag: (d: DragState | null) => void,
) {
  const items = new Map<string, HTMLElement>();
  let session: Session | null = null;
  let lastTouch = 0;
  let current: DragState | null = null;

  function show(d: DragState | null) {
    current = d;
    setDrag(d);
  }

  function update() {
    const s = session;
    if (!s?.active) return;
    const dy = s.lastY + window.scrollY - (s.startY + s.startScroll);
    const top = s.top + dy;
    const bottom = top + s.height;
    // It takes another item's place once its edge passes that item's
    // middle: its top going up, its bottom going down.
    let to = s.from;
    s.mids.forEach((mid, i) => {
      if (i < s.from && top < mid) to--;
      if (i > s.from && bottom > mid) to++;
    });
    show({ id: s.id, from: s.from, to, dy, shift: s.shift });
  }

  function end(drop: boolean) {
    const s = session;
    if (!s) return;
    session = null;
    clearTimeout(s.timer);
    cancelAnimationFrame(s.frame);
    window.removeEventListener("touchmove", onTouchMove);
    window.removeEventListener("touchend", onTouchEnd);
    window.removeEventListener("touchcancel", onTouchCancel);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
    window.removeEventListener("contextmenu", onContextMenu, true);
    if (!s.active) return;
    // The press that ended the drag must not also click a button under it.
    const swallow = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener("click", swallow, true);
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);

    const d = current;
    show(null);
    if (drop && d && d.to !== d.from) {
      const order = latest.current.ids.filter((x) => x !== d.id);
      order.splice(d.to, 0, d.id);
      latest.current.onDrop(order);
    }
  }

  function activate() {
    const s = session;
    if (!s) return;
    const el = items.get(s.id);
    if (!el) return end(false);
    s.active = true;
    s.mids = latest.current.ids.map((x) => {
      const r = items.get(x)?.getBoundingClientRect();
      return r ? r.top + window.scrollY + r.height / 2 : 0;
    });
    const rect = el.getBoundingClientRect();
    s.top = rect.top + window.scrollY;
    s.height = rect.height;
    s.shift = rect.height + GAP_PX;
    // Clear any text the hold started to select.
    window.getSelection()?.removeAllRanges();
    if (s.kind === "touch") navigator.vibrate?.(10);
    const scroll = () => {
      const cur = session;
      if (!cur?.active) return;
      const y = cur.lastY;
      let step = 0;
      if (y < EDGE_PX) step = -Math.ceil((EDGE_PX - y) / 6);
      else if (y > window.innerHeight - EDGE_PX)
        step = Math.ceil((y - (window.innerHeight - EDGE_PX)) / 6);
      if (step) {
        window.scrollBy(0, step);
        update();
      }
      cur.frame = requestAnimationFrame(scroll);
    };
    s.frame = requestAnimationFrame(scroll);
    update();
  }

  function move(x: number, y: number, e: Event) {
    const s = session;
    if (!s) return;
    if (!s.active) {
      if (Math.hypot(x - s.startX, y - s.startY) > SLOP_PX[s.kind]) end(false);
      return;
    }
    // Keep the page from scrolling under the finger while dragging.
    if (e.cancelable) e.preventDefault();
    s.lastY = y;
    update();
  }

  function onTouchMove(e: TouchEvent) {
    const t = e.touches[0];
    if (t) move(t.clientX, t.clientY, e);
  }
  function onTouchEnd() {
    lastTouch = Date.now();
    end(true);
  }
  function onTouchCancel() {
    lastTouch = Date.now();
    end(false);
  }
  function onMouseMove(e: MouseEvent) {
    move(e.clientX, e.clientY, e);
  }
  function onMouseUp() {
    end(true);
  }
  function onContextMenu(e: Event) {
    // A long press on a phone opens a menu; holding to drag should not.
    e.preventDefault();
  }

  function start(id: string, kind: Kind, x: number, y: number) {
    end(false);
    const { ids } = latest.current;
    const from = ids.indexOf(id);
    if (from < 0 || ids.length < 2) return;
    session = {
      kind,
      id,
      from,
      startX: x,
      startY: y,
      startScroll: window.scrollY,
      lastY: y,
      timer: setTimeout(activate, HOLD_MS[kind]),
      active: false,
      mids: [],
      top: 0,
      height: 0,
      shift: 0,
      frame: 0,
    };
    window.addEventListener("contextmenu", onContextMenu, true);
    if (kind === "touch") {
      window.addEventListener("touchmove", onTouchMove, { passive: false });
      window.addEventListener("touchend", onTouchEnd);
      window.addEventListener("touchcancel", onTouchCancel);
    } else {
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    }
  }

  const blocked = (target: EventTarget | null) =>
    target instanceof Element && target.closest(NO_DRAG) !== null;

  /** Props for each draggable item. */
  function itemProps(id: string) {
    return {
      ref: (el: HTMLElement | null) => {
        if (el) items.set(id, el);
        else items.delete(id);
      },
      onTouchStart: (e: React.TouchEvent) => {
        const t = e.touches[0];
        if (e.touches.length !== 1 || !t || blocked(e.target)) return;
        start(id, "touch", t.clientX, t.clientY);
      },
      onMouseDown: (e: React.MouseEvent) => {
        // Phones also send a mouse press after a tap; that is not a drag.
        if (e.button !== 0 || Date.now() - lastTouch < 1000) return;
        if (blocked(e.target)) return;
        start(id, "mouse", e.clientX, e.clientY);
      },
    };
  }

  return { end, itemProps };
}

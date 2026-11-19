// Shared class names for design A ("Clean light"). Colors come from the theme
// tokens in globals.css, so each one also has a dark version.
export const inputClass =
  "w-full rounded-xl border border-field-line bg-field px-3 py-2.5 text-base text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25";
export const buttonClass =
  "rounded-xl bg-accent px-4 py-2.5 font-semibold text-accent-ink shadow-float active:opacity-90 disabled:opacity-50";
export const secondaryButtonClass =
  "rounded-xl border border-line bg-surface px-4 py-2.5 font-semibold text-ink active:bg-sunken";
/** A white rounded tile on the grey page, like an iOS grouped list. */
export const cardClass = "rounded-2xl bg-surface px-4 py-3 shadow-tile";
/** Small uppercase label above a number. */
export const labelClass = "text-[11px] font-semibold uppercase tracking-wide text-muted";
/** Grey pill for a condition, like NM. */
export const chipClass = "rounded-md bg-sunken px-1.5 py-px text-[11px] font-semibold text-ink-soft";
/** Blue pill for a grade, like PSA 10. */
export const gradeChipClass = "rounded-md bg-accent-soft px-1.5 py-px text-[11px] font-semibold text-accent";
export const linkClass = "font-medium text-accent";
export const dangerLinkClass = "font-medium text-neg";
/** Segmented control (Raw / Slab). */
export const segmentClass = "flex rounded-[10px] bg-sunken p-0.5 text-sm font-medium";
export const segmentItemClass = (on: boolean) =>
  `flex-1 rounded-lg px-3 py-1.5 text-center ${on ? "bg-surface text-ink shadow-sm" : "text-ink-soft"}`;
export const profitTone = (n: number) => (n > 0 ? "text-pos" : n < 0 ? "text-neg" : "");

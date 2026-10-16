// Two intervals overlap when each starts before the other ends. Touching ends do not overlap.
export const overlaps = (aStart, aEnd, bStart, bEnd) =>
  new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);

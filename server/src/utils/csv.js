const cell = (v) => {
  let s = v == null ? '' : String(v);
  // Neutralise spreadsheet formula injection
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (headers, rows) =>
  [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n');

export const parseCsv = (text, { maxRows = 200 } = {}) => {
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = lines[0].split(',').map((h) => h.trim());
  const rows = [];

  for (const line of lines.slice(1, maxRows + 1)) {
    const values = line.split(',');
    const row = {};

    headers.forEach((h, i) => {
      const raw = values[i] ?? '';
      const trimmed = raw.trim();
      const asNumber = Number(trimmed);
      row[h] = trimmed !== '' && Number.isFinite(asNumber) ? asNumber : trimmed;
    });

    rows.push(row);
  }

  return { headers, rows };
};


import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';

export function csvCell(value) {
  return '"' + String(value ?? '').replaceAll('"', '""') + '"';
}

export function appendCsv(path, row, columns = Object.keys(row)) {
  if (!existsSync(path)) writeFileSync(path, '\ufeff' + columns.map(csvCell).join(',') + '\r\n');
  const header = parseCsv(readFileSync(path, 'utf8'))[0];
  if (JSON.stringify(header) !== JSON.stringify(columns)) throw new Error(`CSV schema mismatch: ${path}`);
  appendFileSync(path, columns.map(key => csvCell(row[key])).join(',') + '\r\n');
}

export function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  text = text.replace(/^\ufeff/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && char === ',') { row.push(cell); cell = ''; }
    else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); if (row.some(x => x.length)) rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('Unterminated CSV field');
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function readCsv(path) {
  if (!existsSync(path)) return [];
  const [header, ...rows] = parseCsv(readFileSync(path, 'utf8'));
  return rows.map(row => Object.fromEntries(header.map((key, i) => [key, row[i] ?? ''])));
}

export const canonical = value => value.normalize('NFC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
export const missingFacts = (facts, output) => facts.filter(fact => !canonical(output).includes(canonical(fact)));
export function quantile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), position = (sorted.length - 1) * p;
  const lo = Math.floor(position), hi = Math.ceil(position);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo);
}
export const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

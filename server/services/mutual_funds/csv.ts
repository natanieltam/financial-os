/**
 * Minimal RFC 4180 CSV reader.
 *
 * The upstream `funds.csv` quotes any field containing a comma — e.g.
 * `manager` is `"Simpan Asset Management, PT"` on almost every row — so a naive
 * `line.split(',')` misaligns every column after it. That is exactly the bug
 * this module exists to prevent.
 *
 * Handles: quoted fields, `""` escapes, embedded commas and newlines, and both
 * LF and CRLF line endings. Returns records as string arrays; pair with
 * `parseCsvWithHeader` when the first row is a header.
 */

/** Parse a whole CSV document into rows of raw field values. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let fieldWasQuoted = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
      fieldWasQuoted = true
      continue
    }
    if (char === ',') {
      row.push(field)
      field = ''
      fieldWasQuoted = false
      continue
    }
    if (char === '\r') continue // normalise CRLF; a bare \r is also dropped
    if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      fieldWasQuoted = false
      continue
    }
    field += char
  }

  // Flush the final record unless the document ended with a newline.
  if (field.length > 0 || row.length > 0 || fieldWasQuoted) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => r.length > 1 || (r[0] ?? '').trim() !== '')
}

export type CsvRecord = Record<string, string>

/**
 * Parse CSV whose first row is a header. Short rows are padded with '' and
 * extra fields are ignored, so a malformed row can never shift its neighbours.
 */
export function parseCsvWithHeader(text: string): CsvRecord[] {
  const rows = parseCsv(text)
  const header = rows[0]
  if (!header) return []

  return rows.slice(1).map((cells) => {
    const record: CsvRecord = {}
    for (let i = 0; i < header.length; i++) {
      record[header[i]!] = (cells[i] ?? '').trim()
    }
    return record
  })
}
import { describe, expect, it } from 'vitest'
import { parseCsv, parseCsvWithHeader } from '../../server/services/mutual_funds/csv'

describe('parseCsv', () => {
  it('parses plain rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('keeps commas inside quoted fields (the bug that misaligned the sync)', () => {
    const line = 'BRK3,Asiantrust Enhanced Strategy Fund,,"Simpan Asset Management, PT",Saham,IDR'
    expect(parseCsv(line)).toEqual([
      ['BRK3', 'Asiantrust Enhanced Strategy Fund', '', 'Simpan Asset Management, PT', 'Saham', 'IDR'],
    ])
  })

  it('unescapes doubled quotes', () => {
    expect(parseCsv('a,"he said ""hi""",c')).toEqual([['a', 'he said "hi"', 'c']])
  })

  it('normalises CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('preserves quoted empty fields', () => {
    expect(parseCsv('"",x')).toEqual([['', 'x']])
  })
})

describe('parseCsvWithHeader', () => {
  it('maps cells onto header names', () => {
    const records = parseCsvWithHeader('id,name\nBRK3,Fund A')
    expect(records).toEqual([{ id: 'BRK3', name: 'Fund A' }])
  })

  it('trims surrounding whitespace from cells', () => {
    expect(parseCsvWithHeader('id,name\nBRK3,  Fund A  ')).toEqual([{ id: 'BRK3', name: 'Fund A' }])
  })

  it('pads short rows so a malformed row cannot shift its neighbours', () => {
    expect(parseCsvWithHeader('id,name,manager\nBRK3,Only Name')).toEqual([{ id: 'BRK3', name: 'Only Name', manager: '' }])
  })

  it('returns [] for empty input', () => {
    expect(parseCsvWithHeader('')).toEqual([])
  })
})
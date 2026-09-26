import { describe, expect, test } from 'bun:test'
import { territoryDescription, territorySelection } from './territory'

describe('public Floaty territory contract', () => {
  test('reads the separate club label when hit testing also returns its cell', () => {
    expect(
      territorySelection([
        { properties: { color: '#C4031A', isCell: true } },
        {
          properties: { clubName: 'Swiss Onewheel Club', clubId: 'public-club-id', isLabel: true },
        },
      ]),
    ).toEqual({ clubName: 'Swiss Onewheel Club' })
  })

  test('does not invent ownership or claims for color-only polygons', () => {
    const selected = territorySelection([{ properties: { color: '#C4031A', isCell: true } }])
    expect(selected).toEqual({ clubName: null })
    const message = territoryDescription(selected!)
    expect(message).toContain('does not include an owner name')
    expect(message).toContain(
      'does not include the claiming rider, their ride, or ownership history',
    )
    expect(message).toContain('does not confirm tile credit')
  })

  test('ignores malformed metadata and empty source hits', () => {
    expect(territorySelection([])).toBeNull()
    expect(
      territorySelection([
        { properties: { clubName: { name: 'untrusted' } } },
        { properties: null },
      ]),
    ).toEqual({ clubName: null })
    expect(territorySelection([{ properties: { clubName: '  ' } }])).toEqual({ clubName: null })
  })
})

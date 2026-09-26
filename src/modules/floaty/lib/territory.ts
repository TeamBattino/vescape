export interface FloatyTerritorySelection {
  clubName: string | null
}

/** The public tile source uses separate label points and cell polygons. Cell colors
 * are not club identifiers: never guess an owner from a neighboring feature/color. */
export function territorySelection(
  features: { properties?: Record<string, unknown> | null }[],
): FloatyTerritorySelection | null {
  if (!features.length) return null
  for (const feature of features) {
    const name = feature.properties?.clubName
    if (typeof name === 'string' && name.trim()) return { clubName: name.trim() }
  }
  return { clubName: null }
}

export function territoryDescription(selection: FloatyTerritorySelection): string {
  const owner = selection.clubName
    ? `Controlling club: ${selection.clubName}.`
    : 'This tile does not include an owner name. Zoom in and tap a club label to see its owner.'
  return `${owner}\n\nThe public tile data does not include the claiming rider, their ride, or ownership history.\n\nTiles show Floaty’s latest published snapshot. Uploading a ride does not confirm tile credit; processing and map updates can take longer.`
}

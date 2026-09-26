export interface FirestoreValue {
  stringValue?: string
  integerValue?: string
  doubleValue?: number
  booleanValue?: boolean
  nullValue?: null
  timestampValue?: string
  arrayValue?: { values?: FirestoreValue[] }
  mapValue?: { fields?: Record<string, FirestoreValue> }
}
export interface FirestoreDocument {
  name: string
  updateTime?: string
  fields?: Record<string, FirestoreValue>
}
export function decodeValue(value: FirestoreValue): unknown {
  if ('stringValue' in value) return value.stringValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return value.doubleValue
  if ('booleanValue' in value) return value.booleanValue
  if ('timestampValue' in value) return value.timestampValue
  if (value.arrayValue) return (value.arrayValue.values ?? []).map(decodeValue)
  if (value.mapValue) return decodeFields(value.mapValue.fields ?? {})
  return null
}
export function decodeFields(fields: Record<string, FirestoreValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]))
}
export function encodeValue(value: unknown): FirestoreValue {
  if (value == null) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  }
  throw new Error('Unsupported Floaty session value')
}
export function encodeFields(record: object): Record<string, FirestoreValue> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, encodeValue(value)]))
}

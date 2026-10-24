type Change =
  | { type: 'set'; path: string[]; value: unknown }
  | { type: 'remove'; path: string[] }
  | {
      type: 'rows';
      path: string[];
      upsert: { id: string | number }[];
      order: string[];
      remove: string[];
    };
export type SyncResponse<T> =
  | { revision: string; data: T }
  | { revision: string; changes: Change[] };

function update(value: any, path: string[], change: Change): any {
  if (path.length) {
    const [key, ...rest] = path;
    const result = { ...value };
    if (change.type === 'remove' && !rest.length) delete result[key];
    else
      Object.defineProperty(result, key, {
        value: update(value?.[key], rest, change),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    return result;
  }
  if (change.type === 'set') return change.value;
  if (change.type === 'remove') return undefined;
  const rows = new Map(
    (value as { id: string | number }[]).map((row) => [String(row.id), row]),
  );
  for (const id of change.remove) rows.delete(id);
  for (const row of change.upsert) rows.set(String(row.id), row);
  return change.order.map((id) => rows.get(id));
}
export function applySync<T>(
  previous: T | undefined,
  response: SyncResponse<T>,
): T {
  if ('data' in response) return response.data;
  if (previous === undefined) throw new Error('Missing diagnostics snapshot');
  return response.changes.reduce(
    (value, change) => update(value, change.path, change),
    previous,
  );
}

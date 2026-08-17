const MISSING = Symbol("missing");

type Missing = typeof MISSING;
type JsonRecord = Record<string, unknown>;

function equal(left: unknown | Missing, right: unknown | Missing): boolean {
  if (left === MISSING || right === MISSING) return left === right;
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown | Missing): value is JsonRecord {
  return value !== MISSING && Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIdArray(value: unknown | Missing): value is JsonRecord[] {
  return Array.isArray(value) && value.every((item) => isRecord(item) && typeof item.id === "string");
}

function mergeValue(base: unknown | Missing, local: unknown | Missing, remote: unknown | Missing): unknown | Missing {
  if (equal(local, base)) return remote;
  if (equal(remote, base) || equal(local, remote)) return local;
  if (local === MISSING) return MISSING;
  if (remote === MISSING) return local;

  if (isIdArray(local) && isIdArray(remote) && (base === MISSING || isIdArray(base))) {
    const baseMap = new Map((base === MISSING ? [] : base).map((item) => [String(item.id), item]));
    const localMap = new Map(local.map((item) => [String(item.id), item]));
    const remoteMap = new Map(remote.map((item) => [String(item.id), item]));
    const ids = [...new Set([...remoteMap.keys(), ...localMap.keys(), ...baseMap.keys()])];
    return ids.flatMap((id) => {
      const merged = mergeValue(baseMap.get(id) ?? MISSING, localMap.get(id) ?? MISSING, remoteMap.get(id) ?? MISSING);
      return merged === MISSING ? [] : [merged];
    });
  }

  if (isRecord(local) && isRecord(remote) && (base === MISSING || isRecord(base))) {
    const baseRecord = base === MISSING ? {} : base;
    const keys = [...new Set([...Object.keys(remote), ...Object.keys(local), ...Object.keys(baseRecord)])];
    return Object.fromEntries(keys.flatMap((key) => {
      const merged = mergeValue(
        Object.hasOwn(baseRecord, key) ? baseRecord[key] : MISSING,
        Object.hasOwn(local, key) ? local[key] : MISSING,
        Object.hasOwn(remote, key) ? remote[key] : MISSING,
      );
      return merged === MISSING ? [] : [[key, merged]];
    }));
  }

  // Одновременное изменение одного простого поля: сохраняем значение с
  // текущего устройства. Удалённые записи с других устройств при этом не
  // теряются, поскольку массивы и словари объединяются выше по идентификаторам.
  return local;
}

export function mergeWorkspaceData<T>(base: T | undefined, local: T, remote: T): T {
  return mergeValue(base === undefined ? MISSING : base, local, remote) as T;
}

export function workspaceChanged<T>(left: T, right: T): boolean {
  return !equal(left, right);
}

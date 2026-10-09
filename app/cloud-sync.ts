const MISSING = Symbol("missing");

type Missing = typeof MISSING;
type JsonRecord = Record<string, unknown>;

export type ConflictPath = Array<{ key: string } | { id: string }>;
export type WorkspaceConflict = {
  id: string;
  path: ConflictPath;
  local: unknown;
  remote: unknown;
  localPresent: boolean;
  remotePresent: boolean;
};

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

function mergeValue(base: unknown | Missing, local: unknown | Missing, remote: unknown | Missing, conflicts?: WorkspaceConflict[], path: ConflictPath = []): unknown | Missing {
  if (equal(local, base)) return remote;
  if (equal(remote, base) || equal(local, remote)) return local;
  if (local === MISSING || remote === MISSING) {
    conflicts?.push({ id: JSON.stringify(path), path, local: local === MISSING ? null : local, remote: remote === MISSING ? null : remote, localPresent: local !== MISSING, remotePresent: remote !== MISSING });
    return local;
  }

  if (isIdArray(local) && isIdArray(remote) && (base === MISSING || isIdArray(base))) {
    const baseMap = new Map((base === MISSING ? [] : base).map((item) => [String(item.id), item]));
    const localMap = new Map(local.map((item) => [String(item.id), item]));
    const remoteMap = new Map(remote.map((item) => [String(item.id), item]));
    const ids = [...new Set([...remoteMap.keys(), ...localMap.keys(), ...baseMap.keys()])];
    return ids.flatMap((id) => {
      const merged = mergeValue(baseMap.get(id) ?? MISSING, localMap.get(id) ?? MISSING, remoteMap.get(id) ?? MISSING, conflicts, [...path, { id }]);
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
        conflicts,
        [...path, { key }],
      );
      return merged === MISSING ? [] : [[key, merged]];
    }));
  }

  conflicts?.push({ id: JSON.stringify(path), path, local, remote, localPresent: true, remotePresent: true });
  // Compatibility: the old helper keeps local values; the interactive flow
  // pauses and asks the user to resolve every reported conflict before writing.
  return local;
}

export function mergeWorkspaceWithConflicts<T>(base: T | undefined, local: T, remote: T): { data: T; conflicts: WorkspaceConflict[] } {
  const conflicts: WorkspaceConflict[] = [];
  return { data: mergeValue(base === undefined ? MISSING : base, local, remote, conflicts) as T, conflicts };
}

export function resolveWorkspaceConflicts<T>(data: T, conflicts: WorkspaceConflict[], choices: Record<string, "local" | "remote">): T {
  let result: unknown = structuredClone(data);
  for (const conflict of conflicts) {
    const choice = choices[conflict.id];
    if (!choice) throw new Error("Выберите версию для каждого конфликта");
    const value = choice === "local" ? conflict.local : conflict.remote;
    const present = choice === "local" ? conflict.localPresent : conflict.remotePresent;
    if (!conflict.path.length) { result = present ? structuredClone(value) : undefined; continue; }
    let target = result as JsonRecord | JsonRecord[];
    for (const part of conflict.path.slice(0, -1)) {
      target = ("key" in part ? (target as JsonRecord)[part.key] : (target as JsonRecord[]).find((item) => item.id === part.id)) as JsonRecord | JsonRecord[];
    }
    const part = conflict.path.at(-1)!;
    if ("key" in part) {
      if (present) (target as JsonRecord)[part.key] = structuredClone(value);
      else delete (target as JsonRecord)[part.key];
    } else {
      const items = target as JsonRecord[];
      const index = items.findIndex((item) => item.id === part.id);
      if (!present) { if (index >= 0) items.splice(index, 1); }
      else if (index >= 0) items[index] = structuredClone(value) as JsonRecord;
      else items.push(structuredClone(value) as JsonRecord);
    }
  }
  return result as T;
}

export function mergeWorkspaceData<T>(base: T | undefined, local: T, remote: T): T {
  return mergeValue(base === undefined ? MISSING : base, local, remote) as T;
}

export function workspaceChanged<T>(left: T, right: T): boolean {
  return !equal(left, right);
}

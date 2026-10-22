/** Account-scoped records never automatically adopt the ownerless legacy cache. */
export function workspaceKey(userId: string, key: string): string {
  if (!userId) throw new Error("Не указан владелец локальной базы");
  return `account:${userId}:${key}`;
}

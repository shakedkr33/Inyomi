import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotificationType =
  | 'event_reminder'
  | 'birthday_today'
  | 'task_assigned'
  | 'event_updated';

export type NotificationEntityType = 'event' | 'task' | 'person';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  entityType: NotificationEntityType;
  entityId: string;
  createdAt: string;
  seenAt: string | null;
  archivedAt: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = '@notifications/list';

/** Legacy cache: preserve every other account, and never overwrite unreadable data. */
export async function clearAccountNotifications(userId: string): Promise<void> {
  if (!userId) throw new Error('An account id is required for cleanup');
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  const records: unknown = JSON.parse(raw);
  if (
    !Array.isArray(records) ||
    records.some(
      (row) =>
        typeof row !== 'object' ||
        row === null ||
        typeof row.userId !== 'string'
    )
  )
    throw new Error('Invalid local notification cache');
  await AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(records.filter((row) => row.userId !== userId))
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readAll(): Promise<Notification[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Notification[];
  } catch {
    return [];
  }
}

async function writeAll(list: Notification[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {}
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getNotifications(
  userId: string
): Promise<Notification[]> {
  const all = await readAll();
  return all
    .filter((n) => n.userId === userId && n.archivedAt === null)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
}

export async function markAllSeen(userId: string): Promise<void> {
  const all = await readAll();
  const now = new Date().toISOString();
  const updated = all.map((n) =>
    n.userId === userId && n.seenAt === null ? { ...n, seenAt: now } : n
  );
  await writeAll(updated);
}

export async function archiveAll(userId: string): Promise<void> {
  const all = await readAll();
  const now = new Date().toISOString();
  const updated = all.map((n) =>
    n.userId === userId && n.archivedAt === null ? { ...n, archivedAt: now } : n
  );
  await writeAll(updated);
}

export async function getUnseenCount(userId: string): Promise<number> {
  const all = await readAll();
  return all.filter(
    (n) => n.userId === userId && n.seenAt === null && n.archivedAt === null
  ).length;
}

export async function addNotification(n: Notification): Promise<void> {
  const all = await readAll();
  all.push(n);
  await writeAll(all);
}

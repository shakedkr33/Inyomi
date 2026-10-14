import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { createContext, useCallback, useContext, useMemo } from 'react';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';

// ─── Types ────────────────────────────────────────────────────────────────────

export type UserNotification = Doc<'userNotifications'>;

// ─── Context ──────────────────────────────────────────────────────────────────

interface NotificationsContextValue {
  notifications: UserNotification[];
  unseenCount: number;
  markAllSeen: () => void;
  archiveAll: () => void;
  isLoading: boolean;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(
  null
);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function NotificationsProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  // The SDK may still report authenticated after server-side revocation.
  // getMyId validates the live session and safely returns null in that window.
  // The list endpoint must also handle revocation: an existing subscription
  // can re-run before this render has a chance to unsubscribe it.
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
  const canResolveIdentity = !isAuthLoading && isAuthenticated;
  const accountId = useQuery(
    api.users.getMyId,
    canResolveIdentity ? {} : 'skip'
  );
  const shouldFetch = canResolveIdentity && !!accountId;

  // useQuery is always called unconditionally (hook ordering rules).
  // "skip" tells Convex to not subscribe at all, returning undefined safely.
  const rawNotifications = useQuery(
    api.userNotifications.list,
    shouldFetch ? {} : 'skip'
  );
  const markAllReadMutation = useMutation(api.userNotifications.markAllRead);
  const archiveAllMutation = useMutation(api.userNotifications.archiveAll);

  // Safe empty state while unauthenticated or auth is still loading.
  // isLoading is true only when authenticated and the query hasn't resolved yet,
  // so logged-out consumers never see a permanent spinner.
  // Do not expose a cached result belonging to a previous account while
  // identity/subscription updates settle. Server authorization is authoritative.
  const notifications = useMemo<UserNotification[]>(
    () =>
      shouldFetch
        ? (rawNotifications ?? []).filter(
            (notification) => notification.recipientUserId === accountId
          )
        : [],
    [shouldFetch, rawNotifications, accountId]
  );
  const isLoading = shouldFetch && rawNotifications === undefined;

  const unseenCount = useMemo(
    () => notifications.filter((n) => n.readAt === undefined).length,
    [notifications]
  );

  const markAllSeen = useCallback((): void => {
    if (!shouldFetch) return;
    void markAllReadMutation();
  }, [markAllReadMutation, shouldFetch]);

  const archiveAll = useCallback((): void => {
    if (!shouldFetch) return;
    void archiveAllMutation();
  }, [archiveAllMutation, shouldFetch]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      notifications,
      unseenCount,
      markAllSeen,
      archiveAll,
      isLoading,
    }),
    [notifications, unseenCount, markAllSeen, archiveAll, isLoading]
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error(
      'useNotifications must be used within a NotificationsProvider'
    );
  }
  return ctx;
}

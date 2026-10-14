// One in-memory navigation intent, set only by confirmed Profile logout after
// Push cleanup. It does not change Auth state and does not survive a JS reload.
let pendingLogout: symbol | null = null;

export function beginExplicitLogoutNavigation(): () => void {
  const attempt = Symbol('explicit-logout');
  pendingLogout = attempt;
  return () => {
    if (pendingLogout === attempt) pendingLogout = null;
  };
}

export function consumeSignedOutDestination(): '/(auth)' | '/(auth)/sign-in' {
  const isExplicitLogout = pendingLogout !== null;
  pendingLogout = null;
  return isExplicitLogout ? '/(auth)/sign-in' : '/(auth)';
}

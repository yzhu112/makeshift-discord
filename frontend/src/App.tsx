import type { User } from '@/api';
import { AuthGate } from '@/auth/AuthGate';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { DiagnosticsPage } from '@/diagnostics/DiagnosticsPage';
import { resumePendingDiagnostics } from '@/diagnostics/telemetry';
import { Lobby } from '@/room/Lobby';
import { RoomView } from '@/room/RoomView';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NavigationContext, pageFromPath, type Page } from './navigation';
import { ActiveCallProvider } from './room/ActiveCallProvider';
import { CallDock } from './room/CallDock';


function App() {
  return (
    <AuthProvider>
      <AuthSwitch />
    </AuthProvider>
  );
}

function AuthSwitch() {
  const { state } = useAuth();
  const userId = state.status === 'authed' ? state.user.id : null;
  useEffect(() => userId === null ? undefined : resumePendingDiagnostics(userId), [userId]);

  if (state.status === 'loading') return null;
  if (state.status === 'unauthed') return <AuthGate />;

  return <AppShell key={state.user.id} user={state.user} />;
}

function AppShell({ user }: { user: User }) {
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname));
  const [roomName, setRoomName] = useState<string | null>(null);
  const teardown = useRef(Promise.resolve());
  const navigate = useCallback((next: Page) => {
    const path = next === 'lobby' ? '/' : `/${next}`;
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
    setPage(next);
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    const onPopState = () => setPage(pageFromPath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  useEffect(() => {
    if (page === 'call' && !roomName) {
      window.history.replaceState(null, '', '/');
      setPage('lobby');
    }
  }, [page, roomName]);

  const join = (name: string) => { setRoomName(name); navigate('call'); };
  const leave = () => {
    setRoomName(null);
    if (page === 'call') navigate('lobby');
  };
  const minimized = !!roomName && page !== 'call';
  return <NavigationContext.Provider value={{ page, navigate }}>
    <ActiveCallProvider key={roomName === null ? 'idle' : `room:${roomName}`} user={user} roomName={roomName} teardown={teardown}>
      <div className={minimized ? 'app-with-call-dock' : undefined}>
        {page === 'diagnostics' ? <DiagnosticsPage user={user} />
          : page === 'call' && roomName ? <RoomView user={user} roomName={roomName} onLeave={leave} />
          : <Lobby user={user} onJoin={join} />}
      </div>
      {minimized && <CallDock onReturn={() => navigate('call')} onLeave={leave} />}
    </ActiveCallProvider>
  </NavigationContext.Provider>;
}

export default App;

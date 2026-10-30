import { useEffect, useState } from 'react';
import type { User } from '@/api';
import { AuthGate } from '@/auth/AuthGate';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { Lobby } from '@/room/Lobby';
import { RoomView } from '@/room/RoomView';
import { DiagnosticsPage } from '@/diagnostics/DiagnosticsPage';
import { resumePendingDiagnostics } from '@/diagnostics/telemetry';

type View = { screen: 'lobby' } | { screen: 'room'; roomName: string };

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
  if (window.location.pathname.replace(/\/$/, '') === '/diagnostics') return <DiagnosticsPage user={state.user} />;

  return <AppShell key={state.user.id} user={state.user} />;
}

function AppShell({ user }: { user: User }) {
  const [view, setView] = useState<View>({ screen: 'lobby' });
  if (view.screen === 'lobby') {
    return (
      <Lobby user={user} onJoin={(roomName) => setView({ screen: 'room', roomName })} />
    );
  }

  return (
    <RoomView
      user={user}
      roomName={view.roomName}
      onLeave={() => setView({ screen: 'lobby' })}
    />
  );
}

export default App;

import { useState } from 'react';
import type { User } from '@/api';
import { AuthGate } from '@/auth/AuthGate';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { Lobby } from '@/room/Lobby';
import { RoomView } from '@/room/RoomView';

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
  const [view, setView] = useState<View>({ screen: 'lobby' });

  if (state.status === 'loading') return null;
  if (state.status === 'unauthed') return <AuthGate />;

  return <AppShell user={state.user} view={view} setView={setView} />;
}

function AppShell({
  user,
  view,
  setView,
}: {
  user: User;
  view: View;
  setView: (v: View) => void;
}) {
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

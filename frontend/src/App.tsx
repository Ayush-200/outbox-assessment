import { useState } from 'react';
import { clearSession, readSession, writeSession } from './api';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import { Session } from './types';

export default function App() {
  const [session, setSession] = useState<Session | null>(() => readSession());

  if (!session) {
    return (
      <Login
        onLogin={(next) => {
          writeSession(next);
          setSession(next);
        }}
      />
    );
  }

  return (
    <Dashboard
      session={session}
      onLogout={() => {
        clearSession();
        setSession(null);
      }}
    />
  );
}

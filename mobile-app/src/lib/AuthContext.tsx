import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Profile } from '../types';

type FullProfile = Profile & {
  full_name: string | null;
  company_name: string | null;
  location: string | null;
  photo_url: string | null;
  created_at: string | null;
};

type AuthContextValue = {
  session: Session | null;
  profile: FullProfile | null;
  loading: boolean;
  refreshProfile: () => void;
  /** True for the one render right after an interactive sign-in (the user
   * just typed their password) — false for a session restored on cold
   * start. Lets the biometric lock skip itself right after login (already
   * proved identity once) while still locking when the app is reopened
   * with a session left over from before. Consumed via clearJustSignedIn
   * so it doesn't linger true for the rest of the session. */
  justSignedIn: boolean;
  clearJustSignedIn: () => void;
};

const AuthContext = createContext<AuthContextValue>({
  session: null,
  profile: null,
  loading: true,
  refreshProfile: () => {},
  justSignedIn: false,
  clearJustSignedIn: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [justSignedIn, setJustSignedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      if (event === 'SIGNED_IN') setJustSignedIn(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setProfile(data as FullProfile));
  }, [session, refreshTick]);

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        loading,
        refreshProfile: () => setRefreshTick(t => t + 1),
        justSignedIn,
        clearJustSignedIn: () => setJustSignedIn(false),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

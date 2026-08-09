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
};

const AuthContext = createContext<AuthContextValue>({ session: null, profile: null, loading: true, refreshProfile: () => {} });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
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
    <AuthContext.Provider value={{ session, profile, loading, refreshProfile: () => setRefreshTick(t => t + 1) }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

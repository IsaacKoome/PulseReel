import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import type { Session, User } from "@supabase/supabase-js";
import * as WebBrowser from "expo-web-browser";
import { makeRedirectUri } from "expo-auth-session";
import { isSupabaseReady, supabase } from "@/lib/supabase";

WebBrowser.maybeCompleteAuthSession();

type AuthValue = {
  ready: boolean;
  configured: boolean;
  session: Session | null;
  user: User | null;
  completeOAuthCode: (code: string) => Promise<Session>;
  signInWithGoogle: () => Promise<Session | null>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const oauthExchange = useRef<{ code: string; promise: Promise<Session> } | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setReady(true);
      return;
    }

    client.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setReady(true);
    });
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        client.auth.startAutoRefresh();
      } else {
        client.auth.stopAutoRefresh();
      }
    });

    return () => {
      data.subscription.unsubscribe();
      appState.remove();
    };
  }, []);

  const completeOAuthCode = useCallback((code: string) => {
    if (!supabase) {
      throw new Error("Add the Supabase public URL and publishable key to the mobile .env file first.");
    }

    if (oauthExchange.current?.code === code) {
      return oauthExchange.current.promise;
    }

    const promise = supabase.auth.exchangeCodeForSession(code).then(({ data, error }) => {
      if (error) throw error;
      setSession(data.session);
      return data.session;
    });
    oauthExchange.current = { code, promise };
    return promise;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) {
      throw new Error("Add the Supabase public URL and publishable key to the mobile .env file first.");
    }

    const redirectTo = makeRedirectUri({ scheme: "pulsereel", path: "auth/callback" });
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) throw error;
    if (!data.url) throw new Error("Supabase did not return a Google sign-in URL.");

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== "success") return null;

    const code = new URL(result.url).searchParams.get("code");
    if (!code) throw new Error("Google sign-in returned without an authorization code.");
    return completeOAuthCode(code);
  }, [completeOAuthCode]);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    setSession(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      ready,
      configured: isSupabaseReady,
      session,
      user: session?.user ?? null,
      completeOAuthCode,
      signInWithGoogle,
      signOut,
    }),
    [ready, session, completeOAuthCode, signInWithGoogle, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}

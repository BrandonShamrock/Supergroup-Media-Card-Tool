import React, { useEffect, useRef, useState } from "react";
import { supabase, configurationError } from "./supabase";

export function AuthGate({ children, Brand }) {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(Boolean(supabase));
  const [error, setError] = useState(configurationError);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const revision = useRef(0);
  const verified = useRef(null);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const verify = async (candidate, ticket) => {
      try {
        if (candidate?.access_token) {
          // Verify restored credentials with Auth before mounting dashboard content.
          const { data, error: authError } = await supabase.auth.getUser(
            candidate.access_token,
          );
          if (authError || !data.user || data.user.id !== candidate.user?.id)
            throw new Error();
        }
        if (active && ticket === revision.current) {
          verified.current = candidate?.access_token ? candidate : null;
          setSession(verified.current);
          setError("");
        }
      } catch {
        if (active && ticket === revision.current) {
          verified.current = null;
          setSession(null);
          setError("We could not verify your session. Please sign in again.");
        }
      } finally {
        if (active && ticket === revision.current) setChecking(false);
      }
    };
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      const ticket = ++revision.current;
      // Repeated sign-in/refresh events must not discard an in-memory customer import.
      // Keep only an already verified, unexpired session for this same user while rechecking.
      const retained =
        next?.user?.id &&
        verified.current?.user?.id === next.user.id &&
        verified.current.expires_at * 1000 > Date.now();
      if (!retained) {
        verified.current = null;
        setSession(null);
        setChecking(true);
      }
      // Leave the SDK auth callback before making another Auth request.
      setTimeout(() => {
        if (active) void verify(next, ticket);
      }, 0);
    });
    const ticket = revision.current;
    supabase.auth
      .getSession()
      .then(({ data, error: restoreError }) => {
        if (restoreError) throw new Error();
        if (active && ticket === revision.current)
          void verify(data.session, ticket);
      })
      .catch(() => {
        if (active && ticket === revision.current) {
          setSession(null);
          setChecking(false);
          setError("Unable to restore your session. Please sign in again.");
        }
      });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (event) => {
    event.preventDefault();
    if (!supabase || busy) return;
    setBusy(true);
    setError("");
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authError) {
        setError(
          authError.status === 429
            ? "Too many sign-in attempts. Please wait a moment and try again."
            : "Unable to sign in. Check your email and password, or try again shortly.",
        );
      }
    } catch {
      setError(
        "Unable to reach sign-in services. Check your connection and try again.",
      );
    } finally {
      setPassword("");
      setBusy(false);
    }
  };
  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    ++revision.current;
    verified.current = null;
    setSession(null);
    setChecking(false);
    setPassword("");
    try {
      const { error: authError } = await supabase.auth.signOut();
      if (authError) {
        await supabase.auth.signOut({ scope: "local" });
        setError(
          "Signed out on this device. Remote sign-out could not be confirmed.",
        );
      }
    } catch {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      setError(
        "Sign-out could not be confirmed. Close this browser before leaving a shared device.",
      );
    } finally {
      setSigningOut(false);
    }
  };
  if (checking)
    return (
      <main className="auth-loading" role="status">
        Checking your session…
      </main>
    );
  if (session && !signingOut) return children(session, signOut);
  return (
    <div className="login-page">
      <div className="login-story">
        <Brand />
        <div>
          <div className="eyebrow">YOUR STOCK. YOUR AUDIENCE.</div>
          <h1>
            Great vehicles.
            <br />
            Better connections.
          </h1>
          <p>A simpler workspace for your dealership’s next campaign.</p>
        </div>
        <small>Super Group · Dealership marketing workspace</small>
      </div>
      <main className="login-main">
        <form className="login-form" onSubmit={signIn}>
          <h1>Welcome back</h1>
          <p>Sign in to your dealership marketing workspace.</p>
          {error && (
            <div className="alert" role="alert">
              {error}
            </div>
          )}
          <label htmlFor="email">
            Email address
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="name@example.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={!supabase || busy || signingOut}
            />
          </label>
          <label htmlFor="password">
            Password
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={!supabase || busy || signingOut}
            />
          </label>
          <button
            className="button"
            type="submit"
            disabled={!supabase || busy || signingOut}
          >
            {busy ? "Signing in…" : signingOut ? "Signing out…" : "Sign In"}
          </button>
          <small>
            Access is provided by your administrator. Contact them if you need
            an account.
          </small>
        </form>
      </main>
    </div>
  );
}

"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowUpRight, LoaderCircle, ShieldCheck, Workflow } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function checkRecoverySession() {
      try {
        const supabase = createClient();
        const { data, error: userError } = await supabase.auth.getUser();
        if (!cancelled) setRecoveryReady(!userError && Boolean(data.user));
      } catch {
        if (!cancelled) setRecoveryReady(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }
    void checkRecoverySession();
    return () => { cancelled = true; };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (password.length < 8) {
      setError("Choose a password with at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match. Check both fields and try again.");
      return;
    }
    setSaving(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setMessage("Password updated. Opening your workspace…");
      router.replace("/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t update the password. Request a new reset link and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (checking) {
    return <main className="loading-screen"><LoaderCircle className="spin" size={22} /> Checking your password reset link…</main>;
  }

  if (!recoveryReady) {
    return (
      <main className="setup-shell">
        <section className="setup-card">
          <div className="brand-lockup"><span className="brand-mark"><Workflow size={18} /></span><span>small business <strong>agent</strong></span></div>
          <span className="eyebrow">ACCOUNT RECOVERY</span>
          <h1>This reset link has expired</h1>
          <p>For your security, reset links only work for a limited time. Request a new link to continue.</p>
          <a className="btn btn-primary btn-full" href="/login">Request another reset link <ArrowUpRight size={16} /></a>
        </section>
      </main>
    );
  }

  return (
    <main className="setup-shell">
      <form className="setup-card" onSubmit={onSubmit}>
        <div className="brand-lockup"><span className="brand-mark"><Workflow size={18} /></span><span>small business <strong>agent</strong></span></div>
        <span className="eyebrow">ACCOUNT RECOVERY</span>
        <h1>Choose a new password</h1>
        <p>Use at least 8 characters. You’ll sign in to your workspace with this password.</p>
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        {message && <div className="notice notice-success" role="status">{message}</div>}
        <label className="field-label" htmlFor="new-password">New password</label>
        <input className="text-input" id="new-password" name="new-password" type="password" autoComplete="new-password" minLength={8} placeholder="At least 8 characters" value={password} onChange={e => setPassword(e.target.value)} required />
        <label className="field-label" htmlFor="confirm-password">Confirm new password</label>
        <input className="text-input" id="confirm-password" name="confirm-password" type="password" autoComplete="new-password" minLength={8} placeholder="Enter the password again" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
        <button className="btn btn-primary btn-full btn-large" type="submit" disabled={saving}>
          {saving ? "Saving password…" : "Update password"} {!saving && <ArrowUpRight size={17} />}
        </button>
        <div className="auth-security"><ShieldCheck size={16} /><span>Password changes are handled securely by Supabase Auth.</span></div>
      </form>
    </main>
  );
}

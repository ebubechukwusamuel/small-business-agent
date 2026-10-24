"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ShieldCheck, Sparkles, Workflow } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

  async function resendConfirmation() {
    if (!email.trim()) {
      setError("Enter your email address first.");
      return;
    }
    if (!configured) {
      setError("Supabase is not configured yet.");
      return;
    }
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const supabase = createClient();
      const redirectBase = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\\/+$/, "") || window.location.origin;
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email: email.trim(),
        options: { emailRedirectTo: redirectBase + "/auth/callback" },
      });
      if (resendError) throw resendError;
      setMessage("A new verification email has been requested. Use the newest email and ignore the old localhost link.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't request another verification email.");
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!configured) {
      setError("Connect the new Supabase project first. Copy its URL and publishable key into .env.local.");
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      if (mode === "signin") {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
        router.replace("/dashboard");
        router.refresh();
      } else {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: (process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || window.location.origin) + "/auth/callback" },
        });
        if (authError) throw authError;
        if (!data.session) {
          setMessage("Your account request is saved. Check your email for the confirmation link, then sign in.");
        } else {
          router.replace("/dashboard");
          router.refresh();
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-story">
        <a className="brand-lockup brand-lockup-light" href="/" aria-label="Small Business Agent home">
          <span className="brand-mark"><Workflow size={19} strokeWidth={2.4} /></span>
          <span>small business <strong>agent</strong></span>
        </a>
        <div className="auth-story-content">
          <div className="eyebrow eyebrow-light"><span className="eyebrow-dot" /> LEAD WORKFLOW, WITHOUT THE BUSYWORK</div>
          <h1>Keep every lead moving.</h1>
          <p className="auth-lede">A calmer way to organise prospects, capture research, and prepare thoughtful follow-ups without losing the human decision.</p>
          <div className="story-steps">
            <div className="story-step"><span className="story-step-icon"><Sparkles size={18} /></span><span><strong>Understand the prospect</strong><small>Keep notes and sources beside each lead.</small></span><ArrowUpRight size={16} className="story-arrow" /></div>
            <div className="story-step"><span className="story-step-icon"><Workflow size={18} /></span><span><strong>Prepare the next step</strong><small>Start with a template or a configured AI draft.</small></span><ArrowUpRight size={16} className="story-arrow" /></div>
            <div className="story-step"><span className="story-step-icon"><ShieldCheck size={18} /></span><span><strong>Approve before sending</strong><small>Drafts stay drafts until a person reviews them.</small></span><ArrowUpRight size={16} className="story-arrow" /></div>
          </div>
        </div>
        <div className="auth-story-footer"><span>Made for small teams</span><span>Human approval stays in control</span></div>
      </section>

      <section className="auth-panel-wrap">
        <div className="auth-panel">
          <div className="auth-panel-heading">
            <div className="eyebrow">YOUR WORKSPACE</div>
            <h2>{mode === "signin" ? "Welcome back" : "Create your account"}</h2>
            <p>{mode === "signin" ? "Sign in to pick up where your team left off." : "Start organising your leads in one place."}</p>
          </div>
          {!configured && <div className="notice notice-warning"><strong>Setup needed</strong><span>Supabase connection values are not configured yet. The app will become available once .env.local is filled in.</span></div>}
          {error && <div className="notice notice-error" role="alert">{error}</div>}
          {message && <div className="notice notice-success" role="status">{message}</div>}
          <form className="auth-form" onSubmit={onSubmit}>
            <label className="field-label" htmlFor="email">Work email</label>
            <input id="email" className="text-input" type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} required />
            <div className="field-label-row"><label className="field-label" htmlFor="password">Password</label>{mode === "signin" && <span className="field-hint">Use your account password</span>}</div>
            <input id="password" className="text-input" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={8} placeholder="At least 8 characters" value={password} onChange={e => setPassword(e.target.value)} required />
            <button className="btn btn-primary btn-full btn-large" type="submit" disabled={loading}>
              {loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
              {!loading && <ArrowUpRight size={17} />}
            </button>
          </form>
          <div className="auth-switch">{mode === "signin" ? "New to Small Business Agent?" : "Already have an account?"} <button type="button" className="link-button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setMessage(""); }}>{mode === "signin" ? "Create an account" : "Sign in"}</button></div>
          <div className="auth-switch"><button type="button" className="link-button" disabled={loading || !email.trim()} onClick={resendConfirmation}>Resend verification email</button></div>
          <div className="auth-security"><ShieldCheck size={16} /><span>Your leads are private to your workspace. Follow-up sending is not connected.</span></div>
        </div>
        <p className="auth-panel-footer">A practical workspace for the work that happens after a new lead comes in.</p>
      </section>
    </main>
  );
}

"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ShieldCheck, Sparkles, Workflow } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [businessProfile, setBusinessProfile] = useState({
    businessName: "",
    industry: "",
    website: "",
    offering: "",
    idealCustomer: "",
    differentiator: "",
    voice: "friendly and conversational",
    callToAction: "book a short discovery call",
  });
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
      const redirectBase = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || window.location.origin;
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email: email.trim(),
        options: { emailRedirectTo: redirectBase + "/auth/callback" },
      });
      if (resendError) throw resendError;
      setMessage("A new verification email has been requested. Check your inbox and spam folder for the newest message.");
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
      setError("Supabase is not configured yet. Add the project URL and publishable key to the deployment environment variables.");
      return;
    }
    if (mode === "signup") {
      if (!businessProfile.businessName.trim() || !businessProfile.industry.trim() || !businessProfile.offering.trim() || !businessProfile.idealCustomer.trim()) {
        setError("Complete your business name, industry, what you offer, and ideal customer before creating an account.");
        return;
      }
    }
    setLoading(true);
    try {
      const supabase = createClient();
      if (recoveryMode) {
        const redirectBase = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || window.location.origin;
        const { error: recoveryError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: redirectBase + "/auth/callback?next=%2Freset-password",
        });
        if (recoveryError) throw recoveryError;
        setMessage("If an account exists for this email, a password reset link will arrive shortly.");
        return;
      }
      if (mode === "signin") {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
        router.replace("/dashboard");
        router.refresh();
      } else {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: (process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || window.location.origin) + "/auth/callback",
            data: {
              business_name: businessProfile.businessName.trim(),
              business_profile: {
                industry: businessProfile.industry.trim(),
                website: businessProfile.website.trim(),
                offering: businessProfile.offering.trim(),
                ideal_customer: businessProfile.idealCustomer.trim(),
                differentiator: businessProfile.differentiator.trim(),
                voice: businessProfile.voice,
                call_to_action: businessProfile.callToAction,
              },
            },
          },
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
          <a className="brand-lockup auth-mobile-brand" href="/" aria-label="Small Business Agent home"><span className="brand-mark"><Workflow size={18} strokeWidth={2.4} /></span><span>small business <strong>agent</strong></span></a>
          <div className="auth-panel-heading">
            <div className="eyebrow">YOUR WORKSPACE</div>
            <h2>{recoveryMode ? "Reset your password" : mode === "signin" ? "Welcome back" : "Create your account"}</h2>
            <p>{recoveryMode ? "Enter your account email and we’ll send a secure reset link if it’s registered." : mode === "signin" ? "Sign in to pick up where your team left off." : "Start organising your leads in one place."}</p>
          </div>
          {!configured && <div className="notice notice-warning"><strong>Setup needed</strong><span>Supabase connection values are not configured yet. Add the Supabase project URL and publishable key to the deployment environment variables.</span></div>}
          {error && <div className="notice notice-error" role="alert">{error}</div>}
          {message && <div className="notice notice-success" role="status">{message}</div>}
          <form className="auth-form" onSubmit={onSubmit}>
            {mode === "signup" && <section className="onboarding-fields">
              <div className="onboarding-intro">
                <div className="eyebrow">ABOUT YOUR BUSINESS</div>
                <p>Answer these first. The AI will use this context to write emails that sound like your business, not a generic template.</p>
              </div>
              <label className="field-label" htmlFor="businessName">Business or team name *</label>
              <input id="businessName" className="text-input" autoComplete="organization" placeholder="e.g. Mazion" maxLength={100} value={businessProfile.businessName} onChange={e => setBusinessProfile({ ...businessProfile, businessName: e.target.value })} required />
              <label className="field-label" htmlFor="industry">Industry *</label>
              <input id="industry" className="text-input" placeholder="e.g. Marketing, logistics, healthcare" maxLength={120} value={businessProfile.industry} onChange={e => setBusinessProfile({ ...businessProfile, industry: e.target.value })} required />
              <label className="field-label" htmlFor="website">Website (optional)</label>
              <input id="website" className="text-input" type="url" placeholder="https://yourbusiness.com" value={businessProfile.website} onChange={e => setBusinessProfile({ ...businessProfile, website: e.target.value })} />
              <label className="field-label" htmlFor="offering">What do you sell or help people with? *</label>
              <textarea id="offering" className="text-input" rows={3} maxLength={1200} placeholder="Describe your products or services in simple words." value={businessProfile.offering} onChange={e => setBusinessProfile({ ...businessProfile, offering: e.target.value })} required />
              <label className="field-label" htmlFor="idealCustomer">Who is your ideal customer? *</label>
              <textarea id="idealCustomer" className="text-input" rows={2} maxLength={800} placeholder="e.g. Small B2B service businesses, founders, or operations leads." value={businessProfile.idealCustomer} onChange={e => setBusinessProfile({ ...businessProfile, idealCustomer: e.target.value })} required />
              <label className="field-label" htmlFor="differentiator">Why do customers choose you? (optional)</label>
              <textarea id="differentiator" className="text-input" rows={2} maxLength={800} placeholder="Your strengths, results, or what makes your offer different." value={businessProfile.differentiator} onChange={e => setBusinessProfile({ ...businessProfile, differentiator: e.target.value })} />
              <div className="two-col">
                <label className="field-label" htmlFor="voice">Writing style
                  <select id="voice" className="text-input" value={businessProfile.voice} onChange={e => setBusinessProfile({ ...businessProfile, voice: e.target.value })}>
                    <option value="friendly and conversational">Friendly and conversational</option>
                    <option value="professional and direct">Professional and direct</option>
                    <option value="warm and helpful">Warm and helpful</option>
                    <option value="confident and concise">Confident and concise</option>
                  </select>
                </label>
                <label className="field-label" htmlFor="callToAction">Preferred next step
                  <select id="callToAction" className="text-input" value={businessProfile.callToAction} onChange={e => setBusinessProfile({ ...businessProfile, callToAction: e.target.value })}>
                    <option value="book a short discovery call">Book a short call</option>
                    <option value="reply to this email">Reply to the email</option>
                    <option value="view the website">Visit the website</option>
                    <option value="request a quote">Request a quote</option>
                  </select>
                </label>
              </div>
              <p className="onboarding-privacy">These answers become your workspace context. You can change them later in Settings.</p>
            </section>}
            {mode === "signup" && <div className="auth-section-heading">Create your login</div>}
            <label className="field-label" htmlFor="email">Work email</label>
            <input id="email" name="email" className="text-input" type="email" autoComplete="email" spellCheck={false} placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} required />
            {!recoveryMode && <>
              <div className="field-label-row"><label className="field-label" htmlFor="password">Password</label>{mode === "signin" && <button type="button" className="link-button" onClick={() => { setRecoveryMode(true); setError(""); setMessage(""); }} disabled={loading}>Forgot password?</button>}</div>
              <input id="password" name="password" className="text-input" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={8} placeholder="At least 8 characters" value={password} onChange={e => setPassword(e.target.value)} required />
            </>}
            <button className="btn btn-primary btn-full btn-large" type="submit" disabled={loading}>
              {loading ? "Please wait…" : recoveryMode ? "Send reset link" : mode === "signin" ? "Sign in" : "Create account"}
              {!loading && <ArrowUpRight size={17} />}
            </button>
          </form>
          <div className="auth-switch">{recoveryMode ? "Remembered your password?" : mode === "signin" ? "New to Small Business Agent?" : "Already have an account?"} <button type="button" className="link-button" onClick={() => { if (recoveryMode) { setRecoveryMode(false); setMode("signin"); } else { setMode(mode === "signin" ? "signup" : "signin"); } setError(""); setMessage(""); }}>{recoveryMode ? "Back to sign in" : mode === "signin" ? "Create an account" : "Sign in"}</button></div>
          {!recoveryMode && <div className="auth-switch"><button type="button" className="link-button" disabled={loading || !email.trim()} onClick={resendConfirmation}>Resend verification email</button></div>}
          <div className="auth-security"><ShieldCheck size={16} /><span>Your leads are private to your workspace. Follow-up messages stay drafts until you approve them.</span></div>
        </div>
        <p className="auth-panel-footer">A practical workspace for the work that happens after a new lead comes in.</p>
      </section>
    </main>
  );
}

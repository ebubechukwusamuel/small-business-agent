"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowUpRight, Building2, Check, Clock3, FileText, LoaderCircle, LogOut, Mail, Plus, Search, ShieldCheck, Sparkles, Upload, Users, Workflow, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type BusinessProfile = {
  industry?: string;
  website?: string;
  offering?: string;
  ideal_customer?: string;
  differentiator?: string;
  voice?: string;
  call_to_action?: string;
};
type Workspace = { id: string; name: string; slug: string; role: string; business_profile?: BusinessProfile };
type GmailStatus = { configured: boolean; connected: boolean; email: string | null; scopes?: string[]; connectedAt?: string | null; reason?: string };
type Lead = { id: string; workspace_id: string; company_name: string; contact_name: string | null; email: string | null; phone: string | null; website: string | null; linkedin_url: string | null; source_type: string; status: string; notes: string | null; created_at: string };
type Draft = { id: string; workspace_id: string; lead_id: string; subject: string; body: string; status: string; generation_method: string; created_at: string; rejection_reason: string | null; send_provider?: string | null; provider_message_id?: string | null; sent_at?: string | null; leads?: { company_name?: string; contact_name?: string | null; email?: string | null } | null };
type IntegrationStatus = {
  ai: { authConfigured: boolean; modelConfigured: boolean; model: string | null; ready: boolean };
  apollo: {
    apiKeyConfigured: boolean;
    mailboxCount: number;
    defaultMailbox: { id: string; email: string; name?: string | null } | null;
    sequenceConfigured: boolean;
    liveSendReady: boolean;
    sequenceReadyForEnrollment: boolean;
    canActivateSequence: boolean;
    sequenceTemplatesApproved: boolean;
    sequenceActiveContacts: number;
    connectionError: string | null;
    sequenceActive?: boolean | null;
    sequenceName?: string | null;
  };
};
type ActivityRow = { id: string; event_type: string; details: Record<string, unknown>; created_at: string; lead_id: string | null };
type Modal = "lead" | "import" | "research" | "draft" | null;

function firstName(value: string | null) { return value?.trim().split(/\s+/)[0] || ""; }
function initials(value: string) { return value.trim().split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase()).join("") || "SB"; }
function dateLabel(value: string) { return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
function label(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, s => s.toUpperCase()); }
function badge(value: string) { return "status-badge " + (["approved", "sent", "reply_received", "completed", "researched"].includes(value) ? "good" : ["pending_approval", "pending", "draft_pending"].includes(value) ? "waiting" : value === "rejected" ? "bad" : "neutral"); }
function parseCsv(text: string): string[][] {
  const result: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (c === "," && !quoted) { row.push(field.trim()); field = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) { if (c === "\r" && text[i + 1] === "\n") i++; row.push(field.trim()); if (row.some(Boolean)) result.push(row); row = []; field = ""; }
    else field += c;
  }
  row.push(field.trim()); if (row.some(Boolean)) result.push(row); return result;
}

export default function Dashboard() {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [lead, setLead] = useState({ company_name: "", contact_name: "", email: "", phone: "", website: "", notes: "" });
  const [research, setResearch] = useState({ summary: "", notes: "", urls: "" });
  const [draft, setDraft] = useState({ subject: "", body: "", method: "template" });
  const [aiModel, setAiModel] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(null);
  const [integrationsLoading, setIntegrationsLoading] = useState(false);
  const [sendBusyDraftId, setSendBusyDraftId] = useState<string | null>(null);
  const [sequenceBusyLeadId, setSequenceBusyLeadId] = useState<string | null>(null);
  const [sequenceActivationBusy, setSequenceActivationBusy] = useState(false);
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [businessProfileForm, setBusinessProfileForm] = useState<BusinessProfile>({
    industry: "", website: "", offering: "", ideal_customer: "", differentiator: "",
    voice: "friendly and conversational", call_to_action: "book a short discovery call",
  });
  const [profileSaving, setProfileSaving] = useState(false);

  const workspace = workspaces.find(w => w.id === workspaceId) || null;
  const canApprove = workspace?.role === "owner" || workspace?.role === "admin";
  const pendingDrafts = drafts.filter(d => d.status === "pending_approval");
  const filteredLeads = leads.filter(l => [l.company_name, l.contact_name, l.email, l.website].some(v => v?.toLowerCase().includes(search.toLowerCase())));

  const notify = (text: string, isError = false) => { setMessage(text); setError(isError ? text : ""); };

  const loadIntegrationStatus = useCallback(async () => {
    setIntegrationsLoading(true);
    try {
      const response = await fetch("/api/integrations/status", { cache: "no-store" });
      const result = await response.json();
      if (response.ok) setIntegrations(result as IntegrationStatus);
      else setIntegrations(null);
    } catch {
      setIntegrations(null);
    } finally {
      setIntegrationsLoading(false);
    }
  }, []);

  const loadGmailStatus = useCallback(async () => {
    setGmailLoading(true);
    try {
      const response = await fetch("/api/gmail/status", { cache: "no-store" });
      const result = await response.json();
      if (response.ok) setGmailStatus(result as GmailStatus);
      else setGmailStatus(null);
    } catch {
      setGmailStatus(null);
    } finally {
      setGmailLoading(false);
    }
  }, []);

  const loadWorkspace = useCallback(async (id: string) => {
    const [l, d, a] = await Promise.all([
      supabase.from("leads").select("id,workspace_id,company_name,contact_name,email,phone,website,linkedin_url,source_type,status,notes,created_at").eq("workspace_id", id).order("created_at", { ascending: false }).limit(300),
      supabase.from("follow_up_drafts").select("id,workspace_id,lead_id,subject,body,status,generation_method,created_at,rejection_reason,send_provider,provider_message_id,sent_at,leads(company_name,contact_name,email)").eq("workspace_id", id).order("created_at", { ascending: false }).limit(150),
      supabase.from("lead_activity").select("id,event_type,details,created_at,lead_id").eq("workspace_id", id).order("created_at", { ascending: false }).limit(100),
    ]);
    if (l.error) notify("Couldn't load leads: " + l.error.message, true); else setLeads((l.data || []) as Lead[]);
    if (d.error) notify("Couldn't load drafts: " + d.error.message, true); else setDrafts((d.data || []) as Draft[]);
    if (a.error) notify("Couldn't load activity: " + a.error.message, true); else setActivity((a.data || []) as ActivityRow[]);
  }, [supabase]);

  const initialize = useCallback(async () => {
    setLoading(true);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) { window.location.replace("/login"); return; }
    setUserId(user.id); setEmail(user.email || "");
    const { data: memberships, error: memberError } = await supabase.from("workspace_members").select("workspace_id,role").eq("user_id", user.id);
    if (memberError) { notify("Couldn't load your workspaces: " + memberError.message, true); setLoading(false); return; }
    const ids = (memberships || []).map((m: { workspace_id: string }) => m.workspace_id);
    if (ids.length) {
      const { data: rows, error: workspaceError } = await supabase.from("workspaces").select("id,name,slug,business_profile").in("id", ids).order("created_at", { ascending: true });
      if (workspaceError) notify("Couldn't load workspace details: " + workspaceError.message, true);
      const roles = new Map((memberships || []).map((m: { workspace_id: string; role: string }) => [m.workspace_id, m.role]));
      const list = (rows || []).map((r: { id: string; name: string; slug: string; business_profile?: BusinessProfile }) => ({ ...r, role: String(roles.get(r.id) || "member"), business_profile: r.business_profile || {} }));
      setWorkspaces(list); if (list.length) setWorkspaceId(current => current || list[0].id);
    } else {
      const metadata = (user.user_metadata || {}) as Record<string, unknown>;
      const profile = metadata.business_profile && typeof metadata.business_profile === "object"
        ? metadata.business_profile as BusinessProfile
        : null;
      const businessName = typeof metadata.business_name === "string" ? metadata.business_name.trim() : "";
      if (businessName && profile) {
        const slug = businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + crypto.randomUUID().slice(0, 5);
        const { data: createdData, error: createError } = await supabase.rpc("create_workspace", {
          p_name: businessName,
          p_slug: slug,
          p_business_profile: profile,
        });
        const createdRow = Array.isArray(createdData) ? createdData[0] : createdData;
        if (!createError && createdRow?.id) {
          const createdWorkspace = { ...createdRow, role: "owner", business_profile: profile } as Workspace;
          setWorkspaces([createdWorkspace]);
          setWorkspaceId(createdWorkspace.id);
          setBusinessProfileForm(profile);
          setNewWorkspaceName(businessName);
          notify("Your business workspace is ready.");
        } else {
          setBusinessProfileForm(profile);
          setNewWorkspaceName(businessName);
          notify("Your account is ready, but automatic workspace setup needs one more try. Use Create workspace below.", true);
        }
      } else {
        setNewWorkspaceName(businessName);
        setBusinessProfileForm(profile || {});
      }
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void initialize(); }, [initialize]);
  useEffect(() => { if (workspaceId) void loadWorkspace(workspaceId); }, [workspaceId, loadWorkspace]);
  useEffect(() => { void loadGmailStatus(); }, [loadGmailStatus]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmailState = params.get("gmail");
    if (gmailState === "connected") notify("Gmail connected successfully. AI drafts can now use relevant email history.");
    else if (gmailState === "setup-required") notify("Gmail connection is not configured by the app owner yet. See Settings for the required setup.", true);
    else if (gmailState === "consent-denied") notify("Gmail connection was cancelled. No email account was connected.", true);
    else if (gmailState && gmailState !== "connected") notify("Gmail connection did not finish (" + gmailState.replaceAll("-", " ") + "). Check the Google OAuth setup.", true);
    if (gmailState) {
      params.delete("gmail");
      const query = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (query ? "?" + query : "") + window.location.hash);
      void loadGmailStatus();
    }
  }, [loadGmailStatus]);
  useEffect(() => {
    const selectedWorkspace = workspaces.find(item => item.id === workspaceId);
    if (selectedWorkspace) {
      setBusinessProfileForm({
        industry: "",
        website: "",
        offering: "",
        ideal_customer: "",
        differentiator: "",
        voice: "friendly and conversational",
        call_to_action: "book a short discovery call",
        ...(selectedWorkspace.business_profile || {}),
      });
    }
  }, [workspaceId, workspaces]);
  useEffect(() => { void loadIntegrationStatus(); }, [loadIntegrationStatus]);

  async function recordActivity(type: string, details: Record<string, unknown>, leadId: string | null = null) {
    if (!workspaceId || !userId) return;
    const { error: activityError } = await supabase.from("lead_activity").insert({ workspace_id: workspaceId, lead_id: leadId, actor_id: userId, event_type: type, details });
    if (activityError) console.warn("Activity was not recorded:", activityError.message);
  }

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newWorkspaceName.trim()) return;
    setBusy(true);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error("Your session has expired. Sign in again before creating a workspace.");
      setUserId(user.id);
      const slug = newWorkspaceName.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + crypto.randomUUID().slice(0, 5);
      // The database derives owner_id from auth.uid() inside an invoker-rights RPC.
      // This avoids trusting a potentially stale client-side userId state value.
      const { data, error: insertError } = await supabase.rpc("create_workspace", {
        p_name: newWorkspaceName.trim(),
        p_slug: slug,
        p_business_profile: businessProfileForm,
      });
      if (insertError) throw insertError;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.id) throw new Error("The database did not return the new workspace. Refresh and try again.");
      const created = { ...row, role: "owner", business_profile: businessProfileForm } as Workspace;
      setWorkspaces(current => [...current.filter(w => w.id !== created.id), created]);
      setWorkspaceId(created.id);
      notify("Workspace created.");
    } catch (e) {
      const detail = e instanceof Error
        ? e.message
        : e && typeof e === "object" && "message" in e
          ? String((e as { message?: unknown }).message || "")
          : "";
      notify(detail ? "Couldn't create workspace: " + detail : "Couldn't create workspace. Please refresh and try again.", true);
    } finally {
      setBusy(false);
    }
  }

  async function saveLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!workspaceId || !userId) return; setBusy(true);
    try {
      const payload = { workspace_id: workspaceId, created_by: userId, company_name: lead.company_name.trim(), contact_name: lead.contact_name.trim() || null, email: lead.email.trim().toLowerCase() || null, phone: lead.phone.trim() || null, website: lead.website.trim() || null, notes: lead.notes.trim() || null, source_type: "manual" };
      const { data, error: insertError } = await supabase.from("leads").insert(payload).select("id").single();
      if (insertError) throw insertError;
      await recordActivity("lead_created", { company_name: payload.company_name }, data.id);
      setLead({ company_name: "", contact_name: "", email: "", phone: "", website: "", notes: "" }); setModal(null); notify("Lead added."); await loadWorkspace(workspaceId);
    } catch (e) { notify(e instanceof Error && "code" in e && (e as {code?: string}).code === "23505" ? "That email already exists in this workspace." : e instanceof Error ? e.message : "Couldn't add lead.", true); }
    finally { setBusy(false); }
  }

  async function importCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!csvFile || !workspaceId || !userId) return; setBusy(true);
    try {
      const rows = parseCsv(await csvFile.text());
      if (rows.length < 2) throw new Error("CSV needs a header and at least one data row.");
      if (rows.length > 301) throw new Error("Import is limited to 300 leads per file.");
      const headers = rows[0].map(v => v.toLowerCase().replace(/[\s_-]+/g, ""));
      const find = (...names: string[]) => headers.findIndex(h => names.includes(h));
      const companyIx = find("company", "companyname", "business", "businessname", "organization");
      if (companyIx < 0) throw new Error("CSV needs a Company or Company Name column.");
      const idx = { contact: find("contactname", "fullname", "contact"), email: find("email", "emailaddress", "workemail"), phone: find("phone", "telephone", "mobile"), website: find("website", "url"), linkedin: find("linkedin", "linkedinurl"), notes: find("notes", "description") };
      let created = 0, skipped = 0, failed = 0;
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i]; const company = row[companyIx]?.trim();
        if (!company) { failed++; continue; }
        const at = (n: number) => n >= 0 ? (row[n]?.trim() || null) : null;
        const { error: rowError } = await supabase.from("leads").insert({ workspace_id: workspaceId, created_by: userId, company_name: company, contact_name: at(idx.contact), email: at(idx.email)?.toLowerCase() || null, phone: at(idx.phone), website: at(idx.website), linkedin_url: at(idx.linkedin), notes: at(idx.notes), source_type: "csv" });
        if (!rowError) created++; else if (rowError.code === "23505") skipped++; else failed++;
      }
      await supabase.from("lead_imports").insert({ workspace_id: workspaceId, source_filename: csvFile.name, status: failed && !created ? "failed" : "completed", total_rows: rows.length - 1, created_rows: created, skipped_rows: skipped, failed_rows: failed, row_errors: [], created_by: userId, completed_at: new Date().toISOString() });
      await recordActivity("lead_imported", { filename: csvFile.name, created, skipped, failed });
      setCsvFile(null); setModal(null); notify("Import finished: " + created + " added, " + skipped + " duplicates skipped, " + failed + " failed."); await loadWorkspace(workspaceId);
    } catch (e) { notify(e instanceof Error ? e.message : "Couldn't import CSV.", true); }
    finally { setBusy(false); }
  }

  function openResearch(l: Lead) { setSelected(l); setResearch({ summary: "", notes: "", urls: "" }); setModal("research"); }
  async function saveResearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected || !workspaceId || !userId) return; setBusy(true);
    try {
      const urls = research.urls.split(/\n|,/).map(s => s.trim()).filter(Boolean).map(s => /^https?:\/\//i.test(s) ? s : "https://" + s);
      const now = new Date().toISOString();
      const { error: insertError } = await supabase.from("lead_research").insert({ workspace_id: workspaceId, lead_id: selected.id, requested_by: userId, status: "completed", summary: research.summary.trim() || "Manual research notes", findings: { notes: research.notes.trim() }, source_urls: urls, provider: "manual", requested_at: now, completed_at: now });
      if (insertError) throw insertError;
      await supabase.from("leads").update({ status: "researched" }).eq("id", selected.id).eq("workspace_id", workspaceId);
      await recordActivity("note_added", { summary: research.summary.trim() }, selected.id);
      setModal(null); notify("Research notes saved."); await loadWorkspace(workspaceId);
    } catch (e) { notify(e instanceof Error ? e.message : "Couldn't save research notes.", true); }
    finally { setBusy(false); }
  }

  function openDraft(l: Lead) {
    setSelected(l); setAiModel("");
    const name = firstName(l.contact_name);
    setDraft({ method: "template", subject: "A quick introduction for " + l.company_name, body: (name ? "Hi " + name + "," : "Hello,") + "\n\nI came across " + l.company_name + " and wanted to introduce myself. I work with small teams on practical ways to keep their customer and follow-up workflows organised.\n\nIf improving this part of your process is on your radar, would you be open to a short conversation?\n\nBest,\n[Your name]" });
    setModal("draft");
  }
  async function generateAiDraft() {
    if (!selected || !workspaceId) return; setBusy(true);
    try {
      const response = await fetch("/api/ai-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId: selected.id, workspaceId }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "AI drafting failed.");
      setDraft({ subject: result.subject, body: result.body, method: "ai" }); setAiModel(typeof result.model === "string" ? result.model : "");
      const count = Number(result.contextUsed?.priorEmails || 0);
      const usedProfile = Boolean(result.contextUsed?.businessProfile);
      const historyNote = count > 0 ? " It used " + count + " recent email(s) from your connected Gmail." : gmailStatus?.connected ? " No matching prior emails were found for this lead." : " Connect Gmail if you want AI to use your previous emails.";
      notify("AI draft created for review" + (usedProfile ? " using your business profile." : ".") + historyNote + " It has not been sent.");
    } catch (e) { notify(e instanceof Error ? e.message : "AI drafting is not available.", true); }
    finally { setBusy(false); }
  }
  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected || !workspaceId || !userId) return; setBusy(true);
    try {
      const { data, error: insertError } = await supabase.from("follow_up_drafts").insert({ workspace_id: workspaceId, lead_id: selected.id, created_by: userId, subject: draft.subject.trim(), body: draft.body.trim(), status: "pending_approval", generation_method: draft.method, ai_model: draft.method === "ai" ? aiModel || null : null }).select("id").single();
      if (insertError) throw insertError;
      await supabase.from("leads").update({ status: "draft_pending" }).eq("id", selected.id).eq("workspace_id", workspaceId);
      await recordActivity("draft_created", { subject: draft.subject, generation_method: draft.method }, selected.id);
      setModal(null); setTab("followups"); notify("Draft saved for approval. Nothing has been sent."); await loadWorkspace(workspaceId);
    } catch (e) { notify(e instanceof Error ? e.message : "Couldn't save draft.", true); }
    finally { setBusy(false); }
  }

  async function reviewDraft(d: Draft, decision: "approved" | "rejected") {
    if (!canApprove || !userId || !workspaceId) return;
    const reason = decision === "rejected" ? (window.prompt("Optional reason for rejection?") || "").trim() || null : null;
    setBusy(true);
    try {
      const update = decision === "approved" ? { status: "approved", approved_by: userId, approved_at: new Date().toISOString() } : { status: "rejected", rejected_by: userId, rejected_at: new Date().toISOString(), rejection_reason: reason };
      const { error: updateError } = await supabase.from("follow_up_drafts").update(update).eq("id", d.id).eq("workspace_id", workspaceId);
      if (updateError) throw updateError;
      if (decision === "approved") await supabase.from("leads").update({ status: "approved" }).eq("id", d.lead_id).eq("workspace_id", workspaceId);
      await recordActivity(decision === "approved" ? "draft_approved" : "draft_rejected", { subject: d.subject }, d.lead_id);
      notify(decision === "approved" ? "Draft approved. Sending is still disabled." : "Draft rejected."); await loadWorkspace(workspaceId);
    } catch (e) { notify(e instanceof Error ? e.message : "Couldn't update draft.", true); }
    finally { setBusy(false); }
  }
  async function sendApprovedDraft(d: Draft) {
    const recipient = d.leads?.email?.trim();
    if (!recipient) {
      notify("This lead has no email address.", true);
      return;
    }
    if (/\.(example|test|invalid)$/i.test(recipient.split("@")[1] || "") || /@example\.(com|org|net)$/i.test(recipient)) {
      notify("This is fictional demo data. Sending is blocked for demo addresses.", true);
      return;
    }
    if (!gmailStatus?.connected) {
      setTab("settings");
      await loadGmailStatus();
      notify("Connect your Gmail account in Settings before sending.", true);
      return;
    }
    const confirmed = window.confirm(
      "Send this approved email using " + gmailStatus.email + "?\n\nTo: " + recipient + "\nSubject: " + d.subject +
      "\n\nThis sends a real email from your Gmail account. Continue only if you have permission to contact this person."
    );
    if (!confirmed) return;

    setSendBusyDraftId(d.id);
    try {
      const response = await fetch("/api/gmail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: d.id, workspaceId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Gmail sending failed.");
      notify(result.message || "Gmail accepted the email.");
      await loadWorkspace(workspaceId);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Gmail sending failed.", true);
      if (gmailStatus?.connected) {
        notify((e instanceof Error ? e.message : "Gmail sending failed.") + " If Gmail may have accepted the message, check Sent before retrying.", true);
      }
    } finally {
      setSendBusyDraftId(null);
    }
  }

  async function activateOutreachSequence() {
    const sequenceName = integrations?.apollo.sequenceName || "Mazion | AI Automation | B2B Services";
    const activeContacts = integrations?.apollo.sequenceActiveContacts ?? 0;
    const warning = activeContacts > 0
      ? "\n\nThere are " + activeContacts + " contact(s) already in the sequence. Activation can start scheduled sends to those contacts."
      : "\n\nNo active contacts are currently reported, but activation will allow future enrollments to send.";
    const confirmed = window.confirm(
      "Activate the Apollo outreach sequence “" + sequenceName + "”?\n\nThis enables real scheduled emails for enrolled contacts. We will not enroll anyone automatically." + warning
    );
    if (!confirmed) return;
    setSequenceActivationBusy(true);
    try {
      const response = await fetch("/api/apollo/sequence/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, confirmed: true }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Sequence activation failed.");
      notify(result.active ? "Apollo outreach sequence is active." : "Apollo accepted activation. Refresh to verify its state.");
      await loadIntegrationStatus();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Sequence activation failed.", true);
      await loadIntegrationStatus();
    } finally {
      setSequenceActivationBusy(false);
    }
  }

  async function enrollLeadInSequence(leadRow: Lead) {
    const recipient = leadRow.email?.trim();
    if (!recipient) {
      notify("This lead has no email address.", true);
      return;
    }
    if (/\.(example|test|invalid)$/i.test(recipient.split("@")[1] || "") || /@example\.(com|org|net)$/i.test(recipient)) {
      notify("This is fictional demo data. Enrollment and sending are blocked for demo addresses.", true);
      return;
    }
    const sender = integrations?.apollo.defaultMailbox?.email || "Apollo default sender";
    const sequenceName = integrations?.apollo.sequenceName || "Mazion | AI Automation | B2B Services";
    const confirmed = window.confirm(
      "Enroll this lead in the active Apollo outreach sequence?\n\nFrom: " + sender +
      "\nTo: " + recipient + "\nSequence: " + sequenceName +
      "\n\nApollo will start its scheduled first step and later steps. It may send real emails. Only continue if this person is appropriate to contact."
    );
    if (!confirmed) return;
    setSequenceBusyLeadId(leadRow.id);
    try {
      const response = await fetch("/api/apollo/sequence/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: leadRow.id, workspaceId, confirmed: true }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Sequence enrollment failed.");
      notify("Lead enrolled in the Apollo sequence. Apollo will manage its schedule and reply rules.");
      await loadWorkspace(workspaceId);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Sequence enrollment failed.", true);
    } finally {
      setSequenceBusyLeadId(null);
    }
  }

  async function refreshApprovedDraftStatus(d: Draft) {
    setSendBusyDraftId(d.id);
    try {
      const response = await fetch("/api/send-email/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: d.id, workspaceId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Couldn't refresh send status.");
      notify(result.state === "delivered" ? "Apollo confirmed delivery." : "The email is still being processed by Apollo.");
      await loadWorkspace(workspaceId);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn't refresh send status.", true);
    } finally {
      setSendBusyDraftId(null);
    }
  }

  async function saveBusinessProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !canApprove) {
      notify("Only a workspace owner or admin can update business context.", true);
      return;
    }
    setProfileSaving(true);
    try {
      const profile = {
        industry: (businessProfileForm.industry || "").trim(),
        website: (businessProfileForm.website || "").trim(),
        offering: (businessProfileForm.offering || "").trim(),
        ideal_customer: (businessProfileForm.ideal_customer || "").trim(),
        differentiator: (businessProfileForm.differentiator || "").trim(),
        voice: businessProfileForm.voice || "friendly and conversational",
        call_to_action: businessProfileForm.call_to_action || "book a short discovery call",
      };
      const { error: updateError } = await supabase
        .from("workspaces")
        .update({ business_profile: profile })
        .eq("id", workspaceId);
      if (updateError) throw updateError;
      setWorkspaces(current => current.map(item => item.id === workspaceId ? { ...item, business_profile: profile } : item));
      await recordActivity("business_profile_updated", { industry: profile.industry, website: profile.website });
      notify("Business context saved. New AI drafts will use it.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn't save business context.", true);
    } finally {
      setProfileSaving(false);
    }
  }

  async function disconnectGmail() {
    if (!gmailStatus?.connected) return;
    const confirmed = window.confirm("Disconnect " + gmailStatus.email + "? New drafts will no longer read this mailbox, and this app will no longer send through it.");
    if (!confirmed) return;
    setGmailLoading(true);
    try {
      const response = await fetch("/api/gmail/disconnect", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Couldn't disconnect Gmail.");
      notify("Gmail disconnected.");
      await loadGmailStatus();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn't disconnect Gmail.", true);
    } finally {
      setGmailLoading(false);
    }
  }

  async function signOut() { await supabase.auth.signOut(); window.location.replace("/login"); }

  if (loading) return <main className="loading-screen"><LoaderCircle className="spin" size={22} /> Opening your workspace…</main>;
  if (!workspaces.length) return <main className="setup-shell"><form className="setup-card" onSubmit={createWorkspace}><div className="brand-lockup"><span className="brand-mark"><Workflow size={18} /></span><span>small business <strong>agent</strong></span></div><span className="eyebrow">FIRST STEP</span><h1>Set up your workspace</h1><p>Your leads, notes, and follow-up drafts will stay together here.</p><label className="field-label" htmlFor="workspaceName">Business or team name</label><input id="workspaceName" className="text-input" value={newWorkspaceName} onChange={e => setNewWorkspaceName(e.target.value)} required maxLength={80} placeholder="e.g. Palmtech Autos" /><button className="btn btn-primary btn-full" disabled={busy}>{busy ? "Creating…" : "Create workspace"}<ArrowUpRight size={16} /></button>{message && <p className="form-message">{message}</p>}<button type="button" className="link-button" onClick={signOut}>Sign out</button></form></main>;

  return <div className="app-shell">
    <aside className="sidebar"><a className="brand-lockup" href="/dashboard"><span className="brand-mark"><Workflow size={18} /></span><span>small business <strong>agent</strong></span></a>
      <div className="workspace-control"><label className="sidebar-label" htmlFor="workspace-select">WORKSPACE</label><select id="workspace-select" value={workspaceId} onChange={e => setWorkspaceId(e.target.value)}>{workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
      {(["overview", "leads", "followups", "activity", "settings"] as const).map(t => <button key={t} type="button" aria-label={label(t)} title={label(t)} aria-current={tab === t ? "page" : undefined} className={"nav-item " + (tab === t ? "active" : "")} onClick={() => setTab(t)}>{t === "overview" ? <Activity size={20} /> : t === "leads" ? <Users size={20} /> : t === "followups" ? <Mail size={20} /> : t === "activity" ? <Clock3 size={20} /> : <ShieldCheck size={20} />}<span className="nav-label">{label(t)}</span>{t === "followups" && pendingDrafts.length > 0 ? <span className="nav-count">{pendingDrafts.length}</span> : null}</button>)}
      <div className="sidebar-note"><ShieldCheck size={17} /><span><strong>Human in control</strong><small>Approval never sends an email. Sending and outreach automations remain off.</small></span></div>
      <div className="sidebar-user"><span className="avatar">{initials(email)}</span><span><strong>{email.split("@")[0]}</strong><small>{email}</small></span><button title="Sign out" onClick={signOut}><LogOut size={16} /></button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div><span className="eyebrow">WORKSPACE / {label(tab)}</span><h1>{tab === "overview" ? "Your business, in view." : label(tab)}</h1></div><div className="topbar-actions"><span className="safe-pill"><span /> Safe mode</span><button className="btn btn-primary" onClick={() => { setLead({ company_name: "", contact_name: "", email: "", phone: "", website: "", notes: "" }); setModal("lead"); }}><Plus size={16} /> Add lead</button></div></header>
      <section className="content-area">
        {(message || error) && <div className={"notice " + (error ? "notice-error" : "notice-success")} role="status">{message || error}<button aria-label="Dismiss" onClick={() => { setMessage(""); setError(""); }}><X size={16} /></button></div>}
        {tab === "overview" && <><div className="welcome-row"><div><p>Keep every lead moving without losing the human decision.</p></div><button className="btn btn-secondary" onClick={() => setModal("import")}><Upload size={16} /> Import CSV</button></div><div className="metric-grid"><div className="metric-card"><Users size={18} /><span>Total leads</span><strong>{leads.length}</strong></div><div className="metric-card"><Clock3 size={18} /><span>Needs approval</span><strong>{pendingDrafts.length}</strong></div><div className="metric-card"><Check size={18} /><span>Approved drafts</span><strong>{drafts.filter(d => d.status === "approved").length}</strong></div><div className="metric-card"><Activity size={18} /><span>Recent activity</span><strong>{activity.length}</strong></div></div><div className="panel"><div className="panel-heading"><div><h2>Recent leads</h2><p>Your latest prospects and next actions.</p></div><button className="text-action" onClick={() => setTab("leads")}>View leads <ArrowUpRight size={15} /></button></div>{leads.length ? leads.slice(0, 5).map(l => <div className="list-row" key={l.id}><span className="avatar">{initials(l.company_name)}</span><span className="row-copy"><strong>{l.company_name}</strong><small>{l.contact_name || l.email || "Contact not added"}</small></span><span className={badge(l.status)}>{label(l.status)}</span><button className="btn btn-secondary btn-small" onClick={() => openDraft(l)}>Prepare follow-up</button></div>) : <div className="empty-state"><Users size={22} /><strong>Your lead list starts here</strong><p>Add a prospect manually or import a CSV.</p></div>}</div><div className="panel"><div className="panel-heading"><div><h2>Latest activity</h2><p>Changes recorded in this workspace.</p></div><button className="text-action" onClick={() => setTab("activity")}>View activity</button></div>{activity.slice(0, 4).map(a => <div className="activity-row" key={a.id}><span>{label(a.event_type)}</span><small>{String(a.details?.company_name || a.details?.subject || a.details?.filename || "Workspace change")} · {dateLabel(a.created_at)}</small></div>)}{!activity.length && <p className="muted">No activity recorded yet.</p>}</div></>}
        {tab === "leads" && <><div className="toolbar"><label className="search"><Search size={16} /><input placeholder="Search leads" value={search} onChange={e => setSearch(e.target.value)} /></label><button className="btn btn-secondary" onClick={() => setModal("import")}><Upload size={16} /> Import CSV</button></div><div className="panel"><div className="table-wrap"><table><thead><tr><th>Company / contact</th><th>Status</th><th>Source</th><th>Added</th><th>Actions</th></tr></thead><tbody>{filteredLeads.map(l => <tr key={l.id}><td><strong>{l.company_name}</strong><small>{l.contact_name || l.email || "Contact not added"}</small></td><td><span className={badge(l.status)}>{label(l.status)}</span></td><td>{l.source_type === "csv" ? "CSV" : "Manual"}</td><td>{dateLabel(l.created_at)}</td><td><div className="row-actions"><button className="text-action" onClick={() => openResearch(l)}><FileText size={14} /> Notes</button><button className="text-action" onClick={() => openDraft(l)}><Mail size={14} /> Draft</button>{l.status === "approved" && canApprove && integrations?.apollo.sequenceReadyForEnrollment && <button className="text-action" disabled={sequenceBusyLeadId === l.id} onClick={() => void enrollLeadInSequence(l)}><Workflow size={14} /> {sequenceBusyLeadId === l.id ? "Enrolling…" : "Enroll"}</button>}</div></td></tr>)}</tbody></table></div>{!filteredLeads.length && <div className="empty-state"><Users size={22} /><strong>No matching leads</strong><p>Add a lead or adjust your search.</p></div>}</div></>}
        {tab === "followups" && <div className="draft-list">{drafts.map(d => {
          const isDemoRecipient = Boolean(d.leads?.email && (/\.(example|test|invalid)$/i.test(d.leads.email.split("@")[1] || "") || /@example\.(com|org|net)$/i.test(d.leads.email)));
          const isQueued = d.status === "approved" && d.send_provider === "apollo" && Boolean(d.provider_message_id);
          return <article className="draft-card" key={d.id}>
            <div className="draft-heading"><div><h2>{d.leads?.company_name || "Follow-up draft"}</h2><p>{d.leads?.contact_name || d.leads?.email || "Contact details not available"} · {dateLabel(d.created_at)}</p></div><span className={badge(d.status)}>{isQueued ? "Queued" : label(d.status)}</span></div>
            <h3>{d.subject}</h3><p className="draft-body">{d.body}</p>
            {d.rejection_reason && <p className="muted">Reason: {d.rejection_reason}</p>}
            {d.status === "pending_approval" && canApprove && <div className="row-actions"><button className="btn btn-secondary" disabled={busy} onClick={() => reviewDraft(d, "rejected")}><X size={15} /> Reject</button><button className="btn btn-primary" disabled={busy} onClick={() => reviewDraft(d, "approved")}><Check size={15} /> Approve</button></div>}
            {d.status === "pending_approval" && !canApprove && <p className="muted">Only workspace owners or admins can approve.</p>}
            {d.status === "approved" && !isQueued && canApprove && (isDemoRecipient
              ? <p className="safe-message"><ShieldCheck size={15} /> Demo lead — live sending is blocked.</p>
              : <div className="row-actions"><button className="btn btn-primary" disabled={sendBusyDraftId === d.id || !integrations?.apollo.liveSendReady} onClick={() => void sendApprovedDraft(d)}><Mail size={15} /> {sendBusyDraftId === d.id ? "Sending…" : "Send via Apollo"}</button>{!integrations?.apollo.liveSendReady && <p className="muted">Connect an Apollo sender mailbox and API key in Settings first.</p>}</div>
            )}
            {d.status === "approved" && !isQueued && !canApprove && <p className="muted">Only workspace owners or admins can send approved drafts.</p>}
            {isQueued && canApprove && <div className="row-actions"><p className="safe-message"><Clock3 size={15} /> Sent/queued through Apollo — delivery status may still be pending.</p><button className="btn btn-secondary" disabled={sendBusyDraftId === d.id} onClick={() => void refreshApprovedDraftStatus(d)}>{sendBusyDraftId === d.id ? "Checking…" : "Refresh status"}</button></div>}
            {d.status === "sent" && <p className="safe-message"><Check size={15} /> Email marked sent by Apollo{d.sent_at ? " · " + dateLabel(d.sent_at) : ""}.</p>}
          </article>;
        })}{!drafts.length && <div className="panel empty-state"><Mail size={22} /><strong>No follow-up drafts yet</strong><p>Create a draft from a lead. Every draft needs human approval.</p><button className="btn btn-primary" onClick={() => setTab("leads")}>Choose a lead</button></div>}</div>}
        {tab === "activity" && <div className="panel">{activity.map(a => <div className="activity-row" key={a.id}><strong>{label(a.event_type)}</strong><small>{String(a.details?.company_name || a.details?.subject || a.details?.filename || "Workspace change")} · {dateLabel(a.created_at)}</small></div>)}{!activity.length && <p className="muted">No activity has been recorded yet.</p>}</div>}
        {tab === "settings" && <div className="settings-stack">
          <div className="panel settings-panel">
            <h2>{workspace?.name}</h2><p>Signed in as {email}</p>
            <p><ShieldCheck size={16} /> Every outreach message must be reviewed and approved before sending.</p>
          </div>
          <form className="panel settings-panel form-stack" onSubmit={saveBusinessProfile}>
            <div className="panel-heading"><div><h2>Business context for AI</h2><p>Every workspace has its own business profile. AI uses this to understand what you sell and how to write.</p></div></div>
            <div className="two-col">
              <label>Industry<input className="text-input" value={businessProfileForm.industry || ""} onChange={e => setBusinessProfileForm({ ...businessProfileForm, industry: e.target.value })} placeholder="e.g. Business automation" /></label>
              <label>Website<input className="text-input" type="url" value={businessProfileForm.website || ""} onChange={e => setBusinessProfileForm({ ...businessProfileForm, website: e.target.value })} placeholder="https://..." /></label>
            </div>
            <label>What does your business sell or help with?<textarea className="text-input" rows={3} maxLength={1200} value={businessProfileForm.offering || ""} onChange={e => setBusinessProfileForm({ ...businessProfileForm, offering: e.target.value })} placeholder="Products, services, and the problems you solve." required /></label>
            <label>Who is your ideal customer?<textarea className="text-input" rows={2} maxLength={800} value={businessProfileForm.ideal_customer || ""} onChange={e => setBusinessProfileForm({ ...businessProfileForm, ideal_customer: e.target.value })} placeholder="Roles, industries, company sizes, or customer types." required /></label>
            <label>Why do customers choose you?<textarea className="text-input" rows={2} maxLength={800} value={businessProfileForm.differentiator || ""} onChange={e => setBusinessProfileForm({ ...businessProfileForm, differentiator: e.target.value })} placeholder="Real strengths or proof points. AI won't invent results." /></label>
            <div className="two-col">
              <label>Writing style<select className="text-input" value={businessProfileForm.voice || "friendly and conversational"} onChange={e => setBusinessProfileForm({ ...businessProfileForm, voice: e.target.value })}><option value="friendly and conversational">Friendly and conversational</option><option value="professional and direct">Professional and direct</option><option value="warm and helpful">Warm and helpful</option><option value="confident and concise">Confident and concise</option></select></label>
              <label>Preferred next step<select className="text-input" value={businessProfileForm.call_to_action || "book a short discovery call"} onChange={e => setBusinessProfileForm({ ...businessProfileForm, call_to_action: e.target.value })}><option value="book a short discovery call">Book a short call</option><option value="reply to this email">Reply to the email</option><option value="view the website">Visit the website</option><option value="request a quote">Request a quote</option></select></label>
            </div>
            <div className="modal-actions"><span className="muted">Saved per workspace</span><button className="btn btn-primary" disabled={profileSaving}>{profileSaving ? "Saving…" : "Save business context"}</button></div>
          </form>
          <div className="panel settings-panel">
            <div className="panel-heading"><div><h2>Connect your Gmail</h2><p>When connected, AI can check recent emails with the lead and sending uses your own Gmail account.</p></div><span className={gmailStatus?.connected ? "status-badge good" : "status-badge waiting"}>{gmailStatus?.connected ? "Connected" : gmailStatus?.configured ? "Not connected" : "Setup needed"}</span></div>
            {gmailStatus?.connected
              ? <><p><Mail size={16} /> Connected account: {gmailStatus.email}</p><p><ShieldCheck size={16} /> Granted access: read relevant email history and send email as you.</p><div className="row-actions"><button className="btn btn-secondary" disabled={gmailLoading} onClick={() => void loadGmailStatus()}>{gmailLoading ? "Checking…" : "Refresh status"}</button><button className="btn btn-secondary" disabled={gmailLoading} onClick={() => void disconnectGmail()}>{gmailLoading ? "Working…" : "Disconnect Gmail"}</button></div></>
              : <><p><ShieldCheck size={16} /> Your Gmail connection is per user. Each team member connects their own mailbox and can revoke it later.</p>
                {!gmailStatus?.configured && <p className="muted">Not ready to connect yet: the app owner must configure Google OAuth credentials and private encrypted token storage. The setup values belong in Vercel server environment variables, not in chat or browser code.</p>}
                {gmailStatus?.reason && <p className="muted">{gmailStatus.reason}</p>}
                <a className={"btn btn-primary " + (!gmailStatus?.configured ? "btn-disabled" : "")} href={gmailStatus?.configured ? "/api/gmail/connect" : undefined} aria-disabled={!gmailStatus?.configured} onClick={e => { if (!gmailStatus?.configured) e.preventDefault(); }}> <Mail size={16} /> Connect Gmail</a>
                <p className="muted">Google will ask you to grant the permissions. Because reading Gmail is a sensitive permission, Google may require OAuth app verification before external users can connect. Only lead-specific messages are fetched when you ask the AI to draft.</p>
              </>}
          </div>
          <div className="panel settings-panel">
            <div className="panel-heading"><div><h2>AI draft generation</h2><p>Uses a server-side model; the API key is never sent to the browser.</p></div><span className={integrations?.ai.ready ? "status-badge good" : "status-badge waiting"}>{integrations?.ai.ready ? "Connected" : "Setup needed"}</span></div>
            <p><Sparkles size={16} /> Model: {integrations?.ai.model || "Not selected"}</p>
            <p><Check size={16} /> Model setting: {integrations?.ai.modelConfigured ? "configured" : "missing"}</p>
            <p><ShieldCheck size={16} /> Gateway authentication: {integrations?.ai.authConfigured ? "available" : "not available"}</p>
            {!integrations?.ai.authConfigured && <p className="muted">The hosted app can use Vercel's built-in OIDC authentication. For local development, add AI_GATEWAY_API_KEY to your private .env.local file. The AI Gateway currently includes $5/month of usage; don't purchase paid credits without reviewing the cost first.</p>}
          </div>
          <div className="panel settings-panel">
            <div className="panel-heading"><div><h2>Apollo sequence integration (optional)</h2><p>Separate from direct Gmail sending. Use this only if you want Apollo to schedule multi-step campaigns.</p></div><span className={integrations?.apollo.liveSendReady ? "status-badge good" : "status-badge waiting"}>{integrations?.apollo.liveSendReady ? "Connected" : "Setup needed"}</span></div>
            <p><Workflow size={16} /> Apollo API key: {integrations?.apollo.apiKeyConfigured ? "configured" : "not configured"}</p>
            <p><Users size={16} /> Sending mailboxes connected: {integrations?.apollo.mailboxCount ?? "not checked"}</p>
            {integrations?.apollo.defaultMailbox?.email && <p><Check size={16} /> Default sender: {integrations.apollo.defaultMailbox.email}</p>}
            {integrations?.apollo.connectionError && <p className="notice notice-error">{integrations.apollo.connectionError}</p>}
            {!integrations?.apollo.apiKeyConfigured && <p className="muted">Create an Apollo API key and add it as APOLLO_API_KEY in Vercel environment variables. Keep it server-side and never prefix it with NEXT_PUBLIC_.</p>}
            {integrations?.apollo.apiKeyConfigured && !integrations?.apollo.mailboxCount && <p className="muted">Apollo currently has no linked sending mailbox. Connect the inbox you want to send from in Apollo first, then refresh this panel.</p>}
            <button className="btn btn-secondary" disabled={integrationsLoading} onClick={() => void loadIntegrationStatus()}>{integrationsLoading ? "Checking…" : "Refresh connection status"}</button>
          </div>
          <div className="panel settings-panel">
            <div className="panel-heading"><div><h2>Outreach automation</h2><p>Apollo manages the sending schedule and stops the sequence when it detects a reply.</p></div><span className={integrations?.apollo.sequenceActive ? "status-badge good" : "status-badge waiting"}>{integrations?.apollo.sequenceActive ? "Active" : "Not active"}</span></div>
            <p><Workflow size={16} /> Sequence: {integrations?.apollo.sequenceName || "Mazion | AI Automation | B2B Services"}</p>
            <p><Check size={16} /> Sequence reference: {integrations?.apollo.sequenceConfigured ? "configured" : "missing"}</p>
            <p><Check size={16} /> Email templates approved: {integrations?.apollo.sequenceTemplatesApproved ? "yes" : "not yet"}</p>
            <p><Users size={16} /> Currently active contacts: {integrations?.apollo.sequenceActiveContacts ?? "not checked"}</p>
            {!integrations?.apollo.sequenceTemplatesApproved && <p className="muted">Before activation, review the four Apollo messages. Step 1 already has a subject; steps 2–4 need subject lines, and all four touches are currently marked for review. We will keep activation locked until the templates are approved.</p>}
            {integrations?.apollo.sequenceTemplatesApproved && !integrations?.apollo.sequenceActive && <p className="muted">Templates are marked ready. Activation will enable real scheduled emails for any enrolled contacts. No contacts are enrolled automatically by this app.</p>}
            {integrations?.apollo.canActivateSequence && <button className="btn btn-primary" disabled={sequenceActivationBusy || integrationsLoading} onClick={() => void activateOutreachSequence()}>{sequenceActivationBusy ? "Activating…" : "Activate outreach sequence"}</button>}
            {integrations?.apollo.sequenceActive && <p className="safe-message"><ShieldCheck size={15} /> Sequence is active. Enroll leads individually from the Leads tab after approval and a confirmation prompt.</p>}
          </div>
          <div className="panel settings-panel">
            <h2>Current safety settings</h2>
            <p><ShieldCheck size={16} /> No email has been sent from this app during setup.</p>
            <p><Workflow size={16} /> No outreach sequence has been activated.</p>
          </div>
        </div>}
      </section>
      <footer className="app-footer"><span>Small Business Agent</span><span><ShieldCheck size={13} /> Draft-first by design</span></footer>
    </main>
    {modal && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setModal(null); }}><section className="modal" role="dialog" aria-modal="true">
      <div className="modal-header"><div><span className="eyebrow">{modal === "lead" ? "NEW PROSPECT" : modal === "import" ? "CSV IMPORT" : modal === "research" ? "PROSPECT CONTEXT" : "FOLLOW-UP DRAFT"}</span><h2>{modal === "lead" ? "Add a lead" : modal === "import" ? "Import leads" : modal === "research" ? "Research notes" : "Prepare a follow-up"}</h2></div><button className="icon-button" onClick={() => setModal(null)} disabled={busy} aria-label="Close"><X size={18} /></button></div>
      {modal === "lead" && <form className="form-stack" onSubmit={saveLead}><label>Company name<input className="text-input" value={lead.company_name} onChange={e => setLead({ ...lead, company_name: e.target.value })} required maxLength={150} /></label><div className="two-col"><label>Contact name<input className="text-input" value={lead.contact_name} onChange={e => setLead({ ...lead, contact_name: e.target.value })} /></label><label>Email<input className="text-input" type="email" value={lead.email} onChange={e => setLead({ ...lead, email: e.target.value })} /></label></div><div className="two-col"><label>Phone<input className="text-input" value={lead.phone} onChange={e => setLead({ ...lead, phone: e.target.value })} /></label><label>Website<input className="text-input" type="url" placeholder="https://" value={lead.website} onChange={e => setLead({ ...lead, website: e.target.value })} /></label></div><label>Notes<textarea className="text-input" rows={3} value={lead.notes} onChange={e => setLead({ ...lead, notes: e.target.value })} /></label><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save lead"}</button></div></form>}
      {modal === "import" && <form className="form-stack" onSubmit={importCsv}><p>CSV needs a Company or Company Name column. Optional columns: Contact Name, Email, Phone, Website, LinkedIn URL, Notes. Maximum 300 lead rows.</p><input type="file" accept=".csv,text/csv" onChange={(e: ChangeEvent<HTMLInputElement>) => setCsvFile(e.target.files?.[0] || null)} required /><p className="muted">Duplicate email addresses are skipped. Import never sends email.</p><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" disabled={busy || !csvFile}>{busy ? "Importing…" : "Import CSV"}</button></div></form>}
      {modal === "research" && selected && <form className="form-stack" onSubmit={saveResearch}><p><strong>{selected.company_name}</strong> — add only facts and sources you have checked. This form does not run a web search.</p><label>Short summary<input className="text-input" value={research.summary} onChange={e => setResearch({ ...research, summary: e.target.value })} placeholder="Brief verified summary" /></label><label>Verified notes<textarea className="text-input" rows={4} value={research.notes} onChange={e => setResearch({ ...research, notes: e.target.value })} required placeholder="What did you verify?" /></label><label>Source URLs, one per line<textarea className="text-input" rows={2} value={research.urls} onChange={e => setResearch({ ...research, urls: e.target.value })} placeholder="https://company.com/about" /></label><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save notes"}</button></div></form>}
      {modal === "draft" && selected && <form className="form-stack" onSubmit={saveDraft}><p>Draft a personalised introduction for <strong>{selected.company_name}</strong>. Saving creates a draft; it does not send it.</p><button type="button" className="btn btn-secondary" onClick={generateAiDraft} disabled={busy}><Sparkles size={15} /> {busy ? "Working…" : "Generate with AI (optional)"}</button><label>Subject<input className="text-input" maxLength={140} value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value, method: "manual" })} required /></label><label>Message<textarea className="text-input" rows={8} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value, method: "manual" })} required /></label><p className="safe-message"><ShieldCheck size={15} /> Must be approved by a workspace owner/admin. No sending provider is connected.</p><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save for approval"}</button></div></form>}
    </section></div>}
  </div>;
}

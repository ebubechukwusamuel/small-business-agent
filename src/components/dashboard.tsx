"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowUpRight, Building2, Check, Clock3, FileText, LoaderCircle, LogOut, Mail, Plus, Search, ShieldCheck, Sparkles, Upload, Users, Workflow, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Workspace = { id: string; name: string; slug: string; role: string };
type Lead = { id: string; workspace_id: string; company_name: string; contact_name: string | null; email: string | null; phone: string | null; website: string | null; linkedin_url: string | null; source_type: string; status: string; notes: string | null; created_at: string };
type Draft = { id: string; workspace_id: string; lead_id: string; subject: string; body: string; status: string; generation_method: string; created_at: string; rejection_reason: string | null; leads?: { company_name?: string; contact_name?: string | null; email?: string | null } | null };
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

  const workspace = workspaces.find(w => w.id === workspaceId) || null;
  const canApprove = workspace?.role === "owner" || workspace?.role === "admin";
  const pendingDrafts = drafts.filter(d => d.status === "pending_approval");
  const filteredLeads = leads.filter(l => [l.company_name, l.contact_name, l.email, l.website].some(v => v?.toLowerCase().includes(search.toLowerCase())));

  const notify = (text: string, isError = false) => { setMessage(text); setError(isError ? text : ""); };

  const loadWorkspace = useCallback(async (id: string) => {
    const [l, d, a] = await Promise.all([
      supabase.from("leads").select("id,workspace_id,company_name,contact_name,email,phone,website,linkedin_url,source_type,status,notes,created_at").eq("workspace_id", id).order("created_at", { ascending: false }).limit(300),
      supabase.from("follow_up_drafts").select("id,workspace_id,lead_id,subject,body,status,generation_method,created_at,rejection_reason,leads(company_name,contact_name,email)").eq("workspace_id", id).order("created_at", { ascending: false }).limit(150),
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
      const { data: rows, error: workspaceError } = await supabase.from("workspaces").select("id,name,slug").in("id", ids).order("created_at", { ascending: true });
      if (workspaceError) notify("Couldn't load workspace details: " + workspaceError.message, true);
      const roles = new Map((memberships || []).map((m: { workspace_id: string; role: string }) => [m.workspace_id, m.role]));
      const list = (rows || []).map((r: { id: string; name: string; slug: string }) => ({ ...r, role: String(roles.get(r.id) || "member") }));
      setWorkspaces(list); if (list.length) setWorkspaceId(current => current || list[0].id);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void initialize(); }, [initialize]);
  useEffect(() => { if (workspaceId) void loadWorkspace(workspaceId); }, [workspaceId, loadWorkspace]);

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
      const slug = newWorkspaceName.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + crypto.randomUUID().slice(0, 5);
      // The database derives owner_id from auth.uid() inside an invoker-rights RPC.
      // This avoids trusting a potentially stale client-side userId state value.
      const { data, error: insertError } = await supabase.rpc("create_workspace", {
        p_name: newWorkspaceName.trim(),
        p_slug: slug,
      });
      if (insertError) throw insertError;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.id) throw new Error("The database did not return the new workspace. Refresh and try again.");
      const created = { ...row, role: "owner" } as Workspace;
      setWorkspaces(current => [...current.filter(w => w.id !== created.id), created]);
      setWorkspaceId(created.id);
      setUserId(current => current || userId);
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
      notify("AI draft created for review. It has not been sent.");
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
  async function signOut() { await supabase.auth.signOut(); window.location.replace("/login"); }

  if (loading) return <main className="loading-screen"><LoaderCircle className="spin" size={22} /> Opening your workspace…</main>;
  if (!workspaces.length) return <main className="setup-shell"><form className="setup-card" onSubmit={createWorkspace}><div className="brand-lockup"><span className="brand-mark"><Workflow size={18} /></span><span>small business <strong>agent</strong></span></div><span className="eyebrow">FIRST STEP</span><h1>Set up your workspace</h1><p>Your leads, notes, and follow-up drafts will stay together here.</p><label className="field-label" htmlFor="workspaceName">Business or team name</label><input id="workspaceName" className="text-input" value={newWorkspaceName} onChange={e => setNewWorkspaceName(e.target.value)} required maxLength={80} placeholder="e.g. Palmtech Autos" /><button className="btn btn-primary btn-full" disabled={busy}>{busy ? "Creating…" : "Create workspace"}<ArrowUpRight size={16} /></button>{message && <p className="form-message">{message}</p>}<button type="button" className="link-button" onClick={signOut}>Sign out</button></form></main>;

  return <div className="app-shell">
    <aside className="sidebar"><a className="brand-lockup" href="/dashboard"><span className="brand-mark"><Workflow size={18} /></span><span>small business <strong>agent</strong></span></a>
      <div className="workspace-control"><label className="sidebar-label" htmlFor="workspace-select">WORKSPACE</label><select id="workspace-select" value={workspaceId} onChange={e => setWorkspaceId(e.target.value)}>{workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
      {(["overview", "leads", "followups", "activity", "settings"] as const).map(t => <button key={t} className={"nav-item " + (tab === t ? "active" : "")} onClick={() => setTab(t)}>{t === "overview" ? <Activity size={17} /> : t === "leads" ? <Users size={17} /> : t === "followups" ? <Mail size={17} /> : t === "activity" ? <Clock3 size={17} /> : <ShieldCheck size={17} />}{label(t)}{t === "followups" && pendingDrafts.length > 0 ? <span className="nav-count">{pendingDrafts.length}</span> : null}</button>)}
      <div className="sidebar-note"><ShieldCheck size={17} /><span><strong>Human in control</strong><small>Approval never sends an email. Sending and outreach automations remain off.</small></span></div>
      <div className="sidebar-user"><span className="avatar">{initials(email)}</span><span><strong>{email.split("@")[0]}</strong><small>{email}</small></span><button title="Sign out" onClick={signOut}><LogOut size={16} /></button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div><span className="eyebrow">WORKSPACE / {label(tab)}</span><h1>{tab === "overview" ? "Your business, in view." : label(tab)}</h1></div><div className="topbar-actions"><span className="safe-pill"><span /> Safe mode</span><button className="btn btn-primary" onClick={() => { setLead({ company_name: "", contact_name: "", email: "", phone: "", website: "", notes: "" }); setModal("lead"); }}><Plus size={16} /> Add lead</button></div></header>
      <section className="content-area">
        {(message || error) && <div className={"notice " + (error ? "notice-error" : "notice-success")} role="status">{message || error}<button aria-label="Dismiss" onClick={() => { setMessage(""); setError(""); }}><X size={16} /></button></div>}
        {tab === "overview" && <><div className="welcome-row"><div><p>Keep every lead moving without losing the human decision.</p></div><button className="btn btn-secondary" onClick={() => setModal("import")}><Upload size={16} /> Import CSV</button></div><div className="metric-grid"><div className="metric-card"><Users size={18} /><span>Total leads</span><strong>{leads.length}</strong></div><div className="metric-card"><Clock3 size={18} /><span>Needs approval</span><strong>{pendingDrafts.length}</strong></div><div className="metric-card"><Check size={18} /><span>Approved drafts</span><strong>{drafts.filter(d => d.status === "approved").length}</strong></div><div className="metric-card"><Activity size={18} /><span>Recent activity</span><strong>{activity.length}</strong></div></div><div className="panel"><div className="panel-heading"><div><h2>Recent leads</h2><p>Your latest prospects and next actions.</p></div><button className="text-action" onClick={() => setTab("leads")}>View leads <ArrowUpRight size={15} /></button></div>{leads.length ? leads.slice(0, 5).map(l => <div className="list-row" key={l.id}><span className="avatar">{initials(l.company_name)}</span><span className="row-copy"><strong>{l.company_name}</strong><small>{l.contact_name || l.email || "Contact not added"}</small></span><span className={badge(l.status)}>{label(l.status)}</span><button className="btn btn-secondary btn-small" onClick={() => openDraft(l)}>Prepare follow-up</button></div>) : <div className="empty-state"><Users size={22} /><strong>Your lead list starts here</strong><p>Add a prospect manually or import a CSV.</p></div>}</div><div className="panel"><div className="panel-heading"><div><h2>Latest activity</h2><p>Changes recorded in this workspace.</p></div><button className="text-action" onClick={() => setTab("activity")}>View activity</button></div>{activity.slice(0, 4).map(a => <div className="activity-row" key={a.id}><span>{label(a.event_type)}</span><small>{String(a.details?.company_name || a.details?.subject || a.details?.filename || "Workspace change")} · {dateLabel(a.created_at)}</small></div>)}{!activity.length && <p className="muted">No activity recorded yet.</p>}</div></>}
        {tab === "leads" && <><div className="toolbar"><label className="search"><Search size={16} /><input placeholder="Search leads" value={search} onChange={e => setSearch(e.target.value)} /></label><button className="btn btn-secondary" onClick={() => setModal("import")}><Upload size={16} /> Import CSV</button></div><div className="panel"><div className="table-wrap"><table><thead><tr><th>Company / contact</th><th>Status</th><th>Source</th><th>Added</th><th>Actions</th></tr></thead><tbody>{filteredLeads.map(l => <tr key={l.id}><td><strong>{l.company_name}</strong><small>{l.contact_name || l.email || "Contact not added"}</small></td><td><span className={badge(l.status)}>{label(l.status)}</span></td><td>{l.source_type === "csv" ? "CSV" : "Manual"}</td><td>{dateLabel(l.created_at)}</td><td><div className="row-actions"><button className="text-action" onClick={() => openResearch(l)}><FileText size={14} /> Notes</button><button className="text-action" onClick={() => openDraft(l)}><Mail size={14} /> Draft</button></div></td></tr>)}</tbody></table></div>{!filteredLeads.length && <div className="empty-state"><Users size={22} /><strong>No matching leads</strong><p>Add a lead or adjust your search.</p></div>}</div></>}
        {tab === "followups" && <div className="draft-list">{drafts.map(d => <article className="draft-card" key={d.id}><div className="draft-heading"><div><h2>{d.leads?.company_name || "Follow-up draft"}</h2><p>{d.leads?.contact_name || d.leads?.email || "Contact details not available"} · {dateLabel(d.created_at)}</p></div><span className={badge(d.status)}>{label(d.status)}</span></div><h3>{d.subject}</h3><p className="draft-body">{d.body}</p>{d.rejection_reason && <p className="muted">Reason: {d.rejection_reason}</p>}{d.status === "pending_approval" && canApprove && <div className="row-actions"><button className="btn btn-secondary" disabled={busy} onClick={() => reviewDraft(d, "rejected")}><X size={15} /> Reject</button><button className="btn btn-primary" disabled={busy} onClick={() => reviewDraft(d, "approved")}><Check size={15} /> Approve</button></div>}{d.status === "pending_approval" && !canApprove && <p className="muted">Only workspace owners or admins can approve.</p>}{d.status === "approved" && <p className="safe-message"><ShieldCheck size={15} /> Approved — email sending is still disabled.</p>}</article>)}{!drafts.length && <div className="panel empty-state"><Mail size={22} /><strong>No follow-up drafts yet</strong><p>Create a draft from a lead. Every draft needs human approval.</p><button className="btn btn-primary" onClick={() => setTab("leads")}>Choose a lead</button></div>}</div>}
        {tab === "activity" && <div className="panel">{activity.map(a => <div className="activity-row" key={a.id}><strong>{label(a.event_type)}</strong><small>{String(a.details?.company_name || a.details?.subject || a.details?.filename || "Workspace change")} · {dateLabel(a.created_at)}</small></div>)}{!activity.length && <p className="muted">No activity has been recorded yet.</p>}</div>}
        {tab === "settings" && <div className="panel settings-panel"><h2>{workspace?.name}</h2><p>Signed in as {email}</p><p><ShieldCheck size={16} /> Human approval required before follow-ups are marked approved.</p><p><Mail size={16} /> Email sending is not connected.</p><p><Sparkles size={16} /> AI drafting remains disabled until a provider and model are configured on the server.</p><p><Workflow size={16} /> No outreach automations are active.</p></div>}
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

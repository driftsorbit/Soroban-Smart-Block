import { useEffect, useState } from "react";

type Job = { id: number; kind: string; priority_class: string; status: string; progress: number; attempts: number; tenant_id?: string };

type RepairAudit = {
  id: number;
  action: string;
  actor: string;
  range_from: number | null;
  range_to: number | null;
  reason: string;
  dry_run: boolean;
  status: string;
  details: Record<string, any>;
  created_at: string;
  completed_at: string | null;
};

export default function AdminJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [audits, setAudits] = useState<RepairAudit[]>([]);
  const [error, setError] = useState("");
  const [auditError, setAuditError] = useState("");

  // Repair form state
  const [action, setAction] = useState("replay");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [reason, setReason] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");

  const load = async () => {
    try {
      const response = await fetch("/api/admin/jobs");
      if (!response.ok) throw new Error("Unable to load jobs");
      const data = await response.json();
      setJobs(data.data ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load jobs");
    }
  };

  const loadAudits = async () => {
    try {
      const response = await fetch("/api/admin/repair/audit");
      if (!response.ok) throw new Error("Unable to load repair audit trail");
      const data = await response.json();
      setAudits(data.items ?? []);
      setAuditError("");
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : "Unable to load repair audit trail");
    }
  };

  useEffect(() => {
    void load();
    void loadAudits();
  }, []);

  const cancel = async (id: number) => {
    await fetch(`/api/admin/jobs/${id}/cancel`, { method: "POST" });
    await load();
  };

  const handleRepairSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setSubmitMessage("Error: Reason is required for audit trail.");
      return;
    }

    setSubmitting(true);
    setSubmitMessage("");
    try {
      const res = await fetch("/api/admin/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          range_from: rangeFrom ? parseInt(rangeFrom, 10) : null,
          range_to: rangeTo ? parseInt(rangeTo, 10) : null,
          reason,
          dry_run: dryRun,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Repair job failed");
      setSubmitMessage(`Success: Recorded repair job #${data.job_id} (${dryRun ? "Dry-run" : "Executed"})`);
      setReason("");
      setRangeFrom("");
      setRangeTo("");
      await loadAudits();
    } catch (err) {
      setSubmitMessage(`Error: ${err instanceof Error ? err.message : "Failed to record repair"}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <section aria-labelledby="jobs-heading" style={{ marginBottom: 32 }}>
        <div className="page-header">
          <div>
            <h1 id="jobs-heading">Background jobs</h1>
            <p>Prioritized work, progress, and resource fairness.</p>
          </div>
          <button type="button" onClick={load}>Refresh</button>
        </div>
        {error && <p role="alert">{error}</p>}
        <div className="card">
          <table>
            <thead>
              <tr><th>Job</th><th>Class</th><th>Status</th><th>Progress</th><th>Attempts</th><th /></tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>{job.kind}</td>
                  <td>{job.priority_class}</td>
                  <td>{job.status}</td>
                  <td>{Number(job.progress || 0).toFixed(0)}%</td>
                  <td>{job.attempts}</td>
                  <td>{["queued", "running"].includes(job.status) && <button type="button" onClick={() => cancel(job.id)}>Cancel</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {jobs.length === 0 && <p>No background jobs.</p>}
        </div>
      </section>

      {/* Manual Replay & Repair Jobs (#1118) */}
      <section aria-labelledby="repair-heading">
        <div className="page-header">
          <div>
            <h2 id="repair-heading" style={{ margin: 0 }}>Manual Replay & Repair Jobs</h2>
            <p style={{ color: "var(--muted)", margin: "4px 0 0" }}>
              Trigger maintenance replays and ledger repairs with an immutable audit trail.
            </p>
          </div>
          <button type="button" onClick={loadAudits}>Refresh Audit Trail</button>
        </div>

        <div className="card" style={{ marginBottom: 20, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Trigger New Repair / Replay</h3>
          <form onSubmit={handleRepairSubmit} style={{ display: "grid", gap: 12, maxWidth: 600 }}>
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label htmlFor="repair-action" style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
                  Action
                </label>
                <select
                  id="repair-action"
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                  style={{ width: "100%", padding: 6 }}
                >
                  <option value="replay">Replay Events</option>
                  <option value="reindex">Reindex Ledgers</option>
                  <option value="repair_gaps">Repair Ledger Gaps</option>
                  <option value="decode_fix">Repair Decoded Data</option>
                </select>
              </div>

              <div style={{ flex: 1 }}>
                <label htmlFor="range-from" style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
                  Range From (Ledger/Seq)
                </label>
                <input
                  id="range-from"
                  type="number"
                  placeholder="e.g. 1000"
                  value={rangeFrom}
                  onChange={(e) => setRangeFrom(e.target.value)}
                  style={{ width: "100%", padding: 6 }}
                />
              </div>

              <div style={{ flex: 1 }}>
                <label htmlFor="range-to" style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
                  Range To (Ledger/Seq)
                </label>
                <input
                  id="range-to"
                  type="number"
                  placeholder="e.g. 1050"
                  value={rangeTo}
                  onChange={(e) => setRangeTo(e.target.value)}
                  style={{ width: "100%", padding: 6 }}
                />
              </div>
            </div>

            <div>
              <label htmlFor="repair-reason" style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
                Reason <span style={{ color: "#e5484d" }}>*</span>
              </label>
              <textarea
                id="repair-reason"
                required
                rows={2}
                placeholder="Reason for manual replay or repair (required for audit logging)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                style={{ width: "100%", padding: 6 }}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                />
                Dry Run (Simulate without applying state changes)
              </label>
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <button type="submit" disabled={submitting}>
                {submitting ? "Submitting…" : dryRun ? "Run Simulation" : "Execute Repair"}
              </button>
              {submitMessage && (
                <span
                  style={{
                    fontSize: 13,
                    color: submitMessage.startsWith("Error") ? "#e5484d" : "var(--text)",
                  }}
                >
                  {submitMessage}
                </span>
              )}
            </div>
          </form>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>Repair & Replay Audit Trail</h3>
          {auditError && <p role="alert" style={{ color: "#e5484d" }}>{auditError}</p>}
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Range</th>
                <th>Reason</th>
                <th>Dry Run</th>
                <th>Status</th>
                <th>Created</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {audits.map((a) => (
                <tr key={a.id}>
                  <td>#{a.id}</td>
                  <td><strong>{a.action}</strong></td>
                  <td><code>{a.actor}</code></td>
                  <td>
                    {a.range_from != null || a.range_to != null
                      ? `${a.range_from ?? "?"} .. ${a.range_to ?? "?"}`
                      : "—"}
                  </td>
                  <td>{a.reason}</td>
                  <td>
                    {a.dry_run ? (
                      <span className="badge" style={{ backgroundColor: "var(--muted)" }}>dry-run</span>
                    ) : (
                      "live"
                    )}
                  </td>
                  <td>
                    <span
                      className="badge"
                      style={{
                        color:
                          a.status === "completed"
                            ? "#46a758"
                            : a.status === "failed"
                            ? "#e5484d"
                            : "#f76b15",
                      }}
                    >
                      {a.status}
                    </span>
                  </td>
                  <td style={{ fontSize: 12 }}>{new Date(a.created_at).toLocaleString()}</td>
                  <td style={{ fontSize: 12 }}>
                    {a.completed_at ? new Date(a.completed_at).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {audits.length === 0 && <p style={{ color: "var(--muted)" }}>No repair audit logs recorded yet.</p>}
        </div>
      </section>
    </div>
  );
}

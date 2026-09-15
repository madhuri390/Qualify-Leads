"use client";

import { useEffect, useState } from "react";
import styles from "./page.module.css";

/**
 * The approval console. Left nav + stat tiles + a table of every
 * Qualified/Follow-up lead. Clicking a row opens the detail drawer: what the
 * lead submitted, what research found, and the stage-appropriate action —
 * same actions as the table's own buttons, just reachable from both places.
 *
 * The funnel: Pending -> [Approve | Reject] -> Approved -> (booking message)
 * -> Scheduling -> [Mark Interested | Mark Call Scheduled] -> Call Scheduled.
 * Interested/Call Scheduled are set by hand from the drawer — nothing here
 * infers them from WhatsApp or Calendly (see CLAUDE.md's note on that).
 *
 * "Current state" is never a stored flag — it's the join of Leads,
 * Approvals, Research, Rejections and Outcomes that GET /api/leads computes
 * fresh each load.
 */

type Stage = "Pending" | "Approved" | "Scheduling" | "Interested" | "Call Scheduled";

interface ResearchRecord {
  services: string;
  painPoints: string;
  analysisSummary: string;
  googleRating: string;
  googleReviewCount: string;
  googleReviewSnippet: string;
  instagramAvailable: string;
  instagramCaptions: string;
  websiteSummary: string;
  error: string;
  bookingMessageSent: string;
  bookingError: string;
}

interface DashboardLead {
  id: string;
  receivedAt: string;
  channel: string;
  customerName: string;
  company: string;
  phone: string;
  email: string;
  service: string;
  budgetAmount: string;
  budgetCurrency: string;
  timeline: string;
  score: number;
  status: "Qualified" | "Follow-up" | string;
  nextAction: string;
  message: string;
  website: string | null;
  instagram: string | null;
  approved: boolean;
  research: ResearchRecord | null;
  stage: Stage;
}

interface Stats {
  total: number;
  pendingApproval: number;
  approved: number;
  callsScheduled: number;
}

export default function DashboardPage() {
  const [leads, setLeads] = useState<DashboardLead[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const response = await fetch("/api/leads");
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Failed to load leads");
      setLeads(data.leads);
      setStats(data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load leads");
    }
  }

  /** Shared by Approve, Reject, and both outcome buttons — one action in flight at a time per lead. */
  async function runAction(id: string, request: () => Promise<Response>, failureMessage: string) {
    setWorkingId(id);
    setActionErrors((prev) => ({ ...prev, [id]: "" }));

    try {
      const response = await request();
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? failureMessage);
      await load(); // re-fetch rather than trust our own optimistic guess
    } catch (err) {
      setActionErrors((prev) => ({ ...prev, [id]: err instanceof Error ? err.message : failureMessage }));
    } finally {
      setWorkingId(null);
    }
  }

  const handleApprove = (id: string) =>
    runAction(id, () => fetch(`/api/leads/${id}/approve`, { method: "POST" }), "Approval failed");

  const handleReject = (id: string) =>
    runAction(id, () => fetch(`/api/leads/${id}/reject`, { method: "POST" }), "Reject failed");

  const handleSetOutcome = (id: string, outcome: "Interested" | "Call Scheduled") =>
    runAction(
      id,
      () =>
        fetch(`/api/leads/${id}/outcome`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outcome }),
        }),
      "Failed to update",
    );

  const openLead = leads?.find((l) => l.id === openLeadId) ?? null;

  return (
    <div className={styles.app}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>
            A.M<i>A</i>
          </span>
          <span className={styles.brandSub}>Qualify Leads</span>
        </div>
        <nav className={styles.nav}>
          <span className={styles.navItem} data-active="true">
            Leads
          </span>
        </nav>
      </aside>

      <main className={styles.main}>
        <div className={styles.shell}>
          <h1 className={styles.title}>Leads</h1>

          <div className={styles.stats}>
            <StatTile label="Leads" value={stats?.total} />
            <StatTile label="Pending approval" value={stats?.pendingApproval} />
            <StatTile label="Approved" value={stats?.approved} />
            <StatTile label="Calls scheduled" value={stats?.callsScheduled} />
          </div>

          {error ? (
            <div className={styles.empty}>{error}</div>
          ) : leads === null ? (
            <div className={styles.empty}>Loading…</div>
          ) : leads.length === 0 ? (
            <div className={styles.empty}>Nothing qualified yet — leads show up here once they score 50+.</div>
          ) : (
            <div className={styles.tableCard}>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Lead</th>
                      <th>Status</th>
                      <th>Score</th>
                      <th>Budget</th>
                      <th>Stage</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead) => (
                      <LeadRow
                        key={lead.id}
                        lead={lead}
                        working={workingId === lead.id}
                        onOpen={() => setOpenLeadId(lead.id)}
                        onApprove={() => handleApprove(lead.id)}
                        onReject={() => handleReject(lead.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>

      {openLead ? (
        <LeadDrawer
          lead={openLead}
          working={workingId === openLead.id}
          error={actionErrors[openLead.id]}
          onApprove={() => handleApprove(openLead.id)}
          onReject={() => handleReject(openLead.id)}
          onSetOutcome={(outcome) => handleSetOutcome(openLead.id, outcome)}
          onClose={() => setOpenLeadId(null)}
        />
      ) : null}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className={styles.statTile}>
      <span className={styles.statValue}>{value ?? "–"}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

function LeadRow({
  lead,
  working,
  onOpen,
  onApprove,
  onReject,
}: {
  lead: DashboardLead;
  working: boolean;
  onOpen: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const who = lead.company || lead.customerName || "Unnamed lead";
  const budget =
    lead.budgetAmount && `${lead.budgetCurrency || "INR"} ${Number(lead.budgetAmount).toLocaleString("en-IN")}`;

  return (
    <tr className={styles.tableRow} onClick={onOpen}>
      <td>
        <div className={styles.company}>{who}</div>
        <div className={styles.meta}>{lead.channel}</div>
      </td>
      <td>
        <span className={styles.badge} data-status={lead.status}>
          {lead.status}
        </span>
      </td>
      <td className={styles.mono}>{lead.score}</td>
      <td className={styles.mono}>{budget || "—"}</td>
      <td>
        <span className={styles.badge} data-stage={lead.stage}>
          {lead.stage}
        </span>
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        {lead.stage === "Pending" ? (
          <div className={styles.rowActions}>
            <button className={styles.approveBtn} onClick={onApprove} disabled={working}>
              {working ? "Working…" : "Approve"}
            </button>
            <button className={styles.rejectBtn} onClick={onReject} disabled={working}>
              Reject
            </button>
          </div>
        ) : (
          <span className={styles.meta} style={{ fontFamily: "inherit" }}>
            Open for next step
          </span>
        )}
      </td>
    </tr>
  );
}

function LeadDrawer({
  lead,
  working,
  error,
  onApprove,
  onReject,
  onSetOutcome,
  onClose,
}: {
  lead: DashboardLead;
  working: boolean;
  error?: string;
  onApprove: () => void;
  onReject: () => void;
  onSetOutcome: (outcome: "Interested" | "Call Scheduled") => void;
  onClose: () => void;
}) {
  const who = lead.company || lead.customerName || "Unnamed lead";
  const budget =
    lead.budgetAmount && `${lead.budgetCurrency || "INR"} ${Number(lead.budgetAmount).toLocaleString("en-IN")}`;
  const enquiry = lead.message.split("\n\n").pop()?.trim() || lead.message;
  const research = lead.research;

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div className={styles.drawer}>
        <div className={styles.drawerHeader}>
          <span className={styles.drawerTitle}>{who}</span>
          <button className={styles.drawerClose} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className={styles.badgeRow}>
          <span className={styles.badge} data-status={lead.status}>
            {lead.status} · {lead.score}
          </span>
          <span className={styles.badge} data-stage={lead.stage}>
            {lead.stage}
          </span>
        </div>

        <div className={styles.section}>
          <p className={styles.sectionLabel}>What they submitted</p>
          <dl className={styles.fieldGrid}>
            {lead.customerName && (
              <div>
                <dt>Name</dt>
                <dd>{lead.customerName}</dd>
              </div>
            )}
            {lead.phone && (
              <div>
                <dt>Phone</dt>
                <dd>+{lead.phone}</dd>
              </div>
            )}
            {lead.email && (
              <div>
                <dt>Email</dt>
                <dd>{lead.email}</dd>
              </div>
            )}
            {lead.service && (
              <div>
                <dt>Service interested in</dt>
                <dd>{lead.service}</dd>
              </div>
            )}
            {budget && (
              <div>
                <dt>Budget</dt>
                <dd>{budget}</dd>
              </div>
            )}
            {lead.timeline && (
              <div>
                <dt>Timeline</dt>
                <dd>{lead.timeline}</dd>
              </div>
            )}
            <div>
              <dt>Message</dt>
              <dd>{enquiry}</dd>
            </div>
          </dl>
          {(lead.website || lead.instagram) && (
            <div className={styles.links}>
              {lead.website && (
                <a href={lead.website} target="_blank" rel="noopener noreferrer">
                  Website
                </a>
              )}
              {lead.instagram && (
                <a
                  href={`https://instagram.com/${lead.instagram}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  @{lead.instagram}
                </a>
              )}
            </div>
          )}
        </div>

        <div className={styles.section}>
          <p className={styles.sectionLabel}>Business analysis</p>
          {!research ? (
            <p className={styles.meta} style={{ fontFamily: "inherit" }}>
              Not researched yet — approve this lead to run it.
            </p>
          ) : research.error && !research.analysisSummary ? (
            <p className={styles.error}>{research.error}</p>
          ) : (
            <>
              {research.analysisSummary && <p className={styles.summary}>{research.analysisSummary}</p>}
              <dl className={styles.fieldGrid}>
                {research.services && (
                  <div>
                    <dt>Services</dt>
                    <dd>{research.services}</dd>
                  </div>
                )}
                {research.painPoints && (
                  <div>
                    <dt>Pain points</dt>
                    <dd>{research.painPoints}</dd>
                  </div>
                )}
                {research.googleRating && (
                  <div>
                    <dt>Google rating</dt>
                    <dd>
                      {research.googleRating} ({research.googleReviewCount || 0} reviews)
                      {research.googleReviewSnippet ? ` — "${research.googleReviewSnippet}"` : ""}
                    </dd>
                  </div>
                )}
                {research.instagramAvailable === "true" && (
                  <div>
                    <dt>Instagram</dt>
                    <dd>Public activity found</dd>
                  </div>
                )}
                {research.websiteSummary && (
                  <div>
                    <dt>Website</dt>
                    <dd>{research.websiteSummary}</dd>
                  </div>
                )}
              </dl>
            </>
          )}
        </div>

        <div className={styles.drawerFooter}>
          {lead.stage === "Pending" && (
            <div className={styles.rowActions}>
              <button className={styles.approveBtn} onClick={onApprove} disabled={working}>
                {working ? "Working…" : "Approve to next step"}
              </button>
              <button className={styles.rejectBtn} onClick={onReject} disabled={working}>
                Reject
              </button>
            </div>
          )}

          {lead.stage === "Approved" && (
            <p className={styles.meta} style={{ fontFamily: "inherit", marginBottom: 12 }}>
              Research done{research?.bookingError ? " — booking message failed to send" : ""}.
            </p>
          )}

          {lead.stage === "Scheduling" && (
            <p className={styles.meta} style={{ fontFamily: "inherit", marginBottom: 12 }}>
              Booking message sent — waiting to hear back.
            </p>
          )}

          {(lead.stage === "Approved" || lead.stage === "Scheduling" || lead.stage === "Interested") && (
            <div className={styles.rowActions}>
              {lead.stage !== "Interested" && (
                <button
                  className={styles.secondaryBtn}
                  onClick={() => onSetOutcome("Interested")}
                  disabled={working}
                >
                  Mark interested
                </button>
              )}
              <button
                className={styles.approveBtn}
                onClick={() => onSetOutcome("Call Scheduled")}
                disabled={working}
              >
                Mark call scheduled
              </button>
            </div>
          )}

          {lead.stage === "Call Scheduled" && (
            <span className={styles.scheduledTag}>✓ Call scheduled</span>
          )}

          {error && <p className={styles.error}>{error}</p>}
          {lead.stage === "Approved" && research?.bookingError && (
            <p className={styles.error}>{research.bookingError}</p>
          )}
        </div>
      </div>
    </>
  );
}

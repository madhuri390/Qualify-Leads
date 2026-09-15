import { isRejected, rejectLead } from "@/lib/approve";

/** Fired by the dashboard's Reject button. No research, no message — just a record. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (await isRejected(id)) {
    return Response.json({ ok: false, error: "This lead has already been rejected" }, { status: 409 });
  }

  try {
    await rejectLead(id);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[reject] failed", id, error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Reject failed" },
      { status: 500 },
    );
  }
}

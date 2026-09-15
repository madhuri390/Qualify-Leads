import { approveLead, isApproved } from "@/lib/approve";

/**
 * Fired by the dashboard's Approve button. Runs research + sends the
 * booking WhatsApp message in the same request — there's no queue here,
 * so the button spins until it's actually done.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (await isApproved(id)) {
    return Response.json(
      { ok: false, error: "This lead has already been approved" },
      { status: 409 },
    );
  }

  try {
    const outcome = await approveLead(id);
    return Response.json({ ok: true, ...outcome });
  } catch (error) {
    console.error("[approve] failed", id, error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Approval failed" },
      { status: 500 },
    );
  }
}

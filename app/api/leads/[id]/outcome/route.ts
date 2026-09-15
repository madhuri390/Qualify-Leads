import { z } from "zod";
import { setOutcome } from "@/lib/approve";

const BodySchema = z.object({ outcome: z.enum(["Interested", "Call Scheduled"]) });

/** Fired by the dashboard's "Mark Interested" / "Mark Call Scheduled" buttons. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Expected { outcome: \"Interested\" | \"Call Scheduled\" }" }, { status: 400 });
  }

  try {
    await setOutcome(id, parsed.data.outcome);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[outcome] failed", id, error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to set outcome" },
      { status: 500 },
    );
  }
}

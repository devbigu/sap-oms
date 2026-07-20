import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";

import { normalizeDealerFormSnapshot, validateDealerFormSnapshot } from "@/lib/dealerForm";
import { getDb, isMongoDependencyError } from "@/lib/mongodb";
import { invalidateStaffAssignmentCache } from "@/lib/orderScopeServer";
import {
  appendAuditEntry,
  buildDealerRequestAccessQuery,
  buildDealerRequestIdentityKey,
  ensureDealerRequestIndexes,
  ensureStatusTransition,
  getDealerRequestCollection,
  lookupExistingDealer,
  resolveCreatedDealerId,
  resolveDealerRequestActor,
  submitDealerDirect,
  toDealerRequestDetail,
  type DealerRequestActor,
  type DealerRequestRecord,
} from "@/lib/dealerRequests";

export const runtime = "nodejs";

function toObjectId(id: string) {
  try {
    return new ObjectId(id);
  } catch {
    return null;
  }
}

function buildResponseError(message: string, status: number) {
  return NextResponse.json({ success: false, message }, { status });
}

function buildSnapshotSummary(snapshot: ReturnType<typeof normalizeDealerFormSnapshot>) {
  return {
    dealerName: snapshot.name,
    dealerCode: snapshot.dealerCode,
    city: snapshot.city,
    contactEmail: snapshot.email,
    contactPhone: snapshot.whatsapp,
    assignedStaffIds: snapshot.assignedStaffIds,
    assignedStaffNames: snapshot.staffNames,
  };
}

function buildRequestQuery(actor: DealerRequestActor, oid: ObjectId) {
  const accessQuery = buildDealerRequestAccessQuery(actor);
  return Object.keys(accessQuery).length > 0
    ? { $and: [{ _id: oid }, accessQuery] }
    : { _id: oid };
}

function buildLockToken() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isDuplicateKeyError(error: unknown) {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: number }).code === 11000;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const oid = toObjectId(id);
    if (!oid) {
      return buildResponseError("Invalid dealer request id", 400);
    }

    const actor = resolveDealerRequestActor({
      headers: request.headers,
      role: request.nextUrl.searchParams.get("role"),
      actorId: request.nextUrl.searchParams.get("actorId"),
      actorName: request.nextUrl.searchParams.get("actorName"),
      roletype: request.nextUrl.searchParams.get("roletype"),
    });

    if (!actor || (actor.role !== "admin" && actor.role !== "staff")) {
      return buildResponseError("Dealer request access is restricted to admin and staff", 403);
    }

    const db = await getDb();
    await ensureDealerRequestIndexes(db);
    const collection = getDealerRequestCollection(db);
    const doc = await collection.findOne(buildRequestQuery(actor, oid));
    if (!doc) {
      return buildResponseError("Dealer request not found", 404);
    }

    return NextResponse.json({ success: true, data: toDealerRequestDetail(doc) });
  } catch (error) {
    console.error("[GET /api/dealer-requests/[id]]", error);
    const status = isMongoDependencyError(error) ? 503 : 500;
    return buildResponseError(
      status === 503
        ? "Dealer request database is currently unavailable"
        : "Failed to load dealer request",
      status,
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const oid = toObjectId(id);
    if (!oid) {
      return buildResponseError("Invalid dealer request id", 400);
    }

    const body = await request.json();
    const actor = resolveDealerRequestActor({
      headers: request.headers,
      role: body.role,
      actorId: body.actorId,
      actorName: body.actorName,
      roletype: body.roletype,
    });

    if (!actor || (actor.role !== "admin" && actor.role !== "staff")) {
      return buildResponseError("Dealer request access is restricted to admin and staff", 403);
    }

    const action = String(body.action ?? "").trim().toLowerCase();
    if (action !== "accept" && action !== "reject" && action !== "resubmit") {
      return buildResponseError("Invalid dealer request action", 400);
    }

    const db = await getDb();
    await ensureDealerRequestIndexes(db);
    const collection = getDealerRequestCollection(db);
    const baseQuery = buildRequestQuery(actor, oid);
    const existing = await collection.findOne(baseQuery);
    if (!existing) {
      return buildResponseError("Dealer request not found", 404);
    }

    const current = toDealerRequestDetail(existing);
    const transitionError = ensureStatusTransition(current.status, action);
    if (transitionError) {
      return buildResponseError(transitionError, 409);
    }

    if (action === "accept") {
      if (actor.role !== "admin") {
        return buildResponseError("Only admin can accept dealer requests", 403);
      }

      const snapshot = normalizeDealerFormSnapshot(body.formSnapshot ?? existing.formSnapshot);
      const validationError = validateDealerFormSnapshot(snapshot);
      if (validationError) {
        return buildResponseError(validationError, 400);
      }

      const now = new Date().toISOString();
      const lockToken = buildLockToken();
      const locked = await collection.findOneAndUpdate(
        {
          _id: oid,
          status: "pending",
          $or: [{ approvalLock: null }, { approvalLock: { $exists: false } }],
        },
        {
            $set: {
              ...buildSnapshotSummary(snapshot),
              formSnapshot: snapshot,
              requestIdentityKey: buildDealerRequestIdentityKey(snapshot, current.submittedById),
              updatedAt: now,
              approvalLock: {
              token: lockToken,
              actorId: actor.actorId,
              actorName: actor.actorName,
              startedAt: now,
            },
          },
        },
        { returnDocument: "after" },
      );

      if (!locked) {
        const latest = await collection.findOne({ _id: oid });
        const latestState = latest ? toDealerRequestDetail(latest).status : "";
        return buildResponseError(
          latestState === "accepted"
            ? "This request has already been accepted"
            : "This request is already being reviewed by another admin",
          409,
        );
      }

      const lockedDetail = toDealerRequestDetail(locked);
      const auditTrail = appendAuditEntry(lockedDetail.auditTrail, {
        action: "accept_started",
        at: now,
        actorId: actor.actorId,
        actorName: actor.actorName,
        actorRole: actor.role,
      });

      try {
        const priorAttempts = Number((locked as DealerRequestRecord).creationAttemptCount ?? 0);
        const existingDealer = await lookupExistingDealer(snapshot);
        let createdDealerId = String(existingDealer?.Dealer_Id ?? "").trim();

        if (createdDealerId && priorAttempts === 0) {
          await collection.updateOne(
            { _id: oid, "approvalLock.token": lockToken },
            {
              $set: {
                approvalLock: null,
                updatedAt: now,
                auditTrail: appendAuditEntry(auditTrail, {
                  action: "accept_blocked_duplicate",
                  at: now,
                  actorId: actor.actorId,
                  actorName: actor.actorName,
                  actorRole: actor.role,
                  note: "A dealer with matching identity already exists.",
                }),
              },
            },
          );
          return buildResponseError("A dealer with these details already exists", 409);
        }

        if (!createdDealerId) {
          await submitDealerDirect(snapshot);
          createdDealerId = await resolveCreatedDealerId(snapshot);
        }

        if (!createdDealerId) {
          await collection.updateOne(
            { _id: oid, "approvalLock.token": lockToken },
            {
              $set: {
                approvalLock: null,
                updatedAt: now,
                creationAttemptCount: priorAttempts + 1,
                auditTrail: appendAuditEntry(auditTrail, {
                  action: "accept_pending_retry",
                  at: now,
                  actorId: actor.actorId,
                  actorName: actor.actorName,
                  actorRole: actor.role,
                  note: "Dealer was submitted but could not be verified in the dealer list.",
                }),
              },
            },
          );
          return buildResponseError("Dealer creation could not be verified. The request is still pending.", 502);
        }

        const accepted = await collection.findOneAndUpdate(
          { _id: oid, status: "pending", "approvalLock.token": lockToken },
          {
            $set: {
              ...buildSnapshotSummary(snapshot),
              formSnapshot: snapshot,
              requestIdentityKey: buildDealerRequestIdentityKey(snapshot, current.submittedById),
              status: "accepted",
              reviewedById: actor.actorId,
              reviewedByName: actor.actorName,
              reviewedAt: now,
              acceptedAt: now,
              rejectedAt: "",
              rejectionReason: "",
              createdDealerId,
              openRequestKey: null,
              approvalLock: null,
              updatedAt: now,
              auditTrail: appendAuditEntry(auditTrail, {
                action: "accepted",
                at: now,
                actorId: actor.actorId,
                actorName: actor.actorName,
                actorRole: actor.role,
                note: `Dealer created with id ${createdDealerId}`,
              }),
            },
          },
          { returnDocument: "after" },
        );

        if (!accepted) {
          return buildResponseError("Dealer request could not be finalized", 409);
        }

        invalidateStaffAssignmentCache();
        return NextResponse.json({ success: true, data: toDealerRequestDetail(accepted) });
      } catch (error) {
        await collection.updateOne(
          { _id: oid, "approvalLock.token": lockToken },
          {
            $set: {
              approvalLock: null,
              updatedAt: now,
              creationAttemptCount: Number((locked as DealerRequestRecord).creationAttemptCount ?? 0) + 1,
              auditTrail: appendAuditEntry(auditTrail, {
                action: "accept_failed",
                at: now,
                actorId: actor.actorId,
                actorName: actor.actorName,
                actorRole: actor.role,
                note: error instanceof Error ? error.message : "Dealer creation failed",
              }),
            },
          },
        );

        throw error;
      }
    }

    if (action === "reject") {
      if (actor.role !== "admin") {
        return buildResponseError("Only admin can reject dealer requests", 403);
      }

      const rejectionReason = String(body.rejectionReason ?? "").trim().slice(0, 1500);
      if (!rejectionReason) {
        return buildResponseError("Rejection reason is required", 400);
      }

      const hasSnapshot = !!body.formSnapshot;
      const snapshot = hasSnapshot
        ? normalizeDealerFormSnapshot(body.formSnapshot)
        : normalizeDealerFormSnapshot(existing.formSnapshot);
      if (hasSnapshot) {
        const validationError = validateDealerFormSnapshot(snapshot);
        if (validationError) {
          return buildResponseError(validationError, 400);
        }
      }

      const now = new Date().toISOString();
      const rejected = await collection.findOneAndUpdate(
        { _id: oid, status: "pending" },
        {
          $set: {
            ...(hasSnapshot ? buildSnapshotSummary(snapshot) : {}),
            ...(hasSnapshot ? { formSnapshot: snapshot } : {}),
            ...(hasSnapshot ? { requestIdentityKey: buildDealerRequestIdentityKey(snapshot, current.submittedById) } : {}),
            status: "rejected",
            reviewedById: actor.actorId,
            reviewedByName: actor.actorName,
            reviewedAt: now,
            rejectedAt: now,
            acceptedAt: "",
            rejectionReason,
            lastRejectionReason: rejectionReason,
            openRequestKey: null,
            approvalLock: null,
            updatedAt: now,
            auditTrail: appendAuditEntry(current.auditTrail, {
              action: "rejected",
              at: now,
              actorId: actor.actorId,
              actorName: actor.actorName,
              actorRole: actor.role,
              note: rejectionReason,
            }),
          },
        },
        { returnDocument: "after" },
      );

      if (!rejected) {
        return buildResponseError("This request can no longer be rejected", 409);
      }

      return NextResponse.json({ success: true, data: toDealerRequestDetail(rejected) });
    }

    if (actor.role !== "staff" || current.submittedById !== actor.actorId) {
      return buildResponseError("Only the submitting staff member can resubmit this request", 403);
    }

    const snapshot = normalizeDealerFormSnapshot(body.formSnapshot ?? existing.formSnapshot);
    const validationError = validateDealerFormSnapshot(snapshot);
    if (validationError) {
      return buildResponseError(validationError, 400);
    }

    const now = new Date().toISOString();
    try {
      const resubmitted = await collection.findOneAndUpdate(
        { _id: oid, status: "rejected", submittedById: actor.actorId },
        {
          $set: {
            ...buildSnapshotSummary(snapshot),
            formSnapshot: snapshot,
            requestIdentityKey: buildDealerRequestIdentityKey(snapshot, actor.actorId),
            status: "pending",
            reviewedById: "",
            reviewedByName: "",
            reviewedAt: "",
            rejectedAt: "",
            acceptedAt: "",
            rejectionReason: "",
            openRequestKey: buildDealerRequestIdentityKey(snapshot, actor.actorId),
            resubmittedAt: now,
            updatedAt: now,
            approvalLock: null,
            auditTrail: appendAuditEntry(current.auditTrail, {
              action: "resubmitted",
              at: now,
              actorId: actor.actorId,
              actorName: actor.actorName,
              actorRole: actor.role,
            }),
          },
        },
        { returnDocument: "after" },
      );

      if (!resubmitted) {
        return buildResponseError("This request can no longer be resubmitted", 409);
      }

      return NextResponse.json({ success: true, data: toDealerRequestDetail(resubmitted) });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return buildResponseError("A pending request already exists for this dealer details", 409);
      }
      throw error;
    }
  } catch (error) {
    console.error("[PATCH /api/dealer-requests/[id]]", error);
    const status = isMongoDependencyError(error) ? 503 : 500;
    return buildResponseError(
      status === 503
        ? "Dealer request database is currently unavailable"
        : "Failed to update dealer request",
      status,
    );
  }
}

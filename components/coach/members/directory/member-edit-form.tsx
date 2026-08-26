"use client"

import Link from "next/link"

import {
  relationships,
  type MemberDraft,
} from "@/components/coach/members/directory/member-draft"
import type {
  MemberEditor,
  MemberFeedback,
} from "@/components/coach/members/directory/shared"
import {
  memberDirectoryBatches,
  memberDirectoryLevels,
} from "@/components/coach/members/member-directory-query"
import { InlineNotice } from "@/components/inline-notice"
import type { PlayerMemberRecord } from "@/lib/coach/types"
import {
  academyPlanLabel,
  academyPlansFor,
  type AcademyPlan,
} from "@/lib/training/academy-plans"

export function MemberEditForm({
  draft,
  editor,
  feedback,
  hasActiveAssignments,
  player,
  retryAction,
}: {
  draft: MemberDraft
  editor: MemberEditor
  feedback: MemberFeedback | null
  hasActiveAssignments: boolean
  player: PlayerMemberRecord
  retryAction: "archive" | "save" | undefined
}) {
  const {
    errors,
    formRef,
    isDirty,
    isSaving,
    onCancel,
    onSave,
    onSelectBatch,
    onSelectLevel,
    onUpdateField,
  } = editor
  const memberId = player.member.id
  const classificationLockId = `member-${memberId}-classification-lock`

  return (
    <form
      ref={formRef}
      className="coach-member-edit-form"
      autoComplete="on"
      onSubmit={(event) => {
        event.preventDefault()
        onSave(player)
      }}
    >
      <fieldset disabled={isSaving}>
        <legend>Profile</legend>
        <div className="coach-member-form-grid">
          <label>
            <span>Full name</span>
            <input
              id={`member-${memberId}-full-name`}
              name="fullName"
              type="text"
              autoComplete="name"
              maxLength={80}
              value={draft.fullName}
              aria-invalid={Boolean(errors.fullName)}
              aria-describedby={errors.fullName ? `member-${memberId}-full-name-error` : undefined}
              onChange={(event) => onUpdateField("fullName", event.target.value)}
            />
            {errors.fullName ? <small id={`member-${memberId}-full-name-error`}>{errors.fullName}</small> : null}
          </label>
          <label>
            <span>Primary contact</span>
            <input
              id={`member-${memberId}-contact-name`}
              name="contactName"
              type="text"
              autoComplete="name"
              maxLength={80}
              value={draft.contactName}
              aria-invalid={Boolean(errors.contactName)}
              aria-describedby={errors.contactName ? `member-${memberId}-contact-name-error` : undefined}
              onChange={(event) => onUpdateField("contactName", event.target.value)}
            />
            {errors.contactName ? <small id={`member-${memberId}-contact-name-error`}>{errors.contactName}</small> : null}
          </label>
          <label>
            <span>Relationship</span>
            <select
              id={`member-${memberId}-relationship`}
              name="relationship"
              value={draft.relationship}
              aria-invalid={Boolean(errors.relationship)}
              aria-describedby={errors.relationship ? `member-${memberId}-relationship-error` : undefined}
              onChange={(event) => onUpdateField("relationship", event.target.value)}
            >
              <option value="">Not added</option>
              {relationships.map((item) => <option key={item}>{item}</option>)}
            </select>
            {errors.relationship ? <small id={`member-${memberId}-relationship-error`}>{errors.relationship}</small> : null}
          </label>
          <label className="is-wide">
            <span>Phone</span>
            <input
              id={`member-${memberId}-phone`}
              name="phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              maxLength={32}
              value={draft.phone}
              aria-invalid={Boolean(errors.phone)}
              aria-describedby={errors.phone ? `member-${memberId}-phone-error` : undefined}
              onChange={(event) => onUpdateField("phone", event.target.value)}
            />
            {errors.phone ? <small id={`member-${memberId}-phone-error`}>{errors.phone}</small> : null}
          </label>
        </div>
      </fieldset>

      <fieldset disabled={isSaving}>
        <legend>Training</legend>
        {hasActiveAssignments ? (
          <p
            id={classificationLockId}
            className="coach-member-classification-lock"
          >
            End active session assignments before changing these training details.{" "}
            <Link href={`/coach/schedules?player=${encodeURIComponent(memberId)}`}>
              Review schedules
            </Link>
          </p>
        ) : null}
        <div className="coach-member-form-grid">
          <label>
            <span>Level</span>
            <select
              id={`member-${memberId}-level`}
              name="level"
              value={draft.level}
              disabled={hasActiveAssignments}
              aria-invalid={Boolean(errors.level)}
              aria-describedby={[
                errors.level ? `member-${memberId}-level-error` : null,
                hasActiveAssignments ? classificationLockId : null,
              ].filter(Boolean).join(" ") || undefined}
              onChange={(event) => onSelectLevel(event.target.value as MemberDraft["level"])}
            >
              <option>Assessment pending</option>
              {memberDirectoryLevels.map((item) => <option key={item}>{item}</option>)}
            </select>
            {errors.level ? <small id={`member-${memberId}-level-error`}>{errors.level}</small> : null}
          </label>
          <label>
            <span>Batch</span>
            <select
              id={`member-${memberId}-batch`}
              name="batch"
              value={draft.batch}
              disabled={hasActiveAssignments}
              aria-invalid={Boolean(errors.batch)}
              aria-describedby={[
                errors.batch ? `member-${memberId}-batch-error` : null,
                hasActiveAssignments ? classificationLockId : null,
              ].filter(Boolean).join(" ") || undefined}
              onChange={(event) => onSelectBatch(event.target.value as MemberDraft["batch"])}
            >
              <option>Assessment pending</option>
              {memberDirectoryBatches.map((item) => <option key={item}>{item}</option>)}
            </select>
            {errors.batch ? <small id={`member-${memberId}-batch-error`}>{errors.batch}</small> : null}
          </label>
          <label>
            <span>Academy Plan</span>
            <select
              id={`member-${memberId}-academy-plan`}
              name="academyPlan"
              value={draft.academyPlan ?? ""}
              disabled={hasActiveAssignments
                || draft.level === "Assessment pending"
                || draft.batch === "Assessment pending"}
              aria-invalid={Boolean(errors.academyPlan)}
              aria-describedby={[
                errors.academyPlan ? `member-${memberId}-academy-plan-error` : null,
                hasActiveAssignments ? classificationLockId : null,
              ].filter(Boolean).join(" ") || undefined}
              onChange={(event) => {
                onUpdateField(
                  "academyPlan",
                  event.target.value ? event.target.value as AcademyPlan : null,
                )
              }}
            >
              <option value="">Needs review</option>
              {draft.level !== "Assessment pending" && draft.batch !== "Assessment pending"
                ? academyPlansFor(draft.level, draft.batch).map((plan) => (
                    <option key={plan} value={plan}>{academyPlanLabel(plan)}</option>
                  ))
                : null}
            </select>
            {errors.academyPlan ? <small id={`member-${memberId}-academy-plan-error`}>{errors.academyPlan}</small> : null}
          </label>
          <div className="coach-member-form-status">
            <span>Status</span>
            <strong>{player.training.status}</strong>
            <small>Managed by active session assignments.</small>
          </div>
        </div>
      </fieldset>

      <div className="coach-member-form-actions">
        <InlineNotice
          className="coach-member-editor-notice"
          message={feedback
            ? feedback.message
            : isDirty ? "Unsaved changes" : null}
          tone={feedback
            ? feedback.tone
            : "info"}
        />
        <div className="coach-member-editor-actions">
          <button type="button" disabled={isSaving} onClick={onCancel}>Cancel</button>
          <button className="is-primary" type="submit" disabled={isSaving}>
            {isSaving
              ? "Saving…"
              : retryAction === "save" ? "Save member again" : "Save member"}
          </button>
        </div>
      </div>
    </form>
  )
}

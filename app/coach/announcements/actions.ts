"use server"

import { revalidatePath } from "next/cache"

import type {
  AnnouncementActionResult,
  PublishAnnouncementInput,
  SetAnnouncementPinnedInput,
  WithdrawAnnouncementInput,
} from "@/lib/announcements/contracts"
import {
  AnnouncementServiceError,
  publishAnnouncement,
  setAnnouncementPinned,
  withdrawAnnouncement,
} from "@/lib/announcements/service"
import { requireHeadAdminAction } from "@/lib/auth/current-coach"

function revalidateAnnouncements(announcementId?: string) {
  revalidatePath("/coach")
  revalidatePath("/coach/announcements")
  revalidatePath("/coach/announcements/new")
  revalidatePath("/player")
  revalidatePath("/player/announcements")
  revalidatePath("/api/public/announcements")
  if (announcementId) {
    revalidatePath(`/coach/announcements/${announcementId}`)
    revalidatePath(`/announcements/${announcementId}`)
    revalidatePath(`/player/announcements/${announcementId}`)
  }
}

function failure(error: AnnouncementServiceError): AnnouncementActionResult {
  return {
    ok: false,
    code: error.code,
    field: error.field,
    message: error.message,
  }
}

export async function publishAnnouncementAction(
  input: PublishAnnouncementInput,
): Promise<AnnouncementActionResult> {
  const coach = await requireHeadAdminAction()
  try {
    const result = await publishAnnouncement(input, { coachId: coach.subjectId })
    revalidateAnnouncements(result.announcement.id)
    return {
      ok: true,
      announcement: result.announcement,
      message: result.reusedPublication
        ? "Announcement already published"
        : "Announcement published",
      reused: result.reusedPublication,
    }
  } catch (error) {
    if (error instanceof AnnouncementServiceError) return failure(error)
    throw error
  }
}

export async function setAnnouncementPinnedAction(
  input: SetAnnouncementPinnedInput,
): Promise<AnnouncementActionResult> {
  const coach = await requireHeadAdminAction()
  try {
    const result = await setAnnouncementPinned(input, { coachId: coach.subjectId })
    revalidateAnnouncements(result.announcement.id)
    return {
      ok: true,
      announcement: result.announcement,
      message: result.announcement.pinned ? "Announcement pinned" : "Announcement unpinned",
      reused: result.reused,
    }
  } catch (error) {
    if (error instanceof AnnouncementServiceError) return failure(error)
    throw error
  }
}

export async function withdrawAnnouncementAction(
  input: WithdrawAnnouncementInput,
): Promise<AnnouncementActionResult> {
  const coach = await requireHeadAdminAction()
  try {
    const result = await withdrawAnnouncement(input, { coachId: coach.subjectId })
    revalidateAnnouncements(result.announcement.id)
    return {
      ok: true,
      announcement: result.announcement,
      message: result.reused ? "Announcement already withdrawn" : "Announcement withdrawn",
      reused: result.reused,
    }
  } catch (error) {
    if (error instanceof AnnouncementServiceError) return failure(error)
    throw error
  }
}

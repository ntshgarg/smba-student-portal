"use client"

import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { Fragment } from "react"

import { MemberDetailRow } from "@/components/coach/members/directory/member-detail-row"
import { MemberDirectoryEmptyState } from "@/components/coach/members/directory/member-directory-empty-state"
import { MemberSummaryRow } from "@/components/coach/members/directory/member-summary-row"
import {
  StaffDetailRow,
  StaffSummaryRow,
} from "@/components/coach/members/directory/staff-summary-row"
import { useMemberDirectory } from "@/components/coach/members/directory/use-member-directory"
import { MemberDirectoryFilters } from "@/components/coach/members/member-directory-filters"
import { memberWindowSummary } from "@/components/coach/members/member-window"
import { InlineNotice } from "@/components/inline-notice"
import type { AcademyStaffMember } from "@/lib/coach/types"

/*
 * Staff arrive as a prop rather than through `CoachPortalProvider`. The
 * provider's member context is player-shaped all the way down -- it runs every
 * row through `isAcademyMember` and throws if one fails -- and that guard is
 * worth more than the symmetry would be.
 */
export function MemberDirectory({ staff = [] }: { staff?: AcademyStaffMember[] }) {
  const {
    activeFilterCount,
    archivingMemberId,
    beginEditing,
    directoryFeedback,
    directorySummaryRef,
    draft,
    editingMemberId,
    editor,
    expandedMemberId,
    filtersOpen,
    handleArchive,
    hasDirectoryCriteria,
    hasMoreMembers,
    memberFeedback,
    openMember,
    players,
    resetFilters,
    revealContact,
    revealMoreMembers,
    revealedContacts,
    sessionLabelsByPlayer,
    setContactLinkRef,
    setEditButtonRef,
    setFiltersOpen,
    directoryCount,
    updateDirectoryCriteria,
    urlCriteria,
    visiblePlayers,
    visibleStaff,
  } = useMemberDirectory(staff)

  const visibleCount = visiblePlayers.length + visibleStaff.length

  return (
    <div className="coach-members-directory page-shell">
      <div className="coach-members-back-row">
        <Link href="/coach">
          <ArrowLeft aria-hidden="true" /> Back to dashboard
        </Link>
      </div>

      <header className="coach-members-directory-header">
        <div>
          <span className="eyebrow">Court roster register</span>
          <h1>Member Directory</h1>
        </div>
      </header>

      <section className="coach-member-directory-panel" aria-labelledby="member-directory-title">
        <InlineNotice
          className="coach-directory-notice"
          message={directoryFeedback?.message}
          tone={directoryFeedback?.tone}
        />

        <div className="coach-member-register-tools">
          <MemberDirectoryFilters
            activeFilterCount={activeFilterCount}
            criteria={urlCriteria}
            onChange={updateDirectoryCriteria}
            onToggle={() => setFiltersOpen((current) => !current)}
            open={filtersOpen}
          />

          <div className="coach-member-directory-summary">
            <h2
              ref={directorySummaryRef}
              id="member-directory-title"
              aria-live="polite"
              aria-atomic="true"
              tabIndex={-1}
            >
              {memberWindowSummary(visibleCount, directoryCount)}
            </h2>
            <p>Private contacts remain concealed.</p>
          </div>
        </div>

        {directoryCount ? (
          <div className="coach-member-table-wrap">
            <table className="coach-member-table">
              <thead>
                <tr>
                  <th scope="col"><span className="sr-only">Roster number</span></th>
                  <th scope="col">Member</th>
                  <th scope="col">Training</th>
                  <th scope="col">Sessions</th>
                  <th scope="col">Training from</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody id="coach-member-results">
                {visiblePlayers.map((player, index) => {
                  const memberId = player.member.id
                  const isExpanded = expandedMemberId === memberId
                  const activeSessionLabels = sessionLabelsByPlayer.get(memberId) ?? []
                  const currentMemberFeedback = memberFeedback?.memberId === memberId
                    ? memberFeedback
                    : null

                  return (
                    <Fragment key={memberId}>
                      <MemberSummaryRow
                        activeSessionLabels={activeSessionLabels}
                        index={index}
                        isExpanded={isExpanded}
                        onOpen={openMember}
                        player={player}
                      />

                      {isExpanded ? (
                        <MemberDetailRow
                          activeSessionLabels={activeSessionLabels}
                          contactRevealed={revealedContacts.has(memberId)}
                          draft={draft}
                          editor={editor}
                          feedback={currentMemberFeedback}
                          isArchiving={archivingMemberId === memberId}
                          isEditing={editingMemberId === memberId}
                          onArchive={handleArchive}
                          onBeginEdit={beginEditing}
                          onRevealContact={revealContact}
                          player={player}
                          setContactLinkRef={setContactLinkRef}
                          setEditButtonRef={setEditButtonRef}
                        />
                      ) : null}
                    </Fragment>
                  )
                })}

                {visibleStaff.map((member, index) => {
                  const isExpanded = expandedMemberId === member.id

                  return (
                    <Fragment key={member.id}>
                      <StaffSummaryRow
                        index={visiblePlayers.length + index}
                        isExpanded={isExpanded}
                        onOpen={openMember}
                        staff={member}
                      />
                      {isExpanded ? <StaffDetailRow staff={member} /> : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            {hasMoreMembers ? (
              <button
                className="coach-member-show-more"
                type="button"
                aria-controls="coach-member-results"
                onClick={revealMoreMembers}
              >
                Show more members
              </button>
            ) : null}
          </div>
        ) : (
          <MemberDirectoryEmptyState
            hasDirectoryCriteria={hasDirectoryCriteria}
            onResetFilters={resetFilters}
            playerCount={players.length + staff.length}
          />
        )}
      </section>
    </div>
  )
}

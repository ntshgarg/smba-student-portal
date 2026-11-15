"use client"

import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react"
import Link from "next/link"

import { MemberDetailRow } from "@/components/coach/members/directory/member-detail-row"
import { MemberDirectoryEmptyState } from "@/components/coach/members/directory/member-directory-empty-state"
import { MemberSummaryRow } from "@/components/coach/members/directory/member-summary-row"
import {
  StaffDetailRow,
  StaffSummaryRow,
} from "@/components/coach/members/directory/staff-summary-row"
import { useMemberDirectory } from "@/components/coach/members/directory/use-member-directory"
import { MemberDirectoryFilters } from "@/components/coach/members/member-directory-filters"
import { memberPageNumbers, memberPageSummary } from "@/components/coach/members/member-window"
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
    earliestByPlayer,
    editingMemberId,
    editor,
    expandedMemberId,
    filtersOpen,
    goToPage,
    page,
    pageCount,
    handleArchive,
    hasDirectoryCriteria,
    memberFeedback,
    noteStaffArchived,
    openMember,
    players,
    resetFilters,
    revealContact,
    revealedContacts,
    sessionTimesByPlayer,
    setContactLinkRef,
    setEditButtonRef,
    setFiltersOpen,
    directoryCount,
    updateDirectoryCriteria,
    urlCriteria,
    visiblePlayers,
    visibleStaff,
  } = useMemberDirectory(staff)

  return (
    <div className="coach-members-directory page-shell">
      <div className="coach-members-back-row">
        <Link href="/coach">
          <ArrowLeft aria-hidden="true" /> Back to dashboard
        </Link>
      </div>

      <header className="coach-members-directory-header">
        <h1>Members</h1>
      </header>

      <section className="coach-member-directory-panel" aria-labelledby="member-directory-title">
        <InlineNotice
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

          <h2
            ref={directorySummaryRef}
            id="member-directory-title"
            className="coach-member-directory-summary"
            aria-live="polite"
            aria-atomic="true"
            tabIndex={-1}
          >
            {memberPageSummary(page, directoryCount)}
          </h2>
        </div>

        {directoryCount ? (
          <>
            <ul className="coach-member-list" id="coach-member-results">
              {visiblePlayers.map((player) => {
                const memberId = player.member.id
                const isExpanded = expandedMemberId === memberId
                const sessionTimes = sessionTimesByPlayer.get(memberId) ?? []

                return (
                  <li key={memberId} className={`coach-member-item${isExpanded ? " is-open" : ""}`}>
                    <MemberSummaryRow
                      isExpanded={isExpanded}
                      onOpen={openMember}
                      player={player}
                      sessionTimes={sessionTimes}
                    />

                    {isExpanded ? (
                      <MemberDetailRow
                        contactRevealed={revealedContacts.has(memberId)}
                        draft={draft}
                        editor={editor}
                        feedback={memberFeedback?.memberId === memberId ? memberFeedback : null}
                        holdsPlace={earliestByPlayer.has(memberId)}
                        isArchiving={archivingMemberId === memberId}
                        isEditing={editingMemberId === memberId}
                        onArchive={handleArchive}
                        onBeginEdit={beginEditing}
                        onRevealContact={revealContact}
                        player={player}
                        sessionTimes={sessionTimes}
                        setContactLinkRef={setContactLinkRef}
                        setEditButtonRef={setEditButtonRef}
                      />
                    ) : null}
                  </li>
                )
              })}

              {visibleStaff.map((member) => {
                const isExpanded = expandedMemberId === member.id

                return (
                  <li key={member.id} className={`coach-member-item${isExpanded ? " is-open" : ""}`}>
                    <StaffSummaryRow isExpanded={isExpanded} onOpen={openMember} staff={member} />
                    {isExpanded ? <StaffDetailRow onArchived={noteStaffArchived} staff={member} /> : null}
                  </li>
                )
              })}
            </ul>
            {pageCount > 1 ? (
              <nav className="coach-member-pager" aria-label="Member pages">
                <button
                  type="button"
                  disabled={page === 1}
                  onClick={() => goToPage(page - 1)}
                >
                  <ChevronLeft aria-hidden="true" /> Previous
                </button>
                <ol>
                  {memberPageNumbers(page, pageCount).map((item, index) => (
                    <li key={item === "gap" ? `gap-${index}` : item}>
                      {item === "gap" ? (
                        <span aria-hidden="true">…</span>
                      ) : (
                        <button
                          type="button"
                          aria-current={item === page ? "page" : undefined}
                          aria-label={`Page ${item}`}
                          onClick={() => goToPage(item)}
                        >
                          {item}
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
                <button
                  type="button"
                  disabled={page === pageCount}
                  onClick={() => goToPage(page + 1)}
                >
                  Next <ChevronRight aria-hidden="true" />
                </button>
              </nav>
            ) : null}
          </>
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

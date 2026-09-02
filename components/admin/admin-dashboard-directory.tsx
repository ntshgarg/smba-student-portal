"use client"

import { ArrowUpRight, Search } from "lucide-react"
import { useDeferredValue, useMemo, useState } from "react"

import { startAdminPreviewAction } from "@/app/admin/actions"

type AdminPreviewTarget = {
  academyId: string
  accessLevel: string | null
  fullName: string
  id: string
  role: "coach" | "platform_admin" | "player" | null
}

function roleLabel(target: AdminPreviewTarget) {
  if (target.role === "player") return "Player"
  return target.accessLevel === "head_admin" ? "Head coach" : "Assistant coach"
}

function searchText(target: AdminPreviewTarget) {
  const role = roleLabel(target)
  const aliases = target.role === "player"
    ? "member student"
    : target.accessLevel === "head_admin"
      ? "coach head coach"
      : "coach assistant coach junior coach sub coach"
  return `${target.fullName} ${target.academyId} ${role} ${aliases}`.toLocaleLowerCase("en")
}

export function AdminDashboardDirectory({
  targets,
}: {
  targets: AdminPreviewTarget[]
}) {
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)
  const normalizedQuery = deferredQuery.trim().toLocaleLowerCase("en")
  const filteredTargets = useMemo(() => {
    if (!normalizedQuery) return targets
    return targets.filter((target) => searchText(target).includes(normalizedQuery))
  }, [normalizedQuery, targets])
  const targetGroups = [
    {
      id: "coaches",
      label: "Coaching team",
      targets: filteredTargets.filter((target) => target.role === "coach"),
    },
    {
      id: "players",
      label: "Players",
      targets: filteredTargets.filter((target) => target.role === "player"),
    },
  ].filter((group) => group.targets.length > 0)
  const resultLabel = normalizedQuery
    ? `${filteredTargets.length} ${filteredTargets.length === 1 ? "match" : "matches"}`
    : `${targets.length} ${targets.length === 1 ? "account" : "accounts"}`

  return (
    <>
      <div className="admin-directory-tools">
        <label htmlFor="admin-directory-search">Search accounts</label>
        <div className="admin-directory-search-row">
          <div className="admin-directory-search-field">
            <Search aria-hidden="true" />
            <input
              id="admin-directory-search"
              name="accountSearch"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, SMBA ID, or role"
              type="search"
              value={query}
            />
          </div>
          <span aria-live="polite">{resultLabel}</span>
        </div>
      </div>

      {targetGroups.length ? (
        <div className="admin-preview-groups">
          {targetGroups.map((group) => (
            <section
              className="admin-preview-group"
              aria-labelledby={`admin-preview-${group.id}`}
              key={group.id}
            >
              <header className="admin-preview-group-header">
                <h3 id={`admin-preview-${group.id}`}>{group.label}</h3>
                <span>{group.targets.length} {group.targets.length === 1 ? "account" : "accounts"}</span>
              </header>
              <div className="admin-preview-list">
                {group.targets.map((target) => (
                  <article key={target.id}>
                    <div>
                      <small>{roleLabel(target)}</small>
                      <strong>{target.fullName}</strong>
                      <span>{target.academyId}</span>
                    </div>
                    <form action={startAdminPreviewAction}>
                      <input type="hidden" name="targetAccountId" value={target.id} />
                      <button type="submit">
                        <span>View dashboard</span>
                        <ArrowUpRight aria-hidden="true" />
                      </button>
                    </form>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <p className="admin-directory-empty">
          No accounts match “{deferredQuery.trim()}”. Try a name, SMBA ID, or role.
        </p>
      )}
    </>
  )
}

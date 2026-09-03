import { describe, expect, it } from "vitest"

import {
  announcementChannelAudience,
  announcementChannelIsPublic,
  announcementChannelLabel,
} from "@/components/coach/announcements/contracts"

/**
 * The distance between "a note for our families" and "published to anyone on
 * the internet" was one checkbox labelled "Homepage" -- a name that reads like
 * the academy's own page. These pin the words that close that gap, because they
 * are the whole control: a coach deciding whether a child's name belongs in a
 * message is deciding it against what these say.
 */
describe("what a coach is told about where an announcement goes", () => {
  it("says the homepage is the public internet, not the academy's own page", () => {
    expect(announcementChannelLabel("homepage")).toBe("Homepage")
    expect(announcementChannelAudience("homepage")).toBe("Anyone on the internet")
    expect(announcementChannelIsPublic("homepage")).toBe(true)
  })

  it("says the player dashboard is behind a sign-in", () => {
    expect(announcementChannelAudience("player_dashboard")).toBe("Signed-in families only")
    expect(announcementChannelIsPublic("player_dashboard")).toBe(false)
  })

  it("never describes a channel as public unless it is", () => {
    // The warning on the review screen is shown only when this is true. A
    // warning that appears every time is furniture a coach reads past.
    const channels = ["homepage", "player_dashboard"] as const
    expect(channels.filter(announcementChannelIsPublic)).toEqual(["homepage"])
  })
})

import { describe, expect, it } from "vitest"

import {
  ACTIVITY_GROUPS,
  activityEventTypesFor,
  registerStatusesFor,
} from "@/lib/finance/records-filters"

describe("the Fees filters in the address", () => {
  it("reads a status tile's key or one status from an older link", () => {
    expect(registerStatusesFor("due")).toEqual(["pending", "partially_paid"])
    expect(registerStatusesFor("not_prepared")).toEqual(["not_prepared"])
    expect(registerStatusesFor("partially_paid")).toEqual(["partially_paid"])
    expect(registerStatusesFor("all")).toBeUndefined()
    expect(registerStatusesFor("nonsense")).toBeUndefined()
    expect(registerStatusesFor(undefined)).toBeUndefined()
  })

  it("reads an activity chip's key or one event type from an older link", () => {
    const payments = ACTIVITY_GROUPS.find((group) => group.key === "payments")!
    expect(activityEventTypesFor("payments")).toEqual(payments.eventTypes)
    expect(activityEventTypesFor("refund_reversed")).toEqual(["refund_reversed"])
    expect(activityEventTypesFor("all")).toBeUndefined()
    expect(activityEventTypesFor("nonsense")).toBeUndefined()
  })
})

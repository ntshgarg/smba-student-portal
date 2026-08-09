import { describe, expect, it } from "vitest"

import {
  captureDefinitions,
  criticalViewports,
  primaryViewport,
  viewportsForCapture,
} from "./e2e/support/capture-matrix"

describe("financial regression capture matrix", () => {
  it("captures the dedicated Record Payment workspace", () => {
    const definition = captureDefinitions.find((item) => (
      item.id === "coach-financials-record-payment"
    ))

    expect(definition).toMatchObject({
      actor: "coach",
      critical: true,
      route: "/coach/financials/record?scope=outstanding",
      scenarios: ["loaded"],
    })
    expect(definition && viewportsForCapture(definition)).toEqual(criticalViewports)
  })

  it("captures the All players payment lookup without multiplying the critical matrix", () => {
    const definition = captureDefinitions.find((item) => (
      item.id === "coach-financials-record-payment-all"
    ))

    expect(definition).toMatchObject({
      actor: "coach",
      route: "/coach/financials/record?scope=all",
      scenarios: ["loaded"],
    })
    expect(definition && viewportsForCapture(definition)).toEqual([primaryViewport])
  })

  it("opens the focused player Fee Record from the monthly Fee Register", () => {
    const definition = captureDefinitions.find((item) => (
      item.id === "coach-financials-player-record"
    ))

    expect(definition).toMatchObject({
      actions: ["financial-player-record-open"],
      actor: "coach",
      route: "/coach/financials/records?view=fees&mode=monthly&period=2026-08&scope=active&status=all",
      scenarios: ["loaded"],
    })
    expect(definition && viewportsForCapture(definition)).toEqual([primaryViewport])
  })

  it("does not capture the removed combined Financials workspace", () => {
    const combinedDefinitions = captureDefinitions.filter((item) => (
      item.route.startsWith("/coach/financials?")
      || ["coach-financials-default", "coach-financials-player-ledger"].includes(item.id)
    ))

    expect(combinedDefinitions).toEqual([])
  })

  it("captures every Phase 3 Financial Records view without mutations", () => {
    const definitions = captureDefinitions.filter((item) => (
      item.id.startsWith("coach-financial-records-")
    ))

    expect(definitions.map((item) => item.id)).toEqual([
      "coach-financial-records-fees",
      "coach-financial-records-collections",
      "coach-financial-records-activity",
    ])
    expect(definitions.every((item) => (
      item.actor === "coach"
      && item.scenarios?.includes("loaded")
      && !item.actions?.length
    ))).toBe(true)
  })
})

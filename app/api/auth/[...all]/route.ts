import { toNextJsHandler } from "better-auth/next-js"

import { getAuth } from "@/lib/auth/better-auth"

export function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request)
}

export function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(request)
}

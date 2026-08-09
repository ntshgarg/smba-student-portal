export type ClipboardWriter = {
  writeText: (value: string) => Promise<void>
}

export async function tryCopyText(
  value: string,
  clipboard?: ClipboardWriter | null,
) {
  if (!clipboard) return false

  try {
    await clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

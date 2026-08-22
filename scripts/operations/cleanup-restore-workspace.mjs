import { cleanupRestoreWorkspace } from "./backup-restore.mjs"

const [workDirectory] = process.argv.slice(2)
if (!workDirectory) throw new Error("Provide the restore workspace to clean.")
cleanupRestoreWorkspace(workDirectory)

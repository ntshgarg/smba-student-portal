import { completeInitialPlatformAdminSetup } from "../../lib/auth/initial-setup"

const password = process.env.SMBA_INITIAL_ADMIN_PASSWORD?.trim() ?? ""
const pin = process.env.SMBA_INITIAL_ADMIN_PIN?.trim() ?? ""
const fullName = process.env.SMBA_INITIAL_ADMIN_NAME?.trim() || "SMBA Platform Owner"

if (!password) throw new Error("SMBA_INITIAL_ADMIN_PASSWORD is required.")
if (!pin) throw new Error("SMBA_INITIAL_ADMIN_PIN is required.")

async function main() {
  const account = await completeInitialPlatformAdminSetup({
    fullName,
    password,
    confirmPassword: password,
    pin,
    confirmPin: pin,
  })

  console.log(JSON.stringify({
    academyId: account.academyId,
    fullName: account.fullName,
    provisioned: true,
  }))
}

void main()

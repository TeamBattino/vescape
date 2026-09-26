import { isDevelopmentApp } from './appVariant'

export const clerkPublishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY
export const isAccountConfigured = Boolean(clerkPublishableKey)

// Development installs can exercise local riding and independently connected services.
// Release builds still require the real Vescape account configuration.
if (!isAccountConfigured && !isDevelopmentApp) {
  throw new Error('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is not configured')
}

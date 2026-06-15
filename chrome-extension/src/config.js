// Environment config — mirrors ios/Shared/AppConfig.swift.
// Switch the active environment by changing ACTIVE below (or via the popup toggle,
// which persists `env` in chrome.storage.local).

export const ENVIRONMENTS = {
  sandbox: {
    apiBaseURL: "https://api.recipator.sandbox.nakomis.com",
    cognitoClientID: "2nqfrt40559k92m3tbtklsbqrd",
    cognitoLoginDomain: "login.sandbox.nakomis.com",
  },
  production: {
    apiBaseURL: "https://api.recipator.nakomis.com",
    cognitoClientID: "76fjbk2iqp7slhdsolgeotp6ih",
    cognitoLoginDomain: "login.nakomis.com",
  },
};

export const DEFAULT_ENV = "production";

// Cognito hosted-UI OAuth — same scopes/flow as the iOS PKCE client.
export const OAUTH_SCOPE = "openid email profile";

export async function getEnvName() {
  const { env } = await chrome.storage.local.get("env");
  return env && ENVIRONMENTS[env] ? env : DEFAULT_ENV;
}

export async function getConfig() {
  return ENVIRONMENTS[await getEnvName()];
}

export async function setEnvName(env) {
  if (!ENVIRONMENTS[env]) throw new Error(`Unknown environment: ${env}`);
  await chrome.storage.local.set({ env });
}

export async function openCreatorMarket(user, destination = "/member") {
  if (!user) throw new Error("Sign in to DateVault before opening Creator Market.");
  const idToken = await user.getIdToken();
  const response = await fetch("/api/market-sso-issue", {
    method: "POST",
    cache: "no-store",
    headers: {
      "Authorization": `Bearer ${idToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ destination })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success || !result.redirectUrl) {
    throw new Error(result.error || "Could not connect to Creator Market. Please try again.");
  }
  // The redirect URL contains only a short-lived, single-use code, never a
  // Firebase ID token or refresh token.
  window.location.assign(result.redirectUrl);
}

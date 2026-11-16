// Which docs site this build is for. squiffystory.com documents the current stable release and is
// built from its release tag by .github/workflows/deploy-site.yml; beta.squiffystory.com documents
// the next release and is built from main. Cloudflare Pages sets PUBLIC_BETA_SITE=true for every
// non-production build (main, and PR previews). See "Deployments" in CLAUDE.md.

import process from "node:process";

export const stableSiteUrl = "https://squiffystory.com";
export const betaSiteUrl = "https://beta.squiffystory.com";

export const betaSite = process.env.PUBLIC_BETA_SITE === "true";

/** The site this build is served from, for canonical links and the sitemap. */
export const siteUrl = betaSite ? betaSiteUrl : stableSiteUrl;

export const stableAppUrl = "https://app.squiffystory.com";
export const betaAppUrl = "https://app-beta.squiffystory.com";

/**
 * The editor that matches these docs: deploy-app.yml sends prereleases to the beta one.
 * Until the first Squiffy 7 prerelease (7.0.0-beta.1) there's nothing at app-beta, so the beta
 * docs link to the stable editor too. When that ships, change this back to:
 *   export const appUrl = betaSite ? betaAppUrl : stableAppUrl;
 */
export const appUrl = stableAppUrl;

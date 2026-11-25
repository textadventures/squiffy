// Which channel this editor is. VITE_BETA_APP says it was built for app-beta.squiffystory.com or
// Squiffy Beta, and the version says whether it's a beta: from a stable release until the next
// beta, app-beta.squiffystory.com runs the stable release (deploy-app.yml), and is the beta app
// in name only.
export const builtForBetaSite = import.meta.env.VITE_BETA_APP === "true";
export const isPrerelease = __APP_VERSION__.includes("-");
export const isBetaApp = builtForBetaSite && isPrerelease;

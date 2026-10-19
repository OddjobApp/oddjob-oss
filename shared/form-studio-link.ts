/**
 * The rules for a published form's public link: whether a respondent must prove an
 * email address with a code first, and how long the link works after the release
 * it serves was published.
 *
 * Read from the form's securityConfig at request time rather than copied into each
 * release, so an author who tightens a link does not have to publish again.
 */

export interface FormLinkSecurity {
  requireOtp: boolean;
  /** Hours the link works after publishing; null means it does not expire. */
  tokenExpirationHours: number | null;
}

/** The header a respondent's code session travels in. */
export const FORM_SESSION_HEADER = "x-form-session";

export const MAX_LINK_HOURS = 24 * 365;

export function linkSecurityOf(securityConfig: unknown): FormLinkSecurity {
  const config = (securityConfig && typeof securityConfig === "object" ? securityConfig : {}) as Record<string, unknown>;
  const hours = Number(config.tokenExpirationHours);
  return {
    requireOtp: config.requireOtp === true,
    tokenExpirationHours: Number.isInteger(hours) && hours >= 1 && hours <= MAX_LINK_HOURS ? hours : null,
  };
}

/**
 * Who a published form's link is for. A form in a private Project Space is for the
 * project's members unless its author opened the link to anyone: a members-only link
 * always asks for an email code and sends one only to a member. A link anywhere else
 * is for anyone. An unset choice (null) takes the default for where the form is.
 */
export type FormLinkAudience = "anyone" | "project_members";

export function linkAudienceOf(securityConfig: unknown): FormLinkAudience | null {
  const value = securityConfig && typeof securityConfig === "object" ? (securityConfig as Record<string, unknown>).linkAudience : null;
  return value === "anyone" || value === "project_members" ? value : null;
}

/** The audience that applies: members only in a private project, unless the author chose anyone. */
export function effectiveLinkAudience(chosen: FormLinkAudience | null, inPrivateProject: boolean): FormLinkAudience {
  return inPrivateProject && chosen !== "anyone" ? "project_members" : "anyone";
}

export function linkExpiresAt(publishedAt: string | Date | null | undefined, security: FormLinkSecurity): Date | null {
  if (!publishedAt || security.tokenExpirationHours == null) return null;
  const start = new Date(publishedAt);
  if (Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() + security.tokenExpirationHours * 60 * 60 * 1000);
}

export function isLinkExpired(publishedAt: string | Date | null | undefined, security: FormLinkSecurity, now: Date = new Date()): boolean {
  const expiresAt = linkExpiresAt(publishedAt, security);
  return expiresAt !== null && now.getTime() >= expiresAt.getTime();
}

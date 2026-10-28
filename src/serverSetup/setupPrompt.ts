export interface SetupPromptState {
  /** The user dismissed the notification for good. */
  dismissed: boolean;
  /** `aa2m.server.command` has a nonblank value in User, Remote, workspace or folder settings. */
  commandConfigured: boolean;
}

/**
 * On activation, offer server setup while `aa2m.server.command` is unset. The
 * default `aa2modulus` may still be on PATH, so the user can dismiss it for good.
 */
export function shouldOfferSetup(state: SetupPromptState): boolean {
  return !state.dismissed && !state.commandConfigured;
}

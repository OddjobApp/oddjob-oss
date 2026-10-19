/** Only an existing governed app proposal bound to this room may be mounted by a surface. */
export function isBoundSurfaceApproval(args: any, appId: number, roomKey: string): boolean {
  return args?.kind === 'app_record_action' && args?.app?.id === appId && args?.sessionKey === roomKey;
}

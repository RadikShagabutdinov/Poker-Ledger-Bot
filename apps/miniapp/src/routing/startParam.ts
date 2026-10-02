// Initial screen by `start_param` (SPEC §12.1).

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** App path for a launch `start_param`; unknown or empty values open «My chats». */
export function startParamToPath(startParam: string | undefined): string {
  const match = /^([gcs])_(.+)$/.exec(startParam ?? '');
  const [, kind, id] = match ?? [];
  if (kind === undefined || id === undefined || !ID.test(id)) {
    return '/';
  }
  switch (kind) {
    case 'g':
      return `/games/${id}`;
    case 'c':
      return `/chats/${id}`;
    default:
      return `/chats/${id}/settings`;
  }
}

/**
 * Points the hash router at the start screen once per launch. A reload keeps the current
 * hash, so it does not throw the user back to the start screen.
 */
export function applyStartParam(startParam: string | undefined, location: Location): void {
  if (location.hash === '' || location.hash === '#' || location.hash === '#/') {
    location.hash = startParamToPath(startParam);
  }
}

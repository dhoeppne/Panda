/**
 * One chat's identity (ADR 0010).
 *
 * A chat is named by the namespace of the family that owns it and the
 * session id the agent minted. The session id is the server's own: the
 * creche door mints it at `session/new` and the vmm row, the session disk
 * and the VM all carry it. So the same conversation has the same identity
 * in the browser and on the host, and a link to it opens the same chat.
 */
import { profileEndpoint, type AgentProfile } from './profiles';

/** A chat's identity. */
export type ChatId = {
  /** The family's URL namespace: its slug, or the id of a 临时直连. */
  namespace: string;
  /** The session id the agent minted. */
  sessionId: string;
};

/**
 * The map key of a chat. A namespace never holds a newline, so the
 * separator keeps the pair apart.
 */
export function chatKey(id: ChatId): string {
  return `${id.namespace}\n${id.sessionId}`;
}

/** True when two ids name the same chat. Null is the absence of a chat. */
export function sameChat(a: ChatId | null, b: ChatId | null): boolean {
  if (a === null || b === null) return a === b;
  return a.namespace === b.namespace && a.sessionId === b.sessionId;
}

/**
 * The separator between a profile id and the number of an extra connection
 * of that profile. A profile id is a UUID, so '#' never appears in one.
 */
const EXTRA_CONNECTION_SEPARATOR = '#';

/**
 * The id of the Nth extra connection of a family (N counts from 1). A family
 * holds more than one connection when a second live session needs its own
 * link: one connection serves one live session (ADR 0002), so a running
 * session keeps its link and its turn while the next session gets another.
 */
export function extraConnectionId(profileId: string, n: number): string {
  return `${profileId}${EXTRA_CONNECTION_SEPARATOR}${n}`;
}

/**
 * The profile id that owns a connection id: the id itself for a profile
 * connection, the part before '#' for an extra connection of a profile. Null
 * for a 临时直连, which owns no profile.
 */
export function profileIdOfConnection(connectionId: string): string | null {
  const at = connectionId.indexOf(EXTRA_CONNECTION_SEPARATOR);
  return at === -1 ? null : connectionId.slice(0, at);
}

/**
 * The namespace of a connection: the slug of the family that owns it, or
 * the connection id of a 临时直连 (which owns no family and therefore has no
 * shareable namespace).
 */
export function namespaceOfConnection(connectionId: string, profiles: AgentProfile[]): string {
  const owner = profileIdOfConnection(connectionId) ?? connectionId;
  const profile = profiles.find((entry) => entry.id === owner);
  return profile ? profile.slug : connectionId;
}

/**
 * The connection a namespace names: the family whose slug it is, or the
 * connection id of a 临时直连. Null when no family and no connection carry
 * the namespace.
 */
export function connectionOfNamespace(
  namespace: string,
  profiles: AgentProfile[],
  knownConnectionIds: readonly string[],
): string | null {
  const profile = profiles.find((entry) => entry.slug === namespace);
  if (profile) return profile.id;
  return knownConnectionIds.includes(namespace) ? namespace : null;
}

/**
 * The endpoint a namespace names: the endpoint of the family whose slug it
 * is. Null when no family carries the namespace. The layout migration uses
 * it to map the old endpoint-keyed layout keys to the new chat ids.
 */
export function endpointOfNamespace(namespace: string, profiles: AgentProfile[]): string | null {
  const profile = profiles.find((entry) => entry.slug === namespace);
  return profile ? profileEndpoint(profile) : null;
}

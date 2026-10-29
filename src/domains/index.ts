import { config } from '../config';
import { homeInspectionDomain } from './home-inspection';
import { startupDomain } from './startup';
import type { DomainProfile } from './types';

export type { ChatTurn, DomainProfile, DomainSource, DomainPromptInput } from './types';
export { formatHistory } from './history';

const DOMAINS: Record<string, DomainProfile> = {
  [startupDomain.id]: startupDomain,
  [homeInspectionDomain.id]: homeInspectionDomain,
};

export function resolveDomain(id: string): DomainProfile {
  const domain = DOMAINS[id];
  if (!domain) {
    throw new Error(
      `Unknown KNOWLEDGE_DOMAIN '${id}'. Valid: ${Object.keys(DOMAINS).join(', ')}`
    );
  }
  return domain;
}

export function getDomain(): DomainProfile {
  return resolveDomain(config.domain);
}

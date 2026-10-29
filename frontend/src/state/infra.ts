// Cloud plans waiting for a person, for the rail badge and the toast that
// says an agent proposed one. The Cloud view loads everything else itself.
import {createStore} from '../lib/store';
import {api} from '../lib/bindings';
import type {InfraPlan} from '../lib/types';
import {toast} from '../ui/toast';

export const infraStore = createStore<{waiting: InfraPlan[]; selected: string}>({waiting: [], selected: ''});

let known: Set<string> | null = null;

/** Reloads the plans waiting for approval. A plan that appeared since the
 * last load is announced, unless it was proposed from this app. */
export async function refreshInfraWaiting() {
  let plans: InfraPlan[] = [];
  try {
    const state = await api.infraState();
    plans = (Array.isArray(state?.plans) ? state.plans : []).filter(p => p.state === 'proposed');
  } catch {
    return;
  }
  const first = known === null;
  const seen = known || new Set<string>();
  for (const plan of plans) {
    if (!first && !seen.has(plan.id) && plan.requester && !plan.requester.startsWith('you')) {
      toast(`${requesterName(plan.requester)} proposed a cloud plan: ${plan.title}. Review it in Cloud.`);
    }
    seen.add(plan.id);
  }
  known = seen;
  infraStore.set({waiting: plans});
}

/** Selects an item in the Cloud view: a plan or resource id, "here" or "ledger". */
export function selectInfra(id: string) {
  infraStore.set({selected: id});
}

/** "agent main" -> "The main agent"; people keep their name. */
export function requesterName(requester?: string): string {
  const value = String(requester || '').trim();
  if (!value) return 'Someone';
  if (/^you\b/i.test(value)) return 'You';
  const agent = value.match(/^agent\s+(.+)$/i);
  if (agent) return agent[1] === 'main' ? 'The main agent' : /^subagent\//.test(agent[1]) ? 'A subagent' : 'An agent';
  return value[0].toUpperCase() + value.slice(1);
}

/** For tests. */
export function resetInfraWaiting() {
  known = null;
  infraStore.set({waiting: [], selected: ''});
}

import { WebHaptics } from 'web-haptics';

const HAPTICS_KEY = 'nullius.haptics';
const haptics = new WebHaptics();

/** a rare tap of feedback — honoured opt-out (the sailing note carries the
 *  switch), silent where the device has none */
export function buzz(kind: 'success' | 'error' | 'nudge' | 'selection') {
  try {
    if (localStorage.getItem(HAPTICS_KEY) !== 'off') void haptics.trigger(kind);
  } catch {
    /* no haptics */
  }
}

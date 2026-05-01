/**
 * Carriers — top-level tab. Hosts the CarrierSetupPanel.
 *
 * Carrier control was previously buried 3 layers deep
 * (Tools → Rename → Carrier collapsible). The carrier panel is one of
 * the most-used features for Hornet School training missions, so it
 * gets promoted to its own top-level tab in the workflow reorg.
 */

import { CarrierSetupPanel } from './CarrierSetupPanel';

export function CarriersTab() {
  return <CarrierSetupPanel />;
}

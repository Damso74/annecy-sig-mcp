/**
 * Façade outil MCP — logique d’inventaire dans `src/inventory/`.
 */
export { runInventoryAllLayers } from "../inventory/runInventory.js";
export type {
  InventoryLayerRow,
  InventoryRunInput,
  InventoryRunResult,
  InventoryTarget,
} from "../inventory/types.js";
export { preparePropsForInventoryStats, getInventoryFieldsForMode } from "../inventory/inventoryFields.js";

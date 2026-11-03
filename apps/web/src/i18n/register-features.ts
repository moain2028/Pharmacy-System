// Registers feature-colocated dictionaries into the global DICTS (ar/en) once at app start.
import { DICTS } from "./index";
import { salesAr, salesEn } from "@/features/sales/sales.keys";
import { returnsAr, returnsEn } from "@/features/returns/returns.keys";
import { customersAr, customersEn } from "@/features/customers/customers.keys";
import { accountingAr, accountingEn } from "@/features/accounting/accounting.keys";
import { usersAr, usersEn } from "@/features/users/users.keys";
import { settingsAr, settingsEn } from "@/features/settings/settings.keys";
import { posAr, posEn } from "@/features/pos/pos.keys";
import { itemsAr, itemsEn } from "@/features/items/items.keys";
import { inventoryAr, inventoryEn } from "@/features/inventory/inventory.keys";
import { expiryAr, expiryEn } from "@/features/expiry/expiry.keys";
import { reportsAr, reportsEn } from "@/features/reports/reports.keys";

Object.assign(DICTS.ar, salesAr, returnsAr, customersAr, accountingAr, usersAr, settingsAr, posAr, itemsAr, inventoryAr, expiryAr, reportsAr);
Object.assign(DICTS.en, salesEn, returnsEn, customersEn, accountingEn, usersEn, settingsEn, posEn, itemsEn, inventoryEn, expiryEn, reportsEn);

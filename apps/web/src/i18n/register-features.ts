// Registers feature-colocated dictionaries into the global DICTS (ar/en) once at app start.
import { DICTS } from "./index";
import { salesAr, salesEn } from "@/features/sales/sales.keys";
import { returnsAr, returnsEn } from "@/features/returns/returns.keys";
import { customersAr, customersEn } from "@/features/customers/customers.keys";
import { accountingAr, accountingEn } from "@/features/accounting/accounting.keys";
import { usersAr, usersEn } from "@/features/users/users.keys";
import { settingsAr, settingsEn } from "@/features/settings/settings.keys";

Object.assign(DICTS.ar, salesAr, returnsAr, customersAr, accountingAr, usersAr, settingsAr);
Object.assign(DICTS.en, salesEn, returnsEn, customersEn, accountingEn, usersEn, settingsEn);

import type { AccountSpec, LedgerEvent } from './events.ts';
import { fromText } from './money.ts';

/** The two accounts in the window. */
export const ACCOUNTS: AccountSpec[] = [
  { id: 'ACC-001', currency: 'AED' },
  { id: 'ACC-002', currency: 'BHD' },
];

/** The ten events, in the order they arrive. */
export const STREAM: LedgerEvent[] = [
  { id: 'E1', type: 'CREDIT', bookedDay: 1, valueDay: 1, account: 'ACC-001', amount: fromText('AED', '1,200.00') },
  { id: 'E2', type: 'DEBIT', bookedDay: 1, valueDay: 1, account: 'ACC-001', amount: fromText('AED', '950.00') },
  { id: 'E3', type: 'AUTHORIZATION', bookedDay: 2, valueDay: 2, account: 'ACC-001', authId: 'Auth-A', amount: fromText('AED', '200.00') },
  { id: 'E4', type: 'CREDIT', bookedDay: 3, valueDay: 3, account: 'ACC-001', amount: fromText('AED', '400.00') },
  { id: 'E5', type: 'SETTLEMENT', bookedDay: 4, valueDay: 4, account: 'ACC-001', authId: 'Auth-A', amount: fromText('AED', '185.00') },
  { id: 'E6', type: 'SETTLEMENT', bookedDay: 4, valueDay: 4, account: 'ACC-001', authId: 'Auth-Z', amount: fromText('AED', '180.00') },
  { id: 'E7', type: 'DEBIT', bookedDay: 5, valueDay: 2, account: 'ACC-001', amount: fromText('AED', '620.00') },
  { id: 'E8', type: 'AUTHORIZATION', bookedDay: 5, valueDay: 5, account: 'ACC-001', authId: 'Auth-B', amount: fromText('AED', '90.00') },
  { id: 'E9', type: 'REVERSAL', bookedDay: 6, valueDay: 2, account: 'ACC-001', reverses: 'E7' },
  { id: 'E10', type: 'CREDIT', bookedDay: 5, valueDay: 5, account: 'ACC-002', amount: fromText('BHD', '10.000'), instalments: 3 },
];

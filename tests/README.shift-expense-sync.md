# Shift Expense Sync Scenario Test

This scenario test opens a shift for a fixed cashier/location, creates:
- one cash sale of `200`
- one cash expense of `100`

Then it verifies:
- shift preview `expectedCashSales === 200`
- shift preview `cashExpenseTotal === 100`
- stored shift `cashExpenseTotal === 100`

## IDs used

- organizationId: `6a0ea9ec202ee117d64d28ed`
- cashierId: `6a0ea9eb202ee117d64d28e6`
- locationId: `6a0eac1a202ee117d64d293a`

## Run

```bash
cd /home/kev/Code/FLEXI-POS/server
npm run test:shift-expense-sync
```

## Keep created data

By default, the script cleans up created shift/sale/expense documents.

Set `KEEP_SHIFT_EXPENSE_TEST_DATA=1` to keep records for manual DB inspection:

```bash
cd /home/kev/Code/FLEXI-POS/server
KEEP_SHIFT_EXPENSE_TEST_DATA=1 npm run test:shift-expense-sync
```
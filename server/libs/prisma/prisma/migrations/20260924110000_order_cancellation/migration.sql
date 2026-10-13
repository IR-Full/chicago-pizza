-- Giving points back needs a name of its own. Reusing EARN would make a
-- refund look like cashback in the customer's history — and inflate every
-- "how much have we paid out" report built on it.
ALTER TYPE "LoyaltyTxType" ADD VALUE 'REFUND';
